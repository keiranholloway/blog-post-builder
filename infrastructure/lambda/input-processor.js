"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_transcribe_1 = require("@aws-sdk/client-transcribe");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const uuid_1 = require("uuid");
const error_handler_1 = require("./utils/error-handler");
// Initialize AWS clients with retry configuration
const s3Client = new client_s3_1.S3Client({
    region: process.env.AWS_REGION,
    maxAttempts: 3,
});
const transcribeClient = new client_transcribe_1.TranscribeClient({
    region: process.env.AWS_REGION,
    maxAttempts: 3,
});
const dynamoClient = new client_dynamodb_1.DynamoDBClient({
    region: process.env.AWS_REGION,
    maxAttempts: 3,
});
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({
    region: process.env.AWS_REGION,
    maxAttempts: 3,
});
// Initialize error handler
const errorHandler = new error_handler_1.ErrorHandler();
const AUDIO_BUCKET = process.env.AUDIO_BUCKET_NAME;
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME;
const EVENT_BUS = process.env.EVENT_BUS_NAME;
// Validation schemas
const audioUploadSchema = {
    audioData: { required: true, type: 'string', minLength: 100 },
    contentType: { required: true, type: 'string', pattern: /^audio\// },
    userId: { required: true, type: 'string', minLength: 1 },
};
const textInputSchema = {
    text: { required: true, type: 'string', minLength: 10, maxLength: 10000 },
    userId: { required: true, type: 'string', minLength: 1 },
};
// Helper function to determine HTTP status code from error
function getStatusCodeForError(error) {
    if (error instanceof error_handler_1.ValidationError)
        return 400;
    if (error.name.includes('NotFound'))
        return 404;
    if (error.name.includes('Unauthorized'))
        return 401;
    if (error.name.includes('Forbidden'))
        return 403;
    if (error.name.includes('Throttling'))
        return 429;
    if (error.name.includes('Timeout'))
        return 408;
    return 500;
}
const handler = async (event, context) => {
    const errorContext = {
        functionName: context.functionName,
        requestId: context.awsRequestId,
        operation: `${event.httpMethod} ${event.path}`,
    };
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
        const err = error;
        await errorHandler.handleError(err, errorContext);
        const errorResponse = errorHandler.createUserFriendlyResponse(err, errorContext);
        return {
            statusCode: getStatusCodeForError(err),
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
        // Validate request using error handler
        errorHandler.validateInput(request, audioUploadSchema);
        // Additional audio-specific validation
        const validation = validateAudioUploadRequest(request);
        if (!validation.isValid) {
            throw new error_handler_1.ValidationError(validation.error || 'Audio validation failed');
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
        // Validate request using error handler
        errorHandler.validateInput(request, textInputSchema);
        // Additional text-specific validation
        const validation = validateTextInputRequest(request);
        if (!validation.isValid) {
            throw new error_handler_1.ValidationError(validation.error || 'Text validation failed');
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5wdXQtcHJvY2Vzc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW5wdXQtcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLGtEQUFrRjtBQUNsRixrRUFBcUk7QUFDckksOERBQTZHO0FBQzdHLG9FQUFrRjtBQUNsRiwrQkFBb0M7QUFDcEMseURBQThHO0FBc0M5RyxrREFBa0Q7QUFDbEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQkFBUSxDQUFDO0lBQzVCLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVU7SUFDOUIsV0FBVyxFQUFFLENBQUM7Q0FDZixDQUFDLENBQUM7QUFDSCxNQUFNLGdCQUFnQixHQUFHLElBQUksb0NBQWdCLENBQUM7SUFDNUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVTtJQUM5QixXQUFXLEVBQUUsQ0FBQztDQUNmLENBQUMsQ0FBQztBQUNILE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQztJQUN0QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVO0lBQzlCLFdBQVcsRUFBRSxDQUFDO0NBQ2YsQ0FBQyxDQUFDO0FBQ0gsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLHNDQUFpQixDQUFDO0lBQzlDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVU7SUFDOUIsV0FBVyxFQUFFLENBQUM7Q0FDZixDQUFDLENBQUM7QUFFSCwyQkFBMkI7QUFDM0IsTUFBTSxZQUFZLEdBQUcsSUFBSSw0QkFBWSxFQUFFLENBQUM7QUFFeEMsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBa0IsQ0FBQztBQUNwRCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFtQixDQUFDO0FBQ3RELE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBZSxDQUFDO0FBRTlDLHFCQUFxQjtBQUNyQixNQUFN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QUM7QUFDbkIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgUzNDbGllbnQsIFB1dE9iamVjdENvbW1hbmQsIEdldE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xyXG5pbXBvcnQgeyBUcmFuc2NyaWJlQ2xpZW50LCBTdGFydFRyYW5zY3JpcHRpb25Kb2JDb21tYW5kLCBHZXRUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZCwgTWVkaWFGb3JtYXQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtdHJhbnNjcmliZSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBQdXRJdGVtQ29tbWFuZCwgVXBkYXRlSXRlbUNvbW1hbmQsIEdldEl0ZW1Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRXZlbnRCcmlkZ2VDbGllbnQsIFB1dEV2ZW50c0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZXZlbnRicmlkZ2UnO1xyXG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tICd1dWlkJztcclxuaW1wb3J0IHsgRXJyb3JIYW5kbGVyLCBERUZBVUxUX1JFVFJZX0NPTkZJRywgVmFsaWRhdGlvbkVycm9yLCBWYWxpZGF0aW9uU2NoZW1hIH0gZnJvbSAnLi91dGlscy9lcnJvci1oYW5kbGVyJztcclxuXHJcbmludGVyZmFjZSBFcnJvclJlc3BvbnNlIHtcclxuICBlcnJvcjogc3RyaW5nO1xyXG4gIG1lc3NhZ2U6IHN0cmluZztcclxuICByZXF1ZXN0SWQ/OiBzdHJpbmc7XHJcbiAgcmV0cnlhYmxlPzogYm9vbGVhbjtcclxuICBzdWdnZXN0ZWRBY3Rpb24/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBTdWNjZXNzUmVzcG9uc2Uge1xyXG4gIG1lc3NhZ2U6IHN0cmluZztcclxuICBkYXRhPzogYW55O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQXVkaW9VcGxvYWRSZXF1ZXN0IHtcclxuICBhdWRpb0RhdGE6IHN0cmluZzsgLy8gQmFzZTY0IGVuY29kZWQgYXVkaW9cclxuICBjb250ZW50VHlwZTogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVGV4dElucHV0UmVxdWVzdCB7XHJcbiAgdGV4dDogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgSW5wdXRQcm9jZXNzaW5nUmVzdWx0IHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIHR5cGU6ICdhdWRpbycgfCAndGV4dCc7XHJcbiAgc3RhdHVzOiAncHJvY2Vzc2luZycgfCAnY29tcGxldGVkJyB8ICdmYWlsZWQnO1xyXG4gIG9yaWdpbmFsSW5wdXQ/OiBzdHJpbmc7XHJcbiAgdHJhbnNjcmlwdGlvbj86IHN0cmluZztcclxuICBlcnJvcj86IHN0cmluZztcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICB1cGRhdGVkQXQ6IHN0cmluZztcclxufVxyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50cyB3aXRoIHJldHJ5IGNvbmZpZ3VyYXRpb25cclxuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyBcclxuICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04sXHJcbiAgbWF4QXR0ZW1wdHM6IDMsXHJcbn0pO1xyXG5jb25zdCB0cmFuc2NyaWJlQ2xpZW50ID0gbmV3IFRyYW5zY3JpYmVDbGllbnQoeyBcclxuICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04sXHJcbiAgbWF4QXR0ZW1wdHM6IDMsXHJcbn0pO1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyBcclxuICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04sXHJcbiAgbWF4QXR0ZW1wdHM6IDMsXHJcbn0pO1xyXG5jb25zdCBldmVudEJyaWRnZUNsaWVudCA9IG5ldyBFdmVudEJyaWRnZUNsaWVudCh7IFxyXG4gIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTixcclxuICBtYXhBdHRlbXB0czogMyxcclxufSk7XHJcblxyXG4vLyBJbml0aWFsaXplIGVycm9yIGhhbmRsZXJcclxuY29uc3QgZXJyb3JIYW5kbGVyID0gbmV3IEVycm9ySGFuZGxlcigpO1xyXG5cclxuY29uc3QgQVVESU9fQlVDS0VUID0gcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUhO1xyXG5jb25zdCBDT05URU5UX1RBQkxFID0gcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FITtcclxuY29uc3QgRVZFTlRfQlVTID0gcHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUhO1xyXG5cclxuLy8gVmFsaWRhdGlvbiBzY2hlbWFzXHJcbmNvbnN0IGF1ZGlvVXBsb2FkU2NoZW1hOiBWYWxpZGF0aW9uU2NoZW1hID0ge1xyXG4gIGF1ZGlvRGF0YTogeyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogJ3N0cmluZycsIG1pbkxlbmd0aDogMTAwIH0sXHJcbiAgY29udGVudFR5cGU6IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6ICdzdHJpbmcnLCBwYXR0ZXJuOiAvXmF1ZGlvXFwvLyB9LFxyXG4gIHVzZXJJZDogeyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogJ3N0cmluZycsIG1pbkxlbmd0aDogMSB9LFxyXG59O1xyXG5cclxuY29uc3QgdGV4dElucHV0U2NoZW1hOiBWYWxpZGF0aW9uU2NoZW1hID0ge1xyXG4gIHRleHQ6IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6ICdzdHJpbmcnLCBtaW5MZW5ndGg6IDEwLCBtYXhMZW5ndGg6IDEwMDAwIH0sXHJcbiAgdXNlcklkOiB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiAnc3RyaW5nJywgbWluTGVuZ3RoOiAxIH0sXHJcbn07XHJcblxyXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIEhUVFAgc3RhdHVzIGNvZGUgZnJvbSBlcnJvclxyXG5mdW5jdGlvbiBnZXRTdGF0dXNDb2RlRm9yRXJyb3IoZXJyb3I6IEVycm9yKTogbnVtYmVyIHtcclxuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWYWxpZGF0aW9uRXJyb3IpIHJldHVybiA0MDA7XHJcbiAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ05vdEZvdW5kJykpIHJldHVybiA0MDQ7XHJcbiAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ1VuYXV0aG9yaXplZCcpKSByZXR1cm4gNDAxO1xyXG4gIGlmIChlcnJvci5uYW1lLmluY2x1ZGVzKCdGb3JiaWRkZW4nKSkgcmV0dXJuIDQwMztcclxuICBpZiAoZXJyb3IubmFtZS5pbmNsdWRlcygnVGhyb3R0bGluZycpKSByZXR1cm4gNDI5O1xyXG4gIGlmIChlcnJvci5uYW1lLmluY2x1ZGVzKCdUaW1lb3V0JykpIHJldHVybiA0MDg7XHJcbiAgcmV0dXJuIDUwMDtcclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoXHJcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LFxyXG4gIGNvbnRleHQ6IENvbnRleHRcclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcclxuICBjb25zdCBlcnJvckNvbnRleHQgPSB7XHJcbiAgICBmdW5jdGlvbk5hbWU6IGNvbnRleHQuZnVuY3Rpb25OYW1lLFxyXG4gICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgIG9wZXJhdGlvbjogYCR7ZXZlbnQuaHR0cE1ldGhvZH0gJHtldmVudC5wYXRofWAsXHJcbiAgfTtcclxuXHJcbiAgY29uc29sZS5sb2coJ0lucHV0IFByb2Nlc3NvciBFdmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xyXG4gIGNvbnNvbGUubG9nKCdFbnZpcm9ubWVudCB2YXJpYWJsZXM6Jywge1xyXG4gICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUsXHJcbiAgICBBVURJT19CVUNLRVRfTkFNRTogcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUsXHJcbiAgICBFVkVOVF9CVVNfTkFNRTogcHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUsXHJcbiAgICBBV1NfUkVHSU9OOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OXHJcbiAgfSk7XHJcblxyXG4gIC8vIEFsbG93ZWQgb3JpZ2lucyBmb3IgQ09SU1xyXG4gIGNvbnN0IGFsbG93ZWRPcmlnaW5zID0gW1xyXG4gICAgJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJyxcclxuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLFxyXG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycsXHJcbiAgXTtcclxuICBcclxuICBjb25zdCByZXF1ZXN0T3JpZ2luID0gZXZlbnQuaGVhZGVycy5vcmlnaW4gfHwgZXZlbnQuaGVhZGVycy5PcmlnaW47XHJcbiAgY29uc3QgYWxsb3dlZE9yaWdpbiA9IGFsbG93ZWRPcmlnaW5zLmluY2x1ZGVzKHJlcXVlc3RPcmlnaW4gfHwgJycpID8gcmVxdWVzdE9yaWdpbiEgOiBhbGxvd2VkT3JpZ2luc1swXTtcclxuXHJcbiAgY29uc3QgY29yc0hlYWRlcnMgPSB7XHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYWxsb3dlZE9yaWdpbixcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxBdXRob3JpemF0aW9uLFgtQW16LURhdGUsWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtUmVxdWVzdGVkLVdpdGgnLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULFBPU1QsUFVULERFTEVURSxPUFRJT05TJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6ICd0cnVlJyxcclxuICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgfTtcclxuXHJcbiAgLy8gVmFsaWRhdGUgcmVxdWlyZWQgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgaWYgKCFDT05URU5UX1RBQkxFKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdDT05URU5UX1RBQkxFX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbWlzc2luZycpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnQ29uZmlndXJhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogJ0NPTlRFTlRfVEFCTEVfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCdcclxuICAgICAgfSlcclxuICAgIH07XHJcbiAgfVxyXG4gIGlmICghRVZFTlRfQlVTKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFVkVOVF9CVVNfTkFNRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyBtaXNzaW5nJyk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdDb25maWd1cmF0aW9uIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiAnRVZFTlRfQlVTX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnXHJcbiAgICAgIH0pXHJcbiAgICB9O1xyXG4gIH1cclxuICBpZiAoIUFVRElPX0JVQ0tFVCkge1xyXG4gICAgY29uc29sZS5lcnJvcignQVVESU9fQlVDS0VUX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbWlzc2luZycpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnQ29uZmlndXJhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogJ0FVRElPX0JVQ0tFVF9OQU1FIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkJ1xyXG4gICAgICB9KVxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBIYW5kbGUgcHJlZmxpZ2h0IE9QVElPTlMgcmVxdWVzdHNcclxuICAgIGlmIChldmVudC5odHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogJycsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGF0aCA9IGV2ZW50LnBhdGg7XHJcbiAgICBjb25zdCBtZXRob2QgPSBldmVudC5odHRwTWV0aG9kO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygnUHJvY2Vzc2luZyByZXF1ZXN0OicsIHsgbWV0aG9kLCBwYXRoIH0pO1xyXG5cclxuICAgIC8vIFJvdXRlOiBQT1NUIC9hcGkvaW5wdXQvYXVkaW8gLSBIYW5kbGUgYXVkaW8gZmlsZSB1cGxvYWRcclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9pbnB1dC9hdWRpbycpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUF1ZGlvVXBsb2FkKGV2ZW50LCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUm91dGU6IFBPU1QgL2FwaS9pbnB1dC90ZXh0IC0gSGFuZGxlIHRleHQgaW5wdXRcclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9pbnB1dC90ZXh0Jykge1xyXG4gICAgICBjb25zb2xlLmxvZygnSGFuZGxpbmcgdGV4dCBpbnB1dCByZXF1ZXN0Jyk7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZVRleHRJbnB1dChldmVudCwgY29udGV4dCwgY29yc0hlYWRlcnMpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGhhbmRsZVRleHRJbnB1dDonLCBlcnJvcik7XHJcbiAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBSb3V0ZTogR0VUIC9hcGkvaW5wdXQvc3RhdHVzL3tpZH0gLSBDaGVjayBwcm9jZXNzaW5nIHN0YXR1c1xyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aC5zdGFydHNXaXRoKCcvYXBpL2lucHV0L3N0YXR1cy8nKSkge1xyXG4gICAgICBjb25zdCBpbnB1dElkID0gcGF0aC5zcGxpdCgnLycpLnBvcCgpO1xyXG4gICAgICByZXR1cm4gYXdhaXQgZ2V0SW5wdXRTdGF0dXMoaW5wdXRJZCEsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSb3V0ZTogUE9TVCAvYXBpL2lucHV0L3RyYW5zY3JpcHRpb24tY2FsbGJhY2sgLSBIYW5kbGUgVHJhbnNjcmliZSBjYWxsYmFja1xyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2lucHV0L3RyYW5zY3JpcHRpb24tY2FsbGJhY2snKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVUcmFuc2NyaXB0aW9uQ2FsbGJhY2soZXZlbnQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBEZWZhdWx0IDQwNCBmb3IgdW5tYXRjaGVkIHJvdXRlc1xyXG4gICAgY29uc3QgZXJyb3JSZXNwb25zZTogRXJyb3JSZXNwb25zZSA9IHtcclxuICAgICAgZXJyb3I6ICdOb3QgRm91bmQnLFxyXG4gICAgICBtZXNzYWdlOiBgUm91dGUgJHttZXRob2R9ICR7cGF0aH0gbm90IGZvdW5kYCxcclxuICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNDA0LFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZXJyb3JSZXNwb25zZSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc3QgZXJyID0gZXJyb3IgYXMgRXJyb3I7XHJcbiAgICBhd2FpdCBlcnJvckhhbmRsZXIuaGFuZGxlRXJyb3IoZXJyLCBlcnJvckNvbnRleHQpO1xyXG5cclxuICAgIGNvbnN0IGVycm9yUmVzcG9uc2UgPSBlcnJvckhhbmRsZXIuY3JlYXRlVXNlckZyaWVuZGx5UmVzcG9uc2UoZXJyLCBlcnJvckNvbnRleHQpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IGdldFN0YXR1c0NvZGVGb3JFcnJvcihlcnIpLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZXJyb3JSZXNwb25zZSksXHJcbiAgICB9O1xyXG4gIH1cclxufTtcclxuXHJcbi8vIEF1ZGlvIHVwbG9hZCBoYW5kbGVyXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUF1ZGlvVXBsb2FkKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnNvbGUubG9nKCdFbnZpcm9ubWVudCB2YXJpYWJsZXM6Jywge1xyXG4gICAgICBDT05URU5UX1RBQkxFOiBDT05URU5UX1RBQkxFLFxyXG4gICAgICBBVURJT19CVUNLRVQ6IEFVRElPX0JVQ0tFVCxcclxuICAgICAgRVZFTlRfQlVTOiBFVkVOVF9CVVNcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBpZiAoIWV2ZW50LmJvZHkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXF1ZXN0OiBBdWRpb1VwbG9hZFJlcXVlc3QgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkpO1xyXG4gICAgXHJcbiAgICAvLyBWYWxpZGF0ZSByZXF1ZXN0IHVzaW5nIGVycm9yIGhhbmRsZXJcclxuICAgIGVycm9ySGFuZGxlci52YWxpZGF0ZUlucHV0KHJlcXVlc3QsIGF1ZGlvVXBsb2FkU2NoZW1hKTtcclxuICAgIFxyXG4gICAgLy8gQWRkaXRpb25hbCBhdWRpby1zcGVjaWZpYyB2YWxpZGF0aW9uXHJcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gdmFsaWRhdGVBdWRpb1VwbG9hZFJlcXVlc3QocmVxdWVzdCk7XHJcbiAgICBpZiAoIXZhbGlkYXRpb24uaXNWYWxpZCkge1xyXG4gICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3IgfHwgJ0F1ZGlvIHZhbGlkYXRpb24gZmFpbGVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2VuZXJhdGUgdW5pcXVlIElEIGZvciB0aGlzIGlucHV0XHJcbiAgICBjb25zdCBpbnB1dElkID0gdXVpZHY0KCk7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgLy8gRGVjb2RlIGJhc2U2NCBhdWRpbyBkYXRhXHJcbiAgICBjb25zdCBhdWRpb0J1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlcXVlc3QuYXVkaW9EYXRhLCAnYmFzZTY0Jyk7XHJcbiAgICBcclxuICAgIC8vIFZhbGlkYXRlIGF1ZGlvIHF1YWxpdHlcclxuICAgIGNvbnN0IGF1ZGlvVmFsaWRhdGlvbiA9IHZhbGlkYXRlQXVkaW9RdWFsaXR5KGF1ZGlvQnVmZmVyLCByZXF1ZXN0LmNvbnRlbnRUeXBlKTtcclxuICAgIGlmICghYXVkaW9WYWxpZGF0aW9uLmlzVmFsaWQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdBdWRpbyBWYWxpZGF0aW9uIEVycm9yJyxcclxuICAgICAgICAgIG1lc3NhZ2U6IGF1ZGlvVmFsaWRhdGlvbi5lcnJvcixcclxuICAgICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVXBsb2FkIGF1ZGlvIHRvIFMzXHJcbiAgICBjb25zdCBhdWRpb0tleSA9IGBhdWRpby8ke3JlcXVlc3QudXNlcklkfS8ke2lucHV0SWR9LiR7Z2V0RmlsZUV4dGVuc2lvbihyZXF1ZXN0LmNvbnRlbnRUeXBlKX1gO1xyXG4gICAgYXdhaXQgczNDbGllbnQuc2VuZChuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XHJcbiAgICAgIEJ1Y2tldDogQVVESU9fQlVDS0VULFxyXG4gICAgICBLZXk6IGF1ZGlvS2V5LFxyXG4gICAgICBCb2R5OiBhdWRpb0J1ZmZlcixcclxuICAgICAgQ29udGVudFR5cGU6IHJlcXVlc3QuY29udGVudFR5cGUsXHJcbiAgICAgIE1ldGFkYXRhOiB7XHJcbiAgICAgICAgdXNlcklkOiByZXF1ZXN0LnVzZXJJZCxcclxuICAgICAgICBpbnB1dElkOiBpbnB1dElkLFxyXG4gICAgICAgIHVwbG9hZGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgaW5pdGlhbCByZWNvcmQgaW4gRHluYW1vREJcclxuICAgIGNvbnN0IGlucHV0UmVjb3JkOiBJbnB1dFByb2Nlc3NpbmdSZXN1bHQgPSB7XHJcbiAgICAgIGlkOiBpbnB1dElkLFxyXG4gICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxyXG4gICAgICB0eXBlOiAnYXVkaW8nLFxyXG4gICAgICBzdGF0dXM6ICdwcm9jZXNzaW5nJyxcclxuICAgICAgY3JlYXRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICAgIHVwZGF0ZWRBdDogdGltZXN0YW1wLFxyXG4gICAgfTtcclxuXHJcbiAgICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgUHV0SXRlbUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IENPTlRFTlRfVEFCTEUsXHJcbiAgICAgIEl0ZW06IHtcclxuICAgICAgICBpZDogeyBTOiBpbnB1dFJlY29yZC5pZCB9LFxyXG4gICAgICAgIHVzZXJJZDogeyBTOiBpbnB1dFJlY29yZC51c2VySWQgfSxcclxuICAgICAgICB0eXBlOiB7IFM6IGlucHV0UmVjb3JkLnR5cGUgfSxcclxuICAgICAgICBzdGF0dXM6IHsgUzogaW5wdXRSZWNvcmQuc3RhdHVzIH0sXHJcbiAgICAgICAgYXVkaW9LZXk6IHsgUzogYXVkaW9LZXkgfSxcclxuICAgICAgICBjcmVhdGVkQXQ6IHsgUzogaW5wdXRSZWNvcmQuY3JlYXRlZEF0IH0sXHJcbiAgICAgICAgdXBkYXRlZEF0OiB7IFM6IGlucHV0UmVjb3JkLnVwZGF0ZWRBdCB9LFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFN0YXJ0IHRyYW5zY3JpcHRpb24gam9iXHJcbiAgICBjb25zdCB0cmFuc2NyaXB0aW9uSm9iTmFtZSA9IGB0cmFuc2NyaXB0aW9uLSR7aW5wdXRJZH1gO1xyXG4gICAgY29uc3QgczNVcmkgPSBgczM6Ly8ke0FVRElPX0JVQ0tFVH0vJHthdWRpb0tleX1gO1xyXG5cclxuICAgIGF3YWl0IHRyYW5zY3JpYmVDbGllbnQuc2VuZChuZXcgU3RhcnRUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZCh7XHJcbiAgICAgIFRyYW5zY3JpcHRpb25Kb2JOYW1lOiB0cmFuc2NyaXB0aW9uSm9iTmFtZSxcclxuICAgICAgTWVkaWE6IHtcclxuICAgICAgICBNZWRpYUZpbGVVcmk6IHMzVXJpLFxyXG4gICAgICB9LFxyXG4gICAgICBNZWRpYUZvcm1hdDogZ2V0TWVkaWFGb3JtYXQocmVxdWVzdC5jb250ZW50VHlwZSksXHJcbiAgICAgIExhbmd1YWdlQ29kZTogJ2VuLVVTJyxcclxuICAgICAgT3V0cHV0QnVja2V0TmFtZTogQVVESU9fQlVDS0VULFxyXG4gICAgICBPdXRwdXRLZXk6IGB0cmFuc2NyaXB0aW9ucy8ke2lucHV0SWR9Lmpzb25gLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFB1Ymxpc2ggZXZlbnQgZm9yIHByb2Nlc3Npbmcgc3RhcnRlZFxyXG4gICAgYXdhaXQgZXZlbnRCcmlkZ2VDbGllbnQuc2VuZChuZXcgUHV0RXZlbnRzQ29tbWFuZCh7XHJcbiAgICAgIEVudHJpZXM6IFt7XHJcbiAgICAgICAgU291cmNlOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmlucHV0LXByb2Nlc3NvcicsXHJcbiAgICAgICAgRGV0YWlsVHlwZTogJ0F1ZGlvIFByb2Nlc3NpbmcgU3RhcnRlZCcsXHJcbiAgICAgICAgRGV0YWlsOiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBpbnB1dElkLFxyXG4gICAgICAgICAgdXNlcklkOiByZXF1ZXN0LnVzZXJJZCxcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb25Kb2JOYW1lLFxyXG4gICAgICAgICAgYXVkaW9LZXksXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVMsXHJcbiAgICAgIH1dLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGNvbnN0IHJlc3BvbnNlOiBTdWNjZXNzUmVzcG9uc2UgPSB7XHJcbiAgICAgIG1lc3NhZ2U6ICdBdWRpbyB1cGxvYWQgc3VjY2Vzc2Z1bCwgcHJvY2Vzc2luZyBzdGFydGVkJyxcclxuICAgICAgZGF0YToge1xyXG4gICAgICAgIGlucHV0SWQsXHJcbiAgICAgICAgc3RhdHVzOiAncHJvY2Vzc2luZycsXHJcbiAgICAgICAgdHJhbnNjcmlwdGlvbkpvYk5hbWUsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMixcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBoYW5kbGVBdWRpb1VwbG9hZDonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8vIFRleHQgaW5wdXQgaGFuZGxlclxyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVUZXh0SW5wdXQoXHJcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LFxyXG4gIGNvbnRleHQ6IENvbnRleHQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgY29uc29sZS5sb2coJ1RleHQgaW5wdXQgLSBFbnZpcm9ubWVudCB2YXJpYWJsZXM6Jywge1xyXG4gICAgICBDT05URU5UX1RBQkxFOiBDT05URU5UX1RBQkxFLFxyXG4gICAgICBFVkVOVF9CVVM6IEVWRU5UX0JVU1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCdSZXF1ZXN0IGJvZHk6JywgZXZlbnQuYm9keSk7XHJcbiAgICBcclxuICAgIGlmICghZXZlbnQuYm9keSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGxldCByZXF1ZXN0OiBUZXh0SW5wdXRSZXF1ZXN0O1xyXG4gICAgdHJ5IHtcclxuICAgICAgcmVxdWVzdCA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdQYXJzZWQgcmVxdWVzdDonLCByZXF1ZXN0KTtcclxuICAgIH0gY2F0Y2ggKHBhcnNlRXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignSlNPTiBwYXJzZSBlcnJvcjonLCBwYXJzZUVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIEpTT04gaW4gcmVxdWVzdCBib2R5Jyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFZhbGlkYXRlIHJlcXVlc3QgdXNpbmcgZXJyb3IgaGFuZGxlclxyXG4gICAgZXJyb3JIYW5kbGVyLnZhbGlkYXRlSW5wdXQocmVxdWVzdCwgdGV4dElucHV0U2NoZW1hKTtcclxuICAgIFxyXG4gICAgLy8gQWRkaXRpb25hbCB0ZXh0LXNwZWNpZmljIHZhbGlkYXRpb25cclxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSB2YWxpZGF0ZVRleHRJbnB1dFJlcXVlc3QocmVxdWVzdCk7XHJcbiAgICBpZiAoIXZhbGlkYXRpb24uaXNWYWxpZCkge1xyXG4gICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKHZhbGlkYXRpb24uZXJyb3IgfHwgJ1RleHQgdmFsaWRhdGlvbiBmYWlsZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZW5lcmF0ZSB1bmlxdWUgSUQgZm9yIHRoaXMgaW5wdXRcclxuICAgIGNvbnN0IGlucHV0SWQgPSB1dWlkdjQoKTtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICAvLyBQcmVwcm9jZXNzIHRleHQgaW5wdXRcclxuICAgIGNvbnN0IHByb2Nlc3NlZFRleHQgPSBwcmVwcm9jZXNzVGV4dElucHV0KHJlcXVlc3QudGV4dCk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIHJlY29yZCBpbiBEeW5hbW9EQlxyXG4gICAgY29uc3QgaW5wdXRSZWNvcmQ6IElucHV0UHJvY2Vzc2luZ1Jlc3VsdCA9IHtcclxuICAgICAgaWQ6IGlucHV0SWQsXHJcbiAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXHJcbiAgICAgIHR5cGU6ICd0ZXh0JyxcclxuICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcclxuICAgICAgb3JpZ2luYWxJbnB1dDogcmVxdWVzdC50ZXh0LFxyXG4gICAgICB0cmFuc2NyaXB0aW9uOiBwcm9jZXNzZWRUZXh0LFxyXG4gICAgICBjcmVhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgdXBkYXRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGl0ZW06IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XHJcbiAgICAgIGlkOiB7IFM6IGlucHV0UmVjb3JkLmlkIH0sXHJcbiAgICAgIHVzZXJJZDogeyBTOiBpbnB1dFJlY29yZC51c2VySWQgfSxcclxuICAgICAgdHlwZTogeyBTOiBpbnB1dFJlY29yZC50eXBlIH0sXHJcbiAgICAgIHN0YXR1czogeyBTOiBpbnB1dFJlY29yZC5zdGF0dXMgfSxcclxuICAgICAgY3JlYXRlZEF0OiB7IFM6IGlucHV0UmVjb3JkLmNyZWF0ZWRBdCB9LFxyXG4gICAgICB1cGRhdGVkQXQ6IHsgUzogaW5wdXRSZWNvcmQudXBkYXRlZEF0IH0sXHJcbiAgICB9O1xyXG5cclxuICAgIGlmIChpbnB1dFJlY29yZC5vcmlnaW5hbElucHV0KSB7XHJcbiAgICAgIGl0ZW0ub3JpZ2luYWxJbnB1dCA9IHsgUzogaW5wdXRSZWNvcmQub3JpZ2luYWxJbnB1dCB9O1xyXG4gICAgfVxyXG4gICAgaWYgKGlucHV0UmVjb3JkLnRyYW5zY3JpcHRpb24pIHtcclxuICAgICAgaXRlbS50cmFuc2NyaXB0aW9uID0geyBTOiBpbnB1dFJlY29yZC50cmFuc2NyaXB0aW9uIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5sb2coJ0Fib3V0IHRvIHdyaXRlIHRvIER5bmFtb0RCIHRhYmxlOicsIENPTlRFTlRfVEFCTEUpO1xyXG4gICAgY29uc29sZS5sb2coJ0R5bmFtb0RCIGl0ZW06JywgSlNPTi5zdHJpbmdpZnkoaXRlbSwgbnVsbCwgMikpO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgUHV0SXRlbUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgICBJdGVtOiBpdGVtLFxyXG4gICAgICB9KSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdEeW5hbW9EQiB3cml0ZSBzdWNjZXNzZnVsJyk7XHJcbiAgICB9IGNhdGNoIChkYkVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0R5bmFtb0RCIGVycm9yOicsIGRiRXJyb3IpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYER5bmFtb0RCIHdyaXRlIGZhaWxlZDogJHtkYkVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBkYkVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5sb2coJ0Fib3V0IHRvIHB1Ymxpc2ggdG8gRXZlbnRCcmlkZ2U6JywgRVZFTlRfQlVTKTtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gUHVibGlzaCBldmVudCBmb3IgdGV4dCBwcm9jZXNzaW5nIGNvbXBsZXRlZFxyXG4gICAgICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcclxuICAgICAgICBFbnRyaWVzOiBbe1xyXG4gICAgICAgICAgU291cmNlOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmlucHV0LXByb2Nlc3NvcicsXHJcbiAgICAgICAgICBEZXRhaWxUeXBlOiAnVGV4dCBQcm9jZXNzaW5nIENvbXBsZXRlZCcsXHJcbiAgICAgICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgaW5wdXRJZCxcclxuICAgICAgICAgICAgdXNlcklkOiByZXF1ZXN0LnVzZXJJZCxcclxuICAgICAgICAgICAgdHJhbnNjcmlwdGlvbjogcHJvY2Vzc2VkVGV4dCxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVMsXHJcbiAgICAgICAgfV0sXHJcbiAgICAgIH0pKTtcclxuICAgICAgY29uc29sZS5sb2coJ0V2ZW50QnJpZGdlIHB1Ymxpc2ggc3VjY2Vzc2Z1bCcpO1xyXG4gICAgfSBjYXRjaCAoZXZlbnRFcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFdmVudEJyaWRnZSBlcnJvcjonLCBldmVudEVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFdmVudEJyaWRnZSBwdWJsaXNoIGZhaWxlZDogJHtldmVudEVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBldmVudEVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2U6IFN1Y2Nlc3NSZXNwb25zZSA9IHtcclxuICAgICAgbWVzc2FnZTogJ1RleHQgaW5wdXQgcHJvY2Vzc2VkIHN1Y2Nlc3NmdWxseScsXHJcbiAgICAgIGRhdGE6IHtcclxuICAgICAgICBpbnB1dElkLFxyXG4gICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXHJcbiAgICAgICAgdHJhbnNjcmlwdGlvbjogcHJvY2Vzc2VkVGV4dCxcclxuICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGhhbmRsZVRleHRJbnB1dDonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEdldCBpbnB1dCBwcm9jZXNzaW5nIHN0YXR1c1xyXG5hc3luYyBmdW5jdGlvbiBnZXRJbnB1dFN0YXR1cyhcclxuICBpbnB1dElkOiBzdHJpbmcsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgLy8gR2V0IHJlY29yZCBmcm9tIER5bmFtb0RCXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IENPTlRFTlRfVEFCTEUsXHJcbiAgICAgIEtleToge1xyXG4gICAgICAgIGlkOiB7IFM6IGlucHV0SWQgfSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdCB8fCAhcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdOb3QgRm91bmQnLFxyXG4gICAgICAgICAgbWVzc2FnZTogYElucHV0IHdpdGggSUQgJHtpbnB1dElkfSBub3QgZm91bmRgLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGlucHV0UmVjb3JkOiBJbnB1dFByb2Nlc3NpbmdSZXN1bHQgPSB7XHJcbiAgICAgIGlkOiByZXN1bHQuSXRlbS5pZC5TISxcclxuICAgICAgdXNlcklkOiByZXN1bHQuSXRlbS51c2VySWQuUyEsXHJcbiAgICAgIHR5cGU6IHJlc3VsdC5JdGVtLnR5cGUuUyEgYXMgJ2F1ZGlvJyB8ICd0ZXh0JyxcclxuICAgICAgc3RhdHVzOiByZXN1bHQuSXRlbS5zdGF0dXMuUyEgYXMgJ3Byb2Nlc3NpbmcnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJyxcclxuICAgICAgb3JpZ2luYWxJbnB1dDogcmVzdWx0Lkl0ZW0ub3JpZ2luYWxJbnB1dD8uUyxcclxuICAgICAgdHJhbnNjcmlwdGlvbjogcmVzdWx0Lkl0ZW0udHJhbnNjcmlwdGlvbj8uUyxcclxuICAgICAgZXJyb3I6IHJlc3VsdC5JdGVtLmVycm9yPy5TLFxyXG4gICAgICBjcmVhdGVkQXQ6IHJlc3VsdC5JdGVtLmNyZWF0ZWRBdC5TISxcclxuICAgICAgdXBkYXRlZEF0OiByZXN1bHQuSXRlbS51cGRhdGVkQXQuUyEsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIElmIGF1ZGlvIHByb2Nlc3NpbmcgaXMgc3RpbGwgaW4gcHJvZ3Jlc3MsIGNoZWNrIHRyYW5zY3JpcHRpb24gam9iIHN0YXR1c1xyXG4gICAgaWYgKGlucHV0UmVjb3JkLnR5cGUgPT09ICdhdWRpbycgJiYgaW5wdXRSZWNvcmQuc3RhdHVzID09PSAncHJvY2Vzc2luZycpIHtcclxuICAgICAgY29uc3QgdHJhbnNjcmlwdGlvbkpvYk5hbWUgPSBgdHJhbnNjcmlwdGlvbi0ke2lucHV0SWR9YDtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCB0cmFuc2NyaXB0aW9uUmVzdWx0ID0gYXdhaXQgdHJhbnNjcmliZUNsaWVudC5zZW5kKG5ldyBHZXRUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZCh7XHJcbiAgICAgICAgICBUcmFuc2NyaXB0aW9uSm9iTmFtZTogdHJhbnNjcmlwdGlvbkpvYk5hbWUsXHJcbiAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICBpZiAodHJhbnNjcmlwdGlvblJlc3VsdC5UcmFuc2NyaXB0aW9uSm9iPy5UcmFuc2NyaXB0aW9uSm9iU3RhdHVzID09PSAnQ09NUExFVEVEJykge1xyXG4gICAgICAgICAgLy8gVXBkYXRlIHJlY29yZCB3aXRoIGNvbXBsZXRlZCB0cmFuc2NyaXB0aW9uXHJcbiAgICAgICAgICBhd2FpdCB1cGRhdGVUcmFuc2NyaXB0aW9uUmVzdWx0KGlucHV0SWQsIHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYi5UcmFuc2NyaXB0Py5UcmFuc2NyaXB0RmlsZVVyaSEpO1xyXG4gICAgICAgICAgaW5wdXRSZWNvcmQuc3RhdHVzID0gJ2NvbXBsZXRlZCc7XHJcbiAgICAgICAgfSBlbHNlIGlmICh0cmFuc2NyaXB0aW9uUmVzdWx0LlRyYW5zY3JpcHRpb25Kb2I/LlRyYW5zY3JpcHRpb25Kb2JTdGF0dXMgPT09ICdGQUlMRUQnKSB7XHJcbiAgICAgICAgICAvLyBVcGRhdGUgcmVjb3JkIHdpdGggZmFpbHVyZVxyXG4gICAgICAgICAgYXdhaXQgdXBkYXRlVHJhbnNjcmlwdGlvbkVycm9yKGlucHV0SWQsIHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYi5GYWlsdXJlUmVhc29uIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCcpO1xyXG4gICAgICAgICAgaW5wdXRSZWNvcmQuc3RhdHVzID0gJ2ZhaWxlZCc7XHJcbiAgICAgICAgICBpbnB1dFJlY29yZC5lcnJvciA9IHRyYW5zY3JpcHRpb25SZXN1bHQuVHJhbnNjcmlwdGlvbkpvYi5GYWlsdXJlUmVhc29uIHx8ICdUcmFuc2NyaXB0aW9uIGZhaWxlZCc7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoICh0cmFuc2NyaWJlRXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyB0cmFuc2NyaXB0aW9uIHN0YXR1czonLCB0cmFuc2NyaWJlRXJyb3IpO1xyXG4gICAgICAgIC8vIERvbid0IGZhaWwgdGhlIHN0YXR1cyBjaGVjayBpZiB0cmFuc2NyaXB0aW9uIGNoZWNrIGZhaWxzXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXNwb25zZTogU3VjY2Vzc1Jlc3BvbnNlID0ge1xyXG4gICAgICBtZXNzYWdlOiAnSW5wdXQgc3RhdHVzIHJldHJpZXZlZCBzdWNjZXNzZnVsbHknLFxyXG4gICAgICBkYXRhOiBpbnB1dFJlY29yZCxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGdldElucHV0U3RhdHVzOicsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufVxyXG5cclxuLy8gSGFuZGxlIHRyYW5zY3JpcHRpb24gY2FsbGJhY2sgKGZvciB3ZWJob29rLWJhc2VkIHVwZGF0ZXMpXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVRyYW5zY3JpcHRpb25DYWxsYmFjayhcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgaWYgKCFldmVudC5ib2R5KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY2FsbGJhY2tEYXRhID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcclxuICAgIGNvbnNvbGUubG9nKCdUcmFuc2NyaXB0aW9uIGNhbGxiYWNrIHJlY2VpdmVkOicsIGNhbGxiYWNrRGF0YSk7XHJcblxyXG4gICAgLy8gVGhpcyB3b3VsZCBiZSB1c2VkIGlmIEFXUyBUcmFuc2NyaWJlIHN1cHBvcnRlZCB3ZWJob29rc1xyXG4gICAgLy8gRm9yIG5vdywgd2UnbGwgdXNlIHBvbGxpbmcgaW4gdGhlIHN0YXR1cyBjaGVja1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6ICdDYWxsYmFjayByZWNlaXZlZCcgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gaGFuZGxlVHJhbnNjcmlwdGlvbkNhbGxiYWNrOicsIGVycm9yKTtcclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVXBkYXRlIHRyYW5zY3JpcHRpb24gcmVzdWx0IGluIER5bmFtb0RCXHJcbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZVRyYW5zY3JpcHRpb25SZXN1bHQoaW5wdXRJZDogc3RyaW5nLCB0cmFuc2NyaXB0RmlsZVVyaTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgdHJ5IHtcclxuICAgIC8vIERvd25sb2FkIHRyYW5zY3JpcHRpb24gcmVzdWx0IGZyb20gUzNcclxuICAgIGNvbnN0IHRyYW5zY3JpcHRLZXkgPSB0cmFuc2NyaXB0RmlsZVVyaS5zcGxpdCgnLycpLnNsaWNlKDMpLmpvaW4oJy8nKTsgLy8gUmVtb3ZlIHMzOi8vYnVja2V0LW5hbWUvXHJcbiAgICBjb25zdCB0cmFuc2NyaXB0UmVzdWx0ID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XHJcbiAgICAgIEJ1Y2tldDogQVVESU9fQlVDS0VULFxyXG4gICAgICBLZXk6IHRyYW5zY3JpcHRLZXksXHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc3QgdHJhbnNjcmlwdERhdGEgPSBKU09OLnBhcnNlKGF3YWl0IHRyYW5zY3JpcHRSZXN1bHQuQm9keSEudHJhbnNmb3JtVG9TdHJpbmcoKSk7XHJcbiAgICBjb25zdCB0cmFuc2NyaXB0aW9uID0gdHJhbnNjcmlwdERhdGEucmVzdWx0cy50cmFuc2NyaXB0c1swXS50cmFuc2NyaXB0O1xyXG5cclxuICAgIC8vIFVwZGF0ZSBEeW5hbW9EQiByZWNvcmRcclxuICAgIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBVcGRhdGVJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgICAgS2V5OiB7XHJcbiAgICAgICAgaWQ6IHsgUzogaW5wdXRJZCB9LFxyXG4gICAgICB9LFxyXG4gICAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUICNzdGF0dXMgPSA6c3RhdHVzLCB0cmFuc2NyaXB0aW9uID0gOnRyYW5zY3JpcHRpb24sIHVwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnLFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcclxuICAgICAgICAnI3N0YXR1cyc6ICdzdGF0dXMnLFxyXG4gICAgICB9LFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgJzpzdGF0dXMnOiB7IFM6ICdjb21wbGV0ZWQnIH0sXHJcbiAgICAgICAgJzp0cmFuc2NyaXB0aW9uJzogeyBTOiB0cmFuc2NyaXB0aW9uIH0sXHJcbiAgICAgICAgJzp1cGRhdGVkQXQnOiB7IFM6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFB1Ymxpc2ggZXZlbnQgZm9yIHRyYW5zY3JpcHRpb24gY29tcGxldGVkXHJcbiAgICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcclxuICAgICAgRW50cmllczogW3tcclxuICAgICAgICBTb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW5wdXQtcHJvY2Vzc29yJyxcclxuICAgICAgICBEZXRhaWxUeXBlOiAnQXVkaW8gUHJvY2Vzc2luZyBDb21wbGV0ZWQnLFxyXG4gICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgaW5wdXRJZCxcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb24sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVMsXHJcbiAgICAgIH1dLFxyXG4gICAgfSkpO1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgdXBkYXRpbmcgdHJhbnNjcmlwdGlvbiByZXN1bHQ6JywgZXJyb3IpO1xyXG4gICAgYXdhaXQgdXBkYXRlVHJhbnNjcmlwdGlvbkVycm9yKGlucHV0SWQsIGBGYWlsZWQgdG8gcHJvY2VzcyB0cmFuc2NyaXB0aW9uOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWApO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVXBkYXRlIHRyYW5zY3JpcHRpb24gZXJyb3IgaW4gRHluYW1vREJcclxuYXN5bmMgZnVuY3Rpb24gdXBkYXRlVHJhbnNjcmlwdGlvbkVycm9yKGlucHV0SWQ6IHN0cmluZywgZXJyb3JNZXNzYWdlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgVXBkYXRlSXRlbUNvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgS2V5OiB7XHJcbiAgICAgIGlkOiB7IFM6IGlucHV0SWQgfSxcclxuICAgIH0sXHJcbiAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUICNzdGF0dXMgPSA6c3RhdHVzLCAjZXJyb3IgPSA6ZXJyb3IsIHVwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnLFxyXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XHJcbiAgICAgICcjc3RhdHVzJzogJ3N0YXR1cycsXHJcbiAgICAgICcjZXJyb3InOiAnZXJyb3InLFxyXG4gICAgfSxcclxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgJzpzdGF0dXMnOiB7IFM6ICdmYWlsZWQnIH0sXHJcbiAgICAgICc6ZXJyb3InOiB7IFM6IGVycm9yTWVzc2FnZSB9LFxyXG4gICAgICAnOnVwZGF0ZWRBdCc6IHsgUzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXHJcbiAgICB9LFxyXG4gIH0pKTtcclxufVxyXG5cclxuLy8gVmFsaWRhdGlvbiBmdW5jdGlvbnNcclxuaW50ZXJmYWNlIFZhbGlkYXRpb25SZXN1bHQge1xyXG4gIGlzVmFsaWQ6IGJvb2xlYW47XHJcbiAgZXJyb3I/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZhbGlkYXRlQXVkaW9VcGxvYWRSZXF1ZXN0KHJlcXVlc3Q6IEF1ZGlvVXBsb2FkUmVxdWVzdCk6IFZhbGlkYXRpb25SZXN1bHQge1xyXG4gIGlmICghcmVxdWVzdC5hdWRpb0RhdGEpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0F1ZGlvIGRhdGEgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICBpZiAoIXJlcXVlc3QuY29udGVudFR5cGUpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0NvbnRlbnQgdHlwZSBpcyByZXF1aXJlZCcgfTtcclxuICB9XHJcblxyXG4gIGlmICghcmVxdWVzdC51c2VySWQpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1VzZXIgSUQgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICAvLyBWYWxpZGF0ZSBjb250ZW50IHR5cGVcclxuICBjb25zdCBzdXBwb3J0ZWRUeXBlcyA9IFsnYXVkaW8vd2F2JywgJ2F1ZGlvL21wMycsICdhdWRpby9tcGVnJywgJ2F1ZGlvL21wNCcsICdhdWRpby93ZWJtJ107XHJcbiAgaWYgKCFzdXBwb3J0ZWRUeXBlcy5pbmNsdWRlcyhyZXF1ZXN0LmNvbnRlbnRUeXBlKSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiBgVW5zdXBwb3J0ZWQgY29udGVudCB0eXBlOiAke3JlcXVlc3QuY29udGVudFR5cGV9LiBTdXBwb3J0ZWQgdHlwZXM6ICR7c3VwcG9ydGVkVHlwZXMuam9pbignLCAnKX1gIH07XHJcbiAgfVxyXG5cclxuICAvLyBWYWxpZGF0ZSBiYXNlNjQgZm9ybWF0XHJcbiAgdHJ5IHtcclxuICAgIEJ1ZmZlci5mcm9tKHJlcXVlc3QuYXVkaW9EYXRhLCAnYmFzZTY0Jyk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0ludmFsaWQgYmFzZTY0IGF1ZGlvIGRhdGEnIH07XHJcbiAgfVxyXG5cclxuICByZXR1cm4geyBpc1ZhbGlkOiB0cnVlIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHZhbGlkYXRlVGV4dElucHV0UmVxdWVzdChyZXF1ZXN0OiBUZXh0SW5wdXRSZXF1ZXN0KTogVmFsaWRhdGlvblJlc3VsdCB7XHJcbiAgaWYgKCFyZXF1ZXN0LnRleHQpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1RleHQgaXMgcmVxdWlyZWQnIH07XHJcbiAgfVxyXG5cclxuICBpZiAoIXJlcXVlc3QudXNlcklkKSB7XHJcbiAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgZXJyb3I6ICdVc2VyIElEIGlzIHJlcXVpcmVkJyB9O1xyXG4gIH1cclxuXHJcbiAgLy8gVmFsaWRhdGUgdGV4dCBsZW5ndGggKDEtMTAwMDAgY2hhcmFjdGVycylcclxuICBpZiAocmVxdWVzdC50ZXh0Lmxlbmd0aCA8IDEpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1RleHQgbXVzdCBiZSBhdCBsZWFzdCAxIGNoYXJhY3RlciBsb25nJyB9O1xyXG4gIH1cclxuXHJcbiAgaWYgKHJlcXVlc3QudGV4dC5sZW5ndGggPiAxMDAwMCkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiAnVGV4dCBtdXN0IGJlIG5vIG1vcmUgdGhhbiAxMCwwMDAgY2hhcmFjdGVycyBsb25nJyB9O1xyXG4gIH1cclxuXHJcbiAgLy8gQmFzaWMgY29udGVudCB2YWxpZGF0aW9uXHJcbiAgY29uc3QgdHJpbW1lZFRleHQgPSByZXF1ZXN0LnRleHQudHJpbSgpO1xyXG4gIGlmICh0cmltbWVkVGV4dC5sZW5ndGggPT09IDApIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogJ1RleHQgY2Fubm90IGJlIGVtcHR5IG9yIG9ubHkgd2hpdGVzcGFjZScgfTtcclxuICB9XHJcblxyXG4gIHJldHVybiB7IGlzVmFsaWQ6IHRydWUgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRhdGVBdWRpb1F1YWxpdHkoYXVkaW9CdWZmZXI6IEJ1ZmZlciwgY29udGVudFR5cGU6IHN0cmluZyk6IFZhbGlkYXRpb25SZXN1bHQge1xyXG4gIC8vIEJhc2ljIGZpbGUgc2l6ZSB2YWxpZGF0aW9uICgxS0IgdG8gMjVNQilcclxuICBjb25zdCBtaW5TaXplID0gMTAyNDsgLy8gMUtCXHJcbiAgY29uc3QgbWF4U2l6ZSA9IDI1ICogMTAyNCAqIDEwMjQ7IC8vIDI1TUJcclxuXHJcbiAgaWYgKGF1ZGlvQnVmZmVyLmxlbmd0aCA8IG1pblNpemUpIHtcclxuICAgIHJldHVybiB7IGlzVmFsaWQ6IGZhbHNlLCBlcnJvcjogYEF1ZGlvIGZpbGUgdG9vIHNtYWxsICgke2F1ZGlvQnVmZmVyLmxlbmd0aH0gYnl0ZXMpLiBNaW5pbXVtIHNpemU6ICR7bWluU2l6ZX0gYnl0ZXNgIH07XHJcbiAgfVxyXG5cclxuICBpZiAoYXVkaW9CdWZmZXIubGVuZ3RoID4gbWF4U2l6ZSkge1xyXG4gICAgcmV0dXJuIHsgaXNWYWxpZDogZmFsc2UsIGVycm9yOiBgQXVkaW8gZmlsZSB0b28gbGFyZ2UgKCR7YXVkaW9CdWZmZXIubGVuZ3RofSBieXRlcykuIE1heGltdW0gc2l6ZTogJHttYXhTaXplfSBieXRlc2AgfTtcclxuICB9XHJcblxyXG4gIC8vIEJhc2ljIGZvcm1hdCB2YWxpZGF0aW9uIGJhc2VkIG9uIGZpbGUgaGVhZGVyc1xyXG4gIGNvbnN0IGlzVmFsaWRGb3JtYXQgPSB2YWxpZGF0ZUF1ZGlvRm9ybWF0KGF1ZGlvQnVmZmVyLCBjb250ZW50VHlwZSk7XHJcbiAgaWYgKCFpc1ZhbGlkRm9ybWF0KSB7XHJcbiAgICByZXR1cm4geyBpc1ZhbGlkOiBmYWxzZSwgZXJyb3I6IGBJbnZhbGlkIGF1ZGlvIGZvcm1hdCBmb3IgY29udGVudCB0eXBlOiAke2NvbnRlbnRUeXBlfWAgfTtcclxuICB9XHJcblxyXG4gIHJldHVybiB7IGlzVmFsaWQ6IHRydWUgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gdmFsaWRhdGVBdWRpb0Zvcm1hdChhdWRpb0J1ZmZlcjogQnVmZmVyLCBjb250ZW50VHlwZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgLy8gQmFzaWMgZmlsZSBzaWduYXR1cmUgdmFsaWRhdGlvblxyXG4gIGNvbnN0IGhlYWRlciA9IGF1ZGlvQnVmZmVyLnN1YmFycmF5KDAsIDEyKTtcclxuXHJcbiAgc3dpdGNoIChjb250ZW50VHlwZSkge1xyXG4gICAgY2FzZSAnYXVkaW8vd2F2JzpcclxuICAgICAgLy8gV0FWIGZpbGVzIHN0YXJ0IHdpdGggXCJSSUZGXCIgYW5kIGNvbnRhaW4gXCJXQVZFXCJcclxuICAgICAgcmV0dXJuIGhlYWRlci5zdWJhcnJheSgwLCA0KS50b1N0cmluZygpID09PSAnUklGRicgJiYgaGVhZGVyLnN1YmFycmF5KDgsIDEyKS50b1N0cmluZygpID09PSAnV0FWRSc7XHJcbiAgICBcclxuICAgIGNhc2UgJ2F1ZGlvL21wMyc6XHJcbiAgICBjYXNlICdhdWRpby9tcGVnJzpcclxuICAgICAgLy8gTVAzIGZpbGVzIHN0YXJ0IHdpdGggSUQzIHRhZyBvciBNUDMgZnJhbWUgc3luY1xyXG4gICAgICByZXR1cm4gaGVhZGVyWzBdID09PSAweDQ5ICYmIGhlYWRlclsxXSA9PT0gMHg0NCAmJiBoZWFkZXJbMl0gPT09IDB4MzMgfHwgLy8gSUQzXHJcbiAgICAgICAgICAgICBoZWFkZXJbMF0gPT09IDB4RkYgJiYgKGhlYWRlclsxXSAmIDB4RTApID09PSAweEUwOyAvLyBNUDMgZnJhbWUgc3luY1xyXG4gICAgXHJcbiAgICBjYXNlICdhdWRpby9tcDQnOlxyXG4gICAgICAvLyBNUDQgZmlsZXMgY29udGFpbiBcImZ0eXBcIiBib3hcclxuICAgICAgcmV0dXJuIGhlYWRlci5zdWJhcnJheSg0LCA4KS50b1N0cmluZygpID09PSAnZnR5cCc7XHJcbiAgICBcclxuICAgIGNhc2UgJ2F1ZGlvL3dlYm0nOlxyXG4gICAgICAvLyBXZWJNIGZpbGVzIHN0YXJ0IHdpdGggRUJNTCBoZWFkZXJcclxuICAgICAgcmV0dXJuIGhlYWRlclswXSA9PT0gMHgxQSAmJiBoZWFkZXJbMV0gPT09IDB4NDUgJiYgaGVhZGVyWzJdID09PSAweERGICYmIGhlYWRlclszXSA9PT0gMHhBMztcclxuICAgIFxyXG4gICAgZGVmYXVsdDpcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxufVxyXG5cclxuLy8gSGVscGVyIGZ1bmN0aW9uc1xyXG5mdW5jdGlvbiBnZXRGaWxlRXh0ZW5zaW9uKGNvbnRlbnRUeXBlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIHN3aXRjaCAoY29udGVudFR5cGUpIHtcclxuICAgIGNhc2UgJ2F1ZGlvL3dhdic6IHJldHVybiAnd2F2JztcclxuICAgIGNhc2UgJ2F1ZGlvL21wMyc6XHJcbiAgICBjYXNlICdhdWRpby9tcGVnJzogcmV0dXJuICdtcDMnO1xyXG4gICAgY2FzZSAnYXVkaW8vbXA0JzogcmV0dXJuICdtcDQnO1xyXG4gICAgY2FzZSAnYXVkaW8vd2VibSc6IHJldHVybiAnd2VibSc7XHJcbiAgICBkZWZhdWx0OiByZXR1cm4gJ2F1ZGlvJztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGdldE1lZGlhRm9ybWF0KGNvbnRlbnRUeXBlOiBzdHJpbmcpOiBNZWRpYUZvcm1hdCB7XHJcbiAgc3dpdGNoIChjb250ZW50VHlwZSkge1xyXG4gICAgY2FzZSAnYXVkaW8vd2F2JzogcmV0dXJuIE1lZGlhRm9ybWF0LldBVjtcclxuICAgIGNhc2UgJ2F1ZGlvL21wMyc6XHJcbiAgICBjYXNlICdhdWRpby9tcGVnJzogcmV0dXJuIE1lZGlhRm9ybWF0Lk1QMztcclxuICAgIGNhc2UgJ2F1ZGlvL21wNCc6IHJldHVybiBNZWRpYUZvcm1hdC5NUDQ7XHJcbiAgICBjYXNlICdhdWRpby93ZWJtJzogcmV0dXJuIE1lZGlhRm9ybWF0LldFQk07XHJcbiAgICBkZWZhdWx0OiByZXR1cm4gTWVkaWFGb3JtYXQuV0FWO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcHJlcHJvY2Vzc1RleHRJbnB1dCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIC8vIENsZWFuIGFuZCBub3JtYWxpemUgdGV4dCBpbnB1dFxyXG4gIGxldCBwcm9jZXNzZWQgPSB0ZXh0LnRyaW0oKTtcclxuICBcclxuICAvLyBSZW1vdmUgZXhjZXNzaXZlIHdoaXRlc3BhY2VcclxuICBwcm9jZXNzZWQgPSBwcm9jZXNzZWQucmVwbGFjZSgvXFxzKy9nLCAnICcpO1xyXG4gIFxyXG4gIC8vIE5vcm1hbGl6ZSBsaW5lIGJyZWFrc1xyXG4gIHByb2Nlc3NlZCA9IHByb2Nlc3NlZC5yZXBsYWNlKC9cXHJcXG4vZywgJ1xcbicpLnJlcGxhY2UoL1xcci9nLCAnXFxuJyk7XHJcbiAgXHJcbiAgLy8gUmVtb3ZlIGV4Y2Vzc2l2ZSBsaW5lIGJyZWFrcyAobW9yZSB0aGFuIDIgY29uc2VjdXRpdmUpXHJcbiAgcHJvY2Vzc2VkID0gcHJvY2Vzc2VkLnJlcGxhY2UoL1xcbnszLH0vZywgJ1xcblxcbicpO1xyXG4gIFxyXG4gIC8vIEJhc2ljIHNlbnRlbmNlIHN0cnVjdHVyZSBpbXByb3ZlbWVudHNcclxuICBwcm9jZXNzZWQgPSBwcm9jZXNzZWQucmVwbGFjZSgvKFsuIT9dKVxccyooW2Etel0pL2csICckMSAkMicpO1xyXG4gIFxyXG4gIHJldHVybiBwcm9jZXNzZWQ7XHJcbn0iXX0=