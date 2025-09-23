import { JWTService } from '../lambda/auth/jwt-service';
import { AuthMiddleware } from '../lambda/auth/auth-middleware';
import { AuditLogger } from '../lambda/utils/audit-logger';
import { SecurityConfigService } from '../lambda/utils/security-config';
import { DataRetentionService } from '../lambda/utils/data-retention';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: mockSend,
  })),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: mockSend,
    })),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  DeleteCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({
    send: mockSend,
  })),
  PublishCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-secrets-manager');

describe('Security Services', () => {
  let jwtService: JWTService;
  let authMiddleware: AuthMiddleware;
  let auditLogger: AuditLogger;
  let securityConfig: SecurityConfigService;
  let dataRetention: DataRetentionService;

  beforeEach(() => {
    // Set up test environment variables
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-purposes-only';
    process.env.REFRESH_SECRET = 'test-refresh-secret-key-for-testing-purposes-only';
    process.env.TOKENS_TABLE_NAME = 'test-tokens-table';
    process.env.AUDIT_TABLE_NAME = 'test-audit-table';
    process.env.CONTENT_TABLE_NAME = 'test-content-table';
    process.env.AUDIO_BUCKET_NAME = 'test-audio-bucket';
    process.env.IMAGE_BUCKET_NAME = 'test-image-bucket';

    // Mock successful DynamoDB responses
    mockSend.mockResolvedValue({
      Item: { tokenId: 'test-token', userId: 'test-user' },
    });

    jwtService = new JWTService();
    authMiddleware = new AuthMiddleware();
    auditLogger = new AuditLogger();
    securityConfig = new SecurityConfigService();
    dataRetention = new DataRetentionService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('JWTService', () => {
    it('should generate valid access and refresh tokens', async () => {
      const userId = 'test-user-123';
      const email = 'test@example.com';

      const tokens = await jwtService.generateTokens(userId, email);

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.expiresIn).toBe(15 * 60); // 15 minutes
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
    });

    it('should verify valid access tokens', async () => {
      const userId = 'test-user-123';
      const email = 'test@example.com';

      const tokens = await jwtService.generateTokens(userId, email);
      const payload = await jwtService.verifyAccessToken(tokens.accessToken);

      expect(payload.userId).toBe(userId);
      expect(payload.email).toBe(email);
      expect(payload.jti).toBeDefined();
    });

    it('should reject invalid access tokens', async () => {
      const invalidToken = 'invalid.jwt.token';

      await expect(jwtService.verifyAccessToken(invalidToken))
        .rejects.toThrow('Invalid access token');
    });

    it('should reject expired tokens', async () => {
      // This would require mocking the JWT library to create expired tokens
      // For now, we'll test the error handling path
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwMDAwMDAsImp0aSI6InRlc3QifQ.invalid';

      await expect(jwtService.verifyAccessToken(expiredToken))
        .rejects.toThrow('Invalid access token');
    });
  });

  describe('AuthMiddleware', () => {
    const mockEvent: APIGatewayProxyEvent = {
      httpMethod: 'GET',
      path: '/api/test',
      headers: {},
      queryStringParameters: null,
      pathParameters: null,
      body: null,
      isBase64Encoded: false,
      requestContext: {
        accountId: 'test-account',
        apiId: 'test-api',
        httpMethod: 'GET',
        requestId: 'test-request',
        resourceId: 'test-resource',
        resourcePath: '/api/test',
        stage: 'test',
        path: '/api/test',
        identity: {
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
          accessKey: null,
          accountId: null,
          apiKey: null,
          apiKeyId: null,
          caller: null,
          cognitoAuthenticationProvider: null,
          cognitoAuthenticationType: null,
          cognitoIdentityId: null,
          cognitoIdentityPoolId: null,
          principalOrgId: null,
          user: null,
          userArn: null,
          clientCert: null,
        },
        authorizer: null,
        protocol: 'HTTP/1.1',
        requestTime: '01/Jan/2023:00:00:00 +0000',
        requestTimeEpoch: 1672531200,
      },
      resource: '/api/test',
      stageVariables: null,
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
    };

    const mockContext: Context = {
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'test-function',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
      memoryLimitInMB: '256',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/test-function',
      logStreamName: '2023/01/01/[$LATEST]test-stream',
      getRemainingTimeInMillis: () => 30000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    };

    it('should reject requests without authorization header', async () => {
      const handler = authMiddleware.authenticate(async (event) => {
        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'success' }),
        };
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toBe('Unauthorized');
    });

    it('should reject requests with invalid authorization header format', async () => {
      const eventWithInvalidAuth = {
        ...mockEvent,
        headers: {
          Authorization: 'InvalidFormat token123',
        },
      };

      const handler = authMiddleware.authenticate(async (event) => {
        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'success' }),
        };
      });

      const result = await handler(eventWithInvalidAuth, mockContext);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).message).toBe('Invalid authorization header format');
    });

    it('should allow optional authentication for public endpoints', async () => {
      const handler = authMiddleware.optionalAuthenticate(async (event) => {
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            message: 'success',
            authenticated: !!event.user,
          }),
        };
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).authenticated).toBe(false);
    });
  });

  describe('AuditLogger', () => {
    it('should log security events', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await auditLogger.logSecurityEvent({
        eventType: 'AUTHENTICATION_SUCCESS',
        userId: 'test-user',
        sourceIp: '127.0.0.1',
        path: '/api/test',
        method: 'GET',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Security Event:',
        expect.stringContaining('AUTHENTICATION_SUCCESS')
      );

      consoleSpy.mockRestore();
    });

    it('should log data access events', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await auditLogger.logDataAccess({
        eventType: 'DATA_ACCESS',
        userId: 'test-user',
        resourceType: 'content',
        resourceId: 'content-123',
        action: 'READ',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Data Access Event:',
        expect.stringContaining('DATA_ACCESS')
      );

      consoleSpy.mockRestore();
    });

    it('should log suspicious activity', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await auditLogger.logSuspiciousActivity({
        sourceIp: '192.168.1.100',
        activity: 'Multiple failed login attempts',
        riskScore: 7,
        userId: 'test-user',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Security Event:',
        expect.stringContaining('SUSPICIOUS_ACTIVITY')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('SecurityConfigService', () => {
    it('should validate passwords against policy', async () => {
      const weakPassword = 'weak';
      const strongPassword = 'StrongP@ssw0rd123!';

      const weakResult = securityConfig.validatePassword(weakPassword);
      const strongResult = securityConfig.validatePassword(strongPassword);

      expect(weakResult.isValid).toBe(false);
      expect(weakResult.errors.length).toBeGreaterThan(0);

      expect(strongResult.isValid).toBe(true);
      expect(strongResult.errors.length).toBe(0);
    });

    it('should check allowed origins', async () => {
      // Mock the getSecurityConfig method
      jest.spyOn(securityConfig, 'getSecurityConfig').mockResolvedValue({
        jwtSecret: 'test',
        refreshSecret: 'test',
        encryptionKey: 'test',
        corsOrigins: ['https://example.com', 'http://localhost:3000'],
        rateLimits: { authenticated: 1000, anonymous: 100, windowMinutes: 15 },
        passwordPolicy: {
          minLength: 12,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSymbols: true,
        },
        sessionConfig: {
          accessTokenExpiry: '15m',
          refreshTokenExpiry: '7d',
          maxConcurrentSessions: 5,
        },
      });

      const allowedOrigin = await securityConfig.isOriginAllowed('https://example.com');
      const disallowedOrigin = await securityConfig.isOriginAllowed('https://malicious.com');

      expect(allowedOrigin).toBe(true);
      expect(disallowedOrigin).toBe(false);
    });
  });

  describe('DataRetentionService', () => {
    it('should have default retention policies', () => {
      const contentPolicy = dataRetention.getRetentionPolicy('content');
      const audioPolicy = dataRetention.getRetentionPolicy('audio');

      expect(contentPolicy).toBeDefined();
      expect(contentPolicy?.retentionDays).toBe(365);

      expect(audioPolicy).toBeDefined();
      expect(audioPolicy?.retentionDays).toBe(7);
    });

    it('should update retention policies', () => {
      dataRetention.updateRetentionPolicy('content', 180);
      const updatedPolicy = dataRetention.getRetentionPolicy('content');

      expect(updatedPolicy?.retentionDays).toBe(180);
    });
  });
});

describe('Security Integration Tests', () => {
  it('should handle complete authentication flow', async () => {
    const jwtService = new JWTService();
    const userId = 'integration-test-user';
    const email = 'integration@example.com';

    // Generate tokens
    const tokens = await jwtService.generateTokens(userId, email);
    expect(tokens.accessToken).toBeDefined();

    // Verify access token
    const payload = await jwtService.verifyAccessToken(tokens.accessToken);
    expect(payload.userId).toBe(userId);
    expect(payload.email).toBe(email);

    // Refresh token
    const refreshed = await jwtService.refreshAccessToken(tokens.refreshToken);
    expect(refreshed.accessToken).toBeDefined();
    expect(refreshed.accessToken).not.toBe(tokens.accessToken);
  });

  it('should handle audit logging throughout security flow', async () => {
    const auditLogger = new AuditLogger();
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    // Log authentication
    await auditLogger.logSecurityEvent({
      eventType: 'AUTHENTICATION_SUCCESS',
      userId: 'test-user',
      sourceIp: '127.0.0.1',
    });

    // Log data access
    await auditLogger.logDataAccess({
      eventType: 'DATA_ACCESS',
      userId: 'test-user',
      resourceType: 'content',
      resourceId: 'content-123',
      action: 'READ',
    });

    // Log suspicious activity
    await auditLogger.logSuspiciousActivity({
      sourceIp: '192.168.1.100',
      activity: 'Rapid API calls',
      riskScore: 6,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(3);
    consoleSpy.mockRestore();
  });
});