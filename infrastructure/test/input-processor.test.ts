import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: jest.fn(),
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-transcribe', () => ({
  TranscribeClient: jest.fn(() => ({
    send: jest.fn(),
  })),
  StartTranscriptionJobCommand: jest.fn(),
  GetTranscriptionJobCommand: jest.fn(),
  MediaFormat: {
    WAV: 'wav',
    MP3: 'mp3',
    MP4: 'mp4',
    WEBM: 'webm',
  },
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: jest.fn(),
  })),
  PutItemCommand: jest.fn(),
  UpdateItemCommand: jest.fn(),
  GetItemCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({
    send: jest.fn(),
  })),
  PutEventsCommand: jest.fn(),
}));

// Mock UUID
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-123'),
}));

import { handler } from '../lambda/input-processor';
import { S3Client } from '@aws-sdk/client-s3';
import { TranscribeClient } from '@aws-sdk/client-transcribe';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

describe('Input Processor Lambda', () => {
  let mockS3Send: jest.Mock;
  let mockTranscribeSend: jest.Mock;
  let mockDynamoSend: jest.Mock;
  let mockEventBridgeSend: jest.Mock;
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '512',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2023/01/01/[$LATEST]test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
  };

  // Set environment variables
  beforeAll(() => {
    process.env.AUDIO_BUCKET_NAME = 'test-audio-bucket';
    process.env.CONTENT_TABLE_NAME = 'test-content-table';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
    process.env.AWS_REGION = 'us-east-1';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get mock functions from the mocked clients
    const s3Client = new S3Client({});
    const transcribeClient = new TranscribeClient({});
    const dynamoClient = new DynamoDBClient({});
    const eventBridgeClient = new EventBridgeClient({});
    
    mockS3Send = s3Client.send as jest.Mock;
    mockTranscribeSend = transcribeClient.send as jest.Mock;
    mockDynamoSend = dynamoClient.send as jest.Mock;
    mockEventBridgeSend = eventBridgeClient.send as jest.Mock;
  });

  describe('OPTIONS requests', () => {
    it('should handle preflight OPTIONS requests', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'OPTIONS',
        path: '/api/input/audio',
        headers: { origin: 'https://example.github.io' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: null,
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
      expect(result.body).toBe('');
    });
  });

  describe('Audio upload endpoint', () => {
    it('should successfully process audio upload', async () => {
      // Create a proper WAV file header
      const wavHeader = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        0x24, 0x08, 0x00, 0x00, // File size
        0x57, 0x41, 0x56, 0x45, // "WAVE"
        0x66, 0x6D, 0x74, 0x20, // "fmt "
        0x10, 0x00, 0x00, 0x00, // Subchunk1Size
        0x01, 0x00, 0x02, 0x00, // AudioFormat, NumChannels
        0x44, 0xAC, 0x00, 0x00, // SampleRate
        0x10, 0xB1, 0x02, 0x00, // ByteRate
        0x04, 0x00, 0x10, 0x00, // BlockAlign, BitsPerSample
        0x64, 0x61, 0x74, 0x61, // "data"
        0x00, 0x08, 0x00, 0x00, // Subchunk2Size
      ]);
      const audioData = wavHeader.toString('base64');
      
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/audio',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          audioData,
          contentType: 'audio/wav',
          userId: 'test-user-123',
        }),
        isBase64Encoded: false,
      };

      // Mock successful AWS service calls
      mockS3Send.mockResolvedValue({});
      mockDynamoSend.mockResolvedValue({});
      mockTranscribeSend.mockResolvedValue({});
      mockEventBridgeSend.mockResolvedValue({});

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(202);
      expect(JSON.parse(result.body)).toMatchObject({
        message: 'Audio upload successful, processing started',
        data: {
          inputId: 'test-uuid-123',
          status: 'processing',
        },
      });

      // Verify AWS service calls
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      expect(mockDynamoSend).toHaveBeenCalledTimes(1);
      expect(mockTranscribeSend).toHaveBeenCalledTimes(1);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    });

    it('should reject invalid audio upload request', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/audio',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          audioData: '', // Empty audio data
          contentType: 'audio/wav',
          userId: 'test-user-123',
        }),
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Validation Error',
        message: 'Audio data is required',
      });
    });

    it('should reject unsupported content type', async () => {
      const audioData = Buffer.from('test audio data').toString('base64');
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/audio',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          audioData,
          contentType: 'audio/unsupported',
          userId: 'test-user-123',
        }),
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Validation Error',
        message: expect.stringContaining('Unsupported content type'),
      });
    });
  });

  describe('Text input endpoint', () => {
    it('should successfully process text input', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/text',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          text: 'This is a test blog post idea about artificial intelligence and its impact on society.',
          userId: 'test-user-123',
        }),
        isBase64Encoded: false,
      };

      // Mock successful AWS service calls
      mockDynamoSend.mockResolvedValue({});
      mockEventBridgeSend.mockResolvedValue({});

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        message: 'Text input processed successfully',
        data: {
          inputId: 'test-uuid-123',
          status: 'completed',
          transcription: expect.any(String),
        },
      });

      // Verify AWS service calls
      expect(mockDynamoSend).toHaveBeenCalledTimes(1);
      expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
    });

    it('should reject empty text input', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/text',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          text: '',
          userId: 'test-user-123',
        }),
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Validation Error',
        message: 'Text is required',
      });
    });

    it('should reject text that is too long', async () => {
      const longText = 'a'.repeat(10001); // Exceeds 10,000 character limit
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/text',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          text: longText,
          userId: 'test-user-123',
        }),
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Validation Error',
        message: 'Text must be no more than 10,000 characters long',
      });
    });
  });

  describe('Status endpoint', () => {
    it('should return input status for existing input', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: '/api/input/status/test-uuid-123',
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: null,
        isBase64Encoded: false,
      };

      // Mock DynamoDB response - need to return the result object properly
      mockDynamoSend.mockResolvedValueOnce({
        Item: {
          id: { S: 'test-uuid-123' },
          userId: { S: 'test-user-123' },
          type: { S: 'text' },
          status: { S: 'completed' },
          transcription: { S: 'Test transcription' },
          createdAt: { S: '2023-01-01T00:00:00.000Z' },
          updatedAt: { S: '2023-01-01T00:00:00.000Z' },
        },
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toMatchObject({
        message: 'Input status retrieved successfully',
        data: {
          id: 'test-uuid-123',
          userId: 'test-user-123',
          type: 'text',
          status: 'completed',
          transcription: 'Test transcription',
        },
      });
    });

    it('should return 404 for non-existent input', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: '/api/input/status/non-existent-id',
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: null,
        isBase64Encoded: false,
      };

      // Mock DynamoDB response for non-existent item - return empty object without Item
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Not Found',
        message: 'Input with ID non-existent-id not found',
      });
    });
  });

  describe('Error handling', () => {
    it('should handle AWS service errors gracefully', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/text',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          text: 'Test text',
          userId: 'test-user-123',
        }),
        isBase64Encoded: false,
      };

      // Mock DynamoDB error - first call fails
      mockDynamoSend.mockRejectedValueOnce(new Error('DynamoDB connection failed'));

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Internal Server Error',
        message: 'DynamoDB connection failed',
      });
    });

    it('should handle malformed JSON in request body', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/text',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: '{ invalid json }',
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Internal Server Error',
        message: expect.stringContaining('JSON'),
      });
    });
  });

  describe('Route handling', () => {
    it('should return 404 for unknown routes', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: '/api/unknown-route',
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: null,
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Not Found',
        message: 'Route GET /api/unknown-route not found',
      });
    });
  });
});