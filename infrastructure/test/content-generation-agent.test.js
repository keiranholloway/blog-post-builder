"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const content_generation_agent_1 = require("../lambda/content-generation-agent");
const aws_sdk_client_mock_1 = require("aws-sdk-client-mock");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const client_sqs_1 = require("@aws-sdk/client-sqs");
// Mock AWS clients
const dynamoMock = (0, aws_sdk_client_mock_1.mockClient)(client_dynamodb_1.DynamoDBClient);
const eventBridgeMock = (0, aws_sdk_client_mock_1.mockClient)(client_eventbridge_1.EventBridgeClient);
const sqsMock = (0, aws_sdk_client_mock_1.mockClient)(client_sqs_1.SQSClient);
// Mock environment variables
process.env.USER_TABLE_NAME = 'test-users';
process.env.CONTENT_TABLE_NAME = 'test-content';
process.env.EVENT_BUS_NAME = 'test-events';
process.env.ORCHESTRATOR_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-orchestrator';
process.env.AWS_REGION = 'us-east-1';
describe('Content Generation Agent', () => {
    const mockContext = {
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'test-function',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        memoryLimitInMB: '256',
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
        eventBridgeMock.reset();
        sqsMock.reset();
    });
    describe('Content Generation Request', () => {
        it('should successfully generate content from transcription', async () => {
            // Mock user preferences
            dynamoMock.on(client_dynamodb_1.GetItemCommand).resolves({
                Item: {
                    id: { S: 'user-123' },
                    writingStyleContext: { S: JSON.stringify({
                            tone: 'conversational',
                            length: 'medium',
                            targetAudience: 'general audience',
                            writingStyle: 'clear and engaging'
                        }) }
                }
            });
            // Mock successful SQS send
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({
                MessageId: 'test-message-id'
            });
            // Mock successful EventBridge publish
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
                            stepId: 'content-generation',
                            agentType: 'content-generator',
                            messageType: 'request',
                            payload: {
                                workflowId: 'workflow-123',
                                stepId: 'content-generation',
                                input: 'I want to write about the importance of daily exercise and how it can improve mental health.',
                                userId: 'user-123',
                                context: {
                                    previousSteps: [],
                                    userPreferences: {}
                                }
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
            await expect((0, content_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
            // Verify user preferences were loaded
            expect(dynamoMock.commandCalls(client_dynamodb_1.GetItemCommand)).toHaveLength(1);
            expect(dynamoMock.commandCalls(client_dynamodb_1.GetItemCommand)[0].args[0].input).toMatchObject({
                TableName: 'test-users',
                Key: { id: { S: 'user-123' } }
            });
            // Verify response was sent to orchestrator
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            const sqsCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0].args[0].input;
            expect(sqsCall.QueueUrl).toBe('https://sqs.us-east-1.amazonaws.com/123456789012/test-orchestrator');
            const messageBody = JSON.parse(sqsCall.MessageBody);
            expect(messageBody.messageType).toBe('response');
            expect(messageBody.payload.success).toBe(true);
            expect(messageBody.payload.content).toBeDefined();
            // Verify event was published
            expect(eventBridgeMock.commandCalls(client_eventbridge_1.PutEventsCommand)).toHaveLength(1);
            const eventCall = eventBridgeMock.commandCalls(client_eventbridge_1.PutEventsCommand)[0].args[0].input;
            expect(eventCall.Entries[0].Source).toBe('automated-blog-poster.content-agent');
            expect(eventCall.Entries[0].DetailType).toBe('Content Generation Completed');
        });
        it('should handle missing user preferences gracefully', async () => {
            // Mock user not found
            dynamoMock.on(client_dynamodb_1.GetItemCommand).resolves({});
            // Mock successful SQS send
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({
                MessageId: 'test-message-id'
            });
            // Mock successful EventBridge publish
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
                                stepId: 'content-generation',
                                input: 'Test transcription',
                                userId: 'nonexistent-user',
                                context: { previousSteps: [], userPreferences: {} }
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
            await expect((0, content_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
            // Should still generate content with default preferences
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            const messageBody = JSON.parse(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0].args[0].input.MessageBody);
            expect(messageBody.payload.success).toBe(true);
        });
        it('should handle content generation errors', async () => {
            // Mock user preferences
            dynamoMock.on(client_dynamodb_1.GetItemCommand).resolves({
                Item: {
                    id: { S: 'user-123' },
                    writingStyleContext: { S: JSON.stringify({}) }
                }
            });
            // Mock SQS error
            sqsMock.on(client_sqs_1.SendMessageCommand).rejects(new Error('SQS error'));
            const event = {
                Records: [{
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageType: 'request',
                            payload: {
                                workflowId: 'workflow-123',
                                stepId: 'content-generation',
                                input: '',
                                userId: 'user-123',
                                context: { previousSteps: [], userPreferences: {} }
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
            await expect((0, content_generation_agent_1.handler)(event, mockContext)).rejects.toThrow();
        });
    });
    describe('Content Revision Request', () => {
        it('should successfully revise content based on feedback', async () => {
            // Mock user preferences
            dynamoMock.on(client_dynamodb_1.GetItemCommand).resolves({
                Item: {
                    id: { S: 'user-123' },
                    writingStyleContext: { S: JSON.stringify({
                            tone: 'professional',
                            length: 'long',
                            targetAudience: 'business professionals'
                        }) }
                }
            });
            // Mock successful SQS send
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
                                stepId: 'content-revision',
                                currentContent: 'This is the current blog post content that needs revision.',
                                feedback: 'Please make it more engaging and add more examples.',
                                userId: 'user-123',
                                revisionType: 'style'
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
            await expect((0, content_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
            // Verify response was sent
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            const messageBody = JSON.parse(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0].args[0].input.MessageBody);
            expect(messageBody.payload.success).toBe(true);
            expect(messageBody.payload.revisionType).toBe('style');
            expect(messageBody.payload.content).toBeDefined();
        });
        it('should handle different revision types', async () => {
            // Mock user preferences
            dynamoMock.on(client_dynamodb_1.GetItemCommand).resolves({
                Item: {
                    id: { S: 'user-123' },
                    writingStyleContext: { S: JSON.stringify({}) }
                }
            });
            // Mock successful SQS send
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({
                MessageId: 'test-message-id'
            });
            const revisionTypes = ['content', 'style', 'structure', 'tone'];
            for (const revisionType of revisionTypes) {
                const event = {
                    Records: [{
                            messageId: 'test-message-id',
                            receiptHandle: 'test-receipt-handle',
                            body: JSON.stringify({
                                messageType: 'revision',
                                payload: {
                                    workflowId: 'workflow-123',
                                    stepId: 'content-revision',
                                    currentContent: 'Test content for revision',
                                    feedback: `Please improve the ${revisionType}`,
                                    userId: 'user-123',
                                    revisionType
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
                await expect((0, content_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
            }
            // Should have processed all revision types
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(revisionTypes.length);
        });
    });
    describe('Content Validation', () => {
        it('should validate content quality correctly', async () => {
            // This test would be more comprehensive in a real implementation
            // For now, we'll test the basic structure
            // Mock user preferences
            dynamoMock.on(client_dynamodb_1.GetItemCommand).resolves({
                Item: {
                    id: { S: 'user-123' },
                    writingStyleContext: { S: JSON.stringify({}) }
                }
            });
            // Mock successful SQS send
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({
                MessageId: 'test-message-id'
            });
            // Mock successful EventBridge publish
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
                                stepId: 'content-generation',
                                input: 'A comprehensive input about productivity and time management techniques that should generate quality content.',
                                userId: 'user-123',
                                context: { previousSteps: [], userPreferences: {} }
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
            await expect((0, content_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
            // Verify content was generated and validated
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            const messageBody = JSON.parse(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0].args[0].input.MessageBody);
            expect(messageBody.payload.success).toBe(true);
            expect(messageBody.payload.content.quality).toBeDefined();
            expect(messageBody.payload.content.quality.score).toBeGreaterThan(0);
        });
    });
    describe('Error Handling', () => {
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
            await expect((0, content_generation_agent_1.handler)(event, mockContext)).resolves.not.toThrow();
        });
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
            await expect((0, content_generation_agent_1.handler)(event, mockContext)).rejects.toThrow();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1nZW5lcmF0aW9uLWFnZW50LnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250ZW50LWdlbmVyYXRpb24tYWdlbnQudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLGlGQUE2RDtBQUU3RCw2REFBaUQ7QUFDakQsOERBQTZGO0FBQzdGLG9FQUFrRjtBQUNsRixvREFBb0U7QUFFcEUsbUJBQW1CO0FBQ25CLE1BQU0sVUFBVSxHQUFHLElBQUEsZ0NBQVUsRUFBQyxnQ0FBYyxDQUFDLENBQUM7QUFDOUMsTUFBTSxlQUFlLEdBQUcsSUFBQSxnQ0FBVSxFQUFDLHNDQUFpQixDQUFDLENBQUM7QUFDdEQsTUFBTSxPQUFPLEdBQUcsSUFBQSxnQ0FBVSxFQUFDLHNCQUFTLENBQUMsQ0FBQztBQUV0Qyw2QkFBNkI7QUFDN0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLEdBQUcsWUFBWSxDQUFDO0FBQzNDLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLEdBQUcsY0FBYyxDQUFDO0FBQ2hELE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxHQUFHLGFBQWEsQ0FBQztBQUMzQyxPQUFPLENBQUMsR0FBRyxDQUFDLHNCQUFzQixHQUFHLG9FQUFvRSxDQUFDO0FBQzFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxHQUFHLFdBQVcsQ0FBQztBQUVyQyxRQUFRLENBQUMsMEJBQTBCLEVBQUUsR0FBRyxFQUFFO0lBQ3hDLE1BQU0sV0FBVyxHQUFZO1FBQzNCLDhCQUE4QixFQUFFLEtBQUs7UUFDckMsWUFBWSxFQUFFLGVBQWU7UUFDN0IsZUFBZSxFQUFFLEdBQUc7UUFDcEIsa0JBQWtCLEVBQUUsOERBQThEO1FBQ2xGLGVBQWUsRUFBRSxLQUFLO1FBQ3RCLFlBQVksRUFBRSxpQkFBaUI7UUFDL0IsWUFBWSxFQUFFLDJCQUEyQjtRQUN6QyxhQUFhLEVBQUUsaUNBQWlDO1FBQ2hELHdCQUF3QixFQUFFLEdBQUcsRUFBRSxDQUFD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QyxPQUFPLEVBQUUsQ0FBQztRQUNuRSxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxzQ0FBc0MsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNwRCxNQUFNLEtBQUssR0FBYTtnQkFDdEIsT0FBTyxFQUFFLENBQUM7d0JBQ1IsU0FBUyxFQUFFLGlCQUFpQjt3QkFDNUIsYUFBYSxFQUFFLHFCQUFxQjt3QkFDcEMsSUFBSSxFQUFFLGNBQWM7d0JBQ3BCLFVBQVUsRUFBRTs0QkFDVix1QkFBdUIsRUFBRSxHQUFHOzRCQUM1QixhQUFhLEVBQUUsZUFBZTs0QkFDOUIsUUFBUSxFQUFFLGFBQWE7NEJBQ3ZCLGdDQUFnQyxFQUFFLGVBQWU7eUJBQ2xEO3dCQUNELGlCQUFpQixFQUFFLEVBQUU7d0JBQ3JCLFNBQVMsRUFBRSxVQUFVO3dCQUNyQixXQUFXLEVBQUUsU0FBUzt3QkFDdEIsY0FBYyxFQUFFLCtDQUErQzt3QkFDL0QsU0FBUyxFQUFFLFdBQVc7cUJBQ3ZCLENBQUM7YUFDSCxDQUFDO1lBRUYsTUFBTSxNQUFNLENBQUMsSUFBQSxrQ0FBTyxFQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUM5RCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBoYW5kbGVyIH0gZnJvbSAnLi4vbGFtYmRhL2NvbnRlbnQtZ2VuZXJhdGlvbi1hZ2VudCc7XHJcbmltcG9ydCB7IFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IG1vY2tDbGllbnQgfSBmcm9tICdhd3Mtc2RrLWNsaWVudC1tb2NrJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQsIEdldEl0ZW1Db21tYW5kLCBVcGRhdGVJdGVtQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50LCBQdXRFdmVudHNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJztcclxuaW1wb3J0IHsgU1FTQ2xpZW50LCBTZW5kTWVzc2FnZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc3FzJztcclxuXHJcbi8vIE1vY2sgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vTW9jayA9IG1vY2tDbGllbnQoRHluYW1vREJDbGllbnQpO1xyXG5jb25zdCBldmVudEJyaWRnZU1vY2sgPSBtb2NrQ2xpZW50KEV2ZW50QnJpZGdlQ2xpZW50KTtcclxuY29uc3Qgc3FzTW9jayA9IG1vY2tDbGllbnQoU1FTQ2xpZW50KTtcclxuXHJcbi8vIE1vY2sgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbnByb2Nlc3MuZW52LlVTRVJfVEFCTEVfTkFNRSA9ICd0ZXN0LXVzZXJzJztcclxucHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FID0gJ3Rlc3QtY29udGVudCc7XHJcbnByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FID0gJ3Rlc3QtZXZlbnRzJztcclxucHJvY2Vzcy5lbnYuT1JDSEVTVFJBVE9SX1FVRVVFX1VSTCA9ICdodHRwczovL3Nxcy51cy1lYXN0LTEuYW1hem9uYXdzLmNvbS8xMjM0NTY3ODkwMTIvdGVzdC1vcmNoZXN0cmF0b3InO1xyXG5wcm9jZXNzLmVudi5BV1NfUkVHSU9OID0gJ3VzLWVhc3QtMSc7XHJcblxyXG5kZXNjcmliZSgnQ29udGVudCBHZW5lcmF0aW9uIEFnZW50JywgKCkgPT4ge1xyXG4gIGNvbnN0IG1vY2tDb250ZXh0OiBDb250ZXh0ID0ge1xyXG4gICAgY2FsbGJhY2tXYWl0c0ZvckVtcHR5RXZlbnRMb29wOiBmYWxzZSxcclxuICAgIGZ1bmN0aW9uTmFtZTogJ3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgZnVuY3Rpb25WZXJzaW9uOiAnMScsXHJcbiAgICBpbnZva2VkRnVuY3Rpb25Bcm46ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmZ1bmN0aW9uOnRlc3QtZnVuY3Rpb24nLFxyXG4gICAgbWVtb3J5TGltaXRJbk1COiAnMjU2JyxcclxuICAgIGF3c1JlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS90ZXN0LWZ1bmN0aW9uJyxcclxuICAgIGxvZ1N0cmVhbU5hbWU6ICcyMDIzLzAxLzAxL1skTEFURVNUXXRlc3Qtc3RyZWFtJyxcclxuICAgIGdldFJlbWFpbmluZ1RpbWVJbk1pbGxpczogKCkgPT4gMzAwMDAsXHJcbiAgICBkb25lOiAoKSA9PiB7fSxcclxuICAgIGZhaWw6ICgpID0+IHt9LFxyXG4gICAgc3VjY2VlZDogKCkgPT4ge30sXHJcbiAgfTtcclxuXHJcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XHJcbiAgICBkeW5hbW9Nb2NrLnJlc2V0KCk7XHJcbiAgICBldmVudEJyaWRnZU1vY2sucmVzZXQoKTtcclxuICAgIHNxc01vY2sucmVzZXQoKTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0NvbnRlbnQgR2VuZXJhdGlvbiBSZXF1ZXN0JywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBzdWNjZXNzZnVsbHkgZ2VuZXJhdGUgY29udGVudCBmcm9tIHRyYW5zY3JpcHRpb24nLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIE1vY2sgdXNlciBwcmVmZXJlbmNlc1xyXG4gICAgICBkeW5hbW9Nb2NrLm9uKEdldEl0ZW1Db21tYW5kKS5yZXNvbHZlcyh7XHJcbiAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgaWQ6IHsgUzogJ3VzZXItMTIzJyB9LFxyXG4gICAgICAgICAgd3JpdGluZ1N0eWxlQ29udGV4dDogeyBTOiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIHRvbmU6ICdjb252ZXJzYXRpb25hbCcsXHJcbiAgICAgICAgICAgIGxlbmd0aDogJ21lZGl1bScsXHJcbiAgICAgICAgICAgIHRhcmdldEF1ZGllbmNlOiAnZ2VuZXJhbCBhdWRpZW5jZScsXHJcbiAgICAgICAgICAgIHdyaXRpbmdTdHlsZTogJ2NsZWFyIGFuZCBlbmdhZ2luZydcclxuICAgICAgICAgIH0pIH1cclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBzdWNjZXNzZnVsIFNRUyBzZW5kXHJcbiAgICAgIHNxc01vY2sub24oU2VuZE1lc3NhZ2VDb21tYW5kKS5yZXNvbHZlcyh7XHJcbiAgICAgICAgTWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJ1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCBFdmVudEJyaWRnZSBwdWJsaXNoXHJcbiAgICAgIGV2ZW50QnJpZGdlTW9jay5vbihQdXRFdmVudHNDb21tYW5kKS5yZXNvbHZlcyh7XHJcbiAgICAgICAgRmFpbGVkRW50cnlDb3VudDogMCxcclxuICAgICAgICBFbnRyaWVzOiBbeyBFdmVudElkOiAndGVzdC1ldmVudC1pZCcgfV1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBldmVudDogU1FTRXZlbnQgPSB7XHJcbiAgICAgICAgUmVjb3JkczogW3tcclxuICAgICAgICAgIG1lc3NhZ2VJZDogJ3Rlc3QtbWVzc2FnZS1pZCcsXHJcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAndGVzdC1yZWNlaXB0LWhhbmRsZScsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VJZDogJ21zZy0xMjMnLFxyXG4gICAgICAgICAgICB3b3JrZmxvd0lkOiAnd29ya2Zsb3ctMTIzJyxcclxuICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgYWdlbnRUeXBlOiAnY29udGVudC1nZW5lcmF0b3InLFxyXG4gICAgICAgICAgICBtZXNzYWdlVHlwZTogJ3JlcXVlc3QnLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgICBpbnB1dDogJ0kgd2FudCB0byB3cml0ZSBhYm91dCB0aGUgaW1wb3J0YW5jZSBvZiBkYWlseSBleGVyY2lzZSBhbmQgaG93IGl0IGNhbiBpbXByb3ZlIG1lbnRhbCBoZWFsdGguJyxcclxuICAgICAgICAgICAgICB1c2VySWQ6ICd1c2VyLTEyMycsXHJcbiAgICAgICAgICAgICAgY29udGV4dDoge1xyXG4gICAgICAgICAgICAgICAgcHJldmlvdXNTdGVwczogW10sXHJcbiAgICAgICAgICAgICAgICB1c2VyUHJlZmVyZW5jZXM6IHt9XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXHJcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJyxcclxuICAgICAgICAgICAgU2VuZGVySWQ6ICd0ZXN0LXNlbmRlcicsXHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCdcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXHJcbiAgICAgICAgICBtZDVPZkJvZHk6ICd0ZXN0LW1kNScsXHJcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxyXG4gICAgICAgICAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJ1xyXG4gICAgICAgIH1dXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBhd2FpdCBleHBlY3QoaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpKS5yZXNvbHZlcy5ub3QudG9UaHJvdygpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IHVzZXIgcHJlZmVyZW5jZXMgd2VyZSBsb2FkZWRcclxuICAgICAgZXhwZWN0KGR5bmFtb01vY2suY29tbWFuZENhbGxzKEdldEl0ZW1Db21tYW5kKSkudG9IYXZlTGVuZ3RoKDEpO1xyXG4gICAgICBleHBlY3QoZHluYW1vTW9jay5jb21tYW5kQ2FsbHMoR2V0SXRlbUNvbW1hbmQpWzBdLmFyZ3NbMF0uaW5wdXQpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogJ3Rlc3QtdXNlcnMnLFxyXG4gICAgICAgIEtleTogeyBpZDogeyBTOiAndXNlci0xMjMnIH0gfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSByZXNwb25zZSB3YXMgc2VudCB0byBvcmNoZXN0cmF0b3JcclxuICAgICAgZXhwZWN0KHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgxKTtcclxuICAgICAgY29uc3Qgc3FzQ2FsbCA9IHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZClbMF0uYXJnc1swXS5pbnB1dDtcclxuICAgICAgZXhwZWN0KHNxc0NhbGwuUXVldWVVcmwpLnRvQmUoJ2h0dHBzOi8vc3FzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tLzEyMzQ1Njc4OTAxMi90ZXN0LW9yY2hlc3RyYXRvcicpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgbWVzc2FnZUJvZHkgPSBKU09OLnBhcnNlKHNxc0NhbGwuTWVzc2FnZUJvZHkhKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5Lm1lc3NhZ2VUeXBlKS50b0JlKCdyZXNwb25zZScpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5zdWNjZXNzKS50b0JlKHRydWUpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5jb250ZW50KS50b0JlRGVmaW5lZCgpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IGV2ZW50IHdhcyBwdWJsaXNoZWRcclxuICAgICAgZXhwZWN0KGV2ZW50QnJpZGdlTW9jay5jb21tYW5kQ2FsbHMoUHV0RXZlbnRzQ29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgxKTtcclxuICAgICAgY29uc3QgZXZlbnRDYWxsID0gZXZlbnRCcmlkZ2VNb2NrLmNvbW1hbmRDYWxscyhQdXRFdmVudHNDb21tYW5kKVswXS5hcmdzWzBdLmlucHV0O1xyXG4gICAgICBleHBlY3QoZXZlbnRDYWxsLkVudHJpZXMhWzBdLlNvdXJjZSkudG9CZSgnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmNvbnRlbnQtYWdlbnQnKTtcclxuICAgICAgZXhwZWN0KGV2ZW50Q2FsbC5FbnRyaWVzIVswXS5EZXRhaWxUeXBlKS50b0JlKCdDb250ZW50IEdlbmVyYXRpb24gQ29tcGxldGVkJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtaXNzaW5nIHVzZXIgcHJlZmVyZW5jZXMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gTW9jayB1c2VyIG5vdCBmb3VuZFxyXG4gICAgICBkeW5hbW9Nb2NrLm9uKEdldEl0ZW1Db21tYW5kKS5yZXNvbHZlcyh7fSk7XHJcblxyXG4gICAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgU1FTIHNlbmRcclxuICAgICAgc3FzTW9jay5vbihTZW5kTWVzc2FnZUNvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBNZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBzdWNjZXNzZnVsIEV2ZW50QnJpZGdlIHB1Ymxpc2hcclxuICAgICAgZXZlbnRCcmlkZ2VNb2NrLm9uKFB1dEV2ZW50c0NvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBGYWlsZWRFbnRyeUNvdW50OiAwLFxyXG4gICAgICAgIEVudHJpZXM6IFt7IEV2ZW50SWQ6ICd0ZXN0LWV2ZW50LWlkJyB9XVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBTUVNFdmVudCA9IHtcclxuICAgICAgICBSZWNvcmRzOiBbe1xyXG4gICAgICAgICAgbWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJyxcclxuICAgICAgICAgIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQtaGFuZGxlJyxcclxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgbWVzc2FnZVR5cGU6ICdyZXF1ZXN0JyxcclxuICAgICAgICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgICAgICAgIHdvcmtmbG93SWQ6ICd3b3JrZmxvdy0xMjMnLFxyXG4gICAgICAgICAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgaW5wdXQ6ICdUZXN0IHRyYW5zY3JpcHRpb24nLFxyXG4gICAgICAgICAgICAgIHVzZXJJZDogJ25vbmV4aXN0ZW50LXVzZXInLFxyXG4gICAgICAgICAgICAgIGNvbnRleHQ6IHsgcHJldmlvdXNTdGVwczogW10sIHVzZXJQcmVmZXJlbmNlczoge30gfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcclxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnLFxyXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXHJcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCkpLnJlc29sdmVzLm5vdC50b1Rocm93KCk7XHJcblxyXG4gICAgICAvLyBTaG91bGQgc3RpbGwgZ2VuZXJhdGUgY29udGVudCB3aXRoIGRlZmF1bHQgcHJlZmVyZW5jZXNcclxuICAgICAgZXhwZWN0KHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgxKTtcclxuICAgICAgY29uc3QgbWVzc2FnZUJvZHkgPSBKU09OLnBhcnNlKHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZClbMF0uYXJnc1swXS5pbnB1dC5NZXNzYWdlQm9keSEpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5zdWNjZXNzKS50b0JlKHRydWUpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29udGVudCBnZW5lcmF0aW9uIGVycm9ycycsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gTW9jayB1c2VyIHByZWZlcmVuY2VzXHJcbiAgICAgIGR5bmFtb01vY2sub24oR2V0SXRlbUNvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBJdGVtOiB7XHJcbiAgICAgICAgICBpZDogeyBTOiAndXNlci0xMjMnIH0sXHJcbiAgICAgICAgICB3cml0aW5nU3R5bGVDb250ZXh0OiB7IFM6IEpTT04uc3RyaW5naWZ5KHt9KSB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgU1FTIGVycm9yXHJcbiAgICAgIHNxc01vY2sub24oU2VuZE1lc3NhZ2VDb21tYW5kKS5yZWplY3RzKG5ldyBFcnJvcignU1FTIGVycm9yJykpO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgICBtZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnLFxyXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdC1oYW5kbGUnLFxyXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICBtZXNzYWdlVHlwZTogJ3JlcXVlc3QnLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgICBpbnB1dDogJycsIC8vIEVtcHR5IGlucHV0IHNob3VsZCBjYXVzZSB2YWxpZGF0aW9uIGVycm9yXHJcbiAgICAgICAgICAgICAgdXNlcklkOiAndXNlci0xMjMnLFxyXG4gICAgICAgICAgICAgIGNvbnRleHQ6IHsgcHJldmlvdXNTdGVwczogW10sIHVzZXJQcmVmZXJlbmNlczoge30gfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcclxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnLFxyXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXHJcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCkpLnJlamVjdHMudG9UaHJvdygpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdDb250ZW50IFJldmlzaW9uIFJlcXVlc3QnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHN1Y2Nlc3NmdWxseSByZXZpc2UgY29udGVudCBiYXNlZCBvbiBmZWVkYmFjaycsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gTW9jayB1c2VyIHByZWZlcmVuY2VzXHJcbiAgICAgIGR5bmFtb01vY2sub24oR2V0SXRlbUNvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBJdGVtOiB7XHJcbiAgICAgICAgICBpZDogeyBTOiAndXNlci0xMjMnIH0sXHJcbiAgICAgICAgICB3cml0aW5nU3R5bGVDb250ZXh0OiB7IFM6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgdG9uZTogJ3Byb2Zlc3Npb25hbCcsXHJcbiAgICAgICAgICAgIGxlbmd0aDogJ2xvbmcnLFxyXG4gICAgICAgICAgICB0YXJnZXRBdWRpZW5jZTogJ2J1c2luZXNzIHByb2Zlc3Npb25hbHMnXHJcbiAgICAgICAgICB9KSB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCBTUVMgc2VuZFxyXG4gICAgICBzcXNNb2NrLm9uKFNlbmRNZXNzYWdlQ29tbWFuZCkucmVzb2x2ZXMoe1xyXG4gICAgICAgIE1lc3NhZ2VJZDogJ3Rlc3QtbWVzc2FnZS1pZCdcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBldmVudDogU1FTRXZlbnQgPSB7XHJcbiAgICAgICAgUmVjb3JkczogW3tcclxuICAgICAgICAgIG1lc3NhZ2VJZDogJ3Rlc3QtbWVzc2FnZS1pZCcsXHJcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAndGVzdC1yZWNlaXB0LWhhbmRsZScsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VUeXBlOiAncmV2aXNpb24nLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1yZXZpc2lvbicsXHJcbiAgICAgICAgICAgICAgY3VycmVudENvbnRlbnQ6ICdUaGlzIGlzIHRoZSBjdXJyZW50IGJsb2cgcG9zdCBjb250ZW50IHRoYXQgbmVlZHMgcmV2aXNpb24uJyxcclxuICAgICAgICAgICAgICBmZWVkYmFjazogJ1BsZWFzZSBtYWtlIGl0IG1vcmUgZW5nYWdpbmcgYW5kIGFkZCBtb3JlIGV4YW1wbGVzLicsXHJcbiAgICAgICAgICAgICAgdXNlcklkOiAndXNlci0xMjMnLFxyXG4gICAgICAgICAgICAgIHJldmlzaW9uVHlwZTogJ3N0eWxlJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcclxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnLFxyXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXHJcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCkpLnJlc29sdmVzLm5vdC50b1Rocm93KCk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgcmVzcG9uc2Ugd2FzIHNlbnRcclxuICAgICAgZXhwZWN0KHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgxKTtcclxuICAgICAgY29uc3QgbWVzc2FnZUJvZHkgPSBKU09OLnBhcnNlKHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZClbMF0uYXJnc1swXS5pbnB1dC5NZXNzYWdlQm9keSEpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5zdWNjZXNzKS50b0JlKHRydWUpO1xyXG4gICAgICBleHBlY3QobWVzc2FnZUJvZHkucGF5bG9hZC5yZXZpc2lvblR5cGUpLnRvQmUoJ3N0eWxlJyk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlQm9keS5wYXlsb2FkLmNvbnRlbnQpLnRvQmVEZWZpbmVkKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBkaWZmZXJlbnQgcmV2aXNpb24gdHlwZXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIE1vY2sgdXNlciBwcmVmZXJlbmNlc1xyXG4gICAgICBkeW5hbW9Nb2NrLm9uKEdldEl0ZW1Db21tYW5kKS5yZXNvbHZlcyh7XHJcbiAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgaWQ6IHsgUzogJ3VzZXItMTIzJyB9LFxyXG4gICAgICAgICAgd3JpdGluZ1N0eWxlQ29udGV4dDogeyBTOiBKU09OLnN0cmluZ2lmeSh7fSkgfVxyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgU1FTIHNlbmRcclxuICAgICAgc3FzTW9jay5vbihTZW5kTWVzc2FnZUNvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBNZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmV2aXNpb25UeXBlcyA9IFsnY29udGVudCcsICdzdHlsZScsICdzdHJ1Y3R1cmUnLCAndG9uZSddO1xyXG5cclxuICAgICAgZm9yIChjb25zdCByZXZpc2lvblR5cGUgb2YgcmV2aXNpb25UeXBlcykge1xyXG4gICAgICAgIGNvbnN0IGV2ZW50OiBTUVNFdmVudCA9IHtcclxuICAgICAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VJZDogJ3Rlc3QtbWVzc2FnZS1pZCcsXHJcbiAgICAgICAgICAgIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQtaGFuZGxlJyxcclxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICAgIG1lc3NhZ2VUeXBlOiAncmV2aXNpb24nLFxyXG4gICAgICAgICAgICAgIHBheWxvYWQ6IHtcclxuICAgICAgICAgICAgICAgIHdvcmtmbG93SWQ6ICd3b3JrZmxvdy0xMjMnLFxyXG4gICAgICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1yZXZpc2lvbicsXHJcbiAgICAgICAgICAgICAgICBjdXJyZW50Q29udGVudDogJ1Rlc3QgY29udGVudCBmb3IgcmV2aXNpb24nLFxyXG4gICAgICAgICAgICAgICAgZmVlZGJhY2s6IGBQbGVhc2UgaW1wcm92ZSB0aGUgJHtyZXZpc2lvblR5cGV9YCxcclxuICAgICAgICAgICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJyxcclxuICAgICAgICAgICAgICAgIHJldmlzaW9uVHlwZVxyXG4gICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxyXG4gICAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJyxcclxuICAgICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgICAgbWQ1T2ZCb2R5OiAndGVzdC1tZDUnLFxyXG4gICAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxyXG4gICAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1xdWV1ZScsXHJcbiAgICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcclxuICAgICAgICAgIH1dXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgYXdhaXQgZXhwZWN0KGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KSkucmVzb2x2ZXMubm90LnRvVGhyb3coKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gU2hvdWxkIGhhdmUgcHJvY2Vzc2VkIGFsbCByZXZpc2lvbiB0eXBlc1xyXG4gICAgICBleHBlY3Qoc3FzTW9jay5jb21tYW5kQ2FsbHMoU2VuZE1lc3NhZ2VDb21tYW5kKSkudG9IYXZlTGVuZ3RoKHJldmlzaW9uVHlwZXMubGVuZ3RoKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnQ29udGVudCBWYWxpZGF0aW9uJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBjb250ZW50IHF1YWxpdHkgY29ycmVjdGx5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBUaGlzIHRlc3Qgd291bGQgYmUgbW9yZSBjb21wcmVoZW5zaXZlIGluIGEgcmVhbCBpbXBsZW1lbnRhdGlvblxyXG4gICAgICAvLyBGb3Igbm93LCB3ZSdsbCB0ZXN0IHRoZSBiYXNpYyBzdHJ1Y3R1cmVcclxuICAgICAgXHJcbiAgICAgIC8vIE1vY2sgdXNlciBwcmVmZXJlbmNlc1xyXG4gICAgICBkeW5hbW9Nb2NrLm9uKEdldEl0ZW1Db21tYW5kKS5yZXNvbHZlcyh7XHJcbiAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgaWQ6IHsgUzogJ3VzZXItMTIzJyB9LFxyXG4gICAgICAgICAgd3JpdGluZ1N0eWxlQ29udGV4dDogeyBTOiBKU09OLnN0cmluZ2lmeSh7fSkgfVxyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgU1FTIHNlbmRcclxuICAgICAgc3FzTW9jay5vbihTZW5kTWVzc2FnZUNvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBNZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBzdWNjZXNzZnVsIEV2ZW50QnJpZGdlIHB1Ymxpc2hcclxuICAgICAgZXZlbnRCcmlkZ2VNb2NrLm9uKFB1dEV2ZW50c0NvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBGYWlsZWRFbnRyeUNvdW50OiAwLFxyXG4gICAgICAgIEVudHJpZXM6IFt7IEV2ZW50SWQ6ICd0ZXN0LWV2ZW50LWlkJyB9XVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBTUVNFdmVudCA9IHtcclxuICAgICAgICBSZWNvcmRzOiBbe1xyXG4gICAgICAgICAgbWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJyxcclxuICAgICAgICAgIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQtaGFuZGxlJyxcclxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgbWVzc2FnZVR5cGU6ICdyZXF1ZXN0JyxcclxuICAgICAgICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgICAgICAgIHdvcmtmbG93SWQ6ICd3b3JrZmxvdy0xMjMnLFxyXG4gICAgICAgICAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgaW5wdXQ6ICdBIGNvbXByZWhlbnNpdmUgaW5wdXQgYWJvdXQgcHJvZHVjdGl2aXR5IGFuZCB0aW1lIG1hbmFnZW1lbnQgdGVjaG5pcXVlcyB0aGF0IHNob3VsZCBnZW5lcmF0ZSBxdWFsaXR5IGNvbnRlbnQuJyxcclxuICAgICAgICAgICAgICB1c2VySWQ6ICd1c2VyLTEyMycsXHJcbiAgICAgICAgICAgICAgY29udGV4dDogeyBwcmV2aW91c1N0ZXBzOiBbXSwgdXNlclByZWZlcmVuY2VzOiB7fSB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgYXR0cmlidXRlczoge1xyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxyXG4gICAgICAgICAgICBTZW50VGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCcsXHJcbiAgICAgICAgICAgIFNlbmRlcklkOiAndGVzdC1zZW5kZXInLFxyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxyXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAndGVzdC1tZDUnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcclxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcclxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcclxuICAgICAgICB9XVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgYXdhaXQgZXhwZWN0KGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KSkucmVzb2x2ZXMubm90LnRvVGhyb3coKTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSBjb250ZW50IHdhcyBnZW5lcmF0ZWQgYW5kIHZhbGlkYXRlZFxyXG4gICAgICBleHBlY3Qoc3FzTW9jay5jb21tYW5kQ2FsbHMoU2VuZE1lc3NhZ2VDb21tYW5kKSkudG9IYXZlTGVuZ3RoKDEpO1xyXG4gICAgICBjb25zdCBtZXNzYWdlQm9keSA9IEpTT04ucGFyc2Uoc3FzTW9jay5jb21tYW5kQ2FsbHMoU2VuZE1lc3NhZ2VDb21tYW5kKVswXS5hcmdzWzBdLmlucHV0Lk1lc3NhZ2VCb2R5ISk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlQm9keS5wYXlsb2FkLnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlQm9keS5wYXlsb2FkLmNvbnRlbnQucXVhbGl0eSkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2VCb2R5LnBheWxvYWQuY29udGVudC5xdWFsaXR5LnNjb3JlKS50b0JlR3JlYXRlclRoYW4oMCk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0Vycm9yIEhhbmRsaW5nJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdW5rbm93biBtZXNzYWdlIHR5cGVzIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBTUVNFdmVudCA9IHtcclxuICAgICAgICBSZWNvcmRzOiBbe1xyXG4gICAgICAgICAgbWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJyxcclxuICAgICAgICAgIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQtaGFuZGxlJyxcclxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgbWVzc2FnZVR5cGU6ICd1bmtub3duLXR5cGUnLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7fVxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB7XHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXHJcbiAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJyxcclxuICAgICAgICAgICAgU2VuZGVySWQ6ICd0ZXN0LXNlbmRlcicsXHJcbiAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCdcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXHJcbiAgICAgICAgICBtZDVPZkJvZHk6ICd0ZXN0LW1kNScsXHJcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxyXG4gICAgICAgICAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJ1xyXG4gICAgICAgIH1dXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBTaG91bGQgbm90IHRocm93IGJ1dCBzaG91bGQgbG9nIHdhcm5pbmdcclxuICAgICAgYXdhaXQgZXhwZWN0KGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KSkucmVzb2x2ZXMubm90LnRvVGhyb3coKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1hbGZvcm1lZCBTUVMgbWVzc2FnZXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBTUVNFdmVudCA9IHtcclxuICAgICAgICBSZWNvcmRzOiBbe1xyXG4gICAgICAgICAgbWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJyxcclxuICAgICAgICAgIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQtaGFuZGxlJyxcclxuICAgICAgICAgIGJvZHk6ICdpbnZhbGlkLWpzb24nLFxyXG4gICAgICAgICAgYXR0cmlidXRlczoge1xyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxyXG4gICAgICAgICAgICBTZW50VGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCcsXHJcbiAgICAgICAgICAgIFNlbmRlcklkOiAndGVzdC1zZW5kZXInLFxyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxyXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAndGVzdC1tZDUnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcclxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LXF1ZXVlJyxcclxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcclxuICAgICAgICB9XVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgYXdhaXQgZXhwZWN0KGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KSkucmVqZWN0cy50b1Rocm93KCk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19