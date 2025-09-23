"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const secretsClient = new client_secrets_manager_1.SecretsManagerClient({});
const PLATFORMS_TABLE = process.env.PLATFORMS_TABLE;
const OAUTH_STATES_TABLE = process.env.OAUTH_STATES_TABLE;
const handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
    };
    try {
        const path = event.path;
        const method = event.httpMethod;
        if (method === 'OPTIONS') {
            return { statusCode: 200, headers, body: '' };
        }
        if (path === '/auth/exchange' && method === 'POST') {
            return await handleTokenExchange(event, headers);
        }
        if (path.startsWith('/auth/platforms/') && method === 'GET') {
            const userId = path.split('/')[3];
            return await getConnectedPlatforms(userId, headers);
        }
        if (path.startsWith('/auth/platforms/') && method === 'DELETE') {
            const pathParts = path.split('/');
            const userId = pathParts[3];
            const platform = pathParts[4];
            return await disconnectPlatform(userId, platform, headers);
        }
        if (path.startsWith('/auth/status/') && method === 'GET') {
            const pathParts = path.split('/');
            const userId = pathParts[3];
            const platform = pathParts[4];
            return await checkTokenStatus(userId, platform, headers);
        }
        if (path === '/auth/refresh' && method === 'POST') {
            return await refreshToken(event, headers);
        }
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Not found' })
        };
    }
    catch (error) {
        console.error('Auth handler error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
};
exports.handler = handler;
async function handleTokenExchange(event, headers) {
    const body = JSON.parse(event.body || '{}');
    const { code, platform, userId } = body;
    if (!code || !platform || !userId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing required parameters' })
        };
    }
    try {
        // Exchange authorization code for access token
        const tokenData = await exchangeCodeForToken(code, platform);
        // Store credentials securely in Secrets Manager
        const secretName = `oauth-credentials/${userId}/${platform}`;
        await storeCredentials(secretName, tokenData);
        // Store platform connection in DynamoDB
        const connection = {
            userId,
            platform,
            secretName,
            isActive: true,
            connectedAt: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            expiresAt: tokenData.expiresAt
        };
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: PLATFORMS_TABLE,
            Item: connection
        }));
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                token: {
                    accessToken: tokenData.accessToken,
                    expiresAt: tokenData.expiresAt,
                    tokenType: tokenData.tokenType,
                    scope: tokenData.scope
                }
            })
        };
    }
    catch (error) {
        console.error('Token exchange error:', error);
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
                error: 'Token exchange failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
}
async function exchangeCodeForToken(code, platform) {
    const configs = {
        medium: {
            tokenUrl: 'https://api.medium.com/v1/tokens',
            clientId: process.env.MEDIUM_CLIENT_ID,
            clientSecret: process.env.MEDIUM_CLIENT_SECRET,
            redirectUri: process.env.MEDIUM_REDIRECT_URI
        },
        linkedin: {
            tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
            clientId: process.env.LINKEDIN_CLIENT_ID,
            clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
            redirectUri: process.env.LINKEDIN_REDIRECT_URI
        }
    };
    const config = configs[platform];
    if (!config) {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri
    });
    const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        },
        body: params.toString()
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }
    const tokenResponse = await response.json();
    return {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: new Date(Date.now() + (tokenResponse.expires_in * 1000)).toISOString(),
        tokenType: tokenResponse.token_type || 'Bearer',
        scope: tokenResponse.scope ? tokenResponse.scope.split(' ') : []
    };
}
async function storeCredentials(secretName, tokenData) {
    const secretValue = JSON.stringify({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt,
        tokenType: tokenData.tokenType,
        scope: tokenData.scope
    });
    try {
        // Try to update existing secret first
        await secretsClient.send(new client_secrets_manager_1.UpdateSecretCommand({
            SecretId: secretName,
            SecretString: secretValue
        }));
    }
    catch (error) {
        // If secret doesn't exist, create it
        await secretsClient.send(new client_secrets_manager_1.CreateSecretCommand({
            Name: secretName,
            SecretString: secretValue,
            Description: `OAuth credentials for platform authentication`
        }));
    }
}
async function getConnectedPlatforms(userId, headers) {
    try {
        const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: PLATFORMS_TABLE,
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: {
                ':userId': userId
            }
        }));
        const platforms = result.Items || [];
        // Check token status for each platform
        const platformsWithStatus = await Promise.all(platforms.map(async (platform) => {
            const tokenStatus = await checkTokenValidity(platform.secretName);
            return {
                platform: platform.platform,
                isActive: platform.isActive && tokenStatus.valid,
                connectedAt: platform.connectedAt,
                lastUsed: platform.lastUsed,
                expiresAt: platform.expiresAt,
                needsRenewal: !tokenStatus.valid
            };
        }));
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(platformsWithStatus)
        };
    }
    catch (error) {
        console.error('Get platforms error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to fetch platforms' })
        };
    }
}
async function disconnectPlatform(userId, platform, headers) {
    try {
        // Get platform connection to find secret name
        const result = await docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: PLATFORMS_TABLE,
            Key: { userId, platform }
        }));
        if (!result.Item) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Platform connection not found' })
            };
        }
        // Delete credentials from Secrets Manager
        try {
            await secretsClient.send(new client_secrets_manager_1.DeleteSecretCommand({
                SecretId: result.Item.secretName,
                ForceDeleteWithoutRecovery: true
            }));
        }
        catch (error) {
            console.warn('Failed to delete secret:', error);
            // Continue with platform disconnection even if secret deletion fails
        }
        // Remove platform connection from DynamoDB
        await docClient.send(new lib_dynamodb_1.DeleteCommand({
            TableName: PLATFORMS_TABLE,
            Key: { userId, platform }
        }));
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true })
        };
    }
    catch (error) {
        console.error('Disconnect platform error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to disconnect platform' })
        };
    }
}
async function checkTokenStatus(userId, platform, headers) {
    try {
        const result = await docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: PLATFORMS_TABLE,
            Key: { userId, platform }
        }));
        if (!result.Item) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Platform connection not found' })
            };
        }
        const tokenStatus = await checkTokenValidity(result.Item.secretName);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                valid: tokenStatus.valid,
                expiresAt: result.Item.expiresAt
            })
        };
    }
    catch (error) {
        console.error('Check token status error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to check token status' })
        };
    }
}
async function refreshToken(event, headers) {
    const body = JSON.parse(event.body || '{}');
    const { userId, platform } = body;
    try {
        // Get current credentials
        const platformResult = await docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: PLATFORMS_TABLE,
            Key: { userId, platform }
        }));
        if (!platformResult.Item) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Platform connection not found' })
            };
        }
        const credentials = await getCredentials(platformResult.Item.secretName);
        if (!credentials.refreshToken) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'No refresh token available' })
            };
        }
        // Refresh the token
        const newTokenData = await performTokenRefresh(platform, credentials.refreshToken);
        // Update stored credentials
        await storeCredentials(platformResult.Item.secretName, newTokenData);
        // Update platform connection
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: PLATFORMS_TABLE,
            Item: {
                ...platformResult.Item,
                expiresAt: newTokenData.expiresAt,
                lastUsed: new Date().toISOString()
            }
        }));
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                token: {
                    accessToken: newTokenData.accessToken,
                    expiresAt: newTokenData.expiresAt,
                    tokenType: newTokenData.tokenType,
                    scope: newTokenData.scope
                }
            })
        };
    }
    catch (error) {
        console.error('Token refresh error:', error);
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
                error: 'Token refresh failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
}
async function checkTokenValidity(secretName) {
    try {
        const credentials = await getCredentials(secretName);
        const expiresAt = new Date(credentials.expiresAt);
        const now = new Date();
        return { valid: expiresAt > now };
    }
    catch (error) {
        return { valid: false };
    }
}
async function getCredentials(secretName) {
    const result = await secretsClient.send(new client_secrets_manager_1.GetSecretValueCommand({
        SecretId: secretName
    }));
    if (!result.SecretString) {
        throw new Error('No secret value found');
    }
    return JSON.parse(result.SecretString);
}
async function performTokenRefresh(platform, refreshToken) {
    const configs = {
        medium: {
            tokenUrl: 'https://api.medium.com/v1/tokens',
            clientId: process.env.MEDIUM_CLIENT_ID,
            clientSecret: process.env.MEDIUM_CLIENT_SECRET
        },
        linkedin: {
            tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
            clientId: process.env.LINKEDIN_CLIENT_ID,
            clientSecret: process.env.LINKEDIN_CLIENT_SECRET
        }
    };
    const config = configs[platform];
    if (!config) {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret
    });
    const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        },
        body: params.toString()
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }
    const tokenResponse = await response.json();
    return {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token || refreshToken,
        expiresAt: new Date(Date.now() + (tokenResponse.expires_in * 1000)).toISOString(),
        tokenType: tokenResponse.token_type || 'Bearer',
        scope: tokenResponse.scope ? tokenResponse.scope.split(' ') : []
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1oYW5kbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0aC1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLDhEQUEwRDtBQUMxRCx3REFBb0g7QUFDcEgsNEVBQTZKO0FBRTdKLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUM1QyxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDNUQsTUFBTSxhQUFhLEdBQUcsSUFBSSw2Q0FBb0IsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUVuRCxNQUFNLGVBQWUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWdCLENBQUM7QUFDckQsTUFBTSxrQkFBa0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFtQixDQUFDO0FBYXBELE1BQU0sT0FBTyxHQUFHLEtBQUssRUFBRSxLQUEyQixFQUFrQyxFQUFFO0lBQzNGLE1BQU0sT0FBTyxHQUFHO1FBQ2QsY0FBYyxFQUFFLGtCQUFrQjtRQUNsQyw2QkFBNkIsRUFBRSxHQUFHO1FBQ2xDLDhCQUE4QixFQUFFLGNBQWM7UUFDOUMsOEJBQThCLEVBQUUsNEJBQTRCO0tBQzdELENBQUM7SUFFRixJQUFJO1FBQ0YsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQztRQUN4QixNQUFNLE1BQU0sR0FBRyxLQUFLLENBQUMsVUFBVSxDQUFDO1FBRWhDLElBQUksTUFBTSxLQUFLLFNBQVMsRUFBRTtZQUN4QixPQUFPLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxDQUFDO1NBQy9DO1FBRUQsSUFBSSxJQUFJLEtBQUssZ0JBQWdCLElBQUksTUFBTSxLQUFLLE1BQU0sRUFBRTtZQUNsRCxPQUFPLE1BQU0sbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1NBQ2xE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RUFBRSxtQ0FBbUM7WUFDbkQsUUFBUSxFQUFFLGtCQUFrQjtTQUM3QjtRQUNELElBQUksRUFBRSxNQUFNLENBQUMsUUFBUSxFQUFFO0tBQ3hCLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFO1FBQ2hCLE1BQU0sU0FBUyxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ3hDLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLFFBQVEsQ0FBQyxNQUFNLElBQUksU0FBUyxFQUFFLENBQUMsQ0FBQztLQUMxRTtJQUVELE1BQU0sYUFBYSxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO0lBRTVDLE9BQU87UUFDTCxXQUFXLEVBQUUsYUFBYSxDQUFDLFlBQVk7UUFDdkMsWUFBWSxFQUFFLGFBQWEsQ0FBQyxhQUFhLElBQUksWUFBWTtRQUN6RCxTQUFTLEVBQUUsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRTtRQUNqRixTQUFTLEVBQUUsYUFBYSxDQUFDLFVBQVUsSUFBSSxRQUFRO1FBQy9DLEtBQUssRUFBRSxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTtLQUNqRSxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kLCBHZXRDb21tYW5kLCBEZWxldGVDb21tYW5kLCBRdWVyeUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBTZWNyZXRzTWFuYWdlckNsaWVudCwgQ3JlYXRlU2VjcmV0Q29tbWFuZCwgVXBkYXRlU2VjcmV0Q29tbWFuZCwgR2V0U2VjcmV0VmFsdWVDb21tYW5kLCBEZWxldGVTZWNyZXRDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNlY3JldHMtbWFuYWdlcic7XHJcblxyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuY29uc3Qgc2VjcmV0c0NsaWVudCA9IG5ldyBTZWNyZXRzTWFuYWdlckNsaWVudCh7fSk7XHJcblxyXG5jb25zdCBQTEFURk9STVNfVEFCTEUgPSBwcm9jZXNzLmVudi5QTEFURk9STVNfVEFCTEUhO1xyXG5jb25zdCBPQVVUSF9TVEFURVNfVEFCTEUgPSBwcm9jZXNzLmVudi5PQVVUSF9TVEFURVNfVEFCTEUhO1xyXG5cclxuaW50ZXJmYWNlIE9BdXRoVG9rZW5FeGNoYW5nZVJlcXVlc3Qge1xyXG4gIGNvZGU6IHN0cmluZztcclxuICBwbGF0Zm9ybTogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVG9rZW5SZWZyZXNoUmVxdWVzdCB7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgcGxhdGZvcm06IHN0cmluZztcclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcclxuICBjb25zdCBoZWFkZXJzID0ge1xyXG4gICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUnLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBERUxFVEUsIE9QVElPTlMnXHJcbiAgfTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHBhdGggPSBldmVudC5wYXRoO1xyXG4gICAgY29uc3QgbWV0aG9kID0gZXZlbnQuaHR0cE1ldGhvZDtcclxuXHJcbiAgICBpZiAobWV0aG9kID09PSAnT1BUSU9OUycpIHtcclxuICAgICAgcmV0dXJuIHsgc3RhdHVzQ29kZTogMjAwLCBoZWFkZXJzLCBib2R5OiAnJyB9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChwYXRoID09PSAnL2F1dGgvZXhjaGFuZ2UnICYmIG1ldGhvZCA9PT0gJ1BPU1QnKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVUb2tlbkV4Y2hhbmdlKGV2ZW50LCBoZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocGF0aC5zdGFydHNXaXRoKCcvYXV0aC9wbGF0Zm9ybXMvJykgJiYgbWV0aG9kID09PSAnR0VUJykge1xyXG4gICAgICBjb25zdCB1c2VySWQgPSBwYXRoLnNwbGl0KCcvJylbM107XHJcbiAgICAgIHJldHVybiBhd2FpdCBnZXRDb25uZWN0ZWRQbGF0Zm9ybXModXNlcklkLCBoZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocGF0aC5zdGFydHNXaXRoKCcvYXV0aC9wbGF0Zm9ybXMvJykgJiYgbWV0aG9kID09PSAnREVMRVRFJykge1xyXG4gICAgICBjb25zdCBwYXRoUGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XHJcbiAgICAgIGNvbnN0IHVzZXJJZCA9IHBhdGhQYXJ0c1szXTtcclxuICAgICAgY29uc3QgcGxhdGZvcm0gPSBwYXRoUGFydHNbNF07XHJcbiAgICAgIHJldHVybiBhd2FpdCBkaXNjb25uZWN0UGxhdGZvcm0odXNlcklkLCBwbGF0Zm9ybSwgaGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHBhdGguc3RhcnRzV2l0aCgnL2F1dGgvc3RhdHVzLycpICYmIG1ldGhvZCA9PT0gJ0dFVCcpIHtcclxuICAgICAgY29uc3QgcGF0aFBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xyXG4gICAgICBjb25zdCB1c2VySWQgPSBwYXRoUGFydHNbM107XHJcbiAgICAgIGNvbnN0IHBsYXRmb3JtID0gcGF0aFBhcnRzWzRdO1xyXG4gICAgICByZXR1cm4gYXdhaXQgY2hlY2tUb2tlblN0YXR1cyh1c2VySWQsIHBsYXRmb3JtLCBoZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocGF0aCA9PT0gJy9hdXRoL3JlZnJlc2gnICYmIG1ldGhvZCA9PT0gJ1BPU1QnKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCByZWZyZXNoVG9rZW4oZXZlbnQsIGhlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgaGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ05vdCBmb3VuZCcgfSlcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0F1dGggaGFuZGxlciBlcnJvcjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgXHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXHJcbiAgICAgIH0pXHJcbiAgICB9O1xyXG4gIH1cclxufTtcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVRva2VuRXhjaGFuZ2UoXHJcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBcclxuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgY29uc3QgYm9keTogT0F1dGhUb2tlbkV4Y2hhbmdlUmVxdWVzdCA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSB8fCAne30nKTtcclxuICBjb25zdCB7IGNvZGUsIHBsYXRmb3JtLCB1c2VySWQgfSA9IGJvZHk7XHJcblxyXG4gIGlmICghY29kZSB8fCAhcGxhdGZvcm0gfHwgIXVzZXJJZCkge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICBoZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnTWlzc2luZyByZXF1aXJlZCBwYXJhbWV0ZXJzJyB9KVxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBFeGNoYW5nZSBhdXRob3JpemF0aW9uIGNvZGUgZm9yIGFjY2VzcyB0b2tlblxyXG4gICAgY29uc3QgdG9rZW5EYXRhID0gYXdhaXQgZXhjaGFuZ2VDb2RlRm9yVG9rZW4oY29kZSwgcGxhdGZvcm0pO1xyXG4gICAgXHJcbiAgICAvLyBTdG9yZSBjcmVkZW50aWFscyBzZWN1cmVseSBpbiBTZWNyZXRzIE1hbmFnZXJcclxuICAgIGNvbnN0IHNlY3JldE5hbWUgPSBgb2F1dGgtY3JlZGVudGlhbHMvJHt1c2VySWR9LyR7cGxhdGZvcm19YDtcclxuICAgIGF3YWl0IHN0b3JlQ3JlZGVudGlhbHMoc2VjcmV0TmFtZSwgdG9rZW5EYXRhKTtcclxuXHJcbiAgICAvLyBTdG9yZSBwbGF0Zm9ybSBjb25uZWN0aW9uIGluIER5bmFtb0RCXHJcbiAgICBjb25zdCBjb25uZWN0aW9uID0ge1xyXG4gICAgICB1c2VySWQsXHJcbiAgICAgIHBsYXRmb3JtLFxyXG4gICAgICBzZWNyZXROYW1lLFxyXG4gICAgICBpc0FjdGl2ZTogdHJ1ZSxcclxuICAgICAgY29ubmVjdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgbGFzdFVzZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgZXhwaXJlc0F0OiB0b2tlbkRhdGEuZXhwaXJlc0F0XHJcbiAgICB9O1xyXG5cclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBQTEFURk9STVNfVEFCTEUsXHJcbiAgICAgIEl0ZW06IGNvbm5lY3Rpb25cclxuICAgIH0pKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIHRva2VuOiB7XHJcbiAgICAgICAgICBhY2Nlc3NUb2tlbjogdG9rZW5EYXRhLmFjY2Vzc1Rva2VuLFxyXG4gICAgICAgICAgZXhwaXJlc0F0OiB0b2tlbkRhdGEuZXhwaXJlc0F0LFxyXG4gICAgICAgICAgdG9rZW5UeXBlOiB0b2tlbkRhdGEudG9rZW5UeXBlLFxyXG4gICAgICAgICAgc2NvcGU6IHRva2VuRGF0YS5zY29wZVxyXG4gICAgICAgIH1cclxuICAgICAgfSlcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1Rva2VuIGV4Y2hhbmdlIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgaGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBcclxuICAgICAgICBlcnJvcjogJ1Rva2VuIGV4Y2hhbmdlIGZhaWxlZCcsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcclxuICAgICAgfSlcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBleGNoYW5nZUNvZGVGb3JUb2tlbihjb2RlOiBzdHJpbmcsIHBsYXRmb3JtOiBzdHJpbmcpIHtcclxuICBjb25zdCBjb25maWdzID0ge1xyXG4gICAgbWVkaXVtOiB7XHJcbiAgICAgIHRva2VuVXJsOiAnaHR0cHM6Ly9hcGkubWVkaXVtLmNvbS92MS90b2tlbnMnLFxyXG4gICAgICBjbGllbnRJZDogcHJvY2Vzcy5lbnYuTUVESVVNX0NMSUVOVF9JRCEsXHJcbiAgICAgIGNsaWVudFNlY3JldDogcHJvY2Vzcy5lbnYuTUVESVVNX0NMSUVOVF9TRUNSRVQhLFxyXG4gICAgICByZWRpcmVjdFVyaTogcHJvY2Vzcy5lbnYuTUVESVVNX1JFRElSRUNUX1VSSSFcclxuICAgIH0sXHJcbiAgICBsaW5rZWRpbjoge1xyXG4gICAgICB0b2tlblVybDogJ2h0dHBzOi8vd3d3LmxpbmtlZGluLmNvbS9vYXV0aC92Mi9hY2Nlc3NUb2tlbicsXHJcbiAgICAgIGNsaWVudElkOiBwcm9jZXNzLmVudi5MSU5LRURJTl9DTElFTlRfSUQhLFxyXG4gICAgICBjbGllbnRTZWNyZXQ6IHByb2Nlc3MuZW52LkxJTktFRElOX0NMSUVOVF9TRUNSRVQhLFxyXG4gICAgICByZWRpcmVjdFVyaTogcHJvY2Vzcy5lbnYuTElOS0VESU5fUkVESVJFQ1RfVVJJIVxyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ3NbcGxhdGZvcm0gYXMga2V5b2YgdHlwZW9mIGNvbmZpZ3NdO1xyXG4gIGlmICghY29uZmlnKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHBsYXRmb3JtOiAke3BsYXRmb3JtfWApO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh7XHJcbiAgICBncmFudF90eXBlOiAnYXV0aG9yaXphdGlvbl9jb2RlJyxcclxuICAgIGNvZGUsXHJcbiAgICBjbGllbnRfaWQ6IGNvbmZpZy5jbGllbnRJZCxcclxuICAgIGNsaWVudF9zZWNyZXQ6IGNvbmZpZy5jbGllbnRTZWNyZXQsXHJcbiAgICByZWRpcmVjdF91cmk6IGNvbmZpZy5yZWRpcmVjdFVyaVxyXG4gIH0pO1xyXG5cclxuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGNvbmZpZy50b2tlblVybCwge1xyXG4gICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICBoZWFkZXJzOiB7XHJcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJyxcclxuICAgICAgJ0FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJ1xyXG4gICAgfSxcclxuICAgIGJvZHk6IHBhcmFtcy50b1N0cmluZygpXHJcbiAgfSk7XHJcblxyXG4gIGlmICghcmVzcG9uc2Uub2spIHtcclxuICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTtcclxuICAgIHRocm93IG5ldyBFcnJvcihgVG9rZW4gZXhjaGFuZ2UgZmFpbGVkOiAke3Jlc3BvbnNlLnN0YXR1c30gJHtlcnJvclRleHR9YCk7XHJcbiAgfVxyXG5cclxuICBjb25zdCB0b2tlblJlc3BvbnNlID0gYXdhaXQgcmVzcG9uc2UuanNvbigpO1xyXG4gIFxyXG4gIHJldHVybiB7XHJcbiAgICBhY2Nlc3NUb2tlbjogdG9rZW5SZXNwb25zZS5hY2Nlc3NfdG9rZW4sXHJcbiAgICByZWZyZXNoVG9rZW46IHRva2VuUmVzcG9uc2UucmVmcmVzaF90b2tlbixcclxuICAgIGV4cGlyZXNBdDogbmV3IERhdGUoRGF0ZS5ub3coKSArICh0b2tlblJlc3BvbnNlLmV4cGlyZXNfaW4gKiAxMDAwKSkudG9JU09TdHJpbmcoKSxcclxuICAgIHRva2VuVHlwZTogdG9rZW5SZXNwb25zZS50b2tlbl90eXBlIHx8ICdCZWFyZXInLFxyXG4gICAgc2NvcGU6IHRva2VuUmVzcG9uc2Uuc2NvcGUgPyB0b2tlblJlc3BvbnNlLnNjb3BlLnNwbGl0KCcgJykgOiBbXVxyXG4gIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHN0b3JlQ3JlZGVudGlhbHMoc2VjcmV0TmFtZTogc3RyaW5nLCB0b2tlbkRhdGE6IGFueSkge1xyXG4gIGNvbnN0IHNlY3JldFZhbHVlID0gSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgYWNjZXNzVG9rZW46IHRva2VuRGF0YS5hY2Nlc3NUb2tlbixcclxuICAgIHJlZnJlc2hUb2tlbjogdG9rZW5EYXRhLnJlZnJlc2hUb2tlbixcclxuICAgIGV4cGlyZXNBdDogdG9rZW5EYXRhLmV4cGlyZXNBdCxcclxuICAgIHRva2VuVHlwZTogdG9rZW5EYXRhLnRva2VuVHlwZSxcclxuICAgIHNjb3BlOiB0b2tlbkRhdGEuc2NvcGVcclxuICB9KTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIFRyeSB0byB1cGRhdGUgZXhpc3Rpbmcgc2VjcmV0IGZpcnN0XHJcbiAgICBhd2FpdCBzZWNyZXRzQ2xpZW50LnNlbmQobmV3IFVwZGF0ZVNlY3JldENvbW1hbmQoe1xyXG4gICAgICBTZWNyZXRJZDogc2VjcmV0TmFtZSxcclxuICAgICAgU2VjcmV0U3RyaW5nOiBzZWNyZXRWYWx1ZVxyXG4gICAgfSkpO1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAvLyBJZiBzZWNyZXQgZG9lc24ndCBleGlzdCwgY3JlYXRlIGl0XHJcbiAgICBhd2FpdCBzZWNyZXRzQ2xpZW50LnNlbmQobmV3IENyZWF0ZVNlY3JldENvbW1hbmQoe1xyXG4gICAgICBOYW1lOiBzZWNyZXROYW1lLFxyXG4gICAgICBTZWNyZXRTdHJpbmc6IHNlY3JldFZhbHVlLFxyXG4gICAgICBEZXNjcmlwdGlvbjogYE9BdXRoIGNyZWRlbnRpYWxzIGZvciBwbGF0Zm9ybSBhdXRoZW50aWNhdGlvbmBcclxuICAgIH0pKTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldENvbm5lY3RlZFBsYXRmb3JtcyhcclxuICB1c2VySWQ6IHN0cmluZywgXHJcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBQTEFURk9STVNfVEFCTEUsXHJcbiAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICd1c2VySWQgPSA6dXNlcklkJyxcclxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICc6dXNlcklkJzogdXNlcklkXHJcbiAgICAgIH1cclxuICAgIH0pKTtcclxuXHJcbiAgICBjb25zdCBwbGF0Zm9ybXMgPSByZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICBcclxuICAgIC8vIENoZWNrIHRva2VuIHN0YXR1cyBmb3IgZWFjaCBwbGF0Zm9ybVxyXG4gICAgY29uc3QgcGxhdGZvcm1zV2l0aFN0YXR1cyA9IGF3YWl0IFByb21pc2UuYWxsKFxyXG4gICAgICBwbGF0Zm9ybXMubWFwKGFzeW5jIChwbGF0Zm9ybSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHRva2VuU3RhdHVzID0gYXdhaXQgY2hlY2tUb2tlblZhbGlkaXR5KHBsYXRmb3JtLnNlY3JldE5hbWUpO1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBwbGF0Zm9ybTogcGxhdGZvcm0ucGxhdGZvcm0sXHJcbiAgICAgICAgICBpc0FjdGl2ZTogcGxhdGZvcm0uaXNBY3RpdmUgJiYgdG9rZW5TdGF0dXMudmFsaWQsXHJcbiAgICAgICAgICBjb25uZWN0ZWRBdDogcGxhdGZvcm0uY29ubmVjdGVkQXQsXHJcbiAgICAgICAgICBsYXN0VXNlZDogcGxhdGZvcm0ubGFzdFVzZWQsXHJcbiAgICAgICAgICBleHBpcmVzQXQ6IHBsYXRmb3JtLmV4cGlyZXNBdCxcclxuICAgICAgICAgIG5lZWRzUmVuZXdhbDogIXRva2VuU3RhdHVzLnZhbGlkXHJcbiAgICAgICAgfTtcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShwbGF0Zm9ybXNXaXRoU3RhdHVzKVxyXG4gICAgfTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignR2V0IHBsYXRmb3JtcyBlcnJvcjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdGYWlsZWQgdG8gZmV0Y2ggcGxhdGZvcm1zJyB9KVxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGRpc2Nvbm5lY3RQbGF0Zm9ybShcclxuICB1c2VySWQ6IHN0cmluZywgXHJcbiAgcGxhdGZvcm06IHN0cmluZywgXHJcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICAvLyBHZXQgcGxhdGZvcm0gY29ubmVjdGlvbiB0byBmaW5kIHNlY3JldCBuYW1lXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogUExBVEZPUk1TX1RBQkxFLFxyXG4gICAgICBLZXk6IHsgdXNlcklkLCBwbGF0Zm9ybSB9XHJcbiAgICB9KSk7XHJcblxyXG4gICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgICBoZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdQbGF0Zm9ybSBjb25uZWN0aW9uIG5vdCBmb3VuZCcgfSlcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBEZWxldGUgY3JlZGVudGlhbHMgZnJvbSBTZWNyZXRzIE1hbmFnZXJcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IHNlY3JldHNDbGllbnQuc2VuZChuZXcgRGVsZXRlU2VjcmV0Q29tbWFuZCh7XHJcbiAgICAgICAgU2VjcmV0SWQ6IHJlc3VsdC5JdGVtLnNlY3JldE5hbWUsXHJcbiAgICAgICAgRm9yY2VEZWxldGVXaXRob3V0UmVjb3Zlcnk6IHRydWVcclxuICAgICAgfSkpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdGYWlsZWQgdG8gZGVsZXRlIHNlY3JldDonLCBlcnJvcik7XHJcbiAgICAgIC8vIENvbnRpbnVlIHdpdGggcGxhdGZvcm0gZGlzY29ubmVjdGlvbiBldmVuIGlmIHNlY3JldCBkZWxldGlvbiBmYWlsc1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlbW92ZSBwbGF0Zm9ybSBjb25uZWN0aW9uIGZyb20gRHluYW1vREJcclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBEZWxldGVDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBQTEFURk9STVNfVEFCTEUsXHJcbiAgICAgIEtleTogeyB1c2VySWQsIHBsYXRmb3JtIH1cclxuICAgIH0pKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgc3VjY2VzczogdHJ1ZSB9KVxyXG4gICAgfTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRGlzY29ubmVjdCBwbGF0Zm9ybSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdGYWlsZWQgdG8gZGlzY29ubmVjdCBwbGF0Zm9ybScgfSlcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjaGVja1Rva2VuU3RhdHVzKFxyXG4gIHVzZXJJZDogc3RyaW5nLCBcclxuICBwbGF0Zm9ybTogc3RyaW5nLCBcclxuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBQTEFURk9STVNfVEFCTEUsXHJcbiAgICAgIEtleTogeyB1c2VySWQsIHBsYXRmb3JtIH1cclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDA0LFxyXG4gICAgICAgIGhlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1BsYXRmb3JtIGNvbm5lY3Rpb24gbm90IGZvdW5kJyB9KVxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHRva2VuU3RhdHVzID0gYXdhaXQgY2hlY2tUb2tlblZhbGlkaXR5KHJlc3VsdC5JdGVtLnNlY3JldE5hbWUpO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICB2YWxpZDogdG9rZW5TdGF0dXMudmFsaWQsXHJcbiAgICAgICAgZXhwaXJlc0F0OiByZXN1bHQuSXRlbS5leHBpcmVzQXRcclxuICAgICAgfSlcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0NoZWNrIHRva2VuIHN0YXR1cyBlcnJvcjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdGYWlsZWQgdG8gY2hlY2sgdG9rZW4gc3RhdHVzJyB9KVxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hUb2tlbihcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsIFxyXG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICBjb25zdCBib2R5OiBUb2tlblJlZnJlc2hSZXF1ZXN0ID0gSlNPTi5wYXJzZShldmVudC5ib2R5IHx8ICd7fScpO1xyXG4gIGNvbnN0IHsgdXNlcklkLCBwbGF0Zm9ybSB9ID0gYm9keTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIEdldCBjdXJyZW50IGNyZWRlbnRpYWxzXHJcbiAgICBjb25zdCBwbGF0Zm9ybVJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBQTEFURk9STVNfVEFCTEUsXHJcbiAgICAgIEtleTogeyB1c2VySWQsIHBsYXRmb3JtIH1cclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXBsYXRmb3JtUmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgICAgaGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUGxhdGZvcm0gY29ubmVjdGlvbiBub3QgZm91bmQnIH0pXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY3JlZGVudGlhbHMgPSBhd2FpdCBnZXRDcmVkZW50aWFscyhwbGF0Zm9ybVJlc3VsdC5JdGVtLnNlY3JldE5hbWUpO1xyXG4gICAgXHJcbiAgICBpZiAoIWNyZWRlbnRpYWxzLnJlZnJlc2hUb2tlbikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdObyByZWZyZXNoIHRva2VuIGF2YWlsYWJsZScgfSlcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZWZyZXNoIHRoZSB0b2tlblxyXG4gICAgY29uc3QgbmV3VG9rZW5EYXRhID0gYXdhaXQgcGVyZm9ybVRva2VuUmVmcmVzaChwbGF0Zm9ybSwgY3JlZGVudGlhbHMucmVmcmVzaFRva2VuKTtcclxuICAgIFxyXG4gICAgLy8gVXBkYXRlIHN0b3JlZCBjcmVkZW50aWFsc1xyXG4gICAgYXdhaXQgc3RvcmVDcmVkZW50aWFscyhwbGF0Zm9ybVJlc3VsdC5JdGVtLnNlY3JldE5hbWUsIG5ld1Rva2VuRGF0YSk7XHJcbiAgICBcclxuICAgIC8vIFVwZGF0ZSBwbGF0Zm9ybSBjb25uZWN0aW9uXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogUExBVEZPUk1TX1RBQkxFLFxyXG4gICAgICBJdGVtOiB7XHJcbiAgICAgICAgLi4ucGxhdGZvcm1SZXN1bHQuSXRlbSxcclxuICAgICAgICBleHBpcmVzQXQ6IG5ld1Rva2VuRGF0YS5leHBpcmVzQXQsXHJcbiAgICAgICAgbGFzdFVzZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICB9XHJcbiAgICB9KSk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICB0b2tlbjoge1xyXG4gICAgICAgICAgYWNjZXNzVG9rZW46IG5ld1Rva2VuRGF0YS5hY2Nlc3NUb2tlbixcclxuICAgICAgICAgIGV4cGlyZXNBdDogbmV3VG9rZW5EYXRhLmV4cGlyZXNBdCxcclxuICAgICAgICAgIHRva2VuVHlwZTogbmV3VG9rZW5EYXRhLnRva2VuVHlwZSxcclxuICAgICAgICAgIHNjb3BlOiBuZXdUb2tlbkRhdGEuc2NvcGVcclxuICAgICAgICB9XHJcbiAgICAgIH0pXHJcbiAgICB9O1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdUb2tlbiByZWZyZXNoIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgaGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBcclxuICAgICAgICBlcnJvcjogJ1Rva2VuIHJlZnJlc2ggZmFpbGVkJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xyXG4gICAgICB9KVxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNoZWNrVG9rZW5WYWxpZGl0eShzZWNyZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHsgdmFsaWQ6IGJvb2xlYW4gfT4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBjcmVkZW50aWFscyA9IGF3YWl0IGdldENyZWRlbnRpYWxzKHNlY3JldE5hbWUpO1xyXG4gICAgY29uc3QgZXhwaXJlc0F0ID0gbmV3IERhdGUoY3JlZGVudGlhbHMuZXhwaXJlc0F0KTtcclxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICBcclxuICAgIHJldHVybiB7IHZhbGlkOiBleHBpcmVzQXQgPiBub3cgfTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgcmV0dXJuIHsgdmFsaWQ6IGZhbHNlIH07XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRDcmVkZW50aWFscyhzZWNyZXROYW1lOiBzdHJpbmcpIHtcclxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZWNyZXRzQ2xpZW50LnNlbmQobmV3IEdldFNlY3JldFZhbHVlQ29tbWFuZCh7XHJcbiAgICBTZWNyZXRJZDogc2VjcmV0TmFtZVxyXG4gIH0pKTtcclxuICBcclxuICBpZiAoIXJlc3VsdC5TZWNyZXRTdHJpbmcpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcignTm8gc2VjcmV0IHZhbHVlIGZvdW5kJyk7XHJcbiAgfVxyXG4gIFxyXG4gIHJldHVybiBKU09OLnBhcnNlKHJlc3VsdC5TZWNyZXRTdHJpbmcpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBwZXJmb3JtVG9rZW5SZWZyZXNoKHBsYXRmb3JtOiBzdHJpbmcsIHJlZnJlc2hUb2tlbjogc3RyaW5nKSB7XHJcbiAgY29uc3QgY29uZmlncyA9IHtcclxuICAgIG1lZGl1bToge1xyXG4gICAgICB0b2tlblVybDogJ2h0dHBzOi8vYXBpLm1lZGl1bS5jb20vdjEvdG9rZW5zJyxcclxuICAgICAgY2xpZW50SWQ6IHByb2Nlc3MuZW52Lk1FRElVTV9DTElFTlRfSUQhLFxyXG4gICAgICBjbGllbnRTZWNyZXQ6IHByb2Nlc3MuZW52Lk1FRElVTV9DTElFTlRfU0VDUkVUIVxyXG4gICAgfSxcclxuICAgIGxpbmtlZGluOiB7XHJcbiAgICAgIHRva2VuVXJsOiAnaHR0cHM6Ly93d3cubGlua2VkaW4uY29tL29hdXRoL3YyL2FjY2Vzc1Rva2VuJyxcclxuICAgICAgY2xpZW50SWQ6IHByb2Nlc3MuZW52LkxJTktFRElOX0NMSUVOVF9JRCEsXHJcbiAgICAgIGNsaWVudFNlY3JldDogcHJvY2Vzcy5lbnYuTElOS0VESU5fQ0xJRU5UX1NFQ1JFVCFcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBjb25zdCBjb25maWcgPSBjb25maWdzW3BsYXRmb3JtIGFzIGtleW9mIHR5cGVvZiBjb25maWdzXTtcclxuICBpZiAoIWNvbmZpZykge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBwbGF0Zm9ybTogJHtwbGF0Zm9ybX1gKTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xyXG4gICAgZ3JhbnRfdHlwZTogJ3JlZnJlc2hfdG9rZW4nLFxyXG4gICAgcmVmcmVzaF90b2tlbjogcmVmcmVzaFRva2VuLFxyXG4gICAgY2xpZW50X2lkOiBjb25maWcuY2xpZW50SWQsXHJcbiAgICBjbGllbnRfc2VjcmV0OiBjb25maWcuY2xpZW50U2VjcmV0XHJcbiAgfSk7XHJcblxyXG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goY29uZmlnLnRva2VuVXJsLCB7XHJcbiAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgIGhlYWRlcnM6IHtcclxuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnLFxyXG4gICAgICAnQWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24nXHJcbiAgICB9LFxyXG4gICAgYm9keTogcGFyYW1zLnRvU3RyaW5nKClcclxuICB9KTtcclxuXHJcbiAgaWYgKCFyZXNwb25zZS5vaykge1xyXG4gICAgY29uc3QgZXJyb3JUZXh0ID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpO1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGBUb2tlbiByZWZyZXNoIGZhaWxlZDogJHtyZXNwb25zZS5zdGF0dXN9ICR7ZXJyb3JUZXh0fWApO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgdG9rZW5SZXNwb25zZSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuICBcclxuICByZXR1cm4ge1xyXG4gICAgYWNjZXNzVG9rZW46IHRva2VuUmVzcG9uc2UuYWNjZXNzX3Rva2VuLFxyXG4gICAgcmVmcmVzaFRva2VuOiB0b2tlblJlc3BvbnNlLnJlZnJlc2hfdG9rZW4gfHwgcmVmcmVzaFRva2VuLCAvLyBTb21lIHBsYXRmb3JtcyBkb24ndCByZXR1cm4gbmV3IHJlZnJlc2ggdG9rZW5cclxuICAgIGV4cGlyZXNBdDogbmV3IERhdGUoRGF0ZS5ub3coKSArICh0b2tlblJlc3BvbnNlLmV4cGlyZXNfaW4gKiAxMDAwKSkudG9JU09TdHJpbmcoKSxcclxuICAgIHRva2VuVHlwZTogdG9rZW5SZXNwb25zZS50b2tlbl90eXBlIHx8ICdCZWFyZXInLFxyXG4gICAgc2NvcGU6IHRva2VuUmVzcG9uc2Uuc2NvcGUgPyB0b2tlblJlc3BvbnNlLnNjb3BlLnNwbGl0KCcgJykgOiBbXVxyXG4gIH07XHJcbn0iXX0=