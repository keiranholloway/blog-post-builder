"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_transcribe_1 = require("@aws-sdk/client-transcribe");
const input_processor_1 = require("../lambda/input-processor");
// Skip these tests unless explicitly running AWS integration tests
const runAWSIntegrationTests = process.env.RUN_AWS_INTEGRATION_TESTS === 'true';
describe.skip('AWS Integration Tests - Input Processing Pipeline', () => {
    let dynamoClient;
    let s3Client;
    let transcribeClient;
    const testResourceIds = [];
    const testS3Keys = [];
    const testTranscriptionJobs = [];
    const mockContext = {
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
        dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
        s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
        transcribeClient = new client_transcribe_1.TranscribeClient({ region: process.env.AWS_REGION });
    });
    afterAll(async () => {
        if (!runAWSIntegrationTests)
            return;
        // Clean up test resources
        console.log('Cleaning up test resources...');
        // Clean up DynamoDB records
        for (const resourceId of testResourceIds) {
            try {
                await dynamoClient.send(new client_dynamodb_1.DeleteItemCommand({
                    TableName: process.env.CONTENT_TABLE_NAME,
                    Key: { id: { S: resourceId } }
                }));
            }
            catch (error) {
                console.warn(`Failed to delete DynamoDB record ${resourceId}:`, error);
            }
        }
        // Clean up S3 objects
        for (const s3Key of testS3Keys) {
            try {
                await s3Client.send(new client_s3_1.DeleteObjectCommand({
                    Bucket: process.env.AUDIO_BUCKET_NAME,
                    Key: s3Key
                }));
            }
            catch (error) {
                console.warn(`Failed to delete S3 object ${s3Key}:`, error);
            }
        }
        // Clean up transcription jobs (they auto-delete, but we can try)
        for (const jobName of testTranscriptionJobs) {
            try {
                await transcribeClient.send(new client_transcribe_1.DeleteTranscriptionJobCommand({
                    TranscriptionJobName: jobName
                }));
            }
            catch (error) {
                // Transcription jobs can't always be deleted, this is expected
                console.warn(`Transcription job ${jobName} cleanup note:`, error);
            }
        }
    });
    describe('Text Processing Integration', () => {
        it('should process text input and store in DynamoDB', async () => {
            if (!runAWSIntegrationTests)
                return;
            const testText = 'AWS Integration test for text processing pipeline';
            const userId = 'aws-integration-test-user';
            const event = {
                httpMethod: 'POST',
                path: '/api/input/text',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    text: testText,
                    userId: userId,
                }),
                isBase64Encoded: false,
            };
            // Process the text input
            const result = await (0, input_processor_1.handler)(event, mockContext);
            expect(result.statusCode).toBe(200);
            const responseBody = JSON.parse(result.body);
            expect(responseBody).toHaveProperty('message', 'Text input processed successfully');
            expect(responseBody.data).toHaveProperty('inputId');
            expect(responseBody.data).toHaveProperty('status', 'completed');
            expect(responseBody.data).toHaveProperty('transcription');
            const inputId = responseBody.data.inputId;
            testResourceIds.push(inputId);
            // Verify the record was created in DynamoDB
            const dynamoResult = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
                TableName: process.env.CONTENT_TABLE_NAME,
                Key: { id: { S: inputId } }
            }));
            expect(dynamoResult.Item).toBeDefined();
            expect(dynamoResult.Item.id.S).toBe(inputId);
            expect(dynamoResult.Item.userId.S).toBe(userId);
            expect(dynamoResult.Item.type.S).toBe('text');
            expect(dynamoResult.Item.status.S).toBe('completed');
            expect(dynamoResult.Item.transcription.S).toBeDefined();
            expect(dynamoResult.Item.createdAt.S).toBeDefined();
            expect(dynamoResult.Item.updatedAt.S).toBeDefined();
        });
        it('should retrieve text processing status correctly', async () => {
            if (!runAWSIntegrationTests)
                return;
            // First create a text input
            const testText = 'Status check integration test';
            const userId = 'status-test-user';
            const createEvent = {
                httpMethod: 'POST',
                path: '/api/input/text',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({ text: testText, userId }),
                isBase64Encoded: false,
            };
            const createResult = await (0, input_processor_1.handler)(createEvent, mockContext);
            const createResponseBody = JSON.parse(createResult.body);
            const inputId = createResponseBody.data.inputId;
            testResourceIds.push(inputId);
            // Now check the status
            const statusEvent = {
                httpMethod: 'GET',
                path: `/api/input/status/${inputId}`,
                headers: {},
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: null,
                isBase64Encoded: false,
            };
            const statusResult = await (0, input_processor_1.handler)(statusEvent, mockContext);
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
            if (!runAWSIntegrationTests)
                return;
            // Create a valid WAV file for testing
            const wavHeader = Buffer.from([
                0x52, 0x49, 0x46, 0x46,
                0x24, 0x08, 0x00, 0x00,
                0x57, 0x41, 0x56, 0x45,
                0x66, 0x6D, 0x74, 0x20,
                0x10, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x02, 0x00,
                0x44, 0xAC, 0x00, 0x00,
                0x10, 0xB1, 0x02, 0x00,
                0x04, 0x00, 0x10, 0x00,
                0x64, 0x61, 0x74, 0x61,
                0x00, 0x08, 0x00, 0x00,
                // Add some dummy audio data
                ...Array(2048).fill(0).map(() => Math.floor(Math.random() * 256))
            ]);
            const audioData = wavHeader.toString('base64');
            const userId = 'audio-integration-test-user';
            const event = {
                httpMethod: 'POST',
                path: '/api/input/audio',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    audioData,
                    contentType: 'audio/wav',
                    userId: userId,
                }),
                isBase64Encoded: false,
            };
            // Process the audio input
            const result = await (0, input_processor_1.handler)(event, mockContext);
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
            const dynamoResult = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
                TableName: process.env.CONTENT_TABLE_NAME,
                Key: { id: { S: inputId } }
            }));
            expect(dynamoResult.Item).toBeDefined();
            expect(dynamoResult.Item.id.S).toBe(inputId);
            expect(dynamoResult.Item.userId.S).toBe(userId);
            expect(dynamoResult.Item.type.S).toBe('audio');
            expect(dynamoResult.Item.status.S).toBe('processing');
            expect(dynamoResult.Item.audioKey.S).toBeDefined();
            // Track S3 key for cleanup
            testS3Keys.push(dynamoResult.Item.audioKey.S);
            // Verify the audio file was uploaded to S3
            const s3Result = await s3Client.send(new client_s3_1.GetObjectCommand({
                Bucket: process.env.AUDIO_BUCKET_NAME,
                Key: dynamoResult.Item.audioKey.S
            }));
            expect(s3Result.Body).toBeDefined();
            expect(s3Result.ContentType).toBe('audio/wav');
            // Verify transcription job was created
            const transcribeResult = await transcribeClient.send(new client_transcribe_1.GetTranscriptionJobCommand({
                TranscriptionJobName: transcriptionJobName
            }));
            expect(transcribeResult.TranscriptionJob).toBeDefined();
            expect(transcribeResult.TranscriptionJob.TranscriptionJobName).toBe(transcriptionJobName);
            expect(['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED']).toContain(transcribeResult.TranscriptionJob.TranscriptionJobStatus);
        });
        it('should handle audio processing status polling', async () => {
            if (!runAWSIntegrationTests)
                return;
            // This test would require waiting for transcription to complete
            // For now, we'll just test the status endpoint with a processing record
            // Create a minimal audio processing record first
            const wavHeader = Buffer.from([
                0x52, 0x49, 0x46, 0x46,
                0x24, 0x08, 0x00, 0x00,
                0x57, 0x41, 0x56, 0x45,
                0x66, 0x6D, 0x74, 0x20,
                0x10, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x02, 0x00,
                0x44, 0xAC, 0x00, 0x00,
                0x10, 0xB1, 0x02, 0x00,
                0x04, 0x00, 0x10, 0x00,
                0x64, 0x61, 0x74, 0x61,
                0x00, 0x08, 0x00, 0x00,
                ...Array(1024).fill(0).map(() => Math.floor(Math.random() * 256))
            ]);
            const audioData = wavHeader.toString('base64');
            const userId = 'status-polling-test-user';
            const createEvent = {
                httpMethod: 'POST',
                path: '/api/input/audio',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    audioData,
                    contentType: 'audio/wav',
                    userId: userId,
                }),
                isBase64Encoded: false,
            };
            const createResult = await (0, input_processor_1.handler)(createEvent, mockContext);
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
                const statusEvent = {
                    httpMethod: 'GET',
                    path: `/api/input/status/${inputId}`,
                    headers: {},
                    multiValueHeaders: {},
                    queryStringParameters: null,
                    multiValueQueryStringParameters: null,
                    pathParameters: null,
                    stageVariables: null,
                    requestContext: {},
                    resource: '',
                    body: null,
                    isBase64Encoded: false,
                };
                const statusResult = await (0, input_processor_1.handler)(statusEvent, mockContext);
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
            if (!runAWSIntegrationTests)
                return;
            // Test with an invalid bucket name to trigger S3 error
            const originalBucket = process.env.AUDIO_BUCKET_NAME;
            process.env.AUDIO_BUCKET_NAME = 'non-existent-bucket-name-12345';
            const wavHeader = Buffer.from([
                0x52, 0x49, 0x46, 0x46,
                0x24, 0x08, 0x00, 0x00,
                0x57, 0x41, 0x56, 0x45,
                0x66, 0x6D, 0x74, 0x20,
                0x10, 0x00, 0x00, 0x00,
                0x01, 0x00, 0x02, 0x00,
                0x44, 0xAC, 0x00, 0x00,
                0x10, 0xB1, 0x02, 0x00,
                0x04, 0x00, 0x10, 0x00,
                0x64, 0x61, 0x74, 0x61,
                0x00, 0x08, 0x00, 0x00,
                ...Array(1024).fill(0).map(() => Math.floor(Math.random() * 256))
            ]);
            const audioData = wavHeader.toString('base64');
            const event = {
                httpMethod: 'POST',
                path: '/api/input/audio',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    audioData,
                    contentType: 'audio/wav',
                    userId: 'error-test-user',
                }),
                isBase64Encoded: false,
            };
            const result = await (0, input_processor_1.handler)(event, mockContext);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5wdXQtcHJvY2Vzc2luZy1hd3MtaW50ZWdyYXRpb24udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImlucHV0LXByb2Nlc3NpbmctYXdzLWludGVncmF0aW9uLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7O0dBVUc7O0FBRUgsOERBQTZGO0FBQzdGLGtEQUFxRjtBQUNyRixrRUFBeUg7QUFFekgsK0RBQW9EO0FBRXBELG1FQUFtRTtBQUNuRSxNQUFNLHNCQUFzQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCLEtBQUssTUFBTSxDQUFDO0FBRWhGLFFBQVEsQ0FBQyxJQUFJLENBQUMsbURBQW1ELEVBQUUsR0FBRyxFQUFFO0lBQ3RFLElBQUksWUFBNEIsQ0FBQztJQUNqQyxJQUFJLFFBQWtCLENBQUM7SUFDdkIsSUFBSSxnQkFBa0MsQ0FBQztJQUV2QyxNQUFNLGVBQWUsR0FBYSxFQUFFLENBQUM7SUFDckMsTUFBTSxVQUFVLEdBQWEsRUFBRSxDQUFDO0lBQ2hDLE1BQU0scUJBQXFCLEdBQWEsRUFBRSxDQUFDO0lBRTNDLE1BQU0sV0FBVyxHQUFZO1FBQzNCLDhCQUE4QixFQUFFLEtBQUs7UUFDckMsWUFBWSxFQUFFLGVBQWU7UUFDN0IsZUFBZSxFQUFFLEdBQUc7UUFDcEIsa0JBQWtCLEVBQUUsOERBQThEO1FBQ2xGLGVBQWUsRUFBRSxLQUFLO1FBQ3RCLFlBQVksRUFBRSxzQkFBc0I7UUFDcEMsWUFBWSxFQUFFLDJCQUEyQjtRQUN6QyxhQUFhLEVBQUUsaUNBQWlDO1FBQ2hELHdCQUF3QixFQUFFLEdBQUcsRUFBRSxDQUFDLEtBQUs7UUFDckMsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDZixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNmLE9BQU8sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0tBQ25CLENBQUM7SUFFRixTQUFTLENBQUMsS0FBSyxJQUFJLEVB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ZSxDQUFDLENBQUM7UUFDbEUsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyw4QkFBOEIsRUFBRSxHQUFHLEVBQUU7UUFDNUMsRUFBRSxDQUFDLHNEQUFzRCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3BFLElBQUksQ0FBQyxzQkFBc0I7Z0JBQUUsT0FBTztZQUVwQyxzQ0FBc0M7WUFDdEMsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztnQkFDNUIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSTtnQkFDdEIsNEJBQTRCO2dCQUM1QixHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQyxDQUFDO2FBQ2xFLENBQUMsQ0FBQztZQUVILE1BQU0sU0FBUyxHQUFHLFNBQVMsQ0FBQyxRQUFRLENBQUMs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Q0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogQVdTIEludGVncmF0aW9uIFRlc3RzIGZvciBJbnB1dCBQcm9jZXNzaW5nIFBpcGVsaW5lXHJcbiAqIFxyXG4gKiBUaGVzZSB0ZXN0cyByZXF1aXJlIGFjdHVhbCBBV1MgcmVzb3VyY2VzIGFuZCBzaG91bGQgYmUgcnVuIGFnYWluc3RcclxuICogYSB0ZXN0L3N0YWdpbmcgZW52aXJvbm1lbnQsIG5vdCBpbiBDSS9DRCBwaXBlbGluZXMuXHJcbiAqIFxyXG4gKiBUbyBydW4gdGhlc2UgdGVzdHM6XHJcbiAqIDEuIERlcGxveSB0aGUgaW5mcmFzdHJ1Y3R1cmUgdG8gYSB0ZXN0IGVudmlyb25tZW50XHJcbiAqIDIuIFNldCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHRoZSB0ZXN0IHJlc291cmNlc1xyXG4gKiAzLiBSdW46IG5wbSB0ZXN0IC0tIC0tdGVzdFBhdGhQYXR0ZXJuPWF3cy1pbnRlZ3JhdGlvblxyXG4gKi9cclxuXHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBHZXRJdGVtQ29tbWFuZCwgRGVsZXRlSXRlbUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBTM0NsaWVudCwgR2V0T2JqZWN0Q29tbWFuZCwgRGVsZXRlT2JqZWN0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XHJcbmltcG9ydCB7IFRyYW5zY3JpYmVDbGllbnQsIEdldFRyYW5zY3JpcHRpb25Kb2JDb21tYW5kLCBEZWxldGVUcmFuc2NyaXB0aW9uSm9iQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC10cmFuc2NyaWJlJztcclxuaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgaGFuZGxlciB9IGZyb20gJy4uL2xhbWJkYS9pbnB1dC1wcm9jZXNzb3InO1xyXG5cclxuLy8gU2tpcCB0aGVzZSB0ZXN0cyB1bmxlc3MgZXhwbGljaXRseSBydW5uaW5nIEFXUyBpbnRlZ3JhdGlvbiB0ZXN0c1xyXG5jb25zdCBydW5BV1NJbnRlZ3JhdGlvblRlc3RzID0gcHJvY2Vzcy5lbnYuUlVOX0FXU19JTlRFR1JBVElPTl9URVNUUyA9PT0gJ3RydWUnO1xyXG5cclxuZGVzY3JpYmUuc2tpcCgnQVdTIEludGVncmF0aW9uIFRlc3RzIC0gSW5wdXQgUHJvY2Vzc2luZyBQaXBlbGluZScsICgpID0+IHtcclxuICBsZXQgZHluYW1vQ2xpZW50OiBEeW5hbW9EQkNsaWVudDtcclxuICBsZXQgczNDbGllbnQ6IFMzQ2xpZW50O1xyXG4gIGxldCB0cmFuc2NyaWJlQ2xpZW50OiBUcmFuc2NyaWJlQ2xpZW50O1xyXG4gIFxyXG4gIGNvbnN0IHRlc3RSZXNvdXJjZUlkczogc3RyaW5nW10gPSBbXTtcclxuICBjb25zdCB0ZXN0UzNLZXlzOiBzdHJpbmdbXSA9IFtdO1xyXG4gIGNvbnN0IHRlc3RUcmFuc2NyaXB0aW9uSm9iczogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgY29uc3QgbW9ja0NvbnRleHQ6IENvbnRleHQgPSB7XHJcbiAgICBjYWxsYmFja1dhaXRzRm9yRW1wdHlFdmVudExvb3A6IGZhbHNlLFxyXG4gICAgZnVuY3Rpb25OYW1lOiAndGVzdC1mdW5jdGlvbicsXHJcbiAgICBmdW5jdGlvblZlcnNpb246ICcxJyxcclxuICAgIGludm9rZWRGdW5jdGlvbkFybjogJ2Fybjphd3M6bGFtYmRhOnVzLWVhc3QtMToxMjM0NTY3ODkwMTI6ZnVuY3Rpb246dGVzdC1mdW5jdGlvbicsXHJcbiAgICBtZW1vcnlMaW1pdEluTUI6ICc1MTInLFxyXG4gICAgYXdzUmVxdWVzdElkOiAnYXdzLWludGVncmF0aW9uLXRlc3QnLFxyXG4gICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9sYW1iZGEvdGVzdC1mdW5jdGlvbicsXHJcbiAgICBsb2dTdHJlYW1OYW1lOiAnMjAyMy8wMS8wMS9bJExBVEVTVF10ZXN0LXN0cmVhbScsXHJcbiAgICBnZXRSZW1haW5pbmdUaW1lSW5NaWxsaXM6ICgpID0+IDMwMDAwLFxyXG4gICAgZG9uZTogamVzdC5mbigpLFxyXG4gICAgZmFpbDogamVzdC5mbigpLFxyXG4gICAgc3VjY2VlZDogamVzdC5mbigpLFxyXG4gIH07XHJcblxyXG4gIGJlZm9yZUFsbChhc3luYyAoKSA9PiB7XHJcbiAgICBpZiAoIXJ1bkFXU0ludGVncmF0aW9uVGVzdHMpIHtcclxuICAgICAgY29uc29sZS5sb2coJ1NraXBwaW5nIEFXUyBpbnRlZ3JhdGlvbiB0ZXN0cy4gU2V0IFJVTl9BV1NfSU5URUdSQVRJT05fVEVTVFM9dHJ1ZSB0byBydW4uJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBWZXJpZnkgcmVxdWlyZWQgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgICBjb25zdCByZXF1aXJlZEVudlZhcnMgPSBbXHJcbiAgICAgICdBVURJT19CVUNLRVRfTkFNRScsXHJcbiAgICAgICdDT05URU5UX1RBQkxFX05BTUUnLFxyXG4gICAgICAnRVZFTlRfQlVTX05BTUUnLFxyXG4gICAgICAnQVdTX1JFR0lPTidcclxuICAgIF07XHJcblxyXG4gICAgZm9yIChjb25zdCBlbnZWYXIgb2YgcmVxdWlyZWRFbnZWYXJzKSB7XHJcbiAgICAgIGlmICghcHJvY2Vzcy5lbnZbZW52VmFyXSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVxdWlyZWQgZW52aXJvbm1lbnQgdmFyaWFibGUgJHtlbnZWYXJ9IGlzIG5vdCBzZXRgKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuICAgIGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuICAgIHMzQ2xpZW50ID0gbmV3IFMzQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG4gICAgdHJhbnNjcmliZUNsaWVudCA9IG5ldyBUcmFuc2NyaWJlQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG4gIH0pO1xyXG5cclxuICBhZnRlckFsbChhc3luYyAoKSA9PiB7XHJcbiAgICBpZiAoIXJ1bkFXU0ludGVncmF0aW9uVGVzdHMpIHJldHVybjtcclxuXHJcbiAgICAvLyBDbGVhbiB1cCB0ZXN0IHJlc291cmNlc1xyXG4gICAgY29uc29sZS5sb2coJ0NsZWFuaW5nIHVwIHRlc3QgcmVzb3VyY2VzLi4uJyk7XHJcblxyXG4gICAgLy8gQ2xlYW4gdXAgRHluYW1vREIgcmVjb3Jkc1xyXG4gICAgZm9yIChjb25zdCByZXNvdXJjZUlkIG9mIHRlc3RSZXNvdXJjZUlkcykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBEZWxldGVJdGVtQ29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSEsXHJcbiAgICAgICAgICBLZXk6IHsgaWQ6IHsgUzogcmVzb3VyY2VJZCB9IH1cclxuICAgICAgICB9KSk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGBGYWlsZWQgdG8gZGVsZXRlIER5bmFtb0RCIHJlY29yZCAke3Jlc291cmNlSWR9OmAsIGVycm9yKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIENsZWFuIHVwIFMzIG9iamVjdHNcclxuICAgIGZvciAoY29uc3QgczNLZXkgb2YgdGVzdFMzS2V5cykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IERlbGV0ZU9iamVjdENvbW1hbmQoe1xyXG4gICAgICAgICAgQnVja2V0OiBwcm9jZXNzLmVudi5BVURJT19CVUNLRVRfTkFNRSEsXHJcbiAgICAgICAgICBLZXk6IHMzS2V5XHJcbiAgICAgICAgfSkpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2FybihgRmFpbGVkIHRvIGRlbGV0ZSBTMyBvYmplY3QgJHtzM0tleX06YCwgZXJyb3IpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ2xlYW4gdXAgdHJhbnNjcmlwdGlvbiBqb2JzICh0aGV5IGF1dG8tZGVsZXRlLCBidXQgd2UgY2FuIHRyeSlcclxuICAgIGZvciAoY29uc3Qgam9iTmFtZSBvZiB0ZXN0VHJhbnNjcmlwdGlvbkpvYnMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCB0cmFuc2NyaWJlQ2xpZW50LnNlbmQobmV3IERlbGV0ZVRyYW5zY3JpcHRpb25Kb2JDb21tYW5kKHtcclxuICAgICAgICAgIFRyYW5zY3JpcHRpb25Kb2JOYW1lOiBqb2JOYW1lXHJcbiAgICAgICAgfSkpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIC8vIFRyYW5zY3JpcHRpb24gam9icyBjYW4ndCBhbHdheXMgYmUgZGVsZXRlZCwgdGhpcyBpcyBleHBlY3RlZFxyXG4gICAgICAgIGNvbnNvbGUud2FybihgVHJhbnNjcmlwdGlvbiBqb2IgJHtqb2JOYW1lfSBjbGVhbnVwIG5vdGU6YCwgZXJyb3IpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdUZXh0IFByb2Nlc3NpbmcgSW50ZWdyYXRpb24nLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHByb2Nlc3MgdGV4dCBpbnB1dCBhbmQgc3RvcmUgaW4gRHluYW1vREInLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGlmICghcnVuQVdTSW50ZWdyYXRpb25UZXN0cykgcmV0dXJuO1xyXG5cclxuICAgICAgY29uc3QgdGVzdFRleHQgPSAnQVdTIEludGVncmF0aW9uIHRlc3QgZm9yIHRleHQgcHJvY2Vzc2luZyBwaXBlbGluZSc7XHJcbiAgICAgIGNvbnN0IHVzZXJJZCA9ICdhd3MtaW50ZWdyYXRpb24tdGVzdC11c2VyJztcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvdGV4dCcsXHJcbiAgICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIHRleHQ6IHRlc3RUZXh0LFxyXG4gICAgICAgICAgdXNlcklkOiB1c2VySWQsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIFByb2Nlc3MgdGhlIHRleHQgaW5wdXRcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG4gICAgICBcclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKHJlc3VsdC5ib2R5KTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keSkudG9IYXZlUHJvcGVydHkoJ21lc3NhZ2UnLCAnVGV4dCBpbnB1dCBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZGF0YSkudG9IYXZlUHJvcGVydHkoJ2lucHV0SWQnKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5kYXRhKS50b0hhdmVQcm9wZXJ0eSgnc3RhdHVzJywgJ2NvbXBsZXRlZCcpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmRhdGEpLnRvSGF2ZVByb3BlcnR5KCd0cmFuc2NyaXB0aW9uJyk7XHJcblxyXG4gICAgICBjb25zdCBpbnB1dElkID0gcmVzcG9uc2VCb2R5LmRhdGEuaW5wdXRJZDtcclxuICAgICAgdGVzdFJlc291cmNlSWRzLnB1c2goaW5wdXRJZCk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgdGhlIHJlY29yZCB3YXMgY3JlYXRlZCBpbiBEeW5hbW9EQlxyXG4gICAgICBjb25zdCBkeW5hbW9SZXN1bHQgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FISxcclxuICAgICAgICBLZXk6IHsgaWQ6IHsgUzogaW5wdXRJZCB9IH1cclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgZXhwZWN0KGR5bmFtb1Jlc3VsdC5JdGVtKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QoZHluYW1vUmVzdWx0Lkl0ZW0hLmlkLlMpLnRvQmUoaW5wdXRJZCk7XHJcbiAgICAgIGV4cGVjdChkeW5hbW9SZXN1bHQuSXRlbSEudXNlcklkLlMpLnRvQmUodXNlcklkKTtcclxuICAgICAgZXhwZWN0KGR5bmFtb1Jlc3VsdC5JdGVtIS50eXBlLlMpLnRvQmUoJ3RleHQnKTtcclxuICAgICAgZXhwZWN0KGR5bmFtb1Jlc3VsdC5JdGVtIS5zdGF0dXMuUykudG9CZSgnY29tcGxldGVkJyk7XHJcbiAgICAgIGV4cGVjdChkeW5hbW9SZXN1bHQuSXRlbSEudHJhbnNjcmlwdGlvbi5TKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QoZHluYW1vUmVzdWx0Lkl0ZW0hLmNyZWF0ZWRBdC5TKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QoZHluYW1vUmVzdWx0Lkl0ZW0hLnVwZGF0ZWRBdC5TKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCByZXRyaWV2ZSB0ZXh0IHByb2Nlc3Npbmcgc3RhdHVzIGNvcnJlY3RseScsIGFzeW5jICgpID0+IHtcclxuICAgICAgaWYgKCFydW5BV1NJbnRlZ3JhdGlvblRlc3RzKSByZXR1cm47XHJcblxyXG4gICAgICAvLyBGaXJzdCBjcmVhdGUgYSB0ZXh0IGlucHV0XHJcbiAgICAgIGNvbnN0IHRlc3RUZXh0ID0gJ1N0YXR1cyBjaGVjayBpbnRlZ3JhdGlvbiB0ZXN0JztcclxuICAgICAgY29uc3QgdXNlcklkID0gJ3N0YXR1cy10ZXN0LXVzZXInO1xyXG5cclxuICAgICAgY29uc3QgY3JlYXRlRXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC90ZXh0JyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyB0ZXh0OiB0ZXN0VGV4dCwgdXNlcklkIH0pLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBjcmVhdGVSZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGNyZWF0ZUV2ZW50LCBtb2NrQ29udGV4dCk7XHJcbiAgICAgIGNvbnN0IGNyZWF0ZVJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UoY3JlYXRlUmVzdWx0LmJvZHkpO1xyXG4gICAgICBjb25zdCBpbnB1dElkID0gY3JlYXRlUmVzcG9uc2VCb2R5LmRhdGEuaW5wdXRJZDtcclxuICAgICAgdGVzdFJlc291cmNlSWRzLnB1c2goaW5wdXRJZCk7XHJcblxyXG4gICAgICAvLyBOb3cgY2hlY2sgdGhlIHN0YXR1c1xyXG4gICAgICBjb25zdCBzdGF0dXNFdmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXHJcbiAgICAgICAgcGF0aDogYC9hcGkvaW5wdXQvc3RhdHVzLyR7aW5wdXRJZH1gLFxyXG4gICAgICAgIGhlYWRlcnM6IHt9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBudWxsLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBzdGF0dXNSZXN1bHQgPSBhd2FpdCBoYW5kbGVyKHN0YXR1c0V2ZW50LCBtb2NrQ29udGV4dCk7XHJcbiAgICAgIFxyXG4gICAgICBleHBlY3Qoc3RhdHVzUmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHN0YXR1c1Jlc3BvbnNlQm9keSA9IEpTT04ucGFyc2Uoc3RhdHVzUmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3Qoc3RhdHVzUmVzcG9uc2VCb2R5KS50b0hhdmVQcm9wZXJ0eSgnbWVzc2FnZScsICdJbnB1dCBzdGF0dXMgcmV0cmlldmVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICBleHBlY3Qoc3RhdHVzUmVzcG9uc2VCb2R5LmRhdGEpLnRvSGF2ZVByb3BlcnR5KCdpZCcsIGlucHV0SWQpO1xyXG4gICAgICBleHBlY3Qoc3RhdHVzUmVzcG9uc2VCb2R5LmRhdGEpLnRvSGF2ZVByb3BlcnR5KCd1c2VySWQnLCB1c2VySWQpO1xyXG4gICAgICBleHBlY3Qoc3RhdHVzUmVzcG9uc2VCb2R5LmRhdGEpLnRvSGF2ZVByb3BlcnR5KCd0eXBlJywgJ3RleHQnKTtcclxuICAgICAgZXhwZWN0KHN0YXR1c1Jlc3BvbnNlQm9keS5kYXRhKS50b0hhdmVQcm9wZXJ0eSgnc3RhdHVzJywgJ2NvbXBsZXRlZCcpO1xyXG4gICAgICBleHBlY3Qoc3RhdHVzUmVzcG9uc2VCb2R5LmRhdGEpLnRvSGF2ZVByb3BlcnR5KCd0cmFuc2NyaXB0aW9uJyk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0F1ZGlvIFByb2Nlc3NpbmcgSW50ZWdyYXRpb24nLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHByb2Nlc3MgYXVkaW8gaW5wdXQgYW5kIHRyaWdnZXIgdHJhbnNjcmlwdGlvbicsIGFzeW5jICgpID0+IHtcclxuICAgICAgaWYgKCFydW5BV1NJbnRlZ3JhdGlvblRlc3RzKSByZXR1cm47XHJcblxyXG4gICAgICAvLyBDcmVhdGUgYSB2YWxpZCBXQVYgZmlsZSBmb3IgdGVzdGluZ1xyXG4gICAgICBjb25zdCB3YXZIZWFkZXIgPSBCdWZmZXIuZnJvbShbXHJcbiAgICAgICAgMHg1MiwgMHg0OSwgMHg0NiwgMHg0NiwgLy8gXCJSSUZGXCJcclxuICAgICAgICAweDI0LCAweDA4LCAweDAwLCAweDAwLCAvLyBGaWxlIHNpemVcclxuICAgICAgICAweDU3LCAweDQxLCAweDU2LCAweDQ1LCAvLyBcIldBVkVcIlxyXG4gICAgICAgIDB4NjYsIDB4NkQsIDB4NzQsIDB4MjAsIC8vIFwiZm10IFwiXHJcbiAgICAgICAgMHgxMCwgMHgwMCwgMHgwMCwgMHgwMCwgLy8gU3ViY2h1bmsxU2l6ZVxyXG4gICAgICAgIDB4MDEsIDB4MDAsIDB4MDIsIDB4MDAsIC8vIEF1ZGlvRm9ybWF0LCBOdW1DaGFubmVsc1xyXG4gICAgICAgIDB4NDQsIDB4QUMsIDB4MDAsIDB4MDAsIC8vIFNhbXBsZVJhdGVcclxuICAgICAgICAweDEwLCAweEIxLCAweDAyLCAweDAwLCAvLyBCeXRlUmF0ZVxyXG4gICAgICAgIDB4MDQsIDB4MDAsIDB4MTAsIDB4MDAsIC8vIEJsb2NrQWxpZ24sIEJpdHNQZXJTYW1wbGVcclxuICAgICAgICAweDY0LCAweDYxLCAweDc0LCAweDYxLCAvLyBcImRhdGFcIlxyXG4gICAgICAgIDB4MDAsIDB4MDgsIDB4MDAsIDB4MDAsIC8vIFN1YmNodW5rMlNpemVcclxuICAgICAgICAvLyBBZGQgc29tZSBkdW1teSBhdWRpbyBkYXRhXHJcbiAgICAgICAgLi4uQXJyYXkoMjA0OCkuZmlsbCgwKS5tYXAoKCkgPT4gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMjU2KSlcclxuICAgICAgXSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBhdWRpb0RhdGEgPSB3YXZIZWFkZXIudG9TdHJpbmcoJ2Jhc2U2NCcpO1xyXG4gICAgICBjb25zdCB1c2VySWQgPSAnYXVkaW8taW50ZWdyYXRpb24tdGVzdC11c2VyJztcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvYXVkaW8nLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBhdWRpb0RhdGEsXHJcbiAgICAgICAgICBjb250ZW50VHlwZTogJ2F1ZGlvL3dhdicsXHJcbiAgICAgICAgICB1c2VySWQ6IHVzZXJJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gUHJvY2VzcyB0aGUgYXVkaW8gaW5wdXRcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG4gICAgICBcclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMik7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKHJlc3VsdC5ib2R5KTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keSkudG9IYXZlUHJvcGVydHkoJ21lc3NhZ2UnLCAnQXVkaW8gdXBsb2FkIHN1Y2Nlc3NmdWwsIHByb2Nlc3Npbmcgc3RhcnRlZCcpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmRhdGEpLnRvSGF2ZVByb3BlcnR5KCdpbnB1dElkJyk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZGF0YSkudG9IYXZlUHJvcGVydHkoJ3N0YXR1cycsICdwcm9jZXNzaW5nJyk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZGF0YSkudG9IYXZlUHJvcGVydHkoJ3RyYW5zY3JpcHRpb25Kb2JOYW1lJyk7XHJcblxyXG4gICAgICBjb25zdCBpbnB1dElkID0gcmVzcG9uc2VCb2R5LmRhdGEuaW5wdXRJZDtcclxuICAgICAgY29uc3QgdHJhbnNjcmlwdGlvbkpvYk5hbWUgPSByZXNwb25zZUJvZHkuZGF0YS50cmFuc2NyaXB0aW9uSm9iTmFtZTtcclxuICAgICAgXHJcbiAgICAgIHRlc3RSZXNvdXJjZUlkcy5wdXNoKGlucHV0SWQpO1xyXG4gICAgICB0ZXN0VHJhbnNjcmlwdGlvbkpvYnMucHVzaCh0cmFuc2NyaXB0aW9uSm9iTmFtZSk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgdGhlIHJlY29yZCB3YXMgY3JlYXRlZCBpbiBEeW5hbW9EQlxyXG4gICAgICBjb25zdCBkeW5hbW9SZXN1bHQgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FISxcclxuICAgICAgICBLZXk6IHsgaWQ6IHsgUzogaW5wdXRJZCB9IH1cclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgZXhwZWN0KGR5bmFtb1Jlc3VsdC5JdGVtKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QoZHluYW1vUmVzdWx0Lkl0ZW0hLmlkLlMpLnRvQmUoaW5wdXRJZCk7XHJcbiAgICAgIGV4cGVjdChkeW5hbW9SZXN1bHQuSXRlbSEudXNlcklkLlMpLnRvQmUodXNlcklkKTtcclxuICAgICAgZXhwZWN0KGR5bmFtb1Jlc3VsdC5JdGVtIS50eXBlLlMpLnRvQmUoJ2F1ZGlvJyk7XHJcbiAgICAgIGV4cGVjdChkeW5hbW9SZXN1bHQuSXRlbSEuc3RhdHVzLlMpLnRvQmUoJ3Byb2Nlc3NpbmcnKTtcclxuICAgICAgZXhwZWN0KGR5bmFtb1Jlc3VsdC5JdGVtIS5hdWRpb0tleS5TKS50b0JlRGVmaW5lZCgpO1xyXG5cclxuICAgICAgLy8gVHJhY2sgUzMga2V5IGZvciBjbGVhbnVwXHJcbiAgICAgIHRlc3RTM0tleXMucHVzaChkeW5hbW9SZXN1bHQuSXRlbSEuYXVkaW9LZXkuUyEpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IHRoZSBhdWRpbyBmaWxlIHdhcyB1cGxvYWRlZCB0byBTM1xyXG4gICAgICBjb25zdCBzM1Jlc3VsdCA9IGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xyXG4gICAgICAgIEJ1Y2tldDogcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUhLFxyXG4gICAgICAgIEtleTogZHluYW1vUmVzdWx0Lkl0ZW0hLmF1ZGlvS2V5LlMhXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGV4cGVjdChzM1Jlc3VsdC5Cb2R5KS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QoczNSZXN1bHQuQ29udGVudFR5cGUpLnRvQmUoJ2F1ZGlvL3dhdicpO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IHRyYW5zY3JpcHRpb24gam9iIHdhcyBjcmVhdGVkXHJcbiAgICAgIGNvbnN0IHRyYW5zY3JpYmVSZXN1bHQgPSBhd2FpdCB0cmFuc2NyaWJlQ2xpZW50LnNlbmQobmV3IEdldFRyYW5zY3JpcHRpb25Kb2JDb21tYW5kKHtcclxuICAgICAgICBUcmFuc2NyaXB0aW9uSm9iTmFtZTogdHJhbnNjcmlwdGlvbkpvYk5hbWVcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgZXhwZWN0KHRyYW5zY3JpYmVSZXN1bHQuVHJhbnNjcmlwdGlvbkpvYikudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KHRyYW5zY3JpYmVSZXN1bHQuVHJhbnNjcmlwdGlvbkpvYiEuVHJhbnNjcmlwdGlvbkpvYk5hbWUpLnRvQmUodHJhbnNjcmlwdGlvbkpvYk5hbWUpO1xyXG4gICAgICBleHBlY3QoWydRVUVVRUQnLCAnSU5fUFJPR1JFU1MnLCAnQ09NUExFVEVEJywgJ0ZBSUxFRCddKS50b0NvbnRhaW4oXHJcbiAgICAgICAgdHJhbnNjcmliZVJlc3VsdC5UcmFuc2NyaXB0aW9uSm9iIS5UcmFuc2NyaXB0aW9uSm9iU3RhdHVzXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBhdWRpbyBwcm9jZXNzaW5nIHN0YXR1cyBwb2xsaW5nJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBpZiAoIXJ1bkFXU0ludGVncmF0aW9uVGVzdHMpIHJldHVybjtcclxuXHJcbiAgICAgIC8vIFRoaXMgdGVzdCB3b3VsZCByZXF1aXJlIHdhaXRpbmcgZm9yIHRyYW5zY3JpcHRpb24gdG8gY29tcGxldGVcclxuICAgICAgLy8gRm9yIG5vdywgd2UnbGwganVzdCB0ZXN0IHRoZSBzdGF0dXMgZW5kcG9pbnQgd2l0aCBhIHByb2Nlc3NpbmcgcmVjb3JkXHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSBtaW5pbWFsIGF1ZGlvIHByb2Nlc3NpbmcgcmVjb3JkIGZpcnN0XHJcbiAgICAgIGNvbnN0IHdhdkhlYWRlciA9IEJ1ZmZlci5mcm9tKFtcclxuICAgICAgICAweDUyLCAweDQ5LCAweDQ2LCAweDQ2LCAvLyBcIlJJRkZcIlxyXG4gICAgICAgIDB4MjQsIDB4MDgsIDB4MDAsIDB4MDAsIC8vIEZpbGUgc2l6ZVxyXG4gICAgICAgIDB4NTcsIDB4NDEsIDB4NTYsIDB4NDUsIC8vIFwiV0FWRVwiXHJcbiAgICAgICAgMHg2NiwgMHg2RCwgMHg3NCwgMHgyMCwgLy8gXCJmbXQgXCJcclxuICAgICAgICAweDEwLCAweDAwLCAweDAwLCAweDAwLCAvLyBTdWJjaHVuazFTaXplXHJcbiAgICAgICAgMHgwMSwgMHgwMCwgMHgwMiwgMHgwMCwgLy8gQXVkaW9Gb3JtYXQsIE51bUNoYW5uZWxzXHJcbiAgICAgICAgMHg0NCwgMHhBQywgMHgwMCwgMHgwMCwgLy8gU2FtcGxlUmF0ZVxyXG4gICAgICAgIDB4MTAsIDB4QjEsIDB4MDIsIDB4MDAsIC8vIEJ5dGVSYXRlXHJcbiAgICAgICAgMHgwNCwgMHgwMCwgMHgxMCwgMHgwMCwgLy8gQmxvY2tBbGlnbiwgQml0c1BlclNhbXBsZVxyXG4gICAgICAgIDB4NjQsIDB4NjEsIDB4NzQsIDB4NjEsIC8vIFwiZGF0YVwiXHJcbiAgICAgICAgMHgwMCwgMHgwOCwgMHgwMCwgMHgwMCwgLy8gU3ViY2h1bmsyU2l6ZVxyXG4gICAgICAgIC4uLkFycmF5KDEwMjQpLmZpbGwoMCkubWFwKCgpID0+IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDI1NikpXHJcbiAgICAgIF0pO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgYXVkaW9EYXRhID0gd2F2SGVhZGVyLnRvU3RyaW5nKCdiYXNlNjQnKTtcclxuICAgICAgY29uc3QgdXNlcklkID0gJ3N0YXR1cy1wb2xsaW5nLXRlc3QtdXNlcic7XHJcblxyXG4gICAgICBjb25zdCBjcmVhdGVFdmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L2F1ZGlvJyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgYXVkaW9EYXRhLFxyXG4gICAgICAgICAgY29udGVudFR5cGU6ICdhdWRpby93YXYnLFxyXG4gICAgICAgICAgdXNlcklkOiB1c2VySWQsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGNyZWF0ZVJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoY3JlYXRlRXZlbnQsIG1vY2tDb250ZXh0KTtcclxuICAgICAgY29uc3QgY3JlYXRlUmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShjcmVhdGVSZXN1bHQuYm9keSk7XHJcbiAgICAgIGNvbnN0IGlucHV0SWQgPSBjcmVhdGVSZXNwb25zZUJvZHkuZGF0YS5pbnB1dElkO1xyXG4gICAgICBjb25zdCB0cmFuc2NyaXB0aW9uSm9iTmFtZSA9IGNyZWF0ZVJlc3BvbnNlQm9keS5kYXRhLnRyYW5zY3JpcHRpb25Kb2JOYW1lO1xyXG4gICAgICBcclxuICAgICAgdGVzdFJlc291cmNlSWRzLnB1c2goaW5wdXRJZCk7XHJcbiAgICAgIHRlc3RUcmFuc2NyaXB0aW9uSm9icy5wdXNoKHRyYW5zY3JpcHRpb25Kb2JOYW1lKTtcclxuXHJcbiAgICAgIC8vIFBvbGwgc3RhdHVzIG11bHRpcGxlIHRpbWVzIHRvIHRlc3QgdGhlIHBvbGxpbmcgbWVjaGFuaXNtXHJcbiAgICAgIGxldCBhdHRlbXB0cyA9IDA7XHJcbiAgICAgIGxldCBmaW5hbFN0YXR1cyA9ICdwcm9jZXNzaW5nJztcclxuICAgICAgXHJcbiAgICAgIHdoaWxlIChhdHRlbXB0cyA8IDUgJiYgZmluYWxTdGF0dXMgPT09ICdwcm9jZXNzaW5nJykge1xyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAyMDAwKSk7IC8vIFdhaXQgMiBzZWNvbmRzXHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3Qgc3RhdHVzRXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXHJcbiAgICAgICAgICBwYXRoOiBgL2FwaS9pbnB1dC9zdGF0dXMvJHtpbnB1dElkfWAsXHJcbiAgICAgICAgICBoZWFkZXJzOiB7fSxcclxuICAgICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICAgIGJvZHk6IG51bGwsXHJcbiAgICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IHN0YXR1c1Jlc3VsdCA9IGF3YWl0IGhhbmRsZXIoc3RhdHVzRXZlbnQsIG1vY2tDb250ZXh0KTtcclxuICAgICAgICBleHBlY3Qoc3RhdHVzUmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBzdGF0dXNSZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKHN0YXR1c1Jlc3VsdC5ib2R5KTtcclxuICAgICAgICBmaW5hbFN0YXR1cyA9IHN0YXR1c1Jlc3BvbnNlQm9keS5kYXRhLnN0YXR1cztcclxuICAgICAgICBcclxuICAgICAgICBleHBlY3Qoc3RhdHVzUmVzcG9uc2VCb2R5LmRhdGEpLnRvSGF2ZVByb3BlcnR5KCdpZCcsIGlucHV0SWQpO1xyXG4gICAgICAgIGV4cGVjdChzdGF0dXNSZXNwb25zZUJvZHkuZGF0YSkudG9IYXZlUHJvcGVydHkoJ3R5cGUnLCAnYXVkaW8nKTtcclxuICAgICAgICBleHBlY3QoWydwcm9jZXNzaW5nJywgJ2NvbXBsZXRlZCcsICdmYWlsZWQnXSkudG9Db250YWluKGZpbmFsU3RhdHVzKTtcclxuICAgICAgICBcclxuICAgICAgICBhdHRlbXB0cysrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBUaGUgc3RhdHVzIHNob3VsZCBoYXZlIGJlZW4gY2hlY2tlZCBzdWNjZXNzZnVsbHkgcmVnYXJkbGVzcyBvZiBmaW5hbCBzdGF0ZVxyXG4gICAgICBleHBlY3QoYXR0ZW1wdHMpLnRvQmVHcmVhdGVyVGhhbigwKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnRXJyb3IgSGFuZGxpbmcgSW50ZWdyYXRpb24nLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBBV1Mgc2VydmljZSBmYWlsdXJlcyBncmFjZWZ1bGx5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBpZiAoIXJ1bkFXU0ludGVncmF0aW9uVGVzdHMpIHJldHVybjtcclxuXHJcbiAgICAgIC8vIFRlc3Qgd2l0aCBhbiBpbnZhbGlkIGJ1Y2tldCBuYW1lIHRvIHRyaWdnZXIgUzMgZXJyb3JcclxuICAgICAgY29uc3Qgb3JpZ2luYWxCdWNrZXQgPSBwcm9jZXNzLmVudi5BVURJT19CVUNLRVRfTkFNRTtcclxuICAgICAgcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUgPSAnbm9uLWV4aXN0ZW50LWJ1Y2tldC1uYW1lLTEyMzQ1JztcclxuXHJcbiAgICAgIGNvbnN0IHdhdkhlYWRlciA9IEJ1ZmZlci5mcm9tKFtcclxuICAgICAgICAweDUyLCAweDQ5LCAweDQ2LCAweDQ2LCAvLyBcIlJJRkZcIlxyXG4gICAgICAgIDB4MjQsIDB4MDgsIDB4MDAsIDB4MDAsIC8vIEZpbGUgc2l6ZVxyXG4gICAgICAgIDB4NTcsIDB4NDEsIDB4NTYsIDB4NDUsIC8vIFwiV0FWRVwiXHJcbiAgICAgICAgMHg2NiwgMHg2RCwgMHg3NCwgMHgyMCwgLy8gXCJmbXQgXCJcclxuICAgICAgICAweDEwLCAweDAwLCAweDAwLCAweDAwLCAvLyBTdWJjaHVuazFTaXplXHJcbiAgICAgICAgMHgwMSwgMHgwMCwgMHgwMiwgMHgwMCwgLy8gQXVkaW9Gb3JtYXQsIE51bUNoYW5uZWxzXHJcbiAgICAgICAgMHg0NCwgMHhBQywgMHgwMCwgMHgwMCwgLy8gU2FtcGxlUmF0ZVxyXG4gICAgICAgIDB4MTAsIDB4QjEsIDB4MDIsIDB4MDAsIC8vIEJ5dGVSYXRlXHJcbiAgICAgICAgMHgwNCwgMHgwMCwgMHgxMCwgMHgwMCwgLy8gQmxvY2tBbGlnbiwgQml0c1BlclNhbXBsZVxyXG4gICAgICAgIDB4NjQsIDB4NjEsIDB4NzQsIDB4NjEsIC8vIFwiZGF0YVwiXHJcbiAgICAgICAgMHgwMCwgMHgwOCwgMHgwMCwgMHgwMCwgLy8gU3ViY2h1bmsyU2l6ZVxyXG4gICAgICAgIC4uLkFycmF5KDEwMjQpLmZpbGwoMCkubWFwKCgpID0+IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDI1NikpXHJcbiAgICAgIF0pO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgYXVkaW9EYXRhID0gd2F2SGVhZGVyLnRvU3RyaW5nKCdiYXNlNjQnKTtcclxuXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvYXVkaW8nLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBhdWRpb0RhdGEsXHJcbiAgICAgICAgICBjb250ZW50VHlwZTogJ2F1ZGlvL3dhdicsXHJcbiAgICAgICAgICB1c2VySWQ6ICdlcnJvci10ZXN0LXVzZXInLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBTaG91bGQgcmV0dXJuIDUwMCBlcnJvciBkdWUgdG8gUzMgZmFpbHVyZVxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNTAwKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5KS50b0hhdmVQcm9wZXJ0eSgnZXJyb3InLCAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkpLnRvSGF2ZVByb3BlcnR5KCdtZXNzYWdlJyk7XHJcblxyXG4gICAgICAvLyBSZXN0b3JlIG9yaWdpbmFsIGJ1Y2tldCBuYW1lXHJcbiAgICAgIHByb2Nlc3MuZW52LkFVRElPX0JVQ0tFVF9OQU1FID0gb3JpZ2luYWxCdWNrZXQ7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19