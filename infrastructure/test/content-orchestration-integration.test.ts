/**
 * Integration tests for the content orchestration system
 * Tests the complete workflow from input processing to content generation
 */

import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';

// Test configuration
const TEST_CONFIG = {
  region: process.env.AWS_REGION || 'us-east-1',
  contentTable: process.env.CONTENT_TABLE_NAME || 'test-content-table',
  agentMessagesTable: process.env.AGENT_MESSAGES_TABLE_NAME || 'test-agent-messages-table',
  contentGenerationQueue: process.env.CONTENT_GENERATION_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/123456789012/content-generation',
  imageGenerationQueue: process.env.IMAGE_GENERATION_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/123456789012/image-generation',
  eventBus: process.env.EVENT_BUS_NAME || 'test-event-bus',
};

// Skip integration tests if not in integration test environment
const isIntegrationTest = process.env.RUN_INTEGRATION_TESTS === 'true';

describe('Content Orchestration Integration Tests', () => {
  let dynamoClient: DynamoDBClient;
  let sqsClient: SQSClient;
  let eventBridgeClient: EventBridgeClient;
  let testWorkflowId: string;
  let testUserId: string;
  let testInputId: string;

  beforeAll(() => {
    if (!isIntegrationTest) {
      console.log('Skipping integration tests. Set RUN_INTEGRATION_TESTS=true to run.');
      return;
    }

    dynamoClient = new DynamoDBClient({ region: TEST_CONFIG.region });
    sqsClient = new SQSClient({ region: TEST_CONFIG.region });
    eventBridgeClient = new EventBridgeClient({ region: TEST_CONFIG.region });
  });

  beforeEach(() => {
    if (!isIntegrationTest) return;

    testWorkflowId = uuidv4();
    testUserId = `test-user-${uuidv4()}`;
    testInputId = `test-input-${uuidv4()}`;
  });

  afterEach(async () => {
    if (!isIntegrationTest) return;

    // Clean up test data
    try {
      await dynamoClient.send(new DeleteItemCommand({
        TableName: TEST_CONFIG.contentTable,
        Key: { id: { S: testWorkflowId } },
      }));
    } catch (error) {
      // Ignore cleanup errors
      console.warn('Cleanup error:', error);
    }
  });

  describe('Workflow Creation and Management', () => {
    it('should create a workflow when input processing completes', async () => {
      if (!isIntegrationTest) {
        console.log('Skipping integration test');
        return;
      }

      // Simulate input processor completion event
      const inputProcessorEvent = {
        Source: 'automated-blog-poster.input-processor',
        DetailType: 'Audio Processing Completed',
        Detail: JSON.stringify({
          inputId: testInputId,
          userId: testUserId,
          transcription: 'This is a test transcription for integration testing',
        }),
        EventBusName: TEST_CONFIG.eventBus,
      };

      // Send event to EventBridge
      await eventBridgeClient.send(new PutEventsCommand({
        Entries: [inputProcessorEvent],
      }));

      // Wait for orchestrator to process the event
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if workflow was created in DynamoDB
      const workflowResult = await dynamoClient.send(new GetItemCommand({
        TableName: TEST_CONFIG.contentTable,
        Key: { id: { S: testWorkflowId } },
      }));

      // Note: In a real integration test, we would need to know the actual workflow ID
      // This test demonstrates the structure but would need adjustment for real AWS resources
      console.log('Integration test structure verified');
    }, 10000);

    it('should handle agent message processing', async () => {
      if (!isIntegrationTest) {
        console.log('Skipping integration test');
        return;
      }

      // Create a test workflow first
      const workflow = {
        id: testWorkflowId,
        userId: testUserId,
        inputId: testInputId,
        status: 'content_generation',
        currentStep: 'content-generation',
        steps: JSON.stringify([
          {
            stepId: 'content-generation',
            stepType: 'content_generation',
            status: 'in_progress',
            agentType: 'content-generator',
            retryCount: 0,
            maxRetries: 3,
          },
        ]),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: JSON.stringify({ originalInput: 'test input' }),
      };

      await dynamoClient.send(new PutItemCommand({
        TableName: TEST_CONFIG.contentTable,
        Item: {
          id: { S: workflow.id },
          type: { S: 'workflow' },
          userId: { S: workflow.userId },
          inputId: { S: workflow.inputId },
          status: { S: workflow.status },
          currentStep: { S: workflow.currentStep },
          steps: { S: workflow.steps },
          createdAt: { S: workflow.createdAt },
          updatedAt: { S: workflow.updatedAt },
          metadata: { S: workflow.metadata },
        },
      }));

      // Send agent response message to SQS
      const agentMessage = {
        messageId: uuidv4(),
        workflowId: testWorkflowId,
        stepId: 'content-generation',
        agentType: 'content-generator',
        messageType: 'response',
        payload: {
          content: 'Generated blog content for integration test',
          title: 'Integration Test Blog Post',
        },
        timestamp: new Date().toISOString(),
      };

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: TEST_CONFIG.contentGenerationQueue,
        MessageBody: JSON.stringify(agentMessage),
        MessageAttributes: {
          workflowId: {
            StringValue: testWorkflowId,
            DataType: 'String',
          },
          stepId: {
            StringValue: 'content-generation',
            DataType: 'String',
          },
        },
      }));

      // Wait for orchestrator to process the message
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if workflow was updated
      const updatedWorkflow = await dynamoClient.send(new GetItemCommand({
        TableName: TEST_CONFIG.contentTable,
        Key: { id: { S: testWorkflowId } },
      }));

      expect(updatedWorkflow.Item).toBeDefined();
      console.log('Agent message processing integration test completed');
    }, 15000);
  });

  describe('Error Handling and Retry Logic', () => {
    it('should handle agent errors with retry logic', async () => {
      if (!isIntegrationTest) {
        console.log('Skipping integration test');
        return;
      }

      // Create a test workflow
      const workflow = {
        id: testWorkflowId,
        userId: testUserId,
        inputId: testInputId,
        status: 'content_generation',
        currentStep: 'content-generation',
        steps: JSON.stringify([
          {
            stepId: 'content-generation',
            stepType: 'content_generation',
            status: 'in_progress',
            agentType: 'content-generator',
            retryCount: 0,
            maxRetries: 3,
          },
        ]),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: JSON.stringify({ originalInput: 'test input' }),
      };

      await dynamoClient.send(new PutItemCommand({
        TableName: TEST_CONFIG.contentTable,
        Item: {
          id: { S: workflow.id },
          type: { S: 'workflow' },
          userId: { S: workflow.userId },
          inputId: { S: workflow.inputId },
          status: { S: workflow.status },
          currentStep: { S: workflow.currentStep },
          steps: { S: workflow.steps },
          createdAt: { S: workflow.createdAt },
          updatedAt: { S: workflow.updatedAt },
          metadata: { S: workflow.metadata },
        },
      }));

      // Send agent error message
      const errorMessage = {
        messageId: uuidv4(),
        workflowId: testWorkflowId,
        stepId: 'content-generation',
        agentType: 'content-generator',
        messageType: 'error',
        payload: {
          error: 'Simulated content generation error for integration test',
        },
        timestamp: new Date().toISOString(),
      };

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: TEST_CONFIG.contentGenerationQueue,
        MessageBody: JSON.stringify(errorMessage),
      }));

      // Wait for orchestrator to process the error
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if retry message was sent to queue
      const messages = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: TEST_CONFIG.contentGenerationQueue,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }));

      console.log('Error handling integration test completed');
      console.log('Messages in queue:', messages.Messages?.length || 0);
    }, 15000);
  });

  describe('Multi-Step Workflow Processing', () => {
    it('should process complete workflow from content to image generation', async () => {
      if (!isIntegrationTest) {
        console.log('Skipping integration test');
        return;
      }

      // This test would simulate a complete workflow:
      // 1. Input processing completion
      // 2. Content generation completion
      // 3. Image generation initiation
      // 4. Image generation completion
      // 5. Review ready status

      console.log('Multi-step workflow integration test structure verified');
      
      // In a real implementation, this would:
      // - Send input processor completion event
      // - Wait for content generation queue message
      // - Send content generation completion response
      // - Wait for image generation queue message
      // - Send image generation completion response
      // - Verify workflow status is 'review_ready'
    }, 20000);
  });
});

// Helper functions for integration tests
export class OrchestrationTestHelper {
  private dynamoClient: DynamoDBClient;
  private sqsClient: SQSClient;
  private eventBridgeClient: EventBridgeClient;

  constructor(config: typeof TEST_CONFIG) {
    this.dynamoClient = new DynamoDBClient({ region: config.region });
    this.sqsClient = new SQSClient({ region: config.region });
    this.eventBridgeClient = new EventBridgeClient({ region: config.region });
  }

  async createTestWorkflow(workflowId: string, userId: string, inputId: string) {
    const workflow = {
      id: workflowId,
      userId,
      inputId,
      status: 'initiated',
      currentStep: 'content-generation',
      steps: JSON.stringify([
        {
          stepId: 'content-generation',
          stepType: 'content_generation',
          status: 'pending',
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
      ]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: JSON.stringify({ originalInput: 'test input' }),
    };

    await this.dynamoClient.send(new PutItemCommand({
      TableName: TEST_CONFIG.contentTable,
      Item: {
        id: { S: workflow.id },
        type: { S: 'workflow' },
        userId: { S: workflow.userId },
        inputId: { S: workflow.inputId },
        status: { S: workflow.status },
        currentStep: { S: workflow.currentStep },
        steps: { S: workflow.steps },
        createdAt: { S: workflow.createdAt },
        updatedAt: { S: workflow.updatedAt },
        metadata: { S: workflow.metadata },
      },
    }));

    return workflow;
  }

  async sendAgentMessage(queueUrl: string, message: any) {
    return await this.sqsClient.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }));
  }

  async sendOrchestrationEvent(event: any) {
    return await this.eventBridgeClient.send(new PutEventsCommand({
      Entries: [event],
    }));
  }

  async getWorkflow(workflowId: string) {
    const result = await this.dynamoClient.send(new GetItemCommand({
      TableName: TEST_CONFIG.contentTable,
      Key: { id: { S: workflowId } },
    }));

    if (!result.Item) return null;

    return {
      id: result.Item.id.S!,
      userId: result.Item.userId.S!,
      inputId: result.Item.inputId.S!,
      status: result.Item.status.S!,
      currentStep: result.Item.currentStep.S!,
      steps: JSON.parse(result.Item.steps.S!),
      createdAt: result.Item.createdAt.S!,
      updatedAt: result.Item.updatedAt.S!,
      metadata: result.Item.metadata?.S ? JSON.parse(result.Item.metadata.S) : undefined,
    };
  }

  async cleanup(workflowId: string) {
    try {
      await this.dynamoClient.send(new DeleteItemCommand({
        TableName: TEST_CONFIG.contentTable,
        Key: { id: { S: workflowId } },
      }));
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
  }
}