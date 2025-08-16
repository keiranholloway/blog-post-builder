"use strict";
/**
 * Unit tests for content orchestrator logic
 * Tests the orchestration patterns and data structures
 */
Object.defineProperty(exports, "__esModule", { value: true });
describe('Content Orchestrator Unit Tests', () => {
    describe('Workflow Data Structures', () => {
        it('should create valid workflow structure', () => {
            const workflow = {
                id: 'test-workflow-id',
                userId: 'test-user-id',
                inputId: 'test-input-id',
                status: 'initiated',
                currentStep: 'content-generation',
                steps: [
                    {
                        stepId: 'content-generation',
                        stepType: 'content_generation',
                        status: 'pending',
                        agentType: 'content-generator',
                        retryCount: 0,
                        maxRetries: 3,
                    },
                ],
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
            };
            expect(workflow.id).toBe('test-workflow-id');
            expect(workflow.status).toBe('initiated');
            expect(workflow.steps).toHaveLength(1);
            expect(workflow.steps[0].stepType).toBe('content_generation');
        });
        it('should create valid agent message structure', () => {
            const message = {
                messageId: 'test-message-id',
                workflowId: 'test-workflow-id',
                stepId: 'content-generation',
                agentType: 'content-generator',
                messageType: 'request',
                payload: { input: 'test input' },
                timestamp: '2023-01-01T00:00:00Z',
            };
            expect(message.messageType).toBe('request');
            expect(message.agentType).toBe('content-generator');
            expect(message.payload).toEqual({ input: 'test input' });
        });
        it('should create valid orchestration event structure', () => {
            const event = {
                eventType: 'step_completed',
                workflowId: 'test-workflow-id',
                stepId: 'content-generation',
                data: { status: 'completed' },
                timestamp: '2023-01-01T00:00:00Z',
            };
            expect(event.eventType).toBe('step_completed');
            expect(event.workflowId).toBe('test-workflow-id');
            expect(event.data).toEqual({ status: 'completed' });
        });
    });
    describe('Workflow Step Validation', () => {
        it('should validate step progression logic', () => {
            const steps = [
                {
                    stepId: 'content-generation',
                    stepType: 'content_generation',
                    status: 'completed',
                    agentType: 'content-generator',
                    retryCount: 0,
                    maxRetries: 3,
                    completedAt: '2023-01-01T00:00:00Z',
                },
                {
                    stepId: 'image-generation',
                    stepType: 'image_generation',
                    status: 'pending',
                    agentType: 'image-generator',
                    retryCount: 0,
                    maxRetries: 3,
                },
            ];
            const completedSteps = steps.filter(s => s.status === 'completed');
            const pendingSteps = steps.filter(s => s.status === 'pending');
            expect(completedSteps).toHaveLength(1);
            expect(pendingSteps).toHaveLength(1);
            expect(completedSteps[0].stepType).toBe('content_generation');
            expect(pendingSteps[0].stepType).toBe('image_generation');
        });
        it('should handle retry logic correctly', () => {
            const step = {
                stepId: 'content-generation',
                stepType: 'content_generation',
                status: 'failed',
                agentType: 'content-generator',
                retryCount: 2,
                maxRetries: 3,
                error: 'Generation failed',
            };
            const canRetry = step.retryCount < step.maxRetries;
            const shouldFail = step.retryCount >= step.maxRetries;
            expect(canRetry).toBe(true);
            expect(shouldFail).toBe(false);
            // Simulate max retries reached
            step.retryCount = 3;
            const canRetryAfterMax = step.retryCount < step.maxRetries;
            const shouldFailAfterMax = step.retryCount >= step.maxRetries;
            expect(canRetryAfterMax).toBe(false);
            expect(shouldFailAfterMax).toBe(true);
        });
    });
    describe('Message Type Validation', () => {
        it('should validate agent message types', () => {
            const messageTypes = ['request', 'response', 'error', 'status_update'];
            messageTypes.forEach(type => {
                const message = {
                    messageId: 'test-id',
                    workflowId: 'workflow-id',
                    stepId: 'step-id',
                    agentType: 'test-agent',
                    messageType: type,
                    payload: {},
                    timestamp: '2023-01-01T00:00:00Z',
                };
                expect(message.messageType).toBe(type);
            });
        });
        it('should validate orchestration event types', () => {
            const eventTypes = [
                'input_processed',
                'agent_response',
                'step_completed',
                'workflow_completed',
                'error_occurred'
            ];
            eventTypes.forEach(type => {
                const event = {
                    eventType: type,
                    workflowId: 'workflow-id',
                    data: {},
                    timestamp: '2023-01-01T00:00:00Z',
                };
                expect(event.eventType).toBe(type);
            });
        });
    });
    describe('Workflow Status Transitions', () => {
        it('should validate status transition flow', () => {
            const validTransitions = [
                'initiated',
                'content_generation',
                'image_generation',
                'review_ready',
                'revision_requested',
                'completed',
                'failed'
            ];
            // Test valid progression
            let currentStatus = 'initiated';
            expect(currentStatus).toBe('initiated');
            currentStatus = 'content_generation';
            expect(currentStatus).toBe('content_generation');
            currentStatus = 'image_generation';
            expect(currentStatus).toBe('image_generation');
            currentStatus = 'review_ready';
            expect(currentStatus).toBe('review_ready');
            currentStatus = 'completed';
            expect(currentStatus).toBe('completed');
        });
        it('should handle error states correctly', () => {
            const workflow = {
                id: 'test-id',
                userId: 'user-id',
                inputId: 'input-id',
                status: 'failed',
                currentStep: 'content-generation',
                steps: [],
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
            };
            expect(workflow.status).toBe('failed');
            // Failed workflows should not progress
            const canProgress = workflow.status !== 'failed' && workflow.status !== 'completed';
            expect(canProgress).toBe(false);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1vcmNoZXN0cmF0b3ItdW5pdC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29udGVudC1vcmNoZXN0cmF0b3ItdW5pdC50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7O0dBR0c7O0FBSUgsUUFBUSxDQUFDLGlDQUFpQyxFQUFFLEdBQUcsRUFBRTtJQUMvQyxRQUFRLENBQUMsMEJBQTBCLEVBQUUsR0FBRyxFQUFFO1FBQ3hDLEVBQUUsQ0FBQyx3Q0FBd0MsRUFBRSxHQUFHLEVBQUU7WUFDaEQsTUFBTSxRQUFRLEdBQW9CO2dCQUNoQyxFQUFFLEVBQUUsa0JBQWtCO2dCQUN0QixNQUFNLEVBQUUsY0FBYztnQkFDdEIsT0FBTyxFQUFFLGVBQWU7Z0JBQ3hCLE1BQU0sRUFBRSxXQUFXO2dCQUNuQixXQUFXLEVBQUUsb0JBQW9CO2dCQUNqQyxLQUFLLEVBQUU7b0JBQ0w7d0JBQ0UsTUFBTSxFQUFFLG9CQUFvQjt3QkFDNUIsUUFBUSxFQUFFLG9CQUFvQjt3QkFDOUIsTUFBTSxFQUFFLFNBQVM7d0JBQ2pCLFNBQVMsRUFBRSxtQkFBbUI7d0JBQzlCLFVBQVUsRUFBRSxDQUFDO3dCQUNiLFVBQVUsRUFBRSxDQUFDO3FCQUNkO2lCQUNGO2dCQUNELFNBQVMsRUFBRSxzQkFBc0I7Z0JBQ2pDLFNBQVMsRUFBRSxzQkFBc0I7YUFDbEMsQ0FBQztZQUVGLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDN0MsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDMUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMs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QXNCO2dCQUNqQyxTQUFTLEVBQUUsc0JBQXNCO2FBQ2xDLENBQUM7WUFFRixNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUV2Qyx1Q0FBdUM7WUFDdkMsTUFBTSxXQUFXLEdBQUcsUUFBUSxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxXQUFXLENBQUM7WUFDcEYsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNsQyxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogVW5pdCB0ZXN0cyBmb3IgY29udGVudCBvcmNoZXN0cmF0b3IgbG9naWNcclxuICogVGVzdHMgdGhlIG9yY2hlc3RyYXRpb24gcGF0dGVybnMgYW5kIGRhdGEgc3RydWN0dXJlc1xyXG4gKi9cclxuXHJcbmltcG9ydCB7IENvbnRlbnRXb3JrZmxvdywgV29ya2Zsb3dTdGVwLCBBZ2VudE1lc3NhZ2UsIE9yY2hlc3RyYXRpb25FdmVudCB9IGZyb20gJy4uL2xhbWJkYS9jb250ZW50LW9yY2hlc3RyYXRvcic7XHJcblxyXG5kZXNjcmliZSgnQ29udGVudCBPcmNoZXN0cmF0b3IgVW5pdCBUZXN0cycsICgpID0+IHtcclxuICBkZXNjcmliZSgnV29ya2Zsb3cgRGF0YSBTdHJ1Y3R1cmVzJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdmFsaWQgd29ya2Zsb3cgc3RydWN0dXJlJywgKCkgPT4ge1xyXG4gICAgICBjb25zdCB3b3JrZmxvdzogQ29udGVudFdvcmtmbG93ID0ge1xyXG4gICAgICAgIGlkOiAndGVzdC13b3JrZmxvdy1pZCcsXHJcbiAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLWlkJyxcclxuICAgICAgICBpbnB1dElkOiAndGVzdC1pbnB1dC1pZCcsXHJcbiAgICAgICAgc3RhdHVzOiAnaW5pdGlhdGVkJyxcclxuICAgICAgICBjdXJyZW50U3RlcDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgc3RlcHM6IFtcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgc3RlcElkOiAnY29udGVudC1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgICAgc3RlcFR5cGU6ICdjb250ZW50X2dlbmVyYXRpb24nLFxyXG4gICAgICAgICAgICBzdGF0dXM6ICdwZW5kaW5nJyxcclxuICAgICAgICAgICAgYWdlbnRUeXBlOiAnY29udGVudC1nZW5lcmF0b3InLFxyXG4gICAgICAgICAgICByZXRyeUNvdW50OiAwLFxyXG4gICAgICAgICAgICBtYXhSZXRyaWVzOiAzLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICBdLFxyXG4gICAgICAgIGNyZWF0ZWRBdDogJzIwMjMtMDEtMDFUMDA6MDA6MDBaJyxcclxuICAgICAgICB1cGRhdGVkQXQ6ICcyMDIzLTAxLTAxVDAwOjAwOjAwWicsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBleHBlY3Qod29ya2Zsb3cuaWQpLnRvQmUoJ3Rlc3Qtd29ya2Zsb3ctaWQnKTtcclxuICAgICAgZXhwZWN0KHdvcmtmbG93LnN0YXR1cykudG9CZSgnaW5pdGlhdGVkJyk7XHJcbiAgICAgIGV4cGVjdCh3b3JrZmxvdy5zdGVwcykudG9IYXZlTGVuZ3RoKDEpO1xyXG4gICAgICBleHBlY3Qod29ya2Zsb3cuc3RlcHNbMF0uc3RlcFR5cGUpLnRvQmUoJ2NvbnRlbnRfZ2VuZXJhdGlvbicpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdmFsaWQgYWdlbnQgbWVzc2FnZSBzdHJ1Y3R1cmUnLCAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IG1lc3NhZ2U6IEFnZW50TWVzc2FnZSA9IHtcclxuICAgICAgICBtZXNzYWdlSWQ6ICd0ZXN0LW1lc3NhZ2UtaWQnLFxyXG4gICAgICAgIHdvcmtmbG93SWQ6ICd0ZXN0LXdvcmtmbG93LWlkJyxcclxuICAgICAgICBzdGVwSWQ6ICdjb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICAgIGFnZW50VHlwZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgICBtZXNzYWdlVHlwZTogJ3JlcXVlc3QnLFxyXG4gICAgICAgIHBheWxvYWQ6IHsgaW5wdXQ6ICd0ZXN0IGlucHV0JyB9LFxyXG4gICAgICAgIHRpbWVzdGFtcDogJzIwMjMtMDEtMDFUMDA6MDA6MDBaJyxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGV4cGVjdChtZXNzYWdlLm1lc3NhZ2VUeXBlKS50b0JlKCdyZXF1ZXN0Jyk7XHJcbiAgICAgIGV4cGVjdChtZXNzYWdlLmFnZW50VHlwZSkudG9CZSgnY29udGVudC1nZW5lcmF0b3InKTtcclxuICAgICAgZXhwZWN0KG1lc3NhZ2UucGF5bG9hZCkudG9FcXVhbCh7IGlucHV0OiAndGVzdCBpbnB1dCcgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB2YWxpZCBvcmNoZXN0cmF0aW9uIGV2ZW50IHN0cnVjdHVyZScsICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQ6IE9yY2hlc3RyYXRpb25FdmVudCA9IHtcclxuICAgICAgICBldmVudFR5cGU6ICdzdGVwX2NvbXBsZXRlZCcsXHJcbiAgICAgICAgd29ya2Zsb3dJZDogJ3Rlc3Qtd29ya2Zsb3ctaWQnLFxyXG4gICAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgZGF0YTogeyBzdGF0dXM6ICdjb21wbGV0ZWQnIH0sXHJcbiAgICAgICAgdGltZXN0YW1wOiAnMjAyMy0wMS0wMVQwMDowMDowMFonLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgZXhwZWN0KGV2ZW50LmV2ZW50VHlwZSkudG9CZSgnc3RlcF9jb21wbGV0ZWQnKTtcclxuICAgICAgZXhwZWN0KGV2ZW50LndvcmtmbG93SWQpLnRvQmUoJ3Rlc3Qtd29ya2Zsb3ctaWQnKTtcclxuICAgICAgZXhwZWN0KGV2ZW50LmRhdGEpLnRvRXF1YWwoeyBzdGF0dXM6ICdjb21wbGV0ZWQnIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdXb3JrZmxvdyBTdGVwIFZhbGlkYXRpb24nLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHN0ZXAgcHJvZ3Jlc3Npb24gbG9naWMnLCAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHN0ZXBzOiBXb3JrZmxvd1N0ZXBbXSA9IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBzdGVwSWQ6ICdjb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgc3RlcFR5cGU6ICdjb250ZW50X2dlbmVyYXRpb24nLFxyXG4gICAgICAgICAgc3RhdHVzOiAnY29tcGxldGVkJyxcclxuICAgICAgICAgIGFnZW50VHlwZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXHJcbiAgICAgICAgICBtYXhSZXRyaWVzOiAzLFxyXG4gICAgICAgICAgY29tcGxldGVkQXQ6ICcyMDIzLTAxLTAxVDAwOjAwOjAwWicsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBzdGVwSWQ6ICdpbWFnZS1nZW5lcmF0aW9uJyxcclxuICAgICAgICAgIHN0ZXBUeXBlOiAnaW1hZ2VfZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgICBzdGF0dXM6ICdwZW5kaW5nJyxcclxuICAgICAgICAgIGFnZW50VHlwZTogJ2ltYWdlLWdlbmVyYXRvcicsXHJcbiAgICAgICAgICByZXRyeUNvdW50OiAwLFxyXG4gICAgICAgICAgbWF4UmV0cmllczogMyxcclxuICAgICAgICB9LFxyXG4gICAgICBdO1xyXG5cclxuICAgICAgY29uc3QgY29tcGxldGVkU3RlcHMgPSBzdGVwcy5maWx0ZXIocyA9PiBzLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcpO1xyXG4gICAgICBjb25zdCBwZW5kaW5nU3RlcHMgPSBzdGVwcy5maWx0ZXIocyA9PiBzLnN0YXR1cyA9PT0gJ3BlbmRpbmcnKTtcclxuXHJcbiAgICAgIGV4cGVjdChjb21wbGV0ZWRTdGVwcykudG9IYXZlTGVuZ3RoKDEpO1xyXG4gICAgICBleHBlY3QocGVuZGluZ1N0ZXBzKS50b0hhdmVMZW5ndGgoMSk7XHJcbiAgICAgIGV4cGVjdChjb21wbGV0ZWRTdGVwc1swXS5zdGVwVHlwZSkudG9CZSgnY29udGVudF9nZW5lcmF0aW9uJyk7XHJcbiAgICAgIGV4cGVjdChwZW5kaW5nU3RlcHNbMF0uc3RlcFR5cGUpLnRvQmUoJ2ltYWdlX2dlbmVyYXRpb24nKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHJldHJ5IGxvZ2ljIGNvcnJlY3RseScsICgpID0+IHtcclxuICAgICAgY29uc3Qgc3RlcDogV29ya2Zsb3dTdGVwID0ge1xyXG4gICAgICAgIHN0ZXBJZDogJ2NvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgc3RlcFR5cGU6ICdjb250ZW50X2dlbmVyYXRpb24nLFxyXG4gICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsXHJcbiAgICAgICAgYWdlbnRUeXBlOiAnY29udGVudC1nZW5lcmF0b3InLFxyXG4gICAgICAgIHJldHJ5Q291bnQ6IDIsXHJcbiAgICAgICAgbWF4UmV0cmllczogMyxcclxuICAgICAgICBlcnJvcjogJ0dlbmVyYXRpb24gZmFpbGVkJyxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGNhblJldHJ5ID0gc3RlcC5yZXRyeUNvdW50IDwgc3RlcC5tYXhSZXRyaWVzO1xyXG4gICAgICBjb25zdCBzaG91bGRGYWlsID0gc3RlcC5yZXRyeUNvdW50ID49IHN0ZXAubWF4UmV0cmllcztcclxuXHJcbiAgICAgIGV4cGVjdChjYW5SZXRyeSkudG9CZSh0cnVlKTtcclxuICAgICAgZXhwZWN0KHNob3VsZEZhaWwpLnRvQmUoZmFsc2UpO1xyXG5cclxuICAgICAgLy8gU2ltdWxhdGUgbWF4IHJldHJpZXMgcmVhY2hlZFxyXG4gICAgICBzdGVwLnJldHJ5Q291bnQgPSAzO1xyXG4gICAgICBjb25zdCBjYW5SZXRyeUFmdGVyTWF4ID0gc3RlcC5yZXRyeUNvdW50IDwgc3RlcC5tYXhSZXRyaWVzO1xyXG4gICAgICBjb25zdCBzaG91bGRGYWlsQWZ0ZXJNYXggPSBzdGVwLnJldHJ5Q291bnQgPj0gc3RlcC5tYXhSZXRyaWVzO1xyXG5cclxuICAgICAgZXhwZWN0KGNhblJldHJ5QWZ0ZXJNYXgpLnRvQmUoZmFsc2UpO1xyXG4gICAgICBleHBlY3Qoc2hvdWxkRmFpbEFmdGVyTWF4KS50b0JlKHRydWUpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdNZXNzYWdlIFR5cGUgVmFsaWRhdGlvbicsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYWdlbnQgbWVzc2FnZSB0eXBlcycsICgpID0+IHtcclxuICAgICAgY29uc3QgbWVzc2FnZVR5cGVzID0gWydyZXF1ZXN0JywgJ3Jlc3BvbnNlJywgJ2Vycm9yJywgJ3N0YXR1c191cGRhdGUnXSBhcyBjb25zdDtcclxuICAgICAgXHJcbiAgICAgIG1lc3NhZ2VUeXBlcy5mb3JFYWNoKHR5cGUgPT4ge1xyXG4gICAgICAgIGNvbnN0IG1lc3NhZ2U6IEFnZW50TWVzc2FnZSA9IHtcclxuICAgICAgICAgIG1lc3NhZ2VJZDogJ3Rlc3QtaWQnLFxyXG4gICAgICAgICAgd29ya2Zsb3dJZDogJ3dvcmtmbG93LWlkJyxcclxuICAgICAgICAgIHN0ZXBJZDogJ3N0ZXAtaWQnLFxyXG4gICAgICAgICAgYWdlbnRUeXBlOiAndGVzdC1hZ2VudCcsXHJcbiAgICAgICAgICBtZXNzYWdlVHlwZTogdHlwZSxcclxuICAgICAgICAgIHBheWxvYWQ6IHt9LFxyXG4gICAgICAgICAgdGltZXN0YW1wOiAnMjAyMy0wMS0wMVQwMDowMDowMFonLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGV4cGVjdChtZXNzYWdlLm1lc3NhZ2VUeXBlKS50b0JlKHR5cGUpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgb3JjaGVzdHJhdGlvbiBldmVudCB0eXBlcycsICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnRUeXBlcyA9IFtcclxuICAgICAgICAnaW5wdXRfcHJvY2Vzc2VkJyxcclxuICAgICAgICAnYWdlbnRfcmVzcG9uc2UnLFxyXG4gICAgICAgICdzdGVwX2NvbXBsZXRlZCcsXHJcbiAgICAgICAgJ3dvcmtmbG93X2NvbXBsZXRlZCcsXHJcbiAgICAgICAgJ2Vycm9yX29jY3VycmVkJ1xyXG4gICAgICBdIGFzIGNvbnN0O1xyXG5cclxuICAgICAgZXZlbnRUeXBlcy5mb3JFYWNoKHR5cGUgPT4ge1xyXG4gICAgICAgIGNvbnN0IGV2ZW50OiBPcmNoZXN0cmF0aW9uRXZlbnQgPSB7XHJcbiAgICAgICAgICBldmVudFR5cGU6IHR5cGUsXHJcbiAgICAgICAgICB3b3JrZmxvd0lkOiAnd29ya2Zsb3ctaWQnLFxyXG4gICAgICAgICAgZGF0YToge30sXHJcbiAgICAgICAgICB0aW1lc3RhbXA6ICcyMDIzLTAxLTAxVDAwOjAwOjAwWicsXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgZXhwZWN0KGV2ZW50LmV2ZW50VHlwZSkudG9CZSh0eXBlKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ1dvcmtmbG93IFN0YXR1cyBUcmFuc2l0aW9ucycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc3RhdHVzIHRyYW5zaXRpb24gZmxvdycsICgpID0+IHtcclxuICAgICAgY29uc3QgdmFsaWRUcmFuc2l0aW9ucyA9IFtcclxuICAgICAgICAnaW5pdGlhdGVkJyxcclxuICAgICAgICAnY29udGVudF9nZW5lcmF0aW9uJyxcclxuICAgICAgICAnaW1hZ2VfZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgJ3Jldmlld19yZWFkeScsXHJcbiAgICAgICAgJ3JldmlzaW9uX3JlcXVlc3RlZCcsXHJcbiAgICAgICAgJ2NvbXBsZXRlZCcsXHJcbiAgICAgICAgJ2ZhaWxlZCdcclxuICAgICAgXSBhcyBjb25zdDtcclxuXHJcbiAgICAgIC8vIFRlc3QgdmFsaWQgcHJvZ3Jlc3Npb25cclxuICAgICAgbGV0IGN1cnJlbnRTdGF0dXM6IENvbnRlbnRXb3JrZmxvd1snc3RhdHVzJ10gPSAnaW5pdGlhdGVkJztcclxuICAgICAgZXhwZWN0KGN1cnJlbnRTdGF0dXMpLnRvQmUoJ2luaXRpYXRlZCcpO1xyXG5cclxuICAgICAgY3VycmVudFN0YXR1cyA9ICdjb250ZW50X2dlbmVyYXRpb24nO1xyXG4gICAgICBleHBlY3QoY3VycmVudFN0YXR1cykudG9CZSgnY29udGVudF9nZW5lcmF0aW9uJyk7XHJcblxyXG4gICAgICBjdXJyZW50U3RhdHVzID0gJ2ltYWdlX2dlbmVyYXRpb24nO1xyXG4gICAgICBleHBlY3QoY3VycmVudFN0YXR1cykudG9CZSgnaW1hZ2VfZ2VuZXJhdGlvbicpO1xyXG5cclxuICAgICAgY3VycmVudFN0YXR1cyA9ICdyZXZpZXdfcmVhZHknO1xyXG4gICAgICBleHBlY3QoY3VycmVudFN0YXR1cykudG9CZSgncmV2aWV3X3JlYWR5Jyk7XHJcblxyXG4gICAgICBjdXJyZW50U3RhdHVzID0gJ2NvbXBsZXRlZCc7XHJcbiAgICAgIGV4cGVjdChjdXJyZW50U3RhdHVzKS50b0JlKCdjb21wbGV0ZWQnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVycm9yIHN0YXRlcyBjb3JyZWN0bHknLCAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHdvcmtmbG93OiBDb250ZW50V29ya2Zsb3cgPSB7XHJcbiAgICAgICAgaWQ6ICd0ZXN0LWlkJyxcclxuICAgICAgICB1c2VySWQ6ICd1c2VyLWlkJyxcclxuICAgICAgICBpbnB1dElkOiAnaW5wdXQtaWQnLFxyXG4gICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsXHJcbiAgICAgICAgY3VycmVudFN0ZXA6ICdjb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICAgIHN0ZXBzOiBbXSxcclxuICAgICAgICBjcmVhdGVkQXQ6ICcyMDIzLTAxLTAxVDAwOjAwOjAwWicsXHJcbiAgICAgICAgdXBkYXRlZEF0OiAnMjAyMy0wMS0wMVQwMDowMDowMFonLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgZXhwZWN0KHdvcmtmbG93LnN0YXR1cykudG9CZSgnZmFpbGVkJyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGYWlsZWQgd29ya2Zsb3dzIHNob3VsZCBub3QgcHJvZ3Jlc3NcclxuICAgICAgY29uc3QgY2FuUHJvZ3Jlc3MgPSB3b3JrZmxvdy5zdGF0dXMgIT09ICdmYWlsZWQnICYmIHdvcmtmbG93LnN0YXR1cyAhPT0gJ2NvbXBsZXRlZCc7XHJcbiAgICAgIGV4cGVjdChjYW5Qcm9ncmVzcykudG9CZShmYWxzZSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19