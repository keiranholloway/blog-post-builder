import { EventBridgeEvent, SQSEvent, Context } from 'aws-lambda';
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
/**
 * Main handler for content orchestration
 * Handles both EventBridge events and SQS messages
 */
export declare const handler: (event: EventBridgeEvent<string, any> | SQSEvent, _context: Context) => Promise<void>;
export type { ContentWorkflow, WorkflowStep, AgentMessage, OrchestrationEvent };
