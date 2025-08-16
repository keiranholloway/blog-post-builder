import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand, MediaFormat } from '@aws-sdk/client-transcribe';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';

interface ErrorResponse {
  error: string;
  message: string;
  requestId?: string;
}

interface SuccessResponse {
  message: string;
  data?: any;
}

interface AudioUploadRequest {
  audioData: string; // Base64 encoded audio
  contentType: string;
  userId: string;
}

interface TextInputRequest {
  text: string;
  userId: string;
}

interface InputProcessingResult {
  id: string;
  userId: string;
  type: 'audio' | 'text';
  status: 'processing' | 'completed' | 'failed';
  originalInput?: string;
  transcription?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// Initialize AWS clients
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });

const AUDIO_BUCKET = process.env.AUDIO_BUCKET_NAME!;
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME!;
const EVENT_BUS = process.env.EVENT_BUS_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Input Processor Event:', JSON.stringify(event, null, 2));

  // Allowed origins for CORS
  const allowedOrigins = [
    'https://keiranholloway.github.io',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  
  const requestOrigin = event.headers.origin || event.headers.Origin;
  const allowedOrigin = allowedOrigins.includes(requestOrigin || '') ? requestOrigin! : allowedOrigins[0];

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
      return await getInputStatus(inputId!, corsHeaders);
    }

    // Route: POST /api/input/transcription-callback - Handle Transcribe callback
    if (method === 'POST' && path === '/api/input/transcription-callback') {
      return await handleTranscriptionCallback(event, corsHeaders);
    }

    // Default 404 for unmatched routes
    const errorResponse: ErrorResponse = {
      error: 'Not Found',
      message: `Route ${method} ${path} not found`,
      requestId: context.awsRequestId,
    };

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify(errorResponse),
    };

  } catch (error) {
    console.error('Unhandled error in input processor:', error);

    const errorResponse: ErrorResponse = {
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

// Audio upload handler
async function handleAudioUpload(
  event: APIGatewayProxyEvent,
  context: Context,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    console.log('Environment variables:', {
      CONTENT_TABLE: CONTENT_TABLE,
      AUDIO_BUCKET: AUDIO_BUCKET,
      EVENT_BUS: EVENT_BUS
    });
    
    if (!event.body) {
      throw new Error('Request body is required');
    }

    const request: AudioUploadRequest = JSON.parse(event.body);
    
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
    const inputId = uuidv4();
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
    await s3Client.send(new PutObjectCommand({
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
    const inputRecord: InputProcessingResult = {
      id: inputId,
      userId: request.userId,
      type: 'audio',
      status: 'processing',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await dynamoClient.send(new PutItemCommand({
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

    await transcribeClient.send(new StartTranscriptionJobCommand({
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
    await eventBridgeClient.send(new PutEventsCommand({
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

    const response: SuccessResponse = {
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

  } catch (error) {
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
async function handleTextInput(
  event: APIGatewayProxyEvent,
  context: Context,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    console.log('Text input - Environment variables:', {
      CONTENT_TABLE: CONTENT_TABLE,
      EVENT_BUS: EVENT_BUS
    });
    
    if (!event.body) {
      throw new Error('Request body is required');
    }

    const request: TextInputRequest = JSON.parse(event.body);
    
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
    const inputId = uuidv4();
    const timestamp = new Date().toISOString();

    // Preprocess text input
    const processedText = preprocessTextInput(request.text);

    // Create record in DynamoDB
    const inputRecord: InputProcessingResult = {
      id: inputId,
      userId: request.userId,
      type: 'text',
      status: 'completed',
      originalInput: request.text,
      transcription: processedText,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const item: Record<string, any> = {
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

    await dynamoClient.send(new PutItemCommand({
      TableName: CONTENT_TABLE,
      Item: item,
    }));

    // Publish event for text processing completed
    await eventBridgeClient.send(new PutEventsCommand({
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

    const response: SuccessResponse = {
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

  } catch (error) {
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
async function getInputStatus(
  inputId: string,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    // Get record from DynamoDB
    const result = await dynamoClient.send(new GetItemCommand({
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

    const inputRecord: InputProcessingResult = {
      id: result.Item.id.S!,
      userId: result.Item.userId.S!,
      type: result.Item.type.S! as 'audio' | 'text',
      status: result.Item.status.S! as 'processing' | 'completed' | 'failed',
      originalInput: result.Item.originalInput?.S,
      transcription: result.Item.transcription?.S,
      error: result.Item.error?.S,
      createdAt: result.Item.createdAt.S!,
      updatedAt: result.Item.updatedAt.S!,
    };

    // If audio processing is still in progress, check transcription job status
    if (inputRecord.type === 'audio' && inputRecord.status === 'processing') {
      const transcriptionJobName = `transcription-${inputId}`;
      try {
        const transcriptionResult = await transcribeClient.send(new GetTranscriptionJobCommand({
          TranscriptionJobName: transcriptionJobName,
        }));

        if (transcriptionResult.TranscriptionJob?.TranscriptionJobStatus === 'COMPLETED') {
          // Update record with completed transcription
          await updateTranscriptionResult(inputId, transcriptionResult.TranscriptionJob.Transcript?.TranscriptFileUri!);
          inputRecord.status = 'completed';
        } else if (transcriptionResult.TranscriptionJob?.TranscriptionJobStatus === 'FAILED') {
          // Update record with failure
          await updateTranscriptionError(inputId, transcriptionResult.TranscriptionJob.FailureReason || 'Transcription failed');
          inputRecord.status = 'failed';
          inputRecord.error = transcriptionResult.TranscriptionJob.FailureReason || 'Transcription failed';
        }
      } catch (transcribeError) {
        console.error('Error checking transcription status:', transcribeError);
        // Don't fail the status check if transcription check fails
      }
    }

    const response: SuccessResponse = {
      message: 'Input status retrieved successfully',
      data: inputRecord,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error in getInputStatus:', error);
    throw error;
  }
}

// Handle transcription callback (for webhook-based updates)
async function handleTranscriptionCallback(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
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

  } catch (error) {
    console.error('Error in handleTranscriptionCallback:', error);
    throw error;
  }
}

// Update transcription result in DynamoDB
async function updateTranscriptionResult(inputId: string, transcriptFileUri: string): Promise<void> {
  try {
    // Download transcription result from S3
    const transcriptKey = transcriptFileUri.split('/').slice(3).join('/'); // Remove s3://bucket-name/
    const transcriptResult = await s3Client.send(new GetObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: transcriptKey,
    }));

    const transcriptData = JSON.parse(await transcriptResult.Body!.transformToString());
    const transcription = transcriptData.results.transcripts[0].transcript;

    // Update DynamoDB record
    await dynamoClient.send(new UpdateItemCommand({
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
    await eventBridgeClient.send(new PutEventsCommand({
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

  } catch (error) {
    console.error('Error updating transcription result:', error);
    await updateTranscriptionError(inputId, `Failed to process transcription: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Update transcription error in DynamoDB
async function updateTranscriptionError(inputId: string, errorMessage: string): Promise<void> {
  await dynamoClient.send(new UpdateItemCommand({
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

// Validation functions
interface ValidationResult {
  isValid: boolean;
  error?: string;
}

function validateAudioUploadRequest(request: AudioUploadRequest): ValidationResult {
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
  } catch (error) {
    return { isValid: false, error: 'Invalid base64 audio data' };
  }

  return { isValid: true };
}

function validateTextInputRequest(request: TextInputRequest): ValidationResult {
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

function validateAudioQuality(audioBuffer: Buffer, contentType: string): ValidationResult {
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

function validateAudioFormat(audioBuffer: Buffer, contentType: string): boolean {
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
function getFileExtension(contentType: string): string {
  switch (contentType) {
    case 'audio/wav': return 'wav';
    case 'audio/mp3':
    case 'audio/mpeg': return 'mp3';
    case 'audio/mp4': return 'mp4';
    case 'audio/webm': return 'webm';
    default: return 'audio';
  }
}

function getMediaFormat(contentType: string): MediaFormat {
  switch (contentType) {
    case 'audio/wav': return MediaFormat.WAV;
    case 'audio/mp3':
    case 'audio/mpeg': return MediaFormat.MP3;
    case 'audio/mp4': return MediaFormat.MP4;
    case 'audio/webm': return MediaFormat.WEBM;
    default: return MediaFormat.WAV;
  }
}

function preprocessTextInput(text: string): string {
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