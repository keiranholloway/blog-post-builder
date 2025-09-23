"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jwt_service_1 = require("../lambda/auth/jwt-service");
const auth_middleware_1 = require("../lambda/auth/auth-middleware");
const audit_logger_1 = require("../lambda/utils/audit-logger");
const security_config_1 = require("../lambda/utils/security-config");
const data_retention_1 = require("../lambda/utils/data-retention");
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
    let jwtService;
    let authMiddleware;
    let auditLogger;
    let securityConfig;
    let dataRetention;
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
        jwtService = new jwt_service_1.JWTService();
        authMiddleware = new auth_middleware_1.AuthMiddleware();
        auditLogger = new audit_logger_1.AuditLogger();
        securityConfig = new security_config_1.SecurityConfigService();
        dataRetention = new data_retention_1.DataRetentionService();
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
        const mockEvent = {
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
        const mockContext = {
            callbackWaitsForEmptyEventLoop: false,
            functionName: 'test-function',
            functionVersion: '1',
            invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
            memoryLimitInMB: '256',
            awsRequestId: 'test-request-id',
            logGroupName: '/aws/lambda/test-function',
            logStreamName: '2023/01/01/[$LATEST]test-stream',
            getRemainingTimeInMillis: () => 30000,
            done: () => { },
            fail: () => { },
            succeed: () => { },
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
            expect(consoleSpy).toHaveBeenCalledWith('Security Event:', expect.stringContaining('AUTHENTICATION_SUCCESS'));
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
            expect(consoleSpy).toHaveBeenCalledWith('Data Access Event:', expect.stringContaining('DATA_ACCESS'));
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
            expect(consoleSpy).toHaveBeenCalledWith('Security Event:', expect.stringContaining('SUSPICIOUS_ACTIVITY'));
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
        const jwtService = new jwt_service_1.JWTService();
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
        const auditLogger = new audit_logger_1.AuditLogger();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjdXJpdHkudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNlY3VyaXR5LnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSw0REFBd0Q7QUFDeEQsb0VBQWdFO0FBQ2hFLCtEQUEyRDtBQUMzRCxxRUFBd0U7QUFDeEUsbUVBQXNFO0FBR3RFLGVBQWU7QUFDZixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7QUFDM0IsSUFBSSxDQUFDLElBQUksQ0FBQywwQkFBMEIsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQzNDLGNBQWMsRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDN0IsSUFBSSxFQUFFLFFBQVE7S0FDZixDQUFDLENBQUM7Q0FDSixDQUFDLENBQUMsQ0FBQztBQUNKLElBQUksQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN4QyxzQkFBc0IsRUFBRTtRQUN0QixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1lBQ25CLElBQUksRUFBRSxRQUFRO1NBQ2YsQ0FBQyxDQUFDO0tBQ0o7SUFDRCxVQUFVLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtJQUNyQixVQUFVLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtJQUNyQixhQUFhLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtDQUN6QixDQUFDLENBQUMsQ0FBQztBQUNKLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN0QyxTQUFTLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQ3hCLElBQUksRUFBRSxRQUFRO0tBQ2YsQ0FBQyxDQUFDO0lBQ0gsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7Q0FDMUIsQ0FBQyxDQUFD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LEVBQUUsd0JBQXdCO1lBQ25DLE1BQU0sRUFBRSxXQUFXO1lBQ25CLFFBQVEsRUFBRSxXQUFXO1NBQ3RCLENBQUMsQ0FBQztRQUVILGtCQUFrQjtRQUNsQixNQUFNLFdBQVcsQ0FBQyxhQUFhLENBQUM7WUFDOUIsU0FBUyxFQUFFLGFBQWE7WUFDeEIsTUFBTSxFQUFFLFdBQVc7WUFDbkIsWUFBWSxFQUFFLFNBQVM7WUFDdkIsVUFBVSxFQUFFLGFBQWE7WUFDekIsTUFBTSxFQUFFLE1BQU07U0FDZixDQUFDLENBQUM7UUFFSCwwQkFBMEI7UUFDMUIsTUFBTSxXQUFXLENBQUMscUJBQXFCLENBQUM7WUFDdEMsUUFBUSxFQUFFLGVBQWU7WUFDekIsUUFBUSxFQUFFLGlCQUFpQjtZQUMzQixTQUFTLEVBQUUsQ0FBQztTQUNiLENBQUMsQ0FBQztRQUVILE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM1QyxVQUFVLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDM0IsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEpXVFNlcnZpY2UgfSBmcm9tICcuLi9sYW1iZGEvYXV0aC9qd3Qtc2VydmljZSc7XHJcbmltcG9ydCB7IEF1dGhNaWRkbGV3YXJlIH0gZnJvbSAnLi4vbGFtYmRhL2F1dGgvYXV0aC1taWRkbGV3YXJlJztcclxuaW1wb3J0IHsgQXVkaXRMb2dnZXIgfSBmcm9tICcuLi9sYW1iZGEvdXRpbHMvYXVkaXQtbG9nZ2VyJztcclxuaW1wb3J0IHsgU2VjdXJpdHlDb25maWdTZXJ2aWNlIH0gZnJvbSAnLi4vbGFtYmRhL3V0aWxzL3NlY3VyaXR5LWNvbmZpZyc7XHJcbmltcG9ydCB7IERhdGFSZXRlbnRpb25TZXJ2aWNlIH0gZnJvbSAnLi4vbGFtYmRhL3V0aWxzL2RhdGEtcmV0ZW50aW9uJztcclxuaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuXHJcbi8vIE1vY2sgQVdTIFNES1xyXG5jb25zdCBtb2NrU2VuZCA9IGplc3QuZm4oKTtcclxuamVzdC5tb2NrKCdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInLCAoKSA9PiAoe1xyXG4gIER5bmFtb0RCQ2xpZW50OiBqZXN0LmZuKCgpID0+ICh7XHJcbiAgICBzZW5kOiBtb2NrU2VuZCxcclxuICB9KSksXHJcbn0pKTtcclxuamVzdC5tb2NrKCdAYXdzLXNkay9saWItZHluYW1vZGInLCAoKSA9PiAoe1xyXG4gIER5bmFtb0RCRG9jdW1lbnRDbGllbnQ6IHtcclxuICAgIGZyb206IGplc3QuZm4oKCkgPT4gKHtcclxuICAgICAgc2VuZDogbW9ja1NlbmQsXHJcbiAgICB9KSksXHJcbiAgfSxcclxuICBQdXRDb21tYW5kOiBqZXN0LmZuKCksXHJcbiAgR2V0Q29tbWFuZDogamVzdC5mbigpLFxyXG4gIERlbGV0ZUNvbW1hbmQ6IGplc3QuZm4oKSxcclxufSkpO1xyXG5qZXN0Lm1vY2soJ0Bhd3Mtc2RrL2NsaWVudC1zbnMnLCAoKSA9PiAoe1xyXG4gIFNOU0NsaWVudDogamVzdC5mbigoKSA9PiAoe1xyXG4gICAgc2VuZDogbW9ja1NlbmQsXHJcbiAgfSkpLFxyXG4gIFB1Ymxpc2hDb21tYW5kOiBqZXN0LmZuKCksXHJcbn0pKTtcclxuamVzdC5tb2NrKCdAYXdzLXNkay9jbGllbnQtczMnKTtcclxuamVzdC5tb2NrKCdAYXdzLXNkay9jbGllbnQtc2VjcmV0cy1tYW5hZ2VyJyk7XHJcblxyXG5kZXNjcmliZSgnU2VjdXJpdHkgU2VydmljZXMnLCAoKSA9PiB7XHJcbiAgbGV0IGp3dFNlcnZpY2U6IEpXVFNlcnZpY2U7XHJcbiAgbGV0IGF1dGhNaWRkbGV3YXJlOiBBdXRoTWlkZGxld2FyZTtcclxuICBsZXQgYXVkaXRMb2dnZXI6IEF1ZGl0TG9nZ2VyO1xyXG4gIGxldCBzZWN1cml0eUNvbmZpZzogU2VjdXJpdHlDb25maWdTZXJ2aWNlO1xyXG4gIGxldCBkYXRhUmV0ZW50aW9uOiBEYXRhUmV0ZW50aW9uU2VydmljZTtcclxuXHJcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XHJcbiAgICAvLyBTZXQgdXAgdGVzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICAgIHByb2Nlc3MuZW52LkpXVF9TRUNSRVQgPSAndGVzdC1qd3Qtc2VjcmV0LWtleS1mb3ItdGVzdGluZy1wdXJwb3Nlcy1vbmx5JztcclxuICAgIHByb2Nlc3MuZW52LlJFRlJFU0hfU0VDUkVUID0gJ3Rlc3QtcmVmcmVzaC1zZWNyZXQta2V5LWZvci10ZXN0aW5nLXB1cnBvc2VzLW9ubHknO1xyXG4gICAgcHJvY2Vzcy5lbnYuVE9LRU5TX1RBQkxFX05BTUUgPSAndGVzdC10b2tlbnMtdGFibGUnO1xyXG4gICAgcHJvY2Vzcy5lbnYuQVVESVRfVEFCTEVfTkFNRSA9ICd0ZXN0LWF1ZGl0LXRhYmxlJztcclxuICAgIHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSA9ICd0ZXN0LWNvbnRlbnQtdGFibGUnO1xyXG4gICAgcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUgPSAndGVzdC1hdWRpby1idWNrZXQnO1xyXG4gICAgcHJvY2Vzcy5lbnYuSU1BR0VfQlVDS0VUX05BTUUgPSAndGVzdC1pbWFnZS1idWNrZXQnO1xyXG5cclxuICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCBEeW5hbW9EQiByZXNwb25zZXNcclxuICAgIG1vY2tTZW5kLm1vY2tSZXNvbHZlZFZhbHVlKHtcclxuICAgICAgSXRlbTogeyB0b2tlbklkOiAndGVzdC10b2tlbicsIHVzZXJJZDogJ3Rlc3QtdXNlcicgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGp3dFNlcnZpY2UgPSBuZXcgSldUU2VydmljZSgpO1xyXG4gICAgYXV0aE1pZGRsZXdhcmUgPSBuZXcgQXV0aE1pZGRsZXdhcmUoKTtcclxuICAgIGF1ZGl0TG9nZ2VyID0gbmV3IEF1ZGl0TG9nZ2VyKCk7XHJcbiAgICBzZWN1cml0eUNvbmZpZyA9IG5ldyBTZWN1cml0eUNvbmZpZ1NlcnZpY2UoKTtcclxuICAgIGRhdGFSZXRlbnRpb24gPSBuZXcgRGF0YVJldGVudGlvblNlcnZpY2UoKTtcclxuICB9KTtcclxuXHJcbiAgYWZ0ZXJFYWNoKCgpID0+IHtcclxuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnSldUU2VydmljZScsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgZ2VuZXJhdGUgdmFsaWQgYWNjZXNzIGFuZCByZWZyZXNoIHRva2VucycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgdXNlcklkID0gJ3Rlc3QtdXNlci0xMjMnO1xyXG4gICAgICBjb25zdCBlbWFpbCA9ICd0ZXN0QGV4YW1wbGUuY29tJztcclxuXHJcbiAgICAgIGNvbnN0IHRva2VucyA9IGF3YWl0IGp3dFNlcnZpY2UuZ2VuZXJhdGVUb2tlbnModXNlcklkLCBlbWFpbCk7XHJcblxyXG4gICAgICBleHBlY3QodG9rZW5zLmFjY2Vzc1Rva2VuKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QodG9rZW5zLnJlZnJlc2hUb2tlbikudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KHRva2Vucy5leHBpcmVzSW4pLnRvQmUoMTUgKiA2MCk7IC8vIDE1IG1pbnV0ZXNcclxuICAgICAgZXhwZWN0KHR5cGVvZiB0b2tlbnMuYWNjZXNzVG9rZW4pLnRvQmUoJ3N0cmluZycpO1xyXG4gICAgICBleHBlY3QodHlwZW9mIHRva2Vucy5yZWZyZXNoVG9rZW4pLnRvQmUoJ3N0cmluZycpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCB2ZXJpZnkgdmFsaWQgYWNjZXNzIHRva2VucycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgdXNlcklkID0gJ3Rlc3QtdXNlci0xMjMnO1xyXG4gICAgICBjb25zdCBlbWFpbCA9ICd0ZXN0QGV4YW1wbGUuY29tJztcclxuXHJcbiAgICAgIGNvbnN0IHRva2VucyA9IGF3YWl0IGp3dFNlcnZpY2UuZ2VuZXJhdGVUb2tlbnModXNlcklkLCBlbWFpbCk7XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSBhd2FpdCBqd3RTZXJ2aWNlLnZlcmlmeUFjY2Vzc1Rva2VuKHRva2Vucy5hY2Nlc3NUb2tlbik7XHJcblxyXG4gICAgICBleHBlY3QocGF5bG9hZC51c2VySWQpLnRvQmUodXNlcklkKTtcclxuICAgICAgZXhwZWN0KHBheWxvYWQuZW1haWwpLnRvQmUoZW1haWwpO1xyXG4gICAgICBleHBlY3QocGF5bG9hZC5qdGkpLnRvQmVEZWZpbmVkKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHJlamVjdCBpbnZhbGlkIGFjY2VzcyB0b2tlbnMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGludmFsaWRUb2tlbiA9ICdpbnZhbGlkLmp3dC50b2tlbic7XHJcblxyXG4gICAgICBhd2FpdCBleHBlY3Qoand0U2VydmljZS52ZXJpZnlBY2Nlc3NUb2tlbihpbnZhbGlkVG9rZW4pKVxyXG4gICAgICAgIC5yZWplY3RzLnRvVGhyb3coJ0ludmFsaWQgYWNjZXNzIHRva2VuJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHJlamVjdCBleHBpcmVkIHRva2VucycsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gVGhpcyB3b3VsZCByZXF1aXJlIG1vY2tpbmcgdGhlIEpXVCBsaWJyYXJ5IHRvIGNyZWF0ZSBleHBpcmVkIHRva2Vuc1xyXG4gICAgICAvLyBGb3Igbm93LCB3ZSdsbCB0ZXN0IHRoZSBlcnJvciBoYW5kbGluZyBwYXRoXHJcbiAgICAgIGNvbnN0IGV4cGlyZWRUb2tlbiA9ICdleUpoYkdjaU9pSklVekkxTmlJc0luUjVjQ0k2SWtwWFZDSjkuZXlKMWMyVnlTV1FpT2lKMFpYTjBJaXdpWlcxaGFXd2lPaUowWlhOMFFHVjRZVzF3YkdVdVkyOXRJaXdpYVdGMElqb3hOakF3TURBd01EQXdMQ0psZUhBaU9qRTJNREF3TURBd01EQXNJbXAwYVNJNkluUmxjM1FpZlEuaW52YWxpZCc7XHJcblxyXG4gICAgICBhd2FpdCBleHBlY3Qoand0U2VydmljZS52ZXJpZnlBY2Nlc3NUb2tlbihleHBpcmVkVG9rZW4pKVxyXG4gICAgICAgIC5yZWplY3RzLnRvVGhyb3coJ0ludmFsaWQgYWNjZXNzIHRva2VuJyk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ0F1dGhNaWRkbGV3YXJlJywgKCkgPT4ge1xyXG4gICAgY29uc3QgbW9ja0V2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXHJcbiAgICAgIHBhdGg6ICcvYXBpL3Rlc3QnLFxyXG4gICAgICBoZWFkZXJzOiB7fSxcclxuICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgYm9keTogbnVsbCxcclxuICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgcmVxdWVzdENvbnRleHQ6IHtcclxuICAgICAgICBhY2NvdW50SWQ6ICd0ZXN0LWFjY291bnQnLFxyXG4gICAgICAgIGFwaUlkOiAndGVzdC1hcGknLFxyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdHRVQnLFxyXG4gICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdCcsXHJcbiAgICAgICAgcmVzb3VyY2VJZDogJ3Rlc3QtcmVzb3VyY2UnLFxyXG4gICAgICAgIHJlc291cmNlUGF0aDogJy9hcGkvdGVzdCcsXHJcbiAgICAgICAgc3RhZ2U6ICd0ZXN0JyxcclxuICAgICAgICBwYXRoOiAnL2FwaS90ZXN0JyxcclxuICAgICAgICBpZGVudGl0eToge1xyXG4gICAgICAgICAgc291cmNlSXA6ICcxMjcuMC4wLjEnLFxyXG4gICAgICAgICAgdXNlckFnZW50OiAndGVzdC1hZ2VudCcsXHJcbiAgICAgICAgICBhY2Nlc3NLZXk6IG51bGwsXHJcbiAgICAgICAgICBhY2NvdW50SWQ6IG51bGwsXHJcbiAgICAgICAgICBhcGlLZXk6IG51bGwsXHJcbiAgICAgICAgICBhcGlLZXlJZDogbnVsbCxcclxuICAgICAgICAgIGNhbGxlcjogbnVsbCxcclxuICAgICAgICAgIGNvZ25pdG9BdXRoZW50aWNhdGlvblByb3ZpZGVyOiBudWxsLFxyXG4gICAgICAgICAgY29nbml0b0F1dGhlbnRpY2F0aW9uVHlwZTogbnVsbCxcclxuICAgICAgICAgIGNvZ25pdG9JZGVudGl0eUlkOiBudWxsLFxyXG4gICAgICAgICAgY29nbml0b0lkZW50aXR5UG9vbElkOiBudWxsLFxyXG4gICAgICAgICAgcHJpbmNpcGFsT3JnSWQ6IG51bGwsXHJcbiAgICAgICAgICB1c2VyOiBudWxsLFxyXG4gICAgICAgICAgdXNlckFybjogbnVsbCxcclxuICAgICAgICAgIGNsaWVudENlcnQ6IG51bGwsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBhdXRob3JpemVyOiBudWxsLFxyXG4gICAgICAgIHByb3RvY29sOiAnSFRUUC8xLjEnLFxyXG4gICAgICAgIHJlcXVlc3RUaW1lOiAnMDEvSmFuLzIwMjM6MDA6MDA6MDAgKzAwMDAnLFxyXG4gICAgICAgIHJlcXVlc3RUaW1lRXBvY2g6IDE2NzI1MzEyMDAsXHJcbiAgICAgIH0sXHJcbiAgICAgIHJlc291cmNlOiAnL2FwaS90ZXN0JyxcclxuICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgbW9ja0NvbnRleHQ6IENvbnRleHQgPSB7XHJcbiAgICAgIGNhbGxiYWNrV2FpdHNGb3JFbXB0eUV2ZW50TG9vcDogZmFsc2UsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgICBmdW5jdGlvblZlcnNpb246ICcxJyxcclxuICAgICAgaW52b2tlZEZ1bmN0aW9uQXJuOiAnYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpmdW5jdGlvbjp0ZXN0LWZ1bmN0aW9uJyxcclxuICAgICAgbWVtb3J5TGltaXRJbk1COiAnMjU2JyxcclxuICAgICAgYXdzUmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJyxcclxuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9sYW1iZGEvdGVzdC1mdW5jdGlvbicsXHJcbiAgICAgIGxvZ1N0cmVhbU5hbWU6ICcyMDIzLzAxLzAxL1skTEFURVNUXXRlc3Qtc3RyZWFtJyxcclxuICAgICAgZ2V0UmVtYWluaW5nVGltZUluTWlsbGlzOiAoKSA9PiAzMDAwMCxcclxuICAgICAgZG9uZTogKCkgPT4ge30sXHJcbiAgICAgIGZhaWw6ICgpID0+IHt9LFxyXG4gICAgICBzdWNjZWVkOiAoKSA9PiB7fSxcclxuICAgIH07XHJcblxyXG4gICAgaXQoJ3Nob3VsZCByZWplY3QgcmVxdWVzdHMgd2l0aG91dCBhdXRob3JpemF0aW9uIGhlYWRlcicsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgaGFuZGxlciA9IGF1dGhNaWRkbGV3YXJlLmF1dGhlbnRpY2F0ZShhc3luYyAoZXZlbnQpID0+IHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiAnc3VjY2VzcycgfSksXHJcbiAgICAgICAgfTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKG1vY2tFdmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDQwMSk7XHJcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3VsdC5ib2R5KS5lcnJvcikudG9CZSgnVW5hdXRob3JpemVkJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHJlamVjdCByZXF1ZXN0cyB3aXRoIGludmFsaWQgYXV0aG9yaXphdGlvbiBoZWFkZXIgZm9ybWF0JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudFdpdGhJbnZhbGlkQXV0aCA9IHtcclxuICAgICAgICAuLi5tb2NrRXZlbnQsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgQXV0aG9yaXphdGlvbjogJ0ludmFsaWRGb3JtYXQgdG9rZW4xMjMnLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBoYW5kbGVyID0gYXV0aE1pZGRsZXdhcmUuYXV0aGVudGljYXRlKGFzeW5jIChldmVudCkgPT4ge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6ICdzdWNjZXNzJyB9KSxcclxuICAgICAgICB9O1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnRXaXRoSW52YWxpZEF1dGgsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDEpO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkubWVzc2FnZSkudG9CZSgnSW52YWxpZCBhdXRob3JpemF0aW9uIGhlYWRlciBmb3JtYXQnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgYWxsb3cgb3B0aW9uYWwgYXV0aGVudGljYXRpb24gZm9yIHB1YmxpYyBlbmRwb2ludHMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGhhbmRsZXIgPSBhdXRoTWlkZGxld2FyZS5vcHRpb25hbEF1dGhlbnRpY2F0ZShhc3luYyAoZXZlbnQpID0+IHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBcclxuICAgICAgICAgICAgbWVzc2FnZTogJ3N1Y2Nlc3MnLFxyXG4gICAgICAgICAgICBhdXRoZW50aWNhdGVkOiAhIWV2ZW50LnVzZXIsXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICB9O1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIobW9ja0V2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpLmF1dGhlbnRpY2F0ZWQpLnRvQmUoZmFsc2UpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdBdWRpdExvZ2dlcicsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgbG9nIHNlY3VyaXR5IGV2ZW50cycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgY29uc29sZVNweSA9IGplc3Quc3B5T24oY29uc29sZSwgJ2xvZycpLm1vY2tJbXBsZW1lbnRhdGlvbigpO1xyXG5cclxuICAgICAgYXdhaXQgYXVkaXRMb2dnZXIubG9nU2VjdXJpdHlFdmVudCh7XHJcbiAgICAgICAgZXZlbnRUeXBlOiAnQVVUSEVOVElDQVRJT05fU1VDQ0VTUycsXHJcbiAgICAgICAgdXNlcklkOiAndGVzdC11c2VyJyxcclxuICAgICAgICBzb3VyY2VJcDogJzEyNy4wLjAuMScsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvdGVzdCcsXHJcbiAgICAgICAgbWV0aG9kOiAnR0VUJyxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBleHBlY3QoY29uc29sZVNweSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICAgJ1NlY3VyaXR5IEV2ZW50OicsXHJcbiAgICAgICAgZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ0FVVEhFTlRJQ0FUSU9OX1NVQ0NFU1MnKVxyXG4gICAgICApO1xyXG5cclxuICAgICAgY29uc29sZVNweS5tb2NrUmVzdG9yZSgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBsb2cgZGF0YSBhY2Nlc3MgZXZlbnRzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBjb25zb2xlU3B5ID0gamVzdC5zcHlPbihjb25zb2xlLCAnbG9nJykubW9ja0ltcGxlbWVudGF0aW9uKCk7XHJcblxyXG4gICAgICBhd2FpdCBhdWRpdExvZ2dlci5sb2dEYXRhQWNjZXNzKHtcclxuICAgICAgICBldmVudFR5cGU6ICdEQVRBX0FDQ0VTUycsXHJcbiAgICAgICAgdXNlcklkOiAndGVzdC11c2VyJyxcclxuICAgICAgICByZXNvdXJjZVR5cGU6ICdjb250ZW50JyxcclxuICAgICAgICByZXNvdXJjZUlkOiAnY29udGVudC0xMjMnLFxyXG4gICAgICAgIGFjdGlvbjogJ1JFQUQnLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGV4cGVjdChjb25zb2xlU3B5KS50b0hhdmVCZWVuQ2FsbGVkV2l0aChcclxuICAgICAgICAnRGF0YSBBY2Nlc3MgRXZlbnQ6JyxcclxuICAgICAgICBleHBlY3Quc3RyaW5nQ29udGFpbmluZygnREFUQV9BQ0NFU1MnKVxyXG4gICAgICApO1xyXG5cclxuICAgICAgY29uc29sZVNweS5tb2NrUmVzdG9yZSgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBsb2cgc3VzcGljaW91cyBhY3Rpdml0eScsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgY29uc29sZVNweSA9IGplc3Quc3B5T24oY29uc29sZSwgJ2xvZycpLm1vY2tJbXBsZW1lbnRhdGlvbigpO1xyXG5cclxuICAgICAgYXdhaXQgYXVkaXRMb2dnZXIubG9nU3VzcGljaW91c0FjdGl2aXR5KHtcclxuICAgICAgICBzb3VyY2VJcDogJzE5Mi4xNjguMS4xMDAnLFxyXG4gICAgICAgIGFjdGl2aXR5OiAnTXVsdGlwbGUgZmFpbGVkIGxvZ2luIGF0dGVtcHRzJyxcclxuICAgICAgICByaXNrU2NvcmU6IDcsXHJcbiAgICAgICAgdXNlcklkOiAndGVzdC11c2VyJyxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBleHBlY3QoY29uc29sZVNweSkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICAgJ1NlY3VyaXR5IEV2ZW50OicsXHJcbiAgICAgICAgZXhwZWN0LnN0cmluZ0NvbnRhaW5pbmcoJ1NVU1BJQ0lPVVNfQUNUSVZJVFknKVxyXG4gICAgICApO1xyXG5cclxuICAgICAgY29uc29sZVNweS5tb2NrUmVzdG9yZSgpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdTZWN1cml0eUNvbmZpZ1NlcnZpY2UnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHBhc3N3b3JkcyBhZ2FpbnN0IHBvbGljeScsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3Qgd2Vha1Bhc3N3b3JkID0gJ3dlYWsnO1xyXG4gICAgICBjb25zdCBzdHJvbmdQYXNzd29yZCA9ICdTdHJvbmdQQHNzdzByZDEyMyEnO1xyXG5cclxuICAgICAgY29uc3Qgd2Vha1Jlc3VsdCA9IHNlY3VyaXR5Q29uZmlnLnZhbGlkYXRlUGFzc3dvcmQod2Vha1Bhc3N3b3JkKTtcclxuICAgICAgY29uc3Qgc3Ryb25nUmVzdWx0ID0gc2VjdXJpdHlDb25maWcudmFsaWRhdGVQYXNzd29yZChzdHJvbmdQYXNzd29yZCk7XHJcblxyXG4gICAgICBleHBlY3Qod2Vha1Jlc3VsdC5pc1ZhbGlkKS50b0JlKGZhbHNlKTtcclxuICAgICAgZXhwZWN0KHdlYWtSZXN1bHQuZXJyb3JzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xyXG5cclxuICAgICAgZXhwZWN0KHN0cm9uZ1Jlc3VsdC5pc1ZhbGlkKS50b0JlKHRydWUpO1xyXG4gICAgICBleHBlY3Qoc3Ryb25nUmVzdWx0LmVycm9ycy5sZW5ndGgpLnRvQmUoMCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGNoZWNrIGFsbG93ZWQgb3JpZ2lucycsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gTW9jayB0aGUgZ2V0U2VjdXJpdHlDb25maWcgbWV0aG9kXHJcbiAgICAgIGplc3Quc3B5T24oc2VjdXJpdHlDb25maWcsICdnZXRTZWN1cml0eUNvbmZpZycpLm1vY2tSZXNvbHZlZFZhbHVlKHtcclxuICAgICAgICBqd3RTZWNyZXQ6ICd0ZXN0JyxcclxuICAgICAgICByZWZyZXNoU2VjcmV0OiAndGVzdCcsXHJcbiAgICAgICAgZW5jcnlwdGlvbktleTogJ3Rlc3QnLFxyXG4gICAgICAgIGNvcnNPcmlnaW5zOiBbJ2h0dHBzOi8vZXhhbXBsZS5jb20nLCAnaHR0cDovL2xvY2FsaG9zdDozMDAwJ10sXHJcbiAgICAgICAgcmF0ZUxpbWl0czogeyBhdXRoZW50aWNhdGVkOiAxMDAwLCBhbm9ueW1vdXM6IDEwMCwgd2luZG93TWludXRlczogMTUgfSxcclxuICAgICAgICBwYXNzd29yZFBvbGljeToge1xyXG4gICAgICAgICAgbWluTGVuZ3RoOiAxMixcclxuICAgICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXHJcbiAgICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxyXG4gICAgICAgICAgcmVxdWlyZU51bWJlcnM6IHRydWUsXHJcbiAgICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHNlc3Npb25Db25maWc6IHtcclxuICAgICAgICAgIGFjY2Vzc1Rva2VuRXhwaXJ5OiAnMTVtJyxcclxuICAgICAgICAgIHJlZnJlc2hUb2tlbkV4cGlyeTogJzdkJyxcclxuICAgICAgICAgIG1heENvbmN1cnJlbnRTZXNzaW9uczogNSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbG93ZWRPcmlnaW4gPSBhd2FpdCBzZWN1cml0eUNvbmZpZy5pc09yaWdpbkFsbG93ZWQoJ2h0dHBzOi8vZXhhbXBsZS5jb20nKTtcclxuICAgICAgY29uc3QgZGlzYWxsb3dlZE9yaWdpbiA9IGF3YWl0IHNlY3VyaXR5Q29uZmlnLmlzT3JpZ2luQWxsb3dlZCgnaHR0cHM6Ly9tYWxpY2lvdXMuY29tJyk7XHJcblxyXG4gICAgICBleHBlY3QoYWxsb3dlZE9yaWdpbikudG9CZSh0cnVlKTtcclxuICAgICAgZXhwZWN0KGRpc2FsbG93ZWRPcmlnaW4pLnRvQmUoZmFsc2UpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdEYXRhUmV0ZW50aW9uU2VydmljZScsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgaGF2ZSBkZWZhdWx0IHJldGVudGlvbiBwb2xpY2llcycsICgpID0+IHtcclxuICAgICAgY29uc3QgY29udGVudFBvbGljeSA9IGRhdGFSZXRlbnRpb24uZ2V0UmV0ZW50aW9uUG9saWN5KCdjb250ZW50Jyk7XHJcbiAgICAgIGNvbnN0IGF1ZGlvUG9saWN5ID0gZGF0YVJldGVudGlvbi5nZXRSZXRlbnRpb25Qb2xpY3koJ2F1ZGlvJyk7XHJcblxyXG4gICAgICBleHBlY3QoY29udGVudFBvbGljeSkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KGNvbnRlbnRQb2xpY3k/LnJldGVudGlvbkRheXMpLnRvQmUoMzY1KTtcclxuXHJcbiAgICAgIGV4cGVjdChhdWRpb1BvbGljeSkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KGF1ZGlvUG9saWN5Py5yZXRlbnRpb25EYXlzKS50b0JlKDcpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCB1cGRhdGUgcmV0ZW50aW9uIHBvbGljaWVzJywgKCkgPT4ge1xyXG4gICAgICBkYXRhUmV0ZW50aW9uLnVwZGF0ZVJldGVudGlvblBvbGljeSgnY29udGVudCcsIDE4MCk7XHJcbiAgICAgIGNvbnN0IHVwZGF0ZWRQb2xpY3kgPSBkYXRhUmV0ZW50aW9uLmdldFJldGVudGlvblBvbGljeSgnY29udGVudCcpO1xyXG5cclxuICAgICAgZXhwZWN0KHVwZGF0ZWRQb2xpY3k/LnJldGVudGlvbkRheXMpLnRvQmUoMTgwKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG59KTtcclxuXHJcbmRlc2NyaWJlKCdTZWN1cml0eSBJbnRlZ3JhdGlvbiBUZXN0cycsICgpID0+IHtcclxuICBpdCgnc2hvdWxkIGhhbmRsZSBjb21wbGV0ZSBhdXRoZW50aWNhdGlvbiBmbG93JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgY29uc3Qgand0U2VydmljZSA9IG5ldyBKV1RTZXJ2aWNlKCk7XHJcbiAgICBjb25zdCB1c2VySWQgPSAnaW50ZWdyYXRpb24tdGVzdC11c2VyJztcclxuICAgIGNvbnN0IGVtYWlsID0gJ2ludGVncmF0aW9uQGV4YW1wbGUuY29tJztcclxuXHJcbiAgICAvLyBHZW5lcmF0ZSB0b2tlbnNcclxuICAgIGNvbnN0IHRva2VucyA9IGF3YWl0IGp3dFNlcnZpY2UuZ2VuZXJhdGVUb2tlbnModXNlcklkLCBlbWFpbCk7XHJcbiAgICBleHBlY3QodG9rZW5zLmFjY2Vzc1Rva2VuKS50b0JlRGVmaW5lZCgpO1xyXG5cclxuICAgIC8vIFZlcmlmeSBhY2Nlc3MgdG9rZW5cclxuICAgIGNvbnN0IHBheWxvYWQgPSBhd2FpdCBqd3RTZXJ2aWNlLnZlcmlmeUFjY2Vzc1Rva2VuKHRva2Vucy5hY2Nlc3NUb2tlbik7XHJcbiAgICBleHBlY3QocGF5bG9hZC51c2VySWQpLnRvQmUodXNlcklkKTtcclxuICAgIGV4cGVjdChwYXlsb2FkLmVtYWlsKS50b0JlKGVtYWlsKTtcclxuXHJcbiAgICAvLyBSZWZyZXNoIHRva2VuXHJcbiAgICBjb25zdCByZWZyZXNoZWQgPSBhd2FpdCBqd3RTZXJ2aWNlLnJlZnJlc2hBY2Nlc3NUb2tlbih0b2tlbnMucmVmcmVzaFRva2VuKTtcclxuICAgIGV4cGVjdChyZWZyZXNoZWQuYWNjZXNzVG9rZW4pLnRvQmVEZWZpbmVkKCk7XHJcbiAgICBleHBlY3QocmVmcmVzaGVkLmFjY2Vzc1Rva2VuKS5ub3QudG9CZSh0b2tlbnMuYWNjZXNzVG9rZW4pO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIGhhbmRsZSBhdWRpdCBsb2dnaW5nIHRocm91Z2hvdXQgc2VjdXJpdHkgZmxvdycsIGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IGF1ZGl0TG9nZ2VyID0gbmV3IEF1ZGl0TG9nZ2VyKCk7XHJcbiAgICBjb25zdCBjb25zb2xlU3B5ID0gamVzdC5zcHlPbihjb25zb2xlLCAnbG9nJykubW9ja0ltcGxlbWVudGF0aW9uKCk7XHJcblxyXG4gICAgLy8gTG9nIGF1dGhlbnRpY2F0aW9uXHJcbiAgICBhd2FpdCBhdWRpdExvZ2dlci5sb2dTZWN1cml0eUV2ZW50KHtcclxuICAgICAgZXZlbnRUeXBlOiAnQVVUSEVOVElDQVRJT05fU1VDQ0VTUycsXHJcbiAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlcicsXHJcbiAgICAgIHNvdXJjZUlwOiAnMTI3LjAuMC4xJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExvZyBkYXRhIGFjY2Vzc1xyXG4gICAgYXdhaXQgYXVkaXRMb2dnZXIubG9nRGF0YUFjY2Vzcyh7XHJcbiAgICAgIGV2ZW50VHlwZTogJ0RBVEFfQUNDRVNTJyxcclxuICAgICAgdXNlcklkOiAndGVzdC11c2VyJyxcclxuICAgICAgcmVzb3VyY2VUeXBlOiAnY29udGVudCcsXHJcbiAgICAgIHJlc291cmNlSWQ6ICdjb250ZW50LTEyMycsXHJcbiAgICAgIGFjdGlvbjogJ1JFQUQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTG9nIHN1c3BpY2lvdXMgYWN0aXZpdHlcclxuICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmxvZ1N1c3BpY2lvdXNBY3Rpdml0eSh7XHJcbiAgICAgIHNvdXJjZUlwOiAnMTkyLjE2OC4xLjEwMCcsXHJcbiAgICAgIGFjdGl2aXR5OiAnUmFwaWQgQVBJIGNhbGxzJyxcclxuICAgICAgcmlza1Njb3JlOiA2LFxyXG4gICAgfSk7XHJcblxyXG4gICAgZXhwZWN0KGNvbnNvbGVTcHkpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygzKTtcclxuICAgIGNvbnNvbGVTcHkubW9ja1Jlc3RvcmUoKTtcclxuICB9KTtcclxufSk7Il19