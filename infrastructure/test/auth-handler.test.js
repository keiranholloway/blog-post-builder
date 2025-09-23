"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_handler_1 = require("../lambda/auth-handler");
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
global.fetch = jest.fn();
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
    const createMockEvent = (path, method, body) => ({
        path,
        httpMethod: method,
        body: body ? JSON.stringify(body) : null,
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {},
        resource: '',
        isBase64Encoded: false
    });
    describe('OPTIONS requests', () => {
        it('should handle CORS preflight requests', async () => {
            const event = createMockEvent('/auth/exchange', 'OPTIONS');
            const result = await (0, auth_handler_1.handler)(event);
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
            global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
                access_token: 'test-access-token',
                refresh_token: 'test-refresh-token',
                expires_in: 3600,
                token_type: 'Bearer',
                scope: 'basicProfile publishPost'
            }), { status: 200 }));
            // Mock successful secret storage
            mockSecretsSend.mockResolvedValueOnce({});
            // Mock successful DynamoDB put
            mockDynamoSend.mockResolvedValueOnce({});
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
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
            global.fetch.mockResolvedValueOnce(new Response('Invalid authorization code', { status: 400 }));
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
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
            global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
                access_token: 'new-access-token',
                refresh_token: 'new-refresh-token',
                expires_in: 3600,
                token_type: 'Bearer'
            }), { status: 200 }));
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
            expect(result.statusCode).toBe(400);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.error).toBe('No refresh token available');
        });
    });
    describe('Error Handling', () => {
        it('should handle unknown routes', async () => {
            const event = createMockEvent('/auth/unknown', 'GET');
            const result = await (0, auth_handler_1.handler)(event);
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
            const result = await (0, auth_handler_1.handler)(event);
            expect(result.statusCode).toBe(500);
            const responseBody = JSON.parse(result.body);
            expect(responseBody.error).toBe('Internal server error');
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1oYW5kbGVyLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhdXRoLWhhbmRsZXIudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUNBLHlEQUFpRDtBQUVqRCxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUM7QUFDakMsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO0FBRWxDLHVCQUF1QjtBQUN2QixJQUFJLENBQUMsSUFBSSxDQUFDLDBCQUEwQixFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDM0MsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztDQUNwQyxDQUFDLENBQUMsQ0FBQztBQUVKLElBQUksQ0FBQyxJQUFJLENBQUMsdUJBQXVCLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN4QyxzQkFBc0IsRUFBRTtRQUN0QixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1lBQ25CLElBQUksRUFBRSxjQUFjO1NBQ3JCLENBQUMsQ0FBQztLQUNKO0lBQ0QsVUFBVSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7SUFDckIsVUFBVSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7SUFDckIsYUFBYSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7SUFDeEIsWUFBWSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7Q0FDeEIsQ0FBQyxDQUFDLENBQUM7QUFFSixJQUFJLENBQUMsSUFBSSxDQUFDLGlDQUFpQyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDbEQsb0JBQW9CLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBQ25DLElBQUksRUFBRSxlQUFlO0tBQ3RCLENBQUMsQ0FBQztJQUNILG1CQUFtQixFQUFFLElBQUksQ0FB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ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgaGFuZGxlciB9IGZyb20gJy4uL2xhbWJkYS9hdXRoLWhhbmRsZXInO1xyXG5cclxuY29uc3QgbW9ja0R5bmFtb1NlbmQgPSBqZXN0LmZuKCk7XHJcbmNvbnN0IG1vY2tTZWNyZXRzU2VuZCA9IGplc3QuZm4oKTtcclxuXHJcbi8vIE1vY2sgQVdTIFNESyBtb2R1bGVzXHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJywgKCkgPT4gKHtcclxuICBEeW5hbW9EQkNsaWVudDogamVzdC5mbigoKSA9PiAoe30pKVxyXG59KSk7XHJcblxyXG5qZXN0Lm1vY2soJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYicsICgpID0+ICh7XHJcbiAgRHluYW1vREJEb2N1bWVudENsaWVudDoge1xyXG4gICAgZnJvbTogamVzdC5mbigoKSA9PiAoe1xyXG4gICAgICBzZW5kOiBtb2NrRHluYW1vU2VuZFxyXG4gICAgfSkpXHJcbiAgfSxcclxuICBQdXRDb21tYW5kOiBqZXN0LmZuKCksXHJcbiAgR2V0Q29tbWFuZDogamVzdC5mbigpLFxyXG4gIERlbGV0ZUNvbW1hbmQ6IGplc3QuZm4oKSxcclxuICBRdWVyeUNvbW1hbmQ6IGplc3QuZm4oKVxyXG59KSk7XHJcblxyXG5qZXN0Lm1vY2soJ0Bhd3Mtc2RrL2NsaWVudC1zZWNyZXRzLW1hbmFnZXInLCAoKSA9PiAoe1xyXG4gIFNlY3JldHNNYW5hZ2VyQ2xpZW50OiBqZXN0LmZuKCgpID0+ICh7XHJcbiAgICBzZW5kOiBtb2NrU2VjcmV0c1NlbmRcclxuICB9KSksXHJcbiAgQ3JlYXRlU2VjcmV0Q29tbWFuZDogamVzdC5mbigpLFxyXG4gIFVwZGF0ZVNlY3JldENvbW1hbmQ6IGplc3QuZm4oKSxcclxuICBHZXRTZWNyZXRWYWx1ZUNvbW1hbmQ6IGplc3QuZm4oKSxcclxuICBEZWxldGVTZWNyZXRDb21tYW5kOiBqZXN0LmZuKClcclxufSkpO1xyXG5cclxuLy8gTW9jayBmZXRjaCBmb3IgT0F1dGggdG9rZW4gZXhjaGFuZ2VcclxuZ2xvYmFsLmZldGNoID0gamVzdC5mbigpIGFzIGplc3QuTW9ja2VkRnVuY3Rpb248dHlwZW9mIGZldGNoPjtcclxuXHJcbmRlc2NyaWJlKCdBdXRoIEhhbmRsZXInLCAoKSA9PiB7XHJcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XHJcbiAgICBqZXN0LmNsZWFyQWxsTW9ja3MoKTtcclxuICAgIFxyXG4gICAgLy8gU2V0IHVwIGVudmlyb25tZW50IHZhcmlhYmxlc1xyXG4gICAgcHJvY2Vzcy5lbnYuUExBVEZPUk1TX1RBQkxFID0gJ3Rlc3QtcGxhdGZvcm1zLXRhYmxlJztcclxuICAgIHByb2Nlc3MuZW52Lk9BVVRIX1NUQVRFU19UQUJMRSA9ICd0ZXN0LW9hdXRoLXN0YXRlcy10YWJsZSc7XHJcbiAgICBwcm9jZXNzLmVudi5NRURJVU1fQ0xJRU5UX0lEID0gJ3Rlc3QtbWVkaXVtLWNsaWVudC1pZCc7XHJcbiAgICBwcm9jZXNzLmVudi5NRURJVU1fQ0xJRU5UX1NFQ1JFVCA9ICd0ZXN0LW1lZGl1bS1jbGllbnQtc2VjcmV0JztcclxuICAgIHByb2Nlc3MuZW52Lk1FRElVTV9SRURJUkVDVF9VUkkgPSAnaHR0cHM6Ly9leGFtcGxlLmNvbS9jYWxsYmFjayc7XHJcbiAgICBwcm9jZXNzLmVudi5MSU5LRURJTl9DTElFTlRfSUQgPSAndGVzdC1saW5rZWRpbi1jbGllbnQtaWQnO1xyXG4gICAgcHJvY2Vzcy5lbnYuTElOS0VESU5fQ0xJRU5UX1NFQ1JFVCA9ICd0ZXN0LWxpbmtlZGluLWNsaWVudC1zZWNyZXQnO1xyXG4gICAgcHJvY2Vzcy5lbnYuTElOS0VESU5fUkVESVJFQ1RfVVJJID0gJ2h0dHBzOi8vZXhhbXBsZS5jb20vY2FsbGJhY2snO1xyXG4gIH0pO1xyXG5cclxuICBhZnRlckVhY2goKCkgPT4ge1xyXG4gICAgamVzdC5yZXN0b3JlQWxsTW9ja3MoKTtcclxuICB9KTtcclxuXHJcbiAgY29uc3QgY3JlYXRlTW9ja0V2ZW50ID0gKFxyXG4gICAgcGF0aDogc3RyaW5nLFxyXG4gICAgbWV0aG9kOiBzdHJpbmcsXHJcbiAgICBib2R5PzogYW55XHJcbiAgKTogQVBJR2F0ZXdheVByb3h5RXZlbnQgPT4gKHtcclxuICAgIHBhdGgsXHJcbiAgICBodHRwTWV0aG9kOiBtZXRob2QsXHJcbiAgICBib2R5OiBib2R5ID8gSlNPTi5zdHJpbmdpZnkoYm9keSkgOiBudWxsLFxyXG4gICAgaGVhZGVyczoge30sXHJcbiAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICByZXNvdXJjZTogJycsXHJcbiAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlXHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdPUFRJT05TIHJlcXVlc3RzJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgQ09SUyBwcmVmbGlnaHQgcmVxdWVzdHMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50KCcvYXV0aC9leGNoYW5nZScsICdPUFRJT05TJyk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50KSBhcyBBUElHYXRld2F5UHJveHlSZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgZXhwZWN0KHJlc3VsdC5oZWFkZXJzKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZScsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBERUxFVEUsIE9QVElPTlMnXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdUb2tlbiBFeGNoYW5nZScsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgc3VjY2Vzc2Z1bGx5IGV4Y2hhbmdlIGF1dGhvcml6YXRpb24gY29kZSBmb3IgdG9rZW4nLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50KCcvYXV0aC9leGNoYW5nZScsICdQT1NUJywge1xyXG4gICAgICAgIGNvZGU6ICd0ZXN0LWF1dGgtY29kZScsXHJcbiAgICAgICAgcGxhdGZvcm06ICdtZWRpdW0nLFxyXG4gICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBzdWNjZXNzZnVsIHRva2VuIGV4Y2hhbmdlXHJcbiAgICAgIChnbG9iYWwuZmV0Y2ggYXMgamVzdC5Nb2NrZWRGdW5jdGlvbjx0eXBlb2YgZmV0Y2g+KS5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2UoXHJcbiAgICAgICAgbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGFjY2Vzc190b2tlbjogJ3Rlc3QtYWNjZXNzLXRva2VuJyxcclxuICAgICAgICAgIHJlZnJlc2hfdG9rZW46ICd0ZXN0LXJlZnJlc2gtdG9rZW4nLFxyXG4gICAgICAgICAgZXhwaXJlc19pbjogMzYwMCxcclxuICAgICAgICAgIHRva2VuX3R5cGU6ICdCZWFyZXInLFxyXG4gICAgICAgICAgc2NvcGU6ICdiYXNpY1Byb2ZpbGUgcHVibGlzaFBvc3QnXHJcbiAgICAgICAgfSksIHsgc3RhdHVzOiAyMDAgfSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCBzZWNyZXQgc3RvcmFnZVxyXG4gICAgICBtb2NrU2VjcmV0c1NlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHt9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCBEeW5hbW9EQiBwdXRcclxuICAgICAgbW9ja0R5bmFtb1NlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHt9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpIGFzIEFQSUdhdGV3YXlQcm94eVJlc3VsdDtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS50b2tlbi5hY2Nlc3NUb2tlbikudG9CZSgndGVzdC1hY2Nlc3MtdG9rZW4nKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgcGFyYW1ldGVycycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnQoJy9hdXRoL2V4Y2hhbmdlJywgJ1BPU1QnLCB7XHJcbiAgICAgICAgY29kZTogJ3Rlc3QtYXV0aC1jb2RlJ1xyXG4gICAgICAgIC8vIE1pc3NpbmcgcGxhdGZvcm0gYW5kIHVzZXJJZFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpIGFzIEFQSUdhdGV3YXlQcm94eVJlc3VsdDtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDApO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZXJyb3IpLnRvQmUoJ01pc3NpbmcgcmVxdWlyZWQgcGFyYW1ldGVycycpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdG9rZW4gZXhjaGFuZ2UgZmFpbHVyZScsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnQoJy9hdXRoL2V4Y2hhbmdlJywgJ1BPU1QnLCB7XHJcbiAgICAgICAgY29kZTogJ2ludmFsaWQtY29kZScsXHJcbiAgICAgICAgcGxhdGZvcm06ICdtZWRpdW0nLFxyXG4gICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBmYWlsZWQgdG9rZW4gZXhjaGFuZ2VcclxuICAgICAgKGdsb2JhbC5mZXRjaCBhcyBqZXN0Lk1vY2tlZEZ1bmN0aW9uPHR5cGVvZiBmZXRjaD4pLm1vY2tSZXNvbHZlZFZhbHVlT25jZShcclxuICAgICAgICBuZXcgUmVzcG9uc2UoJ0ludmFsaWQgYXV0aG9yaXphdGlvbiBjb2RlJywgeyBzdGF0dXM6IDQwMCB9KVxyXG4gICAgICApO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCkgYXMgQVBJR2F0ZXdheVByb3h5UmVzdWx0O1xyXG4gICAgICBcclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDQwMCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKHJlc3VsdC5ib2R5KTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keS5lcnJvcikudG9CZSgnVG9rZW4gZXhjaGFuZ2UgZmFpbGVkJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB1bnN1cHBvcnRlZCBwbGF0Zm9ybScsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnQoJy9hdXRoL2V4Y2hhbmdlJywgJ1BPU1QnLCB7XHJcbiAgICAgICAgY29kZTogJ3Rlc3QtYXV0aC1jb2RlJyxcclxuICAgICAgICBwbGF0Zm9ybTogJ3Vuc3VwcG9ydGVkLXBsYXRmb3JtJyxcclxuICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJ1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpIGFzIEFQSUdhdGV3YXlQcm94eVJlc3VsdDtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDApO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkubWVzc2FnZSkudG9Db250YWluKCdVbnN1cHBvcnRlZCBwbGF0Zm9ybScpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdHZXQgQ29ubmVjdGVkIFBsYXRmb3JtcycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgcmV0dXJuIGNvbm5lY3RlZCBwbGF0Zm9ybXMgZm9yIHVzZXInLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50KCcvYXV0aC9wbGF0Zm9ybXMvdGVzdC11c2VyLTEyMycsICdHRVQnKTtcclxuXHJcbiAgICAgIC8vIE1vY2sgRHluYW1vREIgcXVlcnkgcmVzdWx0XHJcbiAgICAgIG1vY2tEeW5hbW9TZW5kLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgSXRlbXM6IFtcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMycsXHJcbiAgICAgICAgICAgIHBsYXRmb3JtOiAnbWVkaXVtJyxcclxuICAgICAgICAgICAgc2VjcmV0TmFtZTogJ29hdXRoLWNyZWRlbnRpYWxzL3Rlc3QtdXNlci0xMjMvbWVkaXVtJyxcclxuICAgICAgICAgICAgaXNBY3RpdmU6IHRydWUsXHJcbiAgICAgICAgICAgIGNvbm5lY3RlZEF0OiAnMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaJyxcclxuICAgICAgICAgICAgbGFzdFVzZWQ6ICcyMDI0LTAxLTAxVDAwOjAwOjAwLjAwMFonLFxyXG4gICAgICAgICAgICBleHBpcmVzQXQ6IG5ldyBEYXRlKERhdGUubm93KCkgKyAzNjAwMDAwKS50b0lTT1N0cmluZygpXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgXVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc2VjcmV0IHZhbGlkYXRpb25cclxuICAgICAgbW9ja1NlY3JldHNTZW5kLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgICAgU2VjcmV0U3RyaW5nOiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogJ3Rlc3QtdG9rZW4nLFxyXG4gICAgICAgICAgZXhwaXJlc0F0OiBuZXcgRGF0ZShEYXRlLm5vdygpICsgMzYwMDAwMCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgIH0pXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCkgYXMgQVBJR2F0ZXdheVByb3h5UmVzdWx0O1xyXG4gICAgICBcclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKHJlc3VsdC5ib2R5KTtcclxuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkocmVzcG9uc2VCb2R5KSkudG9CZSh0cnVlKTtcclxuICAgICAgZXhwZWN0KHJlc3BvbnNlQm9keVswXS5wbGF0Zm9ybSkudG9CZSgnbWVkaXVtJyk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHlbMF0uaXNBY3RpdmUpLnRvQmUodHJ1ZSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBwbGF0Zm9ybXMgbGlzdCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnQoJy9hdXRoL3BsYXRmb3Jtcy90ZXN0LXVzZXItMTIzJywgJ0dFVCcpO1xyXG5cclxuICAgICAgLy8gTW9jayBlbXB0eSBEeW5hbW9EQiBxdWVyeSByZXN1bHRcclxuICAgICAgbW9ja0R5bmFtb1NlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcclxuICAgICAgICBJdGVtczogW11cclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50KSBhcyBBUElHYXRld2F5UHJveHlSZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShyZXNwb25zZUJvZHkpKS50b0JlKHRydWUpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5Lmxlbmd0aCkudG9CZSgwKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnRGlzY29ubmVjdCBQbGF0Zm9ybScsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgc3VjY2Vzc2Z1bGx5IGRpc2Nvbm5lY3QgcGxhdGZvcm0nLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50KCcvYXV0aC9wbGF0Zm9ybXMvdGVzdC11c2VyLTEyMy9tZWRpdW0nLCAnREVMRVRFJyk7XHJcblxyXG4gICAgICAvLyBNb2NrIGdldHRpbmcgcGxhdGZvcm0gY29ubmVjdGlvblxyXG4gICAgICBtb2NrRHluYW1vU2VuZFxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICAgICAgcGxhdGZvcm06ICdtZWRpdW0nLFxyXG4gICAgICAgICAgICBzZWNyZXROYW1lOiAnb2F1dGgtY3JlZGVudGlhbHMvdGVzdC11c2VyLTEyMy9tZWRpdW0nXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSlcclxuICAgICAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgZGVsZXRpb24gZnJvbSBEeW5hbW9EQlxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe30pO1xyXG5cclxuICAgICAgLy8gTW9jayBzdWNjZXNzZnVsIHNlY3JldCBkZWxldGlvblxyXG4gICAgICBtb2NrU2VjcmV0c1NlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHt9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpIGFzIEFQSUdhdGV3YXlQcm94eVJlc3VsdDtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHBsYXRmb3JtIG5vdCBmb3VuZCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnQoJy9hdXRoL3BsYXRmb3Jtcy90ZXN0LXVzZXItMTIzL25vbmV4aXN0ZW50JywgJ0RFTEVURScpO1xyXG5cclxuICAgICAgLy8gTW9jayBwbGF0Zm9ybSBub3QgZm91bmRcclxuICAgICAgbW9ja0R5bmFtb1NlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcclxuICAgICAgICBJdGVtOiB1bmRlZmluZWRcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50KSBhcyBBUElHYXRld2F5UHJveHlSZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDA0KTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmVycm9yKS50b0JlKCdQbGF0Zm9ybSBjb25uZWN0aW9uIG5vdCBmb3VuZCcpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdDaGVjayBUb2tlbiBTdGF0dXMnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHJldHVybiB2YWxpZCB0b2tlbiBzdGF0dXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50KCcvYXV0aC9zdGF0dXMvdGVzdC11c2VyLTEyMy9tZWRpdW0nLCAnR0VUJyk7XHJcblxyXG4gICAgICAvLyBNb2NrIGdldHRpbmcgcGxhdGZvcm0gY29ubmVjdGlvblxyXG4gICAgICBtb2NrRHluYW1vU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgICAgcGxhdGZvcm06ICdtZWRpdW0nLFxyXG4gICAgICAgICAgc2VjcmV0TmFtZTogJ29hdXRoLWNyZWRlbnRpYWxzL3Rlc3QtdXNlci0xMjMvbWVkaXVtJyxcclxuICAgICAgICAgIGV4cGlyZXNBdDogbmV3IERhdGUoRGF0ZS5ub3coKSArIDM2MDAwMDApLnRvSVNPU3RyaW5nKClcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBnZXR0aW5nIHZhbGlkIGNyZWRlbnRpYWxzXHJcbiAgICAgIG1vY2tTZWNyZXRzU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgYWNjZXNzVG9rZW46ICd0ZXN0LXRva2VuJyxcclxuICAgICAgICAgIGV4cGlyZXNBdDogbmV3IERhdGUoRGF0ZS5ub3coKSArIDM2MDAwMDApLnRvSVNPU3RyaW5nKClcclxuICAgICAgICB9KVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpIGFzIEFQSUdhdGV3YXlQcm94eVJlc3VsdDtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkudmFsaWQpLnRvQmUodHJ1ZSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZXhwaXJlc0F0KS50b0JlRGVmaW5lZCgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gaW52YWxpZCB0b2tlbiBzdGF0dXMgZm9yIGV4cGlyZWQgdG9rZW4nLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50ID0gY3JlYXRlTW9ja0V2ZW50KCcvYXV0aC9zdGF0dXMvdGVzdC11c2VyLTEyMy9tZWRpdW0nLCAnR0VUJyk7XHJcblxyXG4gICAgICAvLyBNb2NrIGdldHRpbmcgcGxhdGZvcm0gY29ubmVjdGlvblxyXG4gICAgICBtb2NrRHluYW1vU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgICAgcGxhdGZvcm06ICdtZWRpdW0nLFxyXG4gICAgICAgICAgc2VjcmV0TmFtZTogJ29hdXRoLWNyZWRlbnRpYWxzL3Rlc3QtdXNlci0xMjMvbWVkaXVtJyxcclxuICAgICAgICAgIGV4cGlyZXNBdDogbmV3IERhdGUoRGF0ZS5ub3coKSAtIDM2MDAwMDApLnRvSVNPU3RyaW5nKCkgLy8gRXhwaXJlZFxyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIGdldHRpbmcgZXhwaXJlZCBjcmVkZW50aWFsc1xyXG4gICAgICBtb2NrU2VjcmV0c1NlbmQubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcclxuICAgICAgICBTZWNyZXRTdHJpbmc6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGFjY2Vzc1Rva2VuOiAndGVzdC10b2tlbicsXHJcbiAgICAgICAgICBleHBpcmVzQXQ6IG5ldyBEYXRlKERhdGUubm93KCkgLSAzNjAwMDAwKS50b0lTT1N0cmluZygpIC8vIEV4cGlyZWRcclxuICAgICAgICB9KVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpIGFzIEFQSUdhdGV3YXlQcm94eVJlc3VsdDtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkudmFsaWQpLnRvQmUoZmFsc2UpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdUb2tlbiBSZWZyZXNoJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBzdWNjZXNzZnVsbHkgcmVmcmVzaCB0b2tlbicsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnQoJy9hdXRoL3JlZnJlc2gnLCAnUE9TVCcsIHtcclxuICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICBwbGF0Zm9ybTogJ21lZGl1bSdcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIGdldHRpbmcgcGxhdGZvcm0gY29ubmVjdGlvblxyXG4gICAgICBtb2NrRHluYW1vU2VuZFxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICAgICAgcGxhdGZvcm06ICdtZWRpdW0nLFxyXG4gICAgICAgICAgICBzZWNyZXROYW1lOiAnb2F1dGgtY3JlZGVudGlhbHMvdGVzdC11c2VyLTEyMy9tZWRpdW0nXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSlcclxuICAgICAgICAvLyBNb2NrIHVwZGF0aW5nIHBsYXRmb3JtIGNvbm5lY3Rpb25cclxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHt9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgZ2V0dGluZyBjdXJyZW50IGNyZWRlbnRpYWxzXHJcbiAgICAgIG1vY2tTZWNyZXRzU2VuZFxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgICAgU2VjcmV0U3RyaW5nOiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIGFjY2Vzc1Rva2VuOiAnb2xkLXRva2VuJyxcclxuICAgICAgICAgICAgcmVmcmVzaFRva2VuOiAndGVzdC1yZWZyZXNoLXRva2VuJyxcclxuICAgICAgICAgICAgZXhwaXJlc0F0OiBuZXcgRGF0ZShEYXRlLm5vdygpIC0gMzYwMDAwMCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgfSlcclxuICAgICAgICB9KVxyXG4gICAgICAgIC8vIE1vY2sgdXBkYXRpbmcgY3JlZGVudGlhbHNcclxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHt9KTtcclxuXHJcbiAgICAgIC8vIE1vY2sgc3VjY2Vzc2Z1bCB0b2tlbiByZWZyZXNoXHJcbiAgICAgIChnbG9iYWwuZmV0Y2ggYXMgamVzdC5Nb2NrZWRGdW5jdGlvbjx0eXBlb2YgZmV0Y2g+KS5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2UoXHJcbiAgICAgICAgbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGFjY2Vzc190b2tlbjogJ25ldy1hY2Nlc3MtdG9rZW4nLFxyXG4gICAgICAgICAgcmVmcmVzaF90b2tlbjogJ25ldy1yZWZyZXNoLXRva2VuJyxcclxuICAgICAgICAgIGV4cGlyZXNfaW46IDM2MDAsXHJcbiAgICAgICAgICB0b2tlbl90eXBlOiAnQmVhcmVyJ1xyXG4gICAgICAgIH0pLCB7IHN0YXR1czogMjAwIH0pXHJcbiAgICAgICk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50KSBhcyBBUElHYXRld2F5UHJveHlSZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkudG9rZW4uYWNjZXNzVG9rZW4pLnRvQmUoJ25ldy1hY2Nlc3MtdG9rZW4nKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgcmVmcmVzaCB0b2tlbicsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnQoJy9hdXRoL3JlZnJlc2gnLCAnUE9TVCcsIHtcclxuICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICBwbGF0Zm9ybTogJ21lZGl1bSdcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIGdldHRpbmcgcGxhdGZvcm0gY29ubmVjdGlvblxyXG4gICAgICBtb2NrRHluYW1vU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgICAgcGxhdGZvcm06ICdtZWRpdW0nLFxyXG4gICAgICAgICAgc2VjcmV0TmFtZTogJ29hdXRoLWNyZWRlbnRpYWxzL3Rlc3QtdXNlci0xMjMvbWVkaXVtJ1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBNb2NrIGdldHRpbmcgY3JlZGVudGlhbHMgd2l0aG91dCByZWZyZXNoIHRva2VuXHJcbiAgICAgIG1vY2tTZWNyZXRzU2VuZC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgYWNjZXNzVG9rZW46ICdvbGQtdG9rZW4nLFxyXG4gICAgICAgICAgZXhwaXJlc0F0OiBuZXcgRGF0ZShEYXRlLm5vdygpIC0gMzYwMDAwMCkudG9JU09TdHJpbmcoKVxyXG4gICAgICAgICAgLy8gTm8gcmVmcmVzaFRva2VuXHJcbiAgICAgICAgfSlcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50KSBhcyBBUElHYXRld2F5UHJveHlSZXN1bHQ7XHJcbiAgICAgIFxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDAwKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UocmVzdWx0LmJvZHkpO1xyXG4gICAgICBleHBlY3QocmVzcG9uc2VCb2R5LmVycm9yKS50b0JlKCdObyByZWZyZXNoIHRva2VuIGF2YWlsYWJsZScpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdFcnJvciBIYW5kbGluZycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHVua25vd24gcm91dGVzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudCA9IGNyZWF0ZU1vY2tFdmVudCgnL2F1dGgvdW5rbm93bicsICdHRVQnKTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpIGFzIEFQSUdhdGV3YXlQcm94eVJlc3VsdDtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDQpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZXJyb3IpLnRvQmUoJ05vdCBmb3VuZCcpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW50ZXJuYWwgc2VydmVyIGVycm9ycycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSBjcmVhdGVNb2NrRXZlbnQoJy9hdXRoL2V4Y2hhbmdlJywgJ1BPU1QnLCB7XHJcbiAgICAgICAgY29kZTogJ3Rlc3QtY29kZScsXHJcbiAgICAgICAgcGxhdGZvcm06ICdtZWRpdW0nLFxyXG4gICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gTW9jayBEeW5hbW9EQiBlcnJvclxyXG4gICAgICBtb2NrRHluYW1vU2VuZC5tb2NrUmVqZWN0ZWRWYWx1ZU9uY2UobmV3IEVycm9yKCdEeW5hbW9EQiBlcnJvcicpKTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQpIGFzIEFQSUdhdGV3YXlQcm94eVJlc3VsdDtcclxuICAgICAgXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg1MDApO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5wYXJzZShyZXN1bHQuYm9keSk7XHJcbiAgICAgIGV4cGVjdChyZXNwb25zZUJvZHkuZXJyb3IpLnRvQmUoJ0ludGVybmFsIHNlcnZlciBlcnJvcicpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbn0pOyJdfQ==