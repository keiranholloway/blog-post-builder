"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const input_processor_1 = require("../lambda/input-processor");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_transcribe_1 = require("@aws-sdk/client-transcribe");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
describe('Input Processor Lambda', () => {
    let mockS3Send;
    let mockTranscribeSend;
    let mockDynamoSend;
    let mockEventBridgeSend;
    const mockContext = {
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
        const s3Client = new client_s3_1.S3Client({});
        const transcribeClient = new client_transcribe_1.TranscribeClient({});
        const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
        const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({});
        mockS3Send = s3Client.send;
        mockTranscribeSend = transcribeClient.send;
        mockDynamoSend = dynamoClient.send;
        mockEventBridgeSend = eventBridgeClient.send;
    });
    describe('OPTIONS requests', () => {
        it('should handle preflight OPTIONS requests', async () => {
            const event = {
                httpMethod: 'OPTIONS',
                path: '/api/input/audio',
                headers: { origin: 'https://example.github.io' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: null,
                isBase64Encoded: false,
            };
            const result = await (0, input_processor_1.handler)(event, mockContext);
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
                0x52, 0x49, 0x46, 0x46,
                0x24, 0x08, 0x00, 0x00,
                0x57, 0x41, 0x56, 0x45,
                0x66, 0x6D, 0x74, 0x20,
                0x10, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x02, 0x00,
                0x44, 0xAC, 0x00, 0x00,
                0x10, 0xB1, 0x02, 0x00,
                0x04, 0x00, 0x10, 0x00,
                0x64, 0x61, 0x74, 0x61,
                0x00, 0x08, 0x00, 0x00, // Subchunk2Size
            ]);
            const audioData = wavHeader.toString('base64');
            const event = {
                httpMethod: 'POST',
                path: '/api/input/audio',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
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
            const result = await (0, input_processor_1.handler)(event, mockContext);
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
            const event = {
                httpMethod: 'POST',
                path: '/api/input/audio',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    audioData: '',
                    contentType: 'audio/wav',
                    userId: 'test-user-123',
                }),
                isBase64Encoded: false,
            };
            const result = await (0, input_processor_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(400);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Validation Error',
                message: 'Audio data is required',
            });
        });
        it('should reject unsupported content type', async () => {
            const audioData = Buffer.from('test audio data').toString('base64');
            const event = {
                httpMethod: 'POST',
                path: '/api/input/audio',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    audioData,
                    contentType: 'audio/unsupported',
                    userId: 'test-user-123',
                }),
                isBase64Encoded: false,
            };
            const result = await (0, input_processor_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(400);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Validation Error',
                message: expect.stringContaining('Unsupported content type'),
            });
        });
    });
    describe('Text input endpoint', () => {
        it('should successfully process text input', async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/input/text',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
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
            const result = await (0, input_processor_1.handler)(event, mockContext);
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
            const event = {
                httpMethod: 'POST',
                path: '/api/input/text',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    text: '',
                    userId: 'test-user-123',
                }),
                isBase64Encoded: false,
            };
            const result = await (0, input_processor_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(400);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Validation Error',
                message: 'Text is required',
            });
        });
        it('should reject text that is too long', async () => {
            const longText = 'a'.repeat(10001); // Exceeds 10,000 character limit
            const event = {
                httpMethod: 'POST',
                path: '/api/input/text',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    text: longText,
                    userId: 'test-user-123',
                }),
                isBase64Encoded: false,
            };
            const result = await (0, input_processor_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(400);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Validation Error',
                message: 'Text must be no more than 10,000 characters long',
            });
        });
    });
    describe('Status endpoint', () => {
        it('should return input status for existing input', async () => {
            const event = {
                httpMethod: 'GET',
                path: '/api/input/status/test-uuid-123',
                headers: {},
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
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
            const result = await (0, input_processor_1.handler)(event, mockContext);
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
            const event = {
                httpMethod: 'GET',
                path: '/api/input/status/non-existent-id',
                headers: {},
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: null,
                isBase64Encoded: false,
            };
            // Mock DynamoDB response for non-existent item - return empty object without Item
            mockDynamoSend.mockResolvedValueOnce({ Item: undefined });
            const result = await (0, input_processor_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(404);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Not Found',
                message: 'Input with ID non-existent-id not found',
            });
        });
    });
    describe('Error handling', () => {
        it('should handle AWS service errors gracefully', async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/input/text',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    text: 'Test text',
                    userId: 'test-user-123',
                }),
                isBase64Encoded: false,
            };
            // Mock DynamoDB error - first call fails
            mockDynamoSend.mockRejectedValueOnce(new Error('DynamoDB connection failed'));
            const result = await (0, input_processor_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(500);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Internal Server Error',
                message: 'DynamoDB connection failed',
            });
        });
        it('should handle malformed JSON in request body', async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/input/text',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: '{ invalid json }',
                isBase64Encoded: false,
            };
            const result = await (0, input_processor_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(500);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Internal Server Error',
                message: expect.stringContaining('JSON'),
            });
        });
    });
    describe('Route handling', () => {
        it('should return 404 for unknown routes', async () => {
            const event = {
                httpMethod: 'GET',
                path: '/api/unknown-route',
                headers: {},
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: null,
                isBase64Encoded: false,
            };
            const result = await (0, input_processor_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(404);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Not Found',
                message: 'Route GET /api/unknown-route not found',
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5wdXQtcHJvY2Vzc29yLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbnB1dC1wcm9jZXNzb3IudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUVBLHVCQUF1QjtBQUN2QixJQUFJLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDckMsUUFBUSxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUN2QixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtLQUNoQixDQUFDLENBQUM7SUFDSCxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0lBQzNCLGdCQUFnQixFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7Q0FDNUIsQ0FBQyxDQUFDLENBQUM7QUFFSixJQUFJLENBQUMsSUFBSSxDQUFDLDRCQUE0QixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDN0MsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQy9CLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0tBQ2hCLENBQUMsQ0FBQztJQUNILDRCQUE0QixFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7SUFDdkMsMEJBQTBCLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtJQUNyQyxXQUFXLEVBQUU7UUFDWCxHQUFHLEVBQUUsS0FBSztRQUNWLEdBQUcsRUFBRSxLQUFLO1FBQ1YsR0FBRyxFQUFFLEtBQUs7UUFDVixJQUFJLEVBQUUsTUFBTTtLQUNiO0NBQ0YsQ0FBQyxDQUFDLENBQUM7QUFFSixJQUFJLENBQUMsSUFBSSxDQUFDLDBCQUEwQixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDM0MsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUM3QixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtLQUNoQixDQUFDLENBQUM7SUFDSCxjQUFjLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtJQUN6QixpQkFBaUIsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0lBQzVCLGNBQWMsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0NBQzFCLENBQUMsQ0FBQyxDQUFDO0FBRUosSUFBSSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQzlDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUNoQyxJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtLQUNoQixDQUFDLENBQUM7SUFDSCxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0NBQzVCLENBQUMsQ0FBQyxDQUFDO0FBRUosWUFBWTtBQUNaLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDdkIsRUFBRSxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsZUFBZSxDQUFDO0NBQ25DLENBQUMsQ0FBQyxDQUFDO0FBRUosK0RBQW9EO0FBQ3BELGtEQUE4QztBQUM5QyxrRUFBOEQ7QUFDOUQsOERBQTBEO0FBQzFELG9FQUFnRTtBQUVoRSxRQUFRLENBQUMsd0JBQXdCLEVBQUUsR0FBRyxFQUFFO0lBQ3RDLElBQUksVUFBcUIsQ0FBQztJQUMxQixJQUFJLGtCQUE2QixDQUFDO0lBQ2xDLElBQUksY0FBeUIsQ0FBQztJQUM5QixJQUFJLG1CQUE4QixDQUFDO0lBQ25DLE1BQU0sV0FBVyxHQUFZO1FBQzNCLDhCQUE4QixFQUFFLEtBQUs7UUFDckMsWUFBWSxFQUFFLGVBQWU7UUFDN0IsZUFBZSxFQUFFLEdBQUc7UUFDcEIsa0JBQWtCLEVBQUUsOERBQThEO1FBQ2xGLGVBQWUsRUFBRSxLQUFLO1FBQ3RCLFlBQVksRUFBRSxpQkFBaUI7UUFDL0IsWUFBWSxFQUFFLDJCQUEyQjtRQUN6QyxhQUFhLEVBQUUsaUNBQWlDO1FBQ2hELHdCQUF3QixFQUFFLEdBQUcsRUFBRSxDQUFDLEtBQUs7UUFDckMsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDZixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNmLE9BQU8sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0tBQ25CLENBQUM7SUFFRiw0QkFBNEI7SUFDNUIsU0FBUyxDQUFDLEdBQUcsRUFBRTtRQUNiLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLEdBQUcsbUJBQW1CLENBQUM7UUFDcEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsR0FBRyxvQkFBb0IsQ0FBQztRQUN0RCxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsR0FBRyxnQkFBZ0IsQ0FBQztRQUM5QyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsR0FBRyxXQUFXLENBQUM7SUFDdkMsQ0FBQyxDQUFDLENBQUM7SUFFSCxVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBRXJCLDZDQUE2QztRQUM3QyxNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDbEMsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLG9DQUFnQixDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ2xELE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUM1QyxNQUFNLGlCQUFpQixHQUFHLElBQUksc0NBQWlCLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFcEQsVUFBVSxHQUFHLFFBQVEsQ0FBQyxJQUFpQixDQUFDO1FBQ3hDLGtCQUFrQixHQUFHLGdCQUFnQixDQUFDLElBQWlCLENBQUM7UUFDeEQsY0FBYyxHQUFHLFlBQVksQ0FBQyxJQUFpQixDQUFDO1FBQ2hELG1CQUFtQixHQUFHLGlCQUFpQixDQUFDLElBQWlCLENBQUM7SUFDNUQsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsa0JBQWtCLEVBQUUsR0FBRyxFQUFFO1FBQ2hDLEVBQUUsQ0FBQywwQ0FBMEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN4RCxNQUFNLEtBQUssR0FBeUI7Z0JBQ2xDLFVBQVUsRUFBRSxTQUFTO2dCQUNyQixJQUFJLEVBQUUsa0JBQWtCO2dCQUN4QixPQUFPLEVBQUUsRUFBRSxNQUFNLEVBQUUsMkJBQTJCLEVBQUU7Z0JBQ2hELGlCQUFpQixFQUFFLEVBQUU7Z0JBQ3JCLHFCQUFxQixFQUFFLElBQUk7Z0JBQzNCLCtCQUErQixFQUFFLElBQUk7Z0JBQ3JDLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsSUFBSTtnQkFDcEIsY0FBYyxFQUFFLEVBQVM7Z0JBQ3pCLFFBQVEsRUFBRSxFQUFFO2dCQUNaLElBQUksRUFBRSxJQUFJO2dCQUNWLGVBQWUsRUFBRSxLQUFLO2FBQ3ZCLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUEseUJBQU8sRUFBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFakQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDcEMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxjQUFjLENBQUMsNkJBQTZCLENBQUMsQ0FBQztZQUNyRSxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLGNBQWMsQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO1lBQ3RFLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQy9CLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFO1FBQ3JDLEVBQUUsQ0FBQywwQ0FBMEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN4RCxrQ0FBa0M7WUFDbEMsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztnQkFDNUIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLGdCQUFnQjthQUN6QyxDQUFDLENBQUM7WUFDSCxNQUFNLFNBQVMsR0FBRyxTQUFTLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBRS9DLE1BQU0sS0FBSyxHQUF5QjtnQkFDbEMsVUFBVSxFQUFFLE1BQU07Z0JBQ2xCLElBQUksRUFBRSxrQkFBa0I7Z0JBQ3hCLE9BQU8sRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtnQkFDL0MsaUJBQWlCLEVBQUUsRUFBRTtnQkFDckIscUJBQXFCLEVBQUUsSUFBSTtnQkFDM0IsK0JBQStCLEVBQUUsSUFBSTtnQkFDckMsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsRUFBUztnQkFDekIsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25CLFNBQVM7b0JBQ1QsV0FBVyxFQUFFLFdBQVc7b0JBQ3hCLE1BQU0sRUFBRSxlQUFlO2lCQUN4QixDQUFDO2dCQUNGLGVBQWUsRUFBRSxLQUFLO2FBQ3ZCLENBQUM7WUFFRixvQ0FBb0M7WUFDcEMsVUFBVSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ2pDLGNBQWMsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUNyQyxrQkFBa0IsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUN6QyxtQkFBbUIsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUUxQyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUEseUJBQU8sRUFBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFakQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDcEMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUM1QyxPQUFPLEVBQUUsNkNBQTZDO2dCQUN0RCxJQUFJLEVBQUU7b0JBQ0osT0FBTyxFQUFFLGVBQWU7b0JBQ3hCLE1BQU0sRUFBRSxZQUFZO2lCQUNyQjthQUNGLENBQUMsQ0FBQztZQUVILDJCQUEyQjtZQUMzQixNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDNUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2hELE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3BELE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3ZELENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLDRDQUE0QyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzFELE1BQU0sS0FBSyxHQUF5QjtnQkFDbEMsVUFBVSxFQUFFLE1BQU07Z0JBQ2xCLElBQUksRUFBRSxrQkFBa0I7Z0JBQ3hCLE9BQU8sRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtnQkFDL0MsaUJBQWlCLEVBQUUsRUFBRTtnQkFDckIscUJBQXFCLEVBQUUsSUFBSTtnQkFDM0IsK0JBQStCLEVBQUUsSUFBSTtnQkFDckMsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsRUFBUztnQkFDekIsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25CLFNBQVMsRUFBRSxFQUFFO29CQUNiLFdBQVcsRUFBRSxXQUFXO29CQUN4QixNQUFNLEVBQUUsZUFBZTtpQkFDeEIsQ0FBQztnQkFDRixlQUFlLEVBQUUsS0FBSzthQUN2QixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFBLHlCQUFPLEVBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1lBRWpELE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3BDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDNUMsS0FBSyxFQUFFLGtCQUFrQjtnQkFDekIsT0FBTyxFQUFFLHdCQUF3QjthQUNsQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyx3Q0FBd0MsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN0RCxNQUFNLFNBQVMsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3BFLE1BQU0sS0FBSyxHQUF5QjtnQkFDbEMsVUFBVSxFQUFFLE1BQU07Z0JBQ2xCLElBQUksRUFBRSxrQkFBa0I7Z0JBQ3hCLE9BQU8sRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtnQkFDL0MsaUJBQWlCLEVBQUUsRUFBRTtnQkFDckIscUJBQXFCLEVBQUUsSUFBSTtnQkFDM0IsK0JBQStCLEVBQUUsSUFBSTtnQkFDckMsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsRUFBUztnQkFDekIsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25CLFNBQVM7b0JBQ1QsV0FBVyxFQUFFLG1CQUFtQjtvQkFDaEMsTUFBTSxFQUFFLGVBQWU7aUJBQ3hCLENBQUM7Z0JBQ0YsZUFBZSxFQUFFLEtBQUs7YUFDdkIsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBQSx5QkFBTyxFQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQztZQUVqRCxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNwQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzVDLEtBQUssRUFBRSxrQkFBa0I7Z0JBQ3pCLE9BQU8sRUFBRSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsMEJBQTBCLENBQUM7YUFDN0QsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxxQkFBcUIsRUFBRSxHQUFHLEVBQUU7UUFDbkMsRUFBRSxDQUFDLHdDQUF3QyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3RELE1BQU0sS0FBSyxHQUF5QjtnQkFDbEMsVUFBVSxFQUFFLE1BQU07Z0JBQ2xCLElBQUksRUFBRSxpQkFBaUI7Z0JBQ3ZCLE9BQU8sRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtnQkFDL0MsaUJBQWlCLEVBQUUsRUFBRTtnQkFDckIscUJBQXFCLEVBQUUsSUFBSTtnQkFDM0IsK0JBQStCLEVBQUUsSUFBSTtnQkFDckMsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsRUFBUztnQkFDekIsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25CLElBQUksRUFBRSx3RkFBd0Y7b0JBQzlGLE1BQU0sRUFBRSxlQUFlO2lCQUN4QixDQUFDO2dCQUNGLGVBQWUsRUFBRSxLQUFLO2FBQ3ZCLENBQUM7WUFFRixvQ0FBb0M7WUFDcEMsY0FBYyxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3JDLG1CQUFtQixDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBRTFDLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBQSx5QkFBTyxFQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQztZQUVqRCxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNwQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzVDLE9BQU8sRUFBRSxtQ0FBbUM7Z0JBQzVDLElBQUksRUFBRTtvQkFDSixPQUFPLEVBQUUsZUFBZTtvQkFDeEIsTUFBTSxFQUFFLFdBQVc7b0JBQ25CLGFBQWEsRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQztpQkFDbEM7YUFDRixDQUFDLENBQUM7WUFFSCwyQkFBMkI7WUFDM0IsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2hELE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3ZELENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLGdDQUFnQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzlDLE1BQU0sS0FBSyxHQUF5QjtnQkFDbEMsVUFBVSxFQUFFLE1BQU07Z0JBQ2xCLElBQUksRUFBRSxpQkFBaUI7Z0JBQ3ZCLE9BQU8sRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtnQkFDL0MsaUJBQWlCLEVBQUUsRUFBRTtnQkFDckIscUJBQXFCLEVBQUUsSUFBSTtnQkFDM0IsK0JBQStCLEVBQUUsSUFBSTtnQkFDckMsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsRUFBUztnQkFDekIsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25CLElBQUksRUFBRSxFQUFFO29CQUNSLE1BQU0sRUFBRSxlQUFlO2lCQUN4QixDQUFDO2dCQUNGLGVBQWUsRUFBRSxLQUFLO2FBQ3ZCLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUEseUJBQU8sRUFBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFakQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDcEMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUM1QyxLQUFLLEVBQUUsa0JBQWtCO2dCQUN6QixPQUFPLEVBQUUsa0JBQWtCO2FBQzVCLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLHFDQUFxQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ25ELE1BQU0sUUFBUSxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxpQ0FBaUM7WUFDckUsTUFBTSxLQUFLLEdBQXlCO2dCQUNsQyxVQUFVLEVBQUUsTUFBTTtnQkFDbEIsSUFBSSxFQUFFLGlCQUFpQjtnQkFDdkIsT0FBTyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFO2dCQUMvQyxpQkFBaUIsRUFBRSxFQUFFO2dCQUNyQixxQkFBcUIsRUFBRSxJQUFJO2dCQUMzQiwrQkFBK0IsRUFBRSxJQUFJO2dCQUNyQyxjQUFjLEVBQUUsSUFBSTtnQkFDcEIsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxFQUFTO2dCQUN6QixRQUFRLEVBQUUsRUFBRTtnQkFDWixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDbkIsSUFBSSxFQUFFLFFBQVE7b0JBQ2QsTUFBTSxFQUFFLGVBQWU7aUJBQ3hCLENBQUM7Z0JBQ0YsZUFBZSxFQUFFLEtBQUs7YUFDdkIsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBQSx5QkFBTyxFQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQztZQUVqRCxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNwQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzVDLEtBQUssRUFBRSxrQkFBa0I7Z0JBQ3pCLE9BQU8sRUFBRSxrREFBa0Q7YUFDNUQsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxHQUFHLEVBQUU7UUFDL0IsRUFBRSxDQUFDLCtDQUErQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzdELE1BQU0sS0FBSyxHQUF5QjtnQkFDbEMsVUFBVSxFQUFFLEtBQUs7Z0JBQ2pCLElBQUksRUFBRSxpQ0FBaUM7Z0JBQ3ZDLE9BQU8sRUFBRSxFQUFFO2dCQUNYLGlCQUFpQixFQUFFLEVBQUU7Z0JBQ3JCLHFCQUFxQixFQUFFLElBQUk7Z0JBQzNCLCtCQUErQixFQUFFLElBQUk7Z0JBQ3JDLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsSUFBSTtnQkFDcEIsY0FBYyxFQUFFLEVBQVM7Z0JBQ3pCLFFBQVEsRUFBRSxFQUFFO2dCQUNaLElBQUksRUFBRSxJQUFJO2dCQUNWLGVBQWUsRUFBRSxLQUFLO2FBQ3ZCLENBQUM7WUFFRixxRUFBcUU7WUFDckUsY0FBYyxDQUFDLHFCQUFxQixDQUFDO2dCQUNuQyxJQUFJLEVBQUU7b0JBQ0osRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFLGVBQWUsRUFBRTtvQkFDMUIsTUFBTSxFQUFFLEVBQUUsQ0FBQyxFQUFFLGVBQWUsRUFBRTtvQkFDOUIsSUFBSSxFQUFFLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRTtvQkFDbkIsTUFBTSxFQUFFLEVBQUUsQ0FBQyxFQUFFLFdBQVcsRUFBRTtvQkFDMUIsYUFBYSxFQUFFLEVBQUUsQ0FBQyxFQUFFLG9CQUFvQixFQUFFO29CQUMxQyxTQUFTLEVBQUUsRUFBRSxDQUFDLEVBQUUsMEJBQTBCLEVBQUU7b0JBQzVDLFNBQVMsRUFBRSxFQUFFLENBQUMsRUFBRSwwQkFBMEIsRUFBRTtpQkFDN0M7YUFDRixDQUFDLENBQUM7WUFFSCxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUEseUJBQU8sRUFBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFakQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDcEMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUM1QyxPQUFPLEVBQUUscUNBQXFDO2dCQUM5QyxJQUFJLEVBQUU7b0JBQ0osRUFBRSxFQUFFLGVBQWU7b0JBQ25CLE1BQU0sRUFBRSxlQUFlO29CQUN2QixJQUFJLEVBQUUsTUFBTTtvQkFDWixNQUFNLEVBQUUsV0FBVztvQkFDbkIsYUFBYSxFQUFFLG9CQUFvQjtpQkFDcEM7YUFDRixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQywwQ0FBMEMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN4RCxNQUFNLEtBQUssR0FBeUI7Z0JBQ2xDLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixJQUFJLEVBQUUsbUNBQW1DO2dCQUN6QyxPQUFPLEVBQUUsRUFBRTtnQkFDWCxpQkFBaUIsRUFBRSxFQUFFO2dCQUNyQixxQkFBcUIsRUFBRSxJQUFJO2dCQUMzQiwrQkFBK0IsRUFBRSxJQUFJO2dCQUNyQyxjQUFjLEVBQUUsSUFBSTtnQkFDcEIsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxFQUFTO2dCQUN6QixRQUFRLEVBQUUsRUFBRTtnQkFDWixJQUFJLEVBQUUsSUFBSTtnQkFDVixlQUFlLEVBQUUsS0FBSzthQUN2QixDQUFDO1lBRUYsa0ZBQWtGO1lBQ2xGLGNBQWMsQ0FBQyxxQkFBcUIsQ0FBQyxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1lBRTFELE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBQSx5QkFBTyxFQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQztZQUVqRCxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNwQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzVDLEtBQUssRUFBRSxXQUFXO2dCQUNsQixPQUFPLEVBQUUseUNBQXlDO2FBQ25ELENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsZ0JBQWdCLEVBQUUsR0FBRyxFQUFFO1FBQzlCLEVBQUUsQ0FBQyw2Q0FBNkMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMzRCxNQUFNLEtBQUssR0FBeUI7Z0JBQ2xDLFVBQVUsRUFBRSxNQUFNO2dCQUNsQixJQUFJLEVBQUUsaUJBQWlCO2dCQUN2QixPQUFPLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUU7Z0JBQy9DLGlCQUFpQixFQUFFLEVBQUU7Z0JBQ3JCLHFCQUFxQixFQUFFLElBQUk7Z0JBQzNCLCtCQUErQixFQUFFLElBQUk7Z0JBQ3JDLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsSUFBSTtnQkFDcEIsY0FBYyxFQUFFLEVBQVM7Z0JBQ3pCLFFBQVEsRUFBRSxFQUFFO2dCQUNaLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixJQUFJLEVBQUUsV0FBVztvQkFDakIsTUFBTSxFQUFFLGVBQWU7aUJBQ3hCLENBQUM7Z0JBQ0YsZUFBZSxFQUFFLEtBQUs7YUFDdkIsQ0FBQztZQUVGLHlDQUF5QztZQUN6QyxjQUFjLENBQUMscUJBQXFCLENBQUMsSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQyxDQUFDO1lBRTlFLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBQSx5QkFBTyxFQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQztZQUVqRCxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNwQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUM7Z0JBQzVDLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLE9BQU8sRUFBRSw0QkFBNEI7YUFDdEMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsOENBQThDLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDNUQsTUFBTSxLQUFLLEdBQXlCO2dCQUNsQyxVQUFVLEVBQUUsTUFBTTtnQkFDbEIsSUFBSSxFQUFFLGlCQUFpQjtnQkFDdkIsT0FBTyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFO2dCQUMvQyxpQkFBaUIsRUFBRSxFQUFFO2dCQUNyQixxQkFBcUIsRUFBRSxJQUFJO2dCQUMzQiwrQkFBK0IsRUFBRSxJQUFJO2dCQUNyQyxjQUFjLEVBQUUsSUFBSTtnQkFDcEIsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxFQUFTO2dCQUN6QixRQUFRLEVBQUUsRUFBRTtnQkFDWixJQUFJLEVBQUUsa0JBQWtCO2dCQUN4QixlQUFlLEVBQUUsS0FBSzthQUN2QixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFBLHlCQUFPLEVBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1lBRWpELE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3BDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDNUMsS0FBSyxFQUFFLHVCQUF1QjtnQkFDOUIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUM7YUFDekMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRSxHQUFHLEVBQUU7UUFDOUIsRUFBRSxDQUFDLHNDQUFzQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3BELE1BQU0sS0FBSyxHQUF5QjtnQkFDbEMsVUFBVSxFQUFFLEtBQUs7Z0JBQ2pCLElBQUksRUFBRSxvQkFBb0I7Z0JBQzFCLE9BQU8sRUFBRSxFQUFFO2dCQUNYLGlCQUFpQixFQUFFLEVBQUU7Z0JBQ3JCLHFCQUFxQixFQUFFLElBQUk7Z0JBQzNCLCtCQUErQixFQUFFLElBQUk7Z0JBQ3JDLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsSUFBSTtnQkFDcEIsY0FBYyxFQUFFLEVBQVM7Z0JBQ3pCLFFBQVEsRUFBRSxFQUFFO2dCQUNaLElBQUksRUFBRSxJQUFJO2dCQUNWLGVBQWUsRUFBRSxLQUFLO2FBQ3ZCLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUEseUJBQU8sRUFBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFakQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDcEMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUM1QyxLQUFLLEVBQUUsV0FBVztnQkFDbEIsT0FBTyxFQUFFLHdDQUF3QzthQUNsRCxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5cclxuLy8gTW9jayBBV1MgU0RLIGNsaWVudHNcclxuamVzdC5tb2NrKCdAYXdzLXNkay9jbGllbnQtczMnLCAoKSA9PiAoe1xyXG4gIFMzQ2xpZW50OiBqZXN0LmZuKCgpID0+ICh7XHJcbiAgICBzZW5kOiBqZXN0LmZuKCksXHJcbiAgfSkpLFxyXG4gIFB1dE9iamVjdENvbW1hbmQ6IGplc3QuZm4oKSxcclxuICBHZXRPYmplY3RDb21tYW5kOiBqZXN0LmZuKCksXHJcbn0pKTtcclxuXHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LXRyYW5zY3JpYmUnLCAoKSA9PiAoe1xyXG4gIFRyYW5zY3JpYmVDbGllbnQ6IGplc3QuZm4oKCkgPT4gKHtcclxuICAgIHNlbmQ6IGplc3QuZm4oKSxcclxuICB9KSksXHJcbiAgU3RhcnRUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZDogamVzdC5mbigpLFxyXG4gIEdldFRyYW5zY3JpcHRpb25Kb2JDb21tYW5kOiBqZXN0LmZuKCksXHJcbiAgTWVkaWFGb3JtYXQ6IHtcclxuICAgIFdBVjogJ3dhdicsXHJcbiAgICBNUDM6ICdtcDMnLFxyXG4gICAgTVA0OiAnbXA0JyxcclxuICAgIFdFQk06ICd3ZWJtJyxcclxuICB9LFxyXG59KSk7XHJcblxyXG5qZXN0Lm1vY2soJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYicsICgpID0+ICh7XHJcbiAgRHluYW1vREJDbGllbnQ6IGplc3QuZm4oKCkgPT4gKHtcclxuICAgIHNlbmQ6IGplc3QuZm4oKSxcclxuICB9KSksXHJcbiAgUHV0SXRlbUNvbW1hbmQ6IGplc3QuZm4oKSxcclxuICBVcGRhdGVJdGVtQ29tbWFuZDogamVzdC5mbigpLFxyXG4gIEdldEl0ZW1Db21tYW5kOiBqZXN0LmZuKCksXHJcbn0pKTtcclxuXHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJywgKCkgPT4gKHtcclxuICBFdmVudEJyaWRnZUNsaWVudDogamVzdC5mbigoKSA9PiAoe1xyXG4gICAgc2VuZDogamVzdC5mbigpLFxyXG4gIH0pKSxcclxuICBQdXRFdmVudHNDb21tYW5kOiBqZXN0LmZuKCksXHJcbn0pKTtcclxuXHJcbi8vIE1vY2sgVVVJRFxyXG5qZXN0Lm1vY2soJ3V1aWQnLCAoKSA9PiAoe1xyXG4gIHY0OiBqZXN0LmZuKCgpID0+ICd0ZXN0LXV1aWQtMTIzJyksXHJcbn0pKTtcclxuXHJcbmltcG9ydCB7IGhhbmRsZXIgfSBmcm9tICcuLi9sYW1iZGEvaW5wdXQtcHJvY2Vzc29yJztcclxuaW1wb3J0IHsgUzNDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xyXG5pbXBvcnQgeyBUcmFuc2NyaWJlQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXRyYW5zY3JpYmUnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJztcclxuXHJcbmRlc2NyaWJlKCdJbnB1dCBQcm9jZXNzb3IgTGFtYmRhJywgKCkgPT4ge1xyXG4gIGxldCBtb2NrUzNTZW5kOiBqZXN0Lk1vY2s7XHJcbiAgbGV0IG1vY2tUcmFuc2NyaWJlU2VuZDogamVzdC5Nb2NrO1xyXG4gIGxldCBtb2NrRHluYW1vU2VuZDogamVzdC5Nb2NrO1xyXG4gIGxldCBtb2NrRXZlbnRCcmlkZ2VTZW5kOiBqZXN0Lk1vY2s7XHJcbiAgY29uc3QgbW9ja0NvbnRleHQ6IENvbnRleHQgPSB7XHJcbiAgICBjYWxsYmFja1dhaXRzRm9yRW1wdHlFdmVudExvb3A6IGZhbHNlLFxyXG4gICAgZnVuY3Rpb25OYW1lOiAndGVzdC1mdW5jdGlvbicsXHJcbiAgICBmdW5jdGlvblZlcnNpb246ICcxJyxcclxuICAgIGludm9rZWRGdW5jdGlvbkFybjogJ2Fybjphd3M6bGFtYmRhOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6ZnVuY3Rpb246dGVzdC1mdW5jdGlvbicsXHJcbiAgICBtZW1vcnlMaW1pdEluTUI6ICc1MTInLFxyXG4gICAgYXdzUmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJyxcclxuICAgIGxvZ0dyb3VwTmFtZTogJy9hd3MvbGFtYmRhL3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgbG9nU3RyZWFtTmFtZTogJzIwMjMvMDEvMDEvWyRMQVRFU1RddGVzdC1zdHJlYW0nLFxyXG4gICAgZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzOiAoKSA9PiAzMDAwMCxcclxuICAgIGRvbmU6IGplc3QuZm4oKSxcclxuICAgIGZhaWw6IGplc3QuZm4oKSxcclxuICAgIHN1Y2NlZWQ6IGplc3QuZm4oKSxcclxuICB9O1xyXG5cclxuICAvLyBTZXQgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgYmVmb3JlQWxsKCgpID0+IHtcclxuICAgIHByb2Nlc3MuZW52LkFVRElPX0JVQ0tFVF9OQU1FID0gJ3Rlc3QtYXVkaW8tYnVja2V0JztcclxuICAgIHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSA9ICd0ZXN0LWNvbnRlbnQtdGFibGUnO1xyXG4gICAgcHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUgPSAndGVzdC1ldmVudC1idXMnO1xyXG4gICAgcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiA9ICd1cy1lYXN0LTEnO1xyXG4gIH0pO1xyXG5cclxuICBiZWZvcmVFYWNoKCgpID0+IHtcclxuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xyXG4gICAgXHJcbiAgICAvLyBHZXQgbW9jayBmdW5jdGlvbnMgZnJvbSB0aGUgbW9ja2VkIGNsaWVudHNcclxuICAgIGNvbnN0IHMzQ2xpZW50ID0gbmV3IFMzQ2xpZW50KHt9KTtcclxuICAgIGNvbnN0IHRyYW5zY3JpYmVDbGllbnQgPSBuZXcgVHJhbnNjcmliZUNsaWVudCh7fSk7XHJcbiAgICBjb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xyXG4gICAgY29uc3QgZXZlbnRCcmlkZ2VDbGllbnQgPSBuZXcgRXZlbnRCcmlkZ2VDbGllbnQoe30pO1xyXG4gICAgXHJcbiAgICBtb2NrUzNTZW5kID0gczNDbGllbnQuc2VuZCBhcyBqZXN0Lk1vY2s7XHJcbiAgICBtb2NrVHJhbnNjcmliZVNlbmQgPSB0cmFuc2NyaWJlQ2xpZW50LnNlbmQgYXMgamVzdC5Nb2NrO1xyXG4gICAgbW9ja0R5bmFtb1NlbmQgPSBkeW5hbW9DbGllbnQuc2VuZCBhcyBqZXN0Lk1vY2s7XHJcbiAgICBtb2NrRXZlbnRCcmlkZ2VTZW5kID0gZXZlbnRCcmlkZ2VDbGllbnQuc2VuZCBhcyBqZXN0Lk1vY2s7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdPUFRJT05TIHJlcXVlc3RzJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgcHJlZmxpZ2h0IE9QVElPTlMgcmVxdWVzdHMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnT1BUSU9OUycsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvYXVkaW8nLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgb3JpZ2luOiAnaHR0cHM6Ly9leGFtcGxlLmdpdGh1Yi5pbycgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogbnVsbCxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycykudG9IYXZlUHJvcGVydHkoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicpO1xyXG4gICAgICBleHBlY3QocmVzdWx0LmhlYWRlcnMpLnRvSGF2ZVByb3BlcnR5KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJyk7XHJcbiAgICAgIGV4cGVjdChyZXN1bHQuYm9keSkudG9CZSgnJyk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0F1ZGlvIHVwbG9hZCBlbmRwb2ludCcsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgc3VjY2Vzc2Z1bGx5IHByb2Nlc3MgYXVkaW8gdXBsb2FkJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBDcmVhdGUgYSBwcm9wZXIgV0FWIGZpbGUgaGVhZGVyXHJcbiAgICAgIGNvbnN0IHdhdkhlYWRlciA9IEJ1ZmZlci5mcm9tKFtcclxuICAgICAgICAweDUyLCAweDQ5LCAweDQ2LCAweDQ2LCAvLyBcIlJJRkZcIlxyXG4gICAgICAgIDB4MjQsIDB4MDgsIDB4MDAsIDB4MDAsIC8vIEZpbGUgc2l6ZVxyXG4gICAgICAgIDB4NTcsIDB4NDEsIDB4NTYsIDB4NDUsIC8vIFwiV0FWRVwiXHJcbiAgICAgICAgMHg2NiwgMHg2RCwgMHg3NCwgMHgyMCwgLy8gXCJmbXQgXCJcclxuICAgICAgICAweDEwLCAweDAwLCAweDAwLCAweDAwLCAvLyBTdWJjaHVuazFTaXplXHJcbiAgICAgICAgMHgwMSwgMHgwMCwgMHgwMiwgMHgwMCwgLy8gQXVkaW9Gb3JtYXQsIE51bUNoYW5uZWxzXHJcbiAgICAgICAgMHg0NCwgMHhBQywgMHgwMCwgMHgwMCwgLy8gU2FtcGxlUmF0ZVxyXG4gICAgICAgIDB4MTAsIDB4QjEsIDB4MDIsIDB4MDAsIC8vIEJ5dGVSYXRlXHJcbiAgICAgICAgMHgwNCwgMHgwMCwgMHgxMCwgMHgwMCwgLy8gQmxvY2tBbGlnbiwgQml0c1BlclNhbXBsZVxyXG4gICAgICAgIDB4NjQsIDB4NjEsIDB4NzQsIDB4NjEsIC8vIFwiZGF0YVwiXHJcbiAgICAgICAgMHgwMCwgMHgwOCwgMHgwMCwgMHgwMCwgLy8gU3ViY2h1bmsyU2l6ZVxyXG4gICAgICBdKTtcclxuICAgICAgY29uc3QgYXVkaW9EYXRhID0gd2F2SGVhZGVyLnRvU3RyaW5nKCdiYXNlNjQnKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvYXVkaW8nLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBhdWRpb0RhdGEsXHJcbiAgICAgICAgICBjb250ZW50VHlwZTogJ2F1ZGlvL3dhdicsXHJcbiAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gTW9jayBzdWNjZXNzZnVsIEFXUyBzZXJ2aWNlIGNhbGxzXHJcbiAgICAgIG1vY2tTM1NlbmQubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG4gICAgICBtb2NrRHluYW1vU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZSh7fSk7XHJcbiAgICAgIG1vY2tUcmFuc2NyaWJlU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZSh7fSk7XHJcbiAgICAgIG1vY2tFdmVudEJyaWRnZVNlbmQubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMik7XHJcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3VsdC5ib2R5KSkudG9NYXRjaE9iamVjdCh7XHJcbiAgICAgICAgbWVzc2FnZTogJ0F1ZGlvIHVwbG9hZCBzdWNjZXNzZnVsLCBwcm9jZXNzaW5nIHN0YXJ0ZWQnLFxyXG4gICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgIGlucHV0SWQ6ICd0ZXN0LXV1aWQtMTIzJyxcclxuICAgICAgICAgIHN0YXR1czogJ3Byb2Nlc3NpbmcnLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IEFXUyBzZXJ2aWNlIGNhbGxzXHJcbiAgICAgIGV4cGVjdChtb2NrUzNTZW5kKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMSk7XHJcbiAgICAgIGV4cGVjdChtb2NrRHluYW1vU2VuZCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xyXG4gICAgICBleHBlY3QobW9ja1RyYW5zY3JpYmVTZW5kKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMSk7XHJcbiAgICAgIGV4cGVjdChtb2NrRXZlbnRCcmlkZ2VTZW5kKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHJlamVjdCBpbnZhbGlkIGF1ZGlvIHVwbG9hZCByZXF1ZXN0JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L2F1ZGlvJyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgYXVkaW9EYXRhOiAnJywgLy8gRW1wdHkgYXVkaW8gZGF0YVxyXG4gICAgICAgICAgY29udGVudFR5cGU6ICdhdWRpby93YXYnLFxyXG4gICAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMycsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDApO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIGVycm9yOiAnVmFsaWRhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogJ0F1ZGlvIGRhdGEgaXMgcmVxdWlyZWQnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgcmVqZWN0IHVuc3VwcG9ydGVkIGNvbnRlbnQgdHlwZScsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgYXVkaW9EYXRhID0gQnVmZmVyLmZyb20oJ3Rlc3QgYXVkaW8gZGF0YScpLnRvU3RyaW5nKCdiYXNlNjQnKTtcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC9hdWRpbycsXHJcbiAgICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGF1ZGlvRGF0YSxcclxuICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXVkaW8vdW5zdXBwb3J0ZWQnLFxyXG4gICAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMycsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDApO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIGVycm9yOiAnVmFsaWRhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ1Vuc3VwcG9ydGVkIGNvbnRlbnQgdHlwZScpLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnVGV4dCBpbnB1dCBlbmRwb2ludCcsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgc3VjY2Vzc2Z1bGx5IHByb2Nlc3MgdGV4dCBpbnB1dCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC90ZXh0JyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgdGV4dDogJ1RoaXMgaXMgYSB0ZXN0IGJsb2cgcG9zdCBpZGVhIGFib3V0IGFydGlmaWNpYWwgaW50ZWxsaWdlbmNlIGFuZCBpdHMgaW1wYWN0IG9uIHNvY2lldHkuJyxcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgQVdTIHNlcnZpY2UgY2FsbHNcclxuICAgICAgbW9ja0R5bmFtb1NlbmQubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG4gICAgICBtb2NrRXZlbnRCcmlkZ2VTZW5kLm1vY2tSZXNvbHZlZFZhbHVlKHt9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIG1lc3NhZ2U6ICdUZXh0IGlucHV0IHByb2Nlc3NlZCBzdWNjZXNzZnVsbHknLFxyXG4gICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgIGlucHV0SWQ6ICd0ZXN0LXV1aWQtMTIzJyxcclxuICAgICAgICAgIHN0YXR1czogJ2NvbXBsZXRlZCcsXHJcbiAgICAgICAgICB0cmFuc2NyaXB0aW9uOiBleHBlY3QuYW55KFN0cmluZyksXHJcbiAgICAgICAgfSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgQVdTIHNlcnZpY2UgY2FsbHNcclxuICAgICAgZXhwZWN0KG1vY2tEeW5hbW9TZW5kKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMSk7XHJcbiAgICAgIGV4cGVjdChtb2NrRXZlbnRCcmlkZ2VTZW5kKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHJlamVjdCBlbXB0eSB0ZXh0IGlucHV0JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L3RleHQnLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICB0ZXh0OiAnJyxcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDAwKTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICBlcnJvcjogJ1ZhbGlkYXRpb24gRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdUZXh0IGlzIHJlcXVpcmVkJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHJlamVjdCB0ZXh0IHRoYXQgaXMgdG9vIGxvbmcnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGxvbmdUZXh0ID0gJ2EnLnJlcGVhdCgxMDAwMSk7IC8vIEV4Y2VlZHMgMTAsMDAwIGNoYXJhY3RlciBsaW1pdFxyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L3RleHQnLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICB0ZXh0OiBsb25nVGV4dCxcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDAwKTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICBlcnJvcjogJ1ZhbGlkYXRpb24gRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdUZXh0IG11c3QgYmUgbm8gbW9yZSB0aGFuIDEwLDAwMCBjaGFyYWN0ZXJzIGxvbmcnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnU3RhdHVzIGVuZHBvaW50JywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gaW5wdXQgc3RhdHVzIGZvciBleGlzdGluZyBpbnB1dCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L3N0YXR1cy90ZXN0LXV1aWQtMTIzJyxcclxuICAgICAgICBoZWFkZXJzOiB7fSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogbnVsbCxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gTW9jayBEeW5hbW9EQiByZXNwb25zZSAtIG5lZWQgdG8gcmV0dXJuIHRoZSByZXN1bHQgb2JqZWN0IHByb3Blcmx5XHJcbiAgICAgIG1vY2tEeW5hbW9TZW5kLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgaWQ6IHsgUzogJ3Rlc3QtdXVpZC0xMjMnIH0sXHJcbiAgICAgICAgICB1c2VySWQ6IHsgUzogJ3Rlc3QtdXNlci0xMjMnIH0sXHJcbiAgICAgICAgICB0eXBlOiB7IFM6ICd0ZXh0JyB9LFxyXG4gICAgICAgICAgc3RhdHVzOiB7IFM6ICdjb21wbGV0ZWQnIH0sXHJcbiAgICAgICAgICB0cmFuc2NyaXB0aW9uOiB7IFM6ICdUZXN0IHRyYW5zY3JpcHRpb24nIH0sXHJcbiAgICAgICAgICBjcmVhdGVkQXQ6IHsgUzogJzIwMjMtMDEtMDFUMDA6MDA6MDAuMDAwWicgfSxcclxuICAgICAgICAgIHVwZGF0ZWRBdDogeyBTOiAnMjAyMy0wMS0wMVQwMDowMDowMC4wMDBaJyB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3VsdC5ib2R5KSkudG9NYXRjaE9iamVjdCh7XHJcbiAgICAgICAgbWVzc2FnZTogJ0lucHV0IHN0YXR1cyByZXRyaWV2ZWQgc3VjY2Vzc2Z1bGx5JyxcclxuICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICBpZDogJ3Rlc3QtdXVpZC0xMjMnLFxyXG4gICAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMycsXHJcbiAgICAgICAgICB0eXBlOiAndGV4dCcsXHJcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbjogJ1Rlc3QgdHJhbnNjcmlwdGlvbicsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHJldHVybiA0MDQgZm9yIG5vbi1leGlzdGVudCBpbnB1dCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L3N0YXR1cy9ub24tZXhpc3RlbnQtaWQnLFxyXG4gICAgICAgIGhlYWRlcnM6IHt9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBudWxsLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBNb2NrIER5bmFtb0RCIHJlc3BvbnNlIGZvciBub24tZXhpc3RlbnQgaXRlbSAtIHJldHVybiBlbXB0eSBvYmplY3Qgd2l0aG91dCBJdGVtXHJcbiAgICAgIG1vY2tEeW5hbW9TZW5kLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7IEl0ZW06IHVuZGVmaW5lZCB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDQpO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIGVycm9yOiAnTm90IEZvdW5kJyxcclxuICAgICAgICBtZXNzYWdlOiAnSW5wdXQgd2l0aCBJRCBub24tZXhpc3RlbnQtaWQgbm90IGZvdW5kJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0Vycm9yIGhhbmRsaW5nJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgQVdTIHNlcnZpY2UgZXJyb3JzIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvdGV4dCcsXHJcbiAgICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIHRleHQ6ICdUZXN0IHRleHQnLFxyXG4gICAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMycsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIE1vY2sgRHluYW1vREIgZXJyb3IgLSBmaXJzdCBjYWxsIGZhaWxzXHJcbiAgICAgIG1vY2tEeW5hbW9TZW5kLm1vY2tSZWplY3RlZFZhbHVlT25jZShuZXcgRXJyb3IoJ0R5bmFtb0RCIGNvbm5lY3Rpb24gZmFpbGVkJykpO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDUwMCk7XHJcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3VsdC5ib2R5KSkudG9NYXRjaE9iamVjdCh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdEeW5hbW9EQiBjb25uZWN0aW9uIGZhaWxlZCcsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWFsZm9ybWVkIEpTT04gaW4gcmVxdWVzdCBib2R5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L3RleHQnLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiAneyBpbnZhbGlkIGpzb24gfScsXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg1MDApO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBleHBlY3Quc3RyaW5nQ29udGFpbmluZygnSlNPTicpLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnUm91dGUgaGFuZGxpbmcnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHJldHVybiA0MDQgZm9yIHVua25vd24gcm91dGVzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvdW5rbm93bi1yb3V0ZScsXHJcbiAgICAgICAgaGVhZGVyczoge30sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IG51bGwsXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDQpO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIGVycm9yOiAnTm90IEZvdW5kJyxcclxuICAgICAgICBtZXNzYWdlOiAnUm91dGUgR0VUIC9hcGkvdW5rbm93bi1yb3V0ZSBub3QgZm91bmQnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG59KTsiXX0=