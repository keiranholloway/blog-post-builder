"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Mock AWS SDK clients
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/client-sqs');
jest.mock('@aws-sdk/client-eventbridge');
const mockDynamoClient = {
    send: jest.fn(),
};
const mockSQSClient = {
    send: jest.fn(),
};
const mockEventBridgeClient = {
    send: jest.fn(),
};
// Mock the AWS SDK modules
jest.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn(() => mockDynamoClient),
    PutItemCommand: jest.fn(),
    UpdateItemCommand: jest.fn(),
    GetItemCommand: jest.fn(),
}));
jest.doMock('@aws-sdk/client-sqs', () => ({
    SQSClient: jest.fn(() => mockSQSClient),
    SendMessageCommand: jest.fn(),
    DeleteMessageCommand: jest.fn(),
}));
jest.doMock('@aws-sdk/client-eventbridge', () => ({
    EventBridgeClient: jest.fn(() => mockEventBridgeClient),
    PutEventsCommand: jest.fn(),
}));
// Mock environment variables
process.env.CONTENT_TABLE_NAME = 'test-content-table';
process.env.AGENT_MESSAGES_TABLE_NAME = 'test-agent-messages-table';
process.env.CONTENT_GENERATION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/content-generation';
process.env.IMAGE_GENERATION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/image-generation';
process.env.EVENT_BUS_NAME = 'test-event-bus';
process.env.AWS_REGION = 'us-east-1';
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
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
};
// Import the handler after mocking
const content_orchestrator_1 = require("../lambda/content-orchestrator");
describe('Content Orchestrator', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDynamoClient.send.mockResolvedValue({});
        mockSQSClient.send.mockResolvedValue({});
        mockEventBridgeClient.send.mockResolvedValue({});
    });
    describe('EventBridge Events', () => {
        it('should handle input processor completion event', async () => {
            const event = {
                version: '0',
                id: 'test-event-id',
                'detail-type': 'Audio Processing Completed',
                source: 'automated-blog-poster.input-processor',
                account: '123456789012',
                time: '2023-01-01T00:00:00Z',
                region: 'us-east-1',
                resources: [],
                detail: {
                    inputId: 'test-input-id',
                    userId: 'test-user-id',
                    transcription: 'This is a test transcription',
                },
            };
            await (0, content_orchestrator_1.handler)(event, mockContext);
            // Should create workflow in DynamoDB
            expect(mockDynamoClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    TableName: 'test-content-table',
                    Item: expect.objectContaining({
                        type: { S: 'workflow' },
                        userId: { S: 'test-user-id' },
                        inputId: { S: 'test-input-id' },
                        status: { S: 'initiated' },
                    }),
                }),
            }));
            // Should send message to content generation queue
            expect(mockSQSClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/content-generation',
                    MessageBody: expect.stringContaining('content-generator'),
                }),
            }));
            // Should publish orchestration event
            expect(mockEventBridgeClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    Entries: expect.arrayContaining([
                        expect.objectContaining({
                            Source: 'automated-blog-poster.orchestrator',
                            DetailType: 'step_completed',
                        }),
                    ]),
                }),
            }));
        });
        it('should handle text processing completion event', async () => {
            const event = {
                version: '0',
                id: 'test-event-id',
                'detail-type': 'Text Processing Completed',
                source: 'automated-blog-poster.input-processor',
                account: '123456789012',
                time: '2023-01-01T00:00:00Z',
                region: 'us-east-1',
                resources: [],
                detail: {
                    inputId: 'test-input-id',
                    userId: 'test-user-id',
                    transcription: 'This is a test text input',
                },
            };
            await (0, content_orchestrator_1.handler)(event, mockContext);
            // Should create workflow and start content generation
            expect(mockDynamoClient.send).toHaveBeenCalled();
            expect(mockSQSClient.send).toHaveBeenCalled();
            expect(mockEventBridgeClient.send).toHaveBeenCalled();
        });
        it('should ignore unknown event sources', async () => {
            const event = {
                version: '0',
                id: 'test-event-id',
                'detail-type': 'Unknown Event',
                source: 'unknown.source',
                account: '123456789012',
                time: '2023-01-01T00:00:00Z',
                region: 'us-east-1',
                resources: [],
                detail: {},
            };
            await (0, content_orchestrator_1.handler)(event, mockContext);
            // Should not make any AWS calls
            expect(mockDynamoClient.send).not.toHaveBeenCalled();
            expect(mockSQSClient.send).not.toHaveBeenCalled();
            expect(mockEventBridgeClient.send).not.toHaveBeenCalled();
        });
    });
    describe('SQS Events', () => {
        it('should handle agent response messages', async () => {
            // Mock workflow lookup
            mockDynamoClient.send.mockResolvedValueOnce({
                Item: {
                    id: { S: 'test-workflow-id' },
                    userId: { S: 'test-user-id' },
                    inputId: { S: 'test-input-id' },
                    status: { S: 'content_generation' },
                    currentStep: { S: 'content-generation' },
                    steps: { S: JSON.stringify([
                            {
                                stepId: 'content-generation',
                                stepType: 'content_generation',
                                status: 'in_progress',
                                agentType: 'content-generator',
                                retryCount: 0,
                                maxRetries: 3,
                            },
                            {
                                stepId: 'image-generation',
                                stepType: 'image_generation',
                                status: 'pending',
                                agentType: 'image-generator',
                                retryCount: 0,
                                maxRetries: 3,
                            },
                        ]) },
                    createdAt: { S: '2023-01-01T00:00:00Z' },
                    updatedAt: { S: '2023-01-01T00:00:00Z' },
                    metadata: { S: JSON.stringify({ originalInput: 'test input' }) },
                },
            });
            const event = {
                Records: [
                    {
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageId: 'test-agent-message-id',
                            workflowId: 'test-workflow-id',
                            stepId: 'content-generation',
                            agentType: 'content-generator',
                            messageType: 'response',
                            payload: {
                                content: 'Generated blog content',
                                title: 'Test Blog Post',
                            },
                            timestamp: '2023-01-01T00:00:00Z',
                        }),
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '1640995200000',
                            SenderId: 'test-sender',
                            ApproximateFirstReceiveTimestamp: '1640995200000',
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:content-generation',
                        awsRegion: 'us-east-1',
                    },
                ],
            };
            await (0, content_orchestrator_1.handler)(event, mockContext);
            // Should update workflow status
            expect(mockDynamoClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    TableName: 'test-content-table',
                    UpdateExpression: expect.stringContaining('SET #status = :status'),
                }),
            }));
            // Should send message to next queue (image generation)
            expect(mockSQSClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/image-generation',
                }),
            }));
            // Should delete processed message
            expect(mockSQSClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/content-generation',
                    ReceiptHandle: 'test-receipt-handle',
                }),
            }));
        });
        it('should handle agent error messages with retry', async () => {
            // Mock workflow lookup
            mockDynamoClient.send.mockResolvedValueOnce({
                Item: {
                    id: { S: 'test-workflow-id' },
                    userId: { S: 'test-user-id' },
                    inputId: { S: 'test-input-id' },
                    status: { S: 'content_generation' },
                    currentStep: { S: 'content-generation' },
                    steps: { S: JSON.stringify([
                            {
                                stepId: 'content-generation',
                                stepType: 'content_generation',
                                status: 'in_progress',
                                agentType: 'content-generator',
                                retryCount: 1,
                                maxRetries: 3,
                            },
                        ]) },
                    createdAt: { S: '2023-01-01T00:00:00Z' },
                    updatedAt: { S: '2023-01-01T00:00:00Z' },
                    metadata: { S: JSON.stringify({ originalInput: 'test input' }) },
                },
            });
            const event = {
                Records: [
                    {
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: JSON.stringify({
                            messageId: 'test-agent-message-id',
                            workflowId: 'test-workflow-id',
                            stepId: 'content-generation',
                            agentType: 'content-generator',
                            messageType: 'error',
                            payload: {
                                error: 'Content generation failed',
                            },
                            timestamp: '2023-01-01T00:00:00Z',
                        }),
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '1640995200000',
                            SenderId: 'test-sender',
                            ApproximateFirstReceiveTimestamp: '1640995200000',
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:content-generation',
                        awsRegion: 'us-east-1',
                    },
                ],
            };
            await (0, content_orchestrator_1.handler)(event, mockContext);
            // Should retry the step (send message again)
            expect(mockSQSClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/content-generation',
                    MessageBody: expect.stringContaining('content-generator'),
                }),
            }));
        });
        it('should handle malformed SQS messages gracefully', async () => {
            const event = {
                Records: [
                    {
                        messageId: 'test-message-id',
                        receiptHandle: 'test-receipt-handle',
                        body: 'invalid json',
                        attributes: {
                            ApproximateReceiveCount: '1',
                            SentTimestamp: '1640995200000',
                            SenderId: 'test-sender',
                            ApproximateFirstReceiveTimestamp: '1640995200000',
                        },
                        messageAttributes: {},
                        md5OfBody: 'test-md5',
                        eventSource: 'aws:sqs',
                        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:content-generation',
                        awsRegion: 'us-east-1',
                    },
                ],
            };
            // Should not throw error, but log it
            await expect((0, content_orchestrator_1.handler)(event, mockContext)).resolves.not.toThrow();
            // Should not delete the message (it will be retried)
            expect(mockSQSClient.send).not.toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    ReceiptHandle: 'test-receipt-handle',
                }),
            }));
        });
    });
    describe('Error Handling', () => {
        it('should handle DynamoDB errors gracefully', async () => {
            mockDynamoClient.send.mockRejectedValue(new Error('DynamoDB error'));
            const event = {
                version: '0',
                id: 'test-event-id',
                'detail-type': 'Audio Processing Completed',
                source: 'automated-blog-poster.input-processor',
                account: '123456789012',
                time: '2023-01-01T00:00:00Z',
                region: 'us-east-1',
                resources: [],
                detail: {
                    inputId: 'test-input-id',
                    userId: 'test-user-id',
                    transcription: 'This is a test transcription',
                },
            };
            await expect((0, content_orchestrator_1.handler)(event, mockContext)).rejects.toThrow('DynamoDB error');
        });
        it('should handle unknown event types gracefully', async () => {
            const unknownEvent = {
                unknownProperty: 'unknown value',
            };
            // Should not throw error
            await expect((0, content_orchestrator_1.handler)(unknownEvent, mockContext)).resolves.not.toThrow();
            // Should not make any AWS calls
            expect(mockDynamoClient.send).not.toHaveBeenCalled();
            expect(mockSQSClient.send).not.toHaveBeenCalled();
            expect(mockEventBridgeClient.send).not.toHaveBeenCalled();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1vcmNoZXN0cmF0b3IudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvbnRlbnQtb3JjaGVzdHJhdG9yLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFFQSx1QkFBdUI7QUFDdkIsSUFBSSxDQUFDLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO0FBQ3RDLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztBQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFDLDZCQUE2QixDQUFDLENBQUM7QUFFekMsTUFBTSxnQkFBZ0IsR0FBRztJQUN2QixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtDQUNoQixDQUFDO0FBRUYsTUFBTSxhQUFhLEdBQUc7SUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7Q0FDaEIsQ0FBQztBQUVGLE1BQU0scUJBQXFCLEdBQUc7SUFDNUIsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7Q0FDaEIsQ0FBQztBQUVGLDJCQUEyQjtBQUMzQixJQUFJLENBQUMsTUFBTSxDQUFDLDBCQUEwQixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDN0MsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsZ0JBQWdCLENBQUM7SUFDL0MsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7SUFDekIsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtJQUM1QixjQUFjLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtDQUMxQixDQUFDLENBQUMsQ0FBQztBQUVKLElBQUksQ0FBQyxNQUFNLENBQUMscUJBQXFCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN4QyxTQUFTLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxhQUFhLENBQUM7SUFDdkMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFB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QUFFLEtBQUssSUFBSSxFQUFFO1lBQzVELE1BQU0sWUFBWSxHQUFHO2dCQUNuQixlQUFlLEVBQUUsZUFBZTthQUMxQixDQUFDO1lBRVQseUJBQXlCO1lBQ3pCLE1BQU0sTUFBTSxDQUFDLElBQUEsOEJBQU8sRUFBQyxZQUFZLEVBQUUsV0FBVyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBRXhFLGdDQUFnQztZQUNoQyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDckQsTUFBTSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUNsRCxNQUFNLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFDNUQsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRXZlbnRCcmlkZ2VFdmVudCwgU1FTRXZlbnQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuXHJcbi8vIE1vY2sgQVdTIFNESyBjbGllbnRzXHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJyk7XHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LXNxcycpO1xyXG5qZXN0Lm1vY2soJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZScpO1xyXG5cclxuY29uc3QgbW9ja0R5bmFtb0NsaWVudCA9IHtcclxuICBzZW5kOiBqZXN0LmZuKCksXHJcbn07XHJcblxyXG5jb25zdCBtb2NrU1FTQ2xpZW50ID0ge1xyXG4gIHNlbmQ6IGplc3QuZm4oKSxcclxufTtcclxuXHJcbmNvbnN0IG1vY2tFdmVudEJyaWRnZUNsaWVudCA9IHtcclxuICBzZW5kOiBqZXN0LmZuKCksXHJcbn07XHJcblxyXG4vLyBNb2NrIHRoZSBBV1MgU0RLIG1vZHVsZXNcclxuamVzdC5kb01vY2soJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYicsICgpID0+ICh7XHJcbiAgRHluYW1vREJDbGllbnQ6IGplc3QuZm4oKCkgPT4gbW9ja0R5bmFtb0NsaWVudCksXHJcbiAgUHV0SXRlbUNvbW1hbmQ6IGplc3QuZm4oKSxcclxuICBVcGRhdGVJdGVtQ29tbWFuZDogamVzdC5mbigpLFxyXG4gIEdldEl0ZW1Db21tYW5kOiBqZXN0LmZuKCksXHJcbn0pKTtcclxuXHJcbmplc3QuZG9Nb2NrKCdAYXdzLXNkay9jbGllbnQtc3FzJywgKCkgPT4gKHtcclxuICBTUVNDbGllbnQ6IGplc3QuZm4oKCkgPT4gbW9ja1NRU0NsaWVudCksXHJcbiAgU2VuZE1lc3NhZ2VDb21tYW5kOiBqZXN0LmZuKCksXHJcbiAgRGVsZXRlTWVzc2FnZUNvbW1hbmQ6IGplc3QuZm4oKSxcclxufSkpO1xyXG5cclxuamVzdC5kb01vY2soJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZScsICgpID0+ICh7XHJcbiAgRXZlbnRCcmlkZ2VDbGllbnQ6IGplc3QuZm4oKCkgPT4gbW9ja0V2ZW50QnJpZGdlQ2xpZW50KSxcclxuICBQdXRFdmVudHNDb21tYW5kOiBqZXN0LmZuKCksXHJcbn0pKTtcclxuXHJcbi8vIE1vY2sgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbnByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSA9ICd0ZXN0LWNvbnRlbnQtdGFibGUnO1xyXG5wcm9jZXNzLmVudi5BR0VOVF9NRVNTQUdFU19UQUJMRV9OQU1FID0gJ3Rlc3QtYWdlbnQtbWVzc2FnZXMtdGFibGUnO1xyXG5wcm9jZXNzLmVudi5DT05URU5UX0dFTkVSQVRJT05fUVVFVUVfVVJMID0gJ2h0dHBzOi8vc3FzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tLzEyMzQ1Njc4OTAxMi9jb250ZW50LWdlbmVyYXRpb24nO1xyXG5wcm9jZXNzLmVudi5JTUFHRV9HRU5FUkFUSU9OX1FVRVVFX1VSTCA9ICdodHRwczovL3Nxcy51cy1lYXN0LTEuYW1hem9uYXdzLmNvbS8xMjM0NTY3ODkwMTIvaW1hZ2UtZ2VuZXJhdGlvbic7XHJcbnByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FID0gJ3Rlc3QtZXZlbnQtYnVzJztcclxucHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiA9ICd1cy1lYXN0LTEnO1xyXG5cclxuY29uc3QgbW9ja0NvbnRleHQ6IENvbnRleHQgPSB7XHJcbiAgY2FsbGJhY2tXYWl0c0ZvckVtcHR5RXZlbnRMb29wOiBmYWxzZSxcclxuICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcclxuICBmdW5jdGlvblZlcnNpb246ICcxJyxcclxuICBpbnZva2VkRnVuY3Rpb25Bcm46ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmZ1bmN0aW9uOnRlc3QtZnVuY3Rpb24nLFxyXG4gIG1lbW9yeUxpbWl0SW5NQjogJzI1NicsXHJcbiAgYXdzUmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJyxcclxuICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS90ZXN0LWZ1bmN0aW9uJyxcclxuICBsb2dTdHJlYW1OYW1lOiAnMjAyMy8wMS8wMS9bJExBVEVTVF10ZXN0LXN0cmVhbScsXHJcbiAgZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzOiAoKSA9PiAzMDAwMCxcclxuICBkb25lOiBqZXN0LmZuKCksXHJcbiAgZmFpbDogamVzdC5mbigpLFxyXG4gIHN1Y2NlZWQ6IGplc3QuZm4oKSxcclxufTtcclxuXHJcbi8vIEltcG9ydCB0aGUgaGFuZGxlciBhZnRlciBtb2NraW5nXHJcbmltcG9ydCB7IGhhbmRsZXIgfSBmcm9tICcuLi9sYW1iZGEvY29udGVudC1vcmNoZXN0cmF0b3InO1xyXG5cclxuZGVzY3JpYmUoJ0NvbnRlbnQgT3JjaGVzdHJhdG9yJywgKCkgPT4ge1xyXG5cclxuICBiZWZvcmVFYWNoKCgpID0+IHtcclxuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xyXG4gICAgbW9ja0R5bmFtb0NsaWVudC5zZW5kLm1vY2tSZXNvbHZlZFZhbHVlKHt9KTtcclxuICAgIG1vY2tTUVNDbGllbnQuc2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZSh7fSk7XHJcbiAgICBtb2NrRXZlbnRCcmlkZ2VDbGllbnQuc2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZSh7fSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdFdmVudEJyaWRnZSBFdmVudHMnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBpbnB1dCBwcm9jZXNzb3IgY29tcGxldGlvbiBldmVudCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IEV2ZW50QnJpZGdlRXZlbnQ8c3RyaW5nLCBhbnk+ID0ge1xyXG4gICAgICAgIHZlcnNpb246ICcwJyxcclxuICAgICAgICBpZDogJ3Rlc3QtZXZlbnQtaWQnLFxyXG4gICAgICAgICdkZXRhaWwtdHlwZSc6ICdBdWRpbyBQcm9jZXNzaW5nIENvbXBsZXRlZCcsXHJcbiAgICAgICAgc291cmNlOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmlucHV0LXByb2Nlc3NvcicsXHJcbiAgICAgICAgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsXHJcbiAgICAgICAgdGltZTogJzIwMjMtMDEtMDFUMDA6MDA6MDBaJyxcclxuICAgICAgICByZWdpb246ICd1cy1lYXN0LTEnLFxyXG4gICAgICAgIHJlc291cmNlczogW10sXHJcbiAgICAgICAgZGV0YWlsOiB7XHJcbiAgICAgICAgICBpbnB1dElkOiAndGVzdC1pbnB1dC1pZCcsXHJcbiAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItaWQnLFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbjogJ1RoaXMgaXMgYSB0ZXN0IHRyYW5zY3JpcHRpb24nLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICAvLyBTaG91bGQgY3JlYXRlIHdvcmtmbG93IGluIER5bmFtb0RCXHJcbiAgICAgIGV4cGVjdChtb2NrRHluYW1vQ2xpZW50LnNlbmQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxyXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgIGlucHV0OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICAgIFRhYmxlTmFtZTogJ3Rlc3QtY29udGVudC10YWJsZScsXHJcbiAgICAgICAgICAgIEl0ZW06IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICAgICB0eXBlOiB7IFM6ICd3b3JrZmxvdycgfSxcclxuICAgICAgICAgICAgICB1c2VySWQ6IHsgUzogJ3Rlc3QtdXNlci1pZCcgfSxcclxuICAgICAgICAgICAgICBpbnB1dElkOiB7IFM6ICd0ZXN0LWlucHV0LWlkJyB9LFxyXG4gICAgICAgICAgICAgIHN0YXR1czogeyBTOiAnaW5pdGlhdGVkJyB9LFxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBTaG91bGQgc2VuZCBtZXNzYWdlIHRvIGNvbnRlbnQgZ2VuZXJhdGlvbiBxdWV1ZVxyXG4gICAgICBleHBlY3QobW9ja1NRU0NsaWVudC5zZW5kKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcclxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICBpbnB1dDogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgICBRdWV1ZVVybDogJ2h0dHBzOi8vc3FzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tLzEyMzQ1Njc4OTAxMi9jb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgICBNZXNzYWdlQm9keTogZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ2NvbnRlbnQtZ2VuZXJhdG9yJyksXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG5cclxuICAgICAgLy8gU2hvdWxkIHB1Ymxpc2ggb3JjaGVzdHJhdGlvbiBldmVudFxyXG4gICAgICBleHBlY3QobW9ja0V2ZW50QnJpZGdlQ2xpZW50LnNlbmQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxyXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgIGlucHV0OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICAgIEVudHJpZXM6IGV4cGVjdC5hcnJheUNvbnRhaW5pbmcoW1xyXG4gICAgICAgICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICAgICAgIFNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5vcmNoZXN0cmF0b3InLFxyXG4gICAgICAgICAgICAgICAgRGV0YWlsVHlwZTogJ3N0ZXBfY29tcGxldGVkJyxcclxuICAgICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgXSksXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdGV4dCBwcm9jZXNzaW5nIGNvbXBsZXRpb24gZXZlbnQnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50OiBFdmVudEJyaWRnZUV2ZW50PHN0cmluZywgYW55PiA9IHtcclxuICAgICAgICB2ZXJzaW9uOiAnMCcsXHJcbiAgICAgICAgaWQ6ICd0ZXN0LWV2ZW50LWlkJyxcclxuICAgICAgICAnZGV0YWlsLXR5cGUnOiAnVGV4dCBQcm9jZXNzaW5nIENvbXBsZXRlZCcsXHJcbiAgICAgICAgc291cmNlOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmlucHV0LXByb2Nlc3NvcicsXHJcbiAgICAgICAgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsXHJcbiAgICAgICAgdGltZTogJzIwMjMtMDEtMDFUMDA6MDA6MDBaJyxcclxuICAgICAgICByZWdpb246ICd1cy1lYXN0LTEnLFxyXG4gICAgICAgIHJlc291cmNlczogW10sXHJcbiAgICAgICAgZGV0YWlsOiB7XHJcbiAgICAgICAgICBpbnB1dElkOiAndGVzdC1pbnB1dC1pZCcsXHJcbiAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItaWQnLFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbjogJ1RoaXMgaXMgYSB0ZXN0IHRleHQgaW5wdXQnLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICAvLyBTaG91bGQgY3JlYXRlIHdvcmtmbG93IGFuZCBzdGFydCBjb250ZW50IGdlbmVyYXRpb25cclxuICAgICAgZXhwZWN0KG1vY2tEeW5hbW9DbGllbnQuc2VuZCkudG9IYXZlQmVlbkNhbGxlZCgpO1xyXG4gICAgICBleHBlY3QobW9ja1NRU0NsaWVudC5zZW5kKS50b0hhdmVCZWVuQ2FsbGVkKCk7XHJcbiAgICAgIGV4cGVjdChtb2NrRXZlbnRCcmlkZ2VDbGllbnQuc2VuZCkudG9IYXZlQmVlbkNhbGxlZCgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBpZ25vcmUgdW5rbm93biBldmVudCBzb3VyY2VzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudDogRXZlbnRCcmlkZ2VFdmVudDxzdHJpbmcsIGFueT4gPSB7XHJcbiAgICAgICAgdmVyc2lvbjogJzAnLFxyXG4gICAgICAgIGlkOiAndGVzdC1ldmVudC1pZCcsXHJcbiAgICAgICAgJ2RldGFpbC10eXBlJzogJ1Vua25vd24gRXZlbnQnLFxyXG4gICAgICAgIHNvdXJjZTogJ3Vua25vd24uc291cmNlJyxcclxuICAgICAgICBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJyxcclxuICAgICAgICB0aW1lOiAnMjAyMy0wMS0wMVQwMDowMDowMFonLFxyXG4gICAgICAgIHJlZ2lvbjogJ3VzLWVhc3QtMScsXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbXSxcclxuICAgICAgICBkZXRhaWw6IHt9LFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgLy8gU2hvdWxkIG5vdCBtYWtlIGFueSBBV1MgY2FsbHNcclxuICAgICAgZXhwZWN0KG1vY2tEeW5hbW9DbGllbnQuc2VuZCkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcclxuICAgICAgZXhwZWN0KG1vY2tTUVNDbGllbnQuc2VuZCkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcclxuICAgICAgZXhwZWN0KG1vY2tFdmVudEJyaWRnZUNsaWVudC5zZW5kKS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdTUVMgRXZlbnRzJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYWdlbnQgcmVzcG9uc2UgbWVzc2FnZXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIE1vY2sgd29ya2Zsb3cgbG9va3VwXHJcbiAgICAgIG1vY2tEeW5hbW9DbGllbnQuc2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgIGlkOiB7IFM6ICd0ZXN0LXdvcmtmbG93LWlkJyB9LFxyXG4gICAgICAgICAgdXNlcklkOiB7IFM6ICd0ZXN0LXVzZXItaWQnIH0sXHJcbiAgICAgICAgICBpbnB1dElkOiB7IFM6ICd0ZXN0LWlucHV0LWlkJyB9LFxyXG4gICAgICAgICAgc3RhdHVzOiB7IFM6ICdjb250ZW50X2dlbmVyYXRpb24nIH0sXHJcbiAgICAgICAgICBjdXJyZW50U3RlcDogeyBTOiAnY29udGVudC1nZW5lcmF0aW9uJyB9LFxyXG4gICAgICAgICAgc3RlcHM6IHsgUzogSlNPTi5zdHJpbmdpZnkoW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgICBzdGVwVHlwZTogJ2NvbnRlbnRfZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgc3RhdHVzOiAnaW5fcHJvZ3Jlc3MnLFxyXG4gICAgICAgICAgICAgIGFnZW50VHlwZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgICAgICAgICByZXRyeUNvdW50OiAwLFxyXG4gICAgICAgICAgICAgIG1heFJldHJpZXM6IDMsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBzdGVwSWQ6ICdpbWFnZS1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgICBzdGVwVHlwZTogJ2ltYWdlX2dlbmVyYXRpb24nLFxyXG4gICAgICAgICAgICAgIHN0YXR1czogJ3BlbmRpbmcnLFxyXG4gICAgICAgICAgICAgIGFnZW50VHlwZTogJ2ltYWdlLWdlbmVyYXRvcicsXHJcbiAgICAgICAgICAgICAgcmV0cnlDb3VudDogMCxcclxuICAgICAgICAgICAgICBtYXhSZXRyaWVzOiAzLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgXSkgfSxcclxuICAgICAgICAgIGNyZWF0ZWRBdDogeyBTOiAnMjAyMy0wMS0wMVQwMDowMDowMFonIH0sXHJcbiAgICAgICAgICB1cGRhdGVkQXQ6IHsgUzogJzIwMjMtMDEtMDFUMDA6MDA6MDBaJyB9LFxyXG4gICAgICAgICAgbWV0YWRhdGE6IHsgUzogSlNPTi5zdHJpbmdpZnkoeyBvcmlnaW5hbElucHV0OiAndGVzdCBpbnB1dCcgfSkgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBTUVNFdmVudCA9IHtcclxuICAgICAgICBSZWNvcmRzOiBbXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIG1lc3NhZ2VJZDogJ3Rlc3QtbWVzc2FnZS1pZCcsXHJcbiAgICAgICAgICAgIHJlY2VpcHRIYW5kbGU6ICd0ZXN0LXJlY2VpcHQtaGFuZGxlJyxcclxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgICAgIG1lc3NhZ2VJZDogJ3Rlc3QtYWdlbnQtbWVzc2FnZS1pZCcsXHJcbiAgICAgICAgICAgICAgd29ya2Zsb3dJZDogJ3Rlc3Qtd29ya2Zsb3ctaWQnLFxyXG4gICAgICAgICAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgYWdlbnRUeXBlOiAnY29udGVudC1nZW5lcmF0b3InLFxyXG4gICAgICAgICAgICAgIG1lc3NhZ2VUeXBlOiAncmVzcG9uc2UnLFxyXG4gICAgICAgICAgICAgIHBheWxvYWQ6IHtcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQ6ICdHZW5lcmF0ZWQgYmxvZyBjb250ZW50JyxcclxuICAgICAgICAgICAgICAgIHRpdGxlOiAnVGVzdCBCbG9nIFBvc3QnLFxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgdGltZXN0YW1wOiAnMjAyMy0wMS0wMVQwMDowMDowMFonLFxyXG4gICAgICAgICAgICB9KSxcclxuICAgICAgICAgICAgYXR0cmlidXRlczoge1xyXG4gICAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXHJcbiAgICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzE2NDA5OTUyMDAwMDAnLFxyXG4gICAgICAgICAgICAgIFNlbmRlcklkOiAndGVzdC1zZW5kZXInLFxyXG4gICAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTY0MDk5NTIwMDAwMCcsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgICAgbWQ1T2ZCb2R5OiAndGVzdC1tZDUnLFxyXG4gICAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxyXG4gICAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6Y29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIC8vIFNob3VsZCB1cGRhdGUgd29ya2Zsb3cgc3RhdHVzXHJcbiAgICAgIGV4cGVjdChtb2NrRHluYW1vQ2xpZW50LnNlbmQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxyXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgIGlucHV0OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICAgIFRhYmxlTmFtZTogJ3Rlc3QtY29udGVudC10YWJsZScsXHJcbiAgICAgICAgICAgIFVwZGF0ZUV4cHJlc3Npb246IGV4cGVjdC5zdHJpbmdDb250YWluaW5nKCdTRVQgI3N0YXR1cyA9IDpzdGF0dXMnKSxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBTaG91bGQgc2VuZCBtZXNzYWdlIHRvIG5leHQgcXVldWUgKGltYWdlIGdlbmVyYXRpb24pXHJcbiAgICAgIGV4cGVjdChtb2NrU1FTQ2xpZW50LnNlbmQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxyXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgIGlucHV0OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICAgIFF1ZXVlVXJsOiAnaHR0cHM6Ly9zcXMudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20vMTIzNDU2Nzg5MDEyL2ltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIC8vIFNob3VsZCBkZWxldGUgcHJvY2Vzc2VkIG1lc3NhZ2VcclxuICAgICAgZXhwZWN0KG1vY2tTUVNDbGllbnQuc2VuZCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgaW5wdXQ6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICAgUXVldWVVcmw6ICdodHRwczovL3Nxcy51cy1lYXN0LTEuYW1hem9uYXdzLmNvbS8xMjM0NTY3ODkwMTIvY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgUmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdC1oYW5kbGUnLFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGFnZW50IGVycm9yIG1lc3NhZ2VzIHdpdGggcmV0cnknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIE1vY2sgd29ya2Zsb3cgbG9va3VwXHJcbiAgICAgIG1vY2tEeW5hbW9DbGllbnQuc2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgIGlkOiB7IFM6ICd0ZXN0LXdvcmtmbG93LWlkJyB9LFxyXG4gICAgICAgICAgdXNlcklkOiB7IFM6ICd0ZXN0LXVzZXItaWQnIH0sXHJcbiAgICAgICAgICBpbnB1dElkOiB7IFM6ICd0ZXN0LWlucHV0LWlkJyB9LFxyXG4gICAgICAgICAgc3RhdHVzOiB7IFM6ICdjb250ZW50X2dlbmVyYXRpb24nIH0sXHJcbiAgICAgICAgICBjdXJyZW50U3RlcDogeyBTOiAnY29udGVudC1nZW5lcmF0aW9uJyB9LFxyXG4gICAgICAgICAgc3RlcHM6IHsgUzogSlNPTi5zdHJpbmdpZnkoW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgICBzdGVwVHlwZTogJ2NvbnRlbnRfZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgICAgc3RhdHVzOiAnaW5fcHJvZ3Jlc3MnLFxyXG4gICAgICAgICAgICAgIGFnZW50VHlwZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgICAgICAgICByZXRyeUNvdW50OiAxLFxyXG4gICAgICAgICAgICAgIG1heFJldHJpZXM6IDMsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdKSB9LFxyXG4gICAgICAgICAgY3JlYXRlZEF0OiB7IFM6ICcyMDIzLTAxLTAxVDAwOjAwOjAwWicgfSxcclxuICAgICAgICAgIHVwZGF0ZWRBdDogeyBTOiAnMjAyMy0wMS0wMVQwMDowMDowMFonIH0sXHJcbiAgICAgICAgICBtZXRhZGF0YTogeyBTOiBKU09OLnN0cmluZ2lmeSh7IG9yaWdpbmFsSW5wdXQ6ICd0ZXN0IGlucHV0JyB9KSB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFtcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgbWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJyxcclxuICAgICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdC1oYW5kbGUnLFxyXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgICAgbWVzc2FnZUlkOiAndGVzdC1hZ2VudC1tZXNzYWdlLWlkJyxcclxuICAgICAgICAgICAgICB3b3JrZmxvd0lkOiAndGVzdC13b3JrZmxvdy1pZCcsXHJcbiAgICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgICBhZ2VudFR5cGU6ICdjb250ZW50LWdlbmVyYXRvcicsXHJcbiAgICAgICAgICAgICAgbWVzc2FnZVR5cGU6ICdlcnJvcicsXHJcbiAgICAgICAgICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgICAgICAgICAgZXJyb3I6ICdDb250ZW50IGdlbmVyYXRpb24gZmFpbGVkJyxcclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgIHRpbWVzdGFtcDogJzIwMjMtMDEtMDFUMDA6MDA6MDBaJyxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgICAgICBBcHByb3hpbWF0ZVJlY2VpdmVDb3VudDogJzEnLFxyXG4gICAgICAgICAgICAgIFNlbnRUaW1lc3RhbXA6ICcxNjQwOTk1MjAwMDAwJyxcclxuICAgICAgICAgICAgICBTZW5kZXJJZDogJ3Rlc3Qtc2VuZGVyJyxcclxuICAgICAgICAgICAgICBBcHByb3hpbWF0ZUZpcnN0UmVjZWl2ZVRpbWVzdGFtcDogJzE2NDA5OTUyMDAwMDAnLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBtZXNzYWdlQXR0cmlidXRlczoge30sXHJcbiAgICAgICAgICAgIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcclxuICAgICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcclxuICAgICAgICAgICAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmNvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMScsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICAvLyBTaG91bGQgcmV0cnkgdGhlIHN0ZXAgKHNlbmQgbWVzc2FnZSBhZ2FpbilcclxuICAgICAgZXhwZWN0KG1vY2tTUVNDbGllbnQuc2VuZCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgaW5wdXQ6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICAgUXVldWVVcmw6ICdodHRwczovL3Nxcy51cy1lYXN0LTEuYW1hem9uYXdzLmNvbS8xMjM0NTY3ODkwMTIvY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgTWVzc2FnZUJvZHk6IGV4cGVjdC5zdHJpbmdDb250YWluaW5nKCdjb250ZW50LWdlbmVyYXRvcicpLFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1hbGZvcm1lZCBTUVMgbWVzc2FnZXMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IFNRU0V2ZW50ID0ge1xyXG4gICAgICAgIFJlY29yZHM6IFtcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgbWVzc2FnZUlkOiAndGVzdC1tZXNzYWdlLWlkJyxcclxuICAgICAgICAgICAgcmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdC1oYW5kbGUnLFxyXG4gICAgICAgICAgICBib2R5OiAnaW52YWxpZCBqc29uJyxcclxuICAgICAgICAgICAgYXR0cmlidXRlczoge1xyXG4gICAgICAgICAgICAgIEFwcHJveGltYXRlUmVjZWl2ZUNvdW50OiAnMScsXHJcbiAgICAgICAgICAgICAgU2VudFRpbWVzdGFtcDogJzE2NDA5OTUyMDAwMDAnLFxyXG4gICAgICAgICAgICAgIFNlbmRlcklkOiAndGVzdC1zZW5kZXInLFxyXG4gICAgICAgICAgICAgIEFwcHJveGltYXRlRmlyc3RSZWNlaXZlVGltZXN0YW1wOiAnMTY0MDk5NTIwMDAwMCcsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiB7fSxcclxuICAgICAgICAgICAgbWQ1T2ZCb2R5OiAndGVzdC1tZDUnLFxyXG4gICAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpzcXMnLFxyXG4gICAgICAgICAgICBldmVudFNvdXJjZUFSTjogJ2Fybjphd3M6c3FzOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6Y29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgYXdzUmVnaW9uOiAndXMtZWFzdC0xJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIFNob3VsZCBub3QgdGhyb3cgZXJyb3IsIGJ1dCBsb2cgaXRcclxuICAgICAgYXdhaXQgZXhwZWN0KGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KSkucmVzb2x2ZXMubm90LnRvVGhyb3coKTtcclxuXHJcbiAgICAgIC8vIFNob3VsZCBub3QgZGVsZXRlIHRoZSBtZXNzYWdlIChpdCB3aWxsIGJlIHJldHJpZWQpXHJcbiAgICAgIGV4cGVjdChtb2NrU1FTQ2xpZW50LnNlbmQpLm5vdC50b0hhdmVCZWVuQ2FsbGVkV2l0aChcclxuICAgICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICBpbnB1dDogZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgICBSZWNlaXB0SGFuZGxlOiAndGVzdC1yZWNlaXB0LWhhbmRsZScsXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdFcnJvciBIYW5kbGluZycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIER5bmFtb0RCIGVycm9ycyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBtb2NrRHluYW1vQ2xpZW50LnNlbmQubW9ja1JlamVjdGVkVmFsdWUobmV3IEVycm9yKCdEeW5hbW9EQiBlcnJvcicpKTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBFdmVudEJyaWRnZUV2ZW50PHN0cmluZywgYW55PiA9IHtcclxuICAgICAgICB2ZXJzaW9uOiAnMCcsXHJcbiAgICAgICAgaWQ6ICd0ZXN0LWV2ZW50LWlkJyxcclxuICAgICAgICAnZGV0YWlsLXR5cGUnOiAnQXVkaW8gUHJvY2Vzc2luZyBDb21wbGV0ZWQnLFxyXG4gICAgICAgIHNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbnB1dC1wcm9jZXNzb3InLFxyXG4gICAgICAgIGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLFxyXG4gICAgICAgIHRpbWU6ICcyMDIzLTAxLTAxVDAwOjAwOjAwWicsXHJcbiAgICAgICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcclxuICAgICAgICByZXNvdXJjZXM6IFtdLFxyXG4gICAgICAgIGRldGFpbDoge1xyXG4gICAgICAgICAgaW5wdXRJZDogJ3Rlc3QtaW5wdXQtaWQnLFxyXG4gICAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLWlkJyxcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb246ICdUaGlzIGlzIGEgdGVzdCB0cmFuc2NyaXB0aW9uJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgYXdhaXQgZXhwZWN0KGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KSkucmVqZWN0cy50b1Rocm93KCdEeW5hbW9EQiBlcnJvcicpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdW5rbm93biBldmVudCB0eXBlcyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCB1bmtub3duRXZlbnQgPSB7XHJcbiAgICAgICAgdW5rbm93blByb3BlcnR5OiAndW5rbm93biB2YWx1ZScsXHJcbiAgICAgIH0gYXMgYW55O1xyXG5cclxuICAgICAgLy8gU2hvdWxkIG5vdCB0aHJvdyBlcnJvclxyXG4gICAgICBhd2FpdCBleHBlY3QoaGFuZGxlcih1bmtub3duRXZlbnQsIG1vY2tDb250ZXh0KSkucmVzb2x2ZXMubm90LnRvVGhyb3coKTtcclxuXHJcbiAgICAgIC8vIFNob3VsZCBub3QgbWFrZSBhbnkgQVdTIGNhbGxzXHJcbiAgICAgIGV4cGVjdChtb2NrRHluYW1vQ2xpZW50LnNlbmQpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XHJcbiAgICAgIGV4cGVjdChtb2NrU1FTQ2xpZW50LnNlbmQpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XHJcbiAgICAgIGV4cGVjdChtb2NrRXZlbnRCcmlkZ2VDbGllbnQuc2VuZCkubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG59KTsiXX0=