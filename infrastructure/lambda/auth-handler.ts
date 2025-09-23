import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, CreateSecretCommand, UpdateSecretCommand, GetSecretValueCommand, DeleteSecretCommand } from '@aws-sdk/client-secrets-manager';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const secretsClient = new SecretsManagerClient({});

const PLATFORMS_TABLE = process.env.PLATFORMS_TABLE!;
const OAUTH_STATES_TABLE = process.env.OAUTH_STATES_TABLE!;

interface OAuthTokenExchangeRequest {
  code: string;
  platform: string;
  userId: string;
}

interface TokenRefreshRequest {
  userId: string;
  platform: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
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
  } catch (error) {
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

async function handleTokenExchange(
  event: APIGatewayProxyEvent, 
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: OAuthTokenExchangeRequest = JSON.parse(event.body || '{}');
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

    await docClient.send(new PutCommand({
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
  } catch (error) {
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

async function exchangeCodeForToken(code: string, platform: string) {
  const configs = {
    medium: {
      tokenUrl: 'https://api.medium.com/v1/tokens',
      clientId: process.env.MEDIUM_CLIENT_ID!,
      clientSecret: process.env.MEDIUM_CLIENT_SECRET!,
      redirectUri: process.env.MEDIUM_REDIRECT_URI!
    },
    linkedin: {
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      clientId: process.env.LINKEDIN_CLIENT_ID!,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET!,
      redirectUri: process.env.LINKEDIN_REDIRECT_URI!
    }
  };

  const config = configs[platform as keyof typeof configs];
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

async function storeCredentials(secretName: string, tokenData: any) {
  const secretValue = JSON.stringify({
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresAt: tokenData.expiresAt,
    tokenType: tokenData.tokenType,
    scope: tokenData.scope
  });

  try {
    // Try to update existing secret first
    await secretsClient.send(new UpdateSecretCommand({
      SecretId: secretName,
      SecretString: secretValue
    }));
  } catch (error) {
    // If secret doesn't exist, create it
    await secretsClient.send(new CreateSecretCommand({
      Name: secretName,
      SecretString: secretValue,
      Description: `OAuth credentials for platform authentication`
    }));
  }
}

async function getConnectedPlatforms(
  userId: string, 
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: PLATFORMS_TABLE,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId
      }
    }));

    const platforms = result.Items || [];
    
    // Check token status for each platform
    const platformsWithStatus = await Promise.all(
      platforms.map(async (platform) => {
        const tokenStatus = await checkTokenValidity(platform.secretName);
        return {
          platform: platform.platform,
          isActive: platform.isActive && tokenStatus.valid,
          connectedAt: platform.connectedAt,
          lastUsed: platform.lastUsed,
          expiresAt: platform.expiresAt,
          needsRenewal: !tokenStatus.valid
        };
      })
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(platformsWithStatus)
    };
  } catch (error) {
    console.error('Get platforms error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch platforms' })
    };
  }
}

async function disconnectPlatform(
  userId: string, 
  platform: string, 
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    // Get platform connection to find secret name
    const result = await docClient.send(new GetCommand({
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
      await secretsClient.send(new DeleteSecretCommand({
        SecretId: result.Item.secretName,
        ForceDeleteWithoutRecovery: true
      }));
    } catch (error) {
      console.warn('Failed to delete secret:', error);
      // Continue with platform disconnection even if secret deletion fails
    }

    // Remove platform connection from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: PLATFORMS_TABLE,
      Key: { userId, platform }
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('Disconnect platform error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to disconnect platform' })
    };
  }
}

async function checkTokenStatus(
  userId: string, 
  platform: string, 
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(new GetCommand({
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
  } catch (error) {
    console.error('Check token status error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to check token status' })
    };
  }
}

async function refreshToken(
  event: APIGatewayProxyEvent, 
  headers: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: TokenRefreshRequest = JSON.parse(event.body || '{}');
  const { userId, platform } = body;

  try {
    // Get current credentials
    const platformResult = await docClient.send(new GetCommand({
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
    await docClient.send(new PutCommand({
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
  } catch (error) {
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

async function checkTokenValidity(secretName: string): Promise<{ valid: boolean }> {
  try {
    const credentials = await getCredentials(secretName);
    const expiresAt = new Date(credentials.expiresAt);
    const now = new Date();
    
    return { valid: expiresAt > now };
  } catch (error) {
    return { valid: false };
  }
}

async function getCredentials(secretName: string) {
  const result = await secretsClient.send(new GetSecretValueCommand({
    SecretId: secretName
  }));
  
  if (!result.SecretString) {
    throw new Error('No secret value found');
  }
  
  return JSON.parse(result.SecretString);
}

async function performTokenRefresh(platform: string, refreshToken: string) {
  const configs = {
    medium: {
      tokenUrl: 'https://api.medium.com/v1/tokens',
      clientId: process.env.MEDIUM_CLIENT_ID!,
      clientSecret: process.env.MEDIUM_CLIENT_SECRET!
    },
    linkedin: {
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      clientId: process.env.LINKEDIN_CLIENT_ID!,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET!
    }
  };

  const config = configs[platform as keyof typeof configs];
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
    refreshToken: tokenResponse.refresh_token || refreshToken, // Some platforms don't return new refresh token
    expiresAt: new Date(Date.now() + (tokenResponse.expires_in * 1000)).toISOString(),
    tokenType: tokenResponse.token_type || 'Bearer',
    scope: tokenResponse.scope ? tokenResponse.scope.split(' ') : []
  };
}