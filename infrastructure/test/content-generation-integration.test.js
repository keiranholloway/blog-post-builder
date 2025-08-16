"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_handler_1 = require("../lambda/api-handler");
const content_orchestrator_1 = require("../lambda/content-orchestrator");
const content_generation_agent_1 = require("../lambda/content-generation-agent");
const aws_sdk_client_mock_1 = require("aws-sdk-client-mock");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const client_sqs_1 = require("@aws-sdk/client-sqs");
// Helper function to create API Gateway event
function createAPIGatewayEvent(method, path, body) {
    return {
        httpMethod: method,
        path,
        headers: { 'Content-Type': 'application/json' },
        body: body || null,
        queryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {
            accountId: '123456789012',
            apiId: 'test-api',
            httpMethod: method,
            path,
            stage: 'test',
            requestId: 'test-request',
            requestTime: '01/Jan/2023:00:00:00 +0000',
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
            resourcePath: path,
            authorizer: {}
        },
        resource: path,
        isBase64Encoded: false,
        multiValueHeaders: {},
        multiValueQueryStringParameters: null
    };
}
// Mock AWS clients
const dynamoMock = (0, aws_sdk_client_mock_1.mockClient)(client_dynamodb_1.DynamoDBClient);
const eventBridgeMock = (0, aws_sdk_client_mock_1.mockClient)(client_eventbridge_1.EventBridgeClient);
const sqsMock = (0, aws_sdk_client_mock_1.mockClient)(client_sqs_1.SQSClient);
// Mock environment variables
process.env.USER_TABLE_NAME = 'test-users';
process.env.CONTENT_TABLE_NAME = 'test-content';
process.env.AGENT_MESSAGES_TABLE_NAME = 'test-agent-messages';
process.env.EVENT_BUS_NAME = 'test-events';
process.env.CONTENT_GENERATION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-content-generation';
process.env.IMAGE_GENERATION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-image-generation';
process.env.ORCHESTRATOR_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-orchestrator';
process.env.AWS_REGION = 'us-east-1';
describe('Content Generation Integration Tests', () => {
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
    describe('End-to-End Content Generation Workflow', () => {
        it('should complete full content generation workflow', async () => {
            // Step 1: API receives content generation request
            const apiEvent = createAPIGatewayEvent('POST', '/api/content/generate', JSON.stringify({
                transcription: 'I want to write about the benefits of remote work and how it has changed the modern workplace.',
                userId: 'user-123',
                userContext: 'Technology blogger with focus on workplace trends',
                preferences: {
                    tone: 'professional',
                    length: 'medium',
                    targetAudience: 'business professionals'
                }
            }));
            // Mock successful DynamoDB put
            dynamoMock.on(client_dynamodb_1.PutItemCommand).resolves({});
            // Mock successful EventBridge publish
            eventBridgeMock.on(client_eventbridge_1.PutEventsCommand).resolves({
                FailedEntryCount: 0,
                Entries: [{ EventId: 'test-event-id' }]
            });
            const apiResponse = await (0, api_handler_1.handler)(apiEvent, mockContext);
            expect(apiResponse.statusCode).toBe(200);
            const apiResponseBody = JSON.parse(apiResponse.body);
            expect(apiResponseBody.data.contentId).toBeDefined();
            const contentId = apiResponseBody.data.contentId;
            // Step 2: Orchestrator receives EventBridge event and initiates workflow
            const orchestratorEvent = {
                version: '0',
                id: 'test-event-id',
                'detail-type': 'Content Generation Requested',
                source: 'automated-blog-poster.api',
                account: '123456789012',
                time: '2023-01-01T00:00:00Z',
                region: 'us-east-1',
                resources: [],
                detail: {
                    contentId,
                    userId: 'user-123',
                    transcription: 'I want to write about the benefits of remote work and how it has changed the modern workplace.',
                    userContext: 'Technology blogger with focus on workplace trends',
                    preferences: {
                        tone: 'professional',
                        length: 'medium',
                        targetAudience: 'business professionals'
                    },
                    timestamp: new Date().toISOString()
                }
            };
            // Mock workflow creation and agent message sending
            dynamoMock.on(client_dynamodb_1.PutItemCommand).resolves({});
            dynamoMock.on(client_dynamodb_1.UpdateItemCommand).resolves({});
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({ MessageId: 'test-message-id' });
            // This would normally be triggered by EventBridge, but we'll call directly for testing
            await (0, content_orchestrator_1.handler)(orchestratorEvent, mockContext);
            // Verify workflow was created and message sent to content generation queue
            expect(dynamoMock.commandCalls(client_dynamodb_1.PutItemCommand)).toHaveLength(3); // API content + workflow + agent message
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            // Step 3: Content generation agent processes the request
            const contentAgentEvent = {
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
                                input: 'I want to write about the benefits of remote work and how it has changed the modern workplace.',
                                userId: 'user-123',
                                context: {
                                    previousSteps: [],
                                    userPreferences: {
                                        tone: 'professional',
                                        length: 'medium',
                                        targetAudience: 'business professionals'
                                    }
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
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-content-generation',
                        awsRegion: 'us-east-1'
                    }]
            };
            // Mock user preferences lookup
            dynamoMock.on(client_dynamodb_1.GetItemCommand).resolves({
                Item: {
                    id: { S: 'user-123' },
                    writingStyleContext: { S: JSON.stringify({
                            tone: 'professional',
                            length: 'medium',
                            targetAudience: 'business professionals',
                            writingStyle: 'clear and authoritative'
                        }) }
                }
            });
            await (0, content_generation_agent_1.handler)(contentAgentEvent, mockContext);
            // Verify content was generated and response sent back
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(2); // orchestrator + agent response
            const agentResponseCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[1];
            const agentResponseBody = JSON.parse(agentResponseCall.args[0].input.MessageBody);
            expect(agentResponseBody.messageType).toBe('response');
            expect(agentResponseBody.payload.success).toBe(true);
            expect(agentResponseBody.payload.content).toBeDefined();
            expect(agentResponseBody.payload.content.title).toBeDefined();
            expect(agentResponseBody.payload.content.content).toBeDefined();
            expect(agentResponseBody.payload.content.wordCount).toBeGreaterThan(0);
            // Step 4: Verify API can retrieve the generated content
            const getContentEvent = createAPIGatewayEvent('GET', `/api/content/${contentId}`);
            // Mock content retrieval
            dynamoMock.on(client_dynamodb_1.GetItemCommand).resolves({
                Item: {
                    id: { S: contentId },
                    userId: { S: 'user-123' },
                    title: { S: 'The Future of Remote Work: Transforming the Modern Workplace' },
                    originalTranscription: { S: 'I want to write about the benefits of remote work and how it has changed the modern workplace.' },
                    currentDraft: { S: 'Generated blog post content...' },
                    status: { S: 'ready_for_review' },
                    createdAt: { S: new Date().toISOString() },
                    updatedAt: { S: new Date().toISOString() },
                    revisionHistory: { S: '[]' },
                    publishingResults: { S: '[]' }
                }
            });
            const getContentResponse = await (0, api_handler_1.handler)(getContentEvent, mockContext);
            expect(getContentResponse.statusCode).toBe(200);
            const contentResponseBody = JSON.parse(getContentResponse.body);
            expect(contentResponseBody.data.id).toBe(contentId);
            expect(contentResponseBody.data.title).toBeDefined();
            expect(contentResponseBody.data.currentDraft).toBeDefined();
            expect(contentResponseBody.data.status).toBe('ready_for_review');
        });
        it('should handle content revision workflow', async () => {
            const contentId = 'content-123';
            // Step 1: API receives revision request
            const revisionEvent = createAPIGatewayEvent('POST', '/api/content/revise', JSON.stringify({
                contentId,
                currentContent: 'This is the current blog post that needs improvement.',
                feedback: 'Please make it more engaging and add specific examples.',
                revisionType: 'style',
                userId: 'user-123'
            }));
            // Mock successful EventBridge publish
            eventBridgeMock.on(client_eventbridge_1.PutEventsCommand).resolves({
                FailedEntryCount: 0,
                Entries: [{ EventId: 'test-event-id' }]
            });
            const apiResponse = await (0, api_handler_1.handler)(revisionEvent, mockContext);
            expect(apiResponse.statusCode).toBe(200);
            const apiResponseBody = JSON.parse(apiResponse.body);
            expect(apiResponseBody.data.revisionId).toBeDefined();
            // Step 2: Content agent processes revision request
            const revisionAgentEvent = {
                Records: [{
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageType: 'revision',
                            payload: {
                                workflowId: 'workflow-123',
                                stepId: 'content-revision',
                                currentContent: 'This is the current blog post that needs improvement.',
                                feedback: 'Please make it more engaging and add specific examples.',
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
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-content-generation',
                        awsRegion: 'us-east-1'
                    }]
            };
            // Mock user preferences lookup
            dynamoMock.on(client_dynamodb_1.GetItemCommand).resolves({
                Item: {
                    id: { S: 'user-123' },
                    writingStyleContext: { S: JSON.stringify({
                            tone: 'conversational',
                            writingStyle: 'engaging and example-rich'
                        }) }
                }
            });
            // Mock successful SQS send
            sqsMock.on(client_sqs_1.SendMessageCommand).resolves({
                MessageId: 'test-message-id'
            });
            await (0, content_generation_agent_1.handler)(revisionAgentEvent, mockContext);
            // Verify revision was processed
            expect(sqsMock.commandCalls(client_sqs_1.SendMessageCommand)).toHaveLength(1);
            const revisionResponseCall = sqsMock.commandCalls(client_sqs_1.SendMessageCommand)[0];
            const revisionResponseBody = JSON.parse(revisionResponseCall.args[0].input.MessageBody);
            expect(revisionResponseBody.messageType).toBe('response');
            expect(revisionResponseBody.payload.success).toBe(true);
            expect(revisionResponseBody.payload.revisionType).toBe('style');
            expect(revisionResponseBody.payload.content).toBeDefined();
        });
    });
    describe('Content Validation Integration', () => {
        it('should validate content through API endpoint', async () => {
            const validationEvent = createAPIGatewayEvent('POST', '/api/content/validate', JSON.stringify({
                content: 'This is a comprehensive blog post about productivity techniques. It includes multiple paragraphs with detailed explanations and practical examples. The content is well-structured with clear headings and provides valuable insights for readers interested in improving their productivity.'
            }));
            const response = await (0, api_handler_1.handler)(validationEvent, mockContext);
            expect(response.statusCode).toBe(200);
            const responseBody = JSON.parse(response.body);
            expect(responseBody.data.isValid).toBe(true);
            expect(responseBody.data.score).toBeGreaterThan(7);
            expect(responseBody.data.issues).toEqual([]);
            expect(responseBody.data.suggestions).toBeDefined();
        });
        it('should identify content quality issues', async () => {
            const validationEvent = createAPIGatewayEvent('POST', '/api/content/validate', JSON.stringify({
                content: 'Short content' // Too short, no proper ending
            }));
            const response = await (0, api_handler_1.handler)(validationEvent, mockContext);
            expect(response.statusCode).toBe(200);
            const responseBody = JSON.parse(response.body);
            expect(responseBody.data.isValid).toBe(false);
            expect(responseBody.data.score).toBeLessThan(7);
            expect(responseBody.data.issues.length).toBeGreaterThan(0);
        });
    });
    describe('Error Handling Integration', () => {
        it('should handle API errors gracefully', async () => {
            const invalidEvent = createAPIGatewayEvent('POST', '/api/content/generate', JSON.stringify({
                // Missing required fields
                transcription: '',
                userId: ''
            }));
            const response = await (0, api_handler_1.handler)(invalidEvent, mockContext);
            expect(response.statusCode).toBe(400);
            const responseBody = JSON.parse(response.body);
            expect(responseBody.error).toBe('Bad Request');
            expect(responseBody.message).toContain('required');
        });
        it('should handle DynamoDB errors', async () => {
            const apiEvent = createAPIGatewayEvent('POST', '/api/content/generate', JSON.stringify({
                transcription: 'Valid transcription',
                userId: 'user-123'
            }));
            // Mock DynamoDB error
            dynamoMock.on(client_dynamodb_1.PutItemCommand).rejects(new Error('DynamoDB error'));
            const response = await (0, api_handler_1.handler)(apiEvent, mockContext);
            expect(response.statusCode).toBe(500);
            const responseBody = JSON.parse(response.body);
            expect(responseBody.error).toBe('Internal Server Error');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1nZW5lcmF0aW9uLWludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250ZW50LWdlbmVyYXRpb24taW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHVEQUE4RDtBQUM5RCx5RUFBZ0Y7QUFDaEYsaUZBQW9GO0FBRXBGLDZEQUFpRDtBQUNqRCw4REFBMkg7QUFDM0gsb0VBQWtGO0FBQ2xGLG9EQUFvRTtBQUVwRSw4Q0FBOEM7QUFDOUMsU0FBUyxxQkFBcUIsQ0FDNUIsTUFBYyxFQUNkLElBQVksRUFDWixJQUFhO0lBRWIsT0FBTztRQUNMLFVBQVUsRUFBRSxNQUFNO1FBQ2xCLElBQUk7UUFDSixPQUFPLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUU7UUFDL0MsSUFBSSxFQUFFLElBQUksSUFBSSxJQUFJO1FBQ2xCLHFCQUFxQixFQUFFLElBQUk7UUFDM0IsY0FBYyxFQUFFLElBQUk7UUFDcEIsY0FBYyxFQUFFLElBQUk7UUFDcEIsY0FBYyxFQUFFO1lBQ2QsU0FBUyxFQUFFLGNBQWM7WUFDekIsS0FBSyxFQUFFLFVBQVU7WUFDakIsVUFBVSxFQUFFLE1BQU07WUFDbEIsSUFBSTtZQUNKLEtBQUssRUFBRSxNQUFNO1lBQ2IsU0FBUyxFQUFFLGNBQWM7WUFDekIsV0FBVyxFQUFFLDRCQUE0QjtZQUN6QyxnQkFBZ0IsRUFBRSxhQUFhO1lBQy9CLFFBQVEsRUFBRTtnQkFDUixxQkFBcUIsRUFBRSxJQUFJO2dCQUMzQixTQUFTLEVBQUUsSUFBSTtnQkFDZixpQkFBaUIsRUFBRSxJQUFJO2dCQUN2QixNQUFNLEVBQUUsSUFBSTtnQkFDWixRQUFRLEVBQUUsV0FBVztnQkFDckIsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLFNBQVMsRUFBRSxJQUFJO2dCQUNmLHlCQUF5QixFQUFFLElBQUk7Z0JBQy9CLDZCQUE2QixFQUFFLElBQUk7Z0JBQ25DLE9BQU8sRUFBRSxJQUFJ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cEMsTUFBTSxFQUFFLFVBQVU7YUFDbkIsQ0FBQyxDQUNILENBQUM7WUFFRixzQkFBc0I7WUFDdEIsVUFBVSxDQUFDLEVBQUUsQ0FBQyxnQ0FBYyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQztZQUVuRSxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUEscUJBQVUsRUFBQyxRQUFRLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFekQsTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDdEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDL0MsTUFBTSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsdUJBQXVCLENBQUMsQ0FBQztRQUMzRCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBoYW5kbGVyIGFzIGFwaUhhbmRsZXIgfSBmcm9tICcuLi9sYW1iZGEvYXBpLWhhbmRsZXInO1xyXG5pbXBvcnQgeyBoYW5kbGVyIGFzIG9yY2hlc3RyYXRvckhhbmRsZXIgfSBmcm9tICcuLi9sYW1iZGEvY29udGVudC1vcmNoZXN0cmF0b3InO1xyXG5pbXBvcnQgeyBoYW5kbGVyIGFzIGNvbnRlbnRBZ2VudEhhbmRsZXIgfSBmcm9tICcuLi9sYW1iZGEvY29udGVudC1nZW5lcmF0aW9uLWFnZW50JztcclxuaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIENvbnRleHQsIFNRU0V2ZW50LCBFdmVudEJyaWRnZUV2ZW50IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IG1vY2tDbGllbnQgfSBmcm9tICdhd3Mtc2RrLWNsaWVudC1tb2NrJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQsIFB1dEl0ZW1Db21tYW5kLCBHZXRJdGVtQ29tbWFuZCwgVXBkYXRlSXRlbUNvbW1hbmQsIFF1ZXJ5Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50LCBQdXRFdmVudHNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJztcclxuaW1wb3J0IHsgU1FTQ2xpZW50LCBTZW5kTWVzc2FnZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc3FzJztcclxuXHJcbi8vIEhlbHBlciBmdW5jdGlvbiB0byBjcmVhdGUgQVBJIEdhdGV3YXkgZXZlbnRcclxuZnVuY3Rpb24gY3JlYXRlQVBJR2F0ZXdheUV2ZW50KFxyXG4gIG1ldGhvZDogc3RyaW5nLFxyXG4gIHBhdGg6IHN0cmluZyxcclxuICBib2R5Pzogc3RyaW5nXHJcbik6IEFQSUdhdGV3YXlQcm94eUV2ZW50IHtcclxuICByZXR1cm4ge1xyXG4gICAgaHR0cE1ldGhvZDogbWV0aG9kLFxyXG4gICAgcGF0aCxcclxuICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgYm9keTogYm9keSB8fCBudWxsLFxyXG4gICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgIHJlcXVlc3RDb250ZXh0OiB7XHJcbiAgICAgIGFjY291bnRJZDogJzEyMzQ1Njc4OTAxMicsXHJcbiAgICAgIGFwaUlkOiAndGVzdC1hcGknLFxyXG4gICAgICBodHRwTWV0aG9kOiBtZXRob2QsXHJcbiAgICAgIHBhdGgsXHJcbiAgICAgIHN0YWdlOiAndGVzdCcsXHJcbiAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdCcsXHJcbiAgICAgIHJlcXVlc3RUaW1lOiAnMDEvSmFuLzIwMjM6MDA6MDA6MDAgKzAwMDAnLFxyXG4gICAgICByZXF1ZXN0VGltZUVwb2NoOiAxNjcyNTMxMjAwMDAwLFxyXG4gICAgICBpZGVudGl0eToge1xyXG4gICAgICAgIGNvZ25pdG9JZGVudGl0eVBvb2xJZDogbnVsbCxcclxuICAgICAgICBhY2NvdW50SWQ6IG51bGwsXHJcbiAgICAgICAgY29nbml0b0lkZW50aXR5SWQ6IG51bGwsXHJcbiAgICAgICAgY2FsbGVyOiBudWxsLFxyXG4gICAgICAgIHNvdXJjZUlwOiAnMTI3LjAuMC4xJyxcclxuICAgICAgICBwcmluY2lwYWxPcmdJZDogbnVsbCxcclxuICAgICAgICBhY2Nlc3NLZXk6IG51bGwsXHJcbiAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZTogbnVsbCxcclxuICAgICAgICBjb2duaXRvQXV0aGVudGljYXRpb25Qcm92aWRlcjogbnVsbCxcclxuICAgICAgICB1c2VyQXJuOiBudWxsLFxyXG4gICAgICAgIHVzZXJBZ2VudDogJ3Rlc3QtYWdlbnQnLFxyXG4gICAgICAgIHVzZXI6IG51bGwsXHJcbiAgICAgICAgYXBpS2V5OiBudWxsLFxyXG4gICAgICAgIGFwaUtleUlkOiBudWxsLFxyXG4gICAgICAgIGNsaWVudENlcnQ6IG51bGxcclxuICAgICAgfSxcclxuICAgICAgcHJvdG9jb2w6ICdIVFRQLzEuMScsXHJcbiAgICAgIHJlc291cmNlSWQ6ICd0ZXN0LXJlc291cmNlJyxcclxuICAgICAgcmVzb3VyY2VQYXRoOiBwYXRoLFxyXG4gICAgICBhdXRob3JpemVyOiB7fVxyXG4gICAgfSBhcyBhbnksXHJcbiAgICByZXNvdXJjZTogcGF0aCxcclxuICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsXHJcbiAgfTtcclxufVxyXG5cclxuLy8gTW9jayBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9Nb2NrID0gbW9ja0NsaWVudChEeW5hbW9EQkNsaWVudCk7XHJcbmNvbnN0IGV2ZW50QnJpZGdlTW9jayA9IG1vY2tDbGllbnQoRXZlbnRCcmlkZ2VDbGllbnQpO1xyXG5jb25zdCBzcXNNb2NrID0gbW9ja0NsaWVudChTUVNDbGllbnQpO1xyXG5cclxuLy8gTW9jayBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxucHJvY2Vzcy5lbnYuVVNFUl9UQUJMRV9OQU1FID0gJ3Rlc3QtdXNlcnMnO1xyXG5wcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUgPSAndGVzdC1jb250ZW50JztcclxucHJvY2Vzcy5lbnYuQUdFTlRfTUVTU0FHRVNfVEFCTEVfTkFNRSA9ICd0ZXN0LWFnZW50LW1lc3NhZ2VzJztcclxucHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUgPSAndGVzdC1ldmVudHMnO1xyXG5wcm9jZXNzLmVudi5DT05URU5UX0dFTkVSQVRJT05fUVVFVUVfVVJMID0gJ2h0dHBzOi8vc3FzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tLzEyMzQ1Njc4OTAxMi90ZXN0LWNvbnRlbnQtZ2VuZXJhdGlvbic7XHJcbnByb2Nlc3MuZW52LklNQUdFX0dFTkVSQVRJT05fUVVFVUVfVVJMID0gJ2h0dHBzOi8vc3FzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tLzEyMzQ1Njc4OTAxMi90ZXN0LWltYWdlLWdlbmVyYXRpb24nO1xyXG5wcm9jZXNzLmVudi5PUkNIRVNUUkFUT1JfUVVFVUVfVVJMID0gJ2h0dHBzOi8vc3FzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tLzEyMzQ1Njc4OTAxMi90ZXN0LW9yY2hlc3RyYXRvcic7XHJcbnByb2Nlc3MuZW52LkFXU19SRUdJT04gPSAndXMtZWFzdC0xJztcclxuXHJcbmRlc2NyaWJlKCdDb250ZW50IEdlbmVyYXRpb24gSW50ZWdyYXRpb24gVGVzdHMnLCAoKSA9PiB7XHJcbiAgY29uc3QgbW9ja0NvbnRleHQ6IENvbnRleHQgPSB7XHJcbiAgICBjYWxsYmFja1dhaXRzRm9yRW1wdHlFdmVudExvb3A6IGZhbHNlLFxyXG4gICAgZnVuY3Rpb25OYW1lOiAndGVzdC1mdW5jdGlvbicsXHJcbiAgICBmdW5jdGlvblZlcnNpb246ICcxJyxcclxuICAgIGludm9rZWRGdW5jdGlvbkFybjogJ2Fybjphd3M6bGFtYmRhOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6ZnVuY3Rpb246dGVzdC1mdW5jdGlvbicsXHJcbiAgICBtZW1vcnlMaW1pdEluTUI6ICcyNTYnLFxyXG4gICAgYXdzUmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJyxcclxuICAgIGxvZ0dyb3VwTmFtZTogJy9hd3MvbGFtYmRhL3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgbG9nU3RyZWFtTmFtZTogJzIwMjMvMDEvMDEvWyRMQVRFU1RddGVzdC1zdHJlYW0nLFxyXG4gICAgZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzOiAoKSA9PiAzMDAwMCxcclxuICAgIGRvbmU6ICgpID0+IHt9LFxyXG4gICAgZmFpbDogKCkgPT4ge30sXHJcbiAgICBzdWNjZWVkOiAoKSA9PiB7fSxcclxuICB9O1xyXG5cclxuICBiZWZvcmVFYWNoKCgpID0+IHtcclxuICAgIGR5bmFtb01vY2sucmVzZXQoKTtcclxuICAgIGV2ZW50QnJpZGdlTW9jay5yZXNldCgpO1xyXG4gICAgc3FzTW9jay5yZXNldCgpO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnRW5kLXRvLUVuZCBDb250ZW50IEdlbmVyYXRpb24gV29ya2Zsb3cnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGNvbXBsZXRlIGZ1bGwgY29udGVudCBnZW5lcmF0aW9uIHdvcmtmbG93JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBTdGVwIDE6IEFQSSByZWNlaXZlcyBjb250ZW50IGdlbmVyYXRpb24gcmVxdWVzdFxyXG4gICAgICBjb25zdCBhcGlFdmVudCA9IGNyZWF0ZUFQSUdhdGV3YXlFdmVudChcclxuICAgICAgICAnUE9TVCcsXHJcbiAgICAgICAgJy9hcGkvY29udGVudC9nZW5lcmF0ZScsXHJcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbjogJ0kgd2FudCB0byB3cml0ZSBhYm91dCB0aGUgYmVuZWZpdHMgb2YgcmVtb3RlIHdvcmsgYW5kIGhvdyBpdCBoYXMgY2hhbmdlZCB0aGUgbW9kZXJuIHdvcmtwbGFjZS4nLFxyXG4gICAgICAgICAgdXNlcklkOiAndXNlci0xMjMnLFxyXG4gICAgICAgICAgdXNlckNvbnRleHQ6ICdUZWNobm9sb2d5IGJsb2dnZXIgd2l0aCBmb2N1cyBvbiB3b3JrcGxhY2UgdHJlbmRzJyxcclxuICAgICAgICAgIHByZWZlcmVuY2VzOiB7XHJcbiAgICAgICAgICAgIHRvbmU6ICdwcm9mZXNzaW9uYWwnLFxyXG4gICAgICAgICAgICBsZW5ndGg6ICdtZWRpdW0nLFxyXG4gICAgICAgICAgICB0YXJnZXRBdWRpZW5jZTogJ2J1c2luZXNzIHByb2Zlc3Npb25hbHMnXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCBEeW5hbW9EQiBwdXRcclxuICAgICAgZHluYW1vTW9jay5vbihQdXRJdGVtQ29tbWFuZCkucmVzb2x2ZXMoe30pO1xyXG4gICAgICBcclxuICAgICAgLy8gTW9jayBzdWNjZXNzZnVsIEV2ZW50QnJpZGdlIHB1Ymxpc2hcclxuICAgICAgZXZlbnRCcmlkZ2VNb2NrLm9uKFB1dEV2ZW50c0NvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBGYWlsZWRFbnRyeUNvdW50OiAwLFxyXG4gICAgICAgIEVudHJpZXM6IFt7IEV2ZW50SWQ6ICd0ZXN0LWV2ZW50LWlkJyB9XVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGFwaVJlc3BvbnNlID0gYXdhaXQgYXBpSGFuZGxlcihhcGlFdmVudCwgbW9ja0NvbnRleHQpO1xyXG4gICAgICBcclxuICAgICAgZXhwZWN0KGFwaVJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgY29uc3QgYXBpUmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShhcGlSZXNwb25zZS5ib2R5KTtcclxuICAgICAgZXhwZWN0KGFwaVJlc3BvbnNlQm9keS5kYXRhLmNvbnRlbnRJZCkudG9CZURlZmluZWQoKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGNvbnRlbnRJZCA9IGFwaVJlc3BvbnNlQm9keS5kYXRhLmNvbnRlbnRJZDtcclxuXHJcbiAgICAgIC8vIFN0ZXAgMjogT3JjaGVzdHJhdG9yIHJlY2VpdmVzIEV2ZW50QnJpZGdlIGV2ZW50IGFuZCBpbml0aWF0ZXMgd29ya2Zsb3dcclxuICAgICAgY29uc3Qgb3JjaGVzdHJhdG9yRXZlbnQ6IEV2ZW50QnJpZGdlRXZlbnQ8c3RyaW5nLCBhbnk+ID0ge1xyXG4gICAgICAgIHZlcnNpb246ICcwJyxcclxuICAgICAgICBpZDogJ3Rlc3QtZXZlbnQtaWQnLFxyXG4gICAgICAgICdkZXRhaWwtdHlwZSc6ICdDb250ZW50IEdlbmVyYXRpb24gUmVxdWVzdGVkJyxcclxuICAgICAgICBzb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuYXBpJyxcclxuICAgICAgICBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJyxcclxuICAgICAgICB0aW1lOiAnMjAyMy0wMS0wMVQwMDowMDowMFonLFxyXG4gICAgICAgIHJlZ2lvbjogJ3VzLWVhc3QtMScsXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbXSxcclxuICAgICAgICBkZXRhaWw6IHtcclxuICAgICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJyxcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb246ICdJIHdhbnQgdG8gd3JpdGUgYWJvdXQgdGhlIGJlbmVmaXRzIG9mIHJlbW90ZSB3b3JrIGFuZCBob3cgaXQgaGFzIGNoYW5nZWQgdGhlIG1vZGVybiB3b3JrcGxhY2UuJyxcclxuICAgICAgICAgIHVzZXJDb250ZXh0OiAnVGVjaG5vbG9neSBibG9nZ2VyIHdpdGggZm9jdXMgb24gd29ya3BsYWNlIHRyZW5kcycsXHJcbiAgICAgICAgICBwcmVmZXJlbmNlczoge1xyXG4gICAgICAgICAgICB0b25lOiAncHJvZmVzc2lvbmFsJyxcclxuICAgICAgICAgICAgbGVuZ3RoOiAnbWVkaXVtJyxcclxuICAgICAgICAgICAgdGFyZ2V0QXVkaWVuY2U6ICdidXNpbmVzcyBwcm9mZXNzaW9uYWxzJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gTW9jayB3b3JrZmxvdyBjcmVhdGlvbiBhbmQgYWdlbnQgbWVzc2FnZSBzZW5kaW5nXHJcbiAgICAgIGR5bmFtb01vY2sub24oUHV0SXRlbUNvbW1hbmQpLnJlc29sdmVzKHt9KTtcclxuICAgICAgZHluYW1vTW9jay5vbihVcGRhdGVJdGVtQ29tbWFuZCkucmVzb2x2ZXMoe30pO1xyXG4gICAgICBzcXNNb2NrLm9uKFNlbmRNZXNzYWdlQ29tbWFuZCkucmVzb2x2ZXMoeyBNZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnIH0pO1xyXG5cclxuICAgICAgLy8gVGhpcyB3b3VsZCBub3JtYWxseSBiZSB0cmlnZ2VyZWQgYnkgRXZlbnRCcmlkZ2UsIGJ1dCB3ZSdsbCBjYWxsIGRpcmVjdGx5IGZvciB0ZXN0aW5nXHJcbiAgICAgIGF3YWl0IG9yY2hlc3RyYXRvckhhbmRsZXIob3JjaGVzdHJhdG9yRXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSB3b3JrZmxvdyB3YXMgY3JlYXRlZCBhbmQgbWVzc2FnZSBzZW50IHRvIGNvbnRlbnQgZ2VuZXJhdGlvbiBxdWV1ZVxyXG4gICAgICBleHBlY3QoZHluYW1vTW9jay5jb21tYW5kQ2FsbHMoUHV0SXRlbUNvbW1hbmQpKS50b0hhdmVMZW5ndGgoMyk7IC8vIEFQSSBjb250ZW50ICsgd29ya2Zsb3cgKyBhZ2VudCBtZXNzYWdlXHJcbiAgICAgIGV4cGVjdChzcXNNb2NrLmNvbW1hbmRDYWxscyhTZW5kTWVzc2FnZUNvbW1hbmQpKS50b0hhdmVMZW5ndGgoMSk7XHJcblxyXG4gICAgICAvLyBTdGVwIDM6IENvbnRlbnQgZ2VuZXJhdGlvbiBhZ2VudCBwcm9jZXNzZXMgdGhlIHJlcXVlc3RcclxuICAgICAgY29uc3QgY29udGVudEFnZW50RXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgICBtZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnLFxyXG4gICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdC1oYW5kbGUnLFxyXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICBtZXNzYWdlSWQ6ICdtc2ctMTIzJyxcclxuICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgIGFnZW50VHlwZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgICAgICAgbWVzc2FnZVR5cGU6ICdyZXF1ZXN0JyxcclxuICAgICAgICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgICAgICAgIHdvcmtmbG93SWQ6ICd3b3JrZmxvdy0xMjMnLFxyXG4gICAgICAgICAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgaW5wdXQ6ICdJIHdhbnQgdG8gd3JpdGUgYWJvdXQgdGhlIGJlbmVmaXRzIG9mIHJlbW90ZSB3b3JrIGFuZCBob3cgaXQgaGFzIGNoYW5nZWQgdGhlIG1vZGVybiB3b3JrcGxhY2UuJyxcclxuICAgICAgICAgICAgICB1c2VySWQ6ICd1c2VyLTEyMycsXHJcbiAgICAgICAgICAgICAgY29udGV4dDoge1xyXG4gICAgICAgICAgICAgICAgcHJldmlvdXNTdGVwczogW10sXHJcbiAgICAgICAgICAgICAgICB1c2VyUHJlZmVyZW5jZXM6IHtcclxuICAgICAgICAgICAgICAgICAgdG9uZTogJ3Byb2Zlc3Npb25hbCcsXHJcbiAgICAgICAgICAgICAgICAgIGxlbmd0aDogJ21lZGl1bScsXHJcbiAgICAgICAgICAgICAgICAgIHRhcmdldEF1ZGllbmNlOiAnYnVzaW5lc3MgcHJvZmVzc2lvbmFscydcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcclxuICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnLFxyXG4gICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwMDAwJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgIGV2ZW50U291cmNlOiAnYXdzOnNxcycsXHJcbiAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6dGVzdC1jb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJ1xyXG4gICAgICAgIH1dXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBNb2NrIHVzZXIgcHJlZmVyZW5jZXMgbG9va3VwXHJcbiAgICAgIGR5bmFtb01vY2sub24oR2V0SXRlbUNvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBJdGVtOiB7XHJcbiAgICAgICAgICBpZDogeyBTOiAndXNlci0xMjMnIH0sXHJcbiAgICAgICAgICB3cml0aW5nU3R5bGVDb250ZXh0OiB7IFM6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgdG9uZTogJ3Byb2Zlc3Npb25hbCcsXHJcbiAgICAgICAgICAgIGxlbmd0aDogJ21lZGl1bScsXHJcbiAgICAgICAgICAgIHRhcmdldEF1ZGllbmNlOiAnYnVzaW5lc3MgcHJvZmVzc2lvbmFscycsXHJcbiAgICAgICAgICAgIHdyaXRpbmdTdHlsZTogJ2NsZWFyIGFuZCBhdXRob3JpdGF0aXZlJ1xyXG4gICAgICAgICAgfSkgfVxyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICBhd2FpdCBjb250ZW50QWdlbnRIYW5kbGVyKGNvbnRlbnRBZ2VudEV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgY29udGVudCB3YXMgZ2VuZXJhdGVkIGFuZCByZXNwb25zZSBzZW50IGJhY2tcclxuICAgICAgZXhwZWN0KHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZCkpLnRvSGF2ZUxlbmd0aCgyKTsgLy8gb3JjaGVzdHJhdG9yICsgYWdlbnQgcmVzcG9uc2VcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGFnZW50UmVzcG9uc2VDYWxsID0gc3FzTW9jay5jb21tYW5kQ2FsbHMoU2VuZE1lc3NhZ2VDb21tYW5kKVsxXTtcclxuICAgICAgY29uc3QgYWdlbnRSZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKGFnZW50UmVzcG9uc2VDYWxsLmFyZ3NbMF0uaW5wdXQuTWVzc2FnZUJvZHkhKTtcclxuICAgICAgZXhwZWN0KGFnZW50UmVzcG9uc2VCb2R5Lm1lc3NhZ2VUeXBlKS50b0JlKCdyZXNwb25zZScpO1xyXG4gICAgICBleHBlY3QoYWdlbnRSZXNwb25zZUJvZHkucGF5bG9hZC5zdWNjZXNzKS50b0JlKHRydWUpO1xyXG4gICAgICBleHBlY3QoYWdlbnRSZXNwb25zZUJvZHkucGF5bG9hZC5jb250ZW50KS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QoYWdlbnRSZXNwb25zZUJvZHkucGF5bG9hZC5jb250ZW50LnRpdGxlKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QoYWdlbnRSZXNwb25zZUJvZHkucGF5bG9hZC5jb250ZW50LmNvbnRlbnQpLnRvQmVEZWZpbmVkKCk7XHJcbiAgICAgIGV4cGVjdChhZ2VudFJlc3BvbnNlQm9keS5wYXlsb2FkLmNvbnRlbnQud29yZENvdW50KS50b0JlR3JlYXRlclRoYW4oMCk7XHJcblxyXG4gICAgICAvLyBTdGVwIDQ6IFZlcmlmeSBBUEkgY2FuIHJldHJpZXZlIHRoZSBnZW5lcmF0ZWQgY29udGVudFxyXG4gICAgICBjb25zdCBnZXRDb250ZW50RXZlbnQgPSBjcmVhdGVBUElHYXRld2F5RXZlbnQoJ0dFVCcsIGAvYXBpL2NvbnRlbnQvJHtjb250ZW50SWR9YCk7XHJcblxyXG4gICAgICAvLyBNb2NrIGNvbnRlbnQgcmV0cmlldmFsXHJcbiAgICAgIGR5bmFtb01vY2sub24oR2V0SXRlbUNvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBJdGVtOiB7XHJcbiAgICAgICAgICBpZDogeyBTOiBjb250ZW50SWQgfSxcclxuICAgICAgICAgIHVzZXJJZDogeyBTOiAndXNlci0xMjMnIH0sXHJcbiAgICAgICAgICB0aXRsZTogeyBTOiAnVGhlIEZ1dHVyZSBvZiBSZW1vdGUgV29yazogVHJhbnNmb3JtaW5nIHRoZSBNb2Rlcm4gV29ya3BsYWNlJyB9LFxyXG4gICAgICAgICAgb3JpZ2luYWxUcmFuc2NyaXB0aW9uOiB7IFM6ICdJIHdhbnQgdG8gd3JpdGUgYWJvdXQgdGhlIGJlbmVmaXRzIG9mIHJlbW90ZSB3b3JrIGFuZCBob3cgaXQgaGFzIGNoYW5nZWQgdGhlIG1vZGVybiB3b3JrcGxhY2UuJyB9LFxyXG4gICAgICAgICAgY3VycmVudERyYWZ0OiB7IFM6ICdHZW5lcmF0ZWQgYmxvZyBwb3N0IGNvbnRlbnQuLi4nIH0sXHJcbiAgICAgICAgICBzdGF0dXM6IHsgUzogJ3JlYWR5X2Zvcl9yZXZpZXcnIH0sXHJcbiAgICAgICAgICBjcmVhdGVkQXQ6IHsgUzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXHJcbiAgICAgICAgICB1cGRhdGVkQXQ6IHsgUzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sXHJcbiAgICAgICAgICByZXZpc2lvbkhpc3Rvcnk6IHsgUzogJ1tdJyB9LFxyXG4gICAgICAgICAgcHVibGlzaGluZ1Jlc3VsdHM6IHsgUzogJ1tdJyB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGdldENvbnRlbnRSZXNwb25zZSA9IGF3YWl0IGFwaUhhbmRsZXIoZ2V0Q29udGVudEV2ZW50LCBtb2NrQ29udGV4dCk7XHJcbiAgICAgIFxyXG4gICAgICBleHBlY3QoZ2V0Q29udGVudFJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgY29uc3QgY29udGVudFJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UoZ2V0Q29udGVudFJlc3BvbnNlLmJvZHkpO1xyXG4gICAgICBleHBlY3QoY29udGVudFJlc3BvbnNlQm9keS5kYXRhLmlkKS50b0JlKGNvbnRlbnRJZCk7XHJcbiAgICAgIGV4cGVjdChjb250ZW50UmVzcG9uc2VCb2R5LmRhdGEudGl0bGUpLnRvQmVEZWZpbmVkKCk7XHJcbiAgICAgIGV4cGVjdChjb250ZW50UmVzcG9uc2VCb2R5LmRhdGEuY3VycmVudERyYWZ0KS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QoY29udGVudFJlc3BvbnNlQm9keS5kYXRhLnN0YXR1cykudG9CZSgncmVhZHlfZm9yX3JldmlldycpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29udGVudCByZXZpc2lvbiB3b3JrZmxvdycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgY29udGVudElkID0gJ2NvbnRlbnQtMTIzJztcclxuICAgICAgXHJcbiAgICAgIC8vIFN0ZXAgMTogQVBJIHJlY2VpdmVzIHJldmlzaW9uIHJlcXVlc3RcclxuICAgICAgY29uc3QgcmV2aXNpb25FdmVudCA9IGNyZWF0ZUFQSUdhdGV3YXlFdmVudChcclxuICAgICAgICAnUE9TVCcsXHJcbiAgICAgICAgJy9hcGkvY29udGVudC9yZXZpc2UnLFxyXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICAgIGN1cnJlbnRDb250ZW50OiAnVGhpcyBpcyB0aGUgY3VycmVudCBibG9nIHBvc3QgdGhhdCBuZWVkcyBpbXByb3ZlbWVudC4nLFxyXG4gICAgICAgICAgZmVlZGJhY2s6ICdQbGVhc2UgbWFrZSBpdCBtb3JlIGVuZ2FnaW5nIGFuZCBhZGQgc3BlY2lmaWMgZXhhbXBsZXMuJyxcclxuICAgICAgICAgIHJldmlzaW9uVHlwZTogJ3N0eWxlJyxcclxuICAgICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJ1xyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgRXZlbnRCcmlkZ2UgcHVibGlzaFxyXG4gICAgICBldmVudEJyaWRnZU1vY2sub24oUHV0RXZlbnRzQ29tbWFuZCkucmVzb2x2ZXMoe1xyXG4gICAgICAgIEZhaWxlZEVudHJ5Q291bnQ6IDAsXHJcbiAgICAgICAgRW50cmllczogW3sgRXZlbnRJZDogJ3Rlc3QtZXZlbnQtaWQnIH1dXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgYXBpUmVzcG9uc2UgPSBhd2FpdCBhcGlIYW5kbGVyKHJldmlzaW9uRXZlbnQsIG1vY2tDb250ZXh0KTtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChhcGlSZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIGNvbnN0IGFwaVJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UoYXBpUmVzcG9uc2UuYm9keSk7XHJcbiAgICAgIGV4cGVjdChhcGlSZXNwb25zZUJvZHkuZGF0YS5yZXZpc2lvbklkKS50b0JlRGVmaW5lZCgpO1xyXG5cclxuICAgICAgLy8gU3RlcCAyOiBDb250ZW50IGFnZW50IHByb2Nlc3NlcyByZXZpc2lvbiByZXF1ZXN0XHJcbiAgICAgIGNvbnN0IHJldmlzaW9uQWdlbnRFdmVudDogU1FTRXZlbnQgPSB7XHJcbiAgICAgICAgUmVjb3JkczogW3tcclxuICAgICAgICAgIG1lc3NhZ2VJZDogJ3Rlc3QtbWVzc2FnZS1pZCcsXHJcbiAgICAgICAgICByZWNlaXB0SGFuZGxlOiAndGVzdC1yZWNlaXB0LWhhbmRsZScsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VUeXBlOiAncmV2aXNpb24nLFxyXG4gICAgICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LTEyMycsXHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1yZXZpc2lvbicsXHJcbiAgICAgICAgICAgICAgY3VycmVudENvbnRlbnQ6ICdUaGlzIGlzIHRoZSBjdXJyZW50IGJsb2cgcG9zdCB0aGF0IG5lZWRzIGltcHJvdmVtZW50LicsXHJcbiAgICAgICAgICAgICAgZmVlZGJhY2s6ICdQbGVhc2UgbWFrZSBpdCBtb3JlIGVuZ2FnaW5nIGFuZCBhZGQgc3BlY2lmaWMgZXhhbXBsZXMuJyxcclxuICAgICAgICAgICAgICB1c2VySWQ6ICd1c2VyLTEyMycsXHJcbiAgICAgICAgICAgICAgcmV2aXNpb25UeXBlOiAnc3R5bGUnXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgYXR0cmlidXRlczoge1xyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxyXG4gICAgICAgICAgICBTZW50VGltZXN0YW1wOiAnMTIzNDU2Nzg5MDAwMCcsXHJcbiAgICAgICAgICAgIFNlbmRlcklkOiAndGVzdC1zZW5kZXInLFxyXG4gICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzEyMzQ1Njc4OTAwMDAnXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHt9LFxyXG4gICAgICAgICAgbWQ1T2ZCb2R5OiAndGVzdC1tZDUnLFxyXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcclxuICAgICAgICAgIGV2ZW50U291cmNlQVJOOiAnYXJuOmF3czpzcXM6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjp0ZXN0LWNvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXHJcbiAgICAgICAgfV1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIE1vY2sgdXNlciBwcmVmZXJlbmNlcyBsb29rdXBcclxuICAgICAgZHluYW1vTW9jay5vbihHZXRJdGVtQ29tbWFuZCkucmVzb2x2ZXMoe1xyXG4gICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgIGlkOiB7IFM6ICd1c2VyLTEyMycgfSxcclxuICAgICAgICAgIHdyaXRpbmdTdHlsZUNvbnRleHQ6IHsgUzogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICB0b25lOiAnY29udmVyc2F0aW9uYWwnLFxyXG4gICAgICAgICAgICB3cml0aW5nU3R5bGU6ICdlbmdhZ2luZyBhbmQgZXhhbXBsZS1yaWNoJ1xyXG4gICAgICAgICAgfSkgfVxyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgU1FTIHNlbmRcclxuICAgICAgc3FzTW9jay5vbihTZW5kTWVzc2FnZUNvbW1hbmQpLnJlc29sdmVzKHtcclxuICAgICAgICBNZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgYXdhaXQgY29udGVudEFnZW50SGFuZGxlcihyZXZpc2lvbkFnZW50RXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSByZXZpc2lvbiB3YXMgcHJvY2Vzc2VkXHJcbiAgICAgIGV4cGVjdChzcXNNb2NrLmNvbW1hbmRDYWxscyhTZW5kTWVzc2FnZUNvbW1hbmQpKS50b0hhdmVMZW5ndGgoMSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZXZpc2lvblJlc3BvbnNlQ2FsbCA9IHNxc01vY2suY29tbWFuZENhbGxzKFNlbmRNZXNzYWdlQ29tbWFuZClbMF07XHJcbiAgICAgIGNvbnN0IHJldmlzaW9uUmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXZpc2lvblJlc3BvbnNlQ2FsbC5hcmdzWzBdLmlucHV0Lk1lc3NhZ2VCb2R5ISk7XHJcbiAgICAgIGV4cGVjdChyZXZpc2lvblJlc3BvbnNlQm9keS5tZXNzYWdlVHlwZSkudG9CZSgncmVzcG9uc2UnKTtcclxuICAgICAgZXhwZWN0KHJldmlzaW9uUmVzcG9uc2VCb2R5LnBheWxvYWQuc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICAgICAgZXhwZWN0KHJldmlzaW9uUmVzcG9uc2VCb2R5LnBheWxvYWQucmV2aXNpb25UeXBlKS50b0JlKCdzdHlsZScpO1xyXG4gICAgICBleHBlY3QocmV2aXNpb25SZXNwb25zZUJvZHkucGF5bG9hZC5jb250ZW50KS50b0JlRGVmaW5lZCgpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdDb250ZW50IFZhbGlkYXRpb24gSW50ZWdyYXRpb24nLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGNvbnRlbnQgdGhyb3VnaCBBUEkgZW5kcG9pbnQnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25FdmVudCA9IGNyZWF0ZUFQSUdhdGV3YXlFdmVudChcclxuICAgICAgICAnUE9TVCcsXHJcbiAgICAgICAgJy9hcGkvY29udGVudC92YWxpZGF0ZScsXHJcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgY29udGVudDogJ1RoaXMgaXMgYSBjb21wcmVoZW5zaXZlIGJsb2cgcG9zdCBhYm91dCBwcm9kdWN0aXZpdHkgdGVjaG5pcXVlcy4gSXQgaW5jbHVkZXMgbXVsdGlwbGUgcGFyYWdyYXBocyB3aXRoIGRldGFpbGVkIGV4cGxhbmF0aW9ucyBhbmQgcHJhY3RpY2FsIGV4YW1wbGVzLiBUaGUgY29udGVudCBpcyB3ZWxsLXN0cnVjdHVyZWQgd2l0aCBjbGVhciBoZWFkaW5ncyBhbmQgcHJvdmlkZXMgdmFsdWFibGUgaW5zaWdodHMgZm9yIHJlYWRlcnMgaW50ZXJlc3RlZCBpbiBpbXByb3ZpbmcgdGhlaXIgcHJvZHVjdGl2aXR5LidcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBhcGlIYW5kbGVyKHZhbGlkYXRpb25FdmVudCwgbW9ja0NvbnRleHQpO1xyXG4gICAgICBcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5kYXRhLmlzVmFsaWQpLnRvQmUodHJ1ZSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZGF0YS5zY29yZSkudG9CZUdyZWF0ZXJUaGFuKDcpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmRhdGEuaXNzdWVzKS50b0VxdWFsKFtdKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5kYXRhLnN1Z2dlc3Rpb25zKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBpZGVudGlmeSBjb250ZW50IHF1YWxpdHkgaXNzdWVzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCB2YWxpZGF0aW9uRXZlbnQgPSBjcmVhdGVBUElHYXRld2F5RXZlbnQoXHJcbiAgICAgICAgJ1BPU1QnLFxyXG4gICAgICAgICcvYXBpL2NvbnRlbnQvdmFsaWRhdGUnLFxyXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGNvbnRlbnQ6ICdTaG9ydCBjb250ZW50JyAvLyBUb28gc2hvcnQsIG5vIHByb3BlciBlbmRpbmdcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBhcGlIYW5kbGVyKHZhbGlkYXRpb25FdmVudCwgbW9ja0NvbnRleHQpO1xyXG4gICAgICBcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5kYXRhLmlzVmFsaWQpLnRvQmUoZmFsc2UpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmRhdGEuc2NvcmUpLnRvQmVMZXNzVGhhbig3KTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5kYXRhLmlzc3Vlcy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnRXJyb3IgSGFuZGxpbmcgSW50ZWdyYXRpb24nLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBBUEkgZXJyb3JzIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGludmFsaWRFdmVudCA9IGNyZWF0ZUFQSUdhdGV3YXlFdmVudChcclxuICAgICAgICAnUE9TVCcsXHJcbiAgICAgICAgJy9hcGkvY29udGVudC9nZW5lcmF0ZScsXHJcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgLy8gTWlzc2luZyByZXF1aXJlZCBmaWVsZHNcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb246ICcnLFxyXG4gICAgICAgICAgdXNlcklkOiAnJ1xyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGFwaUhhbmRsZXIoaW52YWxpZEV2ZW50LCBtb2NrQ29udGV4dCk7XHJcbiAgICAgIFxyXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSg0MDApO1xyXG4gICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmVycm9yKS50b0JlKCdCYWQgUmVxdWVzdCcpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5Lm1lc3NhZ2UpLnRvQ29udGFpbigncmVxdWlyZWQnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIER5bmFtb0RCIGVycm9ycycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgYXBpRXZlbnQgPSBjcmVhdGVBUElHYXRld2F5RXZlbnQoXHJcbiAgICAgICAgJ1BPU1QnLFxyXG4gICAgICAgICcvYXBpL2NvbnRlbnQvZ2VuZXJhdGUnLFxyXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb246ICdWYWxpZCB0cmFuc2NyaXB0aW9uJyxcclxuICAgICAgICAgIHVzZXJJZDogJ3VzZXItMTIzJ1xyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBNb2NrIER5bmFtb0RCIGVycm9yXHJcbiAgICAgIGR5bmFtb01vY2sub24oUHV0SXRlbUNvbW1hbmQpLnJlamVjdHMobmV3IEVycm9yKCdEeW5hbW9EQiBlcnJvcicpKTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXBpSGFuZGxlcihhcGlFdmVudCwgbW9ja0NvbnRleHQpO1xyXG4gICAgICBcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5lcnJvcikudG9CZSgnSW50ZXJuYWwgU2VydmVyIEVycm9yJyk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19