export interface JWTPayload {
    userId: string;
    email: string;
    iat: number;
    exp: number;
    jti: string;
}
export interface RefreshTokenPayload {
    userId: string;
    tokenId: string;
    iat: number;
    exp: number;
}
export declare class JWTService {
    private readonly dynamoClient;
    private readonly jwtSecret;
    private readonly refreshSecret;
    private readonly tokensTableName;
    private readonly accessTokenExpiry;
    private readonly refreshTokenExpiry;
    constructor();
    /**
     * Generate a secure random secret
     */
    private generateSecret;
    /**
     * Generate access and refresh tokens for a user
     */
    generateTokens(userId: string, email: string): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    }>;
    /**
     * Verify and decode an access token
     */
    verifyAccessToken(token: string): Promise<JWTPayload>;
    /**
     * Verify and decode a refresh token
     */
    verifyRefreshToken(token: string): Promise<RefreshTokenPayload>;
    /**
     * Refresh access token using refresh token
     */
    refreshAccessToken(refreshToken: string): Promise<{
        accessToken: string;
        expiresIn: number;
    }>;
    /**
     * Revoke a specific token
     */
    revokeToken(tokenId: string): Promise<void>;
    /**
     * Revoke all tokens for a user
     */
    revokeAllUserTokens(userId: string): Promise<void>;
    /**
     * Store refresh token in DynamoDB
     */
    private storeRefreshToken;
    /**
     * Get refresh token from DynamoDB
     */
    private getRefreshToken;
    /**
     * Check if a token has been revoked
     */
    private isTokenRevoked;
    /**
     * Get all tokens for a user (simplified implementation)
     */
    private getUserTokens;
    /**
     * Clean up expired tokens (should be called periodically)
     */
    cleanupExpiredTokens(): Promise<void>;
}
