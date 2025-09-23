import { handler } from '../lambda/publishing-orchestrator';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';

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
    (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue(mockDocClient);
    (SQSClient as jest.Mock).mockImplementation(() => mockSqsClient);
    

  });

  const createEvent = (path: string, method: string = 'POST', body?: any): APIGatewayProxyEvent => ({
    httpMethod: method,
    path,
    body: body ? JSON.stringify(body) : null,
    headers: {},
    queryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null
  });

  describe('GET /publishing/platforms', () => {
    it('should return supported platforms', async () => {
      mockPublishingRegistry.getSupportedPlatforms.mockReturnValue(['medium', 'linkedin']);
      mockPublishingRegistry.getPlatformFeatures.mockImplementation((platform: string) => 
        platform === 'medium' ? ['articles', 'publications'] : ['posts', 'articles']
      );

      const event = createEvent('/publishing/platforms', 'GET');
      const result = await handler(event);

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
      const result = await handler(event);

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

      const result = await handler(event);

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
      const result = await handler(event);

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
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      // Should only retry the failed medium job
      expect(mockDocClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: { id: 'job-123_medium' },
            UpdateExpression: expect.stringContaining('attempts = :attempts')
          })
        })
      );

      // Should queue retry with delay
      expect(mockSqsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            DelaySeconds: 4 // 2^2 for attempt 2
          })
        })
      );
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
      const result = await handler(event);

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

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.jobId).toBe(jobId);
      expect(body.status).toBe('partial');
    });

    it('should return 400 for missing jobId', async () => {
      const event = createEvent('/publishing/job-status', 'GET');
      const result = await handler(event);

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
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);

      // Should update orchestration status
      expect(mockDocClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: { jobId },
            UpdateExpression: expect.stringContaining('#status = :status')
          })
        })
      );

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

      mockPublishingRegistry.publishToMultiplePlatforms.mockResolvedValue(
        new Map([
          ['linkedin', { success: true, platformUrl: 'https://linkedin.com/post' }]
        ])
      );

      const event = createEvent('/publishing/publish', 'POST', {
        contentId,
        platforms: ['medium', 'linkedin'],
        configs: {
          medium: { platform: 'medium', credentials: {} },
          linkedin: { platform: 'linkedin', credentials: {} }
        },
        retryFailedOnly: true
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);

      // Should only publish to linkedin (the failed platform)
      expect(mockPublishingRegistry.publishToMultiplePlatforms).toHaveBeenCalledWith(
        ['linkedin'],
        content,
        expect.any(Map),
        undefined
      );
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

      const result = await handler(event);

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

      const result = await handler(event);

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

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Orchestration failed');
    });
  });

  describe('CORS handling', () => {
    it('should handle OPTIONS requests', async () => {
      const event = createEvent('/publishing/platforms', 'OPTIONS');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers?.['Access-Control-Allow-Methods']).toContain('POST');
    });

    it('should include CORS headers in all responses', async () => {
      mockPublishingRegistry.getSupportedPlatforms.mockReturnValue([]);
      mockPublishingRegistry.getPlatformFeatures.mockReturnValue([]);

      const event = createEvent('/publishing/platforms', 'GET');
      const result = await handler(event);

      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers?.['Access-Control-Allow-Headers']).toContain('Content-Type');
    });
  });
});