import { handler as imageGenerationHandler } from '../lambda/image-generation-agent';
import { handler as contentOrchestratorHandler } from '../lambda/content-orchestrator';
import { SQSEvent, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// Mock AWS clients
const dynamoMock = mockClient(DynamoDBClient);
const docClientMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);
const eventBridgeMock = mockClient(EventBridgeClient);

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
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '1024',
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
    docClientMock.reset();
    s3Mock.reset();
    sqsMock.reset();
    eventBridgeMock.reset();
    (global.fetch as jest.Mock).mockClear();
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

      docClientMock.on(GetCommand).resolves({
        Item: testContent
      });

      // Step 2: Mock successful image generation
      (global.fetch as jest.Mock)
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
      s3Mock.on(PutObjectCommand).resolves({});

      // Step 4: Mock DynamoDB updates
      docClientMock.on(UpdateCommand).resolves({});

      // Step 5: Mock SQS and EventBridge
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });

      // Step 6: Simulate orchestrator triggering image generation
      const orchestratorEvent: SQSEvent = {
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
      await expect(contentOrchestratorHandler(orchestratorEvent, mockContext)).resolves.not.toThrow();

      // Step 7: Simulate image generation agent processing
      const imageGenerationEvent: SQSEvent = {
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
      await expect(imageGenerationHandler(imageGenerationEvent, mockContext)).resolves.not.toThrow();

      // Verify the complete workflow
      
      // 1. Content was retrieved from DynamoDB
      expect(docClientMock.commandCalls(GetCommand)).toHaveLength(1);
      
      // 2. OpenAI API was called for image generation
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-openai-key'
          })
        })
      );

      // 3. Image was downloaded
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // 4. Both original and optimized images were stored in S3
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
      
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      const originalUpload = s3Calls.find(call => call.args[0].input.Key?.includes('original'));
      const optimizedUpload = s3Calls.find(call => call.args[0].input.Key?.includes('optimized'));
      
      expect(originalUpload).toBeDefined();
      expect(optimizedUpload).toBeDefined();
      expect(originalUpload?.args[0].input.ContentType).toBe('image/png');
      expect(optimizedUpload?.args[0].input.ContentType).toBe('image/webp');

      // 5. Content was updated with image URL
      expect(docClientMock.commandCalls(UpdateCommand)).toHaveLength(1);
      const updateCall = docClientMock.commandCalls(UpdateCommand)[0];
      expect(updateCall.args[0].input.UpdateExpression).toContain('#imageUrl');

      // 6. Success response was sent to orchestrator
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0];
      const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody!);
      expect(messageBody.messageType).toBe('response');
      expect(messageBody.payload.success).toBe(true);
      expect(messageBody.payload.imageUrl).toBeDefined();
      expect(messageBody.payload.metadata).toBeDefined();

      // 7. Success event was published
      expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(1);
      const eventCall = eventBridgeMock.commandCalls(PutEventsCommand)[0];
      expect(eventCall.args[0].input.Entries![0].Source).toBe('automated-blog-poster.image-agent');
      expect(eventCall.args[0].input.Entries![0].DetailType).toBe('Image Generation Completed');
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

      docClientMock.on(GetCommand).resolves({
        Item: existingContent
      });

      // Mock revised image generation
      (global.fetch as jest.Mock)
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

      s3Mock.on(PutObjectCommand).resolves({});
      docClientMock.on(UpdateCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

      // Simulate image revision request
      const revisionEvent: SQSEvent = {
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

      await expect(imageGenerationHandler(revisionEvent, mockContext)).resolves.not.toThrow();

      // Verify revision workflow
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        expect.objectContaining({
          body: expect.stringContaining('more colorful and vibrant')
        })
      );

      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
      expect(docClientMock.commandCalls(UpdateCommand)).toHaveLength(1);
      
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0];
      const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody!);
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
      const analysisEvent: SQSEvent = {
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
      (global.fetch as jest.Mock)
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

      s3Mock.on(PutObjectCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });

      await expect(imageGenerationHandler(analysisEvent, mockContext)).resolves.not.toThrow();

      // Verify that the generated prompt includes technical concepts
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        expect.objectContaining({
          body: expect.stringMatching(/aws|kubernetes|serverless|infrastructure|devops/i)
        })
      );

      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0];
      const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody!);
      expect(messageBody.payload.analysis).toBeDefined();
      expect(messageBody.payload.analysis.concepts).toEqual(
        expect.arrayContaining(['aws', 'kubernetes', 'serverless', 'infrastructure', 'devops'])
      );
    });
  });

  describe('Error Handling End-to-End', () => {
    it('should handle complete workflow failure gracefully', async () => {
      // Mock OpenAI API failure
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: 'Rate limit exceeded' }
        }),
      });

      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });

      const failureEvent: SQSEvent = {
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

      await expect(imageGenerationHandler(failureEvent, mockContext)).resolves.not.toThrow();

      // Verify error handling
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0];
      const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody!);
      expect(messageBody.messageType).toBe('error');
      expect(messageBody.payload.success).toBe(false);
      expect(messageBody.payload.error).toContain('Rate limit exceeded');
      expect(messageBody.payload.retryable).toBe(true);

      // Verify failure event was published
      const eventCall = eventBridgeMock.commandCalls(PutEventsCommand)[0];
      expect(eventCall.args[0].input.Entries![0].DetailType).toBe('Image Generation Failed');
    });

    it('should handle S3 storage failure in workflow', async () => {
      // Mock successful image generation but S3 failure
      (global.fetch as jest.Mock)
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
      s3Mock.on(PutObjectCommand).rejects(new Error('Access denied'));

      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });

      const s3FailureEvent: SQSEvent = {
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

      await expect(imageGenerationHandler(s3FailureEvent, mockContext)).resolves.not.toThrow();

      // Verify error was handled and reported
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0];
      const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody!);
      expect(messageBody.messageType).toBe('error');
      expect(messageBody.payload.error).toContain('Access denied');
    });
  });

  describe('Performance End-to-End', () => {
    it('should complete workflow within performance thresholds', async () => {
      const startTime = Date.now();

      // Mock fast responses
      (global.fetch as jest.Mock)
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

      s3Mock.on(PutObjectCommand).resolves({});
      docClientMock.on(UpdateCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });
      eventBridgeMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'test-event-id' }] });

      const performanceEvent: SQSEvent = {
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

      await imageGenerationHandler(performanceEvent, mockContext);

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should complete within reasonable time (allowing for mocks)
      expect(processingTime).toBeLessThan(5000); // 5 seconds for mocked operations

      // Verify successful completion
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0];
      const messageBody = JSON.parse(sqsCall.args[0].input.MessageBody!);
      expect(messageBody.payload.success).toBe(true);
    });
  });
});