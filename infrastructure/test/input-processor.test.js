"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Set environment variables BEFORE importing the handler
process.env.AUDIO_BUCKET_NAME = 'test-audio-bucket';
process.env.CONTENT_TABLE_NAME = 'test-content-table';
process.env.EVENT_BUS_NAME = 'test-event-bus';
process.env.AWS_REGION = 'us-east-1';
// Create mock functions that we can access in tests
const mockS3Send = jest.fn();
const mockTranscribeSend = jest.fn();
const mockDynamoSend = jest.fn();
const mockEventBridgeSend = jest.fn();
// Mock AWS SDK clients BEFORE importing the handler
jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(() => ({
        send: mockS3Send,
    })),
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-transcribe', () => ({
    TranscribeClient: jest.fn(() => ({
        send: mockTranscribeSend,
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
        send: mockDynamoSend,
    })),
    PutItemCommand: jest.fn(),
    UpdateItemCommand: jest.fn(),
    GetItemCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-eventbridge', () => ({
    EventBridgeClient: jest.fn(() => ({
        send: mockEventBridgeSend,
    })),
    PutEventsCommand: jest.fn(),
}));
// Mock UUID
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'test-uuid-123'),
}));
// NOW import the handler after mocks are set up
const input_processor_1 = require("../lambda/input-processor");
describe('Input Processor Lambda', () => {
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
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset all mock functions
        mockS3Send.mockReset();
        mockTranscribeSend.mockReset();
        mockDynamoSend.mockReset();
        mockEventBridgeSend.mockReset();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5wdXQtcHJvY2Vzc29yLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbnB1dC1wcm9jZXNzb3IudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUVBLHlEQUF5RDtBQUN6RCxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixHQUFHLG1CQUFtQixDQUFDO0FBQ3BELE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLEdBQUcsb0JBQW9CLENBQUM7QUFDdEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLEdBQUcsZ0JBQWdCLENBQUM7QUFDOUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEdBQUcsV0FBVyxDQUFDO0FBRXJDLG9EQUFvRDtBQUNwRCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7QUFDN0IsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7QUFDckMsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO0FBQ2pDLE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO0FBRXRDLG9EQUFvRDtBQUNwRCxJQUFJLENBQUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDckMsUUFBUSxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUN2QixJQUFJLEVBQUUsVUFBVTtLQUNqQixDQUFDLENBQUM7SUFDSCxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0lBQzNCLGdCQUFnQixFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7Q0FDNUIsQ0FBQyxDQUFDLENBQUM7QUFFSixJQUFJLENBQUMsSUFBSSxDQUFDLDRCQUE0QixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDN0MsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FB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IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcblxyXG4vLyBTZXQgZW52aXJvbm1lbnQgdmFyaWFibGVzIEJFRk9SRSBpbXBvcnRpbmcgdGhlIGhhbmRsZXJcclxucHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUgPSAndGVzdC1hdWRpby1idWNrZXQnO1xyXG5wcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUgPSAndGVzdC1jb250ZW50LXRhYmxlJztcclxucHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUgPSAndGVzdC1ldmVudC1idXMnO1xyXG5wcm9jZXNzLmVudi5BV1NfUkVHSU9OID0gJ3VzLWVhc3QtMSc7XHJcblxyXG4vLyBDcmVhdGUgbW9jayBmdW5jdGlvbnMgdGhhdCB3ZSBjYW4gYWNjZXNzIGluIHRlc3RzXHJcbmNvbnN0IG1vY2tTM1NlbmQgPSBqZXN0LmZuKCk7XHJcbmNvbnN0IG1vY2tUcmFuc2NyaWJlU2VuZCA9IGplc3QuZm4oKTtcclxuY29uc3QgbW9ja0R5bmFtb1NlbmQgPSBqZXN0LmZuKCk7XHJcbmNvbnN0IG1vY2tFdmVudEJyaWRnZVNlbmQgPSBqZXN0LmZuKCk7XHJcblxyXG4vLyBNb2NrIEFXUyBTREsgY2xpZW50cyBCRUZPUkUgaW1wb3J0aW5nIHRoZSBoYW5kbGVyXHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LXMzJywgKCkgPT4gKHtcclxuICBTM0NsaWVudDogamVzdC5mbigoKSA9PiAoe1xyXG4gICAgc2VuZDogbW9ja1MzU2VuZCxcclxuICB9KSksXHJcbiAgUHV0T2JqZWN0Q29tbWFuZDogamVzdC5mbigpLFxyXG4gIEdldE9iamVjdENvbW1hbmQ6IGplc3QuZm4oKSxcclxufSkpO1xyXG5cclxuamVzdC5tb2NrKCdAYXdzLXNkay9jbGllbnQtdHJhbnNjcmliZScsICgpID0+ICh7XHJcbiAgVHJhbnNjcmliZUNsaWVudDogamVzdC5mbigoKSA9PiAoe1xyXG4gICAgc2VuZDogbW9ja1RyYW5zY3JpYmVTZW5kLFxyXG4gIH0pKSxcclxuICBTdGFydFRyYW5zY3JpcHRpb25Kb2JDb21tYW5kOiBqZXN0LmZuKCksXHJcbiAgR2V0VHJhbnNjcmlwdGlvbkpvYkNvbW1hbmQ6IGplc3QuZm4oKSxcclxuICBNZWRpYUZvcm1hdDoge1xyXG4gICAgV0FWOiAnd2F2JyxcclxuICAgIE1QMzogJ21wMycsXHJcbiAgICBNUDQ6ICdtcDQnLFxyXG4gICAgV0VCTTogJ3dlYm0nLFxyXG4gIH0sXHJcbn0pKTtcclxuXHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJywgKCkgPT4gKHtcclxuICBEeW5hbW9EQkNsaWVudDogamVzdC5mbigoKSA9PiAoe1xyXG4gICAgc2VuZDogbW9ja0R5bmFtb1NlbmQsXHJcbiAgfSkpLFxyXG4gIFB1dEl0ZW1Db21tYW5kOiBqZXN0LmZuKCksXHJcbiAgVXBkYXRlSXRlbUNvbW1hbmQ6IGplc3QuZm4oKSxcclxuICBHZXRJdGVtQ29tbWFuZDogamVzdC5mbigpLFxyXG59KSk7XHJcblxyXG5qZXN0Lm1vY2soJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZScsICgpID0+ICh7XHJcbiAgRXZlbnRCcmlkZ2VDbGllbnQ6IGplc3QuZm4oKCkgPT4gKHtcclxuICAgIHNlbmQ6IG1vY2tFdmVudEJyaWRnZVNlbmQsXHJcbiAgfSkpLFxyXG4gIFB1dEV2ZW50c0NvbW1hbmQ6IGplc3QuZm4oKSxcclxufSkpO1xyXG5cclxuLy8gTW9jayBVVUlEXHJcbmplc3QubW9jaygndXVpZCcsICgpID0+ICh7XHJcbiAgdjQ6IGplc3QuZm4oKCkgPT4gJ3Rlc3QtdXVpZC0xMjMnKSxcclxufSkpO1xyXG5cclxuLy8gTk9XIGltcG9ydCB0aGUgaGFuZGxlciBhZnRlciBtb2NrcyBhcmUgc2V0IHVwXHJcbmltcG9ydCB7IGhhbmRsZXIgfSBmcm9tICcuLi9sYW1iZGEvaW5wdXQtcHJvY2Vzc29yJztcclxuaW1wb3J0IHsgUzNDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xyXG5pbXBvcnQgeyBUcmFuc2NyaWJlQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXRyYW5zY3JpYmUnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJztcclxuXHJcbmRlc2NyaWJlKCdJbnB1dCBQcm9jZXNzb3IgTGFtYmRhJywgKCkgPT4ge1xyXG4gIGNvbnN0IG1vY2tDb250ZXh0OiBDb250ZXh0ID0ge1xyXG4gICAgY2FsbGJhY2tXYWl0c0ZvckVtcHR5RXZlbnRMb29wOiBmYWxzZSxcclxuICAgIGZ1bmN0aW9uTmFtZTogJ3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgZnVuY3Rpb25WZXJzaW9uOiAnMScsXHJcbiAgICBpbnZva2VkRnVuY3Rpb25Bcm46ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmZ1bmN0aW9uOnRlc3QtZnVuY3Rpb24nLFxyXG4gICAgbWVtb3J5TGltaXRJbk1COiAnNTEyJyxcclxuICAgIGF3c1JlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS90ZXN0LWZ1bmN0aW9uJyxcclxuICAgIGxvZ1N0cmVhbU5hbWU6ICcyMDIzLzAxLzAxL1skTEFURVNUXXRlc3Qtc3RyZWFtJyxcclxuICAgIGdldFJlbWFpbmluZ1RpbWVJbk1pbGxpczogKCkgPT4gMzAwMDAsXHJcbiAgICBkb25lOiBqZXN0LmZuKCksXHJcbiAgICBmYWlsOiBqZXN0LmZuKCksXHJcbiAgICBzdWNjZWVkOiBqZXN0LmZuKCksXHJcbiAgfTtcclxuXHJcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XHJcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcclxuICAgIFxyXG4gICAgLy8gUmVzZXQgYWxsIG1vY2sgZnVuY3Rpb25zXHJcbiAgICBtb2NrUzNTZW5kLm1vY2tSZXNldCgpO1xyXG4gICAgbW9ja1RyYW5zY3JpYmVTZW5kLm1vY2tSZXNldCgpO1xyXG4gICAgbW9ja0R5bmFtb1NlbmQubW9ja1Jlc2V0KCk7XHJcbiAgICBtb2NrRXZlbnRCcmlkZ2VTZW5kLm1vY2tSZXNldCgpO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnT1BUSU9OUyByZXF1ZXN0cycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHByZWZsaWdodCBPUFRJT05TIHJlcXVlc3RzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ09QVElPTlMnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L2F1ZGlvJyxcclxuICAgICAgICBoZWFkZXJzOiB7IG9yaWdpbjogJ2h0dHBzOi8vZXhhbXBsZS5naXRodWIuaW8nIH0sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IG51bGwsXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBleHBlY3QocmVzdWx0LmhlYWRlcnMpLnRvSGF2ZVByb3BlcnR5KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nKTtcclxuICAgICAgZXhwZWN0KHJlc3VsdC5oZWFkZXJzKS50b0hhdmVQcm9wZXJ0eSgnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycpO1xyXG4gICAgICBleHBlY3QocmVzdWx0LmJvZHkpLnRvQmUoJycpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdBdWRpbyB1cGxvYWQgZW5kcG9pbnQnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHN1Y2Nlc3NmdWxseSBwcm9jZXNzIGF1ZGlvIHVwbG9hZCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gQ3JlYXRlIGEgcHJvcGVyIFdBViBmaWxlIGhlYWRlclxyXG4gICAgICBjb25zdCB3YXZIZWFkZXIgPSBCdWZmZXIuZnJvbShbXHJcbiAgICAgICAgMHg1MiwgMHg0OSwgMHg0NiwgMHg0NiwgLy8gXCJSSUZGXCJcclxuICAgICAgICAweDI0LCAweDA4LCAweDAwLCAweDAwLCAvLyBGaWxlIHNpemVcclxuICAgICAgICAweDU3LCAweDQxLCAweDU2LCAweDQ1LCAvLyBcIldBVkVcIlxyXG4gICAgICAgIDB4NjYsIDB4NkQsIDB4NzQsIDB4MjAsIC8vIFwiZm10IFwiXHJcbiAgICAgICAgMHgxMCwgMHgwMCwgMHgwMCwgMHgwMCwgLy8gU3ViY2h1bmsxU2l6ZVxyXG4gICAgICAgIDB4MDEsIDB4MDAsIDB4MDIsIDB4MDAsIC8vIEF1ZGlvRm9ybWF0LCBOdW1DaGFubmVsc1xyXG4gICAgICAgIDB4NDQsIDB4QUMsIDB4MDAsIDB4MDAsIC8vIFNhbXBsZVJhdGVcclxuICAgICAgICAweDEwLCAweEIxLCAweDAyLCAweDAwLCAvLyBCeXRlUmF0ZVxyXG4gICAgICAgIDB4MDQsIDB4MDAsIDB4MTAsIDB4MDAsIC8vIEJsb2NrQWxpZ24sIEJpdHNQZXJTYW1wbGVcclxuICAgICAgICAweDY0LCAweDYxLCAweDc0LCAweDYxLCAvLyBcImRhdGFcIlxyXG4gICAgICAgIDB4MDAsIDB4MDgsIDB4MDAsIDB4MDAsIC8vIFN1YmNodW5rMlNpemVcclxuICAgICAgXSk7XHJcbiAgICAgIGNvbnN0IGF1ZGlvRGF0YSA9IHdhdkhlYWRlci50b1N0cmluZygnYmFzZTY0Jyk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L2F1ZGlvJyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgYXVkaW9EYXRhLFxyXG4gICAgICAgICAgY29udGVudFR5cGU6ICdhdWRpby93YXYnLFxyXG4gICAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMycsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCBBV1Mgc2VydmljZSBjYWxsc1xyXG4gICAgICBtb2NrUzNTZW5kLm1vY2tSZXNvbHZlZFZhbHVlKHt9KTtcclxuICAgICAgbW9ja0R5bmFtb1NlbmQubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG4gICAgICBtb2NrVHJhbnNjcmliZVNlbmQubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG4gICAgICBtb2NrRXZlbnRCcmlkZ2VTZW5kLm1vY2tSZXNvbHZlZFZhbHVlKHt9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDIpO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIG1lc3NhZ2U6ICdBdWRpbyB1cGxvYWQgc3VjY2Vzc2Z1bCwgcHJvY2Vzc2luZyBzdGFydGVkJyxcclxuICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICBpbnB1dElkOiAndGVzdC11dWlkLTEyMycsXHJcbiAgICAgICAgICBzdGF0dXM6ICdwcm9jZXNzaW5nJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSBBV1Mgc2VydmljZSBjYWxsc1xyXG4gICAgICBleHBlY3QobW9ja1MzU2VuZCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xyXG4gICAgICBleHBlY3QobW9ja0R5bmFtb1NlbmQpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygxKTtcclxuICAgICAgZXhwZWN0KG1vY2tUcmFuc2NyaWJlU2VuZCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xyXG4gICAgICBleHBlY3QobW9ja0V2ZW50QnJpZGdlU2VuZCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgaW52YWxpZCBhdWRpbyB1cGxvYWQgcmVxdWVzdCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC9hdWRpbycsXHJcbiAgICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGF1ZGlvRGF0YTogJycsIC8vIEVtcHR5IGF1ZGlvIGRhdGFcclxuICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXVkaW8vd2F2JyxcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDAwKTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICBlcnJvcjogJ1ZhbGlkYXRpb24gRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdBdWRpbyBkYXRhIGlzIHJlcXVpcmVkJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHJlamVjdCB1bnN1cHBvcnRlZCBjb250ZW50IHR5cGUnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGF1ZGlvRGF0YSA9IEJ1ZmZlci5mcm9tKCd0ZXN0IGF1ZGlvIGRhdGEnKS50b1N0cmluZygnYmFzZTY0Jyk7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvYXVkaW8nLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBhdWRpb0RhdGEsXHJcbiAgICAgICAgICBjb250ZW50VHlwZTogJ2F1ZGlvL3Vuc3VwcG9ydGVkJyxcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDAwKTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICBlcnJvcjogJ1ZhbGlkYXRpb24gRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGV4cGVjdC5zdHJpbmdDb250YWluaW5nKCdVbnN1cHBvcnRlZCBjb250ZW50IHR5cGUnKSxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ1RleHQgaW5wdXQgZW5kcG9pbnQnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHN1Y2Nlc3NmdWxseSBwcm9jZXNzIHRleHQgaW5wdXQnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvdGV4dCcsXHJcbiAgICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIHRleHQ6ICdUaGlzIGlzIGEgdGVzdCBibG9nIHBvc3QgaWRlYSBhYm91dCBhcnRpZmljaWFsIGludGVsbGlnZW5jZSBhbmQgaXRzIGltcGFjdCBvbiBzb2NpZXR5LicsXHJcbiAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gTW9jayBzdWNjZXNzZnVsIEFXUyBzZXJ2aWNlIGNhbGxzXHJcbiAgICAgIG1vY2tEeW5hbW9TZW5kLm1vY2tSZXNvbHZlZFZhbHVlKHt9KTtcclxuICAgICAgbW9ja0V2ZW50QnJpZGdlU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZSh7fSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICBtZXNzYWdlOiAnVGV4dCBpbnB1dCBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5JyxcclxuICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICBpbnB1dElkOiAndGVzdC11dWlkLTEyMycsXHJcbiAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbjogZXhwZWN0LmFueShTdHJpbmcpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IEFXUyBzZXJ2aWNlIGNhbGxzXHJcbiAgICAgIGV4cGVjdChtb2NrRHluYW1vU2VuZCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xyXG4gICAgICBleHBlY3QobW9ja0V2ZW50QnJpZGdlU2VuZCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgZW1wdHkgdGV4dCBpbnB1dCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC90ZXh0JyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgdGV4dDogJycsXHJcbiAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDQwMCk7XHJcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3VsdC5ib2R5KSkudG9NYXRjaE9iamVjdCh7XHJcbiAgICAgICAgZXJyb3I6ICdWYWxpZGF0aW9uIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiAnVGV4dCBpcyByZXF1aXJlZCcsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgdGV4dCB0aGF0IGlzIHRvbyBsb25nJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBsb25nVGV4dCA9ICdhJy5yZXBlYXQoMTAwMDEpOyAvLyBFeGNlZWRzIDEwLDAwMCBjaGFyYWN0ZXIgbGltaXRcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC90ZXh0JyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgdGV4dDogbG9uZ1RleHQsXHJcbiAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDQwMCk7XHJcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3VsdC5ib2R5KSkudG9NYXRjaE9iamVjdCh7XHJcbiAgICAgICAgZXJyb3I6ICdWYWxpZGF0aW9uIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiAnVGV4dCBtdXN0IGJlIG5vIG1vcmUgdGhhbiAxMCwwMDAgY2hhcmFjdGVycyBsb25nJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ1N0YXR1cyBlbmRwb2ludCcsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGlucHV0IHN0YXR1cyBmb3IgZXhpc3RpbmcgaW5wdXQnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC9zdGF0dXMvdGVzdC11dWlkLTEyMycsXHJcbiAgICAgICAgaGVhZGVyczoge30sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IG51bGwsXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIE1vY2sgRHluYW1vREIgcmVzcG9uc2UgLSBuZWVkIHRvIHJldHVybiB0aGUgcmVzdWx0IG9iamVjdCBwcm9wZXJseVxyXG4gICAgICBtb2NrRHluYW1vU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgIGlkOiB7IFM6ICd0ZXN0LXV1aWQtMTIzJyB9LFxyXG4gICAgICAgICAgdXNlcklkOiB7IFM6ICd0ZXN0LXVzZXItMTIzJyB9LFxyXG4gICAgICAgICAgdHlwZTogeyBTOiAndGV4dCcgfSxcclxuICAgICAgICAgIHN0YXR1czogeyBTOiAnY29tcGxldGVkJyB9LFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbjogeyBTOiAnVGVzdCB0cmFuc2NyaXB0aW9uJyB9LFxyXG4gICAgICAgICAgY3JlYXRlZEF0OiB7IFM6ICcyMDIzLTAxLTAxVDAwOjAwOjAwLjAwMFonIH0sXHJcbiAgICAgICAgICB1cGRhdGVkQXQ6IHsgUzogJzIwMjMtMDEtMDFUMDA6MDA6MDAuMDAwWicgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIG1lc3NhZ2U6ICdJbnB1dCBzdGF0dXMgcmV0cmlldmVkIHN1Y2Nlc3NmdWxseScsXHJcbiAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgaWQ6ICd0ZXN0LXV1aWQtMTIzJyxcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgICAgdHlwZTogJ3RleHQnLFxyXG4gICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb246ICdUZXN0IHRyYW5zY3JpcHRpb24nLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gNDA0IGZvciBub24tZXhpc3RlbnQgaW5wdXQnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC9zdGF0dXMvbm9uLWV4aXN0ZW50LWlkJyxcclxuICAgICAgICBoZWFkZXJzOiB7fSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogbnVsbCxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gTW9jayBEeW5hbW9EQiByZXNwb25zZSBmb3Igbm9uLWV4aXN0ZW50IGl0ZW0gLSByZXR1cm4gZW1wdHkgb2JqZWN0IHdpdGhvdXQgSXRlbVxyXG4gICAgICBtb2NrRHluYW1vU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2UoeyBJdGVtOiB1bmRlZmluZWQgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDA0KTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgICAgbWVzc2FnZTogJ0lucHV0IHdpdGggSUQgbm9uLWV4aXN0ZW50LWlkIG5vdCBmb3VuZCcsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdFcnJvciBoYW5kbGluZycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIEFXUyBzZXJ2aWNlIGVycm9ycyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L3RleHQnLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICB0ZXh0OiAnVGVzdCB0ZXh0JyxcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBNb2NrIER5bmFtb0RCIGVycm9yIC0gZmlyc3QgY2FsbCBmYWlsc1xyXG4gICAgICBtb2NrRHluYW1vU2VuZC5tb2NrUmVqZWN0ZWRWYWx1ZU9uY2UobmV3IEVycm9yKCdEeW5hbW9EQiBjb25uZWN0aW9uIGZhaWxlZCcpKTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg1MDApO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiAnRHluYW1vREIgY29ubmVjdGlvbiBmYWlsZWQnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1hbGZvcm1lZCBKU09OIGluIHJlcXVlc3QgYm9keScsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC90ZXh0JyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogJ3sgaW52YWxpZCBqc29uIH0nLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ0pTT04nKSxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ1JvdXRlIGhhbmRsaW5nJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gNDA0IGZvciB1bmtub3duIHJvdXRlcycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL3Vua25vd24tcm91dGUnLFxyXG4gICAgICAgIGhlYWRlcnM6IHt9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBudWxsLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDA0KTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgICAgbWVzc2FnZTogJ1JvdXRlIEdFVCAvYXBpL3Vua25vd24tcm91dGUgbm90IGZvdW5kJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19