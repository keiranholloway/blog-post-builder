import { EventBridgeEvent, SQSEvent, Context } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';

// Types for orchestration
interface ContentWorkflow {
  id: string;
  userId: string;
  inputId: string;
  status: 'initiated' | 'content_generation' | 'image_generation' | 'review_ready' | 'revision_requested' | 'completed' | 'failed';
  currentStep: string;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

interface WorkflowStep {
  stepId: string;
  stepType: 'content_generation' | 'image_generation' | 'review' | 'revision' | 'publishing';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  agentType?: string;
  input?: any;
  output?: any;
  error?: string;
  retryCount: number;
  maxRetries: number;
  startedAt?: string;
  completedAt?: string;
}

interface AgentMessage {
  messageId: string;
  workflowId: string;
  stepId: string;
  agentType: string;
  messageType: 'request' | 'response' | 'error' | 'status_update';
  payload: any;
  timestamp: string;
  retryCount?: number;
}

interface OrchestrationEvent {
  eventType: 'input_processed' | 'agent_response' | 'step_completed' | 'workflow_completed' | 'error_occurred';
  workflowId: string;
  stepId?: string;
  data: any;
  timestamp: string;
}

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });

// Environment variables
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME!;
const AGENT_MESSAGES_TABLE = process.env.AGENT_MESSAGES_TABLE_NAME!;
const CONTENT_GENERATION_QUEUE = process.env.CONTENT_GENERATION_QUEUE_URL!;
const IMAGE_GENERATION_QUEUE = process.env.IMAGE_GENERATION_QUEUE_URL!;
const EVENT_BUS = process.env.EVENT_BUS_NAME!;

/**
 * Main handler for content orchestration
 * Handles both EventBridge events and SQS messages
 */
export const handler = async (
  event: EventBridgeEvent<string, any> | SQSEvent,
  _context: Context
): Promise<void> => {
  console.log('Content Orchestrator Event:', JSON.stringify(event, null, 2));

  try {
    // Determine event type and route accordingly
    if ('source' in event) {
      // EventBridge event
      await handleEventBridgeEvent(event as EventBridgeEvent<string, any>);
    } else if ('Records' in event) {
      // SQS event
      await handleSQSEvent(event as SQSEvent);
    } else {
      console.warn('Unknown event type received:', event);
    }
  } catch (error) {
    console.error('Error in content orchestrator:', error);
    throw error;
  }
};

/**
 * Handle EventBridge events that trigger workflow steps
 */
async function handleEventBridgeEvent(event: EventBridgeEvent<string, any>): Promise<void> {
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
async function handleSQSEvent(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const message: AgentMessage = JSON.parse(record.body);
      console.log(`Processing SQS message: ${message.messageType} from ${message.agentType}`);

      await processAgentMessage(message);

      // Delete message from queue after successful processing
      await sqsClient.send(new DeleteMessageCommand({
        QueueUrl: record.eventSourceARN?.includes('content-generation') ? CONTENT_GENERATION_QUEUE : IMAGE_GENERATION_QUEUE,
        ReceiptHandle: record.receiptHandle,
      }));

    } catch (error) {
      console.error('Error processing SQS record:', error);
      // Message will remain in queue for retry
    }
  }
}

/**
 * Handle events from the input processor
 */
async function handleInputProcessorEvent(detailType: string, detail: any): Promise<void> {
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
async function handleContentAgentEvent(detailType: string, detail: any): Promise<void> {
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
async function handleImageAgentEvent(detailType: string, detail: any): Promise<void> {
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
async function initiateContentWorkflow(detail: { inputId: string; userId: string; transcription: string }): Promise<void> {
  const workflowId = uuidv4();
  const timestamp = new Date().toISOString();

  // Define workflow steps
  const steps: WorkflowStep[] = [
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
  const workflow: ContentWorkflow = {
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
  await dynamoClient.send(new PutItemCommand({
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
async function executeWorkflowStep(workflow: ContentWorkflow, stepId: string): Promise<void> {
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
  const agentMessage: AgentMessage = {
    messageId: uuidv4(),
    workflowId: workflow.id,
    stepId: step.stepId,
    agentType: step.agentType!,
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
  
  await sqsClient.send(new SendMessageCommand({
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
        StringValue: step.agentType!,
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
async function processAgentMessage(message: AgentMessage): Promise<void> {
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
async function handleAgentResponse(workflow: ContentWorkflow, step: WorkflowStep, message: AgentMessage): Promise<void> {
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
async function handleAgentError(workflow: ContentWorkflow, step: WorkflowStep, message: AgentMessage): Promise<void> {
  step.error = message.payload.error || 'Unknown error';
  step.retryCount++;

  if (step.retryCount < step.maxRetries) {
    // Retry the step
    console.log(`Retrying step ${step.stepId} (attempt ${step.retryCount + 1}/${step.maxRetries})`);
    step.status = 'pending';
    await executeWorkflowStep(workflow, step.stepId);
  } else {
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
async function handleAgentStatusUpdate(workflow: ContentWorkflow, step: WorkflowStep, message: AgentMessage): Promise<void> {
  console.log(`Status update for step ${step.stepId}: ${JSON.stringify(message.payload)}`);
  
  // Store the status update but don't change step status
  await storeAgentMessage(message);
}

/**
 * Process the next step in the workflow
 */
async function processNextWorkflowStep(workflow: ContentWorkflow): Promise<void> {
  const currentStepIndex = workflow.steps.findIndex(s => s.stepId === workflow.currentStep);
  const nextStep = workflow.steps[currentStepIndex + 1];

  if (nextStep) {
    // Move to next step
    workflow.currentStep = nextStep.stepId;
    await executeWorkflowStep(workflow, nextStep.stepId);
  } else {
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
async function handleContentGenerationCompleted(detail: any): Promise<void> {
  console.log('Content generation completed:', detail);
  // This will be handled by the SQS message processing
}

/**
 * Handle content generation failure
 */
async function handleContentGenerationFailed(detail: any): Promise<void> {
  console.log('Content generation failed:', detail);
  // This will be handled by the SQS message processing
}

/**
 * Handle image generation completion
 */
async function handleImageGenerationCompleted(detail: any): Promise<void> {
  console.log('Image generation completed:', detail);
  // This will be handled by the SQS message processing
}

/**
 * Handle image generation failure
 */
async function handleImageGenerationFailed(detail: any): Promise<void> {
  console.log('Image generation failed:', detail);
  // This will be handled by the SQS message processing
}

/**
 * Load workflow from DynamoDB
 */
async function loadWorkflow(workflowId: string): Promise<ContentWorkflow | null> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: CONTENT_TABLE,
      Key: {
        id: { S: workflowId },
      },
    }));

    if (!result.Item) {
      return null;
    }

    return {
      id: result.Item.id.S!,
      userId: result.Item.userId.S!,
      inputId: result.Item.inputId.S!,
      status: result.Item.status.S! as ContentWorkflow['status'],
      currentStep: result.Item.currentStep.S!,
      steps: JSON.parse(result.Item.steps.S!),
      createdAt: result.Item.createdAt.S!,
      updatedAt: result.Item.updatedAt.S!,
      metadata: result.Item.metadata?.S ? JSON.parse(result.Item.metadata.S) : undefined,
    };
  } catch (error) {
    console.error('Error loading workflow:', error);
    return null;
  }
}

/**
 * Update workflow status in DynamoDB
 */
async function updateWorkflowStatus(
  workflowId: string,
  status: ContentWorkflow['status'],
  currentStep: string,
  steps: WorkflowStep[]
): Promise<void> {
  await dynamoClient.send(new UpdateItemCommand({
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
async function storeAgentMessage(message: AgentMessage): Promise<void> {
  await dynamoClient.send(new PutItemCommand({
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
async function publishOrchestrationEvent(event: OrchestrationEvent): Promise<void> {
  await eventBridgeClient.send(new PutEventsCommand({
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

// Export types for testing
export type { ContentWorkflow, WorkflowStep, AgentMessage, OrchestrationEvent };