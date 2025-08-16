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
        // Route: POST /api/input/audio - Handle audio file upload
        if (method === 'POST' && path === '/api/input/audio') {
            return await handleAudioUpload(event, context, corsHeaders);
        }
        // Route: POST /api/input/text - Handle text input
        if (method === 'POST' && path === '/api/input/text') {
            return await handleTextInput(event, context, corsHeaders);
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
        if (!event.body) {
            throw new Error('Request body is required');
        }
        const request = JSON.parse(event.body);
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
        await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
            TableName: CONTENT_TABLE,
            Item: item,
        }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5wdXQtcHJvY2Vzc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW5wdXQtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLGtEQUFrRjtBQUNsRixrRUFBcUk7QUFDckksOERBQTZHO0FBQzdHLG9FQUFrRjtBQUNsRiwrQkFBb0M7QUFvQ3BDLHlCQUF5QjtBQUN6QixNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBQ2xFLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxvQ0FBZ0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDbEYsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLGlCQUFpQixHQUFHLElBQUksc0NBQWlCLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBRXBGLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWtCLENBQUM7QUFDcEQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBbUIsQ0FBQztBQUN0RCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWUsQ0FBQztBQUV2QyxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQTJCLEVBQzNCLE9BQWdCLEVBQ2dCLEVBQUU7SUFDbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUV0RSwyQkFBMkI7SUFD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SUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO0lBRTVCLDhCQUE4QjtJQUM5QixTQUFTLEdBQUcsU0FBUyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUM7SUFFM0Msd0JBQXdCO0lBQ3hCLFNBQVMsR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDO0lBRWxFLHlEQUF5RDtJQUN6RCxTQUFTLEdBQUcsU0FBUyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFFakQsd0NBQXdDO0lBQ3hDLFNBQVMsR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBRTdELE9BQU8sU0FBUyxDQUFDO0FBQ25CLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IFMzQ2xpZW50LCBQdXRPYmplY3RDb21tYW5kLCBHZXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcclxuaW1wb3J0IHsgVHJhbnNjcmliZUNsaWVudCwgU3RhcnRUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZCwgR2V0VHJhbnNjcmlwdGlvbkpvYkNvbW1hbmQsIE1lZGlhRm9ybWF0IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXRyYW5zY3JpYmUnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCwgUHV0SXRlbUNvbW1hbmQsIFVwZGF0ZUl0ZW1Db21tYW5kLCBHZXRJdGVtQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50LCBQdXRFdmVudHNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJztcclxuaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSAndXVpZCc7XHJcblxyXG5pbnRlcmZhY2UgRXJyb3JSZXNwb25zZSB7XHJcbiAgZXJyb3I6IHN0cmluZztcclxuICBtZXNzYWdlOiBzdHJpbmc7XHJcbiAgcmVxdWVzdElkPzogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgU3VjY2Vzc1Jlc3BvbnNlIHtcclxuICBtZXNzYWdlOiBzdHJpbmc7XHJcbiAgZGF0YT86IGFueTtcclxufVxyXG5cclxuaW50ZXJmYWNlIEF1ZGlvVXBsb2FkUmVxdWVzdCB7XHJcbiAgYXVkaW9EYXRhOiBzdHJpbmc7IC8vIEJhc2U2NCBlbmNvZGVkIGF1ZGlvXHJcbiAgY29udGVudFR5cGU6IHN0cmluZztcclxuICB1c2VySWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFRleHRJbnB1dFJlcXVlc3Qge1xyXG4gIHRleHQ6IHN0cmluZztcclxuICB1c2VySWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIElucHV0UHJvY2Vzc2luZ1Jlc3VsdCB7XHJcbiAgaWQ6IHN0cmluZztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICB0eXBlOiAnYXVkaW8nIHwgJ3RleHQnO1xyXG4gIHN0YXR1czogJ3Byb2Nlc3NpbmcnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJztcclxuICBvcmlnaW5hbElucHV0Pzogc3RyaW5nO1xyXG4gIHRyYW5zY3JpcHRpb24/OiBzdHJpbmc7XHJcbiAgZXJyb3I/OiBzdHJpbmc7XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgdXBkYXRlZEF0OiBzdHJpbmc7XHJcbn1cclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IHRyYW5zY3JpYmVDbGllbnQgPSBuZXcgVHJhbnNjcmliZUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBldmVudEJyaWRnZUNsaWVudCA9IG5ldyBFdmVudEJyaWRnZUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuXHJcbmNvbnN0IEFVRElPX0JVQ0tFVCA9IHByb2Nlc3MuZW52LkFVRElPX0JVQ0tFVF9OQU1FITtcclxuY29uc3QgQ09OVEVOVF9UQUJMRSA9IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSE7XHJcbmNvbnN0IEVWRU5UX0JVUyA9IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FITtcclxuXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XHJcbiAgY29uc29sZS5sb2coJ0lucHV0IFByb2Nlc3NvciBFdmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xyXG5cclxuICAvLyBBbGxvd2VkIG9yaWdpbnMgZm9yIENPUlNcclxuICBjb25zdCBhbGxvd2VkT3JpZ2lucyA9IFtcclxuICAgICdodHRwczovL2tlaXJhbmhvbGxvd2F5LmdpdGh1Yi5pbycsXHJcbiAgICAnaHR0cDovL2xvY2FsaG9zdDozMDAwJyxcclxuICAgICdodHRwOi8vbG9jYWxob3N0OjUxNzMnLFxyXG4gIF07XHJcbiAgXHJcbiAgY29uc3QgcmVxdWVzdE9yaWdpbiA9IGV2ZW50LmhlYWRlcnMub3JpZ2luIHx8IGV2ZW50LmhlYWRlcnMuT3JpZ2luO1xyXG4gIGNvbnN0IGFsbG93ZWRPcmlnaW4gPSBhbGxvd2VkT3JpZ2lucy5pbmNsdWRlcyhyZXF1ZXN0T3JpZ2luIHx8ICcnKSA/IHJlcXVlc3RPcmlnaW4hIDogYWxsb3dlZE9yaWdpbnNbMF07XHJcblxyXG4gIGNvbnN0IGNvcnNIZWFkZXJzID0ge1xyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IGFsbG93ZWRPcmlnaW4sXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsQXV0aG9yaXphdGlvbixYLUFtei1EYXRlLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVJlcXVlc3RlZC1XaXRoJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUycsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiAndHJ1ZScsXHJcbiAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gIH07XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBIYW5kbGUgcHJlZmxpZ2h0IE9QVElPTlMgcmVxdWVzdHNcclxuICAgIGlmIChldmVudC5odHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogJycsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGF0aCA9IGV2ZW50LnBhdGg7XHJcbiAgICBjb25zdCBtZXRob2QgPSBldmVudC5odHRwTWV0aG9kO1xyXG5cclxuICAgIC8vIFJvdXRlOiBQT1NUIC9hcGkvaW5wdXQvYXVkaW8gLSBIYW5kbGUgYXVkaW8gZmlsZSB1cGxvYWRcclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9pbnB1dC9hdWRpbycpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUF1ZGlvVXBsb2FkKGV2ZW50LCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUm91dGU6IFBPU1QgL2FwaS9pbnB1dC90ZXh0IC0gSGFuZGxlIHRleHQgaW5wdXRcclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9pbnB1dC90ZXh0Jykge1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlVGV4dElucHV0KGV2ZW50LCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUm91dGU6IEdFVCAvYXBpL2lucHV0L3N0YXR1cy97aWR9IC0gQ2hlY2sgcHJvY2Vzc2luZyBzdGF0dXNcclxuICAgIGlmIChtZXRob2QgPT09ICdHRVQnICYmIHBhdGguc3RhcnRzV2l0aCgnL2FwaS9pbnB1dC9zdGF0dXMvJykpIHtcclxuICAgICAgY29uc3QgaW5wdXRJZCA9IHBhdGguc3BsaXQoJy8nKS5wb3AoKTtcclxuICAgICAgcmV0dXJuIGF3YWl0IGdldElucHV0U3RhdHVzKGlucHV0SWQhLCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUm91dGU6IFBPU1QgL2FwaS9pbnB1dC90cmFuc2NyaXB0aW9uLWNhbGxiYWNrIC0gSGFuZGxlIFRyYW5zY3JpYmUgY2FsbGJhY2tcclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9pbnB1dC90cmFuc2NyaXB0aW9uLWNhbGxiYWNrJykge1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlVHJhbnNjcmlwdGlvbkNhbGxiYWNrKGV2ZW50LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGVmYXVsdCA0MDQgZm9yIHVubWF0Y2hlZCByb3V0ZXNcclxuICAgIGNvbnN0IGVycm9yUmVzcG9uc2U6IEVycm9yUmVzcG9uc2UgPSB7XHJcbiAgICAgIGVycm9yOiAnTm90IEZvdW5kJyxcclxuICAgICAgbWVzc2FnZTogYFJvdXRlICR7bWV0aG9kfSAke3BhdGh9IG5vdCBmb3VuZGAsXHJcbiAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGVycm9yUmVzcG9uc2UpLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1VuaGFuZGxlZCBlcnJvciBpbiBpbnB1dCBwcm9jZXNzb3I6JywgZXJyb3IpO1xyXG5cclxuICAgIGNvbnN0IGVycm9yUmVzcG9uc2U6IEVycm9yUmVzcG9uc2UgPSB7XHJcbiAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnQW4gdW5leHBlY3RlZCBlcnJvciBvY2N1cnJlZCcsXHJcbiAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGVycm9yUmVzcG9uc2UpLFxyXG4gICAgfTtcclxuICB9XHJcbn07XHJcblxyXG4vLyBBdWRpbyB1cGxvYWQgaGFuZGxlclxyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVBdWRpb1VwbG9hZChcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zb2xlLmxvZygnRW52aXJvbm1lbnQgdmFyaWFibGVzOicsIHtcclxuICAgICAgQ09OVEVOVF9UQUJMRTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgQVVESU9fQlVDS0VUOiBBVURJT19CVUNLRVQsXHJcbiAgICAgIEVWRU5UX0JVUzogRVZFTlRfQlVTXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgaWYgKCFldmVudC5ib2R5KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVxdWVzdDogQXVkaW9VcGxvYWRSZXF1ZXN0ID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgcmVxdWVzdFxyXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IHZhbGlkYXRlQXVkaW9VcGxvYWRSZXF1ZXN0KHJlcXVlc3QpO1xyXG4gICAgaWYgKCF2YWxpZGF0aW9uLmlzVmFsaWQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdWYWxpZGF0aW9uIEVycm9yJyxcclxuICAgICAgICAgIG1lc3NhZ2U6IHZhbGlkYXRpb24uZXJyb3IsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdlbmVyYXRlIHVuaXF1ZSBJRCBmb3IgdGhpcyBpbnB1dFxyXG4gICAgY29uc3QgaW5wdXRJZCA9IHV1aWR2NCgpO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIC8vIERlY29kZSBiYXNlNjQgYXVkaW8gZGF0YVxyXG4gICAgY29uc3QgYXVkaW9CdWZmZXIgPSBCdWZmZXIuZnJvbShyZXF1ZXN0LmF1ZGlvRGF0YSwgJ2Jhc2U2NCcpO1xyXG4gICAgXHJcbiAgICAvLyBWYWxpZGF0ZSBhdWRpbyBxdWFsaXR5XHJcbiAgICBjb25zdCBhdWRpb1ZhbGlkYXRpb24gPSB2YWxpZGF0ZUF1ZGlvUXVhbGl0eShhdWRpb0J1ZmZlciwgcmVxdWVzdC5jb250ZW50VHlwZSk7XHJcbiAgICBpZiAoIWF1ZGlvVmFsaWRhdGlvbi5pc1ZhbGlkKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnQXVkaW8gVmFsaWRhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgICBtZXNzYWdlOiBhdWRpb1ZhbGlkYXRpb24uZXJyb3IsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFVwbG9hZCBhdWRpbyB0byBTM1xyXG4gICAgY29uc3QgYXVkaW9LZXkgPSBgYXVkaW8vJHtyZXF1ZXN0LnVzZXJJZH0vJHtpbnB1dElkfS4ke2dldEZpbGVFeHRlbnNpb24ocmVxdWVzdC5jb250ZW50VHlwZSl9YDtcclxuICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xyXG4gICAgICBCdWNrZXQ6IEFVRElPX0JVQ0tFVCxcclxuICAgICAgS2V5OiBhdWRpb0tleSxcclxuICAgICAgQm9keTogYXVkaW9CdWZmZXIsXHJcbiAgICAgIENvbnRlbnRUeXBlOiByZXF1ZXN0LmNvbnRlbnRUeXBlLFxyXG4gICAgICBNZXRhZGF0YToge1xyXG4gICAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXHJcbiAgICAgICAgaW5wdXRJZDogaW5wdXRJZCxcclxuICAgICAgICB1cGxvYWRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIGluaXRpYWwgcmVjb3JkIGluIER5bmFtb0RCXHJcbiAgICBjb25zdCBpbnB1dFJlY29yZDogSW5wdXRQcm9jZXNzaW5nUmVzdWx0ID0ge1xyXG4gICAgICBpZDogaW5wdXRJZCxcclxuICAgICAgdXNlcklkOiByZXF1ZXN0LnVzZXJJZCxcclxuICAgICAgdHlwZTogJ2F1ZGlvJyxcclxuICAgICAgc3RhdHVzOiAncHJvY2Vzc2luZycsXHJcbiAgICAgIGNyZWF0ZWRBdDogdGltZXN0YW1wLFxyXG4gICAgICB1cGRhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IFB1dEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgICBJdGVtOiB7XHJcbiAgICAgICAgaWQ6IHsgUzogaW5wdXRSZWNvcmQuaWQgfSxcclxuICAgICAgICB1c2VySWQ6IHsgUzogaW5wdXRSZWNvcmQudXNlcklkIH0sXHJcbiAgICAgICAgdHlwZTogeyBTOiBpbnB1dFJlY29yZC50eXBlIH0sXHJcbiAgICAgICAgc3RhdHVzOiB7IFM6IGlucHV0UmVjb3JkLnN0YXR1cyB9LFxyXG4gICAgICAgIGF1ZGlvS2V5OiB7IFM6IGF1ZGlvS2V5IH0sXHJcbiAgICAgICAgY3JlYXRlZEF0OiB7IFM6IGlucHV0UmVjb3JkLmNyZWF0ZWRBdCB9LFxyXG4gICAgICAgIHVwZGF0ZWRBdDogeyBTOiBpbnB1dFJlY29yZC51cGRhdGVkQXQgfSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBTdGFydCB0cmFuc2NyaXB0aW9uIGpvYlxyXG4gICAgY29uc3QgdHJhbnNjcmlwdGlvbkpvYk5hbWUgPSBgdHJhbnNjcmlwdGlvbi0ke2lucHV0SWR9YDtcclxuICAgIGNvbnN0IHMzVXJpID0gYHMzOi8vJHtBVURJT19CVUNLRVR9LyR7YXVkaW9LZXl9YDtcclxuXHJcbiAgICBhd2FpdCB0cmFuc2NyaWJlQ2xpZW50LnNlbmQobmV3IFN0YXJ0VHJhbnNjcmlwdGlvbkpvYkNvbW1hbmQoe1xyXG4gICAgICBUcmFuc2NyaXB0aW9uSm9iTmFtZTogdHJhbnNjcmlwdGlvbkpvYk5hbWUsXHJcbiAgICAgIE1lZGlhOiB7XHJcbiAgICAgICAgTWVkaWFGaWxlVXJpOiBzM1VyaSxcclxuICAgICAgfSxcclxuICAgICAgTWVkaWFGb3JtYXQ6IGdldE1lZGlhRm9ybWF0KHJlcXVlc3QuY29udGVudFR5cGUpLFxyXG4gICAgICBMYW5ndWFnZUNvZGU6ICdlbi1VUycsXHJcbiAgICAgIE91dHB1dEJ1Y2tldE5hbWU6IEFVRElPX0JVQ0tFVCxcclxuICAgICAgT3V0cHV0S2V5OiBgdHJhbnNjcmlwdGlvbnMvJHtpbnB1dElkfS5qc29uYCxcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBQdWJsaXNoIGV2ZW50IGZvciBwcm9jZXNzaW5nIHN0YXJ0ZWRcclxuICAgIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgICBFbnRyaWVzOiBbe1xyXG4gICAgICAgIFNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbnB1dC1wcm9jZXNzb3InLFxyXG4gICAgICAgIERldGFpbFR5cGU6ICdBdWRpbyBQcm9jZXNzaW5nIFN0YXJ0ZWQnLFxyXG4gICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgaW5wdXRJZCxcclxuICAgICAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXHJcbiAgICAgICAgICB0cmFuc2NyaXB0aW9uSm9iTmFtZSxcclxuICAgICAgICAgIGF1ZGlvS2V5LFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIEV2ZW50QnVzTmFtZTogRVZFTlRfQlVTLFxyXG4gICAgICB9XSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBjb25zdCByZXNwb25zZTogU3VjY2Vzc1Jlc3BvbnNlID0ge1xyXG4gICAgICBtZXNzYWdlOiAnQXVkaW8gdXBsb2FkIHN1Y2Nlc3NmdWwsIHByb2Nlc3Npbmcgc3RhcnRlZCcsXHJcbiAgICAgIGRhdGE6IHtcclxuICAgICAgICBpbnB1dElkLFxyXG4gICAgICAgIHN0YXR1czogJ3Byb2Nlc3NpbmcnLFxyXG4gICAgICAgIHRyYW5zY3JpcHRpb25Kb2JOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDIsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gaGFuZGxlQXVkaW9VcGxvYWQ6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vLyBUZXh0IGlucHV0IGhhbmRsZXJcclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlVGV4dElucHV0KFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnNvbGUubG9nKCdUZXh0IGlucHV0IC0gRW52aXJvbm1lbnQgdmFyaWFibGVzOicsIHtcclxuICAgICAgQ09OVEVOVF9UQUJMRTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgRVZFTlRfQlVTOiBFVkVOVF9CVVNcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBpZiAoIWV2ZW50LmJvZHkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXF1ZXN0OiBUZXh0SW5wdXRSZXF1ZXN0ID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgcmVxdWVzdFxyXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IHZhbGlkYXRlVGV4dElucHV0UmVxdWVzdChyZXF1ZXN0KTtcclxuICAgIGlmICghdmFsaWRhdGlvbi5pc1ZhbGlkKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnVmFsaWRhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgICBtZXNzYWdlOiB2YWxpZGF0aW9uLmVycm9yLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZW5lcmF0ZSB1bmlxdWUgSUQgZm9yIHRoaXMgaW5wdXRcclxuICAgIGNvbnN0IGlucHV0SWQgPSB1dWlkdjQoKTtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICAvLyBQcmVwcm9jZXNzIHRleHQgaW5wdXRcclxuICAgIGNvbnN0IHByb2Nlc3NlZFRleHQgPSBwcmVwcm9jZXNzVGV4dElucHV0KHJlcXVlc3QudGV4dCk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIHJlY29yZCBpbiBEeW5hbW9EQlxyXG4gICAgY29uc3QgaW5wdXRSZWNvcmQ6IElucHV0UHJvY2Vzc2luZ1Jlc3VsdCA9IHtcclxuICAgICAgaWQ6IGlucHV0SWQsXHJcbiAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXHJcbiAgICAgIHR5cGU6ICd0ZXh0JyxcclxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcclxuICAgICAgb3JpZ2luYWxJbnB1dDogcmVxdWVzdC50ZXh0LFxyXG4gICAgICB0cmFuc2NyaXB0aW9uOiBwcm9jZXNzZWRUZXh0LFxyXG4gICAgICBjcmVhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgdXBkYXRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGl0ZW06IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XHJcbiAgICAgIGlkOiB7IFM6IGlucHV0UmVjb3JkLmlkIH0sXHJcbiAgICAgIHVzZXJJZDogeyBTOiBpbnB1dFJlY29yZC51c2VySWQgfSxcclxuICAgICAgdHlwZTogeyBTOiBpbnB1dFJlY29yZC50eXBlIH0sXHJcbiAgICAgIHN0YXR1czogeyBTOiBpbnB1dFJlY29yZC5zdGF0dXMgfSxcclxuICAgICAgY3JlYXRlZEF0OiB7IFM6IGlucHV0UmVjb3JkLmNyZWF0ZWRBdCB9LFxyXG4gICAgICB1cGRhdGVkQXQ6IHsgUzogaW5wdXRSZWNvcmQudXBkYXRlZEF0IH0sXHJcbiAgICB9O1xyXG5cclxuICAgIGlmIChpbnB1dFJlY29yZC5vcmlnaW5hbElucHV0KSB7XHJcbiAgICAgIGl0ZW0ub3JpZ2luYWxJbnB1dCA9IHsgUzogaW5wdXRSZWNvcmQub3JpZ2luYWxJbnB1dCB9O1xyXG4gICAgfVxyXG4gICAgaWYgKGlucHV0UmVjb3JkLnRyYW5zY3JpcHRpb24pIHtcclxuICAgICAgaXRlbS50cmFuc2NyaXB0aW9uID0geyBTOiBpbnB1dFJlY29yZC50cmFuc2NyaXB0aW9uIH07XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IFB1dEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgICBJdGVtOiBpdGVtLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFB1Ymxpc2ggZXZlbnQgZm9yIHRleHQgcHJvY2Vzc2luZyBjb21wbGV0ZWRcclxuICAgIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgICBFbnRyaWVzOiBbe1xyXG4gICAgICAgIFNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbnB1dC1wcm9jZXNzb3InLFxyXG4gICAgICAgIERldGFpbFR5cGU6ICdUZXh0IFByb2Nlc3NpbmcgQ29tcGxldGVkJyxcclxuICAgICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGlucHV0SWQsXHJcbiAgICAgICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbjogcHJvY2Vzc2VkVGV4dCxcclxuICAgICAgICB9KSxcclxuICAgICAgICBFdmVudEJ1c05hbWU6IEVWRU5UX0JVUyxcclxuICAgICAgfV0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2U6IFN1Y2Nlc3NSZXNwb25zZSA9IHtcclxuICAgICAgbWVzc2FnZTogJ1RleHQgaW5wdXQgcHJvY2Vzc2VkIHN1Y2Nlc3NmdWxseScsXHJcbiAgICAgIGRhdGE6IHtcclxuICAgICAgICBpbnB1dElkLFxyXG4gICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXHJcbiAgICAgICAgdHJhbnNjcmlwdGlvbjogcHJvY2Vzc2VkVGV4dCxcclxuICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGhhbmRsZVRleHRJbnB1dDonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEdldCBpbnB1dCBwcm9jZXNzaW5nIHN0YXR1c1xyXG5hc3luYyBmdW5jdGlvbiBnZXRJbnB1dFN0YXR1cyhcclxuICBpbnB1dElkOiBzdHJpbmcsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgLy8gR2V0IHJlY29yZCBmcm9tIER5bmFtb0RCXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IENPTlRFTlRfVEFCTEUsXHJcbiAgICAgIEtleToge1xyXG4gICAgICAgIGlkOiB7IFM6IGlucHV0SWQgfSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdCB8fCAhcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdOb3QgRm91bmQnLFxyXG4gICAgICAgICAgbWVzc2FnZTogYElucHV0IHdpdGggSUQgJHtpbnB1dElkfSBub3QgZm91bmRgLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGlucHV0UmVjb3JkOiBJbnB1dFByb2Nlc3NpbmdSZXN1bHQgPSB7XHJcbiAgICAgIGlkOiByZXN1bHQuSXRlbS5pZC5TISxcclxuICAgICAgdXNlcklkOiByZXN1bHQuSXRlbS51c2VySWQuUyEsXHJcbiAgICAgIHR5cGU6IHJlc3VsdC5JdGVtLnR5cGUuUyEgYXMgJ2F1ZGlvJyB8ICd0ZXh0JyxcclxuICAgICAgc3RhdHVzOiByZXN1bHQuSXRlbS5zdGF0dXMuUyEgYXMgJ3Byb2Nlc3NpbmcnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJyxcclxuICAgICAgb3JpZ2luYWxJbnB1dDogcmVzdWx0Lkl0ZW0ub3JpZ2luYWxJbnB1dD8uUyxcclxuICAgICAgdHJhbnNjcmlwdGlvbjogcmVzdWx0Lkl0ZW0udHJhbnNjcmlwdGlvbj8uUyxcclxuICAgICAgZXJyb3I6IHJlc3VsdC5JdGVtLmVycm9yPy5TLFxyXG4gICAgICBjcmVhdGVkQXQ6IHJlc3VsdC5JdGVtLmNyZWF0ZWRBdC5TISxcclxuICAgICAgdXBkYXRlZEF0OiByZXN1bHQuSXRlbS51cGRhdGVkQXQuUyEsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIElmIGF1ZGlvIHByb2Nlc3NpbmcgaXMgc3RpbGwgaW4gcHJvZ3Jlc3MsIGNoZWNrIHRyYW5zY3JpcHRpb24gam9iIHN0YXR1c1xyXG4gICAgaWYgKGlucHV0UmVjb3JkLnR5cGUgPT09ICdhdWRpbycgJiYgaW5wdXRSZWNvcmQuc3RhdHVzID09PSAncHJvY2Vzc2luZycpIHtcclxuICAgICAgY29uc3QgdHJhbnNjcmlwdGlvbkpvYk5hbWUgPSBgdHJhbnNjcmlwdGlvbi0ke2lucHV0SWR9YDtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uUmVzdWx0ID0gYXdhaXQgdHJhbnNjcmliZUNsaWVudC5zZW5kKG5ldyBHZXRUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZCh7XHJcbiAgICAgICAgICBUcmFuc2NyaXB0aW9uSm9iTmFtZTogdHJhbnNjcmlwdGlvbkpvYk5hbWUsXHJcbiAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICBpZiAodHJhbnNjcmlwdGlvblJlc3VsdC5UcmFuc2NyaXB0aW9uSm9iPy5UcmFuc2NyaXB0aW9uSm9iU3RhdHVzID09PSAnQ09NUExFVEVEJykge1xyXG4gICAgICAgICAgLy8gVXBkYXRlIHJlY29yZCB3aXRoIGNvbXBsZXRlZCB0cmFuc2NyaXB0aW9uXHJcbiAgICAgICAgICBhd2FpdCB1cGRhdGVUcmFuc2NyaXB0aW9uUmVzdWx0KGlucHV0SWQsIHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYi5UcmFuc2NyaXB0Py5UcmFuc2NyaXB0RmlsZVVyaSEpO1xyXG4gICAgICAgICAgaW5wdXRSZWNvcmQuc3RhdHVzID0gJ2NvbXBsZXRlZCc7XHJcbiAgICAgICAgfSBlbHNlIGlmICh0cmFuc2NyaXB0aW9uUmVzdWx0LlRyYW5zY3JpcHRpb25Kb2I/LlRyYW5zY3JpcHRpb25Kb2JTdGF0dXMgPT09ICdGQUlMRUQnKSB7XHJcbiAgICAgICAgICAvLyBVcGRhdGUgcmVjb3JkIHdpdGggZmFpbHVyZVxyXG4gICAgICAgICAgYXdhaXQgdXBkYXRlVHJhbnNjcmlwdGlvbkVycm9yKGlucHV0SWQsIHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYi5GYWlsdXJlUmVhc29uIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgaW5wdXRSZWNvcmQuc3RhdHVzID0gJ2ZhaWxlZCc7XHJcbiAgICAgICAgICBpbnB1dFJlY29yZC5lcnJvciA9IHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYi5GYWlsdXJlUmVhc29uIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoICh0cmFuc2NyaWJlRXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyB0cmFuc2NyaXB0aW9uIHN0YXR1czonLCB0cmFuc2NyaWJlRXJyb3IpO1xyXG4gICAgICAgIC8vIERvbid0IGZhaWwgdGhlIHN0YXR1cyBjaGVjayBpZiB0cmFuc2NyaXB0aW9uIGNoZWNrIGZhaWxzXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXNwb25zZTogU3VjY2Vzc1Jlc3BvbnNlID0ge1xyXG4gICAgICBtZXNzYWdlOiAnSW5wdXQgc3RhdHVzIHJldHJpZXZlZCBzdWNjZXNzZnVsbHknLFxyXG4gICAgICBkYXRhOiBpbnB1dFJlY29yZCxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGdldElucHV0U3RhdHVzOicsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufVxyXG5cclxuLy8gSGFuZGxlIHRyYW5zY3JpcHRpb24gY2FsbGJhY2sgKGZvciB3ZWJob29rLWJhc2VkIHVwZGF0ZXMpXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVRyYW5zY3JpcHRpb25DYWxsYmFjayhcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgaWYgKCFldmVudC5ib2R5KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY2FsbGJhY2tEYXRhID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcclxuICAgIGNvbnNvbGUubG9nKCdUcmFuc2NyaXB0aW9uIGNhbGxiYWNrIHJlY2VpdmVkOicsIGNhbGxiYWNrRGF0YSk7XHJcblxyXG4gICAgLy8gVGhpcyB3b3VsZCBiZSB1c2VkIGlmIEFXUyBUcmFuc2NyaWJlIHN1cHBvcnRlZCB3ZWJob29rc1xyXG4gICAgLy8gRm9yIG5vdywgd2UnbGwgdXNlIHBvbGxpbmcgaW4gdGhlIHN0YXR1cyBjaGVja1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6ICdDYWxsYmFjayByZWNlaXZlZCcgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gaGFuZGxlVHJhbnNjcmlwdGlvbkNhbGxiYWNrOicsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVXBkYXRlIHRyYW5zY3JpcHRpb24gcmVzdWx0IGluIER5bmFtb0RCXHJcbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZVRyYW5zY3JpcHRpb25SZXN1bHQoaW5wdXRJZDogc3RyaW5nLCB0cmFuc2NyaXB0RmlsZVVyaTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgdHJ5IHtcclxuICAgIC8vIERvd25sb2FkIHRyYW5zY3JpcHRpb24gcmVzdWx0IGZyb20gUzNcclxuICAgIGNvbnN0IHRyYW5zY3JpcHRLZXkgPSB0cmFuc2NyaXB0RmlsZVVyaS5zcGxpdCgnLycpLnNsaWNlKDMpLmpvaW4oJy8nKTsgLy8gUmVtb3ZlIHMzOi8vYnVja2V0LW5hbWUvXHJcbiAgICBjb25zdCB0cmFuc2NyaXB0UmVzdWx0ID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XHJcbiAgICAgIEJ1Y2tldDogQVVESU9fQlVDS0VULFxyXG4gICAgICBLZXk6IHRyYW5zY3JpcHRLZXksXHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc3QgdHJhbnNjcmlwdERhdGEgPSBKU09OLnBhcnNlKGF3YWl0IHRyYW5zY3JpcHRSZXN1bHQuQm9keSEudHJhbnNmb3JtVG9TdHJpbmcoKSk7XHJcbiAgICBjb25zdCB0cmFuc2NyaXB0aW9uID0gdHJhbnNjcmlwdERhdGEucmVzdWx0cy50cmFuc2NyaXB0c1swXS50cmFuc2NyaXB0O1xyXG5cclxuICAgIC8vIFVwZGF0ZSBEeW5hbW9EQiByZWNvcmRcclxuICAgIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBVcGRhdGVJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgS2V5OiB7XHJcbiAgICAgICAgaWQ6IHsgUzogaW5wdXRJZCB9LFxyXG4gICAgICB9LFxyXG4gICAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUICNzdGF0dXMgPSA6c3RhdHVzLCB0cmFuc2NyaXB0aW9uID0gOnRyYW5zY3JpcHRpb24sIHVwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnLFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcclxuICAgICAgICAnI3N0YXR1cyc6ICdzdGF0dXMnLFxyXG4gICAgICB9LFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgJzpzdGF0dXMnOiB7IFM6ICdjb21wbGV0ZWQnIH0sXHJcbiAgICAgICAgJzp0cmFuc2NyaXB0aW9uJzogeyBTOiB0cmFuc2NyaXB0aW9uIH0sXHJcbiAgICAgICAgJzp1cGRhdGVkQXQnOiB7IFM6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFB1Ymxpc2ggZXZlbnQgZm9yIHRyYW5zY3JpcHRpb24gY29tcGxldGVkXHJcbiAgICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcclxuICAgICAgRW50cmllczogW3tcclxuICAgICAgICBTb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW5wdXQtcHJvY2Vzc29yJyxcclxuICAgICAgICBEZXRhaWxUeXBlOiAnQXVkaW8gUHJvY2Vzc2luZyBDb21wbGV0ZWQnLFxyXG4gICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgaW5wdXRJZCxcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb24sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVMsXHJcbiAgICAgIH1dLFxyXG4gICAgfSkpO1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgdXBkYXRpbmcgdHJhbnNjcmlwdGlvbiByZXN1bHQ6JywgZXJyb3IpO1xyXG4gICAgYXdhaXQgdXBkYXRlVHJhbnNjcmlwdGlvbkVycm9yKGlucHV0SWQsIGBGYWlsZWQgdG8gcHJvY2VzcyB0cmFuc2NyaXB0aW9uOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWApO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVXBkYXRlIHRyYW5zY3JpcHRpb24gZXJyb3IgaW4gRHluYW1vREJcclxuYXN5bmMgZnVuY3Rpb24gdXBkYXRlVHJhbnNjcmlwdGlvbkVycm9yKGlucHV0SWQ6IHN0cmluZywgZXJyb3JNZXNzYWdlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgVXBkYXRlSXRlbUNvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgS2V5OiB7XHJcbiAgICAgIGlkOiB7IFM6IGlucHV0SWQgfSxcclxuICAgIH0sXHJcbiAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUICNzdGF0dXMgPSA6c3RhdHVzLCAjZXJyb3IgPSA6ZXJyb3IsIHVwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnLFxyXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XHJcbiAgICAgICcjc3RhdHVzJzogJ3N0YXR1cycsXHJcbiAgICAgICcjZXJyb3InOiAnZXJyb3InLFxyXG4gICAgfSxcclxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgJzpzdGF0dXMnOiB7IFM6ICdmYWlsZWQnIH0sXHJcbiAgICAgICc6ZXJyb3InOiB7IFM6IGVycm9yTWVzc2FnZSB9LFxyXG4gICAgICAnOnVwZGF0ZWRBdCc6IHsgUzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXHJcbiAgICB9LFxyXG4gIH0pKTtcclxufVxyXG5cclxuLy8gVmFsaWRhdGlvbiBmdW5jdGlvbnNcclxuaW50ZXJmYWNlIFZhbGlkYXRpb25SZXN1bHQge1xyXG4gIGlzVmFsaWQ6IGJvb2xlYW47XHJcbiAgZXJyb3I/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZhbGlkYXRlQXVkaW9VcGxvYWRSZXF1ZXN0KHJlcXVlc3Q6IEF1ZGlvVXBsb2FkUmVxdWVzdCk6IFZhbGlkYXRpb25SZXN1bHQge1xyXG4gIGlmICghcmVxdWVzdC5hdWRpb0RhdGEpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0F1ZGlvIGRhdGEgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICBpZiAoIXJlcXVlc3QuY29udGVudFR5cGUpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0NvbnRlbnQgdHlwZSBpcyByZXF1aXJlZCcgfTtcclxuICB9XHJcblxyXG4gIGlmICghcmVxdWVzdC51c2VySWQpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1VzZXIgSUQgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICAvLyBWYWxpZGF0ZSBjb250ZW50IHR5cGVcclxuICBjb25zdCBzdXBwb3J0ZWRUeXBlcyA9IFsnYXVkaW8vd2F2JywgJ2F1ZGlvL21wMycsICdhdWRpby9tcGVnJywgJ2F1ZGlvL21wNCcsICdhdWRpby93ZWJtJ107XHJcbiAgaWYgKCFzdXBwb3J0ZWRUeXBlcy5pbmNsdWRlcyhyZXF1ZXN0LmNvbnRlbnRUeXBlKSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiBgVW5zdXBwb3J0ZWQgY29udGVudCB0eXBlOiAke3JlcXVlc3QuY29udGVudFR5cGV9LiBTdXBwb3J0ZWQgdHlwZXM6ICR7c3VwcG9ydGVkVHlwZXMuam9pbignLCAnKX1gIH07XHJcbiAgfVxyXG5cclxuICAvLyBWYWxpZGF0ZSBiYXNlNjQgZm9ybWF0XHJcbiAgdHJ5IHtcclxuICAgIEJ1ZmZlci5mcm9tKHJlcXVlc3QuYXVkaW9EYXRhLCAnYmFzZTY0Jyk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0ludmFsaWQgYmFzZTY0IGF1ZGlvIGRhdGEnIH07XHJcbiAgfVxyXG5cclxuICByZXR1cm4geyBpc1ZhbGlkOiB0cnVlIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZhbGlkYXRlVGV4dElucHV0UmVxdWVzdChyZXF1ZXN0OiBUZXh0SW5wdXRSZXF1ZXN0KTogVmFsaWRhdGlvblJlc3VsdCB7XHJcbiAgaWYgKCFyZXF1ZXN0LnRleHQpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1RleHQgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICBpZiAoIXJlcXVlc3QudXNlcklkKSB7XHJcbiAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgZXJyb3I6ICdVc2VyIElEIGlzIHJlcXVpcmVkJyB9O1xyXG4gIH1cclxuXHJcbiAgLy8gVmFsaWRhdGUgdGV4dCBsZW5ndGggKDEtMTAwMDAgY2hhcmFjdGVycylcclxuICBpZiAocmVxdWVzdC50ZXh0Lmxlbmd0aCA8IDEpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1RleHQgbXVzdCBiZSBhdCBsZWFzdCAxIGNoYXJhY3RlciBsb25nJyB9O1xyXG4gIH1cclxuXHJcbiAgaWYgKHJlcXVlc3QudGV4dC5sZW5ndGggPiAxMDAwMCkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnVGV4dCBtdXN0IGJlIG5vIG1vcmUgdGhhbiAxMCwwMDAgY2hhcmFjdGVycyBsb25nJyB9O1xyXG4gIH1cclxuXHJcbiAgLy8gQmFzaWMgY29udGVudCB2YWxpZGF0aW9uXHJcbiAgY29uc3QgdHJpbW1lZFRleHQgPSByZXF1ZXN0LnRleHQudHJpbSgpO1xyXG4gIGlmICh0cmltbWVkVGV4dC5sZW5ndGggPT09IDApIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1RleHQgY2Fubm90IGJlIGVtcHR5IG9yIG9ubHkgd2hpdGVzcGFjZScgfTtcclxuICB9XHJcblxyXG4gIHJldHVybiB7IGlzVmFsaWQ6IHRydWUgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRhdGVBdWRpb1F1YWxpdHkoYXVkaW9CdWZmZXI6IEJ1ZmZlciwgY29udGVudFR5cGU6IHN0cmluZyk6IFZhbGlkYXRpb25SZXN1bHQge1xyXG4gIC8vIEJhc2ljIGZpbGUgc2l6ZSB2YWxpZGF0aW9uICgxS0IgdG8gMjVNQilcclxuICBjb25zdCBtaW5TaXplID0gMTAyNDsgLy8gMUtCXHJcbiAgY29uc3QgbWF4U2l6ZSA9IDI1ICogMTAyNCAqIDEwMjQ7IC8vIDI1TUJcclxuXHJcbiAgaWYgKGF1ZGlvQnVmZmVyLmxlbmd0aCA8IG1pblNpemUpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogYEF1ZGlvIGZpbGUgdG9vIHNtYWxsICgke2F1ZGlvQnVmZmVyLmxlbmd0aH0gYnl0ZXMpLiBNaW5pbXVtIHNpemU6ICR7bWluU2l6ZX0gYnl0ZXNgIH07XHJcbiAgfVxyXG5cclxuICBpZiAoYXVkaW9CdWZmZXIubGVuZ3RoID4gbWF4U2l6ZSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiBgQXVkaW8gZmlsZSB0b28gbGFyZ2UgKCR7YXVkaW9CdWZmZXIubGVuZ3RofSBieXRlcykuIE1heGltdW0gc2l6ZTogJHttYXhTaXplfSBieXRlc2AgfTtcclxuICB9XHJcblxyXG4gIC8vIEJhc2ljIGZvcm1hdCB2YWxpZGF0aW9uIGJhc2VkIG9uIGZpbGUgaGVhZGVyc1xyXG4gIGNvbnN0IGlzVmFsaWRGb3JtYXQgPSB2YWxpZGF0ZUF1ZGlvRm9ybWF0KGF1ZGlvQnVmZmVyLCBjb250ZW50VHlwZSk7XHJcbiAgaWYgKCFpc1ZhbGlkRm9ybWF0KSB7XHJcbiAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgZXJyb3I6IGBJbnZhbGlkIGF1ZGlvIGZvcm1hdCBmb3IgY29udGVudCB0eXBlOiAke2NvbnRlbnRUeXBlfWAgfTtcclxuICB9XHJcblxyXG4gIHJldHVybiB7IGlzVmFsaWQ6IHRydWUgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRhdGVBdWRpb0Zvcm1hdChhdWRpb0J1ZmZlcjogQnVmZmVyLCBjb250ZW50VHlwZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgLy8gQmFzaWMgZmlsZSBzaWduYXR1cmUgdmFsaWRhdGlvblxyXG4gIGNvbnN0IGhlYWRlciA9IGF1ZGlvQnVmZmVyLnN1YmFycmF5KDAsIDEyKTtcclxuXHJcbiAgc3dpdGNoIChjb250ZW50VHlwZSkge1xyXG4gICAgY2FzZSAnYXVkaW8vd2F2JzpcclxuICAgICAgLy8gV0FWIGZpbGVzIHN0YXJ0IHdpdGggXCJSSUZGXCIgYW5kIGNvbnRhaW4gXCJXQVZFXCJcclxuICAgICAgcmV0dXJuIGhlYWRlci5zdWJhcnJheSgwLCA0KS50b1N0cmluZygpID09PSAnUklGRicgJiYgaGVhZGVyLnN1YmFycmF5KDgsIDEyKS50b1N0cmluZygpID09PSAnV0FWRSc7XHJcbiAgICBcclxuICAgIGNhc2UgJ2F1ZGlvL21wMyc6XHJcbiAgICBjYXNlICdhdWRpby9tcGVnJzpcclxuICAgICAgLy8gTVAzIGZpbGVzIHN0YXJ0IHdpdGggSUQzIHRhZyBvciBNUDMgZnJhbWUgc3luY1xyXG4gICAgICByZXR1cm4gaGVhZGVyWzBdID09PSAweDQ5ICYmIGhlYWRlclsxXSA9PT0gMHg0NCAmJiBoZWFkZXJbMl0gPT09IDB4MzMgfHwgLy8gSUQzXHJcbiAgICAgICAgICAgICBoZWFkZXJbMF0gPT09IDB4RkYgJiYgKGhlYWRlclsxXSAmIDB4RTApID09PSAweEUwOyAvLyBNUDMgZnJhbWUgc3luY1xyXG4gICAgXHJcbiAgICBjYXNlICdhdWRpby9tcDQnOlxyXG4gICAgICAvLyBNUDQgZmlsZXMgY29udGFpbiBcImZ0eXBcIiBib3hcclxuICAgICAgcmV0dXJuIGhlYWRlci5zdWJhcnJheSg0LCA4KS50b1N0cmluZygpID09PSAnZnR5cCc7XHJcbiAgICBcclxuICAgIGNhc2UgJ2F1ZGlvL3dlYm0nOlxyXG4gICAgICAvLyBXZWJNIGZpbGVzIHN0YXJ0IHdpdGggRUJNTCBoZWFkZXJcclxuICAgICAgcmV0dXJuIGhlYWRlclswXSA9PT0gMHgxQSAmJiBoZWFkZXJbMV0gPT09IDB4NDUgJiYgaGVhZGVyWzJdID09PSAweERGICYmIGhlYWRlclszXSA9PT0gMHhBMztcclxuICAgIFxyXG4gICAgZGVmYXVsdDpcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxufVxyXG5cclxuLy8gSGVscGVyIGZ1bmN0aW9uc1xyXG5mdW5jdGlvbiBnZXRGaWxlRXh0ZW5zaW9uKGNvbnRlbnRUeXBlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIHN3aXRjaCAoY29udGVudFR5cGUpIHtcclxuICAgIGNhc2UgJ2F1ZGlvL3dhdic6IHJldHVybiAnd2F2JztcclxuICAgIGNhc2UgJ2F1ZGlvL21wMyc6XHJcbiAgICBjYXNlICdhdWRpby9tcGVnJzogcmV0dXJuICdtcDMnO1xyXG4gICAgY2FzZSAnYXVkaW8vbXA0JzogcmV0dXJuICdtcDQnO1xyXG4gICAgY2FzZSAnYXVkaW8vd2VibSc6IHJldHVybiAnd2VibSc7XHJcbiAgICBkZWZhdWx0OiByZXR1cm4gJ2F1ZGlvJztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldE1lZGlhRm9ybWF0KGNvbnRlbnRUeXBlOiBzdHJpbmcpOiBNZWRpYUZvcm1hdCB7XHJcbiAgc3dpdGNoIChjb250ZW50VHlwZSkge1xyXG4gICAgY2FzZSAnYXVkaW8vd2F2JzogcmV0dXJuIE1lZGlhRm9ybWF0LldBVjtcclxuICAgIGNhc2UgJ2F1ZGlvL21wMyc6XHJcbiAgICBjYXNlICdhdWRpby9tcGVnJzogcmV0dXJuIE1lZGlhRm9ybWF0Lk1QMztcclxuICAgIGNhc2UgJ2F1ZGlvL21wNCc6IHJldHVybiBNZWRpYUZvcm1hdC5NUDQ7XHJcbiAgICBjYXNlICdhdWRpby93ZWJtJzogcmV0dXJuIE1lZGlhRm9ybWF0LldFQk07XHJcbiAgICBkZWZhdWx0OiByZXR1cm4gTWVkaWFGb3JtYXQuV0FWO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcHJlcHJvY2Vzc1RleHRJbnB1dCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIC8vIENsZWFuIGFuZCBub3JtYWxpemUgdGV4dCBpbnB1dFxyXG4gIGxldCBwcm9jZXNzZWQgPSB0ZXh0LnRyaW0oKTtcclxuICBcclxuICAvLyBSZW1vdmUgZXhjZXNzaXZlIHdoaXRlc3BhY2VcclxuICBwcm9jZXNzZWQgPSBwcm9jZXNzZWQucmVwbGFjZSgvXFxzKy9nLCAnICcpO1xyXG4gIFxyXG4gIC8vIE5vcm1hbGl6ZSBsaW5lIGJyZWFrc1xyXG4gIHByb2Nlc3NlZCA9IHByb2Nlc3NlZC5yZXBsYWNlKC9cXHJcXG4vZywgJ1xcbicpLnJlcGxhY2UoL1xcci9nLCAnXFxuJyk7XHJcbiAgXHJcbiAgLy8gUmVtb3ZlIGV4Y2Vzc2l2ZSBsaW5lIGJyZWFrcyAobW9yZSB0aGFuIDIgY29uc2VjdXRpdmUpXHJcbiAgcHJvY2Vzc2VkID0gcHJvY2Vzc2VkLnJlcGxhY2UoL1xcbnszLH0vZywgJ1xcblxcbicpO1xyXG4gIFxyXG4gIC8vIEJhc2ljIHNlbnRlbmNlIHN0cnVjdHVyZSBpbXByb3ZlbWVudHNcclxuICBwcm9jZXNzZWQgPSBwcm9jZXNzZWQucmVwbGFjZSgvKFsuIT9dKVxccyooW2Etel0pL2csICckMSAkMicpO1xyXG4gIFxyXG4gIHJldHVybiBwcm9jZXNzZWQ7XHJcbn0iXX0=