/**
 * AWS Integration Tests for Input Processing Pipeline
 * 
 * These tests require actual AWS resources and should be run against
 * a test/staging environment, not in CI/CD pipelines.
 * 
 * To run these tests:
 * 1. Deploy the infrastructure to a test environment
 * 2. Set environment variables for the test resources
 * 3. Run: npm test -- --testPathPattern=aws-integration
 */

import { DynamoDBClient, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { TranscribeClient, GetTranscriptionJobCommand, DeleteTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../lambda/input-processor';

// Skip these tests unless explicitly running AWS integration tests
const runAWSIntegrationTests = process.env.RUN_AWS_INTEGRATION_TESTS === 'true';

describe.skip('AWS Integration Tests - Input Processing Pipeline', () => {
  let dynamoClient: DynamoDBClient;
  let s3Client: S3Client;
  let transcribeClient: TranscribeClient;
  
  const testResourceIds: string[] = [];
  const testS3Keys: string[] = [];
  const testTranscriptionJobs: string[] = [];

  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '512',
    awsRequestId: 'aws-integration-test',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2023/01/01/[$LATEST]test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
  };

  beforeAll(async () => {
    if (!runAWSIntegrationTests) {
      console.log('Skipping AWS integration tests. Set RUN_AWS_INTEGRATION_TESTS=true to run.');
      return;
    }

    // Verify required environment variables
    const requiredEnvVars = [
      'AUDIO_BUCKET_NAME',
      'CONTENT_TABLE_NAME',
      'EVENT_BUS_NAME',
      'AWS_REGION'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Required environment variable ${envVar} is not set`);
      }
    }

    // Initialize AWS clients
    dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
    s3Client = new S3Client({ region: process.env.AWS_REGION });
    transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION });
  });

  afterAll(async () => {
    if (!runAWSIntegrationTests) return;

    // Clean up test resources
    console.log('Cleaning up test resources...');

    // Clean up DynamoDB records
    for (const resourceId of testResourceIds) {
      try {
        await dynamoClient.send(new DeleteItemCommand({
          TableName: process.env.CONTENT_TABLE_NAME!,
          Key: { id: { S: resourceId } }
        }));
      } catch (error) {
        console.warn(`Failed to delete DynamoDB record ${resourceId}:`, error);
      }
    }

    // Clean up S3 objects
    for (const s3Key of testS3Keys) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: process.env.AUDIO_BUCKET_NAME!,
          Key: s3Key
        }));
      } catch (error) {
        console.warn(`Failed to delete S3 object ${s3Key}:`, error);
      }
    }

    // Clean up transcription jobs (they auto-delete, but we can try)
    for (const jobName of testTranscriptionJobs) {
      try {
        await transcribeClient.send(new DeleteTranscriptionJobCommand({
          TranscriptionJobName: jobName
        }));
      } catch (error) {
        // Transcription jobs can't always be deleted, this is expected
        console.warn(`Transcription job ${jobName} cleanup note:`, error);
      }
    }
  });

  describe('Text Processing Integration', () => {
    it('should process text input and store in DynamoDB', async () => {
      if (!runAWSIntegrationTests) return;

      const testText = 'AWS Integration test for text processing pipeline';
      const userId = 'aws-integration-test-user';

      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/text',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          text: testText,
          userId: userId,
        }),
        isBase64Encoded: false,
      };

      // Process the text input
      const result = await handler(event, mockContext);
      
      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody).toHaveProperty('message', 'Text input processed successfully');
      expect(responseBody.data).toHaveProperty('inputId');
      expect(responseBody.data).toHaveProperty('status', 'completed');
      expect(responseBody.data).toHaveProperty('transcription');

      const inputId = responseBody.data.inputId;
      testResourceIds.push(inputId);

      // Verify the record was created in DynamoDB
      const dynamoResult = await dynamoClient.send(new GetItemCommand({
        TableName: process.env.CONTENT_TABLE_NAME!,
        Key: { id: { S: inputId } }
      }));

      expect(dynamoResult.Item).toBeDefined();
      expect(dynamoResult.Item!.id.S).toBe(inputId);
      expect(dynamoResult.Item!.userId.S).toBe(userId);
      expect(dynamoResult.Item!.type.S).toBe('text');
      expect(dynamoResult.Item!.status.S).toBe('completed');
      expect(dynamoResult.Item!.transcription.S).toBeDefined();
      expect(dynamoResult.Item!.createdAt.S).toBeDefined();
      expect(dynamoResult.Item!.updatedAt.S).toBeDefined();
    });

    it('should retrieve text processing status correctly', async () => {
      if (!runAWSIntegrationTests) return;

      // First create a text input
      const testText = 'Status check integration test';
      const userId = 'status-test-user';

      const createEvent: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/text',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({ text: testText, userId }),
        isBase64Encoded: false,
      };

      const createResult = await handler(createEvent, mockContext);
      const createResponseBody = JSON.parse(createResult.body);
      const inputId = createResponseBody.data.inputId;
      testResourceIds.push(inputId);

      // Now check the status
      const statusEvent: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: `/api/input/status/${inputId}`,
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: null,
        isBase64Encoded: false,
      };

      const statusResult = await handler(statusEvent, mockContext);
      
      expect(statusResult.statusCode).toBe(200);
      
      const statusResponseBody = JSON.parse(statusResult.body);
      expect(statusResponseBody).toHaveProperty('message', 'Input status retrieved successfully');
      expect(statusResponseBody.data).toHaveProperty('id', inputId);
      expect(statusResponseBody.data).toHaveProperty('userId', userId);
      expect(statusResponseBody.data).toHaveProperty('type', 'text');
      expect(statusResponseBody.data).toHaveProperty('status', 'completed');
      expect(statusResponseBody.data).toHaveProperty('transcription');
    });
  });

  describe('Audio Processing Integration', () => {
    it('should process audio input and trigger transcription', async () => {
      if (!runAWSIntegrationTests) return;

      // Create a valid WAV file for testing
      const wavHeader = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        0x24, 0x08, 0x00, 0x00, // File size
        0x57, 0x41, 0x56, 0x45, // "WAVE"
        0x66, 0x6D, 0x74, 0x20, // "fmt "
        0x10, 0x00, 0x00, 0x00, // Subchunk1Size
        0x01, 0x00, 0x02, 0x00, // AudioFormat, NumChannels
        0x44, 0xAC, 0x00, 0x00, // SampleRate
        0x10, 0xB1, 0x02, 0x00, // ByteRate
        0x04, 0x00, 0x10, 0x00, // BlockAlign, BitsPerSample
        0x64, 0x61, 0x74, 0x61, // "data"
        0x00, 0x08, 0x00, 0x00, // Subchunk2Size
        // Add some dummy audio data
        ...Array(2048).fill(0).map(() => Math.floor(Math.random() * 256))
      ]);
      
      const audioData = wavHeader.toString('base64');
      const userId = 'audio-integration-test-user';

      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/audio',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          audioData,
          contentType: 'audio/wav',
          userId: userId,
        }),
        isBase64Encoded: false,
      };

      // Process the audio input
      const result = await handler(event, mockContext);
      
      expect(result.statusCode).toBe(202);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody).toHaveProperty('message', 'Audio upload successful, processing started');
      expect(responseBody.data).toHaveProperty('inputId');
      expect(responseBody.data).toHaveProperty('status', 'processing');
      expect(responseBody.data).toHaveProperty('transcriptionJobName');

      const inputId = responseBody.data.inputId;
      const transcriptionJobName = responseBody.data.transcriptionJobName;
      
      testResourceIds.push(inputId);
      testTranscriptionJobs.push(transcriptionJobName);

      // Verify the record was created in DynamoDB
      const dynamoResult = await dynamoClient.send(new GetItemCommand({
        TableName: process.env.CONTENT_TABLE_NAME!,
        Key: { id: { S: inputId } }
      }));

      expect(dynamoResult.Item).toBeDefined();
      expect(dynamoResult.Item!.id.S).toBe(inputId);
      expect(dynamoResult.Item!.userId.S).toBe(userId);
      expect(dynamoResult.Item!.type.S).toBe('audio');
      expect(dynamoResult.Item!.status.S).toBe('processing');
      expect(dynamoResult.Item!.audioKey.S).toBeDefined();

      // Track S3 key for cleanup
      testS3Keys.push(dynamoResult.Item!.audioKey.S!);

      // Verify the audio file was uploaded to S3
      const s3Result = await s3Client.send(new GetObjectCommand({
        Bucket: process.env.AUDIO_BUCKET_NAME!,
        Key: dynamoResult.Item!.audioKey.S!
      }));

      expect(s3Result.Body).toBeDefined();
      expect(s3Result.ContentType).toBe('audio/wav');

      // Verify transcription job was created
      const transcribeResult = await transcribeClient.send(new GetTranscriptionJobCommand({
        TranscriptionJobName: transcriptionJobName
      }));

      expect(transcribeResult.TranscriptionJob).toBeDefined();
      expect(transcribeResult.TranscriptionJob!.TranscriptionJobName).toBe(transcriptionJobName);
      expect(['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED']).toContain(
        transcribeResult.TranscriptionJob!.TranscriptionJobStatus
      );
    });

    it('should handle audio processing status polling', async () => {
      if (!runAWSIntegrationTests) return;

      // This test would require waiting for transcription to complete
      // For now, we'll just test the status endpoint with a processing record
      
      // Create a minimal audio processing record first
      const wavHeader = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        0x24, 0x08, 0x00, 0x00, // File size
        0x57, 0x41, 0x56, 0x45, // "WAVE"
        0x66, 0x6D, 0x74, 0x20, // "fmt "
        0x10, 0x00, 0x00, 0x00, // Subchunk1Size
        0x01, 0x00, 0x02, 0x00, // AudioFormat, NumChannels
        0x44, 0xAC, 0x00, 0x00, // SampleRate
        0x10, 0xB1, 0x02, 0x00, // ByteRate
        0x04, 0x00, 0x10, 0x00, // BlockAlign, BitsPerSample
        0x64, 0x61, 0x74, 0x61, // "data"
        0x00, 0x08, 0x00, 0x00, // Subchunk2Size
        ...Array(1024).fill(0).map(() => Math.floor(Math.random() * 256))
      ]);
      
      const audioData = wavHeader.toString('base64');
      const userId = 'status-polling-test-user';

      const createEvent: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/audio',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          audioData,
          contentType: 'audio/wav',
          userId: userId,
        }),
        isBase64Encoded: false,
      };

      const createResult = await handler(createEvent, mockContext);
      const createResponseBody = JSON.parse(createResult.body);
      const inputId = createResponseBody.data.inputId;
      const transcriptionJobName = createResponseBody.data.transcriptionJobName;
      
      testResourceIds.push(inputId);
      testTranscriptionJobs.push(transcriptionJobName);

      // Poll status multiple times to test the polling mechanism
      let attempts = 0;
      let finalStatus = 'processing';
      
      while (attempts < 5 && finalStatus === 'processing') {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        
        const statusEvent: APIGatewayProxyEvent = {
          httpMethod: 'GET',
          path: `/api/input/status/${inputId}`,
          headers: {},
          multiValueHeaders: {},
          queryStringParameters: null,
          multiValueQueryStringParameters: null,
          pathParameters: null,
          stageVariables: null,
          requestContext: {} as any,
          resource: '',
          body: null,
          isBase64Encoded: false,
        };

        const statusResult = await handler(statusEvent, mockContext);
        expect(statusResult.statusCode).toBe(200);
        
        const statusResponseBody = JSON.parse(statusResult.body);
        finalStatus = statusResponseBody.data.status;
        
        expect(statusResponseBody.data).toHaveProperty('id', inputId);
        expect(statusResponseBody.data).toHaveProperty('type', 'audio');
        expect(['processing', 'completed', 'failed']).toContain(finalStatus);
        
        attempts++;
      }

      // The status should have been checked successfully regardless of final state
      expect(attempts).toBeGreaterThan(0);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle AWS service failures gracefully', async () => {
      if (!runAWSIntegrationTests) return;

      // Test with an invalid bucket name to trigger S3 error
      const originalBucket = process.env.AUDIO_BUCKET_NAME;
      process.env.AUDIO_BUCKET_NAME = 'non-existent-bucket-name-12345';

      const wavHeader = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // "RIFF"
        0x24, 0x08, 0x00, 0x00, // File size
        0x57, 0x41, 0x56, 0x45, // "WAVE"
        0x66, 0x6D, 0x74, 0x20, // "fmt "
        0x10, 0x00, 0x00, 0x00, // Subchunk1Size
        0x01, 0x00, 0x02, 0x00, // AudioFormat, NumChannels
        0x44, 0xAC, 0x00, 0x00, // SampleRate
        0x10, 0xB1, 0x02, 0x00, // ByteRate
        0x04, 0x00, 0x10, 0x00, // BlockAlign, BitsPerSample
        0x64, 0x61, 0x74, 0x61, // "data"
        0x00, 0x08, 0x00, 0x00, // Subchunk2Size
        ...Array(1024).fill(0).map(() => Math.floor(Math.random() * 256))
      ]);
      
      const audioData = wavHeader.toString('base64');

      const event: APIGatewayProxyEvent = {
        httpMethod: 'POST',
        path: '/api/input/audio',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {} as any,
        resource: '',
        body: JSON.stringify({
          audioData,
          contentType: 'audio/wav',
          userId: 'error-test-user',
        }),
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);
      
      // Should return 500 error due to S3 failure
      expect(result.statusCode).toBe(500);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody).toHaveProperty('error', 'Internal Server Error');
      expect(responseBody).toHaveProperty('message');

      // Restore original bucket name
      process.env.AUDIO_BUCKET_NAME = originalBucket;
    });
  });
});