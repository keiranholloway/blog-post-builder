"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const image_generation_agent_1 = require("../lambda/image-generation-agent");
const aws_sdk_client_mock_1 = require("aws-sdk-client-mock");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
// Mock AWS clients
const dynamoMock = (0, aws_sdk_client_mock_1.mockClient)(client_dynamodb_1.DynamoDBClient);
const docClientMock = (0, aws_sdk_client_mock_1.mockClient)(lib_dynamodb_1.DynamoDBDocumentClient);
const s3Mock = (0, aws_sdk_client_mock_1.mockClient)(client_s3_1.S3Client);
const sqsMock = (0, aws_sdk_client_mock_1.mockClient)(client_sqs_1.SQSClient);
const eventBridgeMock = (0, aws_sdk_client_mock_1.mockClient)(client_eventbridge_1.EventBridgeClient);
// Mock fetch globally
global.fetch = jest.fn();
// Mock Sharp
jest.mock('sharp', () => {
    return jest.fn(() => ({
        resize: jest.fn().mockReturnThis(),
        webp: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('optimized-image-data')),
        metadata: jest.fn().mockResolvedValue({ width: 1024, height: 1024 })
    }));
});
// Mock environment variables
process.env.CONTENT_TABLE_NAME = 'test-content';
process.env.IMAGE_BUCKET_NAME = 'test-images';
process.env.ORCHESTRATOR_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-orchestrator';
process.env.EVENT_BUS_NAME = 'test-events';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.AWS_REGION = 'us-east-1';
describe('Image Generation Agent', () => {
    const mockContext = {
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'test-function',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        memoryLimitInMB: '1024',
        awsRequestId: 'test-request-id',
        logGroupName: '/aws/lambda/test-function',
        logStreamName: '2023/01/01/[$LATEST]test-stream',
        getRemainingTimeInMillis: () => 30000,
        done: () => { },
        fail: () => { },
        succeed: () => { },
    };
    beforeEach(() => {
        dynamoMock.reset();
        docClientMock.reset();
        s3Mock.reset();
        sqsMock.reset();
        eventBridgeMock.reset();
        global.fetch.mockClear();
    });
    describe('SQS Event Handling', () => {
        it('should successfully generate image from SQS request', async () => {
            // Mock OpenAI API response
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://example.com/generated-image.png' }]
                }),
            });
            // Mock image download
            global.fetch.mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(1024),
            });
            // Mock S3 uploads
            s3Mock.on(client_s3_1.PutObjectCommand).resolves({});
            // Mock SQS send
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({
                MessageId: 'test-message-id'
            });
            // Mock EventBridge publish
            eventBridgeMock.on(client_eventbridge_1.PutEventsCommand).resolves({
                FailedEntryCount: 0,
                Entries: [{ EventId: 'test-event-id' }]
            });
            const event = {
                Records: [{
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageId: 'msg-123',
                            workflowId: 'workflow-123',
                            stepId: 'image-generation',
                            agentType: 'image-generator',
                            messageType: 'request',
                            payload: {
                                workflowId: 'workflow-123',
                                stepId: 'image-generation',
                                contentId: 'content-123',
                                content: 'This is a blog post about cloud computing and AWS services.',
                                userId: 'user-123',
                                style: 'professional'
                            },
                            timestamp: new Date().toISOString()
                        }),
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '1234567890000',
                            SenderId: 'test-sender',
                            ApproximateFirstReceiveTimestamp: '1234567890000'
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                        awsRegion: 'us-east-1'
                    }]
            };
            await expect((0, image_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
            // Verify OpenAI API was called
            expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-openai-key'
                })
            }));
            // Verify S3 uploads (original and optimized)
            expect(s3Mock.commandCalls(client_s3_1.PutObjectCommand)).toHaveLength(2);
            // Verify response was sent to orchestrator
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            const sqsCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0].args[0].input;
            const messageBody = JSON.parse(sqsCall.MessageBody);
            expect(messageBody.messageType).toBe('response');
            expect(messageBody.payload.success).toBe(true);
            expect(messageBody.payload.imageUrl).toBeDefined();
            // Verify event was published
            expect(eventBridgeMock.commandCalls(client_eventbridge_1.PutEventsCommand)).toHaveLength(1);
            const eventCall = eventBridgeMock.commandCalls(client_eventbridge_1.PutEventsCommand)[0].args[0].input;
            expect(eventCall.Entries[0].Source).toBe('automated-blog-poster.image-agent');
            expect(eventCall.Entries[0].DetailType).toBe('Image Generation Completed');
        });
        it('should handle image revision requests', async () => {
            // Mock OpenAI API response
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://example.com/revised-image.png' }]
                }),
            });
            // Mock image download
            global.fetch.mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(1024),
            });
            // Mock S3 uploads
            s3Mock.on(client_s3_1.PutObjectCommand).resolves({});
            // Mock SQS send
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({
                MessageId: 'test-message-id'
            });
            const event = {
                Records: [{
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageType: 'revision',
                            payload: {
                                workflowId: 'workflow-123',
                                stepId: 'image-revision',
                                contentId: 'content-123',
                                currentImageUrl: 'https://example.com/current-image.png',
                                feedback: 'Make it more colorful and vibrant',
                                userId: 'user-123'
                            }
                        }),
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '1234567890000',
                            SenderId: 'test-sender',
                            ApproximateFirstReceiveTimestamp: '1234567890000'
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                        awsRegion: 'us-east-1'
                    }]
            };
            await expect((0, image_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
            // Verify response was sent
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            const messageBody = JSON.parse(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0].args[0].input.MessageBody);
            expect(messageBody.payload.success).toBe(true);
            expect(messageBody.payload.feedback).toBe('Make it more colorful and vibrant');
        });
        it('should handle OpenAI API errors gracefully', async () => {
            // Mock OpenAI API error
            global.fetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({
                    error: { message: 'Rate limit exceeded' }
                }),
            });
            // Mock SQS send
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({
                MessageId: 'test-message-id'
            });
            // Mock EventBridge publish
            eventBridgeMock.on(client_eventbridge_1.PutEventsCommand).resolves({
                FailedEntryCount: 0,
                Entries: [{ EventId: 'test-event-id' }]
            });
            const event = {
                Records: [{
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageType: 'request',
                            payload: {
                                workflowId: 'workflow-123',
                                stepId: 'image-generation',
                                contentId: 'content-123',
                                content: 'Test content',
                                userId: 'user-123'
                            }
                        }),
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '1234567890000',
                            SenderId: 'test-sender',
                            ApproximateFirstReceiveTimestamp: '1234567890000'
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                        awsRegion: 'us-east-1'
                    }]
            };
            await expect((0, image_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
            // Verify error response was sent
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            const messageBody = JSON.parse(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0].args[0].input.MessageBody);
            expect(messageBody.messageType).toBe('error');
            expect(messageBody.payload.success).toBe(false);
            expect(messageBody.payload.error).toContain('Rate limit exceeded');
            // Verify failure event was published
            expect(eventBridgeMock.commandCalls(client_eventbridge_1.PutEventsCommand)).toHaveLength(1);
            const eventCall = eventBridgeMock.commandCalls(client_eventbridge_1.PutEventsCommand)[0].args[0].input;
            expect(eventCall.Entries[0].DetailType).toBe('Image Generation Failed');
        });
    });
    describe('API Gateway Event Handling', () => {
        it('should handle direct image generation API call', async () => {
            // Mock OpenAI API response
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://example.com/generated-image.png' }]
                }),
            });
            // Mock image download
            global.fetch.mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(1024),
            });
            // Mock S3 uploads
            s3Mock.on(client_s3_1.PutObjectCommand).resolves({});
            // Mock DynamoDB update
            docClientMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            const event = {
                httpMethod: 'POST',
                path: '/api/image/generate',
                headers: {
                    'Content-Type': 'application/json',
                    'origin': 'https://keiranholloway.github.io'
                },
                body: JSON.stringify({
                    contentId: 'content-123',
                    prompt: 'Professional illustration of cloud computing',
                    style: 'professional'
                }),
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {
                    accountId: '123456789012',
                    apiId: 'test-api',
                    httpMethod: 'POST',
                    path: '/api/image/generate',
                    stage: 'prod',
                    requestId: 'test-request-id',
                    requestTime: '2023-01-01T00:00:00Z',
                    requestTimeEpoch: 1672531200000,
                    identity: {
                        cognitoIdentityPoolId: null,
                        accountId: null,
                        cognitoIdentityId: null,
                        caller: null,
                        sourceIp: '127.0.0.1',
                        principalOrgId: null,
                        accessKey: null,
                        cognitoAuthenticationType: null,
                        cognitoAuthenticationProvider: null,
                        userArn: null,
                        userAgent: 'test-agent',
                        user: null,
                        apiKey: null,
                        apiKeyId: null,
                        clientCert: null
                    },
                    protocol: 'HTTP/1.1',
                    resourceId: 'test-resource',
                    resourcePath: '/api/image/generate',
                    authorizer: null
                },
                resource: '/api/image/generate',
                isBase64Encoded: false,
                multiValueHeaders: {}
            };
            const result = await (0, image_generation_agent_1.handler)(event, mockContext);
            expect(result).toBeDefined();
            expect(result.statusCode).toBe(200);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.success).toBe(true);
            expect(responseBody.imageUrl).toBeDefined();
            expect(responseBody.metadata).toBeDefined();
            // Verify S3 uploads occurred
            expect(s3Mock.commandCalls(client_s3_1.PutObjectCommand)).toHaveLength(2);
            // Verify content was updated
            expect(docClientMock.commandCalls(lib_dynamodb_1.UpdateCommand)).toHaveLength(1);
        });
        it('should handle content analysis API call', async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/image/analyze',
                headers: {
                    'Content-Type': 'application/json',
                    'origin': 'https://keiranholloway.github.io'
                },
                body: JSON.stringify({
                    content: 'This blog post discusses cloud computing, AWS services, and serverless architecture. It covers modern infrastructure patterns and cost optimization strategies.'
                }),
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {
                    accountId: '123456789012',
                    apiId: 'test-api',
                    httpMethod: 'POST',
                    path: '/api/image/analyze',
                    stage: 'prod',
                    requestId: 'test-request-id',
                    requestTime: '2023-01-01T00:00:00Z',
                    requestTimeEpoch: 1672531200000,
                    identity: {
                        cognitoIdentityPoolId: null,
                        accountId: null,
                        cognitoIdentityId: null,
                        caller: null,
                        sourceIp: '127.0.0.1',
                        principalOrgId: null,
                        accessKey: null,
                        cognitoAuthenticationType: null,
                        cognitoAuthenticationProvider: null,
                        userArn: null,
                        userAgent: 'test-agent',
                        user: null,
                        apiKey: null,
                        apiKeyId: null,
                        clientCert: null
                    },
                    protocol: 'HTTP/1.1',
                    resourceId: 'test-resource',
                    resourcePath: '/api/image/analyze',
                    authorizer: null
                },
                resource: '/api/image/analyze',
                isBase64Encoded: false,
                multiValueHeaders: {}
            };
            const result = await (0, image_generation_agent_1.handler)(event, mockContext);
            expect(result).toBeDefined();
            expect(result.statusCode).toBe(200);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.prompt).toBeDefined();
            expect(responseBody.style).toBeDefined();
            expect(responseBody.concepts).toContain('cloud');
            expect(responseBody.concepts).toContain('aws');
            expect(responseBody.concepts).toContain('serverless');
        });
        it('should handle CORS preflight requests', async () => {
            const event = {
                httpMethod: 'OPTIONS',
                path: '/api/image/generate',
                headers: {
                    'origin': 'https://keiranholloway.github.io'
                },
                body: null,
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {
                    accountId: '123456789012',
                    apiId: 'test-api',
                    httpMethod: 'OPTIONS',
                    path: '/api/image/generate',
                    stage: 'prod',
                    requestId: 'test-request-id',
                    requestTime: '2023-01-01T00:00:00Z',
                    requestTimeEpoch: 1672531200000,
                    identity: {
                        cognitoIdentityPoolId: null,
                        accountId: null,
                        cognitoIdentityId: null,
                        caller: null,
                        sourceIp: '127.0.0.1',
                        principalOrgId: null,
                        accessKey: null,
                        cognitoAuthenticationType: null,
                        cognitoAuthenticationProvider: null,
                        userArn: null,
                        userAgent: 'test-agent',
                        user: null,
                        apiKey: null,
                        apiKeyId: null,
                        clientCert: null
                    },
                    protocol: 'HTTP/1.1',
                    resourceId: 'test-resource',
                    resourcePath: '/api/image/generate',
                    authorizer: null
                },
                resource: '/api/image/generate',
                isBase64Encoded: false,
                multiValueHeaders: {}
            };
            const result = await (0, image_generation_agent_1.handler)(event, mockContext);
            expect(result).toBeDefined();
            expect(result.statusCode).toBe(200);
            expect(result.headers['Access-Control-Allow-Origin']).toBe('https://keiranholloway.github.io');
            expect(result.headers['Access-Control-Allow-Methods']).toContain('POST');
        });
    });
    describe('Content Analysis', () => {
        it('should extract relevant concepts from technical content', async () => {
            const content = 'This article explores AWS Lambda, Kubernetes orchestration, and serverless architecture patterns for modern cloud infrastructure.';
            // We need to test the internal function, but since it's not exported, we'll test through the API
            const event = {
                httpMethod: 'POST',
                path: '/api/image/analyze',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '/api/image/analyze',
                isBase64Encoded: false,
                multiValueHeaders: {}
            };
            const result = await (0, image_generation_agent_1.handler)(event, mockContext);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.concepts).toContain('aws');
            expect(responseBody.concepts).toContain('kubernetes');
            expect(responseBody.concepts).toContain('serverless');
            expect(responseBody.tone).toBe('technical');
            expect(responseBody.prompt).toContain('technical diagram');
        });
        it('should handle business-focused content', async () => {
            const content = 'This business strategy article discusses enterprise transformation, cost optimization, and organizational change management.';
            const event = {
                httpMethod: 'POST',
                path: '/api/image/analyze',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '/api/image/analyze',
                isBase64Encoded: false,
                multiValueHeaders: {}
            };
            const result = await (0, image_generation_agent_1.handler)(event, mockContext);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.concepts).toContain('enterprise');
            expect(responseBody.tone).toBe('professional');
            expect(responseBody.style).toBe('professional');
            expect(responseBody.prompt).toContain('professional illustration');
        });
    });
    describe('Error Handling', () => {
        it('should handle malformed SQS messages', async () => {
            const event = {
                Records: [{
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: 'invalid-json',
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '1234567890000',
                            SenderId: 'test-sender',
                            ApproximateFirstReceiveTimestamp: '1234567890000'
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                        awsRegion: 'us-east-1'
                    }]
            };
            await expect((0, image_generation_agent_1.handler)(event, mockContext)).rejects.toThrow();
        });
        it('should handle missing API request body', async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/image/generate',
                headers: { 'Content-Type': 'application/json' },
                body: null,
                pathParameters: null,
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '/api/image/generate',
                isBase64Encoded: false,
                multiValueHeaders: {}
            };
            const result = await (0, image_generation_agent_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.error).toBe('Request body is required');
        });
        it('should handle unknown message types gracefully', async () => {
            const event = {
                Records: [{
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageType: 'unknown-type',
                            payload: {}
                        }),
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '1234567890000',
                            SenderId: 'test-sender',
                            ApproximateFirstReceiveTimestamp: '1234567890000'
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
                        awsRegion: 'us-east-1'
                    }]
            };
            // Should not throw but should log warning
            await expect((0, image_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudC50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsNkVBQTJEO0FBRTNELDZEQUFpRDtBQUNqRCw4REFBMEQ7QUFDMUQsd0RBQTBGO0FBQzFGLGtEQUFnRTtBQUNoRSxvREFBb0U7QUFDcEUsb0VBQWtGO0FBRWxGLG1CQUFtQjtBQUNuQixNQUFNLFVBQVUsR0FBRyxJQUFBLGdDQUFVLEVBQUMsZ0NBQWMsQ0FBQyxDQUFDO0FBQzlDLE1BQU0sYUFBYSxHQUFHLElBQUEsZ0NBQVUsRUFBQyxxQ0FBc0IsQ0FBQyxDQUFDO0FBQ3pELE1BQU0sTUFBTSxHQUFHLElBQUEsZ0NBQVUsRUFBQyxvQkFBUSxDQUFDLENBQUM7QUFDcEMsTUFBTSxPQUFPLEdBQUcsSUFBQSxnQ0FBVSxFQUFDLHNCQUFTLENBQUMsQ0FBQztBQUN0QyxNQUFNLGVBQWUsR0FBRyxJQUFBLGdDQUFVLEVBQUMsc0NBQWlCLENBQUMsQ0FBQztBQUV0RCxzQkFBc0I7QUFDdEIsTUFBTSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7QUFFekIsYUFBYTtBQUNiLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEdBQUcsRUFBRTtJQUN0QixPQUFPLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUNwQixNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtRQUNsQyxJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtRQUNoQyxRQUFRLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsQ0FBQztRQUMxRSxRQUFRLEVBQUUsSUFBSSxDQUFDLEVB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QVcsRUFBRSxTQUFTO3dCQUN0QixjQUFjLEVBQUUsK0NBQStDO3dCQUMvRCxTQUFTLEVBQUUsV0FBVztxQkFDdkIsQ0FBQzthQUNILENBQUM7WUFFRiwwQ0FBMEM7WUFDMUMsTUFBTSxNQUFNLENBQUMsSUFBQSxnQ0FBTyxFQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDbkUsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgaGFuZGxlciB9IGZyb20gJy4uL2xhbWJkYS9pbWFnZS1nZW5lcmF0aW9uLWFnZW50JztcclxuaW1wb3J0IHsgU1FTRXZlbnQsIENvbnRleHQsIEFQSUdhdGV3YXlQcm94eUV2ZW50IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IG1vY2tDbGllbnQgfSBmcm9tICdhd3Mtc2RrLWNsaWVudC1tb2NrJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBHZXRDb21tYW5kLCBVcGRhdGVDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuaW1wb3J0IHsgUzNDbGllbnQsIFB1dE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xyXG5pbXBvcnQgeyBTUVNDbGllbnQsIFNlbmRNZXNzYWdlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xyXG5pbXBvcnQgeyBFdmVudEJyaWRnZUNsaWVudCwgUHV0RXZlbnRzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZSc7XHJcblxyXG4vLyBNb2NrIEFXUyBjbGllbnRzXHJcbmNvbnN0IGR5bmFtb01vY2sgPSBtb2NrQ2xpZW50KER5bmFtb0RCQ2xpZW50KTtcclxuY29uc3QgZG9jQ2xpZW50TW9jayA9IG1vY2tDbGllbnQoRHluYW1vREJEb2N1bWVudENsaWVudCk7XHJcbmNvbnN0IHMzTW9jayA9IG1vY2tDbGllbnQoUzNDbGllbnQpO1xyXG5jb25zdCBzcXNNb2NrID0gbW9ja0NsaWVudChTUVNDbGllbnQpO1xyXG5jb25zdCBldmVudEJyaWRnZU1vY2sgPSBtb2NrQ2xpZW50KEV2ZW50QnJpZGdlQ2xpZW50KTtcclxuXHJcbi8vIE1vY2sgZmV0Y2ggZ2xvYmFsbHlcclxuZ2xvYmFsLmZldGNoID0gamVzdC5mbigpO1xyXG5cclxuLy8gTW9jayBTaGFycFxyXG5qZXN0Lm1vY2soJ3NoYXJwJywgKCkgPT4ge1xyXG4gIHJldHVybiBqZXN0LmZuKCgpID0+ICh7XHJcbiAgICByZXNpemU6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxyXG4gICAgd2VicDogamVzdC5mbigpLm1vY2tSZXR1cm5UaGlzKCksXHJcbiAgICB0b0J1ZmZlcjogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKEJ1ZmZlci5mcm9tKCdvcHRpbWl6ZWQtaW1hZ2UtZGF0YScpKSxcclxuICAgIG1ldGFkYXRhOiBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoeyB3aWR0aDogMTAyNCwgaGVpZ2h0OiAxMDI0IH0pXHJcbiAgfSkpO1xyXG59KTtcclxuXHJcbi8vIE1vY2sgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbnByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSA9ICd0ZXN0LWNvbnRlbnQnO1xyXG5wcm9jZXNzLmVudi5JTUFHRV9CVUNLRVRfTkFNRSA9ICd0ZXN0LWltYWdlcyc7XHJcbnByb2Nlc3MuZW52Lk9SQ0hFU1RSQVRPUl9RVUVVRV9VUkwgPSAnaHR0cHM6Ly9zcXMudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20vMTIzNDU2Nzg5MDEyL3Rlc3Qtb3JjaGVzdHJhdG9yJztcclxucHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUgPSAndGVzdC1ldmVudHMnO1xyXG5wcm9jZXNzLmVudi5PUEVOQUlfQVBJX0tFWSA9ICd0ZXN0LW9wZW5haS1rZXknO1xyXG5wcm9jZXNzLmVudi5BV1NfUkVHSU9OID0gJ3VzLWVhc3QtMSc7XHJcblxyXG5kZXNjcmliZSgnSW1hZ2UgR2VuZXJhdGlvbiBBZ2VudCcsICgpID0+IHtcclxuICBjb25zdCBtb2NrQ29udGV4dDogQ29udGV4dCA9IHtcclxuICAgIGNhbGxiYWNrV2FpdHNGb3JFbXB0eUV2ZW50TG9vcDogZmFsc2UsXHJcbiAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcclxuICAgIGZ1bmN0aW9uVmVyc2lvbjogJzEnLFxyXG4gICAgaW52b2tlZEZ1bmN0aW9uQXJuOiAnYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpmdW5jdGlvbjp0ZXN0LWZ1bmN0aW9uJyxcclxuICAgIG1lbW9yeUxpbWl0SW5NQjogJzEwMjQnLFxyXG4gICAgYXdzUmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJyxcclxuICAgIGxvZ0dyb3VwTmFtZTogJy9hd3MvbGFtYmRhL3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgbG9nU3RyZWFtTmFtZTogJzIwMjMvMDEvMDEvWyRMQVRFU1RddGVzdC1zdHJlYW0nLFxyXG4gICAgZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzOiAoKSA9PiAzMDAwMCxcclxuICAgIGRvbmU6ICgpID0+IHt9LFxyXG4gICAgZmFpbDogKCkgPT4ge30sXHJcbiAgICBzdWNjZWVkOiAoKSA9PiB7fSxcclxuICB9O1xyXG5cclxuICBiZWZvcmVFYWNoKCgpID0+IHtcclxuICAgIGR5bmFtb01vY2sucmVzZXQoKTtcclxuICAgIGRvY0NsaWVudE1vY2sucmVzZXQoKTtcclxuICAgIHMzTW9jay5yZXNldCgpO1xyXG4gICAgc3FzTW9jay5yZXNldCgpO1xyXG4gICAgZXZlbnRCcmlkZ2VNb2NrLnJlc2V0KCk7XHJcbiAgICAoZ2xvYmFsLmZldGNoIGFzIGplc3QuTW9jaykubW9ja0NsZWFyKCk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdTUVMgRXZlbnQgSGFuZGxpbmcnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHN1Y2Nlc3NmdWxseSBnZW5lcmF0ZSBpbWFnZSBmcm9tIFNRUyByZXF1ZXN0JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBNb2NrIE9wZW5BSSBBUEkgcmVzcG9uc2VcclxuICAgICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2spLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgb2s6IHRydWUsXHJcbiAgICAgICAganNvbjogYXN5bmMgKCkgPT4gKHtcclxuICAgICAgICAgIGRhdGE6IFt7IHVybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vZ2VuZXJhdGVkLWltYWdlLnBuZycgfV1cclxuICAgICAgICB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIGltYWdlIGRvd25sb2FkXHJcbiAgICAgIChnbG9iYWwuZmV0Y2ggYXMgamVzdC5Nb2NrKS5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIG9rOiB0cnVlLFxyXG4gICAgICAgIGFycmF5QnVmZmVyOiBhc3luYyAoKSA9PiBuZXcgQXJyYXlCdWZmZXIoMTAyNCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBTMyB1cGxvYWRzXHJcbiAgICAgIHMzTW9jay5vbihQdXRPYmplY3RDb21tYW5kKS5yZXNvbHZlcyh7fSk7XHJcblxyXG4gICAgICAvLyBNb2NrIFNRUyBzZW5kXHJcbiAgICAgIHNxc01vY2sub24oU2VuZE1lc3NhZ2VDb21tYW5kKS5yZXNvbHZlcyh7XHJcbiAgICAgICAgTWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJ1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgRXZlbnRCcmlkZ2UgcHVibGlzaFxyXG4gICAgICBldmVudEJyaWRnZU1vY2sub24oUHV0RXZlbnRzQ29tbWFuZCkucmVzb2x2ZXMoe1xyXG4gICAgICAgIEZhaWxlZEVudHJ5Q291bnQ6IDAsXHJcbiAgICAgICAgRW50cmllczogW3sgRXZlbnRJZDogJ3Rlc3QtZXZlbnQtaWQnIH1dXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgICBtZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnLFxyXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdC1oYW5kbGUnLFxyXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICBtZXNzYWdlSWQ6ICdtc2ctMTIzJyxcclxuICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgIHN0ZXBJZDogJ2ltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgICBhZ2VudFR5cGU6ICdpbWFnZS1nZW5lcmF0b3InLFxyXG4gICAgICAgICAgICBtZXNzYWdlVHlwZTogJ3JlcXVlc3QnLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnaW1hZ2UtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgY29udGVudElkOiAnY29udGVudC0xMjMnLFxyXG4gICAgICAgICAgICAgIGNvbnRlbnQ6ICdUaGlzIGlzIGEgYmxvZyBwb3N0IGFib3V0IGNsb3VkIGNvbXB1dGluZyBhbmQgQVdTIHNlcnZpY2VzLicsXHJcbiAgICAgICAgICAgICAgdXNlcklkOiAndXNlci0xMjMnLFxyXG4gICAgICAgICAgICAgIHN0eWxlOiAncHJvZmVzc2lvbmFsJ1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXHJcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJyxcclxuICAgICAgICAgICAgU2VuZGVySWQ6ICd0ZXN0LXNlbmRlcicsXHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCdcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXHJcbiAgICAgICAgICBtZDVPZkJvZHk6ICd0ZXN0LW1kNScsXHJcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxyXG4gICAgICAgICAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJ1xyXG4gICAgICAgIH1dXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBhd2FpdCBleHBlY3QoaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpKS5yZXNvbHZlcy5ub3QudG9UaHJvdygpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IE9wZW5BSSBBUEkgd2FzIGNhbGxlZFxyXG4gICAgICBleHBlY3QoZ2xvYmFsLmZldGNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcclxuICAgICAgICAnaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MS9pbWFnZXMvZ2VuZXJhdGlvbnMnLFxyXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgICAgaGVhZGVyczogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgdGVzdC1vcGVuYWkta2V5J1xyXG4gICAgICAgICAgfSlcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IFMzIHVwbG9hZHMgKG9yaWdpbmFsIGFuZCBvcHRpbWl6ZWQpXHJcbiAgICAgIGV4cGVjdChzM01vY2suY29tbWFuZENhbGxzKFB1dE9iamVjdENvbW1hbmQpKS50b0hhdmVMZW5ndGgoMik7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgcmVzcG9uc2Ugd2FzIHNlbnQgdG8gb3JjaGVzdHJhdG9yXHJcbiAgICAgIGV4cGVjdChzcXNNb2NrLmNvbW1hbmRDYWxscyhTZW5kTWVzc2FnZUNvbW1hbmQpKS50b0hhdmVMZW5ndGgoMSk7XHJcbiAgICAgIGNvbnN0IHNxc0NhbGwgPSBzcXNNb2NrLmNvbW1hbmRDYWxscyhTZW5kTWVzc2FnZUNvbW1hbmQpWzBdLmFyZ3NbMF0uaW5wdXQ7XHJcbiAgICAgIGNvbnN0IG1lc3NhZ2VCb2R5ID0gSlNPTi5wYXJzZShzcXNDYWxsLk1lc3NhZ2VCb2R5ISk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlQm9keS5tZXNzYWdlVHlwZSkudG9CZSgncmVzcG9uc2UnKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5LnBheWxvYWQuc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5LnBheWxvYWQuaW1hZ2VVcmwpLnRvQmVEZWZpbmVkKCk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgZXZlbnQgd2FzIHB1Ymxpc2hlZFxyXG4gICAgICBleHBlY3QoZXZlbnRCcmlkZ2VNb2NrLmNvbW1hbmRDYWxscyhQdXRFdmVudHNDb21tYW5kKSkudG9IYXZlTGVuZ3RoKDEpO1xyXG4gICAgICBjb25zdCBldmVudENhbGwgPSBldmVudEJyaWRnZU1vY2suY29tbWFuZENhbGxzKFB1dEV2ZW50c0NvbW1hbmQpWzBdLmFyZ3NbMF0uaW5wdXQ7XHJcbiAgICAgIGV4cGVjdChldmVudENhbGwuRW50cmllcyFbMF0uU291cmNlKS50b0JlKCdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW1hZ2UtYWdlbnQnKTtcclxuICAgICAgZXhwZWN0KGV2ZW50Q2FsbC5FbnRyaWVzIVswXS5EZXRhaWxUeXBlKS50b0JlKCdJbWFnZSBHZW5lcmF0aW9uIENvbXBsZXRlZCcpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW1hZ2UgcmV2aXNpb24gcmVxdWVzdHMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIE1vY2sgT3BlbkFJIEFQSSByZXNwb25zZVxyXG4gICAgICAoZ2xvYmFsLmZldGNoIGFzIGplc3QuTW9jaykubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcclxuICAgICAgICBvazogdHJ1ZSxcclxuICAgICAgICBqc29uOiBhc3luYyAoKSA9PiAoe1xyXG4gICAgICAgICAgZGF0YTogW3sgdXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9yZXZpc2VkLWltYWdlLnBuZycgfV1cclxuICAgICAgICB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIGltYWdlIGRvd25sb2FkXHJcbiAgICAgIChnbG9iYWwuZmV0Y2ggYXMgamVzdC5Nb2NrKS5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIG9rOiB0cnVlLFxyXG4gICAgICAgIGFycmF5QnVmZmVyOiBhc3luYyAoKSA9PiBuZXcgQXJyYXlCdWZmZXIoMTAyNCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBTMyB1cGxvYWRzXHJcbiAgICAgIHMzTW9jay5vbihQdXRPYmplY3RDb21tYW5kKS5yZXNvbHZlcyh7fSk7XHJcblxyXG4gICAgICAvLyBNb2NrIFNRUyBzZW5kXHJcbiAgICAgIHNxc01vY2sub24oU2VuZE1lc3NhZ2VDb21tYW5kKS5yZXNvbHZlcyh7XHJcbiAgICAgICAgTWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJ1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBTUVNFdmVudCA9IHtcclxuICAgICAgICBSZWNvcmRzOiBbe1xyXG4gICAgICAgICAgbWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJyxcclxuICAgICAgICAgIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQtaGFuZGxlJyxcclxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgbWVzc2FnZVR5cGU6ICdyZXZpc2lvbicsXHJcbiAgICAgICAgICAgIHBheWxvYWQ6IHtcclxuICAgICAgICAgICAgICB3b3JrZmxvd0lkOiAnd29ya2Zsb3ctMTIzJyxcclxuICAgICAgICAgICAgICBzdGVwSWQ6ICdpbWFnZS1yZXZpc2lvbicsXHJcbiAgICAgICAgICAgICAgY29udGVudElkOiAnY29udGVudC0xMjMnLFxyXG4gICAgICAgICAgICAgIGN1cnJlbnRJbWFnZVVybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vY3VycmVudC1pbWFnZS5wbmcnLFxyXG4gICAgICAgICAgICAgIGZlZWRiYWNrOiAnTWFrZSBpdCBtb3JlIGNvbG9yZnVsIGFuZCB2aWJyYW50JyxcclxuICAgICAgICAgICAgICB1c2VySWQ6ICd1c2VyLTEyMydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXHJcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJyxcclxuICAgICAgICAgICAgU2VuZGVySWQ6ICd0ZXN0LXNlbmRlcicsXHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCdcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXHJcbiAgICAgICAgICBtZDVPZkJvZHk6ICd0ZXN0LW1kNScsXHJcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxyXG4gICAgICAgICAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJ1xyXG4gICAgICAgIH1dXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBhd2FpdCBleHBlY3QoaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpKS5yZXNvbHZlcy5ub3QudG9UaHJvdygpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IHJlc3BvbnNlIHdhcyBzZW50XHJcbiAgICAgIGV4cGVjdChzcXNNb2NrLmNvbW1hbmRDYWxscyhTZW5kTWVzc2FnZUNvbW1hbmQpKS50b0hhdmVMZW5ndGgoMSk7XHJcbiAgICAgIGNvbnN0IG1lc3NhZ2VCb2R5ID0gSlNPTi5wYXJzZShzcXNNb2NrLmNvbW1hbmRDYWxscyhTZW5kTWVzc2FnZUNvbW1hbmQpWzBdLmFyZ3NbMF0uaW5wdXQuTWVzc2FnZUJvZHkhKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5LnBheWxvYWQuc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5LnBheWxvYWQuZmVlZGJhY2spLnRvQmUoJ01ha2UgaXQgbW9yZSBjb2xvcmZ1bCBhbmQgdmlicmFudCcpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgT3BlbkFJIEFQSSBlcnJvcnMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gTW9jayBPcGVuQUkgQVBJIGVycm9yXHJcbiAgICAgIChnbG9iYWwuZmV0Y2ggYXMgamVzdC5Nb2NrKS5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICBqc29uOiBhc3luYyAoKSA9PiAoe1xyXG4gICAgICAgICAgZXJyb3I6IHsgbWVzc2FnZTogJ1JhdGUgbGltaXQgZXhjZWVkZWQnIH1cclxuICAgICAgICB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIFNRUyBzZW5kXHJcbiAgICAgIHNxc01vY2sub24oU2VuZE1lc3NhZ2VDb21tYW5kKS5yZXNvbHZlcyh7XHJcbiAgICAgICAgTWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJ1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgRXZlbnRCcmlkZ2UgcHVibGlzaFxyXG4gICAgICBldmVudEJyaWRnZU1vY2sub24oUHV0RXZlbnRzQ29tbWFuZCkucmVzb2x2ZXMoe1xyXG4gICAgICAgIEZhaWxlZEVudHJ5Q291bnQ6IDAsXHJcbiAgICAgICAgRW50cmllczogW3sgRXZlbnRJZDogJ3Rlc3QtZXZlbnQtaWQnIH1dXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgICBtZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnLFxyXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdC1oYW5kbGUnLFxyXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICBtZXNzYWdlVHlwZTogJ3JlcXVlc3QnLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnaW1hZ2UtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgY29udGVudElkOiAnY29udGVudC0xMjMnLFxyXG4gICAgICAgICAgICAgIGNvbnRlbnQ6ICdUZXN0IGNvbnRlbnQnLFxyXG4gICAgICAgICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcclxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnLFxyXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXHJcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCkpLnJlc29sdmVzLm5vdC50b1Rocm93KCk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgZXJyb3IgcmVzcG9uc2Ugd2FzIHNlbnRcclxuICAgICAgZXhwZWN0KHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgxKTtcclxuICAgICAgY29uc3QgbWVzc2FnZUJvZHkgPSBKU09OLnBhcnNlKHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZClbMF0uYXJnc1swXS5pbnB1dC5NZXNzYWdlQm9keSEpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkubWVzc2FnZVR5cGUpLnRvQmUoJ2Vycm9yJyk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlQm9keS5wYXlsb2FkLnN1Y2Nlc3MpLnRvQmUoZmFsc2UpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5lcnJvcikudG9Db250YWluKCdSYXRlIGxpbWl0IGV4Y2VlZGVkJyk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgZmFpbHVyZSBldmVudCB3YXMgcHVibGlzaGVkXHJcbiAgICAgIGV4cGVjdChldmVudEJyaWRnZU1vY2suY29tbWFuZENhbGxzKFB1dEV2ZW50c0NvbW1hbmQpKS50b0hhdmVMZW5ndGgoMSk7XHJcbiAgICAgIGNvbnN0IGV2ZW50Q2FsbCA9IGV2ZW50QnJpZGdlTW9jay5jb21tYW5kQ2FsbHMoUHV0RXZlbnRzQ29tbWFuZClbMF0uYXJnc1swXS5pbnB1dDtcclxuICAgICAgZXhwZWN0KGV2ZW50Q2FsbC5FbnRyaWVzIVswXS5EZXRhaWxUeXBlKS50b0JlKCdJbWFnZSBHZW5lcmF0aW9uIEZhaWxlZCcpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdBUEkgR2F0ZXdheSBFdmVudCBIYW5kbGluZycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGRpcmVjdCBpbWFnZSBnZW5lcmF0aW9uIEFQSSBjYWxsJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBNb2NrIE9wZW5BSSBBUEkgcmVzcG9uc2VcclxuICAgICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2spLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgb2s6IHRydWUsXHJcbiAgICAgICAganNvbjogYXN5bmMgKCkgPT4gKHtcclxuICAgICAgICAgIGRhdGE6IFt7IHVybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vZ2VuZXJhdGVkLWltYWdlLnBuZycgfV1cclxuICAgICAgICB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIGltYWdlIGRvd25sb2FkXHJcbiAgICAgIChnbG9iYWwuZmV0Y2ggYXMgamVzdC5Nb2NrKS5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIG9rOiB0cnVlLFxyXG4gICAgICAgIGFycmF5QnVmZmVyOiBhc3luYyAoKSA9PiBuZXcgQXJyYXlCdWZmZXIoMTAyNCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBTMyB1cGxvYWRzXHJcbiAgICAgIHMzTW9jay5vbihQdXRPYmplY3RDb21tYW5kKS5yZXNvbHZlcyh7fSk7XHJcblxyXG4gICAgICAvLyBNb2NrIER5bmFtb0RCIHVwZGF0ZVxyXG4gICAgICBkb2NDbGllbnRNb2NrLm9uKFVwZGF0ZUNvbW1hbmQpLnJlc29sdmVzKHt9KTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW1hZ2UvZ2VuZXJhdGUnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICAnb3JpZ2luJzogJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJ1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgY29udGVudElkOiAnY29udGVudC0xMjMnLFxyXG4gICAgICAgICAgcHJvbXB0OiAnUHJvZmVzc2lvbmFsIGlsbHVzdHJhdGlvbiBvZiBjbG91ZCBjb21wdXRpbmcnLFxyXG4gICAgICAgICAgc3R5bGU6ICdwcm9mZXNzaW9uYWwnXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcclxuICAgICAgICAgIGFjY291bnRJZDogJzEyMzQ1Njc4OTAxMicsXHJcbiAgICAgICAgICBhcGlJZDogJ3Rlc3QtYXBpJyxcclxuICAgICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICAgIHBhdGg6ICcvYXBpL2ltYWdlL2dlbmVyYXRlJyxcclxuICAgICAgICAgIHN0YWdlOiAncHJvZCcsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgICAgICAgcmVxdWVzdFRpbWU6ICcyMDIzLTAxLTAxVDAwOjAwOjAwWicsXHJcbiAgICAgICAgICByZXF1ZXN0VGltZUVwb2NoOiAxNjcyNTMxMjAwMDAwLFxyXG4gICAgICAgICAgaWRlbnRpdHk6IHtcclxuICAgICAgICAgICAgY29nbml0b0lkZW50aXR5UG9vbElkOiBudWxsLFxyXG4gICAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXHJcbiAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxyXG4gICAgICAgICAgICBjYWxsZXI6IG51bGwsXHJcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTI3LjAuMC4xJyxcclxuICAgICAgICAgICAgcHJpbmNpcGFsT3JnSWQ6IG51bGwsXHJcbiAgICAgICAgICAgIGFjY2Vzc0tleTogbnVsbCxcclxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZTogbnVsbCxcclxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uUHJvdmlkZXI6IG51bGwsXHJcbiAgICAgICAgICAgIHVzZXJBcm46IG51bGwsXHJcbiAgICAgICAgICAgIHVzZXJBZ2VudDogJ3Rlc3QtYWdlbnQnLFxyXG4gICAgICAgICAgICB1c2VyOiBudWxsLFxyXG4gICAgICAgICAgICBhcGlLZXk6IG51bGwsXHJcbiAgICAgICAgICAgIGFwaUtleUlkOiBudWxsLFxyXG4gICAgICAgICAgICBjbGllbnRDZXJ0OiBudWxsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgcHJvdG9jb2w6ICdIVFRQLzEuMScsXHJcbiAgICAgICAgICByZXNvdXJjZUlkOiAndGVzdC1yZXNvdXJjZScsXHJcbiAgICAgICAgICByZXNvdXJjZVBhdGg6ICcvYXBpL2ltYWdlL2dlbmVyYXRlJyxcclxuICAgICAgICAgIGF1dGhvcml6ZXI6IG51bGxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHJlc291cmNlOiAnL2FwaS9pbWFnZS9nZW5lcmF0ZScsXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge31cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvQmVEZWZpbmVkKCk7XHJcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZSgocmVzdWx0IGFzIGFueSkuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5pbWFnZVVybCkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5tZXRhZGF0YSkudG9CZURlZmluZWQoKTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSBTMyB1cGxvYWRzIG9jY3VycmVkXHJcbiAgICAgIGV4cGVjdChzM01vY2suY29tbWFuZENhbGxzKFB1dE9iamVjdENvbW1hbmQpKS50b0hhdmVMZW5ndGgoMik7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgY29udGVudCB3YXMgdXBkYXRlZFxyXG4gICAgICBleHBlY3QoZG9jQ2xpZW50TW9jay5jb21tYW5kQ2FsbHMoVXBkYXRlQ29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgxKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbnRlbnQgYW5hbHlzaXMgQVBJIGNhbGwnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW1hZ2UvYW5hbHl6ZScsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAgICdvcmlnaW4nOiAnaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nXHJcbiAgICAgICAgfSxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBjb250ZW50OiAnVGhpcyBibG9nIHBvc3QgZGlzY3Vzc2VzIGNsb3VkIGNvbXB1dGluZywgQVdTIHNlcnZpY2VzLCBhbmQgc2VydmVybGVzcyBhcmNoaXRlY3R1cmUuIEl0IGNvdmVycyBtb2Rlcm4gaW5mcmFzdHJ1Y3R1cmUgcGF0dGVybnMgYW5kIGNvc3Qgb3B0aW1pemF0aW9uIHN0cmF0ZWdpZXMuJ1xyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XHJcbiAgICAgICAgICBhY2NvdW50SWQ6ICcxMjM0NTY3ODkwMTInLFxyXG4gICAgICAgICAgYXBpSWQ6ICd0ZXN0LWFwaScsXHJcbiAgICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgICBwYXRoOiAnL2FwaS9pbWFnZS9hbmFseXplJyxcclxuICAgICAgICAgIHN0YWdlOiAncHJvZCcsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgICAgICAgcmVxdWVzdFRpbWU6ICcyMDIzLTAxLTAxVDAwOjAwOjAwWicsXHJcbiAgICAgICAgICByZXF1ZXN0VGltZUVwb2NoOiAxNjcyNTMxMjAwMDAwLFxyXG4gICAgICAgICAgaWRlbnRpdHk6IHtcclxuICAgICAgICAgICAgY29nbml0b0lkZW50aXR5UG9vbElkOiBudWxsLFxyXG4gICAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXHJcbiAgICAgICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxyXG4gICAgICAgICAgICBjYWxsZXI6IG51bGwsXHJcbiAgICAgICAgICAgIHNvdXJjZUlwOiAnMTI3LjAuMC4xJyxcclxuICAgICAgICAgICAgcHJpbmNpcGFsT3JnSWQ6IG51bGwsXHJcbiAgICAgICAgICAgIGFjY2Vzc0tleTogbnVsbCxcclxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZTogbnVsbCxcclxuICAgICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uUHJvdmlkZXI6IG51bGwsXHJcbiAgICAgICAgICAgIHVzZXJBcm46IG51bGwsXHJcbiAgICAgICAgICAgIHVzZXJBZ2VudDogJ3Rlc3QtYWdlbnQnLFxyXG4gICAgICAgICAgICB1c2VyOiBudWxsLFxyXG4gICAgICAgICAgICBhcGlLZXk6IG51bGwsXHJcbiAgICAgICAgICAgIGFwaUtleUlkOiBudWxsLFxyXG4gICAgICAgICAgICBjbGllbnRDZXJ0OiBudWxsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgcHJvdG9jb2w6ICdIVFRQLzEuMScsXHJcbiAgICAgICAgICByZXNvdXJjZUlkOiAndGVzdC1yZXNvdXJjZScsXHJcbiAgICAgICAgICByZXNvdXJjZVBhdGg6ICcvYXBpL2ltYWdlL2FuYWx5emUnLFxyXG4gICAgICAgICAgYXV0aG9yaXplcjogbnVsbFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcmVzb3VyY2U6ICcvYXBpL2ltYWdlL2FuYWx5emUnLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0KS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QoKHJlc3VsdCBhcyBhbnkpLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UoKHJlc3VsdCBhcyBhbnkpLmJvZHkpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LnByb21wdCkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5zdHlsZSkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5jb25jZXB0cykudG9Db250YWluKCdjbG91ZCcpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmNvbmNlcHRzKS50b0NvbnRhaW4oJ2F3cycpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmNvbmNlcHRzKS50b0NvbnRhaW4oJ3NlcnZlcmxlc3MnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIENPUlMgcHJlZmxpZ2h0IHJlcXVlc3RzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ09QVElPTlMnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2ltYWdlL2dlbmVyYXRlJyxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnb3JpZ2luJzogJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJ1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYm9keTogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xyXG4gICAgICAgICAgYWNjb3VudElkOiAnMTIzNDU2Nzg5MDEyJyxcclxuICAgICAgICAgIGFwaUlkOiAndGVzdC1hcGknLFxyXG4gICAgICAgICAgaHR0cE1ldGhvZDogJ09QVElPTlMnLFxyXG4gICAgICAgICAgcGF0aDogJy9hcGkvaW1hZ2UvZ2VuZXJhdGUnLFxyXG4gICAgICAgICAgc3RhZ2U6ICdwcm9kJyxcclxuICAgICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICAgICAgICByZXF1ZXN0VGltZTogJzIwMjMtMDEtMDFUMDA6MDA6MDBaJyxcclxuICAgICAgICAgIHJlcXVlc3RUaW1lRXBvY2g6IDE2NzI1MzEyMDAwMDAsXHJcbiAgICAgICAgICBpZGVudGl0eToge1xyXG4gICAgICAgICAgICBjb2duaXRvSWRlbnRpdHlQb29sSWQ6IG51bGwsXHJcbiAgICAgICAgICAgIGFjY291bnRJZDogbnVsbCxcclxuICAgICAgICAgICAgY29nbml0b0lkZW50aXR5SWQ6IG51bGwsXHJcbiAgICAgICAgICAgIGNhbGxlcjogbnVsbCxcclxuICAgICAgICAgICAgc291cmNlSXA6ICcxMjcuMC4wLjEnLFxyXG4gICAgICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcclxuICAgICAgICAgICAgYWNjZXNzS2V5OiBudWxsLFxyXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25UeXBlOiBudWxsLFxyXG4gICAgICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcclxuICAgICAgICAgICAgdXNlckFybjogbnVsbCxcclxuICAgICAgICAgICAgdXNlckFnZW50OiAndGVzdC1hZ2VudCcsXHJcbiAgICAgICAgICAgIHVzZXI6IG51bGwsXHJcbiAgICAgICAgICAgIGFwaUtleTogbnVsbCxcclxuICAgICAgICAgICAgYXBpS2V5SWQ6IG51bGwsXHJcbiAgICAgICAgICAgIGNsaWVudENlcnQ6IG51bGxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBwcm90b2NvbDogJ0hUVFAvMS4xJyxcclxuICAgICAgICAgIHJlc291cmNlSWQ6ICd0ZXN0LXJlc291cmNlJyxcclxuICAgICAgICAgIHJlc291cmNlUGF0aDogJy9hcGkvaW1hZ2UvZ2VuZXJhdGUnLFxyXG4gICAgICAgICAgYXV0aG9yaXplcjogbnVsbFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcmVzb3VyY2U6ICcvYXBpL2ltYWdlL2dlbmVyYXRlJyxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuaGVhZGVyc1snQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJ10pLnRvQmUoJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJyk7XHJcbiAgICAgIGV4cGVjdCgocmVzdWx0IGFzIGFueSkuaGVhZGVyc1snQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyddKS50b0NvbnRhaW4oJ1BPU1QnKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnQ29udGVudCBBbmFseXNpcycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgZXh0cmFjdCByZWxldmFudCBjb25jZXB0cyBmcm9tIHRlY2huaWNhbCBjb250ZW50JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBjb250ZW50ID0gJ1RoaXMgYXJ0aWNsZSBleHBsb3JlcyBBV1MgTGFtYmRhLCBLdWJlcm5ldGVzIG9yY2hlc3RyYXRpb24sIGFuZCBzZXJ2ZXJsZXNzIGFyY2hpdGVjdHVyZSBwYXR0ZXJucyBmb3IgbW9kZXJuIGNsb3VkIGluZnJhc3RydWN0dXJlLic7XHJcbiAgICAgIFxyXG4gICAgICAvLyBXZSBuZWVkIHRvIHRlc3QgdGhlIGludGVybmFsIGZ1bmN0aW9uLCBidXQgc2luY2UgaXQncyBub3QgZXhwb3J0ZWQsIHdlJ2xsIHRlc3QgdGhyb3VnaCB0aGUgQVBJXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW1hZ2UvYW5hbHl6ZScsXHJcbiAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBjb250ZW50IH0pLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcvYXBpL2ltYWdlL2FuYWx5emUnLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UoKHJlc3VsdCBhcyBhbnkpLmJvZHkpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5jb25jZXB0cykudG9Db250YWluKCdhd3MnKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5jb25jZXB0cykudG9Db250YWluKCdrdWJlcm5ldGVzJyk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuY29uY2VwdHMpLnRvQ29udGFpbignc2VydmVybGVzcycpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LnRvbmUpLnRvQmUoJ3RlY2huaWNhbCcpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LnByb21wdCkudG9Db250YWluKCd0ZWNobmljYWwgZGlhZ3JhbScpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYnVzaW5lc3MtZm9jdXNlZCBjb250ZW50JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBjb250ZW50ID0gJ1RoaXMgYnVzaW5lc3Mgc3RyYXRlZ3kgYXJ0aWNsZSBkaXNjdXNzZXMgZW50ZXJwcmlzZSB0cmFuc2Zvcm1hdGlvbiwgY29zdCBvcHRpbWl6YXRpb24sIGFuZCBvcmdhbml6YXRpb25hbCBjaGFuZ2UgbWFuYWdlbWVudC4nO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbWFnZS9hbmFseXplJyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGNvbnRlbnQgfSksXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJy9hcGkvaW1hZ2UvYW5hbHl6ZScsXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge31cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZSgocmVzdWx0IGFzIGFueSkuYm9keSk7XHJcblxyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmNvbmNlcHRzKS50b0NvbnRhaW4oJ2VudGVycHJpc2UnKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS50b25lKS50b0JlKCdwcm9mZXNzaW9uYWwnKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5zdHlsZSkudG9CZSgncHJvZmVzc2lvbmFsJyk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkucHJvbXB0KS50b0NvbnRhaW4oJ3Byb2Zlc3Npb25hbCBpbGx1c3RyYXRpb24nKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnRXJyb3IgSGFuZGxpbmcnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtYWxmb3JtZWQgU1FTIG1lc3NhZ2VzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogU1FTRXZlbnQgPSB7XHJcbiAgICAgICAgUmVjb3JkczogW3tcclxuICAgICAgICAgIG1lc3NhZ2VJZDogJ3Rlc3QtbWVzc2FnZS1pZCcsXHJcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAndGVzdC1yZWNlaXB0LWhhbmRsZScsXHJcbiAgICAgICAgICBib2R5OiAnaW52YWxpZC1qc29uJyxcclxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcclxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnLFxyXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXHJcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCkpLnJlamVjdHMudG9UaHJvdygpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyBBUEkgcmVxdWVzdCBib2R5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2ltYWdlL2dlbmVyYXRlJyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBib2R5OiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcvYXBpL2ltYWdlL2dlbmVyYXRlJyxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KChyZXN1bHQgYXMgYW55KS5zdGF0dXNDb2RlKS50b0JlKDQwMCk7XHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UoKHJlc3VsdCBhcyBhbnkpLmJvZHkpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmVycm9yKS50b0JlKCdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHVua25vd24gbWVzc2FnZSB0eXBlcyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogU1FTRXZlbnQgPSB7XHJcbiAgICAgICAgUmVjb3JkczogW3tcclxuICAgICAgICAgIG1lc3NhZ2VJZDogJ3Rlc3QtbWVzc2FnZS1pZCcsXHJcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAndGVzdC1yZWNlaXB0LWhhbmRsZScsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VUeXBlOiAndW5rbm93bi10eXBlJyxcclxuICAgICAgICAgICAgcGF5bG9hZDoge31cclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgYXR0cmlidXRlczoge1xyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxyXG4gICAgICAgICAgICBTZW50VGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCcsXHJcbiAgICAgICAgICAgIFNlbmRlcklkOiAndGVzdC1zZW5kZXInLFxyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxyXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAndGVzdC1tZDUnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcclxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcclxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcclxuICAgICAgICB9XVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gU2hvdWxkIG5vdCB0aHJvdyBidXQgc2hvdWxkIGxvZyB3YXJuaW5nXHJcbiAgICAgIGF3YWl0IGV4cGVjdChoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCkpLnJlc29sdmVzLm5vdC50b1Rocm93KCk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19