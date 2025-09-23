import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../lambda/auth-handler';

const mockDynamoSend = jest.fn();
const mockSecretsSend = jest.fn();

// Mock AWS SDK modules
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({}))
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: mockDynamoSend
    }))
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  DeleteCommand: jest.fn(),
  QueryCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({
    send: mockSecretsSend
  })),
  CreateSecretCommand: jest.fn(),
  UpdateSecretCommand: jest.fn(),
  GetSecretValueCommand: jest.fn(),
  DeleteSecretCommand: jest.fn()
}));

// Mock fetch for OAuth token exchange
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('Auth Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up environment variables
    process.env.PLATFORMS_TABLE = 'test-platforms-table';
    process.env.OAUTH_STATES_TABLE = 'test-oauth-states-table';
    process.env.MEDIUM_CLIENT_ID = 'test-medium-client-id';
    process.env.MEDIUM_CLIENT_SECRET = 'test-medium-client-secret';
    process.env.MEDIUM_REDIRECT_URI = 'https://example.com/callback';
    process.env.LINKEDIN_CLIENT_ID = 'test-linkedin-client-id';
    process.env.LINKEDIN_CLIENT_SECRET = 'test-linkedin-client-secret';
    process.env.LINKEDIN_REDIRECT_URI = 'https://example.com/callback';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createMockEvent = (
    path: string,
    method: string,
    body?: any
  ): APIGatewayProxyEvent => ({
    path,
    httpMethod: method,
    body: body ? JSON.stringify(body) : null,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    isBase64Encoded: false
  });

  describe('OPTIONS requests', () => {
    it('should handle CORS preflight requests', async () => {
      const event = createMockEvent('/auth/exchange', 'OPTIONS');
      
      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
      });
    });
  });

  describe('Token Exchange', () => {
    it('should successfully exchange authorization code for token', async () => {
      const event = createMockEvent('/auth/exchange', 'POST', {
        code: 'test-auth-code',
        platform: 'medium',
        userId: 'test-user-123'
      });

      // Mock successful token exchange
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'basicProfile publishPost'
        }), { status: 200 })
      );

      // Mock successful secret storage
      mockSecretsSend.mockResolvedValueOnce({});
      
      // Mock successful DynamoDB put
      mockDynamoSend.mockResolvedValueOnce({});

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.token.accessToken).toBe('test-access-token');
    });

    it('should handle missing parameters', async () => {
      const event = createMockEvent('/auth/exchange', 'POST', {
        code: 'test-auth-code'
        // Missing platform and userId
      });

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(400);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Missing required parameters');
    });

    it('should handle token exchange failure', async () => {
      const event = createMockEvent('/auth/exchange', 'POST', {
        code: 'invalid-code',
        platform: 'medium',
        userId: 'test-user-123'
      });

      // Mock failed token exchange
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce(
        new Response('Invalid authorization code', { status: 400 })
      );

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(400);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Token exchange failed');
    });

    it('should handle unsupported platform', async () => {
      const event = createMockEvent('/auth/exchange', 'POST', {
        code: 'test-auth-code',
        platform: 'unsupported-platform',
        userId: 'test-user-123'
      });

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(400);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toContain('Unsupported platform');
    });
  });

  describe('Get Connected Platforms', () => {
    it('should return connected platforms for user', async () => {
      const event = createMockEvent('/auth/platforms/test-user-123', 'GET');

      // Mock DynamoDB query result
      mockDynamoSend.mockResolvedValueOnce({
        Items: [
          {
            userId: 'test-user-123',
            platform: 'medium',
            secretName: 'oauth-credentials/test-user-123/medium',
            isActive: true,
            connectedAt: '2024-01-01T00:00:00.000Z',
            lastUsed: '2024-01-01T00:00:00.000Z',
            expiresAt: new Date(Date.now() + 3600000).toISOString()
          }
        ]
      });

      // Mock secret validation
      mockSecretsSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({
          accessToken: 'test-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString()
        })
      });

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(Array.isArray(responseBody)).toBe(true);
      expect(responseBody[0].platform).toBe('medium');
      expect(responseBody[0].isActive).toBe(true);
    });

    it('should handle empty platforms list', async () => {
      const event = createMockEvent('/auth/platforms/test-user-123', 'GET');

      // Mock empty DynamoDB query result
      mockDynamoSend.mockResolvedValueOnce({
        Items: []
      });

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(Array.isArray(responseBody)).toBe(true);
      expect(responseBody.length).toBe(0);
    });
  });

  describe('Disconnect Platform', () => {
    it('should successfully disconnect platform', async () => {
      const event = createMockEvent('/auth/platforms/test-user-123/medium', 'DELETE');

      // Mock getting platform connection
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            userId: 'test-user-123',
            platform: 'medium',
            secretName: 'oauth-credentials/test-user-123/medium'
          }
        })
        // Mock successful deletion from DynamoDB
        .mockResolvedValueOnce({});

      // Mock successful secret deletion
      mockSecretsSend.mockResolvedValueOnce({});

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
    });

    it('should handle platform not found', async () => {
      const event = createMockEvent('/auth/platforms/test-user-123/nonexistent', 'DELETE');

      // Mock platform not found
      mockDynamoSend.mockResolvedValueOnce({
        Item: undefined
      });

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(404);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Platform connection not found');
    });
  });

  describe('Check Token Status', () => {
    it('should return valid token status', async () => {
      const event = createMockEvent('/auth/status/test-user-123/medium', 'GET');

      // Mock getting platform connection
      mockDynamoSend.mockResolvedValueOnce({
        Item: {
          userId: 'test-user-123',
          platform: 'medium',
          secretName: 'oauth-credentials/test-user-123/medium',
          expiresAt: new Date(Date.now() + 3600000).toISOString()
        }
      });

      // Mock getting valid credentials
      mockSecretsSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({
          accessToken: 'test-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString()
        })
      });

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.valid).toBe(true);
      expect(responseBody.expiresAt).toBeDefined();
    });

    it('should return invalid token status for expired token', async () => {
      const event = createMockEvent('/auth/status/test-user-123/medium', 'GET');

      // Mock getting platform connection
      mockDynamoSend.mockResolvedValueOnce({
        Item: {
          userId: 'test-user-123',
          platform: 'medium',
          secretName: 'oauth-credentials/test-user-123/medium',
          expiresAt: new Date(Date.now() - 3600000).toISOString() // Expired
        }
      });

      // Mock getting expired credentials
      mockSecretsSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({
          accessToken: 'test-token',
          expiresAt: new Date(Date.now() - 3600000).toISOString() // Expired
        })
      });

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.valid).toBe(false);
    });
  });

  describe('Token Refresh', () => {
    it('should successfully refresh token', async () => {
      const event = createMockEvent('/auth/refresh', 'POST', {
        userId: 'test-user-123',
        platform: 'medium'
      });

      // Mock getting platform connection
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            userId: 'test-user-123',
            platform: 'medium',
            secretName: 'oauth-credentials/test-user-123/medium'
          }
        })
        // Mock updating platform connection
        .mockResolvedValueOnce({});

      // Mock getting current credentials
      mockSecretsSend
        .mockResolvedValueOnce({
          SecretString: JSON.stringify({
            accessToken: 'old-token',
            refreshToken: 'test-refresh-token',
            expiresAt: new Date(Date.now() - 3600000).toISOString()
          })
        })
        // Mock updating credentials
        .mockResolvedValueOnce({});

      // Mock successful token refresh
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer'
        }), { status: 200 })
      );

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.success).toBe(true);
      expect(responseBody.token.accessToken).toBe('new-access-token');
    });

    it('should handle missing refresh token', async () => {
      const event = createMockEvent('/auth/refresh', 'POST', {
        userId: 'test-user-123',
        platform: 'medium'
      });

      // Mock getting platform connection
      mockDynamoSend.mockResolvedValueOnce({
        Item: {
          userId: 'test-user-123',
          platform: 'medium',
          secretName: 'oauth-credentials/test-user-123/medium'
        }
      });

      // Mock getting credentials without refresh token
      mockSecretsSend.mockResolvedValueOnce({
        SecretString: JSON.stringify({
          accessToken: 'old-token',
          expiresAt: new Date(Date.now() - 3600000).toISOString()
          // No refreshToken
        })
      });

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(400);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('No refresh token available');
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown routes', async () => {
      const event = createMockEvent('/auth/unknown', 'GET');

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(404);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Not found');
    });

    it('should handle internal server errors', async () => {
      const event = createMockEvent('/auth/exchange', 'POST', {
        code: 'test-code',
        platform: 'medium',
        userId: 'test-user-123'
      });

      // Mock DynamoDB error
      mockDynamoSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      const result = await handler(event) as APIGatewayProxyResult;
      
      expect(result.statusCode).toBe(500);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Internal server error');
    });
  });
});