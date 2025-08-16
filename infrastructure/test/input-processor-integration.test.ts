import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Simple integration test without complex mocking
describe('Input Processor Integration', () => {
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '512',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2023/01/01/[$LATEST]test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
  };

  // Set environment variables
  beforeAll(() => {
    process.env.AUDIO_BUCKET_NAME = 'test-audio-bucket';
    process.env.CONTENT_TABLE_NAME = 'test-content-table';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
    process.env.AWS_REGION = 'us-east-1';
  });

  describe('Route handling', () => {
    it('should handle OPTIONS requests', async () => {
      // This test doesn't require AWS services, so it should work
      const { handler } = await import('../lambda/input-processor');
      
      const event: APIGatewayProxyEvent = {
        httpMethod: 'OPTIONS',
        path: '/api/input/audio',
        headers: { origin: 'https://example.github.io' },
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

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
      expect(result.body).toBe('');
    });

    it('should return 404 for unknown routes', async () => {
      const { handler } = await import('../lambda/input-processor');
      
      const event: APIGatewayProxyEvent = {
        httpMethod: 'GET',
        path: '/api/unknown-route',
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

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Not Found',
        message: 'Route GET /api/unknown-route not found',
      });
    });
  });

  describe('Validation functions', () => {
    it('should validate audio upload requests', async () => {
      // Test validation logic without AWS calls
      const validRequest = {
        audioData: 'UklGRiQIAABXQVZFZm10IBAAAAABAAIARKwAABCxAgAEABAAZGF0YQAIAAA=',
        contentType: 'audio/wav',
        userId: 'test-user-123',
      };

      // Import validation functions (we'd need to export them from the module)
      // For now, we'll test through the handler with invalid data
      const { handler } = await import('../lambda/input-processor');
      
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
          audioData: '', // Invalid: empty audio data
          contentType: 'audio/wav',
          userId: 'test-user-123',
        }),
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Validation Error',
        message: 'Audio data is required',
      });
    });

    it('should validate text input requests', async () => {
      const { handler } = await import('../lambda/input-processor');
      
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
          text: '', // Invalid: empty text
          userId: 'test-user-123',
        }),
        isBase64Encoded: false,
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Validation Error',
        message: 'Text is required',
      });
    });
  });
});