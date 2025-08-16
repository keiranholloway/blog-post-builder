"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const uuid_1 = require("uuid");
// Initialize AWS clients
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const sqsClient = new client_sqs_1.SQSClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({ region: process.env.AWS_REGION });
// Environment variables
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME;
const AGENT_MESSAGES_TABLE = process.env.AGENT_MESSAGES_TABLE_NAME;
const CONTENT_GENERATION_QUEUE = process.env.CONTENT_GENERATION_QUEUE_URL;
const IMAGE_GENERATION_QUEUE = process.env.IMAGE_GENERATION_QUEUE_URL;
const EVENT_BUS = process.env.EVENT_BUS_NAME;
/**
 * Main handler for content orchestration
 * Handles both EventBridge events and SQS messages
 */
const handler = async (event, _context) => {
    console.log('Content Orchestrator Event:', JSON.stringify(event, null, 2));
    try {
        // Determine event type and route accordingly
        if ('source' in event) {
            // EventBridge event
            await handleEventBridgeEvent(event);
        }
        else if ('Records' in event) {
            // SQS event
            await handleSQSEvent(event);
        }
        else {
            console.warn('Unknown event type received:', event);
        }
    }
    catch (error) {
        console.error('Error in content orchestrator:', error);
        throw error;
    }
};
exports.handler = handler;
/**
 * Handle EventBridge events that trigger workflow steps
 */
async function handleEventBridgeEvent(event) {
    const { source, 'detail-type': detailType, detail } = event;
    console.log(`Processing EventBridge event: ${source} - ${detailType}`);
    switch (source) {
        case 'automated-blog-poster.input-processor':
            await handleInputProcessorEvent(detailType, detail);
            break;
        case 'automated-blog-poster.content-agent':
            await handleContentAgentEvent(detailType, detail);
            break;
        case 'automated-blog-poster.image-agent':
            await handleImageAgentEvent(detailType, detail);
            break;
        default:
            console.warn(`Unknown event source: ${source}`);
    }
}
/**
 * Handle SQS messages from agent queues
 */
async function handleSQSEvent(event) {
    for (const record of event.Records) {
        try {
            const message = JSON.parse(record.body);
            console.log(`Processing SQS message: ${message.messageType} from ${message.agentType}`);
            await processAgentMessage(message);
            // Delete message from queue after successful processing
            await sqsClient.send(new client_sqs_1.DeleteMessageCommand({
                QueueUrl: record.eventSourceARN?.includes('content-generation') ? CONTENT_GENERATION_QUEUE : IMAGE_GENERATION_QUEUE,
                ReceiptHandle: record.receiptHandle,
            }));
        }
        catch (error) {
            console.error('Error processing SQS record:', error);
            // Message will remain in queue for retry
        }
    }
}
/**
 * Handle events from the input processor
 */
async function handleInputProcessorEvent(detailType, detail) {
    switch (detailType) {
        case 'Audio Processing Completed':
        case 'Text Processing Completed':
            await initiateContentWorkflow(detail);
            break;
        default:
            console.log(`Ignoring input processor event: ${detailType}`);
    }
}
/**
 * Handle events from content generation agents
 */
async function handleContentAgentEvent(detailType, detail) {
    switch (detailType) {
        case 'Content Generation Completed':
            await handleContentGenerationCompleted(detail);
            break;
        case 'Content Generation Failed':
            await handleContentGenerationFailed(detail);
            break;
        default:
            console.log(`Ignoring content agent event: ${detailType}`);
    }
}
/**
 * Handle events from image generation agents
 */
async function handleImageAgentEvent(detailType, detail) {
    switch (detailType) {
        case 'Image Generation Completed':
            await handleImageGenerationCompleted(detail);
            break;
        case 'Image Generation Failed':
            await handleImageGenerationFailed(detail);
            break;
        default:
            console.log(`Ignoring image agent event: ${detailType}`);
    }
}
/**
 * Initiate a new content workflow when input processing is completed
 */
async function initiateContentWorkflow(detail) {
    const workflowId = (0, uuid_1.v4)();
    const timestamp = new Date().toISOString();
    // Define workflow steps
    const steps = [
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
        {
            stepId: 'review',
            stepType: 'review',
            status: 'pending',
            retryCount: 0,
            maxRetries: 1,
        },
    ];
    // Create workflow record
    const workflow = {
        id: workflowId,
        userId: detail.userId,
        inputId: detail.inputId,
        status: 'initiated',
        currentStep: 'content-generation',
        steps,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: {
            originalInput: detail.transcription,
        },
    };
    // Store workflow in DynamoDB
    await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
        TableName: CONTENT_TABLE,
        Item: {
            id: { S: workflowId },
            type: { S: 'workflow' },
            userId: { S: workflow.userId },
            inputId: { S: workflow.inputId },
            status: { S: workflow.status },
            currentStep: { S: workflow.currentStep },
            steps: { S: JSON.stringify(workflow.steps) },
            createdAt: { S: workflow.createdAt },
            updatedAt: { S: workflow.updatedAt },
            metadata: { S: JSON.stringify(workflow.metadata) },
        },
    }));
    console.log(`Created workflow ${workflowId} for input ${detail.inputId}`);
    // Start the first step (content generation)
    await executeWorkflowStep(workflow, 'content-generation');
}
/**
 * Execute a specific workflow step
 */
async function executeWorkflowStep(workflow, stepId) {
    const step = workflow.steps.find(s => s.stepId === stepId);
    if (!step) {
        throw new Error(`Step ${stepId} not found in workflow ${workflow.id}`);
    }
    // Update step status to in_progress
    step.status = 'in_progress';
    step.startedAt = new Date().toISOString();
    // Update workflow
    await updateWorkflowStatus(workflow.id, 'content_generation', stepId, workflow.steps);
    // Send message to appropriate agent queue
    const agentMessage = {
        messageId: (0, uuid_1.v4)(),
        workflowId: workflow.id,
        stepId: step.stepId,
        agentType: step.agentType,
        messageType: 'request',
        payload: {
            workflowId: workflow.id,
            stepId: step.stepId,
            input: step.input || workflow.metadata?.originalInput,
            userId: workflow.userId,
            context: {
                previousSteps: workflow.steps.filter(s => s.status === 'completed'),
                userPreferences: {}, // TODO: Load from user profile
            },
        },
        timestamp: new Date().toISOString(),
    };
    // Store agent message
    await storeAgentMessage(agentMessage);
    // Send to appropriate queue
    const queueUrl = step.stepType === 'content_generation' ? CONTENT_GENERATION_QUEUE : IMAGE_GENERATION_QUEUE;
    await sqsClient.send(new client_sqs_1.SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(agentMessage),
        MessageAttributes: {
            workflowId: {
                StringValue: workflow.id,
                DataType: 'String',
            },
            stepId: {
                StringValue: step.stepId,
                DataType: 'String',
            },
            agentType: {
                StringValue: step.agentType,
                DataType: 'String',
            },
        },
    }));
    console.log(`Sent ${step.stepType} request to queue for workflow ${workflow.id}`);
    // Publish event
    await publishOrchestrationEvent({
        eventType: 'step_completed',
        workflowId: workflow.id,
        stepId: step.stepId,
        data: { stepType: step.stepType, status: 'started' },
        timestamp: new Date().toISOString(),
    });
}
/**
 * Process agent response messages
 */
async function processAgentMessage(message) {
    console.log(`Processing agent message: ${message.messageType} for workflow ${message.workflowId}`);
    // Load workflow
    const workflow = await loadWorkflow(message.workflowId);
    if (!workflow) {
        throw new Error(`Workflow ${message.workflowId} not found`);
    }
    const step = workflow.steps.find(s => s.stepId === message.stepId);
    if (!step) {
        throw new Error(`Step ${message.stepId} not found in workflow ${message.workflowId}`);
    }
    switch (message.messageType) {
        case 'response':
            await handleAgentResponse(workflow, step, message);
            break;
        case 'error':
            await handleAgentError(workflow, step, message);
            break;
        case 'status_update':
            await handleAgentStatusUpdate(workflow, step, message);
            break;
        default:
            console.warn(`Unknown message type: ${message.messageType}`);
    }
}
/**
 * Handle successful agent response
 */
async function handleAgentResponse(workflow, step, message) {
    // Update step with response
    step.status = 'completed';
    step.output = message.payload;
    step.completedAt = new Date().toISOString();
    // Update workflow
    await updateWorkflowStatus(workflow.id, workflow.status, workflow.currentStep, workflow.steps);
    console.log(`Step ${step.stepId} completed for workflow ${workflow.id}`);
    // Determine next step
    await processNextWorkflowStep(workflow);
}
/**
 * Handle agent error response
 */
async function handleAgentError(workflow, step, message) {
    step.error = message.payload.error || 'Unknown error';
    step.retryCount++;
    if (step.retryCount < step.maxRetries) {
        // Retry the step
        console.log(`Retrying step ${step.stepId} (attempt ${step.retryCount + 1}/${step.maxRetries})`);
        step.status = 'pending';
        await executeWorkflowStep(workflow, step.stepId);
    }
    else {
        // Mark step as failed
        step.status = 'failed';
        step.completedAt = new Date().toISOString();
        // Mark workflow as failed
        workflow.status = 'failed';
        await updateWorkflowStatus(workflow.id, 'failed', workflow.currentStep, workflow.steps);
        // Publish failure event
        await publishOrchestrationEvent({
            eventType: 'error_occurred',
            workflowId: workflow.id,
            stepId: step.stepId,
            data: { error: step.error, stepType: step.stepType },
            timestamp: new Date().toISOString(),
        });
        console.error(`Step ${step.stepId} failed permanently for workflow ${workflow.id}: ${step.error}`);
    }
}
/**
 * Handle agent status update
 */
async function handleAgentStatusUpdate(workflow, step, message) {
    console.log(`Status update for step ${step.stepId}: ${JSON.stringify(message.payload)}`);
    // Store the status update but don't change step status
    await storeAgentMessage(message);
}
/**
 * Process the next step in the workflow
 */
async function processNextWorkflowStep(workflow) {
    const currentStepIndex = workflow.steps.findIndex(s => s.stepId === workflow.currentStep);
    const nextStep = workflow.steps[currentStepIndex + 1];
    if (nextStep) {
        // Move to next step
        workflow.currentStep = nextStep.stepId;
        await executeWorkflowStep(workflow, nextStep.stepId);
    }
    else {
        // Workflow completed
        workflow.status = 'review_ready';
        workflow.currentStep = 'completed';
        await updateWorkflowStatus(workflow.id, 'review_ready', 'completed', workflow.steps);
        // Publish completion event
        await publishOrchestrationEvent({
            eventType: 'workflow_completed',
            workflowId: workflow.id,
            data: {
                status: 'review_ready',
                completedSteps: workflow.steps.filter(s => s.status === 'completed').length,
                totalSteps: workflow.steps.length,
            },
            timestamp: new Date().toISOString(),
        });
        console.log(`Workflow ${workflow.id} completed and ready for review`);
    }
}
/**
 * Handle content generation completion
 */
async function handleContentGenerationCompleted(detail) {
    console.log('Content generation completed:', detail);
    // This will be handled by the SQS message processing
}
/**
 * Handle content generation failure
 */
async function handleContentGenerationFailed(detail) {
    console.log('Content generation failed:', detail);
    // This will be handled by the SQS message processing
}
/**
 * Handle image generation completion
 */
async function handleImageGenerationCompleted(detail) {
    console.log('Image generation completed:', detail);
    // This will be handled by the SQS message processing
}
/**
 * Handle image generation failure
 */
async function handleImageGenerationFailed(detail) {
    console.log('Image generation failed:', detail);
    // This will be handled by the SQS message processing
}
/**
 * Load workflow from DynamoDB
 */
async function loadWorkflow(workflowId) {
    try {
        const result = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
            TableName: CONTENT_TABLE,
            Key: {
                id: { S: workflowId },
            },
        }));
        if (!result.Item) {
            return null;
        }
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
    catch (error) {
        console.error('Error loading workflow:', error);
        return null;
    }
}
/**
 * Update workflow status in DynamoDB
 */
async function updateWorkflowStatus(workflowId, status, currentStep, steps) {
    await dynamoClient.send(new client_dynamodb_1.UpdateItemCommand({
        TableName: CONTENT_TABLE,
        Key: {
            id: { S: workflowId },
        },
        UpdateExpression: 'SET #status = :status, currentStep = :currentStep, steps = :steps, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
            '#status': 'status',
        },
        ExpressionAttributeValues: {
            ':status': { S: status },
            ':currentStep': { S: currentStep },
            ':steps': { S: JSON.stringify(steps) },
            ':updatedAt': { S: new Date().toISOString() },
        },
    }));
}
/**
 * Store agent message in DynamoDB
 */
async function storeAgentMessage(message) {
    await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
        TableName: AGENT_MESSAGES_TABLE,
        Item: {
            id: { S: message.messageId },
            workflowId: { S: message.workflowId },
            stepId: { S: message.stepId },
            agentType: { S: message.agentType },
            messageType: { S: message.messageType },
            payload: { S: JSON.stringify(message.payload) },
            timestamp: { S: message.timestamp },
            retryCount: { N: (message.retryCount || 0).toString() },
        },
    }));
}
/**
 * Publish orchestration event to EventBridge
 */
async function publishOrchestrationEvent(event) {
    await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
        Entries: [{
                Source: 'automated-blog-poster.orchestrator',
                DetailType: event.eventType,
                Detail: JSON.stringify({
                    workflowId: event.workflowId,
                    stepId: event.stepId,
                    data: event.data,
                    timestamp: event.timestamp,
                }),
                EventBusName: EVENT_BUS,
            }],
    }));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1vcmNoZXN0cmF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250ZW50LW9yY2hlc3RyYXRvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBNkc7QUFDN0csb0RBQTBGO0FBQzFGLG9FQUFrRjtBQUNsRiwrQkFBb0M7QUFnRHBDLHlCQUF5QjtBQUN6QixNQUFNLFlBQVksR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBQzVFLE1BQU0sU0FBUyxHQUFHLElBQUksc0JBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDcEUsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLHNDQUFpQixDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUVwRix3QkFBd0I7QUFDeEIsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBbUIsQ0FBQztBQUN0RCxNQUFNLG9CQUFvQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQTBCLENBQUM7QUFDcEUsTUFBTSx3QkFBd0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLDRCQUE2QixDQUFDO0FBQzNFLE1BQU0sc0JBQXNCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMkIsQ0FBQztBQUN2RSxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWUsQ0FBQztBQUU5Qzs7O0dBR0c7QUFDSSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQStDLEVBQy9DLFFBQWlCLEVBQ0YsRUFBRTtJQUNqQixPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksRUFB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RSxTQUFTO2FBQ3hCLENBQUM7S0FDSCxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFdmVudEJyaWRnZUV2ZW50LCBTUVNFdmVudCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCwgUHV0SXRlbUNvbW1hbmQsIFVwZGF0ZUl0ZW1Db21tYW5kLCBHZXRJdGVtQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IFNRU0NsaWVudCwgU2VuZE1lc3NhZ2VDb21tYW5kLCBEZWxldGVNZXNzYWdlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xyXG5pbXBvcnQgeyBFdmVudEJyaWRnZUNsaWVudCwgUHV0RXZlbnRzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZSc7XHJcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xyXG5cclxuLy8gVHlwZXMgZm9yIG9yY2hlc3RyYXRpb25cclxuaW50ZXJmYWNlIENvbnRlbnRXb3JrZmxvdyB7XHJcbiAgaWQ6IHN0cmluZztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBpbnB1dElkOiBzdHJpbmc7XHJcbiAgc3RhdHVzOiAnaW5pdGlhdGVkJyB8ICdjb250ZW50X2dlbmVyYXRpb24nIHwgJ2ltYWdlX2dlbmVyYXRpb24nIHwgJ3Jldmlld19yZWFkeScgfCAncmV2aXNpb25fcmVxdWVzdGVkJyB8ICdjb21wbGV0ZWQnIHwgJ2ZhaWxlZCc7XHJcbiAgY3VycmVudFN0ZXA6IHN0cmluZztcclxuICBzdGVwczogV29ya2Zsb3dTdGVwW107XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgdXBkYXRlZEF0OiBzdHJpbmc7XHJcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgV29ya2Zsb3dTdGVwIHtcclxuICBzdGVwSWQ6IHN0cmluZztcclxuICBzdGVwVHlwZTogJ2NvbnRlbnRfZ2VuZXJhdGlvbicgfCAnaW1hZ2VfZ2VuZXJhdGlvbicgfCAncmV2aWV3JyB8ICdyZXZpc2lvbicgfCAncHVibGlzaGluZyc7XHJcbiAgc3RhdHVzOiAncGVuZGluZycgfCAnaW5fcHJvZ3Jlc3MnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJyB8ICdza2lwcGVkJztcclxuICBhZ2VudFR5cGU/OiBzdHJpbmc7XHJcbiAgaW5wdXQ/OiBhbnk7XHJcbiAgb3V0cHV0PzogYW55O1xyXG4gIGVycm9yPzogc3RyaW5nO1xyXG4gIHJldHJ5Q291bnQ6IG51bWJlcjtcclxuICBtYXhSZXRyaWVzOiBudW1iZXI7XHJcbiAgc3RhcnRlZEF0Pzogc3RyaW5nO1xyXG4gIGNvbXBsZXRlZEF0Pzogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQWdlbnRNZXNzYWdlIHtcclxuICBtZXNzYWdlSWQ6IHN0cmluZztcclxuICB3b3JrZmxvd0lkOiBzdHJpbmc7XHJcbiAgc3RlcElkOiBzdHJpbmc7XHJcbiAgYWdlbnRUeXBlOiBzdHJpbmc7XHJcbiAgbWVzc2FnZVR5cGU6ICdyZXF1ZXN0JyB8ICdyZXNwb25zZScgfCAnZXJyb3InIHwgJ3N0YXR1c191cGRhdGUnO1xyXG4gIHBheWxvYWQ6IGFueTtcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxuICByZXRyeUNvdW50PzogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgT3JjaGVzdHJhdGlvbkV2ZW50IHtcclxuICBldmVudFR5cGU6ICdpbnB1dF9wcm9jZXNzZWQnIHwgJ2FnZW50X3Jlc3BvbnNlJyB8ICdzdGVwX2NvbXBsZXRlZCcgfCAnd29ya2Zsb3dfY29tcGxldGVkJyB8ICdlcnJvcl9vY2N1cnJlZCc7XHJcbiAgd29ya2Zsb3dJZDogc3RyaW5nO1xyXG4gIHN0ZXBJZD86IHN0cmluZztcclxuICBkYXRhOiBhbnk7XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBzcXNDbGllbnQgPSBuZXcgU1FTQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBldmVudEJyaWRnZUNsaWVudCA9IG5ldyBFdmVudEJyaWRnZUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuXHJcbi8vIEVudmlyb25tZW50IHZhcmlhYmxlc1xyXG5jb25zdCBDT05URU5UX1RBQkxFID0gcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FITtcclxuY29uc3QgQUdFTlRfTUVTU0FHRVNfVEFCTEUgPSBwcm9jZXNzLmVudi5BR0VOVF9NRVNTQUdFU19UQUJMRV9OQU1FITtcclxuY29uc3QgQ09OVEVOVF9HRU5FUkFUSU9OX1FVRVVFID0gcHJvY2Vzcy5lbnYuQ09OVEVOVF9HRU5FUkFUSU9OX1FVRVVFX1VSTCE7XHJcbmNvbnN0IElNQUdFX0dFTkVSQVRJT05fUVVFVUUgPSBwcm9jZXNzLmVudi5JTUFHRV9HRU5FUkFUSU9OX1FVRVVFX1VSTCE7XHJcbmNvbnN0IEVWRU5UX0JVUyA9IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FITtcclxuXHJcbi8qKlxyXG4gKiBNYWluIGhhbmRsZXIgZm9yIGNvbnRlbnQgb3JjaGVzdHJhdGlvblxyXG4gKiBIYW5kbGVzIGJvdGggRXZlbnRCcmlkZ2UgZXZlbnRzIGFuZCBTUVMgbWVzc2FnZXNcclxuICovXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxyXG4gIGV2ZW50OiBFdmVudEJyaWRnZUV2ZW50PHN0cmluZywgYW55PiB8IFNRU0V2ZW50LFxyXG4gIF9jb250ZXh0OiBDb250ZXh0XHJcbik6IFByb21pc2U8dm9pZD4gPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdDb250ZW50IE9yY2hlc3RyYXRvciBFdmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xyXG5cclxuICB0cnkge1xyXG4gICAgLy8gRGV0ZXJtaW5lIGV2ZW50IHR5cGUgYW5kIHJvdXRlIGFjY29yZGluZ2x5XHJcbiAgICBpZiAoJ3NvdXJjZScgaW4gZXZlbnQpIHtcclxuICAgICAgLy8gRXZlbnRCcmlkZ2UgZXZlbnRcclxuICAgICAgYXdhaXQgaGFuZGxlRXZlbnRCcmlkZ2VFdmVudChldmVudCBhcyBFdmVudEJyaWRnZUV2ZW50PHN0cmluZywgYW55Pik7XHJcbiAgICB9IGVsc2UgaWYgKCdSZWNvcmRzJyBpbiBldmVudCkge1xyXG4gICAgICAvLyBTUVMgZXZlbnRcclxuICAgICAgYXdhaXQgaGFuZGxlU1FTRXZlbnQoZXZlbnQgYXMgU1FTRXZlbnQpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc29sZS53YXJuKCdVbmtub3duIGV2ZW50IHR5cGUgcmVjZWl2ZWQ6JywgZXZlbnQpO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBjb250ZW50IG9yY2hlc3RyYXRvcjonLCBlcnJvcik7XHJcbiAgICB0aHJvdyBlcnJvcjtcclxuICB9XHJcbn07XHJcblxyXG4vKipcclxuICogSGFuZGxlIEV2ZW50QnJpZGdlIGV2ZW50cyB0aGF0IHRyaWdnZXIgd29ya2Zsb3cgc3RlcHNcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUV2ZW50QnJpZGdlRXZlbnQoZXZlbnQ6IEV2ZW50QnJpZGdlRXZlbnQ8c3RyaW5nLCBhbnk+KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgeyBzb3VyY2UsICdkZXRhaWwtdHlwZSc6IGRldGFpbFR5cGUsIGRldGFpbCB9ID0gZXZlbnQ7XHJcblxyXG4gIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIEV2ZW50QnJpZGdlIGV2ZW50OiAke3NvdXJjZX0gLSAke2RldGFpbFR5cGV9YCk7XHJcblxyXG4gIHN3aXRjaCAoc291cmNlKSB7XHJcbiAgICBjYXNlICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW5wdXQtcHJvY2Vzc29yJzpcclxuICAgICAgYXdhaXQgaGFuZGxlSW5wdXRQcm9jZXNzb3JFdmVudChkZXRhaWxUeXBlLCBkZXRhaWwpO1xyXG4gICAgICBicmVhaztcclxuICAgIFxyXG4gICAgY2FzZSAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmNvbnRlbnQtYWdlbnQnOlxyXG4gICAgICBhd2FpdCBoYW5kbGVDb250ZW50QWdlbnRFdmVudChkZXRhaWxUeXBlLCBkZXRhaWwpO1xyXG4gICAgICBicmVhaztcclxuICAgIFxyXG4gICAgY2FzZSAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmltYWdlLWFnZW50JzpcclxuICAgICAgYXdhaXQgaGFuZGxlSW1hZ2VBZ2VudEV2ZW50KGRldGFpbFR5cGUsIGRldGFpbCk7XHJcbiAgICAgIGJyZWFrO1xyXG4gICAgXHJcbiAgICBkZWZhdWx0OlxyXG4gICAgICBjb25zb2xlLndhcm4oYFVua25vd24gZXZlbnQgc291cmNlOiAke3NvdXJjZX1gKTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgU1FTIG1lc3NhZ2VzIGZyb20gYWdlbnQgcXVldWVzXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVTUVNFdmVudChldmVudDogU1FTRXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBtZXNzYWdlOiBBZ2VudE1lc3NhZ2UgPSBKU09OLnBhcnNlKHJlY29yZC5ib2R5KTtcclxuICAgICAgY29uc29sZS5sb2coYFByb2Nlc3NpbmcgU1FTIG1lc3NhZ2U6ICR7bWVzc2FnZS5tZXNzYWdlVHlwZX0gZnJvbSAke21lc3NhZ2UuYWdlbnRUeXBlfWApO1xyXG5cclxuICAgICAgYXdhaXQgcHJvY2Vzc0FnZW50TWVzc2FnZShtZXNzYWdlKTtcclxuXHJcbiAgICAgIC8vIERlbGV0ZSBtZXNzYWdlIGZyb20gcXVldWUgYWZ0ZXIgc3VjY2Vzc2Z1bCBwcm9jZXNzaW5nXHJcbiAgICAgIGF3YWl0IHNxc0NsaWVudC5zZW5kKG5ldyBEZWxldGVNZXNzYWdlQ29tbWFuZCh7XHJcbiAgICAgICAgUXVldWVVcmw6IHJlY29yZC5ldmVudFNvdXJjZUFSTj8uaW5jbHVkZXMoJ2NvbnRlbnQtZ2VuZXJhdGlvbicpID8gQ09OVEVOVF9HRU5FUkFUSU9OX1FVRVVFIDogSU1BR0VfR0VORVJBVElPTl9RVUVVRSxcclxuICAgICAgICBSZWNlaXB0SGFuZGxlOiByZWNvcmQucmVjZWlwdEhhbmRsZSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHByb2Nlc3NpbmcgU1FTIHJlY29yZDonLCBlcnJvcik7XHJcbiAgICAgIC8vIE1lc3NhZ2Ugd2lsbCByZW1haW4gaW4gcXVldWUgZm9yIHJldHJ5XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGV2ZW50cyBmcm9tIHRoZSBpbnB1dCBwcm9jZXNzb3JcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUlucHV0UHJvY2Vzc29yRXZlbnQoZGV0YWlsVHlwZTogc3RyaW5nLCBkZXRhaWw6IGFueSk6IFByb21pc2U8dm9pZD4ge1xyXG4gIHN3aXRjaCAoZGV0YWlsVHlwZSkge1xyXG4gICAgY2FzZSAnQXVkaW8gUHJvY2Vzc2luZyBDb21wbGV0ZWQnOlxyXG4gICAgY2FzZSAnVGV4dCBQcm9jZXNzaW5nIENvbXBsZXRlZCc6XHJcbiAgICAgIGF3YWl0IGluaXRpYXRlQ29udGVudFdvcmtmbG93KGRldGFpbCk7XHJcbiAgICAgIGJyZWFrO1xyXG4gICAgXHJcbiAgICBkZWZhdWx0OlxyXG4gICAgICBjb25zb2xlLmxvZyhgSWdub3JpbmcgaW5wdXQgcHJvY2Vzc29yIGV2ZW50OiAke2RldGFpbFR5cGV9YCk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGV2ZW50cyBmcm9tIGNvbnRlbnQgZ2VuZXJhdGlvbiBhZ2VudHNcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRBZ2VudEV2ZW50KGRldGFpbFR5cGU6IHN0cmluZywgZGV0YWlsOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBzd2l0Y2ggKGRldGFpbFR5cGUpIHtcclxuICAgIGNhc2UgJ0NvbnRlbnQgR2VuZXJhdGlvbiBDb21wbGV0ZWQnOlxyXG4gICAgICBhd2FpdCBoYW5kbGVDb250ZW50R2VuZXJhdGlvbkNvbXBsZXRlZChkZXRhaWwpO1xyXG4gICAgICBicmVhaztcclxuICAgIFxyXG4gICAgY2FzZSAnQ29udGVudCBHZW5lcmF0aW9uIEZhaWxlZCc6XHJcbiAgICAgIGF3YWl0IGhhbmRsZUNvbnRlbnRHZW5lcmF0aW9uRmFpbGVkKGRldGFpbCk7XHJcbiAgICAgIGJyZWFrO1xyXG4gICAgXHJcbiAgICBkZWZhdWx0OlxyXG4gICAgICBjb25zb2xlLmxvZyhgSWdub3JpbmcgY29udGVudCBhZ2VudCBldmVudDogJHtkZXRhaWxUeXBlfWApO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBldmVudHMgZnJvbSBpbWFnZSBnZW5lcmF0aW9uIGFnZW50c1xyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlSW1hZ2VBZ2VudEV2ZW50KGRldGFpbFR5cGU6IHN0cmluZywgZGV0YWlsOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBzd2l0Y2ggKGRldGFpbFR5cGUpIHtcclxuICAgIGNhc2UgJ0ltYWdlIEdlbmVyYXRpb24gQ29tcGxldGVkJzpcclxuICAgICAgYXdhaXQgaGFuZGxlSW1hZ2VHZW5lcmF0aW9uQ29tcGxldGVkKGRldGFpbCk7XHJcbiAgICAgIGJyZWFrO1xyXG4gICAgXHJcbiAgICBjYXNlICdJbWFnZSBHZW5lcmF0aW9uIEZhaWxlZCc6XHJcbiAgICAgIGF3YWl0IGhhbmRsZUltYWdlR2VuZXJhdGlvbkZhaWxlZChkZXRhaWwpO1xyXG4gICAgICBicmVhaztcclxuICAgIFxyXG4gICAgZGVmYXVsdDpcclxuICAgICAgY29uc29sZS5sb2coYElnbm9yaW5nIGltYWdlIGFnZW50IGV2ZW50OiAke2RldGFpbFR5cGV9YCk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSW5pdGlhdGUgYSBuZXcgY29udGVudCB3b3JrZmxvdyB3aGVuIGlucHV0IHByb2Nlc3NpbmcgaXMgY29tcGxldGVkXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBpbml0aWF0ZUNvbnRlbnRXb3JrZmxvdyhkZXRhaWw6IHsgaW5wdXRJZDogc3RyaW5nOyB1c2VySWQ6IHN0cmluZzsgdHJhbnNjcmlwdGlvbjogc3RyaW5nIH0pOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCB3b3JrZmxvd0lkID0gdXVpZHY0KCk7XHJcbiAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAvLyBEZWZpbmUgd29ya2Zsb3cgc3RlcHNcclxuICBjb25zdCBzdGVwczogV29ya2Zsb3dTdGVwW10gPSBbXHJcbiAgICB7XHJcbiAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgIHN0ZXBUeXBlOiAnY29udGVudF9nZW5lcmF0aW9uJyxcclxuICAgICAgc3RhdHVzOiAncGVuZGluZycsXHJcbiAgICAgIGFnZW50VHlwZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgcmV0cnlDb3VudDogMCxcclxuICAgICAgbWF4UmV0cmllczogMyxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIHN0ZXBJZDogJ2ltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICBzdGVwVHlwZTogJ2ltYWdlX2dlbmVyYXRpb24nLFxyXG4gICAgICBzdGF0dXM6ICdwZW5kaW5nJyxcclxuICAgICAgYWdlbnRUeXBlOiAnaW1hZ2UtZ2VuZXJhdG9yJyxcclxuICAgICAgcmV0cnlDb3VudDogMCxcclxuICAgICAgbWF4UmV0cmllczogMyxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIHN0ZXBJZDogJ3JldmlldycsXHJcbiAgICAgIHN0ZXBUeXBlOiAncmV2aWV3JyxcclxuICAgICAgc3RhdHVzOiAncGVuZGluZycsXHJcbiAgICAgIHJldHJ5Q291bnQ6IDAsXHJcbiAgICAgIG1heFJldHJpZXM6IDEsXHJcbiAgICB9LFxyXG4gIF07XHJcblxyXG4gIC8vIENyZWF0ZSB3b3JrZmxvdyByZWNvcmRcclxuICBjb25zdCB3b3JrZmxvdzogQ29udGVudFdvcmtmbG93ID0ge1xyXG4gICAgaWQ6IHdvcmtmbG93SWQsXHJcbiAgICB1c2VySWQ6IGRldGFpbC51c2VySWQsXHJcbiAgICBpbnB1dElkOiBkZXRhaWwuaW5wdXRJZCxcclxuICAgIHN0YXR1czogJ2luaXRpYXRlZCcsXHJcbiAgICBjdXJyZW50U3RlcDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICBzdGVwcyxcclxuICAgIGNyZWF0ZWRBdDogdGltZXN0YW1wLFxyXG4gICAgdXBkYXRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICBtZXRhZGF0YToge1xyXG4gICAgICBvcmlnaW5hbElucHV0OiBkZXRhaWwudHJhbnNjcmlwdGlvbixcclxuICAgIH0sXHJcbiAgfTtcclxuXHJcbiAgLy8gU3RvcmUgd29ya2Zsb3cgaW4gRHluYW1vREJcclxuICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgUHV0SXRlbUNvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgSXRlbToge1xyXG4gICAgICBpZDogeyBTOiB3b3JrZmxvd0lkIH0sXHJcbiAgICAgIHR5cGU6IHsgUzogJ3dvcmtmbG93JyB9LFxyXG4gICAgICB1c2VySWQ6IHsgUzogd29ya2Zsb3cudXNlcklkIH0sXHJcbiAgICAgIGlucHV0SWQ6IHsgUzogd29ya2Zsb3cuaW5wdXRJZCB9LFxyXG4gICAgICBzdGF0dXM6IHsgUzogd29ya2Zsb3cuc3RhdHVzIH0sXHJcbiAgICAgIGN1cnJlbnRTdGVwOiB7IFM6IHdvcmtmbG93LmN1cnJlbnRTdGVwIH0sXHJcbiAgICAgIHN0ZXBzOiB7IFM6IEpTT04uc3RyaW5naWZ5KHdvcmtmbG93LnN0ZXBzKSB9LFxyXG4gICAgICBjcmVhdGVkQXQ6IHsgUzogd29ya2Zsb3cuY3JlYXRlZEF0IH0sXHJcbiAgICAgIHVwZGF0ZWRBdDogeyBTOiB3b3JrZmxvdy51cGRhdGVkQXQgfSxcclxuICAgICAgbWV0YWRhdGE6IHsgUzogSlNPTi5zdHJpbmdpZnkod29ya2Zsb3cubWV0YWRhdGEpIH0sXHJcbiAgICB9LFxyXG4gIH0pKTtcclxuXHJcbiAgY29uc29sZS5sb2coYENyZWF0ZWQgd29ya2Zsb3cgJHt3b3JrZmxvd0lkfSBmb3IgaW5wdXQgJHtkZXRhaWwuaW5wdXRJZH1gKTtcclxuXHJcbiAgLy8gU3RhcnQgdGhlIGZpcnN0IHN0ZXAgKGNvbnRlbnQgZ2VuZXJhdGlvbilcclxuICBhd2FpdCBleGVjdXRlV29ya2Zsb3dTdGVwKHdvcmtmbG93LCAnY29udGVudC1nZW5lcmF0aW9uJyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFeGVjdXRlIGEgc3BlY2lmaWMgd29ya2Zsb3cgc3RlcFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gZXhlY3V0ZVdvcmtmbG93U3RlcCh3b3JrZmxvdzogQ29udGVudFdvcmtmbG93LCBzdGVwSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGNvbnN0IHN0ZXAgPSB3b3JrZmxvdy5zdGVwcy5maW5kKHMgPT4gcy5zdGVwSWQgPT09IHN0ZXBJZCk7XHJcbiAgaWYgKCFzdGVwKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFN0ZXAgJHtzdGVwSWR9IG5vdCBmb3VuZCBpbiB3b3JrZmxvdyAke3dvcmtmbG93LmlkfWApO1xyXG4gIH1cclxuXHJcbiAgLy8gVXBkYXRlIHN0ZXAgc3RhdHVzIHRvIGluX3Byb2dyZXNzXHJcbiAgc3RlcC5zdGF0dXMgPSAnaW5fcHJvZ3Jlc3MnO1xyXG4gIHN0ZXAuc3RhcnRlZEF0ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAvLyBVcGRhdGUgd29ya2Zsb3dcclxuICBhd2FpdCB1cGRhdGVXb3JrZmxvd1N0YXR1cyh3b3JrZmxvdy5pZCwgJ2NvbnRlbnRfZ2VuZXJhdGlvbicsIHN0ZXBJZCwgd29ya2Zsb3cuc3RlcHMpO1xyXG5cclxuICAvLyBTZW5kIG1lc3NhZ2UgdG8gYXBwcm9wcmlhdGUgYWdlbnQgcXVldWVcclxuICBjb25zdCBhZ2VudE1lc3NhZ2U6IEFnZW50TWVzc2FnZSA9IHtcclxuICAgIG1lc3NhZ2VJZDogdXVpZHY0KCksXHJcbiAgICB3b3JrZmxvd0lkOiB3b3JrZmxvdy5pZCxcclxuICAgIHN0ZXBJZDogc3RlcC5zdGVwSWQsXHJcbiAgICBhZ2VudFR5cGU6IHN0ZXAuYWdlbnRUeXBlISxcclxuICAgIG1lc3NhZ2VUeXBlOiAncmVxdWVzdCcsXHJcbiAgICBwYXlsb2FkOiB7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHdvcmtmbG93LmlkLFxyXG4gICAgICBzdGVwSWQ6IHN0ZXAuc3RlcElkLFxyXG4gICAgICBpbnB1dDogc3RlcC5pbnB1dCB8fCB3b3JrZmxvdy5tZXRhZGF0YT8ub3JpZ2luYWxJbnB1dCxcclxuICAgICAgdXNlcklkOiB3b3JrZmxvdy51c2VySWQsXHJcbiAgICAgIGNvbnRleHQ6IHtcclxuICAgICAgICBwcmV2aW91c1N0ZXBzOiB3b3JrZmxvdy5zdGVwcy5maWx0ZXIocyA9PiBzLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcpLFxyXG4gICAgICAgIHVzZXJQcmVmZXJlbmNlczoge30sIC8vIFRPRE86IExvYWQgZnJvbSB1c2VyIHByb2ZpbGVcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICB9O1xyXG5cclxuICAvLyBTdG9yZSBhZ2VudCBtZXNzYWdlXHJcbiAgYXdhaXQgc3RvcmVBZ2VudE1lc3NhZ2UoYWdlbnRNZXNzYWdlKTtcclxuXHJcbiAgLy8gU2VuZCB0byBhcHByb3ByaWF0ZSBxdWV1ZVxyXG4gIGNvbnN0IHF1ZXVlVXJsID0gc3RlcC5zdGVwVHlwZSA9PT0gJ2NvbnRlbnRfZ2VuZXJhdGlvbicgPyBDT05URU5UX0dFTkVSQVRJT05fUVVFVUUgOiBJTUFHRV9HRU5FUkFUSU9OX1FVRVVFO1xyXG4gIFxyXG4gIGF3YWl0IHNxc0NsaWVudC5zZW5kKG5ldyBTZW5kTWVzc2FnZUNvbW1hbmQoe1xyXG4gICAgUXVldWVVcmw6IHF1ZXVlVXJsLFxyXG4gICAgTWVzc2FnZUJvZHk6IEpTT04uc3RyaW5naWZ5KGFnZW50TWVzc2FnZSksXHJcbiAgICBNZXNzYWdlQXR0cmlidXRlczoge1xyXG4gICAgICB3b3JrZmxvd0lkOiB7XHJcbiAgICAgICAgU3RyaW5nVmFsdWU6IHdvcmtmbG93LmlkLFxyXG4gICAgICAgIERhdGFUeXBlOiAnU3RyaW5nJyxcclxuICAgICAgfSxcclxuICAgICAgc3RlcElkOiB7XHJcbiAgICAgICAgU3RyaW5nVmFsdWU6IHN0ZXAuc3RlcElkLFxyXG4gICAgICAgIERhdGFUeXBlOiAnU3RyaW5nJyxcclxuICAgICAgfSxcclxuICAgICAgYWdlbnRUeXBlOiB7XHJcbiAgICAgICAgU3RyaW5nVmFsdWU6IHN0ZXAuYWdlbnRUeXBlISxcclxuICAgICAgICBEYXRhVHlwZTogJ1N0cmluZycsXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gIH0pKTtcclxuXHJcbiAgY29uc29sZS5sb2coYFNlbnQgJHtzdGVwLnN0ZXBUeXBlfSByZXF1ZXN0IHRvIHF1ZXVlIGZvciB3b3JrZmxvdyAke3dvcmtmbG93LmlkfWApO1xyXG5cclxuICAvLyBQdWJsaXNoIGV2ZW50XHJcbiAgYXdhaXQgcHVibGlzaE9yY2hlc3RyYXRpb25FdmVudCh7XHJcbiAgICBldmVudFR5cGU6ICdzdGVwX2NvbXBsZXRlZCcsXHJcbiAgICB3b3JrZmxvd0lkOiB3b3JrZmxvdy5pZCxcclxuICAgIHN0ZXBJZDogc3RlcC5zdGVwSWQsXHJcbiAgICBkYXRhOiB7IHN0ZXBUeXBlOiBzdGVwLnN0ZXBUeXBlLCBzdGF0dXM6ICdzdGFydGVkJyB9LFxyXG4gICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgfSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBQcm9jZXNzIGFnZW50IHJlc3BvbnNlIG1lc3NhZ2VzXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBwcm9jZXNzQWdlbnRNZXNzYWdlKG1lc3NhZ2U6IEFnZW50TWVzc2FnZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIGFnZW50IG1lc3NhZ2U6ICR7bWVzc2FnZS5tZXNzYWdlVHlwZX0gZm9yIHdvcmtmbG93ICR7bWVzc2FnZS53b3JrZmxvd0lkfWApO1xyXG5cclxuICAvLyBMb2FkIHdvcmtmbG93XHJcbiAgY29uc3Qgd29ya2Zsb3cgPSBhd2FpdCBsb2FkV29ya2Zsb3cobWVzc2FnZS53b3JrZmxvd0lkKTtcclxuICBpZiAoIXdvcmtmbG93KSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFdvcmtmbG93ICR7bWVzc2FnZS53b3JrZmxvd0lkfSBub3QgZm91bmRgKTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHN0ZXAgPSB3b3JrZmxvdy5zdGVwcy5maW5kKHMgPT4gcy5zdGVwSWQgPT09IG1lc3NhZ2Uuc3RlcElkKTtcclxuICBpZiAoIXN0ZXApIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihgU3RlcCAke21lc3NhZ2Uuc3RlcElkfSBub3QgZm91bmQgaW4gd29ya2Zsb3cgJHttZXNzYWdlLndvcmtmbG93SWR9YCk7XHJcbiAgfVxyXG5cclxuICBzd2l0Y2ggKG1lc3NhZ2UubWVzc2FnZVR5cGUpIHtcclxuICAgIGNhc2UgJ3Jlc3BvbnNlJzpcclxuICAgICAgYXdhaXQgaGFuZGxlQWdlbnRSZXNwb25zZSh3b3JrZmxvdywgc3RlcCwgbWVzc2FnZSk7XHJcbiAgICAgIGJyZWFrO1xyXG4gICAgXHJcbiAgICBjYXNlICdlcnJvcic6XHJcbiAgICAgIGF3YWl0IGhhbmRsZUFnZW50RXJyb3Iod29ya2Zsb3csIHN0ZXAsIG1lc3NhZ2UpO1xyXG4gICAgICBicmVhaztcclxuICAgIFxyXG4gICAgY2FzZSAnc3RhdHVzX3VwZGF0ZSc6XHJcbiAgICAgIGF3YWl0IGhhbmRsZUFnZW50U3RhdHVzVXBkYXRlKHdvcmtmbG93LCBzdGVwLCBtZXNzYWdlKTtcclxuICAgICAgYnJlYWs7XHJcbiAgICBcclxuICAgIGRlZmF1bHQ6XHJcbiAgICAgIGNvbnNvbGUud2FybihgVW5rbm93biBtZXNzYWdlIHR5cGU6ICR7bWVzc2FnZS5tZXNzYWdlVHlwZX1gKTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgc3VjY2Vzc2Z1bCBhZ2VudCByZXNwb25zZVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQWdlbnRSZXNwb25zZSh3b3JrZmxvdzogQ29udGVudFdvcmtmbG93LCBzdGVwOiBXb3JrZmxvd1N0ZXAsIG1lc3NhZ2U6IEFnZW50TWVzc2FnZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gIC8vIFVwZGF0ZSBzdGVwIHdpdGggcmVzcG9uc2VcclxuICBzdGVwLnN0YXR1cyA9ICdjb21wbGV0ZWQnO1xyXG4gIHN0ZXAub3V0cHV0ID0gbWVzc2FnZS5wYXlsb2FkO1xyXG4gIHN0ZXAuY29tcGxldGVkQXQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gIC8vIFVwZGF0ZSB3b3JrZmxvd1xyXG4gIGF3YWl0IHVwZGF0ZVdvcmtmbG93U3RhdHVzKHdvcmtmbG93LmlkLCB3b3JrZmxvdy5zdGF0dXMsIHdvcmtmbG93LmN1cnJlbnRTdGVwLCB3b3JrZmxvdy5zdGVwcyk7XHJcblxyXG4gIGNvbnNvbGUubG9nKGBTdGVwICR7c3RlcC5zdGVwSWR9IGNvbXBsZXRlZCBmb3Igd29ya2Zsb3cgJHt3b3JrZmxvdy5pZH1gKTtcclxuXHJcbiAgLy8gRGV0ZXJtaW5lIG5leHQgc3RlcFxyXG4gIGF3YWl0IHByb2Nlc3NOZXh0V29ya2Zsb3dTdGVwKHdvcmtmbG93KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBhZ2VudCBlcnJvciByZXNwb25zZVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQWdlbnRFcnJvcih3b3JrZmxvdzogQ29udGVudFdvcmtmbG93LCBzdGVwOiBXb3JrZmxvd1N0ZXAsIG1lc3NhZ2U6IEFnZW50TWVzc2FnZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gIHN0ZXAuZXJyb3IgPSBtZXNzYWdlLnBheWxvYWQuZXJyb3IgfHwgJ1Vua25vd24gZXJyb3InO1xyXG4gIHN0ZXAucmV0cnlDb3VudCsrO1xyXG5cclxuICBpZiAoc3RlcC5yZXRyeUNvdW50IDwgc3RlcC5tYXhSZXRyaWVzKSB7XHJcbiAgICAvLyBSZXRyeSB0aGUgc3RlcFxyXG4gICAgY29uc29sZS5sb2coYFJldHJ5aW5nIHN0ZXAgJHtzdGVwLnN0ZXBJZH0gKGF0dGVtcHQgJHtzdGVwLnJldHJ5Q291bnQgKyAxfS8ke3N0ZXAubWF4UmV0cmllc30pYCk7XHJcbiAgICBzdGVwLnN0YXR1cyA9ICdwZW5kaW5nJztcclxuICAgIGF3YWl0IGV4ZWN1dGVXb3JrZmxvd1N0ZXAod29ya2Zsb3csIHN0ZXAuc3RlcElkKTtcclxuICB9IGVsc2Uge1xyXG4gICAgLy8gTWFyayBzdGVwIGFzIGZhaWxlZFxyXG4gICAgc3RlcC5zdGF0dXMgPSAnZmFpbGVkJztcclxuICAgIHN0ZXAuY29tcGxldGVkQXQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgLy8gTWFyayB3b3JrZmxvdyBhcyBmYWlsZWRcclxuICAgIHdvcmtmbG93LnN0YXR1cyA9ICdmYWlsZWQnO1xyXG4gICAgYXdhaXQgdXBkYXRlV29ya2Zsb3dTdGF0dXMod29ya2Zsb3cuaWQsICdmYWlsZWQnLCB3b3JrZmxvdy5jdXJyZW50U3RlcCwgd29ya2Zsb3cuc3RlcHMpO1xyXG5cclxuICAgIC8vIFB1Ymxpc2ggZmFpbHVyZSBldmVudFxyXG4gICAgYXdhaXQgcHVibGlzaE9yY2hlc3RyYXRpb25FdmVudCh7XHJcbiAgICAgIGV2ZW50VHlwZTogJ2Vycm9yX29jY3VycmVkJyxcclxuICAgICAgd29ya2Zsb3dJZDogd29ya2Zsb3cuaWQsXHJcbiAgICAgIHN0ZXBJZDogc3RlcC5zdGVwSWQsXHJcbiAgICAgIGRhdGE6IHsgZXJyb3I6IHN0ZXAuZXJyb3IsIHN0ZXBUeXBlOiBzdGVwLnN0ZXBUeXBlIH0sXHJcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc29sZS5lcnJvcihgU3RlcCAke3N0ZXAuc3RlcElkfSBmYWlsZWQgcGVybWFuZW50bHkgZm9yIHdvcmtmbG93ICR7d29ya2Zsb3cuaWR9OiAke3N0ZXAuZXJyb3J9YCk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGFnZW50IHN0YXR1cyB1cGRhdGVcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUFnZW50U3RhdHVzVXBkYXRlKHdvcmtmbG93OiBDb250ZW50V29ya2Zsb3csIHN0ZXA6IFdvcmtmbG93U3RlcCwgbWVzc2FnZTogQWdlbnRNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc29sZS5sb2coYFN0YXR1cyB1cGRhdGUgZm9yIHN0ZXAgJHtzdGVwLnN0ZXBJZH06ICR7SlNPTi5zdHJpbmdpZnkobWVzc2FnZS5wYXlsb2FkKX1gKTtcclxuICBcclxuICAvLyBTdG9yZSB0aGUgc3RhdHVzIHVwZGF0ZSBidXQgZG9uJ3QgY2hhbmdlIHN0ZXAgc3RhdHVzXHJcbiAgYXdhaXQgc3RvcmVBZ2VudE1lc3NhZ2UobWVzc2FnZSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBQcm9jZXNzIHRoZSBuZXh0IHN0ZXAgaW4gdGhlIHdvcmtmbG93XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBwcm9jZXNzTmV4dFdvcmtmbG93U3RlcCh3b3JrZmxvdzogQ29udGVudFdvcmtmbG93KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgY3VycmVudFN0ZXBJbmRleCA9IHdvcmtmbG93LnN0ZXBzLmZpbmRJbmRleChzID0+IHMuc3RlcElkID09PSB3b3JrZmxvdy5jdXJyZW50U3RlcCk7XHJcbiAgY29uc3QgbmV4dFN0ZXAgPSB3b3JrZmxvdy5zdGVwc1tjdXJyZW50U3RlcEluZGV4ICsgMV07XHJcblxyXG4gIGlmIChuZXh0U3RlcCkge1xyXG4gICAgLy8gTW92ZSB0byBuZXh0IHN0ZXBcclxuICAgIHdvcmtmbG93LmN1cnJlbnRTdGVwID0gbmV4dFN0ZXAuc3RlcElkO1xyXG4gICAgYXdhaXQgZXhlY3V0ZVdvcmtmbG93U3RlcCh3b3JrZmxvdywgbmV4dFN0ZXAuc3RlcElkKTtcclxuICB9IGVsc2Uge1xyXG4gICAgLy8gV29ya2Zsb3cgY29tcGxldGVkXHJcbiAgICB3b3JrZmxvdy5zdGF0dXMgPSAncmV2aWV3X3JlYWR5JztcclxuICAgIHdvcmtmbG93LmN1cnJlbnRTdGVwID0gJ2NvbXBsZXRlZCc7XHJcbiAgICBcclxuICAgIGF3YWl0IHVwZGF0ZVdvcmtmbG93U3RhdHVzKHdvcmtmbG93LmlkLCAncmV2aWV3X3JlYWR5JywgJ2NvbXBsZXRlZCcsIHdvcmtmbG93LnN0ZXBzKTtcclxuXHJcbiAgICAvLyBQdWJsaXNoIGNvbXBsZXRpb24gZXZlbnRcclxuICAgIGF3YWl0IHB1Ymxpc2hPcmNoZXN0cmF0aW9uRXZlbnQoe1xyXG4gICAgICBldmVudFR5cGU6ICd3b3JrZmxvd19jb21wbGV0ZWQnLFxyXG4gICAgICB3b3JrZmxvd0lkOiB3b3JrZmxvdy5pZCxcclxuICAgICAgZGF0YTogeyBcclxuICAgICAgICBzdGF0dXM6ICdyZXZpZXdfcmVhZHknLFxyXG4gICAgICAgIGNvbXBsZXRlZFN0ZXBzOiB3b3JrZmxvdy5zdGVwcy5maWx0ZXIocyA9PiBzLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcpLmxlbmd0aCxcclxuICAgICAgICB0b3RhbFN0ZXBzOiB3b3JrZmxvdy5zdGVwcy5sZW5ndGgsXHJcbiAgICAgIH0sXHJcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFdvcmtmbG93ICR7d29ya2Zsb3cuaWR9IGNvbXBsZXRlZCBhbmQgcmVhZHkgZm9yIHJldmlld2ApO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBjb250ZW50IGdlbmVyYXRpb24gY29tcGxldGlvblxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ29udGVudEdlbmVyYXRpb25Db21wbGV0ZWQoZGV0YWlsOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zb2xlLmxvZygnQ29udGVudCBnZW5lcmF0aW9uIGNvbXBsZXRlZDonLCBkZXRhaWwpO1xyXG4gIC8vIFRoaXMgd2lsbCBiZSBoYW5kbGVkIGJ5IHRoZSBTUVMgbWVzc2FnZSBwcm9jZXNzaW5nXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgY29udGVudCBnZW5lcmF0aW9uIGZhaWx1cmVcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRHZW5lcmF0aW9uRmFpbGVkKGRldGFpbDogYW55KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc29sZS5sb2coJ0NvbnRlbnQgZ2VuZXJhdGlvbiBmYWlsZWQ6JywgZGV0YWlsKTtcclxuICAvLyBUaGlzIHdpbGwgYmUgaGFuZGxlZCBieSB0aGUgU1FTIG1lc3NhZ2UgcHJvY2Vzc2luZ1xyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGltYWdlIGdlbmVyYXRpb24gY29tcGxldGlvblxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlSW1hZ2VHZW5lcmF0aW9uQ29tcGxldGVkKGRldGFpbDogYW55KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc29sZS5sb2coJ0ltYWdlIGdlbmVyYXRpb24gY29tcGxldGVkOicsIGRldGFpbCk7XHJcbiAgLy8gVGhpcyB3aWxsIGJlIGhhbmRsZWQgYnkgdGhlIFNRUyBtZXNzYWdlIHByb2Nlc3NpbmdcclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBpbWFnZSBnZW5lcmF0aW9uIGZhaWx1cmVcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUltYWdlR2VuZXJhdGlvbkZhaWxlZChkZXRhaWw6IGFueSk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGNvbnNvbGUubG9nKCdJbWFnZSBnZW5lcmF0aW9uIGZhaWxlZDonLCBkZXRhaWwpO1xyXG4gIC8vIFRoaXMgd2lsbCBiZSBoYW5kbGVkIGJ5IHRoZSBTUVMgbWVzc2FnZSBwcm9jZXNzaW5nXHJcbn1cclxuXHJcbi8qKlxyXG4gKiBMb2FkIHdvcmtmbG93IGZyb20gRHluYW1vREJcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGxvYWRXb3JrZmxvdyh3b3JrZmxvd0lkOiBzdHJpbmcpOiBQcm9taXNlPENvbnRlbnRXb3JrZmxvdyB8IG51bGw+IHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgICBLZXk6IHtcclxuICAgICAgICBpZDogeyBTOiB3b3JrZmxvd0lkIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBpZDogcmVzdWx0Lkl0ZW0uaWQuUyEsXHJcbiAgICAgIHVzZXJJZDogcmVzdWx0Lkl0ZW0udXNlcklkLlMhLFxyXG4gICAgICBpbnB1dElkOiByZXN1bHQuSXRlbS5pbnB1dElkLlMhLFxyXG4gICAgICBzdGF0dXM6IHJlc3VsdC5JdGVtLnN0YXR1cy5TISBhcyBDb250ZW50V29ya2Zsb3dbJ3N0YXR1cyddLFxyXG4gICAgICBjdXJyZW50U3RlcDogcmVzdWx0Lkl0ZW0uY3VycmVudFN0ZXAuUyEsXHJcbiAgICAgIHN0ZXBzOiBKU09OLnBhcnNlKHJlc3VsdC5JdGVtLnN0ZXBzLlMhKSxcclxuICAgICAgY3JlYXRlZEF0OiByZXN1bHQuSXRlbS5jcmVhdGVkQXQuUyEsXHJcbiAgICAgIHVwZGF0ZWRBdDogcmVzdWx0Lkl0ZW0udXBkYXRlZEF0LlMhLFxyXG4gICAgICBtZXRhZGF0YTogcmVzdWx0Lkl0ZW0ubWV0YWRhdGE/LlMgPyBKU09OLnBhcnNlKHJlc3VsdC5JdGVtLm1ldGFkYXRhLlMpIDogdW5kZWZpbmVkLFxyXG4gICAgfTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgbG9hZGluZyB3b3JrZmxvdzonLCBlcnJvcik7XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBVcGRhdGUgd29ya2Zsb3cgc3RhdHVzIGluIER5bmFtb0RCXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVXb3JrZmxvd1N0YXR1cyhcclxuICB3b3JrZmxvd0lkOiBzdHJpbmcsXHJcbiAgc3RhdHVzOiBDb250ZW50V29ya2Zsb3dbJ3N0YXR1cyddLFxyXG4gIGN1cnJlbnRTdGVwOiBzdHJpbmcsXHJcbiAgc3RlcHM6IFdvcmtmbG93U3RlcFtdXHJcbik6IFByb21pc2U8dm9pZD4ge1xyXG4gIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBVcGRhdGVJdGVtQ29tbWFuZCh7XHJcbiAgICBUYWJsZU5hbWU6IENPTlRFTlRfVEFCTEUsXHJcbiAgICBLZXk6IHtcclxuICAgICAgaWQ6IHsgUzogd29ya2Zsb3dJZCB9LFxyXG4gICAgfSxcclxuICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsIGN1cnJlbnRTdGVwID0gOmN1cnJlbnRTdGVwLCBzdGVwcyA9IDpzdGVwcywgdXBkYXRlZEF0ID0gOnVwZGF0ZWRBdCcsXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcclxuICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJyxcclxuICAgIH0sXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICc6c3RhdHVzJzogeyBTOiBzdGF0dXMgfSxcclxuICAgICAgJzpjdXJyZW50U3RlcCc6IHsgUzogY3VycmVudFN0ZXAgfSxcclxuICAgICAgJzpzdGVwcyc6IHsgUzogSlNPTi5zdHJpbmdpZnkoc3RlcHMpIH0sXHJcbiAgICAgICc6dXBkYXRlZEF0JzogeyBTOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSxcclxuICAgIH0sXHJcbiAgfSkpO1xyXG59XHJcblxyXG4vKipcclxuICogU3RvcmUgYWdlbnQgbWVzc2FnZSBpbiBEeW5hbW9EQlxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gc3RvcmVBZ2VudE1lc3NhZ2UobWVzc2FnZTogQWdlbnRNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IFB1dEl0ZW1Db21tYW5kKHtcclxuICAgIFRhYmxlTmFtZTogQUdFTlRfTUVTU0FHRVNfVEFCTEUsXHJcbiAgICBJdGVtOiB7XHJcbiAgICAgIGlkOiB7IFM6IG1lc3NhZ2UubWVzc2FnZUlkIH0sXHJcbiAgICAgIHdvcmtmbG93SWQ6IHsgUzogbWVzc2FnZS53b3JrZmxvd0lkIH0sXHJcbiAgICAgIHN0ZXBJZDogeyBTOiBtZXNzYWdlLnN0ZXBJZCB9LFxyXG4gICAgICBhZ2VudFR5cGU6IHsgUzogbWVzc2FnZS5hZ2VudFR5cGUgfSxcclxuICAgICAgbWVzc2FnZVR5cGU6IHsgUzogbWVzc2FnZS5tZXNzYWdlVHlwZSB9LFxyXG4gICAgICBwYXlsb2FkOiB7IFM6IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UucGF5bG9hZCkgfSxcclxuICAgICAgdGltZXN0YW1wOiB7IFM6IG1lc3NhZ2UudGltZXN0YW1wIH0sXHJcbiAgICAgIHJldHJ5Q291bnQ6IHsgTjogKG1lc3NhZ2UucmV0cnlDb3VudCB8fCAwKS50b1N0cmluZygpIH0sXHJcbiAgICB9LFxyXG4gIH0pKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFB1Ymxpc2ggb3JjaGVzdHJhdGlvbiBldmVudCB0byBFdmVudEJyaWRnZVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gcHVibGlzaE9yY2hlc3RyYXRpb25FdmVudChldmVudDogT3JjaGVzdHJhdGlvbkV2ZW50KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgYXdhaXQgZXZlbnRCcmlkZ2VDbGllbnQuc2VuZChuZXcgUHV0RXZlbnRzQ29tbWFuZCh7XHJcbiAgICBFbnRyaWVzOiBbe1xyXG4gICAgICBTb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIub3JjaGVzdHJhdG9yJyxcclxuICAgICAgRGV0YWlsVHlwZTogZXZlbnQuZXZlbnRUeXBlLFxyXG4gICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICB3b3JrZmxvd0lkOiBldmVudC53b3JrZmxvd0lkLFxyXG4gICAgICAgIHN0ZXBJZDogZXZlbnQuc3RlcElkLFxyXG4gICAgICAgIGRhdGE6IGV2ZW50LmRhdGEsXHJcbiAgICAgICAgdGltZXN0YW1wOiBldmVudC50aW1lc3RhbXAsXHJcbiAgICAgIH0pLFxyXG4gICAgICBFdmVudEJ1c05hbWU6IEVWRU5UX0JVUyxcclxuICAgIH1dLFxyXG4gIH0pKTtcclxufVxyXG5cclxuLy8gRXhwb3J0IHR5cGVzIGZvciB0ZXN0aW5nXHJcbmV4cG9ydCB0eXBlIHsgQ29udGVudFdvcmtmbG93LCBXb3JrZmxvd1N0ZXAsIEFnZW50TWVzc2FnZSwgT3JjaGVzdHJhdGlvbkV2ZW50IH07Il19