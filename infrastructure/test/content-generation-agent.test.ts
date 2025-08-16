import { handler } from '../lambda/content-generation-agent';
import { SQSEvent, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// Mock AWS clients
const dynamoMock = mockClient(DynamoDBClient);
const eventBridgeMock = mockClient(EventBridgeClient);
const sqsMock = mockClient(SQSClient);

// Mock environment variables
process.env.USER_TABLE_NAME = 'test-users';
process.env.CONTENT_TABLE_NAME = 'test-content';
process.env.EVENT_BUS_NAME = 'test-events';
process.env.ORCHESTRATOR_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-orchestrator';
process.env.AWS_REGION = 'us-east-1';

describe('Content Generation Agent', () => {
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
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };

  beforeEach(() => {
    dynamoMock.reset();
    eventBridgeMock.reset();
    sqsMock.reset();
  });

  describe('Content Generation Request', () => {
    it('should successfully generate content from transcription', async () => {
      // Mock user preferences
      dynamoMock.on(GetItemCommand).resolves({
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
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: 'test-message-id'
      });

      // Mock successful EventBridge publish
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'test-event-id' }]
      });

      const event: SQSEvent = {
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

      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Verify user preferences were loaded
      expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(1);
      expect(dynamoMock.commandCalls(GetItemCommand)[0].args[0].input).toMatchObject({
        TableName: 'test-users',
        Key: { id: { S: 'user-123' } }
      });

      // Verify response was sent to orchestrator
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0].args[0].input;
      expect(sqsCall.QueueUrl).toBe('https://sqs.us-east-1.amazonaws.com/123456789012/test-orchestrator');
      
      const messageBody = JSON.parse(sqsCall.MessageBody!);
      expect(messageBody.messageType).toBe('response');
      expect(messageBody.payload.success).toBe(true);
      expect(messageBody.payload.content).toBeDefined();

      // Verify event was published
      expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(1);
      const eventCall = eventBridgeMock.commandCalls(PutEventsCommand)[0].args[0].input;
      expect(eventCall.Entries![0].Source).toBe('automated-blog-poster.content-agent');
      expect(eventCall.Entries![0].DetailType).toBe('Content Generation Completed');
    });

    it('should handle missing user preferences gracefully', async () => {
      // Mock user not found
      dynamoMock.on(GetItemCommand).resolves({});

      // Mock successful SQS send
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: 'test-message-id'
      });

      // Mock successful EventBridge publish
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'test-event-id' }]
      });

      const event: SQSEvent = {
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

      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Should still generate content with default preferences
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const messageBody = JSON.parse(sqsMock.commandCalls(SendMessageCommand)[0].args[0].input.MessageBody!);
      expect(messageBody.payload.success).toBe(true);
    });

    it('should handle content generation errors', async () => {
      // Mock user preferences
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          id: { S: 'user-123' },
          writingStyleContext: { S: JSON.stringify({}) }
        }
      });

      // Mock SQS error
      sqsMock.on(SendMessageCommand).rejects(new Error('SQS error'));

      const event: SQSEvent = {
        Records: [{
          messageId: 'test-message-id',
          receiptHandle: 'test-receipt-handle',
          body: JSON.stringify({
            messageType: 'request',
            payload: {
              workflowId: 'workflow-123',
              stepId: 'content-generation',
              input: '', // Empty input should cause validation error
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

      await expect(handler(event, mockContext)).rejects.toThrow();
    });
  });

  describe('Content Revision Request', () => {
    it('should successfully revise content based on feedback', async () => {
      // Mock user preferences
      dynamoMock.on(GetItemCommand).resolves({
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
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: 'test-message-id'
      });

      const event: SQSEvent = {
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

      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Verify response was sent
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const messageBody = JSON.parse(sqsMock.commandCalls(SendMessageCommand)[0].args[0].input.MessageBody!);
      expect(messageBody.payload.success).toBe(true);
      expect(messageBody.payload.revisionType).toBe('style');
      expect(messageBody.payload.content).toBeDefined();
    });

    it('should handle different revision types', async () => {
      // Mock user preferences
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          id: { S: 'user-123' },
          writingStyleContext: { S: JSON.stringify({}) }
        }
      });

      // Mock successful SQS send
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: 'test-message-id'
      });

      const revisionTypes = ['content', 'style', 'structure', 'tone'];

      for (const revisionType of revisionTypes) {
        const event: SQSEvent = {
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

        await expect(handler(event, mockContext)).resolves.not.toThrow();
      }

      // Should have processed all revision types
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(revisionTypes.length);
    });
  });

  describe('Content Validation', () => {
    it('should validate content quality correctly', async () => {
      // This test would be more comprehensive in a real implementation
      // For now, we'll test the basic structure
      
      // Mock user preferences
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          id: { S: 'user-123' },
          writingStyleContext: { S: JSON.stringify({}) }
        }
      });

      // Mock successful SQS send
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: 'test-message-id'
      });

      // Mock successful EventBridge publish
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'test-event-id' }]
      });

      const event: SQSEvent = {
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

      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Verify content was generated and validated
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const messageBody = JSON.parse(sqsMock.commandCalls(SendMessageCommand)[0].args[0].input.MessageBody!);
      expect(messageBody.payload.success).toBe(true);
      expect(messageBody.payload.content.quality).toBeDefined();
      expect(messageBody.payload.content.quality.score).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown message types gracefully', async () => {
      const event: SQSEvent = {
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
      await expect(handler(event, mockContext)).resolves.not.toThrow();
    });

    it('should handle malformed SQS messages', async () => {
      const event: SQSEvent = {
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

      await expect(handler(event, mockContext)).rejects.toThrow();
    });
  });
});