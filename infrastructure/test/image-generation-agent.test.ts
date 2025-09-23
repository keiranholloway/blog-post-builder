import { handler } from '../lambda/image-generation-agent';
import { SQSEvent, Context, APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
process.env.EVENT_BUS_NAME = 'test-events';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.AWS_REGION = 'us-east-1';

describe('Image Generation Agent', () => {
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

  describe('SQS Event Handling', () => {
    it('should successfully generate image from SQS request', async () => {
      // Mock OpenAI API response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ url: 'https://example.com/generated-image.png' }]
        }),
      });

      // Mock image download
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      });

      // Mock S3 uploads
      s3Mock.on(PutObjectCommand).resolves({});

      // Mock SQS send
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: 'test-message-id'
      });

      // Mock EventBridge publish
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

      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Verify OpenAI API was called
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-openai-key'
          })
        })
      );

      // Verify S3 uploads (original and optimized)
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);

      // Verify response was sent to orchestrator
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const sqsCall = sqsMock.commandCalls(SendMessageCommand)[0].args[0].input;
      const messageBody = JSON.parse(sqsCall.MessageBody!);
      expect(messageBody.messageType).toBe('response');
      expect(messageBody.payload.success).toBe(true);
      expect(messageBody.payload.imageUrl).toBeDefined();

      // Verify event was published
      expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(1);
      const eventCall = eventBridgeMock.commandCalls(PutEventsCommand)[0].args[0].input;
      expect(eventCall.Entries![0].Source).toBe('automated-blog-poster.image-agent');
      expect(eventCall.Entries![0].DetailType).toBe('Image Generation Completed');
    });

    it('should handle image revision requests', async () => {
      // Mock OpenAI API response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ url: 'https://example.com/revised-image.png' }]
        }),
      });

      // Mock image download
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      });

      // Mock S3 uploads
      s3Mock.on(PutObjectCommand).resolves({});

      // Mock SQS send
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

      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Verify response was sent
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const messageBody = JSON.parse(sqsMock.commandCalls(SendMessageCommand)[0].args[0].input.MessageBody!);
      expect(messageBody.payload.success).toBe(true);
      expect(messageBody.payload.feedback).toBe('Make it more colorful and vibrant');
    });

    it('should handle OpenAI API errors gracefully', async () => {
      // Mock OpenAI API error
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: 'Rate limit exceeded' }
        }),
      });

      // Mock SQS send
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: 'test-message-id'
      });

      // Mock EventBridge publish
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

      await expect(handler(event, mockContext)).resolves.not.toThrow();

      // Verify error response was sent
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      const messageBody = JSON.parse(sqsMock.commandCalls(SendMessageCommand)[0].args[0].input.MessageBody!);
      expect(messageBody.messageType).toBe('error');
      expect(messageBody.payload.success).toBe(false);
      expect(messageBody.payload.error).toContain('Rate limit exceeded');

      // Verify failure event was published
      expect(eventBridgeMock.commandCalls(PutEventsCommand)).toHaveLength(1);
      const eventCall = eventBridgeMock.commandCalls(PutEventsCommand)[0].args[0].input;
      expect(eventCall.Entries![0].DetailType).toBe('Image Generation Failed');
    });
  });

  describe('API Gateway Event Handling', () => {
    it('should handle direct image generation API call', async () => {
      // Mock OpenAI API response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ url: 'https://example.com/generated-image.png' }]
        }),
      });

      // Mock image download
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      });

      // Mock S3 uploads
      s3Mock.on(PutObjectCommand).resolves({});

      // Mock DynamoDB update
      docClientMock.on(UpdateCommand).resolves({});

      const event: APIGatewayProxyEvent = {
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

      const result = await handler(event, mockContext);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(200);
      
      const responseBody = JSON.parse((result as any).body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.imageUrl).toBeDefined();
      expect(responseBody.metadata).toBeDefined();

      // Verify S3 uploads occurred
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);

      // Verify content was updated
      expect(docClientMock.commandCalls(UpdateCommand)).toHaveLength(1);
    });

    it('should handle content analysis API call', async () => {
      const event: APIGatewayProxyEvent = {
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

      const result = await handler(event, mockContext);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(200);
      
      const responseBody = JSON.parse((result as any).body);
      expect(responseBody.prompt).toBeDefined();
      expect(responseBody.style).toBeDefined();
      expect(responseBody.concepts).toContain('cloud');
      expect(responseBody.concepts).toContain('aws');
      expect(responseBody.concepts).toContain('serverless');
    });

    it('should handle CORS preflight requests', async () => {
      const event: APIGatewayProxyEvent = {
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

      const result = await handler(event, mockContext);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(200);
      expect((result as any).headers['Access-Control-Allow-Origin']).toBe('https://keiranholloway.github.io');
      expect((result as any).headers['Access-Control-Allow-Methods']).toContain('POST');
    });
  });

  describe('Content Analysis', () => {
    it('should extract relevant concepts from technical content', async () => {
      const content = 'This article explores AWS Lambda, Kubernetes orchestration, and serverless architecture patterns for modern cloud infrastructure.';
      
      // We need to test the internal function, but since it's not exported, we'll test through the API
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/image/analyze',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '/api/image/analyze',
        isBase64Encoded: false,
        multiValueHeaders: {}
      };

      const result = await handler(event, mockContext);
      const responseBody = JSON.parse((result as any).body);

      expect(responseBody.concepts).toContain('aws');
      expect(responseBody.concepts).toContain('kubernetes');
      expect(responseBody.concepts).toContain('serverless');
      expect(responseBody.tone).toBe('technical');
      expect(responseBody.prompt).toContain('technical diagram');
    });

    it('should handle business-focused content', async () => {
      const content = 'This business strategy article discusses enterprise transformation, cost optimization, and organizational change management.';
      
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/image/analyze',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '/api/image/analyze',
        isBase64Encoded: false,
        multiValueHeaders: {}
      };

      const result = await handler(event, mockContext);
      const responseBody = JSON.parse((result as any).body);

      expect(responseBody.concepts).toContain('enterprise');
      expect(responseBody.tone).toBe('professional');
      expect(responseBody.style).toBe('professional');
      expect(responseBody.prompt).toContain('professional illustration');
    });
  });

  describe('Error Handling', () => {
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

    it('should handle missing API request body', async () => {
      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/image/generate',
        headers: { 'Content-Type': 'application/json' },
        body: null,
        pathParameters: null,
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '/api/image/generate',
        isBase64Encoded: false,
        multiValueHeaders: {}
      };

      const result = await handler(event, mockContext);

      expect((result as any).statusCode).toBe(400);
      const responseBody = JSON.parse((result as any).body);
      expect(responseBody.error).toBe('Request body is required');
    });

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
  });
});