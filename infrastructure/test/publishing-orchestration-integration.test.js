"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const publishing_orchestrator_1 = require("../lambda/publishing-orchestrator");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_sqs_1 = require("@aws-sdk/client-sqs");
// Mock AWS services
jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('@aws-sdk/client-sqs');
// Mock the publishing registry before importing the handler
const mockPublishingRegistry = {
    publishToMultiplePlatforms: jest.fn(),
    getSupportedPlatforms: jest.fn(),
    getPlatformFeatures: jest.fn(),
    validateCredentials: jest.fn(),
    formatContent: jest.fn(),
    getPublishingStatus: jest.fn()
};
jest.mock('../lambda/publishing/publishing-agent-registry', () => ({
    publishingRegistry: mockPublishingRegistry
}));
const mockDocClient = {
    send: jest.fn()
};
const mockSqsClient = {
    send: jest.fn()
};
// Mock environment variables
process.env.CONTENT_TABLE_NAME = 'test-content-table';
process.env.PUBLISHING_JOBS_TABLE_NAME = 'test-jobs-table';
process.env.PUBLISHING_ORCHESTRATION_TABLE_NAME = 'test-orchestration-table';
process.env.PUBLISHING_QUEUE_URL = 'test-queue-url';
describe('Publishing Orchestration Integration Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Setup default mocks
        lib_dynamodb_1.DynamoDBDocumentClient.from.mockReturnValue(mockDocClient);
        client_sqs_1.SQSClient.mockImplementation(() => mockSqsClient);
    });
    const createEvent = (path, method = 'POST', body) => ({
        httpMethod: method,
        path,
        body: body ? JSON.stringify(body) : null,
        headers: {},
        queryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {},
        resource: '',
        isBase64Encoded: false,
        multiValueHeaders: {},
        multiValueQueryStringParameters: null
    });
    describe('GET /publishing/platforms', () => {
        it('should return supported platforms', async () => {
            mockPublishingRegistry.getSupportedPlatforms.mockReturnValue(['medium', 'linkedin']);
            mockPublishingRegistry.getPlatformFeatures.mockImplementation((platform) => platform === 'medium' ? ['articles', 'publications'] : ['posts', 'articles']);
            const event = createEvent('/publishing/platforms', 'GET');
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.platforms).toHaveLength(2);
            expect(body.platforms[0]).toEqual({
                name: 'medium',
                features: ['articles', 'publications']
            });
        });
    });
    describe('POST /publishing/orchestrate', () => {
        it('should create orchestration job and queue individual platform jobs', async () => {
            const requestBody = {
                contentId: 'content-123',
                platforms: ['medium', 'linkedin'],
                configs: {
                    medium: { platform: 'medium', credentials: { token: 'medium-token' } },
                    linkedin: { platform: 'linkedin', credentials: { token: 'linkedin-token' } }
                },
                imageUrl: 'https://example.com/image.jpg'
            };
            mockDocClient.send.mockResolvedValue({});
            mockSqsClient.send.mockResolvedValue({});
            const event = createEvent('/publishing/orchestrate', 'POST', requestBody);
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.contentId).toBe('content-123');
            expect(body.totalPlatforms).toBe(2);
            expect(body.status).toBe('in_progress');
            expect(Object.keys(body.jobs)).toHaveLength(2);
            // Verify DynamoDB calls for job storage
            expect(mockDocClient.send).toHaveBeenCalledTimes(3); // 2 jobs + 1 orchestration
            // Verify SQS calls for job queuing
            expect(mockSqsClient.send).toHaveBeenCalledTimes(2);
        });
        it('should handle missing required parameters', async () => {
            const event = createEvent('/publishing/orchestrate', 'POST', {
                contentId: 'content-123'
                // Missing platforms and configs
            });
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.error).toContain('required');
        });
        it('should handle platforms without configurations', async () => {
            const requestBody = {
                contentId: 'content-123',
                platforms: ['medium', 'linkedin'],
                configs: {
                    medium: { platform: 'medium', credentials: { token: 'medium-token' } }
                    // Missing linkedin config
                }
            };
            mockDocClient.send.mockResolvedValue({});
            mockSqsClient.send.mockResolvedValue({});
            const event = createEvent('/publishing/orchestrate', 'POST', requestBody);
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            // Should have error result for linkedin
            expect(body.results.linkedin).toEqual({
                success: false,
                error: 'No configuration found for platform: linkedin'
            });
            // Should only create job for medium
            expect(Object.keys(body.jobs)).toHaveLength(1);
            expect(body.jobs.medium).toBeDefined();
        });
    });
    describe('POST /publishing/retry', () => {
        it('should retry failed jobs with exponential backoff', async () => {
            const jobId = 'job-123';
            const orchestrationResult = {
                jobId,
                contentId: 'content-123',
                jobs: {
                    medium: {
                        id: 'job-123_medium',
                        contentId: 'content-123',
                        platform: 'medium',
                        status: 'failed',
                        attempts: 1,
                        maxAttempts: 3,
                        lastError: 'Network error'
                    },
                    linkedin: {
                        id: 'job-123_linkedin',
                        contentId: 'content-123',
                        platform: 'linkedin',
                        status: 'completed',
                        attempts: 1,
                        maxAttempts: 3
                    }
                }
            };
            mockDocClient.send
                .mockResolvedValueOnce({ Item: orchestrationResult }) // Get orchestration
                .mockResolvedValue({}); // Update calls
            mockSqsClient.send.mockResolvedValue({});
            const event = createEvent('/publishing/retry', 'POST', { jobId });
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            // Should only retry the failed medium job
            expect(mockDocClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    Key: { id: 'job-123_medium' },
                    UpdateExpression: expect.stringContaining('attempts = :attempts')
                })
            }));
            // Should queue retry with delay
            expect(mockSqsClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    DelaySeconds: 4 // 2^2 for attempt 2
                })
            }));
        });
        it('should not retry jobs that have exceeded max attempts', async () => {
            const jobId = 'job-123';
            const orchestrationResult = {
                jobId,
                contentId: 'content-123',
                jobs: {
                    medium: {
                        id: 'job-123_medium',
                        contentId: 'content-123',
                        platform: 'medium',
                        status: 'failed',
                        attempts: 3,
                        maxAttempts: 3,
                        lastError: 'Max attempts exceeded'
                    }
                }
            };
            mockDocClient.send.mockResolvedValueOnce({ Item: orchestrationResult });
            const event = createEvent('/publishing/retry', 'POST', { jobId });
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            // Should not update or queue any jobs
            expect(mockDocClient.send).toHaveBeenCalledTimes(1); // Only the get call
            expect(mockSqsClient.send).not.toHaveBeenCalled();
        });
    });
    describe('GET /publishing/job-status', () => {
        it('should return job status', async () => {
            const jobId = 'job-123';
            const orchestrationResult = {
                jobId,
                contentId: 'content-123',
                totalPlatforms: 2,
                successfulPlatforms: 1,
                failedPlatforms: 1,
                status: 'partial',
                jobs: {
                    medium: { status: 'completed' },
                    linkedin: { status: 'failed' }
                }
            };
            mockDocClient.send.mockResolvedValue({ Item: orchestrationResult });
            const event = createEvent('/publishing/job-status', 'GET');
            event.queryStringParameters = { jobId };
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.jobId).toBe(jobId);
            expect(body.status).toBe('partial');
        });
        it('should return 400 for missing jobId', async () => {
            const event = createEvent('/publishing/job-status', 'GET');
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.error).toContain('JobId is required');
        });
    });
    describe('POST /publishing/cancel', () => {
        it('should cancel orchestration and pending jobs', async () => {
            const jobId = 'job-123';
            const jobs = {
                Items: [
                    { id: 'job-123_medium', status: 'pending' },
                    { id: 'job-123_linkedin', status: 'in_progress' },
                    { id: 'job-123_twitter', status: 'completed' }
                ]
            };
            mockDocClient.send
                .mockResolvedValueOnce({}) // Update orchestration
                .mockResolvedValueOnce(jobs) // Query jobs
                .mockResolvedValue({}); // Update individual jobs
            const event = createEvent('/publishing/cancel', 'POST', { jobId });
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            // Should update orchestration status
            expect(mockDocClient.send).toHaveBeenCalledWith(expect.objectContaining({
                input: expect.objectContaining({
                    Key: { jobId },
                    UpdateExpression: expect.stringContaining('#status = :status')
                })
            }));
            // Should cancel pending and in_progress jobs (not completed)
            expect(mockDocClient.send).toHaveBeenCalledTimes(4); // 1 orchestration + 1 query + 2 job updates
        });
    });
    describe('POST /publishing/publish with retry logic', () => {
        it('should retry failed platforms only', async () => {
            const contentId = 'content-123';
            const content = {
                id: contentId,
                title: 'Test Post',
                currentDraft: 'Test content',
                publishingResults: [
                    { platform: 'medium', success: true, platformUrl: 'https://medium.com/post' },
                    { platform: 'linkedin', success: false, error: 'Network error' }
                ]
            };
            mockDocClient.send
                .mockResolvedValueOnce({ Item: content }) // Get content
                .mockResolvedValue({}); // Update content
            mockPublishingRegistry.publishToMultiplePlatforms.mockResolvedValue(new Map([
                ['linkedin', { success: true, platformUrl: 'https://linkedin.com/post' }]
            ]));
            const event = createEvent('/publishing/publish', 'POST', {
                contentId,
                platforms: ['medium', 'linkedin'],
                configs: {
                    medium: { platform: 'medium', credentials: {} },
                    linkedin: { platform: 'linkedin', credentials: {} }
                },
                retryFailedOnly: true
            });
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.success).toBe(true);
            // Should only publish to linkedin (the failed platform)
            expect(mockPublishingRegistry.publishToMultiplePlatforms).toHaveBeenCalledWith(['linkedin'], content, expect.any(Map), undefined);
        });
        it('should handle case where no platforms need retry', async () => {
            const contentId = 'content-123';
            const content = {
                id: contentId,
                publishingResults: [
                    { platform: 'medium', success: true },
                    { platform: 'linkedin', success: true }
                ]
            };
            mockDocClient.send.mockResolvedValue({ Item: content });
            const event = createEvent('/publishing/publish', 'POST', {
                contentId,
                platforms: ['medium', 'linkedin'],
                configs: {},
                retryFailedOnly: true
            });
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            const body = JSON.parse(result.body);
            expect(body.message).toBe('No platforms to retry');
            expect(mockPublishingRegistry.publishToMultiplePlatforms).not.toHaveBeenCalled();
        });
    });
    describe('Error handling', () => {
        it('should handle DynamoDB errors gracefully', async () => {
            mockDocClient.send.mockRejectedValue(new Error('DynamoDB error'));
            const event = createEvent('/publishing/orchestrate', 'POST', {
                contentId: 'content-123',
                platforms: ['medium'],
                configs: { medium: {} }
            });
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.error).toBe('Orchestration failed');
            expect(body.message).toBe('DynamoDB error');
        });
        it('should handle SQS errors gracefully', async () => {
            mockDocClient.send.mockResolvedValue({});
            mockSqsClient.send.mockRejectedValue(new Error('SQS error'));
            const event = createEvent('/publishing/orchestrate', 'POST', {
                contentId: 'content-123',
                platforms: ['medium'],
                configs: { medium: {} }
            });
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(500);
            const body = JSON.parse(result.body);
            expect(body.error).toBe('Orchestration failed');
        });
    });
    describe('CORS handling', () => {
        it('should handle OPTIONS requests', async () => {
            const event = createEvent('/publishing/platforms', 'OPTIONS');
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.statusCode).toBe(200);
            expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
            expect(result.headers?.['Access-Control-Allow-Methods']).toContain('POST');
        });
        it('should include CORS headers in all responses', async () => {
            mockPublishingRegistry.getSupportedPlatforms.mockReturnValue([]);
            mockPublishingRegistry.getPlatformFeatures.mockReturnValue([]);
            const event = createEvent('/publishing/platforms', 'GET');
            const result = await (0, publishing_orchestrator_1.handler)(event);
            expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
            expect(result.headers?.['Access-Control-Allow-Headers']).toContain('Content-Type');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHVibGlzaGluZy1vcmNoZXN0cmF0aW9uLWludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwdWJsaXNoaW5nLW9yY2hlc3RyYXRpb24taW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLCtFQUE0RDtBQUU1RCx3REFBK0Q7QUFDL0Qsb0RBQWdEO0FBRWhELG9CQUFvQjtBQUNwQixJQUFJLENBQUMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLENBQUM7QUFDbkMsSUFBSSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO0FBRWpDLDREQUE0RDtBQUM1RCxNQUFNLHNCQUFzQixHQUFHO0lBQzdCLDBCQUEwQixFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7SUFDckMscUJBQXFCLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtJQUNoQyxtQkFBbUIsRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0lBQzlCLG1CQUFtQixFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7SUFDOUIsYUFBYSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7SUFDeEIsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtDQUMvQixDQUFDO0FBRUYsSUFBSSxDQUFDLElBQUksQ0FBQyxnREFBZ0QsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ2pFLGtCQUFrQixFQUFFLHNCQUFzQjtDQUMzQyxDQUFDLENBQUMsQ0FBQztBQUVKLE1BQU0sYUFBYSxHQUFHO0lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0NBQ2hCLENBQUM7QUFFRixNQUFNLGFBQWEsR0FBRztJQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtDQUNoQixDQUFDO0FBRUYsNkJBQTZCO0FBQzdCLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLEdBQUcsb0JBQW9CLENBQUM7QUFDdEQsT0FBTyxDQUFDLEdBQUcsQ0FB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Q0FBQztZQUVwQyxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNwQyxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLDZCQUE2QixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDbEUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQzdFLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLDhDQUE4QyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQzVELHNCQUFzQixDQUFDLHFCQUFxQixDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUNqRSxzQkFBc0IsQ0FBQyxtQkFBbUIsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDLENBQUM7WUFFL0QsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLHVCQUF1QixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQzFELE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBQSxpQ0FBTyxFQUFDLEtBQUssQ0FBQyxDQUFDO1lBRXBDLE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNsRSxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLDhCQUE4QixDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDckYsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgaGFuZGxlciB9IGZyb20gJy4uL2xhbWJkYS9wdWJsaXNoaW5nLW9yY2hlc3RyYXRvcic7XHJcbmltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBTUVNDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc3FzJztcclxuXHJcbi8vIE1vY2sgQVdTIHNlcnZpY2VzXHJcbmplc3QubW9jaygnQGF3cy1zZGsvbGliLWR5bmFtb2RiJyk7XHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LXNxcycpO1xyXG5cclxuLy8gTW9jayB0aGUgcHVibGlzaGluZyByZWdpc3RyeSBiZWZvcmUgaW1wb3J0aW5nIHRoZSBoYW5kbGVyXHJcbmNvbnN0IG1vY2tQdWJsaXNoaW5nUmVnaXN0cnkgPSB7XHJcbiAgcHVibGlzaFRvTXVsdGlwbGVQbGF0Zm9ybXM6IGplc3QuZm4oKSxcclxuICBnZXRTdXBwb3J0ZWRQbGF0Zm9ybXM6IGplc3QuZm4oKSxcclxuICBnZXRQbGF0Zm9ybUZlYXR1cmVzOiBqZXN0LmZuKCksXHJcbiAgdmFsaWRhdGVDcmVkZW50aWFsczogamVzdC5mbigpLFxyXG4gIGZvcm1hdENvbnRlbnQ6IGplc3QuZm4oKSxcclxuICBnZXRQdWJsaXNoaW5nU3RhdHVzOiBqZXN0LmZuKClcclxufTtcclxuXHJcbmplc3QubW9jaygnLi4vbGFtYmRhL3B1Ymxpc2hpbmcvcHVibGlzaGluZy1hZ2VudC1yZWdpc3RyeScsICgpID0+ICh7XHJcbiAgcHVibGlzaGluZ1JlZ2lzdHJ5OiBtb2NrUHVibGlzaGluZ1JlZ2lzdHJ5XHJcbn0pKTtcclxuXHJcbmNvbnN0IG1vY2tEb2NDbGllbnQgPSB7XHJcbiAgc2VuZDogamVzdC5mbigpXHJcbn07XHJcblxyXG5jb25zdCBtb2NrU3FzQ2xpZW50ID0ge1xyXG4gIHNlbmQ6IGplc3QuZm4oKVxyXG59O1xyXG5cclxuLy8gTW9jayBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxucHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FID0gJ3Rlc3QtY29udGVudC10YWJsZSc7XHJcbnByb2Nlc3MuZW52LlBVQkxJU0hJTkdfSk9CU19UQUJMRV9OQU1FID0gJ3Rlc3Qtam9icy10YWJsZSc7XHJcbnByb2Nlc3MuZW52LlBVQkxJU0hJTkdfT1JDSEVTVFJBVElPTl9UQUJMRV9OQU1FID0gJ3Rlc3Qtb3JjaGVzdHJhdGlvbi10YWJsZSc7XHJcbnByb2Nlc3MuZW52LlBVQkxJU0hJTkdfUVVFVUVfVVJMID0gJ3Rlc3QtcXVldWUtdXJsJztcclxuXHJcbmRlc2NyaWJlKCdQdWJsaXNoaW5nIE9yY2hlc3RyYXRpb24gSW50ZWdyYXRpb24gVGVzdHMnLCAoKSA9PiB7XHJcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XHJcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcclxuICAgIFxyXG4gICAgLy8gU2V0dXAgZGVmYXVsdCBtb2Nrc1xyXG4gICAgKER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbSBhcyBqZXN0Lk1vY2spLm1vY2tSZXR1cm5WYWx1ZShtb2NrRG9jQ2xpZW50KTtcclxuICAgIChTUVNDbGllbnQgYXMgamVzdC5Nb2NrKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gbW9ja1Nxc0NsaWVudCk7XHJcbiAgICBcclxuXHJcbiAgfSk7XHJcblxyXG4gIGNvbnN0IGNyZWF0ZUV2ZW50ID0gKHBhdGg6IHN0cmluZywgbWV0aG9kOiBzdHJpbmcgPSAnUE9TVCcsIGJvZHk/OiBhbnkpOiBBUElHYXRld2F5UHJveHlFdmVudCA9PiAoe1xyXG4gICAgaHR0cE1ldGhvZDogbWV0aG9kLFxyXG4gICAgcGF0aCxcclxuICAgIGJvZHk6IGJvZHkgPyBKU09OLnN0cmluZ2lmeShib2R5KSA6IG51bGwsXHJcbiAgICBoZWFkZXJzOiB7fSxcclxuICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGxcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0dFVCAvcHVibGlzaGluZy9wbGF0Zm9ybXMnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHJldHVybiBzdXBwb3J0ZWQgcGxhdGZvcm1zJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBtb2NrUHVibGlzaGluZ1JlZ2lzdHJ5LmdldFN1cHBvcnRlZFBsYXRmb3Jtcy5tb2NrUmV0dXJuVmFsdWUoWydtZWRpdW0nLCAnbGlua2VkaW4nXSk7XHJcbiAgICAgIG1vY2tQdWJsaXNoaW5nUmVnaXN0cnkuZ2V0UGxhdGZvcm1GZWF0dXJlcy5tb2NrSW1wbGVtZW50YXRpb24oKHBsYXRmb3JtOiBzdHJpbmcpID0+IFxyXG4gICAgICAgIHBsYXRmb3JtID09PSAnbWVkaXVtJyA/IFsnYXJ0aWNsZXMnLCAncHVibGljYXRpb25zJ10gOiBbJ3Bvc3RzJywgJ2FydGljbGVzJ11cclxuICAgICAgKTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlRXZlbnQoJy9wdWJsaXNoaW5nL3BsYXRmb3JtcycsICdHRVQnKTtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QoYm9keS5wbGF0Zm9ybXMpLnRvSGF2ZUxlbmd0aCgyKTtcclxuICAgICAgZXhwZWN0KGJvZHkucGxhdGZvcm1zWzBdKS50b0VxdWFsKHtcclxuICAgICAgICBuYW1lOiAnbWVkaXVtJyxcclxuICAgICAgICBmZWF0dXJlczogWydhcnRpY2xlcycsICdwdWJsaWNhdGlvbnMnXVxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnUE9TVCAvcHVibGlzaGluZy9vcmNoZXN0cmF0ZScsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgY3JlYXRlIG9yY2hlc3RyYXRpb24gam9iIGFuZCBxdWV1ZSBpbmRpdmlkdWFsIHBsYXRmb3JtIGpvYnMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHJlcXVlc3RCb2R5ID0ge1xyXG4gICAgICAgIGNvbnRlbnRJZDogJ2NvbnRlbnQtMTIzJyxcclxuICAgICAgICBwbGF0Zm9ybXM6IFsnbWVkaXVtJywgJ2xpbmtlZGluJ10sXHJcbiAgICAgICAgY29uZmlnczoge1xyXG4gICAgICAgICAgbWVkaXVtOiB7IHBsYXRmb3JtOiAnbWVkaXVtJywgY3JlZGVudGlhbHM6IHsgdG9rZW46ICdtZWRpdW0tdG9rZW4nIH0gfSxcclxuICAgICAgICAgIGxpbmtlZGluOiB7IHBsYXRmb3JtOiAnbGlua2VkaW4nLCBjcmVkZW50aWFsczogeyB0b2tlbjogJ2xpbmtlZGluLXRva2VuJyB9IH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIGltYWdlVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZS5qcGcnXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBtb2NrRG9jQ2xpZW50LnNlbmQubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG4gICAgICBtb2NrU3FzQ2xpZW50LnNlbmQubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCgnL3B1Ymxpc2hpbmcvb3JjaGVzdHJhdGUnLCAnUE9TVCcsIHJlcXVlc3RCb2R5KTtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBcclxuICAgICAgZXhwZWN0KGJvZHkuY29udGVudElkKS50b0JlKCdjb250ZW50LTEyMycpO1xyXG4gICAgICBleHBlY3QoYm9keS50b3RhbFBsYXRmb3JtcykudG9CZSgyKTtcclxuICAgICAgZXhwZWN0KGJvZHkuc3RhdHVzKS50b0JlKCdpbl9wcm9ncmVzcycpO1xyXG4gICAgICBleHBlY3QoT2JqZWN0LmtleXMoYm9keS5qb2JzKSkudG9IYXZlTGVuZ3RoKDIpO1xyXG4gICAgICBcclxuICAgICAgLy8gVmVyaWZ5IER5bmFtb0RCIGNhbGxzIGZvciBqb2Igc3RvcmFnZVxyXG4gICAgICBleHBlY3QobW9ja0RvY0NsaWVudC5zZW5kKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMyk7IC8vIDIgam9icyArIDEgb3JjaGVzdHJhdGlvblxyXG4gICAgICBcclxuICAgICAgLy8gVmVyaWZ5IFNRUyBjYWxscyBmb3Igam9iIHF1ZXVpbmdcclxuICAgICAgZXhwZWN0KG1vY2tTcXNDbGllbnQuc2VuZCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDIpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXJzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZUV2ZW50KCcvcHVibGlzaGluZy9vcmNoZXN0cmF0ZScsICdQT1NUJywge1xyXG4gICAgICAgIGNvbnRlbnRJZDogJ2NvbnRlbnQtMTIzJ1xyXG4gICAgICAgIC8vIE1pc3NpbmcgcGxhdGZvcm1zIGFuZCBjb25maWdzXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDAwKTtcclxuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QoYm9keS5lcnJvcikudG9Db250YWluKCdyZXF1aXJlZCcpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgcGxhdGZvcm1zIHdpdGhvdXQgY29uZmlndXJhdGlvbnMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHJlcXVlc3RCb2R5ID0ge1xyXG4gICAgICAgIGNvbnRlbnRJZDogJ2NvbnRlbnQtMTIzJyxcclxuICAgICAgICBwbGF0Zm9ybXM6IFsnbWVkaXVtJywgJ2xpbmtlZGluJ10sXHJcbiAgICAgICAgY29uZmlnczoge1xyXG4gICAgICAgICAgbWVkaXVtOiB7IHBsYXRmb3JtOiAnbWVkaXVtJywgY3JlZGVudGlhbHM6IHsgdG9rZW46ICdtZWRpdW0tdG9rZW4nIH0gfVxyXG4gICAgICAgICAgLy8gTWlzc2luZyBsaW5rZWRpbiBjb25maWdcclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBtb2NrRG9jQ2xpZW50LnNlbmQubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG4gICAgICBtb2NrU3FzQ2xpZW50LnNlbmQubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCgnL3B1Ymxpc2hpbmcvb3JjaGVzdHJhdGUnLCAnUE9TVCcsIHJlcXVlc3RCb2R5KTtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBcclxuICAgICAgLy8gU2hvdWxkIGhhdmUgZXJyb3IgcmVzdWx0IGZvciBsaW5rZWRpblxyXG4gICAgICBleHBlY3QoYm9keS5yZXN1bHRzLmxpbmtlZGluKS50b0VxdWFsKHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogJ05vIGNvbmZpZ3VyYXRpb24gZm91bmQgZm9yIHBsYXRmb3JtOiBsaW5rZWRpbidcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBTaG91bGQgb25seSBjcmVhdGUgam9iIGZvciBtZWRpdW1cclxuICAgICAgZXhwZWN0KE9iamVjdC5rZXlzKGJvZHkuam9icykpLnRvSGF2ZUxlbmd0aCgxKTtcclxuICAgICAgZXhwZWN0KGJvZHkuam9icy5tZWRpdW0pLnRvQmVEZWZpbmVkKCk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ1BPU1QgL3B1Ymxpc2hpbmcvcmV0cnknLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHJldHJ5IGZhaWxlZCBqb2JzIHdpdGggZXhwb25lbnRpYWwgYmFja29mZicsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3Qgam9iSWQgPSAnam9iLTEyMyc7XHJcbiAgICAgIGNvbnN0IG9yY2hlc3RyYXRpb25SZXN1bHQgPSB7XHJcbiAgICAgICAgam9iSWQsXHJcbiAgICAgICAgY29udGVudElkOiAnY29udGVudC0xMjMnLFxyXG4gICAgICAgIGpvYnM6IHtcclxuICAgICAgICAgIG1lZGl1bToge1xyXG4gICAgICAgICAgICBpZDogJ2pvYi0xMjNfbWVkaXVtJyxcclxuICAgICAgICAgICAgY29udGVudElkOiAnY29udGVudC0xMjMnLFxyXG4gICAgICAgICAgICBwbGF0Zm9ybTogJ21lZGl1bScsXHJcbiAgICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsXHJcbiAgICAgICAgICAgIGF0dGVtcHRzOiAxLFxyXG4gICAgICAgICAgICBtYXhBdHRlbXB0czogMyxcclxuICAgICAgICAgICAgbGFzdEVycm9yOiAnTmV0d29yayBlcnJvcidcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBsaW5rZWRpbjoge1xyXG4gICAgICAgICAgICBpZDogJ2pvYi0xMjNfbGlua2VkaW4nLFxyXG4gICAgICAgICAgICBjb250ZW50SWQ6ICdjb250ZW50LTEyMycsXHJcbiAgICAgICAgICAgIHBsYXRmb3JtOiAnbGlua2VkaW4nLFxyXG4gICAgICAgICAgICBzdGF0dXM6ICdjb21wbGV0ZWQnLFxyXG4gICAgICAgICAgICBhdHRlbXB0czogMSxcclxuICAgICAgICAgICAgbWF4QXR0ZW1wdHM6IDNcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBtb2NrRG9jQ2xpZW50LnNlbmRcclxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHsgSXRlbTogb3JjaGVzdHJhdGlvblJlc3VsdCB9KSAvLyBHZXQgb3JjaGVzdHJhdGlvblxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZSh7fSk7IC8vIFVwZGF0ZSBjYWxsc1xyXG5cclxuICAgICAgbW9ja1Nxc0NsaWVudC5zZW5kLm1vY2tSZXNvbHZlZFZhbHVlKHt9KTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlRXZlbnQoJy9wdWJsaXNoaW5nL3JldHJ5JywgJ1BPU1QnLCB7IGpvYklkIH0pO1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBcclxuICAgICAgLy8gU2hvdWxkIG9ubHkgcmV0cnkgdGhlIGZhaWxlZCBtZWRpdW0gam9iXHJcbiAgICAgIGV4cGVjdChtb2NrRG9jQ2xpZW50LnNlbmQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxyXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgIGlucHV0OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICAgIEtleTogeyBpZDogJ2pvYi0xMjNfbWVkaXVtJyB9LFxyXG4gICAgICAgICAgICBVcGRhdGVFeHByZXNzaW9uOiBleHBlY3Quc3RyaW5nQ29udGFpbmluZygnYXR0ZW1wdHMgPSA6YXR0ZW1wdHMnKVxyXG4gICAgICAgICAgfSlcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG5cclxuICAgICAgLy8gU2hvdWxkIHF1ZXVlIHJldHJ5IHdpdGggZGVsYXlcclxuICAgICAgZXhwZWN0KG1vY2tTcXNDbGllbnQuc2VuZCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgICAgaW5wdXQ6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICAgRGVsYXlTZWNvbmRzOiA0IC8vIDJeMiBmb3IgYXR0ZW1wdCAyXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIG5vdCByZXRyeSBqb2JzIHRoYXQgaGF2ZSBleGNlZWRlZCBtYXggYXR0ZW1wdHMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGpvYklkID0gJ2pvYi0xMjMnO1xyXG4gICAgICBjb25zdCBvcmNoZXN0cmF0aW9uUmVzdWx0ID0ge1xyXG4gICAgICAgIGpvYklkLFxyXG4gICAgICAgIGNvbnRlbnRJZDogJ2NvbnRlbnQtMTIzJyxcclxuICAgICAgICBqb2JzOiB7XHJcbiAgICAgICAgICBtZWRpdW06IHtcclxuICAgICAgICAgICAgaWQ6ICdqb2ItMTIzX21lZGl1bScsXHJcbiAgICAgICAgICAgIGNvbnRlbnRJZDogJ2NvbnRlbnQtMTIzJyxcclxuICAgICAgICAgICAgcGxhdGZvcm06ICdtZWRpdW0nLFxyXG4gICAgICAgICAgICBzdGF0dXM6ICdmYWlsZWQnLFxyXG4gICAgICAgICAgICBhdHRlbXB0czogMyxcclxuICAgICAgICAgICAgbWF4QXR0ZW1wdHM6IDMsXHJcbiAgICAgICAgICAgIGxhc3RFcnJvcjogJ01heCBhdHRlbXB0cyBleGNlZWRlZCdcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBtb2NrRG9jQ2xpZW50LnNlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHsgSXRlbTogb3JjaGVzdHJhdGlvblJlc3VsdCB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlRXZlbnQoJy9wdWJsaXNoaW5nL3JldHJ5JywgJ1BPU1QnLCB7IGpvYklkIH0pO1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBcclxuICAgICAgLy8gU2hvdWxkIG5vdCB1cGRhdGUgb3IgcXVldWUgYW55IGpvYnNcclxuICAgICAgZXhwZWN0KG1vY2tEb2NDbGllbnQuc2VuZCkudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpOyAvLyBPbmx5IHRoZSBnZXQgY2FsbFxyXG4gICAgICBleHBlY3QobW9ja1Nxc0NsaWVudC5zZW5kKS5ub3QudG9IYXZlQmVlbkNhbGxlZCgpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdHRVQgL3B1Ymxpc2hpbmcvam9iLXN0YXR1cycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGpvYiBzdGF0dXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGpvYklkID0gJ2pvYi0xMjMnO1xyXG4gICAgICBjb25zdCBvcmNoZXN0cmF0aW9uUmVzdWx0ID0ge1xyXG4gICAgICAgIGpvYklkLFxyXG4gICAgICAgIGNvbnRlbnRJZDogJ2NvbnRlbnQtMTIzJyxcclxuICAgICAgICB0b3RhbFBsYXRmb3JtczogMixcclxuICAgICAgICBzdWNjZXNzZnVsUGxhdGZvcm1zOiAxLFxyXG4gICAgICAgIGZhaWxlZFBsYXRmb3JtczogMSxcclxuICAgICAgICBzdGF0dXM6ICdwYXJ0aWFsJyxcclxuICAgICAgICBqb2JzOiB7XHJcbiAgICAgICAgICBtZWRpdW06IHsgc3RhdHVzOiAnY29tcGxldGVkJyB9LFxyXG4gICAgICAgICAgbGlua2VkaW46IHsgc3RhdHVzOiAnZmFpbGVkJyB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgbW9ja0RvY0NsaWVudC5zZW5kLm1vY2tSZXNvbHZlZFZhbHVlKHsgSXRlbTogb3JjaGVzdHJhdGlvblJlc3VsdCB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlRXZlbnQoJy9wdWJsaXNoaW5nL2pvYi1zdGF0dXMnLCAnR0VUJyk7XHJcbiAgICAgIGV2ZW50LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycyA9IHsgam9iSWQgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3VsdC5ib2R5KTtcclxuICAgICAgZXhwZWN0KGJvZHkuam9iSWQpLnRvQmUoam9iSWQpO1xyXG4gICAgICBleHBlY3QoYm9keS5zdGF0dXMpLnRvQmUoJ3BhcnRpYWwnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgcmV0dXJuIDQwMCBmb3IgbWlzc2luZyBqb2JJZCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCgnL3B1Ymxpc2hpbmcvam9iLXN0YXR1cycsICdHRVQnKTtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDAwKTtcclxuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QoYm9keS5lcnJvcikudG9Db250YWluKCdKb2JJZCBpcyByZXF1aXJlZCcpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdQT1NUIC9wdWJsaXNoaW5nL2NhbmNlbCcsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgY2FuY2VsIG9yY2hlc3RyYXRpb24gYW5kIHBlbmRpbmcgam9icycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3Qgam9iSWQgPSAnam9iLTEyMyc7XHJcbiAgICAgIGNvbnN0IGpvYnMgPSB7XHJcbiAgICAgICAgSXRlbXM6IFtcclxuICAgICAgICAgIHsgaWQ6ICdqb2ItMTIzX21lZGl1bScsIHN0YXR1czogJ3BlbmRpbmcnIH0sXHJcbiAgICAgICAgICB7IGlkOiAnam9iLTEyM19saW5rZWRpbicsIHN0YXR1czogJ2luX3Byb2dyZXNzJyB9LFxyXG4gICAgICAgICAgeyBpZDogJ2pvYi0xMjNfdHdpdHRlcicsIHN0YXR1czogJ2NvbXBsZXRlZCcgfVxyXG4gICAgICAgIF1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIG1vY2tEb2NDbGllbnQuc2VuZFxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe30pIC8vIFVwZGF0ZSBvcmNoZXN0cmF0aW9uXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZShqb2JzKSAvLyBRdWVyeSBqb2JzXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlKHt9KTsgLy8gVXBkYXRlIGluZGl2aWR1YWwgam9ic1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCgnL3B1Ymxpc2hpbmcvY2FuY2VsJywgJ1BPU1QnLCB7IGpvYklkIH0pO1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChib2R5LnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XHJcblxyXG4gICAgICAvLyBTaG91bGQgdXBkYXRlIG9yY2hlc3RyYXRpb24gc3RhdHVzXHJcbiAgICAgIGV4cGVjdChtb2NrRG9jQ2xpZW50LnNlbmQpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxyXG4gICAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgIGlucHV0OiBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XHJcbiAgICAgICAgICAgIEtleTogeyBqb2JJZCB9LFxyXG4gICAgICAgICAgICBVcGRhdGVFeHByZXNzaW9uOiBleHBlY3Quc3RyaW5nQ29udGFpbmluZygnI3N0YXR1cyA9IDpzdGF0dXMnKVxyXG4gICAgICAgICAgfSlcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG5cclxuICAgICAgLy8gU2hvdWxkIGNhbmNlbCBwZW5kaW5nIGFuZCBpbl9wcm9ncmVzcyBqb2JzIChub3QgY29tcGxldGVkKVxyXG4gICAgICBleHBlY3QobW9ja0RvY0NsaWVudC5zZW5kKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoNCk7IC8vIDEgb3JjaGVzdHJhdGlvbiArIDEgcXVlcnkgKyAyIGpvYiB1cGRhdGVzXHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ1BPU1QgL3B1Ymxpc2hpbmcvcHVibGlzaCB3aXRoIHJldHJ5IGxvZ2ljJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCByZXRyeSBmYWlsZWQgcGxhdGZvcm1zIG9ubHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNvbnRlbnRJZCA9ICdjb250ZW50LTEyMyc7XHJcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSB7XHJcbiAgICAgICAgaWQ6IGNvbnRlbnRJZCxcclxuICAgICAgICB0aXRsZTogJ1Rlc3QgUG9zdCcsXHJcbiAgICAgICAgY3VycmVudERyYWZ0OiAnVGVzdCBjb250ZW50JyxcclxuICAgICAgICBwdWJsaXNoaW5nUmVzdWx0czogW1xyXG4gICAgICAgICAgeyBwbGF0Zm9ybTogJ21lZGl1bScsIHN1Y2Nlc3M6IHRydWUsIHBsYXRmb3JtVXJsOiAnaHR0cHM6Ly9tZWRpdW0uY29tL3Bvc3QnIH0sXHJcbiAgICAgICAgICB7IHBsYXRmb3JtOiAnbGlua2VkaW4nLCBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdOZXR3b3JrIGVycm9yJyB9XHJcbiAgICAgICAgXVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgbW9ja0RvY0NsaWVudC5zZW5kXHJcbiAgICAgICAgLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7IEl0ZW06IGNvbnRlbnQgfSkgLy8gR2V0IGNvbnRlbnRcclxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWUoe30pOyAvLyBVcGRhdGUgY29udGVudFxyXG5cclxuICAgICAgbW9ja1B1Ymxpc2hpbmdSZWdpc3RyeS5wdWJsaXNoVG9NdWx0aXBsZVBsYXRmb3Jtcy5tb2NrUmVzb2x2ZWRWYWx1ZShcclxuICAgICAgICBuZXcgTWFwKFtcclxuICAgICAgICAgIFsnbGlua2VkaW4nLCB7IHN1Y2Nlc3M6IHRydWUsIHBsYXRmb3JtVXJsOiAnaHR0cHM6Ly9saW5rZWRpbi5jb20vcG9zdCcgfV1cclxuICAgICAgICBdKVxyXG4gICAgICApO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCgnL3B1Ymxpc2hpbmcvcHVibGlzaCcsICdQT1NUJywge1xyXG4gICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICBwbGF0Zm9ybXM6IFsnbWVkaXVtJywgJ2xpbmtlZGluJ10sXHJcbiAgICAgICAgY29uZmlnczoge1xyXG4gICAgICAgICAgbWVkaXVtOiB7IHBsYXRmb3JtOiAnbWVkaXVtJywgY3JlZGVudGlhbHM6IHt9IH0sXHJcbiAgICAgICAgICBsaW5rZWRpbjogeyBwbGF0Zm9ybTogJ2xpbmtlZGluJywgY3JlZGVudGlhbHM6IHt9IH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIHJldHJ5RmFpbGVkT25seTogdHJ1ZVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3VsdC5ib2R5KTtcclxuICAgICAgZXhwZWN0KGJvZHkuc3VjY2VzcykudG9CZSh0cnVlKTtcclxuXHJcbiAgICAgIC8vIFNob3VsZCBvbmx5IHB1Ymxpc2ggdG8gbGlua2VkaW4gKHRoZSBmYWlsZWQgcGxhdGZvcm0pXHJcbiAgICAgIGV4cGVjdChtb2NrUHVibGlzaGluZ1JlZ2lzdHJ5LnB1Ymxpc2hUb011bHRpcGxlUGxhdGZvcm1zKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcclxuICAgICAgICBbJ2xpbmtlZGluJ10sXHJcbiAgICAgICAgY29udGVudCxcclxuICAgICAgICBleHBlY3QuYW55KE1hcCksXHJcbiAgICAgICAgdW5kZWZpbmVkXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjYXNlIHdoZXJlIG5vIHBsYXRmb3JtcyBuZWVkIHJldHJ5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBjb250ZW50SWQgPSAnY29udGVudC0xMjMnO1xyXG4gICAgICBjb25zdCBjb250ZW50ID0ge1xyXG4gICAgICAgIGlkOiBjb250ZW50SWQsXHJcbiAgICAgICAgcHVibGlzaGluZ1Jlc3VsdHM6IFtcclxuICAgICAgICAgIHsgcGxhdGZvcm06ICdtZWRpdW0nLCBzdWNjZXNzOiB0cnVlIH0sXHJcbiAgICAgICAgICB7IHBsYXRmb3JtOiAnbGlua2VkaW4nLCBzdWNjZXNzOiB0cnVlIH1cclxuICAgICAgICBdXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBtb2NrRG9jQ2xpZW50LnNlbmQubW9ja1Jlc29sdmVkVmFsdWUoeyBJdGVtOiBjb250ZW50IH0pO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCgnL3B1Ymxpc2hpbmcvcHVibGlzaCcsICdQT1NUJywge1xyXG4gICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICBwbGF0Zm9ybXM6IFsnbWVkaXVtJywgJ2xpbmtlZGluJ10sXHJcbiAgICAgICAgY29uZmlnczoge30sXHJcbiAgICAgICAgcmV0cnlGYWlsZWRPbmx5OiB0cnVlXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QoYm9keS5tZXNzYWdlKS50b0JlKCdObyBwbGF0Zm9ybXMgdG8gcmV0cnknKTtcclxuICAgICAgZXhwZWN0KG1vY2tQdWJsaXNoaW5nUmVnaXN0cnkucHVibGlzaFRvTXVsdGlwbGVQbGF0Zm9ybXMpLm5vdC50b0hhdmVCZWVuQ2FsbGVkKCk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0Vycm9yIGhhbmRsaW5nJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgRHluYW1vREIgZXJyb3JzIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIG1vY2tEb2NDbGllbnQuc2VuZC5tb2NrUmVqZWN0ZWRWYWx1ZShuZXcgRXJyb3IoJ0R5bmFtb0RCIGVycm9yJykpO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCgnL3B1Ymxpc2hpbmcvb3JjaGVzdHJhdGUnLCAnUE9TVCcsIHtcclxuICAgICAgICBjb250ZW50SWQ6ICdjb250ZW50LTEyMycsXHJcbiAgICAgICAgcGxhdGZvcm1zOiBbJ21lZGl1bSddLFxyXG4gICAgICAgIGNvbmZpZ3M6IHsgbWVkaXVtOiB7fSB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcclxuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QoYm9keS5lcnJvcikudG9CZSgnT3JjaGVzdHJhdGlvbiBmYWlsZWQnKTtcclxuICAgICAgZXhwZWN0KGJvZHkubWVzc2FnZSkudG9CZSgnRHluYW1vREIgZXJyb3InKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIFNRUyBlcnJvcnMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcclxuICAgICAgbW9ja0RvY0NsaWVudC5zZW5kLm1vY2tSZXNvbHZlZFZhbHVlKHt9KTtcclxuICAgICAgbW9ja1Nxc0NsaWVudC5zZW5kLm1vY2tSZWplY3RlZFZhbHVlKG5ldyBFcnJvcignU1FTIGVycm9yJykpO1xyXG5cclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVFdmVudCgnL3B1Ymxpc2hpbmcvb3JjaGVzdHJhdGUnLCAnUE9TVCcsIHtcclxuICAgICAgICBjb250ZW50SWQ6ICdjb250ZW50LTEyMycsXHJcbiAgICAgICAgcGxhdGZvcm1zOiBbJ21lZGl1bSddLFxyXG4gICAgICAgIGNvbmZpZ3M6IHsgbWVkaXVtOiB7fSB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcclxuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QoYm9keS5lcnJvcikudG9CZSgnT3JjaGVzdHJhdGlvbiBmYWlsZWQnKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnQ09SUyBoYW5kbGluZycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIE9QVElPTlMgcmVxdWVzdHMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlRXZlbnQoJy9wdWJsaXNoaW5nL3BsYXRmb3JtcycsICdPUFRJT05TJyk7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycz8uWydBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nXSkudG9CZSgnKicpO1xyXG4gICAgICBleHBlY3QocmVzdWx0LmhlYWRlcnM/LlsnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyddKS50b0NvbnRhaW4oJ1BPU1QnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaW5jbHVkZSBDT1JTIGhlYWRlcnMgaW4gYWxsIHJlc3BvbnNlcycsIGFzeW5jICgpID0+IHtcclxuICAgICAgbW9ja1B1Ymxpc2hpbmdSZWdpc3RyeS5nZXRTdXBwb3J0ZWRQbGF0Zm9ybXMubW9ja1JldHVyblZhbHVlKFtdKTtcclxuICAgICAgbW9ja1B1Ymxpc2hpbmdSZWdpc3RyeS5nZXRQbGF0Zm9ybUZlYXR1cmVzLm1vY2tSZXR1cm5WYWx1ZShbXSk7XHJcblxyXG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZUV2ZW50KCcvcHVibGlzaGluZy9wbGF0Zm9ybXMnLCAnR0VUJyk7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5oZWFkZXJzPy5bJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbiddKS50b0JlKCcqJyk7XHJcbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycz8uWydBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJ10pLnRvQ29udGFpbignQ29udGVudC1UeXBlJyk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19