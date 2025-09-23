"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const aws_sdk_client_mock_1 = require("aws-sdk-client-mock");
const input_processor_1 = require("../lambda/input-processor");
const content_orchestrator_1 = require("../lambda/content-orchestrator");
const image_generation_agent_1 = require("../lambda/image-generation-agent");
const publishing_orchestrator_1 = require("../lambda/publishing-orchestrator");
const dynamoMock = (0, aws_sdk_client_mock_1.mockClient)(client_dynamodb_1.DynamoDBClient);
const s3Mock = (0, aws_sdk_client_mock_1.mockClient)(client_s3_1.S3Client);
const sqsMock = (0, aws_sdk_client_mock_1.mockClient)(client_sqs_1.SQSClient);
(0, globals_1.describe)('Voice-to-Blog Pipeline Integration Tests', () => {
    (0, globals_1.beforeEach)(() => {
        dynamoMock.reset();
        s3Mock.reset();
        sqsMock.reset();
    });
    (0, globals_1.afterEach)(() => {
        jest.clearAllMocks();
    });
    (0, globals_1.it)('processes complete voice-to-blog pipeline', async () => {
        // Mock successful responses for all AWS services
        dynamoMock.resolves({});
        s3Mock.resolves({});
        sqsMock.resolves({});
        // Step 1: Process audio input
        const audioEvent = {
            httpMethod: 'POST',
            path: '/api/process-audio',
            headers: {
                'Content-Type': 'multipart/form-data',
                'Authorization': 'Bearer valid-token'
            },
            body: JSON.stringify({
                audioData: 'base64-encoded-audio-data',
                userId: 'test-user-123'
            }),
            requestContext: {
                requestId: 'test-request-id'
            }
        };
        const inputResult = await (0, input_processor_1.handler)(audioEvent, {});
        (0, globals_1.expect)(inputResult.statusCode).toBe(200);
        const inputResponse = JSON.parse(inputResult.body);
        (0, globals_1.expect)(inputResponse.transcription).toBeDefined();
        (0, globals_1.expect)(inputResponse.contentId).toBeDefined();
        // Step 2: Content orchestration
        const orchestrationEvent = {
            Records: [{
                    body: JSON.stringify({
                        contentId: inputResponse.contentId,
                        transcription: inputResponse.transcription,
                        userId: 'test-user-123',
                        userContext: {
                            writingStyle: 'Technical and informative',
                            expertise: 'Software development and AI'
                        }
                    })
                }]
        };
        const orchestrationResult = await (0, content_orchestrator_1.handler)(orchestrationEvent, {});
        (0, globals_1.expect)(orchestrationResult.statusCode).toBe(200);
        // Step 3: Image generation
        const imageEvent = {
            Records: [{
                    body: JSON.stringify({
                        contentId: inputResponse.contentId,
                        blogContent: {
                            title: 'Test Blog Post',
                            body: 'This is a test blog post about AI and technology...',
                            summary: 'A comprehensive overview of AI applications'
                        }
                    })
                }]
        };
        const imageResult = await (0, image_generation_agent_1.handler)(imageEvent, {});
        (0, globals_1.expect)(imageResult.statusCode).toBe(200);
        // Step 4: Publishing orchestration
        const publishingEvent = {
            httpMethod: 'POST',
            path: '/api/publish',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer valid-token'
            },
            body: JSON.stringify({
                contentId: inputResponse.contentId,
                platforms: ['medium', 'linkedin'],
                userId: 'test-user-123'
            }),
            requestContext: {
                requestId: 'test-publish-request'
            }
        };
        const publishingResult = await (0, publishing_orchestrator_1.handler)(publishingEvent, {});
        (0, globals_1.expect)(publishingResult.statusCode).toBe(200);
        const publishingResponse = JSON.parse(publishingResult.body);
        (0, globals_1.expect)(publishingResponse.success).toBe(true);
        (0, globals_1.expect)(publishingResponse.publishedUrls).toBeDefined();
        (0, globals_1.expect)(publishingResponse.publishedUrls.medium).toBeDefined();
        (0, globals_1.expect)(publishingResponse.publishedUrls.linkedin).toBeDefined();
        // Verify all components were called with correct data
        (0, globals_1.expect)(dynamoMock.calls()).toHaveLength(4); // One call per step
        (0, globals_1.expect)(s3Mock.calls()).toHaveLength(2); // Audio storage and image storage
        (0, globals_1.expect)(sqsMock.calls()).toHaveLength(3); // Inter-service communication
    });
    (0, globals_1.it)('handles pipeline failures gracefully', async () => {
        // Mock failure in content generation
        dynamoMock.rejectsOnce(new Error('DynamoDB connection failed'));
        const audioEvent = {
            httpMethod: 'POST',
            path: '/api/process-audio',
            headers: {
                'Content-Type': 'multipart/form-data',
                'Authorization': 'Bearer valid-token'
            },
            body: JSON.stringify({
                audioData: 'base64-encoded-audio-data',
                userId: 'test-user-123'
            }),
            requestContext: {
                requestId: 'test-request-id'
            }
        };
        const result = await (0, input_processor_1.handler)(audioEvent, {});
        (0, globals_1.expect)(result.statusCode).toBe(500);
        const response = JSON.parse(result.body);
        (0, globals_1.expect)(response.error).toBeDefined();
        (0, globals_1.expect)(response.retryable).toBe(true);
    });
    (0, globals_1.it)('processes text input pipeline', async () => {
        dynamoMock.resolves({});
        s3Mock.resolves({});
        sqsMock.resolves({});
        // Text input event
        const textEvent = {
            httpMethod: 'POST',
            path: '/api/process-text',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer valid-token'
            },
            body: JSON.stringify({
                textInput: 'This is a blog post idea about machine learning applications in healthcare.',
                userId: 'test-user-123'
            }),
            requestContext: {
                requestId: 'test-text-request'
            }
        };
        const result = await (0, input_processor_1.handler)(textEvent, {});
        (0, globals_1.expect)(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);
        (0, globals_1.expect)(response.contentId).toBeDefined();
        (0, globals_1.expect)(response.processedText).toBeDefined();
    });
    (0, globals_1.it)('handles revision workflow', async () => {
        dynamoMock.resolves({});
        s3Mock.resolves({});
        sqsMock.resolves({});
        // Revision request event
        const revisionEvent = {
            httpMethod: 'POST',
            path: '/api/request-revision',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer valid-token'
            },
            body: JSON.stringify({
                contentId: 'existing-content-id',
                feedback: 'Please make the introduction more engaging',
                revisionType: 'content',
                userId: 'test-user-123'
            }),
            requestContext: {
                requestId: 'test-revision-request'
            }
        };
        const result = await (0, content_orchestrator_1.handler)(revisionEvent, {});
        (0, globals_1.expect)(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);
        (0, globals_1.expect)(response.revisionId).toBeDefined();
        (0, globals_1.expect)(response.status).toBe('processing');
    });
    (0, globals_1.it)('validates audio quality before processing', async () => {
        dynamoMock.resolves({});
        s3Mock.resolves({});
        // Poor quality audio event
        const poorAudioEvent = {
            httpMethod: 'POST',
            path: '/api/process-audio',
            headers: {
                'Content-Type': 'multipart/form-data',
                'Authorization': 'Bearer valid-token'
            },
            body: JSON.stringify({
                audioData: 'very-short-audio-data',
                userId: 'test-user-123'
            }),
            requestContext: {
                requestId: 'test-poor-audio'
            }
        };
        const result = await (0, input_processor_1.handler)(poorAudioEvent, {});
        (0, globals_1.expect)(result.statusCode).toBe(400);
        const response = JSON.parse(result.body);
        (0, globals_1.expect)(response.error).toContain('audio quality');
        (0, globals_1.expect)(response.suggestions).toBeDefined();
    });
    (0, globals_1.it)('handles concurrent processing requests', async () => {
        dynamoMock.resolves({});
        s3Mock.resolves({});
        sqsMock.resolves({});
        // Create multiple concurrent requests
        const requests = Array.from({ length: 5 }, (_, i) => ({
            httpMethod: 'POST',
            path: '/api/process-audio',
            headers: {
                'Content-Type': 'multipart/form-data',
                'Authorization': 'Bearer valid-token'
            },
            body: JSON.stringify({
                audioData: `audio-data-${i}`,
                userId: `test-user-${i}`
            }),
            requestContext: {
                requestId: `concurrent-request-${i}`
            }
        }));
        // Process all requests concurrently
        const results = await Promise.all(requests.map(event => (0, input_processor_1.handler)(event, {})));
        // Verify all requests succeeded
        results.forEach((result, index) => {
            (0, globals_1.expect)(result.statusCode).toBe(200);
            const response = JSON.parse(result.body);
            (0, globals_1.expect)(response.contentId).toBeDefined();
            (0, globals_1.expect)(response.contentId).toContain(`test-user-${index}`);
        });
    });
    (0, globals_1.it)('maintains data consistency across pipeline stages', async () => {
        const contentId = 'consistency-test-content-id';
        dynamoMock.resolves({
            Item: {
                contentId: { S: contentId },
                status: { S: 'processing' },
                userId: { S: 'test-user-123' }
            }
        });
        s3Mock.resolves({});
        sqsMock.resolves({});
        // Verify content tracking through pipeline
        const statusCheckEvent = {
            httpMethod: 'GET',
            path: `/api/content-status/${contentId}`,
            headers: {
                'Authorization': 'Bearer valid-token'
            },
            pathParameters: {
                contentId: contentId
            },
            requestContext: {
                requestId: 'status-check-request'
            }
        };
        const result = await (0, content_orchestrator_1.handler)(statusCheckEvent, {});
        (0, globals_1.expect)(result.statusCode).toBe(200);
        const response = JSON.parse(result.body);
        (0, globals_1.expect)(response.contentId).toBe(contentId);
        (0, globals_1.expect)(response.status).toBeDefined();
        (0, globals_1.expect)(response.userId).toBe('test-user-123');
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidm9pY2UtdG8tYmxvZy1waXBlbGluZS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidm9pY2UtdG8tYmxvZy1waXBlbGluZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsMkNBQTRFO0FBQzVFLDhEQUEwRDtBQUMxRCxrREFBOEM7QUFDOUMsb0RBQWdEO0FBQ2hELDZEQUFpRDtBQUNqRCwrREFBc0U7QUFDdEUseUVBQWdGO0FBQ2hGLDZFQUFtRjtBQUNuRiwrRUFBc0Y7QUFFdEYsTUFBTSxVQUFVLEdBQUcsSUFBQSxnQ0FBVSxFQUFDLGdDQUFjLENBQUMsQ0FBQztBQUM5QyxNQUFNLE1BQU0sR0FBRyxJQUFBLGdDQUFVLEVBQUMsb0JBQVEsQ0FBQyxDQUFDO0FBQ3BDLE1BQU0sT0FBTyxHQUFHLElBQUEsZ0NBQVUsRUFBQyxzQkFBUyxDQUFDLENBQUM7QUFFdEMsSUFBQSxrQkFBUSxFQUFDLDBDQUEwQyxFQUFFLEdBQUcsRUFBRTtJQUN4RCxJQUFBLG9CQUFVLEVBQUMsR0FBRyxFQUFFO1FBQ2QsVUFBVSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ25CLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUNsQixDQUFDLENBQUMsQ0FBQztJQUVILElBQUEsbUJBQVMsRUFBQyxHQUFHLEVBQUU7UUFDYixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7SUFDdkIsQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFBLFlBQUUsRUFBQywyQ0FBMkMsRUFBRSxLQUFLLElBQUksRUFBRTtRQUN6RCxpREFBaUQ7UUFDakQsVUFBVSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN4QixNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3BCLE9BQU8sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFckIsOEJBQThCO1FBQzlCLE1BQU0sVUFBVSxHQUFH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Q0FBQyxDQUFDO1FBQ3BCLE9BQU8sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFckIsMkNBQTJDO1FBQzNDLE1BQU0sZ0JBQWdCLEdBQUc7WUFDdkIsVUFBVSxFQUFFLEtBQUs7WUFDakIsSUFBSSxFQUFFLHVCQUF1QixTQUFTLEVBQUU7WUFDeEMsT0FBTyxFQUFFO2dCQUNQLGVBQWUsRUFBRSxvQkFBb0I7YUFDdEM7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLFNBQVM7YUFDckI7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLHNCQUFzQjthQUNsQztTQUNGLENBQUM7UUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUEsOEJBQW1CLEVBQUMsZ0JBQWdCLEVBQUUsRUFBUyxDQUFDLENBQUM7UUFDdEUsSUFBQSxnQkFBTSxFQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7UUFFcEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDekMsSUFBQSxnQkFBTSxFQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDM0MsSUFBQSxnQkFBTSxFQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUN0QyxJQUFBLGdCQUFNLEVBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztJQUNoRCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZGVzY3JpYmUsIGl0LCBleHBlY3QsIGJlZm9yZUVhY2gsIGFmdGVyRWFjaCB9IGZyb20gJ0BqZXN0L2dsb2JhbHMnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IFMzQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcclxuaW1wb3J0IHsgU1FTQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNxcyc7XHJcbmltcG9ydCB7IG1vY2tDbGllbnQgfSBmcm9tICdhd3Mtc2RrLWNsaWVudC1tb2NrJztcclxuaW1wb3J0IHsgaGFuZGxlciBhcyBpbnB1dFByb2Nlc3NvciB9IGZyb20gJy4uL2xhbWJkYS9pbnB1dC1wcm9jZXNzb3InO1xyXG5pbXBvcnQgeyBoYW5kbGVyIGFzIGNvbnRlbnRPcmNoZXN0cmF0b3IgfSBmcm9tICcuLi9sYW1iZGEvY29udGVudC1vcmNoZXN0cmF0b3InO1xyXG5pbXBvcnQgeyBoYW5kbGVyIGFzIGltYWdlR2VuZXJhdGlvbkFnZW50IH0gZnJvbSAnLi4vbGFtYmRhL2ltYWdlLWdlbmVyYXRpb24tYWdlbnQnO1xyXG5pbXBvcnQgeyBoYW5kbGVyIGFzIHB1Ymxpc2hpbmdPcmNoZXN0cmF0b3IgfSBmcm9tICcuLi9sYW1iZGEvcHVibGlzaGluZy1vcmNoZXN0cmF0b3InO1xyXG5cclxuY29uc3QgZHluYW1vTW9jayA9IG1vY2tDbGllbnQoRHluYW1vREJDbGllbnQpO1xyXG5jb25zdCBzM01vY2sgPSBtb2NrQ2xpZW50KFMzQ2xpZW50KTtcclxuY29uc3Qgc3FzTW9jayA9IG1vY2tDbGllbnQoU1FTQ2xpZW50KTtcclxuXHJcbmRlc2NyaWJlKCdWb2ljZS10by1CbG9nIFBpcGVsaW5lIEludGVncmF0aW9uIFRlc3RzJywgKCkgPT4ge1xyXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xyXG4gICAgZHluYW1vTW9jay5yZXNldCgpO1xyXG4gICAgczNNb2NrLnJlc2V0KCk7XHJcbiAgICBzcXNNb2NrLnJlc2V0KCk7XHJcbiAgfSk7XHJcblxyXG4gIGFmdGVyRWFjaCgoKSA9PiB7XHJcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ3Byb2Nlc3NlcyBjb21wbGV0ZSB2b2ljZS10by1ibG9nIHBpcGVsaW5lJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgLy8gTW9jayBzdWNjZXNzZnVsIHJlc3BvbnNlcyBmb3IgYWxsIEFXUyBzZXJ2aWNlc1xyXG4gICAgZHluYW1vTW9jay5yZXNvbHZlcyh7fSk7XHJcbiAgICBzM01vY2sucmVzb2x2ZXMoe30pO1xyXG4gICAgc3FzTW9jay5yZXNvbHZlcyh7fSk7XHJcblxyXG4gICAgLy8gU3RlcCAxOiBQcm9jZXNzIGF1ZGlvIGlucHV0XHJcbiAgICBjb25zdCBhdWRpb0V2ZW50ID0ge1xyXG4gICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgIHBhdGg6ICcvYXBpL3Byb2Nlc3MtYXVkaW8nLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdtdWx0aXBhcnQvZm9ybS1kYXRhJyxcclxuICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgdmFsaWQtdG9rZW4nXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBhdWRpb0RhdGE6ICdiYXNlNjQtZW5jb2RlZC1hdWRpby1kYXRhJyxcclxuICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJ1xyXG4gICAgICB9KSxcclxuICAgICAgcmVxdWVzdENvbnRleHQ6IHtcclxuICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnXHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgaW5wdXRSZXN1bHQgPSBhd2FpdCBpbnB1dFByb2Nlc3NvcihhdWRpb0V2ZW50LCB7fSBhcyBhbnkpO1xyXG4gICAgZXhwZWN0KGlucHV0UmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgIFxyXG4gICAgY29uc3QgaW5wdXRSZXNwb25zZSA9IEpTT04ucGFyc2UoaW5wdXRSZXN1bHQuYm9keSk7XHJcbiAgICBleHBlY3QoaW5wdXRSZXNwb25zZS50cmFuc2NyaXB0aW9uKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgZXhwZWN0KGlucHV0UmVzcG9uc2UuY29udGVudElkKS50b0JlRGVmaW5lZCgpO1xyXG5cclxuICAgIC8vIFN0ZXAgMjogQ29udGVudCBvcmNoZXN0cmF0aW9uXHJcbiAgICBjb25zdCBvcmNoZXN0cmF0aW9uRXZlbnQgPSB7XHJcbiAgICAgIFJlY29yZHM6IFt7XHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgY29udGVudElkOiBpbnB1dFJlc3BvbnNlLmNvbnRlbnRJZCxcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb246IGlucHV0UmVzcG9uc2UudHJhbnNjcmlwdGlvbixcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgICAgdXNlckNvbnRleHQ6IHtcclxuICAgICAgICAgICAgd3JpdGluZ1N0eWxlOiAnVGVjaG5pY2FsIGFuZCBpbmZvcm1hdGl2ZScsXHJcbiAgICAgICAgICAgIGV4cGVydGlzZTogJ1NvZnR3YXJlIGRldmVsb3BtZW50IGFuZCBBSSdcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KVxyXG4gICAgICB9XVxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBvcmNoZXN0cmF0aW9uUmVzdWx0ID0gYXdhaXQgY29udGVudE9yY2hlc3RyYXRvcihvcmNoZXN0cmF0aW9uRXZlbnQsIHt9IGFzIGFueSk7XHJcbiAgICBleHBlY3Qob3JjaGVzdHJhdGlvblJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcblxyXG4gICAgLy8gU3RlcCAzOiBJbWFnZSBnZW5lcmF0aW9uXHJcbiAgICBjb25zdCBpbWFnZUV2ZW50ID0ge1xyXG4gICAgICBSZWNvcmRzOiBbe1xyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGNvbnRlbnRJZDogaW5wdXRSZXNwb25zZS5jb250ZW50SWQsXHJcbiAgICAgICAgICBibG9nQ29udGVudDoge1xyXG4gICAgICAgICAgICB0aXRsZTogJ1Rlc3QgQmxvZyBQb3N0JyxcclxuICAgICAgICAgICAgYm9keTogJ1RoaXMgaXMgYSB0ZXN0IGJsb2cgcG9zdCBhYm91dCBBSSBhbmQgdGVjaG5vbG9neS4uLicsXHJcbiAgICAgICAgICAgIHN1bW1hcnk6ICdBIGNvbXByZWhlbnNpdmUgb3ZlcnZpZXcgb2YgQUkgYXBwbGljYXRpb25zJ1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pXHJcbiAgICAgIH1dXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGltYWdlUmVzdWx0ID0gYXdhaXQgaW1hZ2VHZW5lcmF0aW9uQWdlbnQoaW1hZ2VFdmVudCwge30gYXMgYW55KTtcclxuICAgIGV4cGVjdChpbWFnZVJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcblxyXG4gICAgLy8gU3RlcCA0OiBQdWJsaXNoaW5nIG9yY2hlc3RyYXRpb25cclxuICAgIGNvbnN0IHB1Ymxpc2hpbmdFdmVudCA9IHtcclxuICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICBwYXRoOiAnL2FwaS9wdWJsaXNoJyxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyIHZhbGlkLXRva2VuJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgY29udGVudElkOiBpbnB1dFJlc3BvbnNlLmNvbnRlbnRJZCxcclxuICAgICAgICBwbGF0Zm9ybXM6IFsnbWVkaXVtJywgJ2xpbmtlZGluJ10sXHJcbiAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMydcclxuICAgICAgfSksXHJcbiAgICAgIHJlcXVlc3RDb250ZXh0OiB7XHJcbiAgICAgICAgcmVxdWVzdElkOiAndGVzdC1wdWJsaXNoLXJlcXVlc3QnXHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcHVibGlzaGluZ1Jlc3VsdCA9IGF3YWl0IHB1Ymxpc2hpbmdPcmNoZXN0cmF0b3IocHVibGlzaGluZ0V2ZW50LCB7fSBhcyBhbnkpO1xyXG4gICAgZXhwZWN0KHB1Ymxpc2hpbmdSZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgXHJcbiAgICBjb25zdCBwdWJsaXNoaW5nUmVzcG9uc2UgPSBKU09OLnBhcnNlKHB1Ymxpc2hpbmdSZXN1bHQuYm9keSk7XHJcbiAgICBleHBlY3QocHVibGlzaGluZ1Jlc3BvbnNlLnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XHJcbiAgICBleHBlY3QocHVibGlzaGluZ1Jlc3BvbnNlLnB1Ymxpc2hlZFVybHMpLnRvQmVEZWZpbmVkKCk7XHJcbiAgICBleHBlY3QocHVibGlzaGluZ1Jlc3BvbnNlLnB1Ymxpc2hlZFVybHMubWVkaXVtKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgZXhwZWN0KHB1Ymxpc2hpbmdSZXNwb25zZS5wdWJsaXNoZWRVcmxzLmxpbmtlZGluKS50b0JlRGVmaW5lZCgpO1xyXG5cclxuICAgIC8vIFZlcmlmeSBhbGwgY29tcG9uZW50cyB3ZXJlIGNhbGxlZCB3aXRoIGNvcnJlY3QgZGF0YVxyXG4gICAgZXhwZWN0KGR5bmFtb01vY2suY2FsbHMoKSkudG9IYXZlTGVuZ3RoKDQpOyAvLyBPbmUgY2FsbCBwZXIgc3RlcFxyXG4gICAgZXhwZWN0KHMzTW9jay5jYWxscygpKS50b0hhdmVMZW5ndGgoMik7IC8vIEF1ZGlvIHN0b3JhZ2UgYW5kIGltYWdlIHN0b3JhZ2VcclxuICAgIGV4cGVjdChzcXNNb2NrLmNhbGxzKCkpLnRvSGF2ZUxlbmd0aCgzKTsgLy8gSW50ZXItc2VydmljZSBjb21tdW5pY2F0aW9uXHJcbiAgfSk7XHJcblxyXG4gIGl0KCdoYW5kbGVzIHBpcGVsaW5lIGZhaWx1cmVzIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAvLyBNb2NrIGZhaWx1cmUgaW4gY29udGVudCBnZW5lcmF0aW9uXHJcbiAgICBkeW5hbW9Nb2NrLnJlamVjdHNPbmNlKG5ldyBFcnJvcignRHluYW1vREIgY29ubmVjdGlvbiBmYWlsZWQnKSk7XHJcblxyXG4gICAgY29uc3QgYXVkaW9FdmVudCA9IHtcclxuICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICBwYXRoOiAnL2FwaS9wcm9jZXNzLWF1ZGlvJyxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnbXVsdGlwYXJ0L2Zvcm0tZGF0YScsXHJcbiAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyIHZhbGlkLXRva2VuJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgYXVkaW9EYXRhOiAnYmFzZTY0LWVuY29kZWQtYXVkaW8tZGF0YScsXHJcbiAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMydcclxuICAgICAgfSksXHJcbiAgICAgIHJlcXVlc3RDb250ZXh0OiB7XHJcbiAgICAgICAgcmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJ1xyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGlucHV0UHJvY2Vzc29yKGF1ZGlvRXZlbnQsIHt9IGFzIGFueSk7XHJcbiAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcclxuICAgIFxyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBKU09OLnBhcnNlKHJlc3VsdC5ib2R5KTtcclxuICAgIGV4cGVjdChyZXNwb25zZS5lcnJvcikudG9CZURlZmluZWQoKTtcclxuICAgIGV4cGVjdChyZXNwb25zZS5yZXRyeWFibGUpLnRvQmUodHJ1ZSk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdwcm9jZXNzZXMgdGV4dCBpbnB1dCBwaXBlbGluZScsIGFzeW5jICgpID0+IHtcclxuICAgIGR5bmFtb01vY2sucmVzb2x2ZXMoe30pO1xyXG4gICAgczNNb2NrLnJlc29sdmVzKHt9KTtcclxuICAgIHNxc01vY2sucmVzb2x2ZXMoe30pO1xyXG5cclxuICAgIC8vIFRleHQgaW5wdXQgZXZlbnRcclxuICAgIGNvbnN0IHRleHRFdmVudCA9IHtcclxuICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICBwYXRoOiAnL2FwaS9wcm9jZXNzLXRleHQnLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgdmFsaWQtdG9rZW4nXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICB0ZXh0SW5wdXQ6ICdUaGlzIGlzIGEgYmxvZyBwb3N0IGlkZWEgYWJvdXQgbWFjaGluZSBsZWFybmluZyBhcHBsaWNhdGlvbnMgaW4gaGVhbHRoY2FyZS4nLFxyXG4gICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnXHJcbiAgICAgIH0pLFxyXG4gICAgICByZXF1ZXN0Q29udGV4dDoge1xyXG4gICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtdGV4dC1yZXF1ZXN0J1xyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGlucHV0UHJvY2Vzc29yKHRleHRFdmVudCwge30gYXMgYW55KTtcclxuICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgXHJcbiAgICBjb25zdCByZXNwb25zZSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgZXhwZWN0KHJlc3BvbnNlLmNvbnRlbnRJZCkudG9CZURlZmluZWQoKTtcclxuICAgIGV4cGVjdChyZXNwb25zZS5wcm9jZXNzZWRUZXh0KS50b0JlRGVmaW5lZCgpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnaGFuZGxlcyByZXZpc2lvbiB3b3JrZmxvdycsIGFzeW5jICgpID0+IHtcclxuICAgIGR5bmFtb01vY2sucmVzb2x2ZXMoe30pO1xyXG4gICAgczNNb2NrLnJlc29sdmVzKHt9KTtcclxuICAgIHNxc01vY2sucmVzb2x2ZXMoe30pO1xyXG5cclxuICAgIC8vIFJldmlzaW9uIHJlcXVlc3QgZXZlbnRcclxuICAgIGNvbnN0IHJldmlzaW9uRXZlbnQgPSB7XHJcbiAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgcGF0aDogJy9hcGkvcmVxdWVzdC1yZXZpc2lvbicsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciB2YWxpZC10b2tlbidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGNvbnRlbnRJZDogJ2V4aXN0aW5nLWNvbnRlbnQtaWQnLFxyXG4gICAgICAgIGZlZWRiYWNrOiAnUGxlYXNlIG1ha2UgdGhlIGludHJvZHVjdGlvbiBtb3JlIGVuZ2FnaW5nJyxcclxuICAgICAgICByZXZpc2lvblR5cGU6ICdjb250ZW50JyxcclxuICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJ1xyXG4gICAgICB9KSxcclxuICAgICAgcmVxdWVzdENvbnRleHQ6IHtcclxuICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJldmlzaW9uLXJlcXVlc3QnXHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29udGVudE9yY2hlc3RyYXRvcihyZXZpc2lvbkV2ZW50LCB7fSBhcyBhbnkpO1xyXG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICBcclxuICAgIGNvbnN0IHJlc3BvbnNlID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICBleHBlY3QocmVzcG9uc2UucmV2aXNpb25JZCkudG9CZURlZmluZWQoKTtcclxuICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMpLnRvQmUoJ3Byb2Nlc3NpbmcnKTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ3ZhbGlkYXRlcyBhdWRpbyBxdWFsaXR5IGJlZm9yZSBwcm9jZXNzaW5nJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgZHluYW1vTW9jay5yZXNvbHZlcyh7fSk7XHJcbiAgICBzM01vY2sucmVzb2x2ZXMoe30pO1xyXG5cclxuICAgIC8vIFBvb3IgcXVhbGl0eSBhdWRpbyBldmVudFxyXG4gICAgY29uc3QgcG9vckF1ZGlvRXZlbnQgPSB7XHJcbiAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgcGF0aDogJy9hcGkvcHJvY2Vzcy1hdWRpbycsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ211bHRpcGFydC9mb3JtLWRhdGEnLFxyXG4gICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciB2YWxpZC10b2tlbidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGF1ZGlvRGF0YTogJ3Zlcnktc2hvcnQtYXVkaW8tZGF0YScsIC8vIFNpbXVsYXRpbmcgcG9vciBxdWFsaXR5XHJcbiAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMydcclxuICAgICAgfSksXHJcbiAgICAgIHJlcXVlc3RDb250ZXh0OiB7XHJcbiAgICAgICAgcmVxdWVzdElkOiAndGVzdC1wb29yLWF1ZGlvJ1xyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGlucHV0UHJvY2Vzc29yKHBvb3JBdWRpb0V2ZW50LCB7fSBhcyBhbnkpO1xyXG4gICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDQwMCk7XHJcbiAgICBcclxuICAgIGNvbnN0IHJlc3BvbnNlID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICBleHBlY3QocmVzcG9uc2UuZXJyb3IpLnRvQ29udGFpbignYXVkaW8gcXVhbGl0eScpO1xyXG4gICAgZXhwZWN0KHJlc3BvbnNlLnN1Z2dlc3Rpb25zKS50b0JlRGVmaW5lZCgpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnaGFuZGxlcyBjb25jdXJyZW50IHByb2Nlc3NpbmcgcmVxdWVzdHMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICBkeW5hbW9Nb2NrLnJlc29sdmVzKHt9KTtcclxuICAgIHMzTW9jay5yZXNvbHZlcyh7fSk7XHJcbiAgICBzcXNNb2NrLnJlc29sdmVzKHt9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgbXVsdGlwbGUgY29uY3VycmVudCByZXF1ZXN0c1xyXG4gICAgY29uc3QgcmVxdWVzdHMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiA1IH0sIChfLCBpKSA9PiAoe1xyXG4gICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgIHBhdGg6ICcvYXBpL3Byb2Nlc3MtYXVkaW8nLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdtdWx0aXBhcnQvZm9ybS1kYXRhJyxcclxuICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgdmFsaWQtdG9rZW4nXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBhdWRpb0RhdGE6IGBhdWRpby1kYXRhLSR7aX1gLFxyXG4gICAgICAgIHVzZXJJZDogYHRlc3QtdXNlci0ke2l9YFxyXG4gICAgICB9KSxcclxuICAgICAgcmVxdWVzdENvbnRleHQ6IHtcclxuICAgICAgICByZXF1ZXN0SWQ6IGBjb25jdXJyZW50LXJlcXVlc3QtJHtpfWBcclxuICAgICAgfVxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFByb2Nlc3MgYWxsIHJlcXVlc3RzIGNvbmN1cnJlbnRseVxyXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgICByZXF1ZXN0cy5tYXAoZXZlbnQgPT4gaW5wdXRQcm9jZXNzb3IoZXZlbnQsIHt9IGFzIGFueSkpXHJcbiAgICApO1xyXG5cclxuICAgIC8vIFZlcmlmeSBhbGwgcmVxdWVzdHMgc3VjY2VlZGVkXHJcbiAgICByZXN1bHRzLmZvckVhY2goKHJlc3VsdCwgaW5kZXgpID0+IHtcclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZS5jb250ZW50SWQpLnRvQmVEZWZpbmVkKCk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZS5jb250ZW50SWQpLnRvQ29udGFpbihgdGVzdC11c2VyLSR7aW5kZXh9YCk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ21haW50YWlucyBkYXRhIGNvbnNpc3RlbmN5IGFjcm9zcyBwaXBlbGluZSBzdGFnZXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICBjb25zdCBjb250ZW50SWQgPSAnY29uc2lzdGVuY3ktdGVzdC1jb250ZW50LWlkJztcclxuICAgIFxyXG4gICAgZHluYW1vTW9jay5yZXNvbHZlcyh7XHJcbiAgICAgIEl0ZW06IHtcclxuICAgICAgICBjb250ZW50SWQ6IHsgUzogY29udGVudElkIH0sXHJcbiAgICAgICAgc3RhdHVzOiB7IFM6ICdwcm9jZXNzaW5nJyB9LFxyXG4gICAgICAgIHVzZXJJZDogeyBTOiAndGVzdC11c2VyLTEyMycgfVxyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICAgIHMzTW9jay5yZXNvbHZlcyh7fSk7XHJcbiAgICBzcXNNb2NrLnJlc29sdmVzKHt9KTtcclxuXHJcbiAgICAvLyBWZXJpZnkgY29udGVudCB0cmFja2luZyB0aHJvdWdoIHBpcGVsaW5lXHJcbiAgICBjb25zdCBzdGF0dXNDaGVja0V2ZW50ID0ge1xyXG4gICAgICBodHRwTWV0aG9kOiAnR0VUJyxcclxuICAgICAgcGF0aDogYC9hcGkvY29udGVudC1zdGF0dXMvJHtjb250ZW50SWR9YCxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciB2YWxpZC10b2tlbidcclxuICAgICAgfSxcclxuICAgICAgcGF0aFBhcmFtZXRlcnM6IHtcclxuICAgICAgICBjb250ZW50SWQ6IGNvbnRlbnRJZFxyXG4gICAgICB9LFxyXG4gICAgICByZXF1ZXN0Q29udGV4dDoge1xyXG4gICAgICAgIHJlcXVlc3RJZDogJ3N0YXR1cy1jaGVjay1yZXF1ZXN0J1xyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbnRlbnRPcmNoZXN0cmF0b3Ioc3RhdHVzQ2hlY2tFdmVudCwge30gYXMgYW55KTtcclxuICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgXHJcbiAgICBjb25zdCByZXNwb25zZSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgZXhwZWN0KHJlc3BvbnNlLmNvbnRlbnRJZCkudG9CZShjb250ZW50SWQpO1xyXG4gICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cykudG9CZURlZmluZWQoKTtcclxuICAgIGV4cGVjdChyZXNwb25zZS51c2VySWQpLnRvQmUoJ3Rlc3QtdXNlci0xMjMnKTtcclxuICB9KTtcclxufSk7Il19