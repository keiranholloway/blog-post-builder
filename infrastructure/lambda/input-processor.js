"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_transcribe_1 = require("@aws-sdk/client-transcribe");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const uuid_1 = require("uuid");
// Initialize AWS clients
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
const transcribeClient = new client_transcribe_1.TranscribeClient({ region: process.env.AWS_REGION });
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({ region: process.env.AWS_REGION });
const AUDIO_BUCKET = process.env.AUDIO_BUCKET_NAME;
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME;
const EVENT_BUS = process.env.EVENT_BUS_NAME;
const handler = async (event, context) => {
    console.log('Input Processor Event:', JSON.stringify(event, null, 2));
    console.log('Environment variables:', {
        CONTENT_TABLE_NAME: process.env.CONTENT_TABLE_NAME,
        AUDIO_BUCKET_NAME: process.env.AUDIO_BUCKET_NAME,
        EVENT_BUS_NAME: process.env.EVENT_BUS_NAME,
        AWS_REGION: process.env.AWS_REGION
    });
    // Allowed origins for CORS
    const allowedOrigins = [
        'https://keiranholloway.github.io',
        'http://localhost:3000',
        'http://localhost:5173',
    ];
    const requestOrigin = event.headers.origin || event.headers.Origin;
    const allowedOrigin = allowedOrigins.includes(requestOrigin || '') ? requestOrigin : allowedOrigins[0];
    const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'Content-Type': 'application/json',
    };
    // Validate required environment variables
    if (!CONTENT_TABLE) {
        console.error('CONTENT_TABLE_NAME environment variable is missing');
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Configuration Error',
                message: 'CONTENT_TABLE_NAME environment variable is required'
            })
        };
    }
    if (!EVENT_BUS) {
        console.error('EVENT_BUS_NAME environment variable is missing');
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Configuration Error',
                message: 'EVENT_BUS_NAME environment variable is required'
            })
        };
    }
    if (!AUDIO_BUCKET) {
        console.error('AUDIO_BUCKET_NAME environment variable is missing');
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Configuration Error',
                message: 'AUDIO_BUCKET_NAME environment variable is required'
            })
        };
    }
    try {
        // Handle preflight OPTIONS requests
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: '',
            };
        }
        const path = event.path;
        const method = event.httpMethod;
        console.log('Processing request:', { method, path });
        // Route: POST /api/input/audio - Handle audio file upload
        if (method === 'POST' && path === '/api/input/audio') {
            return await handleAudioUpload(event, context, corsHeaders);
        }
        // Route: POST /api/input/text - Handle text input
        if (method === 'POST' && path === '/api/input/text') {
            console.log('Handling text input request');
            try {
                return await handleTextInput(event, context, corsHeaders);
            }
            catch (error) {
                console.error('Error in handleTextInput:', error);
                throw error;
            }
        }
        // Route: GET /api/input/status/{id} - Check processing status
        if (method === 'GET' && path.startsWith('/api/input/status/')) {
            const inputId = path.split('/').pop();
            return await getInputStatus(inputId, corsHeaders);
        }
        // Route: POST /api/input/transcription-callback - Handle Transcribe callback
        if (method === 'POST' && path === '/api/input/transcription-callback') {
            return await handleTranscriptionCallback(event, corsHeaders);
        }
        // Default 404 for unmatched routes
        const errorResponse = {
            error: 'Not Found',
            message: `Route ${method} ${path} not found`,
            requestId: context.awsRequestId,
        };
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify(errorResponse),
        };
    }
    catch (error) {
        console.error('Unhandled error in input processor:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        const errorResponse = {
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : 'An unexpected error occurred',
            requestId: context.awsRequestId,
        };
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify(errorResponse),
        };
    }
};
exports.handler = handler;
// Audio upload handler
async function handleAudioUpload(event, context, corsHeaders) {
    try {
        console.log('Environment variables:', {
            CONTENT_TABLE: CONTENT_TABLE,
            AUDIO_BUCKET: AUDIO_BUCKET,
            EVENT_BUS: EVENT_BUS
        });
        if (!event.body) {
            throw new Error('Request body is required');
        }
        const request = JSON.parse(event.body);
        // Validate request
        const validation = validateAudioUploadRequest(request);
        if (!validation.isValid) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Validation Error',
                    message: validation.error,
                    requestId: context.awsRequestId,
                }),
            };
        }
        // Generate unique ID for this input
        const inputId = (0, uuid_1.v4)();
        const timestamp = new Date().toISOString();
        // Decode base64 audio data
        const audioBuffer = Buffer.from(request.audioData, 'base64');
        // Validate audio quality
        const audioValidation = validateAudioQuality(audioBuffer, request.contentType);
        if (!audioValidation.isValid) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Audio Validation Error',
                    message: audioValidation.error,
                    requestId: context.awsRequestId,
                }),
            };
        }
        // Upload audio to S3
        const audioKey = `audio/${request.userId}/${inputId}.${getFileExtension(request.contentType)}`;
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: AUDIO_BUCKET,
            Key: audioKey,
            Body: audioBuffer,
            ContentType: request.contentType,
            Metadata: {
                userId: request.userId,
                inputId: inputId,
                uploadedAt: timestamp,
            },
        }));
        // Create initial record in DynamoDB
        const inputRecord = {
            id: inputId,
            userId: request.userId,
            type: 'audio',
            status: 'processing',
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
            TableName: CONTENT_TABLE,
            Item: {
                id: { S: inputRecord.id },
                userId: { S: inputRecord.userId },
                type: { S: inputRecord.type },
                status: { S: inputRecord.status },
                audioKey: { S: audioKey },
                createdAt: { S: inputRecord.createdAt },
                updatedAt: { S: inputRecord.updatedAt },
            },
        }));
        // Start transcription job
        const transcriptionJobName = `transcription-${inputId}`;
        const s3Uri = `s3://${AUDIO_BUCKET}/${audioKey}`;
        await transcribeClient.send(new client_transcribe_1.StartTranscriptionJobCommand({
            TranscriptionJobName: transcriptionJobName,
            Media: {
                MediaFileUri: s3Uri,
            },
            MediaFormat: getMediaFormat(request.contentType),
            LanguageCode: 'en-US',
            OutputBucketName: AUDIO_BUCKET,
            OutputKey: `transcriptions/${inputId}.json`,
        }));
        // Publish event for processing started
        await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
            Entries: [{
                    Source: 'automated-blog-poster.input-processor',
                    DetailType: 'Audio Processing Started',
                    Detail: JSON.stringify({
                        inputId,
                        userId: request.userId,
                        transcriptionJobName,
                        audioKey,
                    }),
                    EventBusName: EVENT_BUS,
                }],
        }));
        const response = {
            message: 'Audio upload successful, processing started',
            data: {
                inputId,
                status: 'processing',
                transcriptionJobName,
            },
        };
        return {
            statusCode: 202,
            headers: corsHeaders,
            body: JSON.stringify(response),
        };
    }
    catch (error) {
        console.error('Error in handleAudioUpload:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Unknown error',
                requestId: context.awsRequestId,
            }),
        };
    }
}
// Text input handler
async function handleTextInput(event, context, corsHeaders) {
    try {
        console.log('Text input - Environment variables:', {
            CONTENT_TABLE: CONTENT_TABLE,
            EVENT_BUS: EVENT_BUS
        });
        console.log('Request body:', event.body);
        if (!event.body) {
            throw new Error('Request body is required');
        }
        let request;
        try {
            request = JSON.parse(event.body);
            console.log('Parsed request:', request);
        }
        catch (parseError) {
            console.error('JSON parse error:', parseError);
            throw new Error('Invalid JSON in request body');
        }
        // Validate request
        const validation = validateTextInputRequest(request);
        if (!validation.isValid) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Validation Error',
                    message: validation.error,
                    requestId: context.awsRequestId,
                }),
            };
        }
        // Generate unique ID for this input
        const inputId = (0, uuid_1.v4)();
        const timestamp = new Date().toISOString();
        // Preprocess text input
        const processedText = preprocessTextInput(request.text);
        // Create record in DynamoDB
        const inputRecord = {
            id: inputId,
            userId: request.userId,
            type: 'text',
            status: 'completed',
            originalInput: request.text,
            transcription: processedText,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        const item = {
            id: { S: inputRecord.id },
            userId: { S: inputRecord.userId },
            type: { S: inputRecord.type },
            status: { S: inputRecord.status },
            createdAt: { S: inputRecord.createdAt },
            updatedAt: { S: inputRecord.updatedAt },
        };
        if (inputRecord.originalInput) {
            item.originalInput = { S: inputRecord.originalInput };
        }
        if (inputRecord.transcription) {
            item.transcription = { S: inputRecord.transcription };
        }
        console.log('About to write to DynamoDB table:', CONTENT_TABLE);
        console.log('DynamoDB item:', JSON.stringify(item, null, 2));
        try {
            await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
                TableName: CONTENT_TABLE,
                Item: item,
            }));
            console.log('DynamoDB write successful');
        }
        catch (dbError) {
            console.error('DynamoDB error:', dbError);
            throw new Error(`DynamoDB write failed: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
        }
        console.log('About to publish to EventBridge:', EVENT_BUS);
        try {
            // Publish event for text processing completed
            await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
                Entries: [{
                        Source: 'automated-blog-poster.input-processor',
                        DetailType: 'Text Processing Completed',
                        Detail: JSON.stringify({
                            inputId,
                            userId: request.userId,
                            transcription: processedText,
                        }),
                        EventBusName: EVENT_BUS,
                    }],
            }));
            console.log('EventBridge publish successful');
        }
        catch (eventError) {
            console.error('EventBridge error:', eventError);
            throw new Error(`EventBridge publish failed: ${eventError instanceof Error ? eventError.message : 'Unknown error'}`);
        }
        const response = {
            message: 'Text input processed successfully',
            data: {
                inputId,
                status: 'completed',
                transcription: processedText,
            },
        };
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(response),
        };
    }
    catch (error) {
        console.error('Error in handleTextInput:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Unknown error',
                requestId: context.awsRequestId,
            }),
        };
    }
}
// Get input processing status
async function getInputStatus(inputId, corsHeaders) {
    try {
        // Get record from DynamoDB
        const result = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
            TableName: CONTENT_TABLE,
            Key: {
                id: { S: inputId },
            },
        }));
        if (!result || !result.Item) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Not Found',
                    message: `Input with ID ${inputId} not found`,
                }),
            };
        }
        const inputRecord = {
            id: result.Item.id.S,
            userId: result.Item.userId.S,
            type: result.Item.type.S,
            status: result.Item.status.S,
            originalInput: result.Item.originalInput?.S,
            transcription: result.Item.transcription?.S,
            error: result.Item.error?.S,
            createdAt: result.Item.createdAt.S,
            updatedAt: result.Item.updatedAt.S,
        };
        // If audio processing is still in progress, check transcription job status
        if (inputRecord.type === 'audio' && inputRecord.status === 'processing') {
            const transcriptionJobName = `transcription-${inputId}`;
            try {
                const transcriptionResult = await transcribeClient.send(new client_transcribe_1.GetTranscriptionJobCommand({
                    TranscriptionJobName: transcriptionJobName,
                }));
                if (transcriptionResult.TranscriptionJob?.TranscriptionJobStatus === 'COMPLETED') {
                    // Update record with completed transcription
                    await updateTranscriptionResult(inputId, transcriptionResult.TranscriptionJob.Transcript?.TranscriptFileUri);
                    inputRecord.status = 'completed';
                }
                else if (transcriptionResult.TranscriptionJob?.TranscriptionJobStatus === 'FAILED') {
                    // Update record with failure
                    await updateTranscriptionError(inputId, transcriptionResult.TranscriptionJob.FailureReason || 'Transcription failed');
                    inputRecord.status = 'failed';
                    inputRecord.error = transcriptionResult.TranscriptionJob.FailureReason || 'Transcription failed';
                }
            }
            catch (transcribeError) {
                console.error('Error checking transcription status:', transcribeError);
                // Don't fail the status check if transcription check fails
            }
        }
        const response = {
            message: 'Input status retrieved successfully',
            data: inputRecord,
        };
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(response),
        };
    }
    catch (error) {
        console.error('Error in getInputStatus:', error);
        throw error;
    }
}
// Handle transcription callback (for webhook-based updates)
async function handleTranscriptionCallback(event, corsHeaders) {
    try {
        if (!event.body) {
            throw new Error('Request body is required');
        }
        const callbackData = JSON.parse(event.body);
        console.log('Transcription callback received:', callbackData);
        // This would be used if AWS Transcribe supported webhooks
        // For now, we'll use polling in the status check
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'Callback received' }),
        };
    }
    catch (error) {
        console.error('Error in handleTranscriptionCallback:', error);
        throw error;
    }
}
// Update transcription result in DynamoDB
async function updateTranscriptionResult(inputId, transcriptFileUri) {
    try {
        // Download transcription result from S3
        const transcriptKey = transcriptFileUri.split('/').slice(3).join('/'); // Remove s3://bucket-name/
        const transcriptResult = await s3Client.send(new client_s3_1.GetObjectCommand({
            Bucket: AUDIO_BUCKET,
            Key: transcriptKey,
        }));
        const transcriptData = JSON.parse(await transcriptResult.Body.transformToString());
        const transcription = transcriptData.results.transcripts[0].transcript;
        // Update DynamoDB record
        await dynamoClient.send(new client_dynamodb_1.UpdateItemCommand({
            TableName: CONTENT_TABLE,
            Key: {
                id: { S: inputId },
            },
            UpdateExpression: 'SET #status = :status, transcription = :transcription, updatedAt = :updatedAt',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':status': { S: 'completed' },
                ':transcription': { S: transcription },
                ':updatedAt': { S: new Date().toISOString() },
            },
        }));
        // Publish event for transcription completed
        await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
            Entries: [{
                    Source: 'automated-blog-poster.input-processor',
                    DetailType: 'Audio Processing Completed',
                    Detail: JSON.stringify({
                        inputId,
                        transcription,
                    }),
                    EventBusName: EVENT_BUS,
                }],
        }));
    }
    catch (error) {
        console.error('Error updating transcription result:', error);
        await updateTranscriptionError(inputId, `Failed to process transcription: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
// Update transcription error in DynamoDB
async function updateTranscriptionError(inputId, errorMessage) {
    await dynamoClient.send(new client_dynamodb_1.UpdateItemCommand({
        TableName: CONTENT_TABLE,
        Key: {
            id: { S: inputId },
        },
        UpdateExpression: 'SET #status = :status, #error = :error, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
            '#status': 'status',
            '#error': 'error',
        },
        ExpressionAttributeValues: {
            ':status': { S: 'failed' },
            ':error': { S: errorMessage },
            ':updatedAt': { S: new Date().toISOString() },
        },
    }));
}
function validateAudioUploadRequest(request) {
    if (!request.audioData) {
        return { isValid: false, error: 'Audio data is required' };
    }
    if (!request.contentType) {
        return { isValid: false, error: 'Content type is required' };
    }
    if (!request.userId) {
        return { isValid: false, error: 'User ID is required' };
    }
    // Validate content type
    const supportedTypes = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/mp4', 'audio/webm'];
    if (!supportedTypes.includes(request.contentType)) {
        return { isValid: false, error: `Unsupported content type: ${request.contentType}. Supported types: ${supportedTypes.join(', ')}` };
    }
    // Validate base64 format
    try {
        Buffer.from(request.audioData, 'base64');
    }
    catch (error) {
        return { isValid: false, error: 'Invalid base64 audio data' };
    }
    return { isValid: true };
}
function validateTextInputRequest(request) {
    if (!request.text) {
        return { isValid: false, error: 'Text is required' };
    }
    if (!request.userId) {
        return { isValid: false, error: 'User ID is required' };
    }
    // Validate text length (1-10000 characters)
    if (request.text.length < 1) {
        return { isValid: false, error: 'Text must be at least 1 character long' };
    }
    if (request.text.length > 10000) {
        return { isValid: false, error: 'Text must be no more than 10,000 characters long' };
    }
    // Basic content validation
    const trimmedText = request.text.trim();
    if (trimmedText.length === 0) {
        return { isValid: false, error: 'Text cannot be empty or only whitespace' };
    }
    return { isValid: true };
}
function validateAudioQuality(audioBuffer, contentType) {
    // Basic file size validation (1KB to 25MB)
    const minSize = 1024; // 1KB
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (audioBuffer.length < minSize) {
        return { isValid: false, error: `Audio file too small (${audioBuffer.length} bytes). Minimum size: ${minSize} bytes` };
    }
    if (audioBuffer.length > maxSize) {
        return { isValid: false, error: `Audio file too large (${audioBuffer.length} bytes). Maximum size: ${maxSize} bytes` };
    }
    // Basic format validation based on file headers
    const isValidFormat = validateAudioFormat(audioBuffer, contentType);
    if (!isValidFormat) {
        return { isValid: false, error: `Invalid audio format for content type: ${contentType}` };
    }
    return { isValid: true };
}
function validateAudioFormat(audioBuffer, contentType) {
    // Basic file signature validation
    const header = audioBuffer.subarray(0, 12);
    switch (contentType) {
        case 'audio/wav':
            // WAV files start with "RIFF" and contain "WAVE"
            return header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WAVE';
        case 'audio/mp3':
        case 'audio/mpeg':
            // MP3 files start with ID3 tag or MP3 frame sync
            return header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33 || // ID3
                header[0] === 0xFF && (header[1] & 0xE0) === 0xE0; // MP3 frame sync
        case 'audio/mp4':
            // MP4 files contain "ftyp" box
            return header.subarray(4, 8).toString() === 'ftyp';
        case 'audio/webm':
            // WebM files start with EBML header
            return header[0] === 0x1A && header[1] === 0x45 && header[2] === 0xDF && header[3] === 0xA3;
        default:
            return false;
    }
}
// Helper functions
function getFileExtension(contentType) {
    switch (contentType) {
        case 'audio/wav': return 'wav';
        case 'audio/mp3':
        case 'audio/mpeg': return 'mp3';
        case 'audio/mp4': return 'mp4';
        case 'audio/webm': return 'webm';
        default: return 'audio';
    }
}
function getMediaFormat(contentType) {
    switch (contentType) {
        case 'audio/wav': return client_transcribe_1.MediaFormat.WAV;
        case 'audio/mp3':
        case 'audio/mpeg': return client_transcribe_1.MediaFormat.MP3;
        case 'audio/mp4': return client_transcribe_1.MediaFormat.MP4;
        case 'audio/webm': return client_transcribe_1.MediaFormat.WEBM;
        default: return client_transcribe_1.MediaFormat.WAV;
    }
}
function preprocessTextInput(text) {
    // Clean and normalize text input
    let processed = text.trim();
    // Remove excessive whitespace
    processed = processed.replace(/\s+/g, ' ');
    // Normalize line breaks
    processed = processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Remove excessive line breaks (more than 2 consecutive)
    processed = processed.replace(/\n{3,}/g, '\n\n');
    // Basic sentence structure improvements
    processed = processed.replace(/([.!?])\s*([a-z])/g, '$1 $2');
    return processed;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5wdXQtcHJvY2Vzc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW5wdXQtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLGtEQUFrRjtBQUNsRixrRUFBcUk7QUFDckksOERBQTZHO0FBQzdHLG9FQUFrRjtBQUNsRiwrQkFBb0M7QUFvQ3BDLHlCQUF5QjtBQUN6QixNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBQ2xFLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxvQ0FBZ0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDbEYsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLGlCQUFpQixHQUFHLElBQUksc0NBQWlCLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBRXBGLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWtCLENBQUM7QUFDcEQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBbUIsQ0FBQztBQUN0RCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWUsQ0FBQztBQUV2QyxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQTJCLEVBQzNCLE9BQWdCLEVBQ2dCLEVBQUU7SUFDbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN0RSxPQUFPLENBQUMs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ZXN1bHQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgUzNDbGllbnQsIFB1dE9iamVjdENvbW1hbmQsIEdldE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xyXG5pbXBvcnQgeyBUcmFuc2NyaWJlQ2xpZW50LCBTdGFydFRyYW5zY3JpcHRpb25Kb2JDb21tYW5kLCBHZXRUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZCwgTWVkaWFGb3JtYXQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtdHJhbnNjcmliZSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBQdXRJdGVtQ29tbWFuZCwgVXBkYXRlSXRlbUNvbW1hbmQsIEdldEl0ZW1Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRXZlbnRCcmlkZ2VDbGllbnQsIFB1dEV2ZW50c0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZXZlbnRicmlkZ2UnO1xyXG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tICd1dWlkJztcclxuXHJcbmludGVyZmFjZSBFcnJvclJlc3BvbnNlIHtcclxuICBlcnJvcjogc3RyaW5nO1xyXG4gIG1lc3NhZ2U6IHN0cmluZztcclxuICByZXF1ZXN0SWQ/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBTdWNjZXNzUmVzcG9uc2Uge1xyXG4gIG1lc3NhZ2U6IHN0cmluZztcclxuICBkYXRhPzogYW55O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQXVkaW9VcGxvYWRSZXF1ZXN0IHtcclxuICBhdWRpb0RhdGE6IHN0cmluZzsgLy8gQmFzZTY0IGVuY29kZWQgYXVkaW9cclxuICBjb250ZW50VHlwZTogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVGV4dElucHV0UmVxdWVzdCB7XHJcbiAgdGV4dDogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgSW5wdXRQcm9jZXNzaW5nUmVzdWx0IHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIHR5cGU6ICdhdWRpbycgfCAndGV4dCc7XHJcbiAgc3RhdHVzOiAncHJvY2Vzc2luZycgfCAnY29tcGxldGVkJyB8ICdmYWlsZWQnO1xyXG4gIG9yaWdpbmFsSW5wdXQ/OiBzdHJpbmc7XHJcbiAgdHJhbnNjcmlwdGlvbj86IHN0cmluZztcclxuICBlcnJvcj86IHN0cmluZztcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICB1cGRhdGVkQXQ6IHN0cmluZztcclxufVxyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgdHJhbnNjcmliZUNsaWVudCA9IG5ldyBUcmFuc2NyaWJlQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGV2ZW50QnJpZGdlQ2xpZW50ID0gbmV3IEV2ZW50QnJpZGdlQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5cclxuY29uc3QgQVVESU9fQlVDS0VUID0gcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUhO1xyXG5jb25zdCBDT05URU5UX1RBQkxFID0gcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FITtcclxuY29uc3QgRVZFTlRfQlVTID0gcHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUhO1xyXG5cclxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoXHJcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LFxyXG4gIGNvbnRleHQ6IENvbnRleHRcclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcclxuICBjb25zb2xlLmxvZygnSW5wdXQgUHJvY2Vzc29yIEV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XHJcbiAgY29uc29sZS5sb2coJ0Vudmlyb25tZW50IHZhcmlhYmxlczonLCB7XHJcbiAgICBDT05URU5UX1RBQkxFX05BTUU6IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSxcclxuICAgIEFVRElPX0JVQ0tFVF9OQU1FOiBwcm9jZXNzLmVudi5BVURJT19CVUNLRVRfTkFNRSxcclxuICAgIEVWRU5UX0JVU19OQU1FOiBwcm9jZXNzLmVudi5FVkVOVF9CVVNfTkFNRSxcclxuICAgIEFXU19SRUdJT046IHByb2Nlc3MuZW52LkFXU19SRUdJT05cclxuICB9KTtcclxuXHJcbiAgLy8gQWxsb3dlZCBvcmlnaW5zIGZvciBDT1JTXHJcbiAgY29uc3QgYWxsb3dlZE9yaWdpbnMgPSBbXHJcbiAgICAnaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nLFxyXG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMCcsXHJcbiAgICAnaHR0cDovL2xvY2FsaG9zdDo1MTczJyxcclxuICBdO1xyXG4gIFxyXG4gIGNvbnN0IHJlcXVlc3RPcmlnaW4gPSBldmVudC5oZWFkZXJzLm9yaWdpbiB8fCBldmVudC5oZWFkZXJzLk9yaWdpbjtcclxuICBjb25zdCBhbGxvd2VkT3JpZ2luID0gYWxsb3dlZE9yaWdpbnMuaW5jbHVkZXMocmVxdWVzdE9yaWdpbiB8fCAnJykgPyByZXF1ZXN0T3JpZ2luISA6IGFsbG93ZWRPcmlnaW5zWzBdO1xyXG5cclxuICBjb25zdCBjb3JzSGVhZGVycyA9IHtcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBhbGxvd2VkT3JpZ2luLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLEF1dGhvcml6YXRpb24sWC1BbXotRGF0ZSxYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1SZXF1ZXN0ZWQtV2l0aCcsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsUE9TVCxQVVQsREVMRVRFLE9QVElPTlMnLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzJzogJ3RydWUnLFxyXG4gICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICB9O1xyXG5cclxuICAvLyBWYWxpZGF0ZSByZXF1aXJlZCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICBpZiAoIUNPTlRFTlRfVEFCTEUpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0NPTlRFTlRfVEFCTEVfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyBtaXNzaW5nJyk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdDb25maWd1cmF0aW9uIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiAnQ09OVEVOVF9UQUJMRV9OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkJ1xyXG4gICAgICB9KVxyXG4gICAgfTtcclxuICB9XHJcbiAgaWYgKCFFVkVOVF9CVVMpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0VWRU5UX0JVU19OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG1pc3NpbmcnKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0NvbmZpZ3VyYXRpb24gRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdFVkVOVF9CVVNfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCdcclxuICAgICAgfSlcclxuICAgIH07XHJcbiAgfVxyXG4gIGlmICghQVVESU9fQlVDS0VUKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdBVURJT19CVUNLRVRfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyBtaXNzaW5nJyk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdDb25maWd1cmF0aW9uIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiAnQVVESU9fQlVDS0VUX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnXHJcbiAgICAgIH0pXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIEhhbmRsZSBwcmVmbGlnaHQgT1BUSU9OUyByZXF1ZXN0c1xyXG4gICAgaWYgKGV2ZW50Lmh0dHBNZXRob2QgPT09ICdPUFRJT05TJykge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiAnJyxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwYXRoID0gZXZlbnQucGF0aDtcclxuICAgIGNvbnN0IG1ldGhvZCA9IGV2ZW50Lmh0dHBNZXRob2Q7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIHJlcXVlc3Q6JywgeyBtZXRob2QsIHBhdGggfSk7XHJcblxyXG4gICAgLy8gUm91dGU6IFBPU1QgL2FwaS9pbnB1dC9hdWRpbyAtIEhhbmRsZSBhdWRpbyBmaWxlIHVwbG9hZFxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2lucHV0L2F1ZGlvJykge1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQXVkaW9VcGxvYWQoZXZlbnQsIGNvbnRleHQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSb3V0ZTogUE9TVCAvYXBpL2lucHV0L3RleHQgLSBIYW5kbGUgdGV4dCBpbnB1dFxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2lucHV0L3RleHQnKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdIYW5kbGluZyB0ZXh0IGlucHV0IHJlcXVlc3QnKTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlVGV4dElucHV0KGV2ZW50LCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gaGFuZGxlVGV4dElucHV0OicsIGVycm9yKTtcclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIFJvdXRlOiBHRVQgL2FwaS9pbnB1dC9zdGF0dXMve2lkfSAtIENoZWNrIHByb2Nlc3Npbmcgc3RhdHVzXHJcbiAgICBpZiAobWV0aG9kID09PSAnR0VUJyAmJiBwYXRoLnN0YXJ0c1dpdGgoJy9hcGkvaW5wdXQvc3RhdHVzLycpKSB7XHJcbiAgICAgIGNvbnN0IGlucHV0SWQgPSBwYXRoLnNwbGl0KCcvJykucG9wKCk7XHJcbiAgICAgIHJldHVybiBhd2FpdCBnZXRJbnB1dFN0YXR1cyhpbnB1dElkISwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJvdXRlOiBQT1NUIC9hcGkvaW5wdXQvdHJhbnNjcmlwdGlvbi1jYWxsYmFjayAtIEhhbmRsZSBUcmFuc2NyaWJlIGNhbGxiYWNrXHJcbiAgICBpZiAobWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9hcGkvaW5wdXQvdHJhbnNjcmlwdGlvbi1jYWxsYmFjaycpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZVRyYW5zY3JpcHRpb25DYWxsYmFjayhldmVudCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIERlZmF1bHQgNDA0IGZvciB1bm1hdGNoZWQgcm91dGVzXHJcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlOiBFcnJvclJlc3BvbnNlID0ge1xyXG4gICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgIG1lc3NhZ2U6IGBSb3V0ZSAke21ldGhvZH0gJHtwYXRofSBub3QgZm91bmRgLFxyXG4gICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShlcnJvclJlc3BvbnNlKSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdVbmhhbmRsZWQgZXJyb3IgaW4gaW5wdXQgcHJvY2Vzc29yOicsIGVycm9yKTtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHN0YWNrOicsIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5zdGFjayA6ICdObyBzdGFjayB0cmFjZScpO1xyXG5cclxuICAgIGNvbnN0IGVycm9yUmVzcG9uc2U6IEVycm9yUmVzcG9uc2UgPSB7XHJcbiAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnQW4gdW5leHBlY3RlZCBlcnJvciBvY2N1cnJlZCcsXHJcbiAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGVycm9yUmVzcG9uc2UpLFxyXG4gICAgfTtcclxuICB9XHJcbn07XHJcblxyXG4vLyBBdWRpbyB1cGxvYWQgaGFuZGxlclxyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVBdWRpb1VwbG9hZChcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zb2xlLmxvZygnRW52aXJvbm1lbnQgdmFyaWFibGVzOicsIHtcclxuICAgICAgQ09OVEVOVF9UQUJMRTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgQVVESU9fQlVDS0VUOiBBVURJT19CVUNLRVQsXHJcbiAgICAgIEVWRU5UX0JVUzogRVZFTlRfQlVTXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgaWYgKCFldmVudC5ib2R5KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVxdWVzdDogQXVkaW9VcGxvYWRSZXF1ZXN0ID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgcmVxdWVzdFxyXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IHZhbGlkYXRlQXVkaW9VcGxvYWRSZXF1ZXN0KHJlcXVlc3QpO1xyXG4gICAgaWYgKCF2YWxpZGF0aW9uLmlzVmFsaWQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdWYWxpZGF0aW9uIEVycm9yJyxcclxuICAgICAgICAgIG1lc3NhZ2U6IHZhbGlkYXRpb24uZXJyb3IsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdlbmVyYXRlIHVuaXF1ZSBJRCBmb3IgdGhpcyBpbnB1dFxyXG4gICAgY29uc3QgaW5wdXRJZCA9IHV1aWR2NCgpO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIC8vIERlY29kZSBiYXNlNjQgYXVkaW8gZGF0YVxyXG4gICAgY29uc3QgYXVkaW9CdWZmZXIgPSBCdWZmZXIuZnJvbShyZXF1ZXN0LmF1ZGlvRGF0YSwgJ2Jhc2U2NCcpO1xyXG4gICAgXHJcbiAgICAvLyBWYWxpZGF0ZSBhdWRpbyBxdWFsaXR5XHJcbiAgICBjb25zdCBhdWRpb1ZhbGlkYXRpb24gPSB2YWxpZGF0ZUF1ZGlvUXVhbGl0eShhdWRpb0J1ZmZlciwgcmVxdWVzdC5jb250ZW50VHlwZSk7XHJcbiAgICBpZiAoIWF1ZGlvVmFsaWRhdGlvbi5pc1ZhbGlkKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnQXVkaW8gVmFsaWRhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgICBtZXNzYWdlOiBhdWRpb1ZhbGlkYXRpb24uZXJyb3IsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFVwbG9hZCBhdWRpbyB0byBTM1xyXG4gICAgY29uc3QgYXVkaW9LZXkgPSBgYXVkaW8vJHtyZXF1ZXN0LnVzZXJJZH0vJHtpbnB1dElkfS4ke2dldEZpbGVFeHRlbnNpb24ocmVxdWVzdC5jb250ZW50VHlwZSl9YDtcclxuICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xyXG4gICAgICBCdWNrZXQ6IEFVRElPX0JVQ0tFVCxcclxuICAgICAgS2V5OiBhdWRpb0tleSxcclxuICAgICAgQm9keTogYXVkaW9CdWZmZXIsXHJcbiAgICAgIENvbnRlbnRUeXBlOiByZXF1ZXN0LmNvbnRlbnRUeXBlLFxyXG4gICAgICBNZXRhZGF0YToge1xyXG4gICAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXHJcbiAgICAgICAgaW5wdXRJZDogaW5wdXRJZCxcclxuICAgICAgICB1cGxvYWRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIGluaXRpYWwgcmVjb3JkIGluIER5bmFtb0RCXHJcbiAgICBjb25zdCBpbnB1dFJlY29yZDogSW5wdXRQcm9jZXNzaW5nUmVzdWx0ID0ge1xyXG4gICAgICBpZDogaW5wdXRJZCxcclxuICAgICAgdXNlcklkOiByZXF1ZXN0LnVzZXJJZCxcclxuICAgICAgdHlwZTogJ2F1ZGlvJyxcclxuICAgICAgc3RhdHVzOiAncHJvY2Vzc2luZycsXHJcbiAgICAgIGNyZWF0ZWRBdDogdGltZXN0YW1wLFxyXG4gICAgICB1cGRhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IFB1dEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgICBJdGVtOiB7XHJcbiAgICAgICAgaWQ6IHsgUzogaW5wdXRSZWNvcmQuaWQgfSxcclxuICAgICAgICB1c2VySWQ6IHsgUzogaW5wdXRSZWNvcmQudXNlcklkIH0sXHJcbiAgICAgICAgdHlwZTogeyBTOiBpbnB1dFJlY29yZC50eXBlIH0sXHJcbiAgICAgICAgc3RhdHVzOiB7IFM6IGlucHV0UmVjb3JkLnN0YXR1cyB9LFxyXG4gICAgICAgIGF1ZGlvS2V5OiB7IFM6IGF1ZGlvS2V5IH0sXHJcbiAgICAgICAgY3JlYXRlZEF0OiB7IFM6IGlucHV0UmVjb3JkLmNyZWF0ZWRBdCB9LFxyXG4gICAgICAgIHVwZGF0ZWRBdDogeyBTOiBpbnB1dFJlY29yZC51cGRhdGVkQXQgfSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBTdGFydCB0cmFuc2NyaXB0aW9uIGpvYlxyXG4gICAgY29uc3QgdHJhbnNjcmlwdGlvbkpvYk5hbWUgPSBgdHJhbnNjcmlwdGlvbi0ke2lucHV0SWR9YDtcclxuICAgIGNvbnN0IHMzVXJpID0gYHMzOi8vJHtBVURJT19CVUNLRVR9LyR7YXVkaW9LZXl9YDtcclxuXHJcbiAgICBhd2FpdCB0cmFuc2NyaWJlQ2xpZW50LnNlbmQobmV3IFN0YXJ0VHJhbnNjcmlwdGlvbkpvYkNvbW1hbmQoe1xyXG4gICAgICBUcmFuc2NyaXB0aW9uSm9iTmFtZTogdHJhbnNjcmlwdGlvbkpvYk5hbWUsXHJcbiAgICAgIE1lZGlhOiB7XHJcbiAgICAgICAgTWVkaWFGaWxlVXJpOiBzM1VyaSxcclxuICAgICAgfSxcclxuICAgICAgTWVkaWFGb3JtYXQ6IGdldE1lZGlhRm9ybWF0KHJlcXVlc3QuY29udGVudFR5cGUpLFxyXG4gICAgICBMYW5ndWFnZUNvZGU6ICdlbi1VUycsXHJcbiAgICAgIE91dHB1dEJ1Y2tldE5hbWU6IEFVRElPX0JVQ0tFVCxcclxuICAgICAgT3V0cHV0S2V5OiBgdHJhbnNjcmlwdGlvbnMvJHtpbnB1dElkfS5qc29uYCxcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBQdWJsaXNoIGV2ZW50IGZvciBwcm9jZXNzaW5nIHN0YXJ0ZWRcclxuICAgIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgICBFbnRyaWVzOiBbe1xyXG4gICAgICAgIFNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbnB1dC1wcm9jZXNzb3InLFxyXG4gICAgICAgIERldGFpbFR5cGU6ICdBdWRpbyBQcm9jZXNzaW5nIFN0YXJ0ZWQnLFxyXG4gICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgaW5wdXRJZCxcclxuICAgICAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXHJcbiAgICAgICAgICB0cmFuc2NyaXB0aW9uSm9iTmFtZSxcclxuICAgICAgICAgIGF1ZGlvS2V5LFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIEV2ZW50QnVzTmFtZTogRVZFTlRfQlVTLFxyXG4gICAgICB9XSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBjb25zdCByZXNwb25zZTogU3VjY2Vzc1Jlc3BvbnNlID0ge1xyXG4gICAgICBtZXNzYWdlOiAnQXVkaW8gdXBsb2FkIHN1Y2Nlc3NmdWwsIHByb2Nlc3Npbmcgc3RhcnRlZCcsXHJcbiAgICAgIGRhdGE6IHtcclxuICAgICAgICBpbnB1dElkLFxyXG4gICAgICAgIHN0YXR1czogJ3Byb2Nlc3NpbmcnLFxyXG4gICAgICAgIHRyYW5zY3JpcHRpb25Kb2JOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDIsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gaGFuZGxlQXVkaW9VcGxvYWQ6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vLyBUZXh0IGlucHV0IGhhbmRsZXJcclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlVGV4dElucHV0KFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnNvbGUubG9nKCdUZXh0IGlucHV0IC0gRW52aXJvbm1lbnQgdmFyaWFibGVzOicsIHtcclxuICAgICAgQ09OVEVOVF9UQUJMRTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgRVZFTlRfQlVTOiBFVkVOVF9CVVNcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygnUmVxdWVzdCBib2R5OicsIGV2ZW50LmJvZHkpO1xyXG4gICAgXHJcbiAgICBpZiAoIWV2ZW50LmJvZHkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBsZXQgcmVxdWVzdDogVGV4dElucHV0UmVxdWVzdDtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJlcXVlc3QgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkpO1xyXG4gICAgICBjb25zb2xlLmxvZygnUGFyc2VkIHJlcXVlc3Q6JywgcmVxdWVzdCk7XHJcbiAgICB9IGNhdGNoIChwYXJzZUVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0pTT04gcGFyc2UgZXJyb3I6JywgcGFyc2VFcnJvcik7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBKU09OIGluIHJlcXVlc3QgYm9keScpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBWYWxpZGF0ZSByZXF1ZXN0XHJcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gdmFsaWRhdGVUZXh0SW5wdXRSZXF1ZXN0KHJlcXVlc3QpO1xyXG4gICAgaWYgKCF2YWxpZGF0aW9uLmlzVmFsaWQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdWYWxpZGF0aW9uIEVycm9yJyxcclxuICAgICAgICAgIG1lc3NhZ2U6IHZhbGlkYXRpb24uZXJyb3IsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdlbmVyYXRlIHVuaXF1ZSBJRCBmb3IgdGhpcyBpbnB1dFxyXG4gICAgY29uc3QgaW5wdXRJZCA9IHV1aWR2NCgpO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIC8vIFByZXByb2Nlc3MgdGV4dCBpbnB1dFxyXG4gICAgY29uc3QgcHJvY2Vzc2VkVGV4dCA9IHByZXByb2Nlc3NUZXh0SW5wdXQocmVxdWVzdC50ZXh0KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgcmVjb3JkIGluIER5bmFtb0RCXHJcbiAgICBjb25zdCBpbnB1dFJlY29yZDogSW5wdXRQcm9jZXNzaW5nUmVzdWx0ID0ge1xyXG4gICAgICBpZDogaW5wdXRJZCxcclxuICAgICAgdXNlcklkOiByZXF1ZXN0LnVzZXJJZCxcclxuICAgICAgdHlwZTogJ3RleHQnLFxyXG4gICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxyXG4gICAgICBvcmlnaW5hbElucHV0OiByZXF1ZXN0LnRleHQsXHJcbiAgICAgIHRyYW5zY3JpcHRpb246IHByb2Nlc3NlZFRleHQsXHJcbiAgICAgIGNyZWF0ZWRBdDogdGltZXN0YW1wLFxyXG4gICAgICB1cGRhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgaXRlbTogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcclxuICAgICAgaWQ6IHsgUzogaW5wdXRSZWNvcmQuaWQgfSxcclxuICAgICAgdXNlcklkOiB7IFM6IGlucHV0UmVjb3JkLnVzZXJJZCB9LFxyXG4gICAgICB0eXBlOiB7IFM6IGlucHV0UmVjb3JkLnR5cGUgfSxcclxuICAgICAgc3RhdHVzOiB7IFM6IGlucHV0UmVjb3JkLnN0YXR1cyB9LFxyXG4gICAgICBjcmVhdGVkQXQ6IHsgUzogaW5wdXRSZWNvcmQuY3JlYXRlZEF0IH0sXHJcbiAgICAgIHVwZGF0ZWRBdDogeyBTOiBpbnB1dFJlY29yZC51cGRhdGVkQXQgfSxcclxuICAgIH07XHJcblxyXG4gICAgaWYgKGlucHV0UmVjb3JkLm9yaWdpbmFsSW5wdXQpIHtcclxuICAgICAgaXRlbS5vcmlnaW5hbElucHV0ID0geyBTOiBpbnB1dFJlY29yZC5vcmlnaW5hbElucHV0IH07XHJcbiAgICB9XHJcbiAgICBpZiAoaW5wdXRSZWNvcmQudHJhbnNjcmlwdGlvbikge1xyXG4gICAgICBpdGVtLnRyYW5zY3JpcHRpb24gPSB7IFM6IGlucHV0UmVjb3JkLnRyYW5zY3JpcHRpb24gfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZygnQWJvdXQgdG8gd3JpdGUgdG8gRHluYW1vREIgdGFibGU6JywgQ09OVEVOVF9UQUJMRSk7XHJcbiAgICBjb25zb2xlLmxvZygnRHluYW1vREIgaXRlbTonLCBKU09OLnN0cmluZ2lmeShpdGVtLCBudWxsLCAyKSk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBQdXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgICAgIEl0ZW06IGl0ZW0sXHJcbiAgICAgIH0pKTtcclxuICAgICAgY29uc29sZS5sb2coJ0R5bmFtb0RCIHdyaXRlIHN1Y2Nlc3NmdWwnKTtcclxuICAgIH0gY2F0Y2ggKGRiRXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRHluYW1vREIgZXJyb3I6JywgZGJFcnJvcik7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRHluYW1vREIgd3JpdGUgZmFpbGVkOiAke2RiRXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGRiRXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZygnQWJvdXQgdG8gcHVibGlzaCB0byBFdmVudEJyaWRnZTonLCBFVkVOVF9CVVMpO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBQdWJsaXNoIGV2ZW50IGZvciB0ZXh0IHByb2Nlc3NpbmcgY29tcGxldGVkXHJcbiAgICAgIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgICAgIEVudHJpZXM6IFt7XHJcbiAgICAgICAgICBTb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW5wdXQtcHJvY2Vzc29yJyxcclxuICAgICAgICAgIERldGFpbFR5cGU6ICdUZXh0IFByb2Nlc3NpbmcgQ29tcGxldGVkJyxcclxuICAgICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICBpbnB1dElkLFxyXG4gICAgICAgICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxyXG4gICAgICAgICAgICB0cmFuc2NyaXB0aW9uOiBwcm9jZXNzZWRUZXh0LFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgICBFdmVudEJ1c05hbWU6IEVWRU5UX0JVUyxcclxuICAgICAgICB9XSxcclxuICAgICAgfSkpO1xyXG4gICAgICBjb25zb2xlLmxvZygnRXZlbnRCcmlkZ2UgcHVibGlzaCBzdWNjZXNzZnVsJyk7XHJcbiAgICB9IGNhdGNoIChldmVudEVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0V2ZW50QnJpZGdlIGVycm9yOicsIGV2ZW50RXJyb3IpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEV2ZW50QnJpZGdlIHB1Ymxpc2ggZmFpbGVkOiAke2V2ZW50RXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGV2ZW50RXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ31gKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXNwb25zZTogU3VjY2Vzc1Jlc3BvbnNlID0ge1xyXG4gICAgICBtZXNzYWdlOiAnVGV4dCBpbnB1dCBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5JyxcclxuICAgICAgZGF0YToge1xyXG4gICAgICAgIGlucHV0SWQsXHJcbiAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcclxuICAgICAgICB0cmFuc2NyaXB0aW9uOiBwcm9jZXNzZWRUZXh0LFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gaGFuZGxlVGV4dElucHV0OicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLy8gR2V0IGlucHV0IHByb2Nlc3Npbmcgc3RhdHVzXHJcbmFzeW5jIGZ1bmN0aW9uIGdldElucHV0U3RhdHVzKFxyXG4gIGlucHV0SWQ6IHN0cmluZyxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICAvLyBHZXQgcmVjb3JkIGZyb20gRHluYW1vREJcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBHZXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgS2V5OiB7XHJcbiAgICAgICAgaWQ6IHsgUzogaW5wdXRJZCB9LFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGlmICghcmVzdWx0IHx8ICFyZXN1bHQuSXRlbSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgICAgICBtZXNzYWdlOiBgSW5wdXQgd2l0aCBJRCAke2lucHV0SWR9IG5vdCBmb3VuZGAsXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgaW5wdXRSZWNvcmQ6IElucHV0UHJvY2Vzc2luZ1Jlc3VsdCA9IHtcclxuICAgICAgaWQ6IHJlc3VsdC5JdGVtLmlkLlMhLFxyXG4gICAgICB1c2VySWQ6IHJlc3VsdC5JdGVtLnVzZXJJZC5TISxcclxuICAgICAgdHlwZTogcmVzdWx0Lkl0ZW0udHlwZS5TISBhcyAnYXVkaW8nIHwgJ3RleHQnLFxyXG4gICAgICBzdGF0dXM6IHJlc3VsdC5JdGVtLnN0YXR1cy5TISBhcyAncHJvY2Vzc2luZycgfCAnY29tcGxldGVkJyB8ICdmYWlsZWQnLFxyXG4gICAgICBvcmlnaW5hbElucHV0OiByZXN1bHQuSXRlbS5vcmlnaW5hbElucHV0Py5TLFxyXG4gICAgICB0cmFuc2NyaXB0aW9uOiByZXN1bHQuSXRlbS50cmFuc2NyaXB0aW9uPy5TLFxyXG4gICAgICBlcnJvcjogcmVzdWx0Lkl0ZW0uZXJyb3I/LlMsXHJcbiAgICAgIGNyZWF0ZWRBdDogcmVzdWx0Lkl0ZW0uY3JlYXRlZEF0LlMhLFxyXG4gICAgICB1cGRhdGVkQXQ6IHJlc3VsdC5JdGVtLnVwZGF0ZWRBdC5TISxcclxuICAgIH07XHJcblxyXG4gICAgLy8gSWYgYXVkaW8gcHJvY2Vzc2luZyBpcyBzdGlsbCBpbiBwcm9ncmVzcywgY2hlY2sgdHJhbnNjcmlwdGlvbiBqb2Igc3RhdHVzXHJcbiAgICBpZiAoaW5wdXRSZWNvcmQudHlwZSA9PT0gJ2F1ZGlvJyAmJiBpbnB1dFJlY29yZC5zdGF0dXMgPT09ICdwcm9jZXNzaW5nJykge1xyXG4gICAgICBjb25zdCB0cmFuc2NyaXB0aW9uSm9iTmFtZSA9IGB0cmFuc2NyaXB0aW9uLSR7aW5wdXRJZH1gO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHRyYW5zY3JpcHRpb25SZXN1bHQgPSBhd2FpdCB0cmFuc2NyaWJlQ2xpZW50LnNlbmQobmV3IEdldFRyYW5zY3JpcHRpb25Kb2JDb21tYW5kKHtcclxuICAgICAgICAgIFRyYW5zY3JpcHRpb25Kb2JOYW1lOiB0cmFuc2NyaXB0aW9uSm9iTmFtZSxcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIGlmICh0cmFuc2NyaXB0aW9uUmVzdWx0LlRyYW5zY3JpcHRpb25Kb2I/LlRyYW5zY3JpcHRpb25Kb2JTdGF0dXMgPT09ICdDT01QTEVURUQnKSB7XHJcbiAgICAgICAgICAvLyBVcGRhdGUgcmVjb3JkIHdpdGggY29tcGxldGVkIHRyYW5zY3JpcHRpb25cclxuICAgICAgICAgIGF3YWl0IHVwZGF0ZVRyYW5zY3JpcHRpb25SZXN1bHQoaW5wdXRJZCwgdHJhbnNjcmlwdGlvblJlc3VsdC5UcmFuc2NyaXB0aW9uSm9iLlRyYW5zY3JpcHQ/LlRyYW5zY3JpcHRGaWxlVXJpISk7XHJcbiAgICAgICAgICBpbnB1dFJlY29yZC5zdGF0dXMgPSAnY29tcGxldGVkJztcclxuICAgICAgICB9IGVsc2UgaWYgKHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYj8uVHJhbnNjcmlwdGlvbkpvYlN0YXR1cyA9PT0gJ0ZBSUxFRCcpIHtcclxuICAgICAgICAgIC8vIFVwZGF0ZSByZWNvcmQgd2l0aCBmYWlsdXJlXHJcbiAgICAgICAgICBhd2FpdCB1cGRhdGVUcmFuc2NyaXB0aW9uRXJyb3IoaW5wdXRJZCwgdHJhbnNjcmlwdGlvblJlc3VsdC5UcmFuc2NyaXB0aW9uSm9iLkZhaWx1cmVSZWFzb24gfHwgJ1RyYW5zY3JpcHRpb24gZmFpbGVkJyk7XHJcbiAgICAgICAgICBpbnB1dFJlY29yZC5zdGF0dXMgPSAnZmFpbGVkJztcclxuICAgICAgICAgIGlucHV0UmVjb3JkLmVycm9yID0gdHJhbnNjcmlwdGlvblJlc3VsdC5UcmFuc2NyaXB0aW9uSm9iLkZhaWx1cmVSZWFzb24gfHwgJ1RyYW5zY3JpcHRpb24gZmFpbGVkJztcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKHRyYW5zY3JpYmVFcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIHRyYW5zY3JpcHRpb24gc3RhdHVzOicsIHRyYW5zY3JpYmVFcnJvcik7XHJcbiAgICAgICAgLy8gRG9uJ3QgZmFpbCB0aGUgc3RhdHVzIGNoZWNrIGlmIHRyYW5zY3JpcHRpb24gY2hlY2sgZmFpbHNcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlc3BvbnNlOiBTdWNjZXNzUmVzcG9uc2UgPSB7XHJcbiAgICAgIG1lc3NhZ2U6ICdJbnB1dCBzdGF0dXMgcmV0cmlldmVkIHN1Y2Nlc3NmdWxseScsXHJcbiAgICAgIGRhdGE6IGlucHV0UmVjb3JkLFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gZ2V0SW5wdXRTdGF0dXM6JywgZXJyb3IpO1xyXG4gICAgdGhyb3cgZXJyb3I7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBIYW5kbGUgdHJhbnNjcmlwdGlvbiBjYWxsYmFjayAoZm9yIHdlYmhvb2stYmFzZWQgdXBkYXRlcylcclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlVHJhbnNjcmlwdGlvbkNhbGxiYWNrKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoIWV2ZW50LmJvZHkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjYWxsYmFja0RhdGEgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkpO1xyXG4gICAgY29uc29sZS5sb2coJ1RyYW5zY3JpcHRpb24gY2FsbGJhY2sgcmVjZWl2ZWQ6JywgY2FsbGJhY2tEYXRhKTtcclxuXHJcbiAgICAvLyBUaGlzIHdvdWxkIGJlIHVzZWQgaWYgQVdTIFRyYW5zY3JpYmUgc3VwcG9ydGVkIHdlYmhvb2tzXHJcbiAgICAvLyBGb3Igbm93LCB3ZSdsbCB1c2UgcG9sbGluZyBpbiB0aGUgc3RhdHVzIGNoZWNrXHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogJ0NhbGxiYWNrIHJlY2VpdmVkJyB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBoYW5kbGVUcmFuc2NyaXB0aW9uQ2FsbGJhY2s6JywgZXJyb3IpO1xyXG4gICAgdGhyb3cgZXJyb3I7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBVcGRhdGUgdHJhbnNjcmlwdGlvbiByZXN1bHQgaW4gRHluYW1vREJcclxuYXN5bmMgZnVuY3Rpb24gdXBkYXRlVHJhbnNjcmlwdGlvblJlc3VsdChpbnB1dElkOiBzdHJpbmcsIHRyYW5zY3JpcHRGaWxlVXJpOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICB0cnkge1xyXG4gICAgLy8gRG93bmxvYWQgdHJhbnNjcmlwdGlvbiByZXN1bHQgZnJvbSBTM1xyXG4gICAgY29uc3QgdHJhbnNjcmlwdEtleSA9IHRyYW5zY3JpcHRGaWxlVXJpLnNwbGl0KCcvJykuc2xpY2UoMykuam9pbignLycpOyAvLyBSZW1vdmUgczM6Ly9idWNrZXQtbmFtZS9cclxuICAgIGNvbnN0IHRyYW5zY3JpcHRSZXN1bHQgPSBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBHZXRPYmplY3RDb21tYW5kKHtcclxuICAgICAgQnVja2V0OiBBVURJT19CVUNLRVQsXHJcbiAgICAgIEtleTogdHJhbnNjcmlwdEtleSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBjb25zdCB0cmFuc2NyaXB0RGF0YSA9IEpTT04ucGFyc2UoYXdhaXQgdHJhbnNjcmlwdFJlc3VsdC5Cb2R5IS50cmFuc2Zvcm1Ub1N0cmluZygpKTtcclxuICAgIGNvbnN0IHRyYW5zY3JpcHRpb24gPSB0cmFuc2NyaXB0RGF0YS5yZXN1bHRzLnRyYW5zY3JpcHRzWzBdLnRyYW5zY3JpcHQ7XHJcblxyXG4gICAgLy8gVXBkYXRlIER5bmFtb0RCIHJlY29yZFxyXG4gICAgYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgICBLZXk6IHtcclxuICAgICAgICBpZDogeyBTOiBpbnB1dElkIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsIHRyYW5zY3JpcHRpb24gPSA6dHJhbnNjcmlwdGlvbiwgdXBkYXRlZEF0ID0gOnVwZGF0ZWRBdCcsXHJcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczoge1xyXG4gICAgICAgICcjc3RhdHVzJzogJ3N0YXR1cycsXHJcbiAgICAgIH0sXHJcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAnOnN0YXR1cyc6IHsgUzogJ2NvbXBsZXRlZCcgfSxcclxuICAgICAgICAnOnRyYW5zY3JpcHRpb24nOiB7IFM6IHRyYW5zY3JpcHRpb24gfSxcclxuICAgICAgICAnOnVwZGF0ZWRBdCc6IHsgUzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gUHVibGlzaCBldmVudCBmb3IgdHJhbnNjcmlwdGlvbiBjb21wbGV0ZWRcclxuICAgIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgICBFbnRyaWVzOiBbe1xyXG4gICAgICAgIFNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbnB1dC1wcm9jZXNzb3InLFxyXG4gICAgICAgIERldGFpbFR5cGU6ICdBdWRpbyBQcm9jZXNzaW5nIENvbXBsZXRlZCcsXHJcbiAgICAgICAgRGV0YWlsOiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBpbnB1dElkLFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbixcclxuICAgICAgICB9KSxcclxuICAgICAgICBFdmVudEJ1c05hbWU6IEVWRU5UX0JVUyxcclxuICAgICAgfV0sXHJcbiAgICB9KSk7XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciB1cGRhdGluZyB0cmFuc2NyaXB0aW9uIHJlc3VsdDonLCBlcnJvcik7XHJcbiAgICBhd2FpdCB1cGRhdGVUcmFuc2NyaXB0aW9uRXJyb3IoaW5wdXRJZCwgYEZhaWxlZCB0byBwcm9jZXNzIHRyYW5zY3JpcHRpb246ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YCk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBVcGRhdGUgdHJhbnNjcmlwdGlvbiBlcnJvciBpbiBEeW5hbW9EQlxyXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVUcmFuc2NyaXB0aW9uRXJyb3IoaW5wdXRJZDogc3RyaW5nLCBlcnJvck1lc3NhZ2U6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBVcGRhdGVJdGVtQ29tbWFuZCh7XHJcbiAgICBUYWJsZU5hbWU6IENPTlRFTlRfVEFCTEUsXHJcbiAgICBLZXk6IHtcclxuICAgICAgaWQ6IHsgUzogaW5wdXRJZCB9LFxyXG4gICAgfSxcclxuICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsICNlcnJvciA9IDplcnJvciwgdXBkYXRlZEF0ID0gOnVwZGF0ZWRBdCcsXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcclxuICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJyxcclxuICAgICAgJyNlcnJvcic6ICdlcnJvcicsXHJcbiAgICB9LFxyXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAnOnN0YXR1cyc6IHsgUzogJ2ZhaWxlZCcgfSxcclxuICAgICAgJzplcnJvcic6IHsgUzogZXJyb3JNZXNzYWdlIH0sXHJcbiAgICAgICc6dXBkYXRlZEF0JzogeyBTOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSxcclxuICAgIH0sXHJcbiAgfSkpO1xyXG59XHJcblxyXG4vLyBWYWxpZGF0aW9uIGZ1bmN0aW9uc1xyXG5pbnRlcmZhY2UgVmFsaWRhdGlvblJlc3VsdCB7XHJcbiAgaXNWYWxpZDogYm9vbGVhbjtcclxuICBlcnJvcj86IHN0cmluZztcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRhdGVBdWRpb1VwbG9hZFJlcXVlc3QocmVxdWVzdDogQXVkaW9VcGxvYWRSZXF1ZXN0KTogVmFsaWRhdGlvblJlc3VsdCB7XHJcbiAgaWYgKCFyZXF1ZXN0LmF1ZGlvRGF0YSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnQXVkaW8gZGF0YSBpcyByZXF1aXJlZCcgfTtcclxuICB9XHJcblxyXG4gIGlmICghcmVxdWVzdC5jb250ZW50VHlwZSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnQ29udGVudCB0eXBlIGlzIHJlcXVpcmVkJyB9O1xyXG4gIH1cclxuXHJcbiAgaWYgKCFyZXF1ZXN0LnVzZXJJZCkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnVXNlciBJRCBpcyByZXF1aXJlZCcgfTtcclxuICB9XHJcblxyXG4gIC8vIFZhbGlkYXRlIGNvbnRlbnQgdHlwZVxyXG4gIGNvbnN0IHN1cHBvcnRlZFR5cGVzID0gWydhdWRpby93YXYnLCAnYXVkaW8vbXAzJywgJ2F1ZGlvL21wZWcnLCAnYXVkaW8vbXA0JywgJ2F1ZGlvL3dlYm0nXTtcclxuICBpZiAoIXN1cHBvcnRlZFR5cGVzLmluY2x1ZGVzKHJlcXVlc3QuY29udGVudFR5cGUpKSB7XHJcbiAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgZXJyb3I6IGBVbnN1cHBvcnRlZCBjb250ZW50IHR5cGU6ICR7cmVxdWVzdC5jb250ZW50VHlwZX0uIFN1cHBvcnRlZCB0eXBlczogJHtzdXBwb3J0ZWRUeXBlcy5qb2luKCcsICcpfWAgfTtcclxuICB9XHJcblxyXG4gIC8vIFZhbGlkYXRlIGJhc2U2NCBmb3JtYXRcclxuICB0cnkge1xyXG4gICAgQnVmZmVyLmZyb20ocmVxdWVzdC5hdWRpb0RhdGEsICdiYXNlNjQnKTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnSW52YWxpZCBiYXNlNjQgYXVkaW8gZGF0YScgfTtcclxuICB9XHJcblxyXG4gIHJldHVybiB7IGlzVmFsaWQ6IHRydWUgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRhdGVUZXh0SW5wdXRSZXF1ZXN0KHJlcXVlc3Q6IFRleHRJbnB1dFJlcXVlc3QpOiBWYWxpZGF0aW9uUmVzdWx0IHtcclxuICBpZiAoIXJlcXVlc3QudGV4dCkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnVGV4dCBpcyByZXF1aXJlZCcgfTtcclxuICB9XHJcblxyXG4gIGlmICghcmVxdWVzdC51c2VySWQpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1VzZXIgSUQgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICAvLyBWYWxpZGF0ZSB0ZXh0IGxlbmd0aCAoMS0xMDAwMCBjaGFyYWN0ZXJzKVxyXG4gIGlmIChyZXF1ZXN0LnRleHQubGVuZ3RoIDwgMSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnVGV4dCBtdXN0IGJlIGF0IGxlYXN0IDEgY2hhcmFjdGVyIGxvbmcnIH07XHJcbiAgfVxyXG5cclxuICBpZiAocmVxdWVzdC50ZXh0Lmxlbmd0aCA+IDEwMDAwKSB7XHJcbiAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgZXJyb3I6ICdUZXh0IG11c3QgYmUgbm8gbW9yZSB0aGFuIDEwLDAwMCBjaGFyYWN0ZXJzIGxvbmcnIH07XHJcbiAgfVxyXG5cclxuICAvLyBCYXNpYyBjb250ZW50IHZhbGlkYXRpb25cclxuICBjb25zdCB0cmltbWVkVGV4dCA9IHJlcXVlc3QudGV4dC50cmltKCk7XHJcbiAgaWYgKHRyaW1tZWRUZXh0Lmxlbmd0aCA9PT0gMCkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnVGV4dCBjYW5ub3QgYmUgZW1wdHkgb3Igb25seSB3aGl0ZXNwYWNlJyB9O1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHsgaXNWYWxpZDogdHJ1ZSB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiB2YWxpZGF0ZUF1ZGlvUXVhbGl0eShhdWRpb0J1ZmZlcjogQnVmZmVyLCBjb250ZW50VHlwZTogc3RyaW5nKTogVmFsaWRhdGlvblJlc3VsdCB7XHJcbiAgLy8gQmFzaWMgZmlsZSBzaXplIHZhbGlkYXRpb24gKDFLQiB0byAyNU1CKVxyXG4gIGNvbnN0IG1pblNpemUgPSAxMDI0OyAvLyAxS0JcclxuICBjb25zdCBtYXhTaXplID0gMjUgKiAxMDI0ICogMTAyNDsgLy8gMjVNQlxyXG5cclxuICBpZiAoYXVkaW9CdWZmZXIubGVuZ3RoIDwgbWluU2l6ZSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiBgQXVkaW8gZmlsZSB0b28gc21hbGwgKCR7YXVkaW9CdWZmZXIubGVuZ3RofSBieXRlcykuIE1pbmltdW0gc2l6ZTogJHttaW5TaXplfSBieXRlc2AgfTtcclxuICB9XHJcblxyXG4gIGlmIChhdWRpb0J1ZmZlci5sZW5ndGggPiBtYXhTaXplKSB7XHJcbiAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgZXJyb3I6IGBBdWRpbyBmaWxlIHRvbyBsYXJnZSAoJHthdWRpb0J1ZmZlci5sZW5ndGh9IGJ5dGVzKS4gTWF4aW11bSBzaXplOiAke21heFNpemV9IGJ5dGVzYCB9O1xyXG4gIH1cclxuXHJcbiAgLy8gQmFzaWMgZm9ybWF0IHZhbGlkYXRpb24gYmFzZWQgb24gZmlsZSBoZWFkZXJzXHJcbiAgY29uc3QgaXNWYWxpZEZvcm1hdCA9IHZhbGlkYXRlQXVkaW9Gb3JtYXQoYXVkaW9CdWZmZXIsIGNvbnRlbnRUeXBlKTtcclxuICBpZiAoIWlzVmFsaWRGb3JtYXQpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogYEludmFsaWQgYXVkaW8gZm9ybWF0IGZvciBjb250ZW50IHR5cGU6ICR7Y29udGVudFR5cGV9YCB9O1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHsgaXNWYWxpZDogdHJ1ZSB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiB2YWxpZGF0ZUF1ZGlvRm9ybWF0KGF1ZGlvQnVmZmVyOiBCdWZmZXIsIGNvbnRlbnRUeXBlOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAvLyBCYXNpYyBmaWxlIHNpZ25hdHVyZSB2YWxpZGF0aW9uXHJcbiAgY29uc3QgaGVhZGVyID0gYXVkaW9CdWZmZXIuc3ViYXJyYXkoMCwgMTIpO1xyXG5cclxuICBzd2l0Y2ggKGNvbnRlbnRUeXBlKSB7XHJcbiAgICBjYXNlICdhdWRpby93YXYnOlxyXG4gICAgICAvLyBXQVYgZmlsZXMgc3RhcnQgd2l0aCBcIlJJRkZcIiBhbmQgY29udGFpbiBcIldBVkVcIlxyXG4gICAgICByZXR1cm4gaGVhZGVyLnN1YmFycmF5KDAsIDQpLnRvU3RyaW5nKCkgPT09ICdSSUZGJyAmJiBoZWFkZXIuc3ViYXJyYXkoOCwgMTIpLnRvU3RyaW5nKCkgPT09ICdXQVZFJztcclxuICAgIFxyXG4gICAgY2FzZSAnYXVkaW8vbXAzJzpcclxuICAgIGNhc2UgJ2F1ZGlvL21wZWcnOlxyXG4gICAgICAvLyBNUDMgZmlsZXMgc3RhcnQgd2l0aCBJRDMgdGFnIG9yIE1QMyBmcmFtZSBzeW5jXHJcbiAgICAgIHJldHVybiBoZWFkZXJbMF0gPT09IDB4NDkgJiYgaGVhZGVyWzFdID09PSAweDQ0ICYmIGhlYWRlclsyXSA9PT0gMHgzMyB8fCAvLyBJRDNcclxuICAgICAgICAgICAgIGhlYWRlclswXSA9PT0gMHhGRiAmJiAoaGVhZGVyWzFdICYgMHhFMCkgPT09IDB4RTA7IC8vIE1QMyBmcmFtZSBzeW5jXHJcbiAgICBcclxuICAgIGNhc2UgJ2F1ZGlvL21wNCc6XHJcbiAgICAgIC8vIE1QNCBmaWxlcyBjb250YWluIFwiZnR5cFwiIGJveFxyXG4gICAgICByZXR1cm4gaGVhZGVyLnN1YmFycmF5KDQsIDgpLnRvU3RyaW5nKCkgPT09ICdmdHlwJztcclxuICAgIFxyXG4gICAgY2FzZSAnYXVkaW8vd2VibSc6XHJcbiAgICAgIC8vIFdlYk0gZmlsZXMgc3RhcnQgd2l0aCBFQk1MIGhlYWRlclxyXG4gICAgICByZXR1cm4gaGVhZGVyWzBdID09PSAweDFBICYmIGhlYWRlclsxXSA9PT0gMHg0NSAmJiBoZWFkZXJbMl0gPT09IDB4REYgJiYgaGVhZGVyWzNdID09PSAweEEzO1xyXG4gICAgXHJcbiAgICBkZWZhdWx0OlxyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBIZWxwZXIgZnVuY3Rpb25zXHJcbmZ1bmN0aW9uIGdldEZpbGVFeHRlbnNpb24oY29udGVudFR5cGU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgc3dpdGNoIChjb250ZW50VHlwZSkge1xyXG4gICAgY2FzZSAnYXVkaW8vd2F2JzogcmV0dXJuICd3YXYnO1xyXG4gICAgY2FzZSAnYXVkaW8vbXAzJzpcclxuICAgIGNhc2UgJ2F1ZGlvL21wZWcnOiByZXR1cm4gJ21wMyc7XHJcbiAgICBjYXNlICdhdWRpby9tcDQnOiByZXR1cm4gJ21wNCc7XHJcbiAgICBjYXNlICdhdWRpby93ZWJtJzogcmV0dXJuICd3ZWJtJztcclxuICAgIGRlZmF1bHQ6IHJldHVybiAnYXVkaW8nO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0TWVkaWFGb3JtYXQoY29udGVudFR5cGU6IHN0cmluZyk6IE1lZGlhRm9ybWF0IHtcclxuICBzd2l0Y2ggKGNvbnRlbnRUeXBlKSB7XHJcbiAgICBjYXNlICdhdWRpby93YXYnOiByZXR1cm4gTWVkaWFGb3JtYXQuV0FWO1xyXG4gICAgY2FzZSAnYXVkaW8vbXAzJzpcclxuICAgIGNhc2UgJ2F1ZGlvL21wZWcnOiByZXR1cm4gTWVkaWFGb3JtYXQuTVAzO1xyXG4gICAgY2FzZSAnYXVkaW8vbXA0JzogcmV0dXJuIE1lZGlhRm9ybWF0Lk1QNDtcclxuICAgIGNhc2UgJ2F1ZGlvL3dlYm0nOiByZXR1cm4gTWVkaWFGb3JtYXQuV0VCTTtcclxuICAgIGRlZmF1bHQ6IHJldHVybiBNZWRpYUZvcm1hdC5XQVY7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBwcmVwcm9jZXNzVGV4dElucHV0KHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgLy8gQ2xlYW4gYW5kIG5vcm1hbGl6ZSB0ZXh0IGlucHV0XHJcbiAgbGV0IHByb2Nlc3NlZCA9IHRleHQudHJpbSgpO1xyXG4gIFxyXG4gIC8vIFJlbW92ZSBleGNlc3NpdmUgd2hpdGVzcGFjZVxyXG4gIHByb2Nlc3NlZCA9IHByb2Nlc3NlZC5yZXBsYWNlKC9cXHMrL2csICcgJyk7XHJcbiAgXHJcbiAgLy8gTm9ybWFsaXplIGxpbmUgYnJlYWtzXHJcbiAgcHJvY2Vzc2VkID0gcHJvY2Vzc2VkLnJlcGxhY2UoL1xcclxcbi9nLCAnXFxuJykucmVwbGFjZSgvXFxyL2csICdcXG4nKTtcclxuICBcclxuICAvLyBSZW1vdmUgZXhjZXNzaXZlIGxpbmUgYnJlYWtzIChtb3JlIHRoYW4gMiBjb25zZWN1dGl2ZSlcclxuICBwcm9jZXNzZWQgPSBwcm9jZXNzZWQucmVwbGFjZSgvXFxuezMsfS9nLCAnXFxuXFxuJyk7XHJcbiAgXHJcbiAgLy8gQmFzaWMgc2VudGVuY2Ugc3RydWN0dXJlIGltcHJvdmVtZW50c1xyXG4gIHByb2Nlc3NlZCA9IHByb2Nlc3NlZC5yZXBsYWNlKC8oWy4hP10pXFxzKihbYS16XSkvZywgJyQxICQyJyk7XHJcbiAgXHJcbiAgcmV0dXJuIHByb2Nlc3NlZDtcclxufSJdfQ==