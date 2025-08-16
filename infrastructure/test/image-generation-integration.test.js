"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
// Mock AWS SDK
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-sqs');
// Mock fetch
global.fetch = jest.fn();
describe('Image Generation Integration', () => {
    let mockDynamoClient;
    let mockS3Client;
    let mockSQSClient;
    beforeEach(() => {
        jest.clearAllMocks();
        mockDynamoClient = {
            send: jest.fn(),
        };
        mockS3Client = {
            send: jest.fn(),
        };
        mockSQSClient = {
            send: jest.fn(),
        };
        // Mock DynamoDBDocumentClient.from
        lib_dynamodb_1.DynamoDBDocumentClient.from.mockReturnValue(mockDynamoClient);
    });
    describe('End-to-end image generation workflow', () => {
        it('should complete full image generation workflow', async () => {
            const contentId = 'test-content-id';
            const prompt = 'A professional illustration of technology';
            // Step 1: Create content record
            const contentRecord = {
                id: contentId,
                title: 'Test Blog Post',
                content: 'This is a test blog post about technology.',
                status: 'content_generated',
                createdAt: new Date().toISOString(),
            };
            mockDynamoClient.send.mockResolvedValueOnce({ Item: contentRecord });
            // Step 2: Mock successful OpenAI image generation
            const mockImageUrl = 'https://oaidalleapiprodscus.blob.core.windows.net/private/test-image.png';
            global.fetch
                .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: mockImageUrl }]
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(2048),
            });
            // Step 3: Mock S3 upload success
            mockS3Client.send.mockResolvedValueOnce({});
            // Step 4: Mock DynamoDB update success
            mockDynamoClient.send.mockResolvedValueOnce({});
            // Step 5: Mock SQS notification success
            mockSQSClient.send.mockResolvedValueOnce({});
            // Import and test the handler
            const { handler } = await Promise.resolve().then(() => __importStar(require('../lambda/image-generation-agent')));
            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    contentId,
                    prompt,
                    size: '1024x1024'
                }),
                headers: {
                    'origin': 'https://keiranholloway.github.io',
                    'content-type': 'application/json',
                },
                multiValueHeaders: {},
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                path: '',
                isBase64Encoded: false,
            };
            const result = await handler(event);
            // Verify successful response
            expect(result.statusCode).toBe(200);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.imageUrl).toBeDefined();
            // Verify OpenAI API was called correctly
            expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Authorization': expect.stringContaining('Bearer'),
                    'Content-Type': 'application/json',
                }),
                body: expect.stringContaining(prompt),
            }));
            // Verify image was downloaded
            expect(global.fetch).toHaveBeenCalledWith(mockImageUrl);
            // Verify S3 upload was attempted
            expect(mockS3Client.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    Bucket: expect.any(String),
                    Key: expect.stringMatching(/^images\/.*\.png$/),
                    Body: expect.any(Uint8Array),
                    ContentType: 'image/png',
                })
            }));
            // Verify DynamoDB was updated
            expect(mockDynamoClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    TableName: expect.any(String),
                    Key: { id: contentId },
                    UpdateExpression: expect.stringContaining('imageUrl'),
                })
            }));
            // Verify orchestrator was notified
            expect(mockSQSClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    QueueUrl: expect.any(String),
                    MessageBody: expect.stringContaining('image_generated'),
                })
            }));
        });
        it('should handle content analysis for image prompt generation', async () => {
            const content = 'This article discusses artificial intelligence, machine learning, and the future of technology in business automation.';
            // Mock content analysis endpoint
            const mockAnalysis = {
                prompt: 'Professional illustration of artificial intelligence and machine learning technology, featuring automation and business concepts, high quality, detailed',
                style: 'professional'
            };
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockAnalysis,
            });
            // Test content analysis
            const { imageGenerationService } = await Promise.resolve().then(() => __importStar(require('../../frontend/src/services/imageGenerationService')));
            const analysis = await imageGenerationService.analyzeContentForImage(content);
            expect(analysis.prompt).toContain('artificial intelligence');
            expect(analysis.prompt).toContain('machine learning');
            expect(analysis.style).toBe('professional');
        });
        it('should handle image revision workflow', async () => {
            const contentId = 'test-content-id';
            const feedback = 'Make the image more colorful and vibrant';
            const newPrompt = 'Vibrant, colorful illustration of technology';
            // Mock successful revision
            global.fetch
                .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://example.com/revised-image.png' }]
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(2048),
            });
            mockS3Client.send.mockResolvedValueOnce({});
            mockDynamoClient.send.mockResolvedValueOnce({});
            mockSQSClient.send.mockResolvedValueOnce({});
            const { handler } = await Promise.resolve().then(() => __importStar(require('../lambda/image-generation-agent')));
            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    contentId,
                    prompt: newPrompt,
                    feedback
                }),
                headers: {
                    'origin': 'https://keiranholloway.github.io',
                    'content-type': 'application/json',
                },
                multiValueHeaders: {},
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                path: '',
                isBase64Encoded: false,
            };
            const result = await handler(event);
            expect(result.statusCode).toBe(200);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.imageUrl).toBeDefined();
        });
    });
    describe('Error handling and recovery', () => {
        it('should handle OpenAI API rate limiting', async () => {
            const contentId = 'test-content-id';
            // Mock rate limit error
            global.fetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({
                    error: {
                        message: 'Rate limit exceeded',
                        type: 'rate_limit_exceeded'
                    }
                }),
            });
            // Mock status update
            mockDynamoClient.send.mockResolvedValueOnce({});
            const { handler } = await Promise.resolve().then(() => __importStar(require('../lambda/image-generation-agent')));
            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    contentId,
                    prompt: 'Test prompt'
                }),
                headers: {
                    'origin': 'https://keiranholloway.github.io',
                    'content-type': 'application/json',
                },
                multiValueHeaders: {},
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                path: '',
                isBase64Encoded: false,
            };
            const result = await handler(event);
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.error).toContain('Rate limit exceeded');
            // Verify error status was recorded
            expect(mockDynamoClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    UpdateExpression: expect.stringContaining('error'),
                })
            }));
        });
        it('should handle S3 storage failures', async () => {
            const contentId = 'test-content-id';
            // Mock successful OpenAI response
            global.fetch
                .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://example.com/image.png' }]
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(2048),
            });
            // Mock S3 upload failure
            mockS3Client.send.mockRejectedValueOnce(new Error('S3 upload failed'));
            // Mock status update
            mockDynamoClient.send.mockResolvedValueOnce({});
            const { handler } = await Promise.resolve().then(() => __importStar(require('../lambda/image-generation-agent')));
            const event = {
                httpMethod: 'POST',
                body: JSON.stringify({
                    contentId,
                    prompt: 'Test prompt'
                }),
                headers: {
                    'origin': 'https://keiranholloway.github.io',
                    'content-type': 'application/json',
                },
                multiValueHeaders: {},
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                path: '',
                isBase64Encoded: false,
            };
            const result = await handler(event);
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.error).toContain('Internal server error');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2UtZ2VuZXJhdGlvbi1pbnRlZ3JhdGlvbi50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW1hZ2UtZ2VuZXJhdGlvbi1pbnRlZ3JhdGlvbi50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSx3REFBdUY7QUFJdkYsZUFBZTtBQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsMEJBQTBCLENBQUMsQ0FBQztBQUN0QyxJQUFJLENBQUMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLENBQUM7QUFDbkMsSUFBSSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO0FBQ2hDLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztBQUVqQyxhQUFhO0FBQ2IsTUFBTSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7QUFFekIsUUFBUSxDQUFDLDhCQUE4QixFQUFFLEdBQUcsRUFBRTtJQUM1QyxJQUFJLGdCQUFxRCxDQUFDO0lBQzFELElBQUksWUFBbUMsQ0FBQztJQUN4QyxJQUFJLGFBQXFDLENBQUM7SUFFMUMsVUFBVSxDQUFDLEdBQUcsRUFBRTtRQUNkLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUVyQixnQkFBZ0IsR0FBRztZQUNqQixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtTQUNULENBQUM7UUFFVCxZQUFZLEdBQUc7WUFDYixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtTQUNULENBQUM7UUFFVCxhQUFhLEdBQUc7WUFDZCxJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtTQUNULENBQUM7UUFFVCxtQ0FBbUM7UUFDbEMscUNBQXNCLENBQUMsSUFBa0IsQ0FBQyxlQUFlLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztJQUMvRSxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxzQ0FBc0MsRUFBRSxHQUFHLEVBQUU7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Q0QsaUJBQWlCLEVBQUUsRUFBRTtnQkFDckIsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLHFCQUFxQixFQUFFLElBQUk7Z0JBQzNCLCtCQUErQixFQUFFLElBQUk7Z0JBQ3JDLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsRUFBUztnQkFDekIsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLEVBQUU7Z0JBQ1IsZUFBZSxFQUFFLEtBQUs7YUFDdkIsQ0FBQztZQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRXBDLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3BDLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzdDLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDLENBQUM7UUFDaEUsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kLCBHZXRDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuaW1wb3J0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xyXG5pbXBvcnQgeyBTUVNDbGllbnQsIFJlY2VpdmVNZXNzYWdlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xyXG5cclxuLy8gTW9jayBBV1MgU0RLXHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJyk7XHJcbmplc3QubW9jaygnQGF3cy1zZGsvbGliLWR5bmFtb2RiJyk7XHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LXMzJyk7XHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LXNxcycpO1xyXG5cclxuLy8gTW9jayBmZXRjaFxyXG5nbG9iYWwuZmV0Y2ggPSBqZXN0LmZuKCk7XHJcblxyXG5kZXNjcmliZSgnSW1hZ2UgR2VuZXJhdGlvbiBJbnRlZ3JhdGlvbicsICgpID0+IHtcclxuICBsZXQgbW9ja0R5bmFtb0NsaWVudDogamVzdC5Nb2NrZWQ8RHluYW1vREJEb2N1bWVudENsaWVudD47XHJcbiAgbGV0IG1vY2tTM0NsaWVudDogamVzdC5Nb2NrZWQ8UzNDbGllbnQ+O1xyXG4gIGxldCBtb2NrU1FTQ2xpZW50OiBqZXN0Lk1vY2tlZDxTUVNDbGllbnQ+O1xyXG5cclxuICBiZWZvcmVFYWNoKCgpID0+IHtcclxuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xyXG4gICAgXHJcbiAgICBtb2NrRHluYW1vQ2xpZW50ID0ge1xyXG4gICAgICBzZW5kOiBqZXN0LmZuKCksXHJcbiAgICB9IGFzIGFueTtcclxuICAgIFxyXG4gICAgbW9ja1MzQ2xpZW50ID0ge1xyXG4gICAgICBzZW5kOiBqZXN0LmZuKCksXHJcbiAgICB9IGFzIGFueTtcclxuICAgIFxyXG4gICAgbW9ja1NRU0NsaWVudCA9IHtcclxuICAgICAgc2VuZDogamVzdC5mbigpLFxyXG4gICAgfSBhcyBhbnk7XHJcblxyXG4gICAgLy8gTW9jayBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb21cclxuICAgIChEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20gYXMgamVzdC5Nb2NrKS5tb2NrUmV0dXJuVmFsdWUobW9ja0R5bmFtb0NsaWVudCk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdFbmQtdG8tZW5kIGltYWdlIGdlbmVyYXRpb24gd29ya2Zsb3cnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGNvbXBsZXRlIGZ1bGwgaW1hZ2UgZ2VuZXJhdGlvbiB3b3JrZmxvdycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgY29udGVudElkID0gJ3Rlc3QtY29udGVudC1pZCc7XHJcbiAgICAgIGNvbnN0IHByb21wdCA9ICdBIHByb2Zlc3Npb25hbCBpbGx1c3RyYXRpb24gb2YgdGVjaG5vbG9neSc7XHJcblxyXG4gICAgICAvLyBTdGVwIDE6IENyZWF0ZSBjb250ZW50IHJlY29yZFxyXG4gICAgICBjb25zdCBjb250ZW50UmVjb3JkID0ge1xyXG4gICAgICAgIGlkOiBjb250ZW50SWQsXHJcbiAgICAgICAgdGl0bGU6ICdUZXN0IEJsb2cgUG9zdCcsXHJcbiAgICAgICAgY29udGVudDogJ1RoaXMgaXMgYSB0ZXN0IGJsb2cgcG9zdCBhYm91dCB0ZWNobm9sb2d5LicsXHJcbiAgICAgICAgc3RhdHVzOiAnY29udGVudF9nZW5lcmF0ZWQnLFxyXG4gICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgbW9ja0R5bmFtb0NsaWVudC5zZW5kLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7IEl0ZW06IGNvbnRlbnRSZWNvcmQgfSk7XHJcblxyXG4gICAgICAvLyBTdGVwIDI6IE1vY2sgc3VjY2Vzc2Z1bCBPcGVuQUkgaW1hZ2UgZ2VuZXJhdGlvblxyXG4gICAgICBjb25zdCBtb2NrSW1hZ2VVcmwgPSAnaHR0cHM6Ly9vYWlkYWxsZWFwaXByb2RzY3VzLmJsb2IuY29yZS53aW5kb3dzLm5ldC9wcml2YXRlL3Rlc3QtaW1hZ2UucG5nJztcclxuICAgICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2spXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgICBvazogdHJ1ZSxcclxuICAgICAgICAgIGpzb246IGFzeW5jICgpID0+ICh7XHJcbiAgICAgICAgICAgIGRhdGE6IFt7IHVybDogbW9ja0ltYWdlVXJsIH1dXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9KVxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgICAgb2s6IHRydWUsXHJcbiAgICAgICAgICBhcnJheUJ1ZmZlcjogYXN5bmMgKCkgPT4gbmV3IEFycmF5QnVmZmVyKDIwNDgpLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gU3RlcCAzOiBNb2NrIFMzIHVwbG9hZCBzdWNjZXNzXHJcbiAgICAgIG1vY2tTM0NsaWVudC5zZW5kLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7fSk7XHJcblxyXG4gICAgICAvLyBTdGVwIDQ6IE1vY2sgRHluYW1vREIgdXBkYXRlIHN1Y2Nlc3NcclxuICAgICAgbW9ja0R5bmFtb0NsaWVudC5zZW5kLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7fSk7XHJcblxyXG4gICAgICAvLyBTdGVwIDU6IE1vY2sgU1FTIG5vdGlmaWNhdGlvbiBzdWNjZXNzXHJcbiAgICAgIG1vY2tTUVNDbGllbnQuc2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe30pO1xyXG5cclxuICAgICAgLy8gSW1wb3J0IGFuZCB0ZXN0IHRoZSBoYW5kbGVyXHJcbiAgICAgIGNvbnN0IHsgaGFuZGxlciB9ID0gYXdhaXQgaW1wb3J0KCcuLi9sYW1iZGEvaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudCcpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgZXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICAgIHByb21wdCxcclxuICAgICAgICAgIHNpemU6ICcxMDI0eDEwMjQnXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ29yaWdpbic6ICdodHRwczovL2tlaXJhbmhvbGxvd2F5LmdpdGh1Yi5pbycsXHJcbiAgICAgICAgICAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIHBhdGg6ICcnLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSBzdWNjZXNzZnVsIHJlc3BvbnNlXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKHJlc3VsdC5ib2R5KTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5zdWNjZXNzKS50b0JlKHRydWUpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmltYWdlVXJsKS50b0JlRGVmaW5lZCgpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IE9wZW5BSSBBUEkgd2FzIGNhbGxlZCBjb3JyZWN0bHlcclxuICAgICAgZXhwZWN0KGdsb2JhbC5mZXRjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICAgJ2h0dHBzOi8vYXBpLm9wZW5haS5jb20vdjEvaW1hZ2VzL2dlbmVyYXRpb25zJyxcclxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICAgIGhlYWRlcnM6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBleHBlY3Quc3RyaW5nQ29udGFpbmluZygnQmVhcmVyJyksXHJcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIGJvZHk6IGV4cGVjdC5zdHJpbmdDb250YWluaW5nKHByb21wdCksXHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSBpbWFnZSB3YXMgZG93bmxvYWRlZFxyXG4gICAgICBleHBlY3QoZ2xvYmFsLmZldGNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChtb2NrSW1hZ2VVcmwpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IFMzIHVwbG9hZCB3YXMgYXR0ZW1wdGVkXHJcbiAgICAgIGV4cGVjdChtb2NrUzNDbGllbnQuc2VuZCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgaW5wdXQ6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICAgQnVja2V0OiBleHBlY3QuYW55KFN0cmluZyksXHJcbiAgICAgICAgICAgIEtleTogZXhwZWN0LnN0cmluZ01hdGNoaW5nKC9eaW1hZ2VzXFwvLipcXC5wbmckLyksXHJcbiAgICAgICAgICAgIEJvZHk6IGV4cGVjdC5hbnkoVWludDhBcnJheSksXHJcbiAgICAgICAgICAgIENvbnRlbnRUeXBlOiAnaW1hZ2UvcG5nJyxcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSBEeW5hbW9EQiB3YXMgdXBkYXRlZFxyXG4gICAgICBleHBlY3QobW9ja0R5bmFtb0NsaWVudC5zZW5kKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcclxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICBpbnB1dDogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgICBUYWJsZU5hbWU6IGV4cGVjdC5hbnkoU3RyaW5nKSxcclxuICAgICAgICAgICAgS2V5OiB7IGlkOiBjb250ZW50SWQgfSxcclxuICAgICAgICAgICAgVXBkYXRlRXhwcmVzc2lvbjogZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ2ltYWdlVXJsJyksXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgb3JjaGVzdHJhdG9yIHdhcyBub3RpZmllZFxyXG4gICAgICBleHBlY3QobW9ja1NRU0NsaWVudC5zZW5kKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcclxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICBpbnB1dDogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgICBRdWV1ZVVybDogZXhwZWN0LmFueShTdHJpbmcpLFxyXG4gICAgICAgICAgICBNZXNzYWdlQm9keTogZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ2ltYWdlX2dlbmVyYXRlZCcpLFxyXG4gICAgICAgICAgfSlcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29udGVudCBhbmFseXNpcyBmb3IgaW1hZ2UgcHJvbXB0IGdlbmVyYXRpb24nLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSAnVGhpcyBhcnRpY2xlIGRpc2N1c3NlcyBhcnRpZmljaWFsIGludGVsbGlnZW5jZSwgbWFjaGluZSBsZWFybmluZywgYW5kIHRoZSBmdXR1cmUgb2YgdGVjaG5vbG9neSBpbiBidXNpbmVzcyBhdXRvbWF0aW9uLic7XHJcbiAgICAgIFxyXG4gICAgICAvLyBNb2NrIGNvbnRlbnQgYW5hbHlzaXMgZW5kcG9pbnRcclxuICAgICAgY29uc3QgbW9ja0FuYWx5c2lzID0ge1xyXG4gICAgICAgIHByb21wdDogJ1Byb2Zlc3Npb25hbCBpbGx1c3RyYXRpb24gb2YgYXJ0aWZpY2lhbCBpbnRlbGxpZ2VuY2UgYW5kIG1hY2hpbmUgbGVhcm5pbmcgdGVjaG5vbG9neSwgZmVhdHVyaW5nIGF1dG9tYXRpb24gYW5kIGJ1c2luZXNzIGNvbmNlcHRzLCBoaWdoIHF1YWxpdHksIGRldGFpbGVkJyxcclxuICAgICAgICBzdHlsZTogJ3Byb2Zlc3Npb25hbCdcclxuICAgICAgfTtcclxuXHJcbiAgICAgIChnbG9iYWwuZmV0Y2ggYXMgamVzdC5Nb2NrKS5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIG9rOiB0cnVlLFxyXG4gICAgICAgIGpzb246IGFzeW5jICgpID0+IG1vY2tBbmFseXNpcyxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBUZXN0IGNvbnRlbnQgYW5hbHlzaXNcclxuICAgICAgY29uc3QgeyBpbWFnZUdlbmVyYXRpb25TZXJ2aWNlIH0gPSBhd2FpdCBpbXBvcnQoJy4uLy4uL2Zyb250ZW5kL3NyYy9zZXJ2aWNlcy9pbWFnZUdlbmVyYXRpb25TZXJ2aWNlJyk7XHJcbiAgICAgIGNvbnN0IGFuYWx5c2lzID0gYXdhaXQgaW1hZ2VHZW5lcmF0aW9uU2VydmljZS5hbmFseXplQ29udGVudEZvckltYWdlKGNvbnRlbnQpO1xyXG5cclxuICAgICAgZXhwZWN0KGFuYWx5c2lzLnByb21wdCkudG9Db250YWluKCdhcnRpZmljaWFsIGludGVsbGlnZW5jZScpO1xyXG4gICAgICBleHBlY3QoYW5hbHlzaXMucHJvbXB0KS50b0NvbnRhaW4oJ21hY2hpbmUgbGVhcm5pbmcnKTtcclxuICAgICAgZXhwZWN0KGFuYWx5c2lzLnN0eWxlKS50b0JlKCdwcm9mZXNzaW9uYWwnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGltYWdlIHJldmlzaW9uIHdvcmtmbG93JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBjb250ZW50SWQgPSAndGVzdC1jb250ZW50LWlkJztcclxuICAgICAgY29uc3QgZmVlZGJhY2sgPSAnTWFrZSB0aGUgaW1hZ2UgbW9yZSBjb2xvcmZ1bCBhbmQgdmlicmFudCc7XHJcbiAgICAgIGNvbnN0IG5ld1Byb21wdCA9ICdWaWJyYW50LCBjb2xvcmZ1bCBpbGx1c3RyYXRpb24gb2YgdGVjaG5vbG9neSc7XHJcblxyXG4gICAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgcmV2aXNpb25cclxuICAgICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2spXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgICBvazogdHJ1ZSxcclxuICAgICAgICAgIGpzb246IGFzeW5jICgpID0+ICh7XHJcbiAgICAgICAgICAgIGRhdGE6IFt7IHVybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vcmV2aXNlZC1pbWFnZS5wbmcnIH1dXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9KVxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgICAgb2s6IHRydWUsXHJcbiAgICAgICAgICBhcnJheUJ1ZmZlcjogYXN5bmMgKCkgPT4gbmV3IEFycmF5QnVmZmVyKDIwNDgpLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgbW9ja1MzQ2xpZW50LnNlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHt9KTtcclxuICAgICAgbW9ja0R5bmFtb0NsaWVudC5zZW5kLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7fSk7XHJcbiAgICAgIG1vY2tTUVNDbGllbnQuc2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe30pO1xyXG5cclxuICAgICAgY29uc3QgeyBoYW5kbGVyIH0gPSBhd2FpdCBpbXBvcnQoJy4uL2xhbWJkYS9pbWFnZS1nZW5lcmF0aW9uLWFnZW50Jyk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBldmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgY29udGVudElkLFxyXG4gICAgICAgICAgcHJvbXB0OiBuZXdQcm9tcHQsXHJcbiAgICAgICAgICBmZWVkYmFja1xyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdvcmlnaW4nOiAnaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nLFxyXG4gICAgICAgICAgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBwYXRoOiAnJyxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5pbWFnZVVybCkudG9CZURlZmluZWQoKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnRXJyb3IgaGFuZGxpbmcgYW5kIHJlY292ZXJ5JywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgT3BlbkFJIEFQSSByYXRlIGxpbWl0aW5nJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBjb250ZW50SWQgPSAndGVzdC1jb250ZW50LWlkJztcclxuXHJcbiAgICAgIC8vIE1vY2sgcmF0ZSBsaW1pdCBlcnJvclxyXG4gICAgICAoZ2xvYmFsLmZldGNoIGFzIGplc3QuTW9jaykubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcclxuICAgICAgICBvazogZmFsc2UsXHJcbiAgICAgICAganNvbjogYXN5bmMgKCkgPT4gKHtcclxuICAgICAgICAgIGVycm9yOiB7IFxyXG4gICAgICAgICAgICBtZXNzYWdlOiAnUmF0ZSBsaW1pdCBleGNlZWRlZCcsXHJcbiAgICAgICAgICAgIHR5cGU6ICdyYXRlX2xpbWl0X2V4Y2VlZGVkJ1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc3RhdHVzIHVwZGF0ZVxyXG4gICAgICBtb2NrRHluYW1vQ2xpZW50LnNlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHt9KTtcclxuXHJcbiAgICAgIGNvbnN0IHsgaGFuZGxlciB9ID0gYXdhaXQgaW1wb3J0KCcuLi9sYW1iZGEvaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudCcpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgZXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICAgIHByb21wdDogJ1Rlc3QgcHJvbXB0J1xyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdvcmlnaW4nOiAnaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nLFxyXG4gICAgICAgICAgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBwYXRoOiAnJyxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZXJyb3IpLnRvQ29udGFpbignUmF0ZSBsaW1pdCBleGNlZWRlZCcpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IGVycm9yIHN0YXR1cyB3YXMgcmVjb3JkZWRcclxuICAgICAgZXhwZWN0KG1vY2tEeW5hbW9DbGllbnQuc2VuZCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgaW5wdXQ6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICAgVXBkYXRlRXhwcmVzc2lvbjogZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ2Vycm9yJyksXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBTMyBzdG9yYWdlIGZhaWx1cmVzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBjb250ZW50SWQgPSAndGVzdC1jb250ZW50LWlkJztcclxuXHJcbiAgICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCBPcGVuQUkgcmVzcG9uc2VcclxuICAgICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2spXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgICBvazogdHJ1ZSxcclxuICAgICAgICAgIGpzb246IGFzeW5jICgpID0+ICh7XHJcbiAgICAgICAgICAgIGRhdGE6IFt7IHVybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vaW1hZ2UucG5nJyB9XVxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgfSlcclxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcclxuICAgICAgICAgIG9rOiB0cnVlLFxyXG4gICAgICAgICAgYXJyYXlCdWZmZXI6IGFzeW5jICgpID0+IG5ldyBBcnJheUJ1ZmZlcigyMDQ4KSxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgUzMgdXBsb2FkIGZhaWx1cmVcclxuICAgICAgbW9ja1MzQ2xpZW50LnNlbmQubW9ja1JlamVjdGVkVmFsdWVPbmNlKG5ldyBFcnJvcignUzMgdXBsb2FkIGZhaWxlZCcpKTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc3RhdHVzIHVwZGF0ZVxyXG4gICAgICBtb2NrRHluYW1vQ2xpZW50LnNlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHt9KTtcclxuXHJcbiAgICAgIGNvbnN0IHsgaGFuZGxlciB9ID0gYXdhaXQgaW1wb3J0KCcuLi9sYW1iZGEvaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudCcpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgZXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICAgIHByb21wdDogJ1Rlc3QgcHJvbXB0J1xyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdvcmlnaW4nOiAnaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nLFxyXG4gICAgICAgICAgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBwYXRoOiAnJyxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZXJyb3IpLnRvQ29udGFpbignSW50ZXJuYWwgc2VydmVyIGVycm9yJyk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19