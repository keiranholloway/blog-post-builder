import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

export interface JWTPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
  jti: string; // JWT ID for token revocation
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
  iat: number;
  exp: number;
}

export class JWTService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly jwtSecret: string;
  private readonly refreshSecret: string;
  private readonly tokensTableName: string;
  private readonly accessTokenExpiry = '15m'; // 15 minutes
  private readonly refreshTokenExpiry = '7d'; // 7 days

  constructor() {
    const client = new DynamoDBClient({});
    this.dynamoClient = DynamoDBDocumentClient.from(client);
    
    // In production, these should come from AWS Secrets Manager
    this.jwtSecret = process.env.JWT_SECRET || this.generateSecret();
    this.refreshSecret = process.env.REFRESH_SECRET || this.generateSecret();
    this.tokensTableName = process.env.TOKENS_TABLE_NAME || '';
  }

  /**
   * Generate a secure random secret
   */
  private generateSecret(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Generate access and refresh tokens for a user
   */
  async generateTokens(userId: string, email: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const tokenId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    
    // Create access token
    const accessPayload: JWTPayload = {
      userId,
      email,
      iat: now,
      exp: now + (15 * 60), // 15 minutes
      jti: tokenId,
    };

    const accessToken = jwt.sign(accessPayload, this.jwtSecret, {
      algorithm: 'HS256',
    });

    // Create refresh token
    const refreshPayload: RefreshTokenPayload = {
      userId,
      tokenId,
      iat: now,
      exp: now + (7 * 24 * 60 * 60), // 7 days
    };

    const refreshToken = jwt.sign(refreshPayload, this.refreshSecret, {
      algorithm: 'HS256',
    });

    // Store refresh token in DynamoDB for revocation capability
    await this.storeRefreshToken(tokenId, userId, refreshPayload.exp);

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
    };
  }

  /**
   * Verify and decode an access token
   */
  async verifyAccessToken(token: string): Promise<JWTPayload> {
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as JWTPayload;

      // Check if token has been revoked
      const isRevoked = await this.isTokenRevoked(payload.jti);
      if (isRevoked) {
        throw new Error('Token has been revoked');
      }

      return payload;
    } catch (error) {
      throw new Error(`Invalid access token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify and decode a refresh token
   */
  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = jwt.verify(token, this.refreshSecret, {
        algorithms: ['HS256'],
      }) as RefreshTokenPayload;

      // Check if refresh token exists in database
      const storedToken = await this.getRefreshToken(payload.tokenId);
      if (!storedToken || storedToken.userId !== payload.userId) {
        throw new Error('Refresh token not found or invalid');
      }

      return payload;
    } catch (error) {
      throw new Error(`Invalid refresh token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const refreshPayload = await this.verifyRefreshToken(refreshToken);
    
    // Get user details (in a real implementation, you'd fetch from user table)
    const storedToken = await this.getRefreshToken(refreshPayload.tokenId);
    if (!storedToken) {
      throw new Error('Refresh token not found');
    }

    const now = Math.floor(Date.now() / 1000);
    const accessPayload: JWTPayload = {
      userId: refreshPayload.userId,
      email: storedToken.email,
      iat: now,
      exp: now + (15 * 60), // 15 minutes
      jti: crypto.randomUUID(),
    };

    const accessToken = jwt.sign(accessPayload, this.jwtSecret, {
      algorithm: 'HS256',
    });

    return {
      accessToken,
      expiresIn: 15 * 60,
    };
  }

  /**
   * Revoke a specific token
   */
  async revokeToken(tokenId: string): Promise<void> {
    await this.dynamoClient.send(new DeleteCommand({
      TableName: this.tokensTableName,
      Key: { tokenId },
    }));
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    // In a real implementation, you'd need a GSI on userId to efficiently query and delete all tokens
    // For now, we'll implement a simple approach
    const tokens = await this.getUserTokens(userId);
    
    for (const token of tokens) {
      await this.revokeToken(token.tokenId);
    }
  }

  /**
   * Store refresh token in DynamoDB
   */
  private async storeRefreshToken(tokenId: string, userId: string, expiresAt: number): Promise<void> {
    await this.dynamoClient.send(new PutCommand({
      TableName: this.tokensTableName,
      Item: {
        tokenId,
        userId,
        expiresAt,
        createdAt: new Date().toISOString(),
        type: 'refresh',
      },
    }));
  }

  /**
   * Get refresh token from DynamoDB
   */
  private async getRefreshToken(tokenId: string): Promise<any> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: this.tokensTableName,
      Key: { tokenId },
    }));

    return result.Item;
  }

  /**
   * Check if a token has been revoked
   */
  private async isTokenRevoked(tokenId: string): Promise<boolean> {
    const token = await this.getRefreshToken(tokenId);
    return !token; // If token doesn't exist, it's been revoked
  }

  /**
   * Get all tokens for a user (simplified implementation)
   */
  private async getUserTokens(userId: string): Promise<any[]> {
    // This would require a GSI on userId in a real implementation
    // For now, return empty array as placeholder
    return [];
  }

  /**
   * Clean up expired tokens (should be called periodically)
   */
  async cleanupExpiredTokens(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    
    // In a real implementation, you'd scan the table and delete expired tokens
    // This is a placeholder for the cleanup logic
    console.log(`Cleaning up tokens expired before ${now}`);
  }
}