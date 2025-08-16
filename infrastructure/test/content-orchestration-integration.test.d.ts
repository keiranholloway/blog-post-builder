/**
 * Integration tests for the content orchestration system
 * Tests the complete workflow from input processing to content generation
 */
declare const TEST_CONFIG: {
    region: string;
    contentTable: string;
    agentMessagesTable: string;
    contentGenerationQueue: string;
    imageGenerationQueue: string;
    eventBus: string;
};
export declare class OrchestrationTestHelper {
    private dynamoClient;
    private sqsClient;
    private eventBridgeClient;
    constructor(config: typeof TEST_CONFIG);
    createTestWorkflow(workflowId: string, userId: string, inputId: string): Promise<{
        id: string;
        userId: string;
        inputId: string;
        status: string;
        currentStep: string;
        steps: string;
        createdAt: string;
        updatedAt: string;
        metadata: string;
    }>;
    sendAgentMessage(queueUrl: string, message: any): Promise<import("@aws-sdk/client-sqs").SendMessageCommandOutput>;
    sendOrchestrationEvent(event: any): Promise<import("@aws-sdk/client-eventbridge").PutEventsCommandOutput>;
    getWorkflow(workflowId: string): Promise<{
        id: string;
        userId: string;
        inputId: string;
        status: string;
        currentStep: string;
        steps: any;
        createdAt: string;
        updatedAt: string;
        metadata: any;
    } | null>;
    cleanup(workflowId: string): Promise<void>;
}
export {};
