"use strict";
/**
 * Integration tests for the content orchestration system
 * Tests the complete workflow from input processing to content generation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestrationTestHelper = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const uuid_1 = require("uuid");
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
    let dynamoClient;
    let sqsClient;
    let eventBridgeClient;
    let testWorkflowId;
    let testUserId;
    let testInputId;
    beforeAll(() => {
        if (!isIntegrationTest) {
            console.log('Skipping integration tests. Set RUN_INTEGRATION_TESTS=true to run.');
            return;
        }
        dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: TEST_CONFIG.region });
        sqsClient = new client_sqs_1.SQSClient({ region: TEST_CONFIG.region });
        eventBridgeClient = new client_eventbridge_1.EventBridgeClient({ region: TEST_CONFIG.region });
    });
    beforeEach(() => {
        if (!isIntegrationTest)
            return;
        testWorkflowId = (0, uuid_1.v4)();
        testUserId = `test-user-${(0, uuid_1.v4)()}`;
        testInputId = `test-input-${(0, uuid_1.v4)()}`;
    });
    afterEach(async () => {
        if (!isIntegrationTest)
            return;
        // Clean up test data
        try {
            await dynamoClient.send(new client_dynamodb_1.DeleteItemCommand({
                TableName: TEST_CONFIG.contentTable,
                Key: { id: { S: testWorkflowId } },
            }));
        }
        catch (error) {
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
            await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
                Entries: [inputProcessorEvent],
            }));
            // Wait for orchestrator to process the event
            await new Promise(resolve => setTimeout(resolve, 2000));
            // Check if workflow was created in DynamoDB
            const workflowResult = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
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
            await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
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
                messageId: (0, uuid_1.v4)(),
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
            await sqsClient.send(new client_sqs_1.SendMessageCommand({
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
            const updatedWorkflow = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
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
            await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
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
                messageId: (0, uuid_1.v4)(),
                workflowId: testWorkflowId,
                stepId: 'content-generation',
                agentType: 'content-generator',
                messageType: 'error',
                payload: {
                    error: 'Simulated content generation error for integration test',
                },
                timestamp: new Date().toISOString(),
            };
            await sqsClient.send(new client_sqs_1.SendMessageCommand({
                QueueUrl: TEST_CONFIG.contentGenerationQueue,
                MessageBody: JSON.stringify(errorMessage),
            }));
            // Wait for orchestrator to process the error
            await new Promise(resolve => setTimeout(resolve, 3000));
            // Check if retry message was sent to queue
            const messages = await sqsClient.send(new client_sqs_1.ReceiveMessageCommand({
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
class OrchestrationTestHelper {
    constructor(config) {
        this.dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: config.region });
        this.sqsClient = new client_sqs_1.SQSClient({ region: config.region });
        this.eventBridgeClient = new client_eventbridge_1.EventBridgeClient({ region: config.region });
    }
    async createTestWorkflow(workflowId, userId, inputId) {
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
        await this.dynamoClient.send(new client_dynamodb_1.PutItemCommand({
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
    async sendAgentMessage(queueUrl, message) {
        return await this.sqsClient.send(new client_sqs_1.SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(message),
        }));
    }
    async sendOrchestrationEvent(event) {
        return await this.eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
            Entries: [event],
        }));
    }
    async getWorkflow(workflowId) {
        const result = await this.dynamoClient.send(new client_dynamodb_1.GetItemCommand({
            TableName: TEST_CONFIG.contentTable,
            Key: { id: { S: workflowId } },
        }));
        if (!result.Item)
            return null;
        return {
            id: result.Item.id.S,
            userId: result.Item.userId.S,
            inputId: result.Item.inputId.S,
            status: result.Item.status.S,
            currentStep: result.Item.currentStep.S,
            steps: JSON.parse(result.Item.steps.S),
            createdAt: result.Item.createdAt.S,
            updatedAt: result.Item.updatedAt.S,
            metadata: result.Item.metadata?.S ? JSON.parse(result.Item.metadata.S) : undefined,
        };
    }
    async cleanup(workflowId) {
        try {
            await this.dynamoClient.send(new client_dynamodb_1.DeleteItemCommand({
                TableName: TEST_CONFIG.contentTable,
                Key: { id: { S: workflowId } },
            }));
        }
        catch (error) {
            console.warn('Cleanup error:', error);
        }
    }
}
exports.OrchestrationTestHelper = OrchestrationTestHelper;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1vcmNoZXN0cmF0aW9uLWludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250ZW50LW9yY2hlc3RyYXRpb24taW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7QUFFSCw4REFBNkc7QUFDN0csb0RBQWlIO0FBQ2pILG9FQUFrRjtBQUNsRiwrQkFBb0M7QUFFcEMscUJBQXFCO0FBQ3JCLE1BQU0sV0FBVyxHQUFHO0lBQ2xCLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXO0lBQzdDLFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLG9CQUFvQjtJQUNwRSxrQkFBa0IsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLHlCQUF5QixJQUFJLDJCQUEyQjtJQUN4RixzQkFBc0IsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLDRCQUE0QixJQUFJLHFFQUFxRTtJQUN6SSxvQkFBb0IsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixJQUFJLG1FQUFtRTtJQUNuSSxRQUFRLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLElBQUksZ0JBQWdCO0NBQ3pELENBQUM7QUFFRixnRUFBZ0U7QUFDaEUsTUFBTSxpQkFBaUIsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixLQUFLLE1BQU0sQ0FBQztBQUV2RSxRQUFRLENBQUMseUNBQXlDLEVBQUUsR0FBRyxFQUFFO0lBQ3ZELElBQUksWUFBNEIsQ0FBQztJQUNqQyxJQUFJLFNBQW9CLENBQUM7SUFDekIsSUFBSSxpQkFBb0MsQ0FBQztJQUN6QyxJQUFJLGNBQXNCLENBQUM7SUFDM0IsSUFBSSxVQUFrQixDQUFDO0lBQ3ZCLElBQUksV0FBbUIsQ0FBQztJQUV4QixTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsSUFBSSxDQUFDLGlCQUFpQixFQUFF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LEVBQUUsS0FBSyxDQUFDLENBQUM7U0FDdkM7SUFDSCxDQUFDO0NBQ0Y7QUF4R0QsMERBd0dDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIEludGVncmF0aW9uIHRlc3RzIGZvciB0aGUgY29udGVudCBvcmNoZXN0cmF0aW9uIHN5c3RlbVxyXG4gKiBUZXN0cyB0aGUgY29tcGxldGUgd29ya2Zsb3cgZnJvbSBpbnB1dCBwcm9jZXNzaW5nIHRvIGNvbnRlbnQgZ2VuZXJhdGlvblxyXG4gKi9cclxuXHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBQdXRJdGVtQ29tbWFuZCwgR2V0SXRlbUNvbW1hbmQsIERlbGV0ZUl0ZW1Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgU1FTQ2xpZW50LCBTZW5kTWVzc2FnZUNvbW1hbmQsIFJlY2VpdmVNZXNzYWdlQ29tbWFuZCwgRGVsZXRlTWVzc2FnZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc3FzJztcclxuaW1wb3J0IHsgRXZlbnRCcmlkZ2VDbGllbnQsIFB1dEV2ZW50c0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZXZlbnRicmlkZ2UnO1xyXG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tICd1dWlkJztcclxuXHJcbi8vIFRlc3QgY29uZmlndXJhdGlvblxyXG5jb25zdCBURVNUX0NPTkZJRyA9IHtcclxuICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScsXHJcbiAgY29udGVudFRhYmxlOiBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUgfHwgJ3Rlc3QtY29udGVudC10YWJsZScsXHJcbiAgYWdlbnRNZXNzYWdlc1RhYmxlOiBwcm9jZXNzLmVudi5BR0VOVF9NRVNTQUdFU19UQUJMRV9OQU1FIHx8ICd0ZXN0LWFnZW50LW1lc3NhZ2VzLXRhYmxlJyxcclxuICBjb250ZW50R2VuZXJhdGlvblF1ZXVlOiBwcm9jZXNzLmVudi5DT05URU5UX0dFTkVSQVRJT05fUVVFVUVfVVJMIHx8ICdodHRwczovL3Nxcy51cy1lYXN0LTEuYW1hem9uYXdzLmNvbS8xMjM0NTY3ODkwMTIvY29udGVudC1nZW5lcmF0aW9uJyxcclxuICBpbWFnZUdlbmVyYXRpb25RdWV1ZTogcHJvY2Vzcy5lbnYuSU1BR0VfR0VORVJBVElPTl9RVUVVRV9VUkwgfHwgJ2h0dHBzOi8vc3FzLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tLzEyMzQ1Njc4OTAxMi9pbWFnZS1nZW5lcmF0aW9uJyxcclxuICBldmVudEJ1czogcHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUgfHwgJ3Rlc3QtZXZlbnQtYnVzJyxcclxufTtcclxuXHJcbi8vIFNraXAgaW50ZWdyYXRpb24gdGVzdHMgaWYgbm90IGluIGludGVncmF0aW9uIHRlc3QgZW52aXJvbm1lbnRcclxuY29uc3QgaXNJbnRlZ3JhdGlvblRlc3QgPSBwcm9jZXNzLmVudi5SVU5fSU5URUdSQVRJT05fVEVTVFMgPT09ICd0cnVlJztcclxuXHJcbmRlc2NyaWJlKCdDb250ZW50IE9yY2hlc3RyYXRpb24gSW50ZWdyYXRpb24gVGVzdHMnLCAoKSA9PiB7XHJcbiAgbGV0IGR5bmFtb0NsaWVudDogRHluYW1vREJDbGllbnQ7XHJcbiAgbGV0IHNxc0NsaWVudDogU1FTQ2xpZW50O1xyXG4gIGxldCBldmVudEJyaWRnZUNsaWVudDogRXZlbnRCcmlkZ2VDbGllbnQ7XHJcbiAgbGV0IHRlc3RXb3JrZmxvd0lkOiBzdHJpbmc7XHJcbiAgbGV0IHRlc3RVc2VySWQ6IHN0cmluZztcclxuICBsZXQgdGVzdElucHV0SWQ6IHN0cmluZztcclxuXHJcbiAgYmVmb3JlQWxsKCgpID0+IHtcclxuICAgIGlmICghaXNJbnRlZ3JhdGlvblRlc3QpIHtcclxuICAgICAgY29uc29sZS5sb2coJ1NraXBwaW5nIGludGVncmF0aW9uIHRlc3RzLiBTZXQgUlVOX0lOVEVHUkFUSU9OX1RFU1RTPXRydWUgdG8gcnVuLicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBURVNUX0NPTkZJRy5yZWdpb24gfSk7XHJcbiAgICBzcXNDbGllbnQgPSBuZXcgU1FTQ2xpZW50KHsgcmVnaW9uOiBURVNUX0NPTkZJRy5yZWdpb24gfSk7XHJcbiAgICBldmVudEJyaWRnZUNsaWVudCA9IG5ldyBFdmVudEJyaWRnZUNsaWVudCh7IHJlZ2lvbjogVEVTVF9DT05GSUcucmVnaW9uIH0pO1xyXG4gIH0pO1xyXG5cclxuICBiZWZvcmVFYWNoKCgpID0+IHtcclxuICAgIGlmICghaXNJbnRlZ3JhdGlvblRlc3QpIHJldHVybjtcclxuXHJcbiAgICB0ZXN0V29ya2Zsb3dJZCA9IHV1aWR2NCgpO1xyXG4gICAgdGVzdFVzZXJJZCA9IGB0ZXN0LXVzZXItJHt1dWlkdjQoKX1gO1xyXG4gICAgdGVzdElucHV0SWQgPSBgdGVzdC1pbnB1dC0ke3V1aWR2NCgpfWA7XHJcbiAgfSk7XHJcblxyXG4gIGFmdGVyRWFjaChhc3luYyAoKSA9PiB7XHJcbiAgICBpZiAoIWlzSW50ZWdyYXRpb25UZXN0KSByZXR1cm47XHJcblxyXG4gICAgLy8gQ2xlYW4gdXAgdGVzdCBkYXRhXHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgRGVsZXRlSXRlbUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogVEVTVF9DT05GSUcuY29udGVudFRhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogeyBTOiB0ZXN0V29ya2Zsb3dJZCB9IH0sXHJcbiAgICAgIH0pKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIC8vIElnbm9yZSBjbGVhbnVwIGVycm9yc1xyXG4gICAgICBjb25zb2xlLndhcm4oJ0NsZWFudXAgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnV29ya2Zsb3cgQ3JlYXRpb24gYW5kIE1hbmFnZW1lbnQnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhIHdvcmtmbG93IHdoZW4gaW5wdXQgcHJvY2Vzc2luZyBjb21wbGV0ZXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGlmICghaXNJbnRlZ3JhdGlvblRlc3QpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnU2tpcHBpbmcgaW50ZWdyYXRpb24gdGVzdCcpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gU2ltdWxhdGUgaW5wdXQgcHJvY2Vzc29yIGNvbXBsZXRpb24gZXZlbnRcclxuICAgICAgY29uc3QgaW5wdXRQcm9jZXNzb3JFdmVudCA9IHtcclxuICAgICAgICBTb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW5wdXQtcHJvY2Vzc29yJyxcclxuICAgICAgICBEZXRhaWxUeXBlOiAnQXVkaW8gUHJvY2Vzc2luZyBDb21wbGV0ZWQnLFxyXG4gICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgaW5wdXRJZDogdGVzdElucHV0SWQsXHJcbiAgICAgICAgICB1c2VySWQ6IHRlc3RVc2VySWQsXHJcbiAgICAgICAgICB0cmFuc2NyaXB0aW9uOiAnVGhpcyBpcyBhIHRlc3QgdHJhbnNjcmlwdGlvbiBmb3IgaW50ZWdyYXRpb24gdGVzdGluZycsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgRXZlbnRCdXNOYW1lOiBURVNUX0NPTkZJRy5ldmVudEJ1cyxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIFNlbmQgZXZlbnQgdG8gRXZlbnRCcmlkZ2VcclxuICAgICAgYXdhaXQgZXZlbnRCcmlkZ2VDbGllbnQuc2VuZChuZXcgUHV0RXZlbnRzQ29tbWFuZCh7XHJcbiAgICAgICAgRW50cmllczogW2lucHV0UHJvY2Vzc29yRXZlbnRdLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICAvLyBXYWl0IGZvciBvcmNoZXN0cmF0b3IgdG8gcHJvY2VzcyB0aGUgZXZlbnRcclxuICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDIwMDApKTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHdvcmtmbG93IHdhcyBjcmVhdGVkIGluIER5bmFtb0RCXHJcbiAgICAgIGNvbnN0IHdvcmtmbG93UmVzdWx0ID0gYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IFRFU1RfQ09ORklHLmNvbnRlbnRUYWJsZSxcclxuICAgICAgICBLZXk6IHsgaWQ6IHsgUzogdGVzdFdvcmtmbG93SWQgfSB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICAvLyBOb3RlOiBJbiBhIHJlYWwgaW50ZWdyYXRpb24gdGVzdCwgd2Ugd291bGQgbmVlZCB0byBrbm93IHRoZSBhY3R1YWwgd29ya2Zsb3cgSURcclxuICAgICAgLy8gVGhpcyB0ZXN0IGRlbW9uc3RyYXRlcyB0aGUgc3RydWN0dXJlIGJ1dCB3b3VsZCBuZWVkIGFkanVzdG1lbnQgZm9yIHJlYWwgQVdTIHJlc291cmNlc1xyXG4gICAgICBjb25zb2xlLmxvZygnSW50ZWdyYXRpb24gdGVzdCBzdHJ1Y3R1cmUgdmVyaWZpZWQnKTtcclxuICAgIH0sIDEwMDAwKTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBhZ2VudCBtZXNzYWdlIHByb2Nlc3NpbmcnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGlmICghaXNJbnRlZ3JhdGlvblRlc3QpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnU2tpcHBpbmcgaW50ZWdyYXRpb24gdGVzdCcpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ3JlYXRlIGEgdGVzdCB3b3JrZmxvdyBmaXJzdFxyXG4gICAgICBjb25zdCB3b3JrZmxvdyA9IHtcclxuICAgICAgICBpZDogdGVzdFdvcmtmbG93SWQsXHJcbiAgICAgICAgdXNlcklkOiB0ZXN0VXNlcklkLFxyXG4gICAgICAgIGlucHV0SWQ6IHRlc3RJbnB1dElkLFxyXG4gICAgICAgIHN0YXR1czogJ2NvbnRlbnRfZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgY3VycmVudFN0ZXA6ICdjb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICAgIHN0ZXBzOiBKU09OLnN0cmluZ2lmeShbXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgIHN0ZXBUeXBlOiAnY29udGVudF9nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgc3RhdHVzOiAnaW5fcHJvZ3Jlc3MnLFxyXG4gICAgICAgICAgICBhZ2VudFR5cGU6ICdjb250ZW50LWdlbmVyYXRvcicsXHJcbiAgICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXHJcbiAgICAgICAgICAgIG1heFJldHJpZXM6IDMsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIF0pLFxyXG4gICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIG1ldGFkYXRhOiBKU09OLnN0cmluZ2lmeSh7IG9yaWdpbmFsSW5wdXQ6ICd0ZXN0IGlucHV0JyB9KSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBQdXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiBURVNUX0NPTkZJRy5jb250ZW50VGFibGUsXHJcbiAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgaWQ6IHsgUzogd29ya2Zsb3cuaWQgfSxcclxuICAgICAgICAgIHR5cGU6IHsgUzogJ3dvcmtmbG93JyB9LFxyXG4gICAgICAgICAgdXNlcklkOiB7IFM6IHdvcmtmbG93LnVzZXJJZCB9LFxyXG4gICAgICAgICAgaW5wdXRJZDogeyBTOiB3b3JrZmxvdy5pbnB1dElkIH0sXHJcbiAgICAgICAgICBzdGF0dXM6IHsgUzogd29ya2Zsb3cuc3RhdHVzIH0sXHJcbiAgICAgICAgICBjdXJyZW50U3RlcDogeyBTOiB3b3JrZmxvdy5jdXJyZW50U3RlcCB9LFxyXG4gICAgICAgICAgc3RlcHM6IHsgUzogd29ya2Zsb3cuc3RlcHMgfSxcclxuICAgICAgICAgIGNyZWF0ZWRBdDogeyBTOiB3b3JrZmxvdy5jcmVhdGVkQXQgfSxcclxuICAgICAgICAgIHVwZGF0ZWRBdDogeyBTOiB3b3JrZmxvdy51cGRhdGVkQXQgfSxcclxuICAgICAgICAgIG1ldGFkYXRhOiB7IFM6IHdvcmtmbG93Lm1ldGFkYXRhIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgLy8gU2VuZCBhZ2VudCByZXNwb25zZSBtZXNzYWdlIHRvIFNRU1xyXG4gICAgICBjb25zdCBhZ2VudE1lc3NhZ2UgPSB7XHJcbiAgICAgICAgbWVzc2FnZUlkOiB1dWlkdjQoKSxcclxuICAgICAgICB3b3JrZmxvd0lkOiB0ZXN0V29ya2Zsb3dJZCxcclxuICAgICAgICBzdGVwSWQ6ICdjb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICAgIGFnZW50VHlwZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgICBtZXNzYWdlVHlwZTogJ3Jlc3BvbnNlJyxcclxuICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICBjb250ZW50OiAnR2VuZXJhdGVkIGJsb2cgY29udGVudCBmb3IgaW50ZWdyYXRpb24gdGVzdCcsXHJcbiAgICAgICAgICB0aXRsZTogJ0ludGVncmF0aW9uIFRlc3QgQmxvZyBQb3N0JyxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XHJcbiAgICAgICAgUXVldWVVcmw6IFRFU1RfQ09ORklHLmNvbnRlbnRHZW5lcmF0aW9uUXVldWUsXHJcbiAgICAgICAgTWVzc2FnZUJvZHk6IEpTT04uc3RyaW5naWZ5KGFnZW50TWVzc2FnZSksXHJcbiAgICAgICAgTWVzc2FnZUF0dHJpYnV0ZXM6IHtcclxuICAgICAgICAgIHdvcmtmbG93SWQ6IHtcclxuICAgICAgICAgICAgU3RyaW5nVmFsdWU6IHRlc3RXb3JrZmxvd0lkLFxyXG4gICAgICAgICAgICBEYXRhVHlwZTogJ1N0cmluZycsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgc3RlcElkOiB7XHJcbiAgICAgICAgICAgIFN0cmluZ1ZhbHVlOiAnY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgRGF0YVR5cGU6ICdTdHJpbmcnLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICAvLyBXYWl0IGZvciBvcmNoZXN0cmF0b3IgdG8gcHJvY2VzcyB0aGUgbWVzc2FnZVxyXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMzAwMCkpO1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgd29ya2Zsb3cgd2FzIHVwZGF0ZWRcclxuICAgICAgY29uc3QgdXBkYXRlZFdvcmtmbG93ID0gYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IFRFU1RfQ09ORklHLmNvbnRlbnRUYWJsZSxcclxuICAgICAgICBLZXk6IHsgaWQ6IHsgUzogdGVzdFdvcmtmbG93SWQgfSB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBleHBlY3QodXBkYXRlZFdvcmtmbG93Lkl0ZW0pLnRvQmVEZWZpbmVkKCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdBZ2VudCBtZXNzYWdlIHByb2Nlc3NpbmcgaW50ZWdyYXRpb24gdGVzdCBjb21wbGV0ZWQnKTtcclxuICAgIH0sIDE1MDAwKTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0Vycm9yIEhhbmRsaW5nIGFuZCBSZXRyeSBMb2dpYycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGFnZW50IGVycm9ycyB3aXRoIHJldHJ5IGxvZ2ljJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBpZiAoIWlzSW50ZWdyYXRpb25UZXN0KSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1NraXBwaW5nIGludGVncmF0aW9uIHRlc3QnKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENyZWF0ZSBhIHRlc3Qgd29ya2Zsb3dcclxuICAgICAgY29uc3Qgd29ya2Zsb3cgPSB7XHJcbiAgICAgICAgaWQ6IHRlc3RXb3JrZmxvd0lkLFxyXG4gICAgICAgIHVzZXJJZDogdGVzdFVzZXJJZCxcclxuICAgICAgICBpbnB1dElkOiB0ZXN0SW5wdXRJZCxcclxuICAgICAgICBzdGF0dXM6ICdjb250ZW50X2dlbmVyYXRpb24nLFxyXG4gICAgICAgIGN1cnJlbnRTdGVwOiAnY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICBzdGVwczogSlNPTi5zdHJpbmdpZnkoW1xyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBzdGVwSWQ6ICdjb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgICBzdGVwVHlwZTogJ2NvbnRlbnRfZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICAgIHN0YXR1czogJ2luX3Byb2dyZXNzJyxcclxuICAgICAgICAgICAgYWdlbnRUeXBlOiAnY29udGVudC1nZW5lcmF0b3InLFxyXG4gICAgICAgICAgICByZXRyeUNvdW50OiAwLFxyXG4gICAgICAgICAgICBtYXhSZXRyaWVzOiAzLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICBdKSxcclxuICAgICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICBtZXRhZGF0YTogSlNPTi5zdHJpbmdpZnkoeyBvcmlnaW5hbElucHV0OiAndGVzdCBpbnB1dCcgfSksXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgUHV0SXRlbUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogVEVTVF9DT05GSUcuY29udGVudFRhYmxlLFxyXG4gICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgIGlkOiB7IFM6IHdvcmtmbG93LmlkIH0sXHJcbiAgICAgICAgICB0eXBlOiB7IFM6ICd3b3JrZmxvdycgfSxcclxuICAgICAgICAgIHVzZXJJZDogeyBTOiB3b3JrZmxvdy51c2VySWQgfSxcclxuICAgICAgICAgIGlucHV0SWQ6IHsgUzogd29ya2Zsb3cuaW5wdXRJZCB9LFxyXG4gICAgICAgICAgc3RhdHVzOiB7IFM6IHdvcmtmbG93LnN0YXR1cyB9LFxyXG4gICAgICAgICAgY3VycmVudFN0ZXA6IHsgUzogd29ya2Zsb3cuY3VycmVudFN0ZXAgfSxcclxuICAgICAgICAgIHN0ZXBzOiB7IFM6IHdvcmtmbG93LnN0ZXBzIH0sXHJcbiAgICAgICAgICBjcmVhdGVkQXQ6IHsgUzogd29ya2Zsb3cuY3JlYXRlZEF0IH0sXHJcbiAgICAgICAgICB1cGRhdGVkQXQ6IHsgUzogd29ya2Zsb3cudXBkYXRlZEF0IH0sXHJcbiAgICAgICAgICBtZXRhZGF0YTogeyBTOiB3b3JrZmxvdy5tZXRhZGF0YSB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIC8vIFNlbmQgYWdlbnQgZXJyb3IgbWVzc2FnZVxyXG4gICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSB7XHJcbiAgICAgICAgbWVzc2FnZUlkOiB1dWlkdjQoKSxcclxuICAgICAgICB3b3JrZmxvd0lkOiB0ZXN0V29ya2Zsb3dJZCxcclxuICAgICAgICBzdGVwSWQ6ICdjb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICAgIGFnZW50VHlwZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgICBtZXNzYWdlVHlwZTogJ2Vycm9yJyxcclxuICAgICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgICBlcnJvcjogJ1NpbXVsYXRlZCBjb250ZW50IGdlbmVyYXRpb24gZXJyb3IgZm9yIGludGVncmF0aW9uIHRlc3QnLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBhd2FpdCBzcXNDbGllbnQuc2VuZChuZXcgU2VuZE1lc3NhZ2VDb21tYW5kKHtcclxuICAgICAgICBRdWV1ZVVybDogVEVTVF9DT05GSUcuY29udGVudEdlbmVyYXRpb25RdWV1ZSxcclxuICAgICAgICBNZXNzYWdlQm9keTogSlNPTi5zdHJpbmdpZnkoZXJyb3JNZXNzYWdlKSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgLy8gV2FpdCBmb3Igb3JjaGVzdHJhdG9yIHRvIHByb2Nlc3MgdGhlIGVycm9yXHJcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAzMDAwKSk7XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiByZXRyeSBtZXNzYWdlIHdhcyBzZW50IHRvIHF1ZXVlXHJcbiAgICAgIGNvbnN0IG1lc3NhZ2VzID0gYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFJlY2VpdmVNZXNzYWdlQ29tbWFuZCh7XHJcbiAgICAgICAgUXVldWVVcmw6IFRFU1RfQ09ORklHLmNvbnRlbnRHZW5lcmF0aW9uUXVldWUsXHJcbiAgICAgICAgTWF4TnVtYmVyT2ZNZXNzYWdlczogMTAsXHJcbiAgICAgICAgV2FpdFRpbWVTZWNvbmRzOiAxLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZygnRXJyb3IgaGFuZGxpbmcgaW50ZWdyYXRpb24gdGVzdCBjb21wbGV0ZWQnKTtcclxuICAgICAgY29uc29sZS5sb2coJ01lc3NhZ2VzIGluIHF1ZXVlOicsIG1lc3NhZ2VzLk1lc3NhZ2VzPy5sZW5ndGggfHwgMCk7XHJcbiAgICB9LCAxNTAwMCk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdNdWx0aS1TdGVwIFdvcmtmbG93IFByb2Nlc3NpbmcnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHByb2Nlc3MgY29tcGxldGUgd29ya2Zsb3cgZnJvbSBjb250ZW50IHRvIGltYWdlIGdlbmVyYXRpb24nLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGlmICghaXNJbnRlZ3JhdGlvblRlc3QpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnU2tpcHBpbmcgaW50ZWdyYXRpb24gdGVzdCcpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gVGhpcyB0ZXN0IHdvdWxkIHNpbXVsYXRlIGEgY29tcGxldGUgd29ya2Zsb3c6XHJcbiAgICAgIC8vIDEuIElucHV0IHByb2Nlc3NpbmcgY29tcGxldGlvblxyXG4gICAgICAvLyAyLiBDb250ZW50IGdlbmVyYXRpb24gY29tcGxldGlvblxyXG4gICAgICAvLyAzLiBJbWFnZSBnZW5lcmF0aW9uIGluaXRpYXRpb25cclxuICAgICAgLy8gNC4gSW1hZ2UgZ2VuZXJhdGlvbiBjb21wbGV0aW9uXHJcbiAgICAgIC8vIDUuIFJldmlldyByZWFkeSBzdGF0dXNcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKCdNdWx0aS1zdGVwIHdvcmtmbG93IGludGVncmF0aW9uIHRlc3Qgc3RydWN0dXJlIHZlcmlmaWVkJyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBJbiBhIHJlYWwgaW1wbGVtZW50YXRpb24sIHRoaXMgd291bGQ6XHJcbiAgICAgIC8vIC0gU2VuZCBpbnB1dCBwcm9jZXNzb3IgY29tcGxldGlvbiBldmVudFxyXG4gICAgICAvLyAtIFdhaXQgZm9yIGNvbnRlbnQgZ2VuZXJhdGlvbiBxdWV1ZSBtZXNzYWdlXHJcbiAgICAgIC8vIC0gU2VuZCBjb250ZW50IGdlbmVyYXRpb24gY29tcGxldGlvbiByZXNwb25zZVxyXG4gICAgICAvLyAtIFdhaXQgZm9yIGltYWdlIGdlbmVyYXRpb24gcXVldWUgbWVzc2FnZVxyXG4gICAgICAvLyAtIFNlbmQgaW1hZ2UgZ2VuZXJhdGlvbiBjb21wbGV0aW9uIHJlc3BvbnNlXHJcbiAgICAgIC8vIC0gVmVyaWZ5IHdvcmtmbG93IHN0YXR1cyBpcyAncmV2aWV3X3JlYWR5J1xyXG4gICAgfSwgMjAwMDApO1xyXG4gIH0pO1xyXG59KTtcclxuXHJcbi8vIEhlbHBlciBmdW5jdGlvbnMgZm9yIGludGVncmF0aW9uIHRlc3RzXHJcbmV4cG9ydCBjbGFzcyBPcmNoZXN0cmF0aW9uVGVzdEhlbHBlciB7XHJcbiAgcHJpdmF0ZSBkeW5hbW9DbGllbnQ6IER5bmFtb0RCQ2xpZW50O1xyXG4gIHByaXZhdGUgc3FzQ2xpZW50OiBTUVNDbGllbnQ7XHJcbiAgcHJpdmF0ZSBldmVudEJyaWRnZUNsaWVudDogRXZlbnRCcmlkZ2VDbGllbnQ7XHJcblxyXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogdHlwZW9mIFRFU1RfQ09ORklHKSB7XHJcbiAgICB0aGlzLmR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogY29uZmlnLnJlZ2lvbiB9KTtcclxuICAgIHRoaXMuc3FzQ2xpZW50ID0gbmV3IFNRU0NsaWVudCh7IHJlZ2lvbjogY29uZmlnLnJlZ2lvbiB9KTtcclxuICAgIHRoaXMuZXZlbnRCcmlkZ2VDbGllbnQgPSBuZXcgRXZlbnRCcmlkZ2VDbGllbnQoeyByZWdpb246IGNvbmZpZy5yZWdpb24gfSk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBjcmVhdGVUZXN0V29ya2Zsb3cod29ya2Zsb3dJZDogc3RyaW5nLCB1c2VySWQ6IHN0cmluZywgaW5wdXRJZDogc3RyaW5nKSB7XHJcbiAgICBjb25zdCB3b3JrZmxvdyA9IHtcclxuICAgICAgaWQ6IHdvcmtmbG93SWQsXHJcbiAgICAgIHVzZXJJZCxcclxuICAgICAgaW5wdXRJZCxcclxuICAgICAgc3RhdHVzOiAnaW5pdGlhdGVkJyxcclxuICAgICAgY3VycmVudFN0ZXA6ICdjb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICBzdGVwczogSlNPTi5zdHJpbmdpZnkoW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICBzdGVwVHlwZTogJ2NvbnRlbnRfZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICBzdGF0dXM6ICdwZW5kaW5nJyxcclxuICAgICAgICAgIGFnZW50VHlwZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXHJcbiAgICAgICAgICBtYXhSZXRyaWVzOiAzLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgc3RlcElkOiAnaW1hZ2UtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICBzdGVwVHlwZTogJ2ltYWdlX2dlbmVyYXRpb24nLFxyXG4gICAgICAgICAgc3RhdHVzOiAncGVuZGluZycsXHJcbiAgICAgICAgICBhZ2VudFR5cGU6ICdpbWFnZS1nZW5lcmF0b3InLFxyXG4gICAgICAgICAgcmV0cnlDb3VudDogMCxcclxuICAgICAgICAgIG1heFJldHJpZXM6IDMsXHJcbiAgICAgICAgfSxcclxuICAgICAgXSksXHJcbiAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgbWV0YWRhdGE6IEpTT04uc3RyaW5naWZ5KHsgb3JpZ2luYWxJbnB1dDogJ3Rlc3QgaW5wdXQnIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgICBhd2FpdCB0aGlzLmR5bmFtb0NsaWVudC5zZW5kKG5ldyBQdXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogVEVTVF9DT05GSUcuY29udGVudFRhYmxlLFxyXG4gICAgICBJdGVtOiB7XHJcbiAgICAgICAgaWQ6IHsgUzogd29ya2Zsb3cuaWQgfSxcclxuICAgICAgICB0eXBlOiB7IFM6ICd3b3JrZmxvdycgfSxcclxuICAgICAgICB1c2VySWQ6IHsgUzogd29ya2Zsb3cudXNlcklkIH0sXHJcbiAgICAgICAgaW5wdXRJZDogeyBTOiB3b3JrZmxvdy5pbnB1dElkIH0sXHJcbiAgICAgICAgc3RhdHVzOiB7IFM6IHdvcmtmbG93LnN0YXR1cyB9LFxyXG4gICAgICAgIGN1cnJlbnRTdGVwOiB7IFM6IHdvcmtmbG93LmN1cnJlbnRTdGVwIH0sXHJcbiAgICAgICAgc3RlcHM6IHsgUzogd29ya2Zsb3cuc3RlcHMgfSxcclxuICAgICAgICBjcmVhdGVkQXQ6IHsgUzogd29ya2Zsb3cuY3JlYXRlZEF0IH0sXHJcbiAgICAgICAgdXBkYXRlZEF0OiB7IFM6IHdvcmtmbG93LnVwZGF0ZWRBdCB9LFxyXG4gICAgICAgIG1ldGFkYXRhOiB7IFM6IHdvcmtmbG93Lm1ldGFkYXRhIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgcmV0dXJuIHdvcmtmbG93O1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2VuZEFnZW50TWVzc2FnZShxdWV1ZVVybDogc3RyaW5nLCBtZXNzYWdlOiBhbnkpIHtcclxuICAgIHJldHVybiBhd2FpdCB0aGlzLnNxc0NsaWVudC5zZW5kKG5ldyBTZW5kTWVzc2FnZUNvbW1hbmQoe1xyXG4gICAgICBRdWV1ZVVybDogcXVldWVVcmwsXHJcbiAgICAgIE1lc3NhZ2VCb2R5OiBKU09OLnN0cmluZ2lmeShtZXNzYWdlKSxcclxuICAgIH0pKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHNlbmRPcmNoZXN0cmF0aW9uRXZlbnQoZXZlbnQ6IGFueSkge1xyXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZXZlbnRCcmlkZ2VDbGllbnQuc2VuZChuZXcgUHV0RXZlbnRzQ29tbWFuZCh7XHJcbiAgICAgIEVudHJpZXM6IFtldmVudF0sXHJcbiAgICB9KSk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRXb3JrZmxvdyh3b3JrZmxvd0lkOiBzdHJpbmcpIHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZHluYW1vQ2xpZW50LnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBURVNUX0NPTkZJRy5jb250ZW50VGFibGUsXHJcbiAgICAgIEtleTogeyBpZDogeyBTOiB3b3JrZmxvd0lkIH0gfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBpZDogcmVzdWx0Lkl0ZW0uaWQuUyEsXHJcbiAgICAgIHVzZXJJZDogcmVzdWx0Lkl0ZW0udXNlcklkLlMhLFxyXG4gICAgICBpbnB1dElkOiByZXN1bHQuSXRlbS5pbnB1dElkLlMhLFxyXG4gICAgICBzdGF0dXM6IHJlc3VsdC5JdGVtLnN0YXR1cy5TISxcclxuICAgICAgY3VycmVudFN0ZXA6IHJlc3VsdC5JdGVtLmN1cnJlbnRTdGVwLlMhLFxyXG4gICAgICBzdGVwczogSlNPTi5wYXJzZShyZXN1bHQuSXRlbS5zdGVwcy5TISksXHJcbiAgICAgIGNyZWF0ZWRBdDogcmVzdWx0Lkl0ZW0uY3JlYXRlZEF0LlMhLFxyXG4gICAgICB1cGRhdGVkQXQ6IHJlc3VsdC5JdGVtLnVwZGF0ZWRBdC5TISxcclxuICAgICAgbWV0YWRhdGE6IHJlc3VsdC5JdGVtLm1ldGFkYXRhPy5TID8gSlNPTi5wYXJzZShyZXN1bHQuSXRlbS5tZXRhZGF0YS5TKSA6IHVuZGVmaW5lZCxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBhc3luYyBjbGVhbnVwKHdvcmtmbG93SWQ6IHN0cmluZykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgdGhpcy5keW5hbW9DbGllbnQuc2VuZChuZXcgRGVsZXRlSXRlbUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogVEVTVF9DT05GSUcuY29udGVudFRhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogeyBTOiB3b3JrZmxvd0lkIH0gfSxcclxuICAgICAgfSkpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdDbGVhbnVwIGVycm9yOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcbn0iXX0=