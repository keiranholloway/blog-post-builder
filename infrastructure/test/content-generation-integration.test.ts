import { handler as apiHandler } from '../lambda/api-handler';
import { handler as orchestratorHandler } from '../lambda/content-orchestrator';
import { handler as contentAgentHandler } from '../lambda/content-generation-agent';
import { APIGatewayProxyEvent, Context, SQSEvent, EventBridgeEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// Helper function to create API Gateway event
function createAPIGatewayEvent(
  method: string,
  path: string,
  body?: string
): APIGatewayProxyEvent {
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
    } as any,
    resource: path,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null
  };
}

// Mock AWS clients
const dynamoMock = mockClient(DynamoDBClient);
const eventBridgeMock = mockClient(EventBridgeClient);
const sqsMock = mockClient(SQSClient);

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

  describe('End-to-End Content Generation Workflow', () => {
    it('should complete full content generation workflow', async () => {
      // Step 1: API receives content generation request
      const apiEvent = createAPIGatewayEvent(
        'POST',
        '/api/content/generate',
        JSON.stringify({
          transcription: 'I want to write about the benefits of remote work and how it has changed the modern workplace.',
          userId: 'user-123',
          userContext: 'Technology blogger with focus on workplace trends',
          preferences: {
            tone: 'professional',
            length: 'medium',
            targetAudience: 'business professionals'
          }
        })
      );

      // Mock successful DynamoDB put
      dynamoMock.on(PutItemCommand).resolves({});
      
      // Mock successful EventBridge publish
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'test-event-id' }]
      });

      const apiResponse = await apiHandler(apiEvent, mockContext);
      
      expect(apiResponse.statusCode).toBe(200);
      const apiResponseBody = JSON.parse(apiResponse.body);
      expect(apiResponseBody.data.contentId).toBeDefined();
      
      const contentId = apiResponseBody.data.contentId;

      // Step 2: Orchestrator receives EventBridge event and initiates workflow
      const orchestratorEvent: EventBridgeEvent<string, any> = {
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
      dynamoMock.on(PutItemCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'test-message-id' });

      // This would normally be triggered by EventBridge, but we'll call directly for testing
      await orchestratorHandler(orchestratorEvent, mockContext);

      // Verify workflow was created and message sent to content generation queue
      expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(3); // API content + workflow + agent message
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);

      // Step 3: Content generation agent processes the request
      const contentAgentEvent: SQSEvent = {
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
      dynamoMock.on(GetItemCommand).resolves({
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

      await contentAgentHandler(contentAgentEvent, mockContext);

      // Verify content was generated and response sent back
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(2); // orchestrator + agent response
      
      const agentResponseCall = sqsMock.commandCalls(SendMessageCommand)[1];
      const agentResponseBody = JSON.parse(agentResponseCall.args[0].input.MessageBody!);
      expect(agentResponseBody.messageType).toBe('response');
      expect(agentResponseBody.payload.success).toBe(true);
      expect(agentResponseBody.payload.content).toBeDefined();
      expect(agentResponseBody.payload.content.title).toBeDefined();
      expect(agentResponseBody.payload.content.content).toBeDefined();
      expect(agentResponseBody.payload.content.wordCount).toBeGreaterThan(0);

      // Step 4: Verify API can retrieve the generated content
      const getContentEvent = createAPIGatewayEvent('GET', `/api/content/${contentId}`);

      // Mock content retrieval
      dynamoMock.on(GetItemCommand).resolves({
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

      const getContentResponse = await apiHandler(getContentEvent, mockContext);
      
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
      const revisionEvent = createAPIGatewayEvent(
        'POST',
        '/api/content/revise',
        JSON.stringify({
          contentId,
          currentContent: 'This is the current blog post that needs improvement.',
          feedback: 'Please make it more engaging and add specific examples.',
          revisionType: 'style',
          userId: 'user-123'
        })
      );

      // Mock successful EventBridge publish
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'test-event-id' }]
      });

      const apiResponse = await apiHandler(revisionEvent, mockContext);
      
      expect(apiResponse.statusCode).toBe(200);
      const apiResponseBody = JSON.parse(apiResponse.body);
      expect(apiResponseBody.data.revisionId).toBeDefined();

      // Step 2: Content agent processes revision request
      const revisionAgentEvent: SQSEvent = {
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
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          id: { S: 'user-123' },
          writingStyleContext: { S: JSON.stringify({
            tone: 'conversational',
            writingStyle: 'engaging and example-rich'
          }) }
        }
      });

      // Mock successful SQS send
      sqsMock.on(SendMessageCommand).resolves({
        MessageId: 'test-message-id'
      });

      await contentAgentHandler(revisionAgentEvent, mockContext);

      // Verify revision was processed
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
      
      const revisionResponseCall = sqsMock.commandCalls(SendMessageCommand)[0];
      const revisionResponseBody = JSON.parse(revisionResponseCall.args[0].input.MessageBody!);
      expect(revisionResponseBody.messageType).toBe('response');
      expect(revisionResponseBody.payload.success).toBe(true);
      expect(revisionResponseBody.payload.revisionType).toBe('style');
      expect(revisionResponseBody.payload.content).toBeDefined();
    });
  });

  describe('Content Validation Integration', () => {
    it('should validate content through API endpoint', async () => {
      const validationEvent = createAPIGatewayEvent(
        'POST',
        '/api/content/validate',
        JSON.stringify({
          content: 'This is a comprehensive blog post about productivity techniques. It includes multiple paragraphs with detailed explanations and practical examples. The content is well-structured with clear headings and provides valuable insights for readers interested in improving their productivity.'
        })
      );

      const response = await apiHandler(validationEvent, mockContext);
      
      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.data.isValid).toBe(true);
      expect(responseBody.data.score).toBeGreaterThan(7);
      expect(responseBody.data.issues).toEqual([]);
      expect(responseBody.data.suggestions).toBeDefined();
    });

    it('should identify content quality issues', async () => {
      const validationEvent = createAPIGatewayEvent(
        'POST',
        '/api/content/validate',
        JSON.stringify({
          content: 'Short content' // Too short, no proper ending
        })
      );

      const response = await apiHandler(validationEvent, mockContext);
      
      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.data.isValid).toBe(false);
      expect(responseBody.data.score).toBeLessThan(7);
      expect(responseBody.data.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle API errors gracefully', async () => {
      const invalidEvent = createAPIGatewayEvent(
        'POST',
        '/api/content/generate',
        JSON.stringify({
          // Missing required fields
          transcription: '',
          userId: ''
        })
      );

      const response = await apiHandler(invalidEvent, mockContext);
      
      expect(response.statusCode).toBe(400);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toBe('Bad Request');
      expect(responseBody.message).toContain('required');
    });

    it('should handle DynamoDB errors', async () => {
      const apiEvent = createAPIGatewayEvent(
        'POST',
        '/api/content/generate',
        JSON.stringify({
          transcription: 'Valid transcription',
          userId: 'user-123'
        })
      );

      // Mock DynamoDB error
      dynamoMock.on(PutItemCommand).rejects(new Error('DynamoDB error'));

      const response = await apiHandler(apiEvent, mockContext);
      
      expect(response.statusCode).toBe(500);
      const responseBody = JSON.parse(response.body);
      expect(responseBody.error).toBe('Internal Server Error');
    });
  });
});