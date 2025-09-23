import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { handler as inputProcessor } from '../lambda/input-processor';
import { handler as contentOrchestrator } from '../lambda/content-orchestrator';
import { handler as imageGenerationAgent } from '../lambda/image-generation-agent';
import { handler as publishingOrchestrator } from '../lambda/publishing-orchestrator';

const dynamoMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

describe('Voice-to-Blog Pipeline Integration Tests', () => {
  beforeEach(() => {
    dynamoMock.reset();
    s3Mock.reset();
    sqsMock.reset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('processes complete voice-to-blog pipeline', async () => {
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

    const inputResult = await inputProcessor(audioEvent, {} as any);
    expect(inputResult.statusCode).toBe(200);
    
    const inputResponse = JSON.parse(inputResult.body);
    expect(inputResponse.transcription).toBeDefined();
    expect(inputResponse.contentId).toBeDefined();

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

    const orchestrationResult = await contentOrchestrator(orchestrationEvent, {} as any);
    expect(orchestrationResult.statusCode).toBe(200);

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

    const imageResult = await imageGenerationAgent(imageEvent, {} as any);
    expect(imageResult.statusCode).toBe(200);

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

    const publishingResult = await publishingOrchestrator(publishingEvent, {} as any);
    expect(publishingResult.statusCode).toBe(200);
    
    const publishingResponse = JSON.parse(publishingResult.body);
    expect(publishingResponse.success).toBe(true);
    expect(publishingResponse.publishedUrls).toBeDefined();
    expect(publishingResponse.publishedUrls.medium).toBeDefined();
    expect(publishingResponse.publishedUrls.linkedin).toBeDefined();

    // Verify all components were called with correct data
    expect(dynamoMock.calls()).toHaveLength(4); // One call per step
    expect(s3Mock.calls()).toHaveLength(2); // Audio storage and image storage
    expect(sqsMock.calls()).toHaveLength(3); // Inter-service communication
  });

  it('handles pipeline failures gracefully', async () => {
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

    const result = await inputProcessor(audioEvent, {} as any);
    expect(result.statusCode).toBe(500);
    
    const response = JSON.parse(result.body);
    expect(response.error).toBeDefined();
    expect(response.retryable).toBe(true);
  });

  it('processes text input pipeline', async () => {
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

    const result = await inputProcessor(textEvent, {} as any);
    expect(result.statusCode).toBe(200);
    
    const response = JSON.parse(result.body);
    expect(response.contentId).toBeDefined();
    expect(response.processedText).toBeDefined();
  });

  it('handles revision workflow', async () => {
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

    const result = await contentOrchestrator(revisionEvent, {} as any);
    expect(result.statusCode).toBe(200);
    
    const response = JSON.parse(result.body);
    expect(response.revisionId).toBeDefined();
    expect(response.status).toBe('processing');
  });

  it('validates audio quality before processing', async () => {
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
        audioData: 'very-short-audio-data', // Simulating poor quality
        userId: 'test-user-123'
      }),
      requestContext: {
        requestId: 'test-poor-audio'
      }
    };

    const result = await inputProcessor(poorAudioEvent, {} as any);
    expect(result.statusCode).toBe(400);
    
    const response = JSON.parse(result.body);
    expect(response.error).toContain('audio quality');
    expect(response.suggestions).toBeDefined();
  });

  it('handles concurrent processing requests', async () => {
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
    const results = await Promise.all(
      requests.map(event => inputProcessor(event, {} as any))
    );

    // Verify all requests succeeded
    results.forEach((result, index) => {
      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.contentId).toBeDefined();
      expect(response.contentId).toContain(`test-user-${index}`);
    });
  });

  it('maintains data consistency across pipeline stages', async () => {
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

    const result = await contentOrchestrator(statusCheckEvent, {} as any);
    expect(result.statusCode).toBe(200);
    
    const response = JSON.parse(result.body);
    expect(response.contentId).toBe(contentId);
    expect(response.status).toBeDefined();
    expect(response.userId).toBe('test-user-123');
  });
});