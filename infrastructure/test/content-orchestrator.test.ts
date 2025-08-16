import { EventBridgeEvent, SQSEvent, Context } from 'aws-lambda';

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

const mockContext: Context = {
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
import { handler } from '../lambda/content-orchestrator';

describe('Content Orchestrator', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoClient.send.mockResolvedValue({});
    mockSQSClient.send.mockResolvedValue({});
    mockEventBridgeClient.send.mockResolvedValue({});
  });

  describe('EventBridge Events', () => {
    it('should handle input processor completion event', async () => {
      const event: EventBridgeEvent<string, any> = {
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

      await handler(event, mockContext);

      // Should create workflow in DynamoDB
      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-content-table',
            Item: expect.objectContaining({
              type: { S: 'workflow' },
              userId: { S: 'test-user-id' },
              inputId: { S: 'test-input-id' },
              status: { S: 'initiated' },
            }),
          }),
        })
      );

      // Should send message to content generation queue
      expect(mockSQSClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/content-generation',
            MessageBody: expect.stringContaining('content-generator'),
          }),
        })
      );

      // Should publish orchestration event
      expect(mockEventBridgeClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Entries: expect.arrayContaining([
              expect.objectContaining({
                Source: 'automated-blog-poster.orchestrator',
                DetailType: 'step_completed',
              }),
            ]),
          }),
        })
      );
    });

    it('should handle text processing completion event', async () => {
      const event: EventBridgeEvent<string, any> = {
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

      await handler(event, mockContext);

      // Should create workflow and start content generation
      expect(mockDynamoClient.send).toHaveBeenCalled();
      expect(mockSQSClient.send).toHaveBeenCalled();
      expect(mockEventBridgeClient.send).toHaveBeenCalled();
    });

    it('should ignore unknown event sources', async () => {
      const event: EventBridgeEvent<string, any> = {
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

      await handler(event, mockContext);

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

      const event: SQSEvent = {
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

      await handler(event, mockContext);

      // Should update workflow status
      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-content-table',
            UpdateExpression: expect.stringContaining('SET #status = :status'),
          }),
        })
      );

      // Should send message to next queue (image generation)
      expect(mockSQSClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/image-generation',
          }),
        })
      );

      // Should delete processed message
      expect(mockSQSClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/content-generation',
            ReceiptHandle: 'test-receipt-handle',
          }),
        })
      );
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

      const event: SQSEvent = {
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

      await handler(event, mockContext);

      // Should retry the step (send message again)
      expect(mockSQSClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/content-generation',
            MessageBody: expect.stringContaining('content-generator'),
          }),
        })
      );
    });

    it('should handle malformed SQS messages gracefully', async () => {
      const event: SQSEvent = {
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
      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Should not delete the message (it will be retried)
      expect(mockSQSClient.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ReceiptHandle: 'test-receipt-handle',
          }),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle DynamoDB errors gracefully', async () => {
      mockDynamoClient.send.mockRejectedValue(new Error('DynamoDB error'));

      const event: EventBridgeEvent<string, any> = {
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

      await expect(handler(event, mockContext)).rejects.toThrow('DynamoDB error');
    });

    it('should handle unknown event types gracefully', async () => {
      const unknownEvent = {
        unknownProperty: 'unknown value',
      } as any;

      // Should not throw error
      await expect(handler(unknownEvent, mockContext)).resolves.not.toThrow();

      // Should not make any AWS calls
      expect(mockDynamoClient.send).not.toHaveBeenCalled();
      expect(mockSQSClient.send).not.toHaveBeenCalled();
      expect(mockEventBridgeClient.send).not.toHaveBeenCalled();
    });
  });
});