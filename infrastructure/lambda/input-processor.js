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
        throw error;
    }
}
// Text input handler
async function handleTextInput(event, context, corsHeaders) {
    try {
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
        throw error;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5wdXQtcHJvY2Vzc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW5wdXQtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLGtEQUFrRjtBQUNsRixrRUFBcUk7QUFDckksOERBQTZHO0FBQzdHLG9FQUFrRjtBQUNsRiwrQkFBb0M7QUFvQ3BDLHlCQUF5QjtBQUN6QixNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBQ2xFLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxvQ0FBZ0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDbEYsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLGlCQUFpQixHQUFHLElBQUksc0NBQWlCLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBRXBGLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWtCLENBQUM7QUFDcEQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBbUIsQ0FBQztBQUN0RCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWUsQ0FBQztBQUV2QyxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQTJCLEVBQzNCLE9BQWdCLEVBQ2dCLEVBQUU7SUFDbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUV0RSwyQkFBMkI7SUFD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LEdBQUcsQ0FBQztRQUMxQyxLQUFLLFdBQVcsQ0FBQyxDQUFDLE9BQU8sK0JBQVcsQ0FBQyxHQUFHLENBQUM7UUFDekMsS0FBSyxZQUFZLENBQUMsQ0FBQyxPQUFPLCtCQUFXLENBQUMsSUFBSSxDQUFDO1FBQzNDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sK0JBQVcsQ0FBQyxHQUFHLENBQUM7S0FDakM7QUFDSCxDQUFDO0FBRUQsU0FBUyxtQkFBbUIsQ0FBQyxJQUFZO0lBQ3ZDLGlDQUFpQztJQUNqQyxJQUFJLFNBQVMsR0FBRyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7SUFFNUIsOEJBQThCO0lBQzlCLFNBQVMsR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsQ0FBQztJQUUzQyx3QkFBd0I7SUFDeEIsU0FBUyxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFFbEUseURBQXlEO0lBQ3pELFNBQVMsR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQztJQUVqRCx3Q0FBd0M7SUFDeEMsU0FBUyxHQUFHLFNBQVMsQ0FBQyxPQUFPLENBQUMsb0JBQW9CLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFFN0QsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgUzNDbGllbnQsIFB1dE9iamVjdENvbW1hbmQsIEdldE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xyXG5pbXBvcnQgeyBUcmFuc2NyaWJlQ2xpZW50LCBTdGFydFRyYW5zY3JpcHRpb25Kb2JDb21tYW5kLCBHZXRUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZCwgTWVkaWFGb3JtYXQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtdHJhbnNjcmliZSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBQdXRJdGVtQ29tbWFuZCwgVXBkYXRlSXRlbUNvbW1hbmQsIEdldEl0ZW1Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRXZlbnRCcmlkZ2VDbGllbnQsIFB1dEV2ZW50c0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZXZlbnRicmlkZ2UnO1xyXG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tICd1dWlkJztcclxuXHJcbmludGVyZmFjZSBFcnJvclJlc3BvbnNlIHtcclxuICBlcnJvcjogc3RyaW5nO1xyXG4gIG1lc3NhZ2U6IHN0cmluZztcclxuICByZXF1ZXN0SWQ/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBTdWNjZXNzUmVzcG9uc2Uge1xyXG4gIG1lc3NhZ2U6IHN0cmluZztcclxuICBkYXRhPzogYW55O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQXVkaW9VcGxvYWRSZXF1ZXN0IHtcclxuICBhdWRpb0RhdGE6IHN0cmluZzsgLy8gQmFzZTY0IGVuY29kZWQgYXVkaW9cclxuICBjb250ZW50VHlwZTogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVGV4dElucHV0UmVxdWVzdCB7XHJcbiAgdGV4dDogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgSW5wdXRQcm9jZXNzaW5nUmVzdWx0IHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIHR5cGU6ICdhdWRpbycgfCAndGV4dCc7XHJcbiAgc3RhdHVzOiAncHJvY2Vzc2luZycgfCAnY29tcGxldGVkJyB8ICdmYWlsZWQnO1xyXG4gIG9yaWdpbmFsSW5wdXQ/OiBzdHJpbmc7XHJcbiAgdHJhbnNjcmlwdGlvbj86IHN0cmluZztcclxuICBlcnJvcj86IHN0cmluZztcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICB1cGRhdGVkQXQ6IHN0cmluZztcclxufVxyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgdHJhbnNjcmliZUNsaWVudCA9IG5ldyBUcmFuc2NyaWJlQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGV2ZW50QnJpZGdlQ2xpZW50ID0gbmV3IEV2ZW50QnJpZGdlQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5cclxuY29uc3QgQVVESU9fQlVDS0VUID0gcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUhO1xyXG5jb25zdCBDT05URU5UX1RBQkxFID0gcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FITtcclxuY29uc3QgRVZFTlRfQlVTID0gcHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUhO1xyXG5cclxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoXHJcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LFxyXG4gIGNvbnRleHQ6IENvbnRleHRcclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcclxuICBjb25zb2xlLmxvZygnSW5wdXQgUHJvY2Vzc29yIEV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XHJcblxyXG4gIC8vIEFsbG93ZWQgb3JpZ2lucyBmb3IgQ09SU1xyXG4gIGNvbnN0IGFsbG93ZWRPcmlnaW5zID0gW1xyXG4gICAgJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJyxcclxuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLFxyXG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycsXHJcbiAgXTtcclxuICBcclxuICBjb25zdCByZXF1ZXN0T3JpZ2luID0gZXZlbnQuaGVhZGVycy5vcmlnaW4gfHwgZXZlbnQuaGVhZGVycy5PcmlnaW47XHJcbiAgY29uc3QgYWxsb3dlZE9yaWdpbiA9IGFsbG93ZWRPcmlnaW5zLmluY2x1ZGVzKHJlcXVlc3RPcmlnaW4gfHwgJycpID8gcmVxdWVzdE9yaWdpbiEgOiBhbGxvd2VkT3JpZ2luc1swXTtcclxuXHJcbiAgY29uc3QgY29yc0hlYWRlcnMgPSB7XHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYWxsb3dlZE9yaWdpbixcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxBdXRob3JpemF0aW9uLFgtQW16LURhdGUsWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtUmVxdWVzdGVkLVdpdGgnLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULFBPU1QsUFVULERFTEVURSxPUFRJT05TJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6ICd0cnVlJyxcclxuICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgfTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIEhhbmRsZSBwcmVmbGlnaHQgT1BUSU9OUyByZXF1ZXN0c1xyXG4gICAgaWYgKGV2ZW50Lmh0dHBNZXRob2QgPT09ICdPUFRJT05TJykge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiAnJyxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwYXRoID0gZXZlbnQucGF0aDtcclxuICAgIGNvbnN0IG1ldGhvZCA9IGV2ZW50Lmh0dHBNZXRob2Q7XHJcblxyXG4gICAgLy8gUm91dGU6IFBPU1QgL2FwaS9pbnB1dC9hdWRpbyAtIEhhbmRsZSBhdWRpbyBmaWxlIHVwbG9hZFxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2lucHV0L2F1ZGlvJykge1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQXVkaW9VcGxvYWQoZXZlbnQsIGNvbnRleHQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSb3V0ZTogUE9TVCAvYXBpL2lucHV0L3RleHQgLSBIYW5kbGUgdGV4dCBpbnB1dFxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2lucHV0L3RleHQnKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVUZXh0SW5wdXQoZXZlbnQsIGNvbnRleHQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSb3V0ZTogR0VUIC9hcGkvaW5wdXQvc3RhdHVzL3tpZH0gLSBDaGVjayBwcm9jZXNzaW5nIHN0YXR1c1xyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aC5zdGFydHNXaXRoKCcvYXBpL2lucHV0L3N0YXR1cy8nKSkge1xyXG4gICAgICBjb25zdCBpbnB1dElkID0gcGF0aC5zcGxpdCgnLycpLnBvcCgpO1xyXG4gICAgICByZXR1cm4gYXdhaXQgZ2V0SW5wdXRTdGF0dXMoaW5wdXRJZCEsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSb3V0ZTogUE9TVCAvYXBpL2lucHV0L3RyYW5zY3JpcHRpb24tY2FsbGJhY2sgLSBIYW5kbGUgVHJhbnNjcmliZSBjYWxsYmFja1xyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2lucHV0L3RyYW5zY3JpcHRpb24tY2FsbGJhY2snKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVUcmFuc2NyaXB0aW9uQ2FsbGJhY2soZXZlbnQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBEZWZhdWx0IDQwNCBmb3IgdW5tYXRjaGVkIHJvdXRlc1xyXG4gICAgY29uc3QgZXJyb3JSZXNwb25zZTogRXJyb3JSZXNwb25zZSA9IHtcclxuICAgICAgZXJyb3I6ICdOb3QgRm91bmQnLFxyXG4gICAgICBtZXNzYWdlOiBgUm91dGUgJHttZXRob2R9ICR7cGF0aH0gbm90IGZvdW5kYCxcclxuICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNDA0LFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZXJyb3JSZXNwb25zZSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignVW5oYW5kbGVkIGVycm9yIGluIGlucHV0IHByb2Nlc3NvcjonLCBlcnJvcik7XHJcblxyXG4gICAgY29uc3QgZXJyb3JSZXNwb25zZTogRXJyb3JSZXNwb25zZSA9IHtcclxuICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdBbiB1bmV4cGVjdGVkIGVycm9yIG9jY3VycmVkJyxcclxuICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZXJyb3JSZXNwb25zZSksXHJcbiAgICB9O1xyXG4gIH1cclxufTtcclxuXHJcbi8vIEF1ZGlvIHVwbG9hZCBoYW5kbGVyXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUF1ZGlvVXBsb2FkKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGlmICghZXZlbnQuYm9keSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlcXVlc3Q6IEF1ZGlvVXBsb2FkUmVxdWVzdCA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XHJcbiAgICBcclxuICAgIC8vIFZhbGlkYXRlIHJlcXVlc3RcclxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSB2YWxpZGF0ZUF1ZGlvVXBsb2FkUmVxdWVzdChyZXF1ZXN0KTtcclxuICAgIGlmICghdmFsaWRhdGlvbi5pc1ZhbGlkKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnVmFsaWRhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgICBtZXNzYWdlOiB2YWxpZGF0aW9uLmVycm9yLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZW5lcmF0ZSB1bmlxdWUgSUQgZm9yIHRoaXMgaW5wdXRcclxuICAgIGNvbnN0IGlucHV0SWQgPSB1dWlkdjQoKTtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICAvLyBEZWNvZGUgYmFzZTY0IGF1ZGlvIGRhdGFcclxuICAgIGNvbnN0IGF1ZGlvQnVmZmVyID0gQnVmZmVyLmZyb20ocmVxdWVzdC5hdWRpb0RhdGEsICdiYXNlNjQnKTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgYXVkaW8gcXVhbGl0eVxyXG4gICAgY29uc3QgYXVkaW9WYWxpZGF0aW9uID0gdmFsaWRhdGVBdWRpb1F1YWxpdHkoYXVkaW9CdWZmZXIsIHJlcXVlc3QuY29udGVudFR5cGUpO1xyXG4gICAgaWYgKCFhdWRpb1ZhbGlkYXRpb24uaXNWYWxpZCkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBlcnJvcjogJ0F1ZGlvIFZhbGlkYXRpb24gRXJyb3InLFxyXG4gICAgICAgICAgbWVzc2FnZTogYXVkaW9WYWxpZGF0aW9uLmVycm9yLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBVcGxvYWQgYXVkaW8gdG8gUzNcclxuICAgIGNvbnN0IGF1ZGlvS2V5ID0gYGF1ZGlvLyR7cmVxdWVzdC51c2VySWR9LyR7aW5wdXRJZH0uJHtnZXRGaWxlRXh0ZW5zaW9uKHJlcXVlc3QuY29udGVudFR5cGUpfWA7XHJcbiAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcclxuICAgICAgQnVja2V0OiBBVURJT19CVUNLRVQsXHJcbiAgICAgIEtleTogYXVkaW9LZXksXHJcbiAgICAgIEJvZHk6IGF1ZGlvQnVmZmVyLFxyXG4gICAgICBDb250ZW50VHlwZTogcmVxdWVzdC5jb250ZW50VHlwZSxcclxuICAgICAgTWV0YWRhdGE6IHtcclxuICAgICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxyXG4gICAgICAgIGlucHV0SWQ6IGlucHV0SWQsXHJcbiAgICAgICAgdXBsb2FkZWRBdDogdGltZXN0YW1wLFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIENyZWF0ZSBpbml0aWFsIHJlY29yZCBpbiBEeW5hbW9EQlxyXG4gICAgY29uc3QgaW5wdXRSZWNvcmQ6IElucHV0UHJvY2Vzc2luZ1Jlc3VsdCA9IHtcclxuICAgICAgaWQ6IGlucHV0SWQsXHJcbiAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXHJcbiAgICAgIHR5cGU6ICdhdWRpbycsXHJcbiAgICAgIHN0YXR1czogJ3Byb2Nlc3NpbmcnLFxyXG4gICAgICBjcmVhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgdXBkYXRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICB9O1xyXG5cclxuICAgIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBQdXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgSXRlbToge1xyXG4gICAgICAgIGlkOiB7IFM6IGlucHV0UmVjb3JkLmlkIH0sXHJcbiAgICAgICAgdXNlcklkOiB7IFM6IGlucHV0UmVjb3JkLnVzZXJJZCB9LFxyXG4gICAgICAgIHR5cGU6IHsgUzogaW5wdXRSZWNvcmQudHlwZSB9LFxyXG4gICAgICAgIHN0YXR1czogeyBTOiBpbnB1dFJlY29yZC5zdGF0dXMgfSxcclxuICAgICAgICBhdWRpb0tleTogeyBTOiBhdWRpb0tleSB9LFxyXG4gICAgICAgIGNyZWF0ZWRBdDogeyBTOiBpbnB1dFJlY29yZC5jcmVhdGVkQXQgfSxcclxuICAgICAgICB1cGRhdGVkQXQ6IHsgUzogaW5wdXRSZWNvcmQudXBkYXRlZEF0IH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gU3RhcnQgdHJhbnNjcmlwdGlvbiBqb2JcclxuICAgIGNvbnN0IHRyYW5zY3JpcHRpb25Kb2JOYW1lID0gYHRyYW5zY3JpcHRpb24tJHtpbnB1dElkfWA7XHJcbiAgICBjb25zdCBzM1VyaSA9IGBzMzovLyR7QVVESU9fQlVDS0VUfS8ke2F1ZGlvS2V5fWA7XHJcblxyXG4gICAgYXdhaXQgdHJhbnNjcmliZUNsaWVudC5zZW5kKG5ldyBTdGFydFRyYW5zY3JpcHRpb25Kb2JDb21tYW5kKHtcclxuICAgICAgVHJhbnNjcmlwdGlvbkpvYk5hbWU6IHRyYW5zY3JpcHRpb25Kb2JOYW1lLFxyXG4gICAgICBNZWRpYToge1xyXG4gICAgICAgIE1lZGlhRmlsZVVyaTogczNVcmksXHJcbiAgICAgIH0sXHJcbiAgICAgIE1lZGlhRm9ybWF0OiBnZXRNZWRpYUZvcm1hdChyZXF1ZXN0LmNvbnRlbnRUeXBlKSxcclxuICAgICAgTGFuZ3VhZ2VDb2RlOiAnZW4tVVMnLFxyXG4gICAgICBPdXRwdXRCdWNrZXROYW1lOiBBVURJT19CVUNLRVQsXHJcbiAgICAgIE91dHB1dEtleTogYHRyYW5zY3JpcHRpb25zLyR7aW5wdXRJZH0uanNvbmAsXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gUHVibGlzaCBldmVudCBmb3IgcHJvY2Vzc2luZyBzdGFydGVkXHJcbiAgICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcclxuICAgICAgRW50cmllczogW3tcclxuICAgICAgICBTb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW5wdXQtcHJvY2Vzc29yJyxcclxuICAgICAgICBEZXRhaWxUeXBlOiAnQXVkaW8gUHJvY2Vzc2luZyBTdGFydGVkJyxcclxuICAgICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGlucHV0SWQsXHJcbiAgICAgICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbkpvYk5hbWUsXHJcbiAgICAgICAgICBhdWRpb0tleSxcclxuICAgICAgICB9KSxcclxuICAgICAgICBFdmVudEJ1c05hbWU6IEVWRU5UX0JVUyxcclxuICAgICAgfV0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2U6IFN1Y2Nlc3NSZXNwb25zZSA9IHtcclxuICAgICAgbWVzc2FnZTogJ0F1ZGlvIHVwbG9hZCBzdWNjZXNzZnVsLCBwcm9jZXNzaW5nIHN0YXJ0ZWQnLFxyXG4gICAgICBkYXRhOiB7XHJcbiAgICAgICAgaW5wdXRJZCxcclxuICAgICAgICBzdGF0dXM6ICdwcm9jZXNzaW5nJyxcclxuICAgICAgICB0cmFuc2NyaXB0aW9uSm9iTmFtZSxcclxuICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAyLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGhhbmRsZUF1ZGlvVXBsb2FkOicsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVGV4dCBpbnB1dCBoYW5kbGVyXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVRleHRJbnB1dChcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoIWV2ZW50LmJvZHkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXF1ZXN0OiBUZXh0SW5wdXRSZXF1ZXN0ID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgcmVxdWVzdFxyXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IHZhbGlkYXRlVGV4dElucHV0UmVxdWVzdChyZXF1ZXN0KTtcclxuICAgIGlmICghdmFsaWRhdGlvbi5pc1ZhbGlkKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnVmFsaWRhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgICBtZXNzYWdlOiB2YWxpZGF0aW9uLmVycm9yLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZW5lcmF0ZSB1bmlxdWUgSUQgZm9yIHRoaXMgaW5wdXRcclxuICAgIGNvbnN0IGlucHV0SWQgPSB1dWlkdjQoKTtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICAvLyBQcmVwcm9jZXNzIHRleHQgaW5wdXRcclxuICAgIGNvbnN0IHByb2Nlc3NlZFRleHQgPSBwcmVwcm9jZXNzVGV4dElucHV0KHJlcXVlc3QudGV4dCk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIHJlY29yZCBpbiBEeW5hbW9EQlxyXG4gICAgY29uc3QgaW5wdXRSZWNvcmQ6IElucHV0UHJvY2Vzc2luZ1Jlc3VsdCA9IHtcclxuICAgICAgaWQ6IGlucHV0SWQsXHJcbiAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXHJcbiAgICAgIHR5cGU6ICd0ZXh0JyxcclxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcclxuICAgICAgb3JpZ2luYWxJbnB1dDogcmVxdWVzdC50ZXh0LFxyXG4gICAgICB0cmFuc2NyaXB0aW9uOiBwcm9jZXNzZWRUZXh0LFxyXG4gICAgICBjcmVhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgdXBkYXRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGl0ZW06IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XHJcbiAgICAgIGlkOiB7IFM6IGlucHV0UmVjb3JkLmlkIH0sXHJcbiAgICAgIHVzZXJJZDogeyBTOiBpbnB1dFJlY29yZC51c2VySWQgfSxcclxuICAgICAgdHlwZTogeyBTOiBpbnB1dFJlY29yZC50eXBlIH0sXHJcbiAgICAgIHN0YXR1czogeyBTOiBpbnB1dFJlY29yZC5zdGF0dXMgfSxcclxuICAgICAgY3JlYXRlZEF0OiB7IFM6IGlucHV0UmVjb3JkLmNyZWF0ZWRBdCB9LFxyXG4gICAgICB1cGRhdGVkQXQ6IHsgUzogaW5wdXRSZWNvcmQudXBkYXRlZEF0IH0sXHJcbiAgICB9O1xyXG5cclxuICAgIGlmIChpbnB1dFJlY29yZC5vcmlnaW5hbElucHV0KSB7XHJcbiAgICAgIGl0ZW0ub3JpZ2luYWxJbnB1dCA9IHsgUzogaW5wdXRSZWNvcmQub3JpZ2luYWxJbnB1dCB9O1xyXG4gICAgfVxyXG4gICAgaWYgKGlucHV0UmVjb3JkLnRyYW5zY3JpcHRpb24pIHtcclxuICAgICAgaXRlbS50cmFuc2NyaXB0aW9uID0geyBTOiBpbnB1dFJlY29yZC50cmFuc2NyaXB0aW9uIH07XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IFB1dEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgICBJdGVtOiBpdGVtLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFB1Ymxpc2ggZXZlbnQgZm9yIHRleHQgcHJvY2Vzc2luZyBjb21wbGV0ZWRcclxuICAgIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgICBFbnRyaWVzOiBbe1xyXG4gICAgICAgIFNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbnB1dC1wcm9jZXNzb3InLFxyXG4gICAgICAgIERldGFpbFR5cGU6ICdUZXh0IFByb2Nlc3NpbmcgQ29tcGxldGVkJyxcclxuICAgICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGlucHV0SWQsXHJcbiAgICAgICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbjogcHJvY2Vzc2VkVGV4dCxcclxuICAgICAgICB9KSxcclxuICAgICAgICBFdmVudEJ1c05hbWU6IEVWRU5UX0JVUyxcclxuICAgICAgfV0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2U6IFN1Y2Nlc3NSZXNwb25zZSA9IHtcclxuICAgICAgbWVzc2FnZTogJ1RleHQgaW5wdXQgcHJvY2Vzc2VkIHN1Y2Nlc3NmdWxseScsXHJcbiAgICAgIGRhdGE6IHtcclxuICAgICAgICBpbnB1dElkLFxyXG4gICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXHJcbiAgICAgICAgdHJhbnNjcmlwdGlvbjogcHJvY2Vzc2VkVGV4dCxcclxuICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGhhbmRsZVRleHRJbnB1dDonLCBlcnJvcik7XHJcbiAgICB0aHJvdyBlcnJvcjtcclxuICB9XHJcbn1cclxuXHJcbi8vIEdldCBpbnB1dCBwcm9jZXNzaW5nIHN0YXR1c1xyXG5hc3luYyBmdW5jdGlvbiBnZXRJbnB1dFN0YXR1cyhcclxuICBpbnB1dElkOiBzdHJpbmcsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgLy8gR2V0IHJlY29yZCBmcm9tIER5bmFtb0RCXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IENPTlRFTlRfVEFCTEUsXHJcbiAgICAgIEtleToge1xyXG4gICAgICAgIGlkOiB7IFM6IGlucHV0SWQgfSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdCB8fCAhcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdOb3QgRm91bmQnLFxyXG4gICAgICAgICAgbWVzc2FnZTogYElucHV0IHdpdGggSUQgJHtpbnB1dElkfSBub3QgZm91bmRgLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGlucHV0UmVjb3JkOiBJbnB1dFByb2Nlc3NpbmdSZXN1bHQgPSB7XHJcbiAgICAgIGlkOiByZXN1bHQuSXRlbS5pZC5TISxcclxuICAgICAgdXNlcklkOiByZXN1bHQuSXRlbS51c2VySWQuUyEsXHJcbiAgICAgIHR5cGU6IHJlc3VsdC5JdGVtLnR5cGUuUyEgYXMgJ2F1ZGlvJyB8ICd0ZXh0JyxcclxuICAgICAgc3RhdHVzOiByZXN1bHQuSXRlbS5zdGF0dXMuUyEgYXMgJ3Byb2Nlc3NpbmcnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJyxcclxuICAgICAgb3JpZ2luYWxJbnB1dDogcmVzdWx0Lkl0ZW0ub3JpZ2luYWxJbnB1dD8uUyxcclxuICAgICAgdHJhbnNjcmlwdGlvbjogcmVzdWx0Lkl0ZW0udHJhbnNjcmlwdGlvbj8uUyxcclxuICAgICAgZXJyb3I6IHJlc3VsdC5JdGVtLmVycm9yPy5TLFxyXG4gICAgICBjcmVhdGVkQXQ6IHJlc3VsdC5JdGVtLmNyZWF0ZWRBdC5TISxcclxuICAgICAgdXBkYXRlZEF0OiByZXN1bHQuSXRlbS51cGRhdGVkQXQuUyEsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIElmIGF1ZGlvIHByb2Nlc3NpbmcgaXMgc3RpbGwgaW4gcHJvZ3Jlc3MsIGNoZWNrIHRyYW5zY3JpcHRpb24gam9iIHN0YXR1c1xyXG4gICAgaWYgKGlucHV0UmVjb3JkLnR5cGUgPT09ICdhdWRpbycgJiYgaW5wdXRSZWNvcmQuc3RhdHVzID09PSAncHJvY2Vzc2luZycpIHtcclxuICAgICAgY29uc3QgdHJhbnNjcmlwdGlvbkpvYk5hbWUgPSBgdHJhbnNjcmlwdGlvbi0ke2lucHV0SWR9YDtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uUmVzdWx0ID0gYXdhaXQgdHJhbnNjcmliZUNsaWVudC5zZW5kKG5ldyBHZXRUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZCh7XHJcbiAgICAgICAgICBUcmFuc2NyaXB0aW9uSm9iTmFtZTogdHJhbnNjcmlwdGlvbkpvYk5hbWUsXHJcbiAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICBpZiAodHJhbnNjcmlwdGlvblJlc3VsdC5UcmFuc2NyaXB0aW9uSm9iPy5UcmFuc2NyaXB0aW9uSm9iU3RhdHVzID09PSAnQ09NUExFVEVEJykge1xyXG4gICAgICAgICAgLy8gVXBkYXRlIHJlY29yZCB3aXRoIGNvbXBsZXRlZCB0cmFuc2NyaXB0aW9uXHJcbiAgICAgICAgICBhd2FpdCB1cGRhdGVUcmFuc2NyaXB0aW9uUmVzdWx0KGlucHV0SWQsIHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYi5UcmFuc2NyaXB0Py5UcmFuc2NyaXB0RmlsZVVyaSEpO1xyXG4gICAgICAgICAgaW5wdXRSZWNvcmQuc3RhdHVzID0gJ2NvbXBsZXRlZCc7XHJcbiAgICAgICAgfSBlbHNlIGlmICh0cmFuc2NyaXB0aW9uUmVzdWx0LlRyYW5zY3JpcHRpb25Kb2I/LlRyYW5zY3JpcHRpb25Kb2JTdGF0dXMgPT09ICdGQUlMRUQnKSB7XHJcbiAgICAgICAgICAvLyBVcGRhdGUgcmVjb3JkIHdpdGggZmFpbHVyZVxyXG4gICAgICAgICAgYXdhaXQgdXBkYXRlVHJhbnNjcmlwdGlvbkVycm9yKGlucHV0SWQsIHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYi5GYWlsdXJlUmVhc29uIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgaW5wdXRSZWNvcmQuc3RhdHVzID0gJ2ZhaWxlZCc7XHJcbiAgICAgICAgICBpbnB1dFJlY29yZC5lcnJvciA9IHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYi5GYWlsdXJlUmVhc29uIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoICh0cmFuc2NyaWJlRXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyB0cmFuc2NyaXB0aW9uIHN0YXR1czonLCB0cmFuc2NyaWJlRXJyb3IpO1xyXG4gICAgICAgIC8vIERvbid0IGZhaWwgdGhlIHN0YXR1cyBjaGVjayBpZiB0cmFuc2NyaXB0aW9uIGNoZWNrIGZhaWxzXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXNwb25zZTogU3VjY2Vzc1Jlc3BvbnNlID0ge1xyXG4gICAgICBtZXNzYWdlOiAnSW5wdXQgc3RhdHVzIHJldHJpZXZlZCBzdWNjZXNzZnVsbHknLFxyXG4gICAgICBkYXRhOiBpbnB1dFJlY29yZCxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGdldElucHV0U3RhdHVzOicsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufVxyXG5cclxuLy8gSGFuZGxlIHRyYW5zY3JpcHRpb24gY2FsbGJhY2sgKGZvciB3ZWJob29rLWJhc2VkIHVwZGF0ZXMpXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVRyYW5zY3JpcHRpb25DYWxsYmFjayhcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgaWYgKCFldmVudC5ib2R5KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY2FsbGJhY2tEYXRhID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcclxuICAgIGNvbnNvbGUubG9nKCdUcmFuc2NyaXB0aW9uIGNhbGxiYWNrIHJlY2VpdmVkOicsIGNhbGxiYWNrRGF0YSk7XHJcblxyXG4gICAgLy8gVGhpcyB3b3VsZCBiZSB1c2VkIGlmIEFXUyBUcmFuc2NyaWJlIHN1cHBvcnRlZCB3ZWJob29rc1xyXG4gICAgLy8gRm9yIG5vdywgd2UnbGwgdXNlIHBvbGxpbmcgaW4gdGhlIHN0YXR1cyBjaGVja1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6ICdDYWxsYmFjayByZWNlaXZlZCcgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gaGFuZGxlVHJhbnNjcmlwdGlvbkNhbGxiYWNrOicsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVXBkYXRlIHRyYW5zY3JpcHRpb24gcmVzdWx0IGluIER5bmFtb0RCXHJcbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZVRyYW5zY3JpcHRpb25SZXN1bHQoaW5wdXRJZDogc3RyaW5nLCB0cmFuc2NyaXB0RmlsZVVyaTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgdHJ5IHtcclxuICAgIC8vIERvd25sb2FkIHRyYW5zY3JpcHRpb24gcmVzdWx0IGZyb20gUzNcclxuICAgIGNvbnN0IHRyYW5zY3JpcHRLZXkgPSB0cmFuc2NyaXB0RmlsZVVyaS5zcGxpdCgnLycpLnNsaWNlKDMpLmpvaW4oJy8nKTsgLy8gUmVtb3ZlIHMzOi8vYnVja2V0LW5hbWUvXHJcbiAgICBjb25zdCB0cmFuc2NyaXB0UmVzdWx0ID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XHJcbiAgICAgIEJ1Y2tldDogQVVESU9fQlVDS0VULFxyXG4gICAgICBLZXk6IHRyYW5zY3JpcHRLZXksXHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc3QgdHJhbnNjcmlwdERhdGEgPSBKU09OLnBhcnNlKGF3YWl0IHRyYW5zY3JpcHRSZXN1bHQuQm9keSEudHJhbnNmb3JtVG9TdHJpbmcoKSk7XHJcbiAgICBjb25zdCB0cmFuc2NyaXB0aW9uID0gdHJhbnNjcmlwdERhdGEucmVzdWx0cy50cmFuc2NyaXB0c1swXS50cmFuc2NyaXB0O1xyXG5cclxuICAgIC8vIFVwZGF0ZSBEeW5hbW9EQiByZWNvcmRcclxuICAgIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBVcGRhdGVJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgS2V5OiB7XHJcbiAgICAgICAgaWQ6IHsgUzogaW5wdXRJZCB9LFxyXG4gICAgICB9LFxyXG4gICAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUICNzdGF0dXMgPSA6c3RhdHVzLCB0cmFuc2NyaXB0aW9uID0gOnRyYW5zY3JpcHRpb24sIHVwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnLFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcclxuICAgICAgICAnI3N0YXR1cyc6ICdzdGF0dXMnLFxyXG4gICAgICB9LFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgJzpzdGF0dXMnOiB7IFM6ICdjb21wbGV0ZWQnIH0sXHJcbiAgICAgICAgJzp0cmFuc2NyaXB0aW9uJzogeyBTOiB0cmFuc2NyaXB0aW9uIH0sXHJcbiAgICAgICAgJzp1cGRhdGVkQXQnOiB7IFM6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFB1Ymxpc2ggZXZlbnQgZm9yIHRyYW5zY3JpcHRpb24gY29tcGxldGVkXHJcbiAgICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcclxuICAgICAgRW50cmllczogW3tcclxuICAgICAgICBTb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW5wdXQtcHJvY2Vzc29yJyxcclxuICAgICAgICBEZXRhaWxUeXBlOiAnQXVkaW8gUHJvY2Vzc2luZyBDb21wbGV0ZWQnLFxyXG4gICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgaW5wdXRJZCxcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb24sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVMsXHJcbiAgICAgIH1dLFxyXG4gICAgfSkpO1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgdXBkYXRpbmcgdHJhbnNjcmlwdGlvbiByZXN1bHQ6JywgZXJyb3IpO1xyXG4gICAgYXdhaXQgdXBkYXRlVHJhbnNjcmlwdGlvbkVycm9yKGlucHV0SWQsIGBGYWlsZWQgdG8gcHJvY2VzcyB0cmFuc2NyaXB0aW9uOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWApO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVXBkYXRlIHRyYW5zY3JpcHRpb24gZXJyb3IgaW4gRHluYW1vREJcclxuYXN5bmMgZnVuY3Rpb24gdXBkYXRlVHJhbnNjcmlwdGlvbkVycm9yKGlucHV0SWQ6IHN0cmluZywgZXJyb3JNZXNzYWdlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgVXBkYXRlSXRlbUNvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgS2V5OiB7XHJcbiAgICAgIGlkOiB7IFM6IGlucHV0SWQgfSxcclxuICAgIH0sXHJcbiAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUICNzdGF0dXMgPSA6c3RhdHVzLCAjZXJyb3IgPSA6ZXJyb3IsIHVwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnLFxyXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XHJcbiAgICAgICcjc3RhdHVzJzogJ3N0YXR1cycsXHJcbiAgICAgICcjZXJyb3InOiAnZXJyb3InLFxyXG4gICAgfSxcclxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgJzpzdGF0dXMnOiB7IFM6ICdmYWlsZWQnIH0sXHJcbiAgICAgICc6ZXJyb3InOiB7IFM6IGVycm9yTWVzc2FnZSB9LFxyXG4gICAgICAnOnVwZGF0ZWRBdCc6IHsgUzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXHJcbiAgICB9LFxyXG4gIH0pKTtcclxufVxyXG5cclxuLy8gVmFsaWRhdGlvbiBmdW5jdGlvbnNcclxuaW50ZXJmYWNlIFZhbGlkYXRpb25SZXN1bHQge1xyXG4gIGlzVmFsaWQ6IGJvb2xlYW47XHJcbiAgZXJyb3I/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZhbGlkYXRlQXVkaW9VcGxvYWRSZXF1ZXN0KHJlcXVlc3Q6IEF1ZGlvVXBsb2FkUmVxdWVzdCk6IFZhbGlkYXRpb25SZXN1bHQge1xyXG4gIGlmICghcmVxdWVzdC5hdWRpb0RhdGEpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0F1ZGlvIGRhdGEgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICBpZiAoIXJlcXVlc3QuY29udGVudFR5cGUpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0NvbnRlbnQgdHlwZSBpcyByZXF1aXJlZCcgfTtcclxuICB9XHJcblxyXG4gIGlmICghcmVxdWVzdC51c2VySWQpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1VzZXIgSUQgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICAvLyBWYWxpZGF0ZSBjb250ZW50IHR5cGVcclxuICBjb25zdCBzdXBwb3J0ZWRUeXBlcyA9IFsnYXVkaW8vd2F2JywgJ2F1ZGlvL21wMycsICdhdWRpby9tcGVnJywgJ2F1ZGlvL21wNCcsICdhdWRpby93ZWJtJ107XHJcbiAgaWYgKCFzdXBwb3J0ZWRUeXBlcy5pbmNsdWRlcyhyZXF1ZXN0LmNvbnRlbnRUeXBlKSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiBgVW5zdXBwb3J0ZWQgY29udGVudCB0eXBlOiAke3JlcXVlc3QuY29udGVudFR5cGV9LiBTdXBwb3J0ZWQgdHlwZXM6ICR7c3VwcG9ydGVkVHlwZXMuam9pbignLCAnKX1gIH07XHJcbiAgfVxyXG5cclxuICAvLyBWYWxpZGF0ZSBiYXNlNjQgZm9ybWF0XHJcbiAgdHJ5IHtcclxuICAgIEJ1ZmZlci5mcm9tKHJlcXVlc3QuYXVkaW9EYXRhLCAnYmFzZTY0Jyk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0ludmFsaWQgYmFzZTY0IGF1ZGlvIGRhdGEnIH07XHJcbiAgfVxyXG5cclxuICByZXR1cm4geyBpc1ZhbGlkOiB0cnVlIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZhbGlkYXRlVGV4dElucHV0UmVxdWVzdChyZXF1ZXN0OiBUZXh0SW5wdXRSZXF1ZXN0KTogVmFsaWRhdGlvblJlc3VsdCB7XHJcbiAgaWYgKCFyZXF1ZXN0LnRleHQpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1RleHQgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICBpZiAoIXJlcXVlc3QudXNlcklkKSB7XHJcbiAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgZXJyb3I6ICdVc2VyIElEIGlzIHJlcXVpcmVkJyB9O1xyXG4gIH1cclxuXHJcbiAgLy8gVmFsaWRhdGUgdGV4dCBsZW5ndGggKDEtMTAwMDAgY2hhcmFjdGVycylcclxuICBpZiAocmVxdWVzdC50ZXh0Lmxlbmd0aCA8IDEpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1RleHQgbXVzdCBiZSBhdCBsZWFzdCAxIGNoYXJhY3RlciBsb25nJyB9O1xyXG4gIH1cclxuXHJcbiAgaWYgKHJlcXVlc3QudGV4dC5sZW5ndGggPiAxMDAwMCkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnVGV4dCBtdXN0IGJlIG5vIG1vcmUgdGhhbiAxMCwwMDAgY2hhcmFjdGVycyBsb25nJyB9O1xyXG4gIH1cclxuXHJcbiAgLy8gQmFzaWMgY29udGVudCB2YWxpZGF0aW9uXHJcbiAgY29uc3QgdHJpbW1lZFRleHQgPSByZXF1ZXN0LnRleHQudHJpbSgpO1xyXG4gIGlmICh0cmltbWVkVGV4dC5sZW5ndGggPT09IDApIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1RleHQgY2Fubm90IGJlIGVtcHR5IG9yIG9ubHkgd2hpdGVzcGFjZScgfTtcclxuICB9XHJcblxyXG4gIHJldHVybiB7IGlzVmFsaWQ6IHRydWUgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRhdGVBdWRpb1F1YWxpdHkoYXVkaW9CdWZmZXI6IEJ1ZmZlciwgY29udGVudFR5cGU6IHN0cmluZyk6IFZhbGlkYXRpb25SZXN1bHQge1xyXG4gIC8vIEJhc2ljIGZpbGUgc2l6ZSB2YWxpZGF0aW9uICgxS0IgdG8gMjVNQilcclxuICBjb25zdCBtaW5TaXplID0gMTAyNDsgLy8gMUtCXHJcbiAgY29uc3QgbWF4U2l6ZSA9IDI1ICogMTAyNCAqIDEwMjQ7IC8vIDI1TUJcclxuXHJcbiAgaWYgKGF1ZGlvQnVmZmVyLmxlbmd0aCA8IG1pblNpemUpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogYEF1ZGlvIGZpbGUgdG9vIHNtYWxsICgke2F1ZGlvQnVmZmVyLmxlbmd0aH0gYnl0ZXMpLiBNaW5pbXVtIHNpemU6ICR7bWluU2l6ZX0gYnl0ZXNgIH07XHJcbiAgfVxyXG5cclxuICBpZiAoYXVkaW9CdWZmZXIubGVuZ3RoID4gbWF4U2l6ZSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiBgQXVkaW8gZmlsZSB0b28gbGFyZ2UgKCR7YXVkaW9CdWZmZXIubGVuZ3RofSBieXRlcykuIE1heGltdW0gc2l6ZTogJHttYXhTaXplfSBieXRlc2AgfTtcclxuICB9XHJcblxyXG4gIC8vIEJhc2ljIGZvcm1hdCB2YWxpZGF0aW9uIGJhc2VkIG9uIGZpbGUgaGVhZGVyc1xyXG4gIGNvbnN0IGlzVmFsaWRGb3JtYXQgPSB2YWxpZGF0ZUF1ZGlvRm9ybWF0KGF1ZGlvQnVmZmVyLCBjb250ZW50VHlwZSk7XHJcbiAgaWYgKCFpc1ZhbGlkRm9ybWF0KSB7XHJcbiAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgZXJyb3I6IGBJbnZhbGlkIGF1ZGlvIGZvcm1hdCBmb3IgY29udGVudCB0eXBlOiAke2NvbnRlbnRUeXBlfWAgfTtcclxuICB9XHJcblxyXG4gIHJldHVybiB7IGlzVmFsaWQ6IHRydWUgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRhdGVBdWRpb0Zvcm1hdChhdWRpb0J1ZmZlcjogQnVmZmVyLCBjb250ZW50VHlwZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgLy8gQmFzaWMgZmlsZSBzaWduYXR1cmUgdmFsaWRhdGlvblxyXG4gIGNvbnN0IGhlYWRlciA9IGF1ZGlvQnVmZmVyLnN1YmFycmF5KDAsIDEyKTtcclxuXHJcbiAgc3dpdGNoIChjb250ZW50VHlwZSkge1xyXG4gICAgY2FzZSAnYXVkaW8vd2F2JzpcclxuICAgICAgLy8gV0FWIGZpbGVzIHN0YXJ0IHdpdGggXCJSSUZGXCIgYW5kIGNvbnRhaW4gXCJXQVZFXCJcclxuICAgICAgcmV0dXJuIGhlYWRlci5zdWJhcnJheSgwLCA0KS50b1N0cmluZygpID09PSAnUklGRicgJiYgaGVhZGVyLnN1YmFycmF5KDgsIDEyKS50b1N0cmluZygpID09PSAnV0FWRSc7XHJcbiAgICBcclxuICAgIGNhc2UgJ2F1ZGlvL21wMyc6XHJcbiAgICBjYXNlICdhdWRpby9tcGVnJzpcclxuICAgICAgLy8gTVAzIGZpbGVzIHN0YXJ0IHdpdGggSUQzIHRhZyBvciBNUDMgZnJhbWUgc3luY1xyXG4gICAgICByZXR1cm4gaGVhZGVyWzBdID09PSAweDQ5ICYmIGhlYWRlclsxXSA9PT0gMHg0NCAmJiBoZWFkZXJbMl0gPT09IDB4MzMgfHwgLy8gSUQzXHJcbiAgICAgICAgICAgICBoZWFkZXJbMF0gPT09IDB4RkYgJiYgKGhlYWRlclsxXSAmIDB4RTApID09PSAweEUwOyAvLyBNUDMgZnJhbWUgc3luY1xyXG4gICAgXHJcbiAgICBjYXNlICdhdWRpby9tcDQnOlxyXG4gICAgICAvLyBNUDQgZmlsZXMgY29udGFpbiBcImZ0eXBcIiBib3hcclxuICAgICAgcmV0dXJuIGhlYWRlci5zdWJhcnJheSg0LCA4KS50b1N0cmluZygpID09PSAnZnR5cCc7XHJcbiAgICBcclxuICAgIGNhc2UgJ2F1ZGlvL3dlYm0nOlxyXG4gICAgICAvLyBXZWJNIGZpbGVzIHN0YXJ0IHdpdGggRUJNTCBoZWFkZXJcclxuICAgICAgcmV0dXJuIGhlYWRlclswXSA9PT0gMHgxQSAmJiBoZWFkZXJbMV0gPT09IDB4NDUgJiYgaGVhZGVyWzJdID09PSAweERGICYmIGhlYWRlclszXSA9PT0gMHhBMztcclxuICAgIFxyXG4gICAgZGVmYXVsdDpcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxufVxyXG5cclxuLy8gSGVscGVyIGZ1bmN0aW9uc1xyXG5mdW5jdGlvbiBnZXRGaWxlRXh0ZW5zaW9uKGNvbnRlbnRUeXBlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIHN3aXRjaCAoY29udGVudFR5cGUpIHtcclxuICAgIGNhc2UgJ2F1ZGlvL3dhdic6IHJldHVybiAnd2F2JztcclxuICAgIGNhc2UgJ2F1ZGlvL21wMyc6XHJcbiAgICBjYXNlICdhdWRpby9tcGVnJzogcmV0dXJuICdtcDMnO1xyXG4gICAgY2FzZSAnYXVkaW8vbXA0JzogcmV0dXJuICdtcDQnO1xyXG4gICAgY2FzZSAnYXVkaW8vd2VibSc6IHJldHVybiAnd2VibSc7XHJcbiAgICBkZWZhdWx0OiByZXR1cm4gJ2F1ZGlvJztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldE1lZGlhRm9ybWF0KGNvbnRlbnRUeXBlOiBzdHJpbmcpOiBNZWRpYUZvcm1hdCB7XHJcbiAgc3dpdGNoIChjb250ZW50VHlwZSkge1xyXG4gICAgY2FzZSAnYXVkaW8vd2F2JzogcmV0dXJuIE1lZGlhRm9ybWF0LldBVjtcclxuICAgIGNhc2UgJ2F1ZGlvL21wMyc6XHJcbiAgICBjYXNlICdhdWRpby9tcGVnJzogcmV0dXJuIE1lZGlhRm9ybWF0Lk1QMztcclxuICAgIGNhc2UgJ2F1ZGlvL21wNCc6IHJldHVybiBNZWRpYUZvcm1hdC5NUDQ7XHJcbiAgICBjYXNlICdhdWRpby93ZWJtJzogcmV0dXJuIE1lZGlhRm9ybWF0LldFQk07XHJcbiAgICBkZWZhdWx0OiByZXR1cm4gTWVkaWFGb3JtYXQuV0FWO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcHJlcHJvY2Vzc1RleHRJbnB1dCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIC8vIENsZWFuIGFuZCBub3JtYWxpemUgdGV4dCBpbnB1dFxyXG4gIGxldCBwcm9jZXNzZWQgPSB0ZXh0LnRyaW0oKTtcclxuICBcclxuICAvLyBSZW1vdmUgZXhjZXNzaXZlIHdoaXRlc3BhY2VcclxuICBwcm9jZXNzZWQgPSBwcm9jZXNzZWQucmVwbGFjZSgvXFxzKy9nLCAnICcpO1xyXG4gIFxyXG4gIC8vIE5vcm1hbGl6ZSBsaW5lIGJyZWFrc1xyXG4gIHByb2Nlc3NlZCA9IHByb2Nlc3NlZC5yZXBsYWNlKC9cXHJcXG4vZywgJ1xcbicpLnJlcGxhY2UoL1xcci9nLCAnXFxuJyk7XHJcbiAgXHJcbiAgLy8gUmVtb3ZlIGV4Y2Vzc2l2ZSBsaW5lIGJyZWFrcyAobW9yZSB0aGFuIDIgY29uc2VjdXRpdmUpXHJcbiAgcHJvY2Vzc2VkID0gcHJvY2Vzc2VkLnJlcGxhY2UoL1xcbnszLH0vZywgJ1xcblxcbicpO1xyXG4gIFxyXG4gIC8vIEJhc2ljIHNlbnRlbmNlIHN0cnVjdHVyZSBpbXByb3ZlbWVudHNcclxuICBwcm9jZXNzZWQgPSBwcm9jZXNzZWQucmVwbGFjZSgvKFsuIT9dKVxccyooW2Etel0pL2csICckMSAkMicpO1xyXG4gIFxyXG4gIHJldHVybiBwcm9jZXNzZWQ7XHJcbn0iXX0=