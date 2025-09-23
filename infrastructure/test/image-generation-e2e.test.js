"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const image_generation_agent_1 = require("../lambda/image-generation-agent");
const content_orchestrator_1 = require("../lambda/content-orchestrator");
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
process.env.IMAGE_GENERATION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-image-generation';
process.env.EVENT_BUS_NAME = 'test-events';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.AWS_REGION = 'us-east-1';
describe('Image Generation End-to-End Tests', () => {
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
    describe('Complete Image Generation Workflow', () => {
        it('should complete full workflow from content generation to image creation', async () => {
            // Step 1: Mock content exists in DynamoDB
            const testContent = {
                id: 'content-123',
                userId: 'user-123',
                title: 'The Future of Cloud Computing',
                content: 'This comprehensive guide explores AWS services, serverless architecture, Kubernetes orchestration, and modern DevOps practices for enterprise transformation.',
                status: 'content_generated',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            docClientMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: testContent
            });
            // Step 2: Mock successful image generation
            global.fetch
                .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://oaidalleapiprodscus.blob.core.windows.net/private/generated-image.png' }]
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(2048000), // 2MB image
            });
            // Step 3: Mock S3 uploads
            s3Mock.on(client_s3_1.PutObjectCommand).resolves({});
            // Step 4: Mock DynamoDB updates
            docClientMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            // Step 5: Mock SQS and EventBridge
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({ MessageId: 'test-message-id' });
            eventBridgeMock.on(client_eventbridge_1.PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });
            // Step 6: Simulate orchestrator triggering image generation
            const orchestratorEvent = {
                Records: [{
                        messageId: 'orchestrator-message',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageId: 'msg-123',
                            workflowId: 'workflow-123',
                            stepId: 'content-generation-completed',
                            agentType: 'orchestrator',
                            messageType: 'content-ready',
                            payload: {
                                contentId: testContent.id,
                                userId: testContent.userId,
                                nextStep: 'image-generation'
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
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-orchestrator-queue',
                        awsRegion: 'us-east-1'
                    }]
            };
            // Process orchestrator event (would trigger image generation)
            await expect((0, content_orchestrator_1.handler)(orchestratorEvent, mockContext)).resolves.not.toThrow();
            // Step 7: Simulate image generation agent processing
            const imageGenerationEvent = {
                Records: [{
                        messageId: 'image-gen-message',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageId: 'img-msg-123',
                            workflowId: 'workflow-123',
                            stepId: 'image-generation',
                            agentType: 'image-generator',
                            messageType: 'request',
                            payload: {
                                workflowId: 'workflow-123',
                                stepId: 'image-generation',
                                contentId: testContent.id,
                                content: testContent.content,
                                userId: testContent.userId,
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
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-image-generation-queue',
                        awsRegion: 'us-east-1'
                    }]
            };
            // Process image generation event
            await expect((0, image_generation_agent_1.handler)(imageGenerationEvent, mockContext)).resolves.not.toThrow();
            // Verify the complete workflow
            // 1. Content was retrieved from DynamoDB
            expect(docClientMock.commandCalls(lib_dynamodb_1.GetCommand)).toHaveLength(1);
            // 2. OpenAI API was called for image generation
            expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-openai-key'
                })
            }));
            // 3. Image was downloaded
            expect(global.fetch).toHaveBeenCalledTimes(2);
            // 4. Both original and optimized images were stored in S3
            expect(s3Mock.commandCalls(client_s3_1.PutObjectCommand)).toHaveLength(2);
            const s3Calls = s3Mock.commandCalls(client_s3_1.PutObjectCommand);
            const originalUpload = s3Calls.find(call => call.args[0].input.Key?.includes('original'));
            const optimizedUpload = s3Calls.find(call => call.args[0].input.Key?.includes('optimized'));
            expect(originalUpload).toBeDefined();
            expect(optimizedUpload).toBeDefined();
            expect(originalUpload?.args[0].input.ContentType).toBe('image/png');
            expect(optimizedUpload?.args[0].input.ContentType).toBe('image/webp');
            // 5. Content was updated with image URL
            expect(docClientMock.commandCalls(lib_dynamodb_1.UpdateCommand)).toHaveLength(1);
            const updateCall = docClientMock.commandCalls(lib_dynamodb_1.UpdateCommand)[0];
            expect(updateCall.args[0].input.UpdateExpression).toContain('#imageUrl');
            // 6. Success response was sent to orchestrator
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            const sqsCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0];
            const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody);
            expect(messageBody.messageType).toBe('response');
            expect(messageBody.payload.success).toBe(true);
            expect(messageBody.payload.imageUrl).toBeDefined();
            expect(messageBody.payload.metadata).toBeDefined();
            // 7. Success event was published
            expect(eventBridgeMock.commandCalls(client_eventbridge_1.PutEventsCommand)).toHaveLength(1);
            const eventCall = eventBridgeMock.commandCalls(client_eventbridge_1.PutEventsCommand)[0];
            expect(eventCall.args[0].input.Entries[0].Source).toBe('automated-blog-poster.image-agent');
            expect(eventCall.args[0].input.Entries[0].DetailType).toBe('Image Generation Completed');
        }, 30000);
        it('should handle image revision workflow end-to-end', async () => {
            // Mock existing content with image
            const existingContent = {
                id: 'content-456',
                userId: 'user-123',
                title: 'DevOps Best Practices',
                content: 'This article covers continuous integration, deployment automation, and monitoring strategies.',
                status: 'image_generated',
                imageUrl: 'https://test-bucket.s3.amazonaws.com/images/content-456/optimized-123.webp',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            docClientMock.on(lib_dynamodb_1.GetCommand).resolves({
                Item: existingContent
            });
            // Mock revised image generation
            global.fetch
                .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://oaidalleapiprodscus.blob.core.windows.net/private/revised-image.png' }]
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(1536000), // 1.5MB revised image
            });
            s3Mock.on(client_s3_1.PutObjectCommand).resolves({});
            docClientMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({ MessageId: 'test-message-id' });
            // Simulate image revision request
            const revisionEvent = {
                Records: [{
                        messageId: 'revision-message',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageId: 'rev-msg-123',
                            workflowId: 'workflow-456',
                            stepId: 'image-revision',
                            agentType: 'image-generator',
                            messageType: 'revision',
                            payload: {
                                workflowId: 'workflow-456',
                                stepId: 'image-revision',
                                contentId: existingContent.id,
                                currentImageUrl: existingContent.imageUrl,
                                feedback: 'Make it more colorful and add automation symbols',
                                userId: existingContent.userId
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
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-image-generation-queue',
                        awsRegion: 'us-east-1'
                    }]
            };
            await expect((0, image_generation_agent_1.handler)(revisionEvent, mockContext)).resolves.not.toThrow();
            // Verify revision workflow
            expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', expect.objectContaining({
                body: expect.stringContaining('more colorful and vibrant')
            }));
            expect(s3Mock.commandCalls(client_s3_1.PutObjectCommand)).toHaveLength(2);
            expect(docClientMock.commandCalls(lib_dynamodb_1.UpdateCommand)).toHaveLength(1);
            const sqsCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0];
            const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody);
            expect(messageBody.payload.feedback).toBe('Make it more colorful and add automation symbols');
        });
        it('should handle content analysis workflow', async () => {
            const technicalContent = `
        This comprehensive guide explores AWS Lambda functions, Kubernetes orchestration, 
        serverless architecture patterns, and infrastructure as code. We'll cover monitoring 
        strategies, cost optimization techniques, and DevOps best practices for enterprise 
        cloud deployments.
      `;
            // Test content analysis through the image generation workflow
            const analysisEvent = {
                Records: [{
                        messageId: 'analysis-message',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageType: 'request',
                            payload: {
                                workflowId: 'workflow-789',
                                stepId: 'image-generation',
                                contentId: 'content-789',
                                content: technicalContent,
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
            // Mock successful image generation
            global.fetch
                .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://example.com/technical-image.png' }]
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(1024000),
            });
            s3Mock.on(client_s3_1.PutObjectCommand).resolves({});
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({ MessageId: 'test-message-id' });
            eventBridgeMock.on(client_eventbridge_1.PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });
            await expect((0, image_generation_agent_1.handler)(analysisEvent, mockContext)).resolves.not.toThrow();
            // Verify that the generated prompt includes technical concepts
            expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', expect.objectContaining({
                body: expect.stringMatching(/aws|kubernetes|serverless|infrastructure|devops/i)
            }));
            const sqsCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0];
            const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody);
            expect(messageBody.payload.analysis).toBeDefined();
            expect(messageBody.payload.analysis.concepts).toEqual(expect.arrayContaining(['aws', 'kubernetes', 'serverless', 'infrastructure', 'devops']));
        });
    });
    describe('Error Handling End-to-End', () => {
        it('should handle complete workflow failure gracefully', async () => {
            // Mock OpenAI API failure
            global.fetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({
                    error: { message: 'Rate limit exceeded' }
                }),
            });
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({ MessageId: 'test-message-id' });
            eventBridgeMock.on(client_eventbridge_1.PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });
            const failureEvent = {
                Records: [{
                        messageId: 'failure-message',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageType: 'request',
                            payload: {
                                workflowId: 'workflow-fail',
                                stepId: 'image-generation',
                                contentId: 'content-fail',
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
            await expect((0, image_generation_agent_1.handler)(failureEvent, mockContext)).resolves.not.toThrow();
            // Verify error handling
            const sqsCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0];
            const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody);
            expect(messageBody.messageType).toBe('error');
            expect(messageBody.payload.success).toBe(false);
            expect(messageBody.payload.error).toContain('Rate limit exceeded');
            expect(messageBody.payload.retryable).toBe(true);
            // Verify failure event was published
            const eventCall = eventBridgeMock.commandCalls(client_eventbridge_1.PutEventsCommand)[0];
            expect(eventCall.args[0].input.Entries[0].DetailType).toBe('Image Generation Failed');
        });
        it('should handle S3 storage failure in workflow', async () => {
            // Mock successful image generation but S3 failure
            global.fetch
                .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://example.com/image.png' }]
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(1024000),
            });
            // Mock S3 failure
            s3Mock.on(client_s3_1.PutObjectCommand).rejects(new Error('Access denied'));
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({ MessageId: 'test-message-id' });
            eventBridgeMock.on(client_eventbridge_1.PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });
            const s3FailureEvent = {
                Records: [{
                        messageId: 's3-failure-message',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageType: 'request',
                            payload: {
                                workflowId: 'workflow-s3-fail',
                                stepId: 'image-generation',
                                contentId: 'content-s3-fail',
                                content: 'Test content for S3 failure',
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
            await expect((0, image_generation_agent_1.handler)(s3FailureEvent, mockContext)).resolves.not.toThrow();
            // Verify error was handled and reported
            const sqsCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0];
            const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody);
            expect(messageBody.messageType).toBe('error');
            expect(messageBody.payload.error).toContain('Access denied');
        });
    });
    describe('Performance End-to-End', () => {
        it('should complete workflow within performance thresholds', async () => {
            const startTime = Date.now();
            // Mock fast responses
            global.fetch
                .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ url: 'https://example.com/fast-image.png' }]
                }),
            })
                .mockResolvedValueOnce({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(512000), // Smaller image for faster processing
            });
            s3Mock.on(client_s3_1.PutObjectCommand).resolves({});
            docClientMock.on(lib_dynamodb_1.UpdateCommand).resolves({});
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({ MessageId: 'test-message-id' });
            eventBridgeMock.on(client_eventbridge_1.PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });
            const performanceEvent = {
                Records: [{
                        messageId: 'performance-message',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageType: 'request',
                            payload: {
                                workflowId: 'workflow-perf',
                                stepId: 'image-generation',
                                contentId: 'content-perf',
                                content: 'Short content for performance test',
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
            await (0, image_generation_agent_1.handler)(performanceEvent, mockContext);
            const endTime = Date.now();
            const processingTime = endTime - startTime;
            // Should complete within reasonable time (allowing for mocks)
            expect(processingTime).toBeLessThan(5000); // 5 seconds for mocked operations
            // Verify successful completion
            const sqsCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0];
            const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody);
            expect(messageBody.payload.success).toBe(true);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2UtZ2VuZXJhdGlvbi1lMmUudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImltYWdlLWdlbmVyYXRpb24tZTJlLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSw2RUFBcUY7QUFDckYseUVBQXVGO0FBRXZGLDZEQUFpRDtBQUNqRCw4REFBMEQ7QUFDMUQsd0RBQXNHO0FBQ3RHLGtEQUFnRTtBQUNoRSxvREFBb0U7QUFDcEUsb0VBQWtGO0FBRWxGLG1CQUFtQjtBQUNuQixNQUFNLFVBQVUsR0FBRyxJQUFBLGdDQUFVLEVBQUMsZ0NBQWMsQ0FBQyxDQUFDO0FBQzlDLE1BQU0sYUFBYSxHQUFHLElBQUEsZ0NBQVUsRUFBQyxxQ0FBc0IsQ0FBQyxDQUFDO0FBQ3pELE1BQU0sTUFBTSxHQUFHLElBQUEsZ0NBQVUsRUFBQyxvQkFBUSxDQUFDLENBQUM7QUFDcEMsTUFBTSxPQUFPLEdBQUcsSUFBQSxnQ0FBVSxFQUFDLHNCQUFTLENBQUMsQ0FBQztBQUN0QyxNQUFNLGVBQWUsR0FBRyxJQUFBLGdDQUFVLEVBQUMsc0NBQWlCLENBQUMsQ0FBQztBQUV0RCxzQkFBc0I7QUFDdEIsTUFBTSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7QUFFekIsYUFBYTtBQUNiLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEdBQUcsRUFBRTtJQUN0QixPQUFPLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQztRQUNwQixNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtRQUNsQyxJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGNBQWMsRUFBRTtRQUNoQyxRQUFRLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsQ0FBQztRQUMxRSxRQUFRLEVBQUUsSUFB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cnQgeyBoYW5kbGVyIGFzIGltYWdlR2VuZXJhdGlvbkhhbmRsZXIgfSBmcm9tICcuLi9sYW1iZGEvaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudCc7XHJcbmltcG9ydCB7IGhhbmRsZXIgYXMgY29udGVudE9yY2hlc3RyYXRvckhhbmRsZXIgfSBmcm9tICcuLi9sYW1iZGEvY29udGVudC1vcmNoZXN0cmF0b3InO1xyXG5pbXBvcnQgeyBTUVNFdmVudCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBtb2NrQ2xpZW50IH0gZnJvbSAnYXdzLXNkay1jbGllbnQtbW9jayc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgR2V0Q29tbWFuZCwgVXBkYXRlQ29tbWFuZCwgUHV0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcbmltcG9ydCB7IFMzQ2xpZW50LCBQdXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcclxuaW1wb3J0IHsgU1FTQ2xpZW50LCBTZW5kTWVzc2FnZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc3FzJztcclxuaW1wb3J0IHsgRXZlbnRCcmlkZ2VDbGllbnQsIFB1dEV2ZW50c0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZXZlbnRicmlkZ2UnO1xyXG5cclxuLy8gTW9jayBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9Nb2NrID0gbW9ja0NsaWVudChEeW5hbW9EQkNsaWVudCk7XHJcbmNvbnN0IGRvY0NsaWVudE1vY2sgPSBtb2NrQ2xpZW50KER5bmFtb0RCRG9jdW1lbnRDbGllbnQpO1xyXG5jb25zdCBzM01vY2sgPSBtb2NrQ2xpZW50KFMzQ2xpZW50KTtcclxuY29uc3Qgc3FzTW9jayA9IG1vY2tDbGllbnQoU1FTQ2xpZW50KTtcclxuY29uc3QgZXZlbnRCcmlkZ2VNb2NrID0gbW9ja0NsaWVudChFdmVudEJyaWRnZUNsaWVudCk7XHJcblxyXG4vLyBNb2NrIGZldGNoIGdsb2JhbGx5XHJcbmdsb2JhbC5mZXRjaCA9IGplc3QuZm4oKTtcclxuXHJcbi8vIE1vY2sgU2hhcnBcclxuamVzdC5tb2NrKCdzaGFycCcsICgpID0+IHtcclxuICByZXR1cm4gamVzdC5mbigoKSA9PiAoe1xyXG4gICAgcmVzaXplOiBqZXN0LmZuKCkubW9ja1JldHVyblRoaXMoKSxcclxuICAgIHdlYnA6IGplc3QuZm4oKS5tb2NrUmV0dXJuVGhpcygpLFxyXG4gICAgdG9CdWZmZXI6IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZShCdWZmZXIuZnJvbSgnb3B0aW1pemVkLWltYWdlLWRhdGEnKSksXHJcbiAgICBtZXRhZGF0YTogamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHsgd2lkdGg6IDEwMjQsIGhlaWdodDogMTAyNCB9KVxyXG4gIH0pKTtcclxufSk7XHJcblxyXG4vLyBNb2NrIGVudmlyb25tZW50IHZhcmlhYmxlc1xyXG5wcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUgPSAndGVzdC1jb250ZW50JztcclxucHJvY2Vzcy5lbnYuSU1BR0VfQlVDS0VUX05BTUUgPSAndGVzdC1pbWFnZXMnO1xyXG5wcm9jZXNzLmVudi5PUkNIRVNUUkFUT1JfUVVFVUVfVVJMID0gJ2h0dHBzOi8vc3FzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tLzEyMzQ1Njc4OTAxMi90ZXN0LW9yY2hlc3RyYXRvcic7XHJcbnByb2Nlc3MuZW52LklNQUdFX0dFTkVSQVRJT05fUVVFVUVfVVJMID0gJ2h0dHBzOi8vc3FzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tLzEyMzQ1Njc4OTAxMi90ZXN0LWltYWdlLWdlbmVyYXRpb24nO1xyXG5wcm9jZXNzLmVudi5FVkVOVF9CVVNfTkFNRSA9ICd0ZXN0LWV2ZW50cyc7XHJcbnByb2Nlc3MuZW52Lk9QRU5BSV9BUElfS0VZID0gJ3Rlc3Qtb3BlbmFpLWtleSc7XHJcbnByb2Nlc3MuZW52LkFXU19SRUdJT04gPSAndXMtZWFzdC0xJztcclxuXHJcbmRlc2NyaWJlKCdJbWFnZSBHZW5lcmF0aW9uIEVuZC10by1FbmQgVGVzdHMnLCAoKSA9PiB7XHJcbiAgY29uc3QgbW9ja0NvbnRleHQ6IENvbnRleHQgPSB7XHJcbiAgICBjYWxsYmFja1dhaXRzRm9yRW1wdHlFdmVudExvb3A6IGZhbHNlLFxyXG4gICAgZnVuY3Rpb25OYW1lOiAndGVzdC1mdW5jdGlvbicsXHJcbiAgICBmdW5jdGlvblZlcnNpb246ICcxJyxcclxuICAgIGludm9rZWRGdW5jdGlvbkFybjogJ2Fybjphd3M6bGFtYmRhOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6ZnVuY3Rpb246dGVzdC1mdW5jdGlvbicsXHJcbiAgICBtZW1vcnlMaW1pdEluTUI6ICcxMDI0JyxcclxuICAgIGF3c1JlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS90ZXN0LWZ1bmN0aW9uJyxcclxuICAgIGxvZ1N0cmVhbU5hbWU6ICcyMDIzLzAxLzAxL1skTEFURVNUXXRlc3Qtc3RyZWFtJyxcclxuICAgIGdldFJlbWFpbmluZ1RpbWVJbk1pbGxpczogKCkgPT4gMzAwMDAsXHJcbiAgICBkb25lOiAoKSA9PiB7fSxcclxuICAgIGZhaWw6ICgpID0+IHt9LFxyXG4gICAgc3VjY2VlZDogKCkgPT4ge30sXHJcbiAgfTtcclxuXHJcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XHJcbiAgICBkeW5hbW9Nb2NrLnJlc2V0KCk7XHJcbiAgICBkb2NDbGllbnRNb2NrLnJlc2V0KCk7XHJcbiAgICBzM01vY2sucmVzZXQoKTtcclxuICAgIHNxc01vY2sucmVzZXQoKTtcclxuICAgIGV2ZW50QnJpZGdlTW9jay5yZXNldCgpO1xyXG4gICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2spLm1vY2tDbGVhcigpO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnQ29tcGxldGUgSW1hZ2UgR2VuZXJhdGlvbiBXb3JrZmxvdycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgY29tcGxldGUgZnVsbCB3b3JrZmxvdyBmcm9tIGNvbnRlbnQgZ2VuZXJhdGlvbiB0byBpbWFnZSBjcmVhdGlvbicsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gU3RlcCAxOiBNb2NrIGNvbnRlbnQgZXhpc3RzIGluIER5bmFtb0RCXHJcbiAgICAgIGNvbnN0IHRlc3RDb250ZW50ID0ge1xyXG4gICAgICAgIGlkOiAnY29udGVudC0xMjMnLFxyXG4gICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJyxcclxuICAgICAgICB0aXRsZTogJ1RoZSBGdXR1cmUgb2YgQ2xvdWQgQ29tcHV0aW5nJyxcclxuICAgICAgICBjb250ZW50OiAnVGhpcyBjb21wcmVoZW5zaXZlIGd1aWRlIGV4cGxvcmVzIEFXUyBzZXJ2aWNlcywgc2VydmVybGVzcyBhcmNoaXRlY3R1cmUsIEt1YmVybmV0ZXMgb3JjaGVzdHJhdGlvbiwgYW5kIG1vZGVybiBEZXZPcHMgcHJhY3RpY2VzIGZvciBlbnRlcnByaXNlIHRyYW5zZm9ybWF0aW9uLicsXHJcbiAgICAgICAgc3RhdHVzOiAnY29udGVudF9nZW5lcmF0ZWQnLFxyXG4gICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBkb2NDbGllbnRNb2NrLm9uKEdldENvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBJdGVtOiB0ZXN0Q29udGVudFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIFN0ZXAgMjogTW9jayBzdWNjZXNzZnVsIGltYWdlIGdlbmVyYXRpb25cclxuICAgICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2spXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgICBvazogdHJ1ZSxcclxuICAgICAgICAgIGpzb246IGFzeW5jICgpID0+ICh7XHJcbiAgICAgICAgICAgIGRhdGE6IFt7IHVybDogJ2h0dHBzOi8vb2FpZGFsbGVhcGlwcm9kc2N1cy5ibG9iLmNvcmUud2luZG93cy5uZXQvcHJpdmF0ZS9nZW5lcmF0ZWQtaW1hZ2UucG5nJyB9XVxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgfSlcclxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcclxuICAgICAgICAgIG9rOiB0cnVlLFxyXG4gICAgICAgICAgYXJyYXlCdWZmZXI6IGFzeW5jICgpID0+IG5ldyBBcnJheUJ1ZmZlcigyMDQ4MDAwKSwgLy8gMk1CIGltYWdlXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBTdGVwIDM6IE1vY2sgUzMgdXBsb2Fkc1xyXG4gICAgICBzM01vY2sub24oUHV0T2JqZWN0Q29tbWFuZCkucmVzb2x2ZXMoe30pO1xyXG5cclxuICAgICAgLy8gU3RlcCA0OiBNb2NrIER5bmFtb0RCIHVwZGF0ZXNcclxuICAgICAgZG9jQ2xpZW50TW9jay5vbihVcGRhdGVDb21tYW5kKS5yZXNvbHZlcyh7fSk7XHJcblxyXG4gICAgICAvLyBTdGVwIDU6IE1vY2sgU1FTIGFuZCBFdmVudEJyaWRnZVxyXG4gICAgICBzcXNNb2NrLm9uKFNlbmRNZXNzYWdlQ29tbWFuZCkucmVzb2x2ZXMoeyBNZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnIH0pO1xyXG4gICAgICBldmVudEJyaWRnZU1vY2sub24oUHV0RXZlbnRzQ29tbWFuZCkucmVzb2x2ZXMoeyBGYWlsZWRFbnRyeUNvdW50OiAwLCBFbnRyaWVzOiBbeyBFdmVudElkOiAndGVzdC1ldmVudC1pZCcgfV0gfSk7XHJcblxyXG4gICAgICAvLyBTdGVwIDY6IFNpbXVsYXRlIG9yY2hlc3RyYXRvciB0cmlnZ2VyaW5nIGltYWdlIGdlbmVyYXRpb25cclxuICAgICAgY29uc3Qgb3JjaGVzdHJhdG9yRXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgICBtZXNzYWdlSWQ6ICdvcmNoZXN0cmF0b3ItbWVzc2FnZScsXHJcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAndGVzdC1yZWNlaXB0LWhhbmRsZScsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0xMjMnLFxyXG4gICAgICAgICAgICB3b3JrZmxvd0lkOiAnd29ya2Zsb3ctMTIzJyxcclxuICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1nZW5lcmF0aW9uLWNvbXBsZXRlZCcsXHJcbiAgICAgICAgICAgIGFnZW50VHlwZTogJ29yY2hlc3RyYXRvcicsXHJcbiAgICAgICAgICAgIG1lc3NhZ2VUeXBlOiAnY29udGVudC1yZWFkeScsXHJcbiAgICAgICAgICAgIHBheWxvYWQ6IHtcclxuICAgICAgICAgICAgICBjb250ZW50SWQ6IHRlc3RDb250ZW50LmlkLFxyXG4gICAgICAgICAgICAgIHVzZXJJZDogdGVzdENvbnRlbnQudXNlcklkLFxyXG4gICAgICAgICAgICAgIG5leHRTdGVwOiAnaW1hZ2UtZ2VuZXJhdGlvbidcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgYXR0cmlidXRlczoge1xyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxyXG4gICAgICAgICAgICBTZW50VGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCcsXHJcbiAgICAgICAgICAgIFNlbmRlcklkOiAndGVzdC1zZW5kZXInLFxyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxyXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAndGVzdC1tZDUnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcclxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LW9yY2hlc3RyYXRvci1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIFByb2Nlc3Mgb3JjaGVzdHJhdG9yIGV2ZW50ICh3b3VsZCB0cmlnZ2VyIGltYWdlIGdlbmVyYXRpb24pXHJcbiAgICAgIGF3YWl0IGV4cGVjdChjb250ZW50T3JjaGVzdHJhdG9ySGFuZGxlcihvcmNoZXN0cmF0b3JFdmVudCwgbW9ja0NvbnRleHQpKS5yZXNvbHZlcy5ub3QudG9UaHJvdygpO1xyXG5cclxuICAgICAgLy8gU3RlcCA3OiBTaW11bGF0ZSBpbWFnZSBnZW5lcmF0aW9uIGFnZW50IHByb2Nlc3NpbmdcclxuICAgICAgY29uc3QgaW1hZ2VHZW5lcmF0aW9uRXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgICBtZXNzYWdlSWQ6ICdpbWFnZS1nZW4tbWVzc2FnZScsXHJcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAndGVzdC1yZWNlaXB0LWhhbmRsZScsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VJZDogJ2ltZy1tc2ctMTIzJyxcclxuICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgIHN0ZXBJZDogJ2ltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgICBhZ2VudFR5cGU6ICdpbWFnZS1nZW5lcmF0b3InLFxyXG4gICAgICAgICAgICBtZXNzYWdlVHlwZTogJ3JlcXVlc3QnLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnaW1hZ2UtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgY29udGVudElkOiB0ZXN0Q29udGVudC5pZCxcclxuICAgICAgICAgICAgICBjb250ZW50OiB0ZXN0Q29udGVudC5jb250ZW50LFxyXG4gICAgICAgICAgICAgIHVzZXJJZDogdGVzdENvbnRlbnQudXNlcklkLFxyXG4gICAgICAgICAgICAgIHN0eWxlOiAncHJvZmVzc2lvbmFsJ1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXHJcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJyxcclxuICAgICAgICAgICAgU2VuZGVySWQ6ICd0ZXN0LXNlbmRlcicsXHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCdcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXHJcbiAgICAgICAgICBtZDVPZkJvZHk6ICd0ZXN0LW1kNScsXHJcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtaW1hZ2UtZ2VuZXJhdGlvbi1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIFByb2Nlc3MgaW1hZ2UgZ2VuZXJhdGlvbiBldmVudFxyXG4gICAgICBhd2FpdCBleHBlY3QoaW1hZ2VHZW5lcmF0aW9uSGFuZGxlcihpbWFnZUdlbmVyYXRpb25FdmVudCwgbW9ja0NvbnRleHQpKS5yZXNvbHZlcy5ub3QudG9UaHJvdygpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IHRoZSBjb21wbGV0ZSB3b3JrZmxvd1xyXG4gICAgICBcclxuICAgICAgLy8gMS4gQ29udGVudCB3YXMgcmV0cmlldmVkIGZyb20gRHluYW1vREJcclxuICAgICAgZXhwZWN0KGRvY0NsaWVudE1vY2suY29tbWFuZENhbGxzKEdldENvbW1hbmQpKS50b0hhdmVMZW5ndGgoMSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyAyLiBPcGVuQUkgQVBJIHdhcyBjYWxsZWQgZm9yIGltYWdlIGdlbmVyYXRpb25cclxuICAgICAgZXhwZWN0KGdsb2JhbC5mZXRjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICAgJ2h0dHBzOi8vYXBpLm9wZW5haS5jb20vdjEvaW1hZ2VzL2dlbmVyYXRpb25zJyxcclxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICAgIGhlYWRlcnM6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyIHRlc3Qtb3BlbmFpLWtleSdcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIC8vIDMuIEltYWdlIHdhcyBkb3dubG9hZGVkXHJcbiAgICAgIGV4cGVjdChnbG9iYWwuZmV0Y2gpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcclxuXHJcbiAgICAgIC8vIDQuIEJvdGggb3JpZ2luYWwgYW5kIG9wdGltaXplZCBpbWFnZXMgd2VyZSBzdG9yZWQgaW4gUzNcclxuICAgICAgZXhwZWN0KHMzTW9jay5jb21tYW5kQ2FsbHMoUHV0T2JqZWN0Q29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgyKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHMzQ2FsbHMgPSBzM01vY2suY29tbWFuZENhbGxzKFB1dE9iamVjdENvbW1hbmQpO1xyXG4gICAgICBjb25zdCBvcmlnaW5hbFVwbG9hZCA9IHMzQ2FsbHMuZmluZChjYWxsID0+IGNhbGwuYXJnc1swXS5pbnB1dC5LZXk/LmluY2x1ZGVzKCdvcmlnaW5hbCcpKTtcclxuICAgICAgY29uc3Qgb3B0aW1pemVkVXBsb2FkID0gczNDYWxscy5maW5kKGNhbGwgPT4gY2FsbC5hcmdzWzBdLmlucHV0LktleT8uaW5jbHVkZXMoJ29wdGltaXplZCcpKTtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChvcmlnaW5hbFVwbG9hZCkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KG9wdGltaXplZFVwbG9hZCkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KG9yaWdpbmFsVXBsb2FkPy5hcmdzWzBdLmlucHV0LkNvbnRlbnRUeXBlKS50b0JlKCdpbWFnZS9wbmcnKTtcclxuICAgICAgZXhwZWN0KG9wdGltaXplZFVwbG9hZD8uYXJnc1swXS5pbnB1dC5Db250ZW50VHlwZSkudG9CZSgnaW1hZ2Uvd2VicCcpO1xyXG5cclxuICAgICAgLy8gNS4gQ29udGVudCB3YXMgdXBkYXRlZCB3aXRoIGltYWdlIFVSTFxyXG4gICAgICBleHBlY3QoZG9jQ2xpZW50TW9jay5jb21tYW5kQ2FsbHMoVXBkYXRlQ29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgxKTtcclxuICAgICAgY29uc3QgdXBkYXRlQ2FsbCA9IGRvY0NsaWVudE1vY2suY29tbWFuZENhbGxzKFVwZGF0ZUNvbW1hbmQpWzBdO1xyXG4gICAgICBleHBlY3QodXBkYXRlQ2FsbC5hcmdzWzBdLmlucHV0LlVwZGF0ZUV4cHJlc3Npb24pLnRvQ29udGFpbignI2ltYWdlVXJsJyk7XHJcblxyXG4gICAgICAvLyA2LiBTdWNjZXNzIHJlc3BvbnNlIHdhcyBzZW50IHRvIG9yY2hlc3RyYXRvclxyXG4gICAgICBleHBlY3Qoc3FzTW9jay5jb21tYW5kQ2FsbHMoU2VuZE1lc3NhZ2VDb21tYW5kKSkudG9IYXZlTGVuZ3RoKDEpO1xyXG4gICAgICBjb25zdCBzcXNDYWxsID0gc3FzTW9jay5jb21tYW5kQ2FsbHMoU2VuZE1lc3NhZ2VDb21tYW5kKVswXTtcclxuICAgICAgY29uc3QgbWVzc2FnZUJvZHkgPSBKU09OLnBhcnNlKHNxc0NhbGwuYXJnc1swXS5pbnB1dC5NZXNzYWdlQm9keSEpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkubWVzc2FnZVR5cGUpLnRvQmUoJ3Jlc3BvbnNlJyk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlQm9keS5wYXlsb2FkLnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlQm9keS5wYXlsb2FkLmltYWdlVXJsKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5tZXRhZGF0YSkudG9CZURlZmluZWQoKTtcclxuXHJcbiAgICAgIC8vIDcuIFN1Y2Nlc3MgZXZlbnQgd2FzIHB1Ymxpc2hlZFxyXG4gICAgICBleHBlY3QoZXZlbnRCcmlkZ2VNb2NrLmNvbW1hbmRDYWxscyhQdXRFdmVudHNDb21tYW5kKSkudG9IYXZlTGVuZ3RoKDEpO1xyXG4gICAgICBjb25zdCBldmVudENhbGwgPSBldmVudEJyaWRnZU1vY2suY29tbWFuZENhbGxzKFB1dEV2ZW50c0NvbW1hbmQpWzBdO1xyXG4gICAgICBleHBlY3QoZXZlbnRDYWxsLmFyZ3NbMF0uaW5wdXQuRW50cmllcyFbMF0uU291cmNlKS50b0JlKCdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW1hZ2UtYWdlbnQnKTtcclxuICAgICAgZXhwZWN0KGV2ZW50Q2FsbC5hcmdzWzBdLmlucHV0LkVudHJpZXMhWzBdLkRldGFpbFR5cGUpLnRvQmUoJ0ltYWdlIEdlbmVyYXRpb24gQ29tcGxldGVkJyk7XHJcbiAgICB9LCAzMDAwMCk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW1hZ2UgcmV2aXNpb24gd29ya2Zsb3cgZW5kLXRvLWVuZCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gTW9jayBleGlzdGluZyBjb250ZW50IHdpdGggaW1hZ2VcclxuICAgICAgY29uc3QgZXhpc3RpbmdDb250ZW50ID0ge1xyXG4gICAgICAgIGlkOiAnY29udGVudC00NTYnLFxyXG4gICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJyxcclxuICAgICAgICB0aXRsZTogJ0Rldk9wcyBCZXN0IFByYWN0aWNlcycsXHJcbiAgICAgICAgY29udGVudDogJ1RoaXMgYXJ0aWNsZSBjb3ZlcnMgY29udGludW91cyBpbnRlZ3JhdGlvbiwgZGVwbG95bWVudCBhdXRvbWF0aW9uLCBhbmQgbW9uaXRvcmluZyBzdHJhdGVnaWVzLicsXHJcbiAgICAgICAgc3RhdHVzOiAnaW1hZ2VfZ2VuZXJhdGVkJyxcclxuICAgICAgICBpbWFnZVVybDogJ2h0dHBzOi8vdGVzdC1idWNrZXQuczMuYW1hem9uYXdzLmNvbS9pbWFnZXMvY29udGVudC00NTYvb3B0aW1pemVkLTEyMy53ZWJwJyxcclxuICAgICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgZG9jQ2xpZW50TW9jay5vbihHZXRDb21tYW5kKS5yZXNvbHZlcyh7XHJcbiAgICAgICAgSXRlbTogZXhpc3RpbmdDb250ZW50XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayByZXZpc2VkIGltYWdlIGdlbmVyYXRpb25cclxuICAgICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2spXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgICBvazogdHJ1ZSxcclxuICAgICAgICAgIGpzb246IGFzeW5jICgpID0+ICh7XHJcbiAgICAgICAgICAgIGRhdGE6IFt7IHVybDogJ2h0dHBzOi8vb2FpZGFsbGVhcGlwcm9kc2N1cy5ibG9iLmNvcmUud2luZG93cy5uZXQvcHJpdmF0ZS9yZXZpc2VkLWltYWdlLnBuZycgfV1cclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH0pXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgICBvazogdHJ1ZSxcclxuICAgICAgICAgIGFycmF5QnVmZmVyOiBhc3luYyAoKSA9PiBuZXcgQXJyYXlCdWZmZXIoMTUzNjAwMCksIC8vIDEuNU1CIHJldmlzZWQgaW1hZ2VcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgIHMzTW9jay5vbihQdXRPYmplY3RDb21tYW5kKS5yZXNvbHZlcyh7fSk7XHJcbiAgICAgIGRvY0NsaWVudE1vY2sub24oVXBkYXRlQ29tbWFuZCkucmVzb2x2ZXMoe30pO1xyXG4gICAgICBzcXNNb2NrLm9uKFNlbmRNZXNzYWdlQ29tbWFuZCkucmVzb2x2ZXMoeyBNZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnIH0pO1xyXG5cclxuICAgICAgLy8gU2ltdWxhdGUgaW1hZ2UgcmV2aXNpb24gcmVxdWVzdFxyXG4gICAgICBjb25zdCByZXZpc2lvbkV2ZW50OiBTUVNFdmVudCA9IHtcclxuICAgICAgICBSZWNvcmRzOiBbe1xyXG4gICAgICAgICAgbWVzc2FnZUlkOiAncmV2aXNpb24tbWVzc2FnZScsXHJcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAndGVzdC1yZWNlaXB0LWhhbmRsZScsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VJZDogJ3Jldi1tc2ctMTIzJyxcclxuICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTQ1NicsXHJcbiAgICAgICAgICAgIHN0ZXBJZDogJ2ltYWdlLXJldmlzaW9uJyxcclxuICAgICAgICAgICAgYWdlbnRUeXBlOiAnaW1hZ2UtZ2VuZXJhdG9yJyxcclxuICAgICAgICAgICAgbWVzc2FnZVR5cGU6ICdyZXZpc2lvbicsXHJcbiAgICAgICAgICAgIHBheWxvYWQ6IHtcclxuICAgICAgICAgICAgICB3b3JrZmxvd0lkOiAnd29ya2Zsb3ctNDU2JyxcclxuICAgICAgICAgICAgICBzdGVwSWQ6ICdpbWFnZS1yZXZpc2lvbicsXHJcbiAgICAgICAgICAgICAgY29udGVudElkOiBleGlzdGluZ0NvbnRlbnQuaWQsXHJcbiAgICAgICAgICAgICAgY3VycmVudEltYWdlVXJsOiBleGlzdGluZ0NvbnRlbnQuaW1hZ2VVcmwsXHJcbiAgICAgICAgICAgICAgZmVlZGJhY2s6ICdNYWtlIGl0IG1vcmUgY29sb3JmdWwgYW5kIGFkZCBhdXRvbWF0aW9uIHN5bWJvbHMnLFxyXG4gICAgICAgICAgICAgIHVzZXJJZDogZXhpc3RpbmdDb250ZW50LnVzZXJJZFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXHJcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJyxcclxuICAgICAgICAgICAgU2VuZGVySWQ6ICd0ZXN0LXNlbmRlcicsXHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCdcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXHJcbiAgICAgICAgICBtZDVPZkJvZHk6ICd0ZXN0LW1kNScsXHJcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtaW1hZ2UtZ2VuZXJhdGlvbi1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChpbWFnZUdlbmVyYXRpb25IYW5kbGVyKHJldmlzaW9uRXZlbnQsIG1vY2tDb250ZXh0KSkucmVzb2x2ZXMubm90LnRvVGhyb3coKTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSByZXZpc2lvbiB3b3JrZmxvd1xyXG4gICAgICBleHBlY3QoZ2xvYmFsLmZldGNoKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcclxuICAgICAgICAnaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MS9pbWFnZXMvZ2VuZXJhdGlvbnMnLFxyXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgIGJvZHk6IGV4cGVjdC5zdHJpbmdDb250YWluaW5nKCdtb3JlIGNvbG9yZnVsIGFuZCB2aWJyYW50JylcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG5cclxuICAgICAgZXhwZWN0KHMzTW9jay5jb21tYW5kQ2FsbHMoUHV0T2JqZWN0Q29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgyKTtcclxuICAgICAgZXhwZWN0KGRvY0NsaWVudE1vY2suY29tbWFuZENhbGxzKFVwZGF0ZUNvbW1hbmQpKS50b0hhdmVMZW5ndGgoMSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBzcXNDYWxsID0gc3FzTW9jay5jb21tYW5kQ2FsbHMoU2VuZE1lc3NhZ2VDb21tYW5kKVswXTtcclxuICAgICAgY29uc3QgbWVzc2FnZUJvZHkgPSBKU09OLnBhcnNlKHNxc0NhbGwuYXJnc1swXS5pbnB1dC5NZXNzYWdlQm9keSEpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5mZWVkYmFjaykudG9CZSgnTWFrZSBpdCBtb3JlIGNvbG9yZnVsIGFuZCBhZGQgYXV0b21hdGlvbiBzeW1ib2xzJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb250ZW50IGFuYWx5c2lzIHdvcmtmbG93JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCB0ZWNobmljYWxDb250ZW50ID0gYFxyXG4gICAgICAgIFRoaXMgY29tcHJlaGVuc2l2ZSBndWlkZSBleHBsb3JlcyBBV1MgTGFtYmRhIGZ1bmN0aW9ucywgS3ViZXJuZXRlcyBvcmNoZXN0cmF0aW9uLCBcclxuICAgICAgICBzZXJ2ZXJsZXNzIGFyY2hpdGVjdHVyZSBwYXR0ZXJucywgYW5kIGluZnJhc3RydWN0dXJlIGFzIGNvZGUuIFdlJ2xsIGNvdmVyIG1vbml0b3JpbmcgXHJcbiAgICAgICAgc3RyYXRlZ2llcywgY29zdCBvcHRpbWl6YXRpb24gdGVjaG5pcXVlcywgYW5kIERldk9wcyBiZXN0IHByYWN0aWNlcyBmb3IgZW50ZXJwcmlzZSBcclxuICAgICAgICBjbG91ZCBkZXBsb3ltZW50cy5cclxuICAgICAgYDtcclxuXHJcbiAgICAgIC8vIFRlc3QgY29udGVudCBhbmFseXNpcyB0aHJvdWdoIHRoZSBpbWFnZSBnZW5lcmF0aW9uIHdvcmtmbG93XHJcbiAgICAgIGNvbnN0IGFuYWx5c2lzRXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgICBtZXNzYWdlSWQ6ICdhbmFseXNpcy1tZXNzYWdlJyxcclxuICAgICAgICAgIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQtaGFuZGxlJyxcclxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgbWVzc2FnZVR5cGU6ICdyZXF1ZXN0JyxcclxuICAgICAgICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgICAgICAgIHdvcmtmbG93SWQ6ICd3b3JrZmxvdy03ODknLFxyXG4gICAgICAgICAgICAgIHN0ZXBJZDogJ2ltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgICAgIGNvbnRlbnRJZDogJ2NvbnRlbnQtNzg5JyxcclxuICAgICAgICAgICAgICBjb250ZW50OiB0ZWNobmljYWxDb250ZW50LFxyXG4gICAgICAgICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcclxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnLFxyXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXHJcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCBpbWFnZSBnZW5lcmF0aW9uXHJcbiAgICAgIChnbG9iYWwuZmV0Y2ggYXMgamVzdC5Nb2NrKVxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgICAgb2s6IHRydWUsXHJcbiAgICAgICAgICBqc29uOiBhc3luYyAoKSA9PiAoe1xyXG4gICAgICAgICAgICBkYXRhOiBbeyB1cmw6ICdodHRwczovL2V4YW1wbGUuY29tL3RlY2huaWNhbC1pbWFnZS5wbmcnIH1dXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9KVxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgICAgb2s6IHRydWUsXHJcbiAgICAgICAgICBhcnJheUJ1ZmZlcjogYXN5bmMgKCkgPT4gbmV3IEFycmF5QnVmZmVyKDEwMjQwMDApLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgczNNb2NrLm9uKFB1dE9iamVjdENvbW1hbmQpLnJlc29sdmVzKHt9KTtcclxuICAgICAgc3FzTW9jay5vbihTZW5kTWVzc2FnZUNvbW1hbmQpLnJlc29sdmVzKHsgTWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJyB9KTtcclxuICAgICAgZXZlbnRCcmlkZ2VNb2NrLm9uKFB1dEV2ZW50c0NvbW1hbmQpLnJlc29sdmVzKHsgRmFpbGVkRW50cnlDb3VudDogMCwgRW50cmllczogW3sgRXZlbnRJZDogJ3Rlc3QtZXZlbnQtaWQnIH1dIH0pO1xyXG5cclxuICAgICAgYXdhaXQgZXhwZWN0KGltYWdlR2VuZXJhdGlvbkhhbmRsZXIoYW5hbHlzaXNFdmVudCwgbW9ja0NvbnRleHQpKS5yZXNvbHZlcy5ub3QudG9UaHJvdygpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IHRoYXQgdGhlIGdlbmVyYXRlZCBwcm9tcHQgaW5jbHVkZXMgdGVjaG5pY2FsIGNvbmNlcHRzXHJcbiAgICAgIGV4cGVjdChnbG9iYWwuZmV0Y2gpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxyXG4gICAgICAgICdodHRwczovL2FwaS5vcGVuYWkuY29tL3YxL2ltYWdlcy9nZW5lcmF0aW9ucycsXHJcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgYm9keTogZXhwZWN0LnN0cmluZ01hdGNoaW5nKC9hd3N8a3ViZXJuZXRlc3xzZXJ2ZXJsZXNzfGluZnJhc3RydWN0dXJlfGRldm9wcy9pKVxyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgICBjb25zdCBzcXNDYWxsID0gc3FzTW9jay5jb21tYW5kQ2FsbHMoU2VuZE1lc3NhZ2VDb21tYW5kKVswXTtcclxuICAgICAgY29uc3QgbWVzc2FnZUJvZHkgPSBKU09OLnBhcnNlKHNxc0NhbGwuYXJnc1swXS5pbnB1dC5NZXNzYWdlQm9keSEpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5hbmFseXNpcykudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5LnBheWxvYWQuYW5hbHlzaXMuY29uY2VwdHMpLnRvRXF1YWwoXHJcbiAgICAgICAgZXhwZWN0LmFycmF5Q29udGFpbmluZyhbJ2F3cycsICdrdWJlcm5ldGVzJywgJ3NlcnZlcmxlc3MnLCAnaW5mcmFzdHJ1Y3R1cmUnLCAnZGV2b3BzJ10pXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0Vycm9yIEhhbmRsaW5nIEVuZC10by1FbmQnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb21wbGV0ZSB3b3JrZmxvdyBmYWlsdXJlIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIE1vY2sgT3BlbkFJIEFQSSBmYWlsdXJlXHJcbiAgICAgIChnbG9iYWwuZmV0Y2ggYXMgamVzdC5Nb2NrKS5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICBqc29uOiBhc3luYyAoKSA9PiAoe1xyXG4gICAgICAgICAgZXJyb3I6IHsgbWVzc2FnZTogJ1JhdGUgbGltaXQgZXhjZWVkZWQnIH1cclxuICAgICAgICB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBzcXNNb2NrLm9uKFNlbmRNZXNzYWdlQ29tbWFuZCkucmVzb2x2ZXMoeyBNZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnIH0pO1xyXG4gICAgICBldmVudEJyaWRnZU1vY2sub24oUHV0RXZlbnRzQ29tbWFuZCkucmVzb2x2ZXMoeyBGYWlsZWRFbnRyeUNvdW50OiAwLCBFbnRyaWVzOiBbeyBFdmVudElkOiAndGVzdC1ldmVudC1pZCcgfV0gfSk7XHJcblxyXG4gICAgICBjb25zdCBmYWlsdXJlRXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgICBtZXNzYWdlSWQ6ICdmYWlsdXJlLW1lc3NhZ2UnLFxyXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdC1oYW5kbGUnLFxyXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICBtZXNzYWdlVHlwZTogJ3JlcXVlc3QnLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LWZhaWwnLFxyXG4gICAgICAgICAgICAgIHN0ZXBJZDogJ2ltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgICAgIGNvbnRlbnRJZDogJ2NvbnRlbnQtZmFpbCcsXHJcbiAgICAgICAgICAgICAgY29udGVudDogJ1Rlc3QgY29udGVudCcsXHJcbiAgICAgICAgICAgICAgdXNlcklkOiAndXNlci0xMjMnXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgYXR0cmlidXRlczoge1xyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxyXG4gICAgICAgICAgICBTZW50VGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCcsXHJcbiAgICAgICAgICAgIFNlbmRlcklkOiAndGVzdC1zZW5kZXInLFxyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxyXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAndGVzdC1tZDUnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcclxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcclxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcclxuICAgICAgICB9XVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgYXdhaXQgZXhwZWN0KGltYWdlR2VuZXJhdGlvbkhhbmRsZXIoZmFpbHVyZUV2ZW50LCBtb2NrQ29udGV4dCkpLnJlc29sdmVzLm5vdC50b1Rocm93KCk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgZXJyb3IgaGFuZGxpbmdcclxuICAgICAgY29uc3Qgc3FzQ2FsbCA9IHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZClbMF07XHJcbiAgICAgIGNvbnN0IG1lc3NhZ2VCb2R5ID0gSlNPTi5wYXJzZShzcXNDYWxsLmFyZ3NbMF0uaW5wdXQuTWVzc2FnZUJvZHkhKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5Lm1lc3NhZ2VUeXBlKS50b0JlKCdlcnJvcicpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5zdWNjZXNzKS50b0JlKGZhbHNlKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5LnBheWxvYWQuZXJyb3IpLnRvQ29udGFpbignUmF0ZSBsaW1pdCBleGNlZWRlZCcpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5yZXRyeWFibGUpLnRvQmUodHJ1ZSk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgZmFpbHVyZSBldmVudCB3YXMgcHVibGlzaGVkXHJcbiAgICAgIGNvbnN0IGV2ZW50Q2FsbCA9IGV2ZW50QnJpZGdlTW9jay5jb21tYW5kQ2FsbHMoUHV0RXZlbnRzQ29tbWFuZClbMF07XHJcbiAgICAgIGV4cGVjdChldmVudENhbGwuYXJnc1swXS5pbnB1dC5FbnRyaWVzIVswXS5EZXRhaWxUeXBlKS50b0JlKCdJbWFnZSBHZW5lcmF0aW9uIEZhaWxlZCcpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgUzMgc3RvcmFnZSBmYWlsdXJlIGluIHdvcmtmbG93JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgaW1hZ2UgZ2VuZXJhdGlvbiBidXQgUzMgZmFpbHVyZVxyXG4gICAgICAoZ2xvYmFsLmZldGNoIGFzIGplc3QuTW9jaylcclxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcclxuICAgICAgICAgIG9rOiB0cnVlLFxyXG4gICAgICAgICAganNvbjogYXN5bmMgKCkgPT4gKHtcclxuICAgICAgICAgICAgZGF0YTogW3sgdXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZS5wbmcnIH1dXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9KVxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgICAgb2s6IHRydWUsXHJcbiAgICAgICAgICBhcnJheUJ1ZmZlcjogYXN5bmMgKCkgPT4gbmV3IEFycmF5QnVmZmVyKDEwMjQwMDApLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBTMyBmYWlsdXJlXHJcbiAgICAgIHMzTW9jay5vbihQdXRPYmplY3RDb21tYW5kKS5yZWplY3RzKG5ldyBFcnJvcignQWNjZXNzIGRlbmllZCcpKTtcclxuXHJcbiAgICAgIHNxc01vY2sub24oU2VuZE1lc3NhZ2VDb21tYW5kKS5yZXNvbHZlcyh7IE1lc3NhZ2VJZDogJ3Rlc3QtbWVzc2FnZS1pZCcgfSk7XHJcbiAgICAgIGV2ZW50QnJpZGdlTW9jay5vbihQdXRFdmVudHNDb21tYW5kKS5yZXNvbHZlcyh7IEZhaWxlZEVudHJ5Q291bnQ6IDAsIEVudHJpZXM6IFt7IEV2ZW50SWQ6ICd0ZXN0LWV2ZW50LWlkJyB9XSB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHMzRmFpbHVyZUV2ZW50OiBTUVNFdmVudCA9IHtcclxuICAgICAgICBSZWNvcmRzOiBbe1xyXG4gICAgICAgICAgbWVzc2FnZUlkOiAnczMtZmFpbHVyZS1tZXNzYWdlJyxcclxuICAgICAgICAgIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQtaGFuZGxlJyxcclxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgbWVzc2FnZVR5cGU6ICdyZXF1ZXN0JyxcclxuICAgICAgICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgICAgICAgIHdvcmtmbG93SWQ6ICd3b3JrZmxvdy1zMy1mYWlsJyxcclxuICAgICAgICAgICAgICBzdGVwSWQ6ICdpbWFnZS1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgICBjb250ZW50SWQ6ICdjb250ZW50LXMzLWZhaWwnLFxyXG4gICAgICAgICAgICAgIGNvbnRlbnQ6ICdUZXN0IGNvbnRlbnQgZm9yIFMzIGZhaWx1cmUnLFxyXG4gICAgICAgICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcclxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnLFxyXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXHJcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChpbWFnZUdlbmVyYXRpb25IYW5kbGVyKHMzRmFpbHVyZUV2ZW50LCBtb2NrQ29udGV4dCkpLnJlc29sdmVzLm5vdC50b1Rocm93KCk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgZXJyb3Igd2FzIGhhbmRsZWQgYW5kIHJlcG9ydGVkXHJcbiAgICAgIGNvbnN0IHNxc0NhbGwgPSBzcXNNb2NrLmNvbW1hbmRDYWxscyhTZW5kTWVzc2FnZUNvbW1hbmQpWzBdO1xyXG4gICAgICBjb25zdCBtZXNzYWdlQm9keSA9IEpTT04ucGFyc2Uoc3FzQ2FsbC5hcmdzWzBdLmlucHV0Lk1lc3NhZ2VCb2R5ISk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlQm9keS5tZXNzYWdlVHlwZSkudG9CZSgnZXJyb3InKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5LnBheWxvYWQuZXJyb3IpLnRvQ29udGFpbignQWNjZXNzIGRlbmllZCcpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdQZXJmb3JtYW5jZSBFbmQtdG8tRW5kJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBjb21wbGV0ZSB3b3JrZmxvdyB3aXRoaW4gcGVyZm9ybWFuY2UgdGhyZXNob2xkcycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcclxuXHJcbiAgICAgIC8vIE1vY2sgZmFzdCByZXNwb25zZXNcclxuICAgICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2spXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgICBvazogdHJ1ZSxcclxuICAgICAgICAgIGpzb246IGFzeW5jICgpID0+ICh7XHJcbiAgICAgICAgICAgIGRhdGE6IFt7IHVybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vZmFzdC1pbWFnZS5wbmcnIH1dXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9KVxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgICAgb2s6IHRydWUsXHJcbiAgICAgICAgICBhcnJheUJ1ZmZlcjogYXN5bmMgKCkgPT4gbmV3IEFycmF5QnVmZmVyKDUxMjAwMCksIC8vIFNtYWxsZXIgaW1hZ2UgZm9yIGZhc3RlciBwcm9jZXNzaW5nXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICBzM01vY2sub24oUHV0T2JqZWN0Q29tbWFuZCkucmVzb2x2ZXMoe30pO1xyXG4gICAgICBkb2NDbGllbnRNb2NrLm9uKFVwZGF0ZUNvbW1hbmQpLnJlc29sdmVzKHt9KTtcclxuICAgICAgc3FzTW9jay5vbihTZW5kTWVzc2FnZUNvbW1hbmQpLnJlc29sdmVzKHsgTWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJyB9KTtcclxuICAgICAgZXZlbnRCcmlkZ2VNb2NrLm9uKFB1dEV2ZW50c0NvbW1hbmQpLnJlc29sdmVzKHsgRmFpbGVkRW50cnlDb3VudDogMCwgRW50cmllczogW3sgRXZlbnRJZDogJ3Rlc3QtZXZlbnQtaWQnIH1dIH0pO1xyXG5cclxuICAgICAgY29uc3QgcGVyZm9ybWFuY2VFdmVudDogU1FTRXZlbnQgPSB7XHJcbiAgICAgICAgUmVjb3JkczogW3tcclxuICAgICAgICAgIG1lc3NhZ2VJZDogJ3BlcmZvcm1hbmNlLW1lc3NhZ2UnLFxyXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdC1oYW5kbGUnLFxyXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICBtZXNzYWdlVHlwZTogJ3JlcXVlc3QnLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LXBlcmYnLFxyXG4gICAgICAgICAgICAgIHN0ZXBJZDogJ2ltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgICAgIGNvbnRlbnRJZDogJ2NvbnRlbnQtcGVyZicsXHJcbiAgICAgICAgICAgICAgY29udGVudDogJ1Nob3J0IGNvbnRlbnQgZm9yIHBlcmZvcm1hbmNlIHRlc3QnLFxyXG4gICAgICAgICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcclxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnLFxyXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXHJcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGltYWdlR2VuZXJhdGlvbkhhbmRsZXIocGVyZm9ybWFuY2VFdmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgY29uc3QgZW5kVGltZSA9IERhdGUubm93KCk7XHJcbiAgICAgIGNvbnN0IHByb2Nlc3NpbmdUaW1lID0gZW5kVGltZSAtIHN0YXJ0VGltZTtcclxuXHJcbiAgICAgIC8vIFNob3VsZCBjb21wbGV0ZSB3aXRoaW4gcmVhc29uYWJsZSB0aW1lIChhbGxvd2luZyBmb3IgbW9ja3MpXHJcbiAgICAgIGV4cGVjdChwcm9jZXNzaW5nVGltZSkudG9CZUxlc3NUaGFuKDUwMDApOyAvLyA1IHNlY29uZHMgZm9yIG1vY2tlZCBvcGVyYXRpb25zXHJcblxyXG4gICAgICAvLyBWZXJpZnkgc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXHJcbiAgICAgIGNvbnN0IHNxc0NhbGwgPSBzcXNNb2NrLmNvbW1hbmRDYWxscyhTZW5kTWVzc2FnZUNvbW1hbmQpWzBdO1xyXG4gICAgICBjb25zdCBtZXNzYWdlQm9keSA9IEpTT04ucGFyc2Uoc3FzQ2FsbC5hcmdzWzBdLmlucHV0Lk1lc3NhZ2VCb2R5ISk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlQm9keS5wYXlsb2FkLnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19