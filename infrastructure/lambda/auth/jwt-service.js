"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWTService = void 0;
const jwt = __importStar(require("jsonwebtoken"));
const crypto = __importStar(require("crypto"));
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
class JWTService {
    constructor() {
        this.accessTokenExpiry = '15m'; // 15 minutes
        this.refreshTokenExpiry = '7d'; // 7 days
        const client = new client_dynamodb_1.DynamoDBClient({});
        this.dynamoClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client);
        // In production, these should come from AWS Secrets Manager
        this.jwtSecret = process.env.JWT_SECRET || this.generateSecret();
        this.refreshSecret = process.env.REFRESH_SECRET || this.generateSecret();
        this.tokensTableName = process.env.TOKENS_TABLE_NAME || '';
    }
    /**
     * Generate a secure random secret
     */
    generateSecret() {
        return crypto.randomBytes(64).toString('hex');
    }
    /**
     * Generate access and refresh tokens for a user
     */
    async generateTokens(userId, email) {
        const tokenId = crypto.randomUUID();
        const now = Math.floor(Date.now() / 1000);
        // Create access token
        const accessPayload = {
            userId,
            email,
            iat: now,
            exp: now + (15 * 60),
            jti: tokenId,
        };
        const accessToken = jwt.sign(accessPayload, this.jwtSecret, {
            algorithm: 'HS256',
        });
        // Create refresh token
        const refreshPayload = {
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
    async verifyAccessToken(token) {
        try {
            const payload = jwt.verify(token, this.jwtSecret, {
                algorithms: ['HS256'],
            });
            // Check if token has been revoked
            const isRevoked = await this.isTokenRevoked(payload.jti);
            if (isRevoked) {
                throw new Error('Token has been revoked');
            }
            return payload;
        }
        catch (error) {
            throw new Error(`Invalid access token: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Verify and decode a refresh token
     */
    async verifyRefreshToken(token) {
        try {
            const payload = jwt.verify(token, this.refreshSecret, {
                algorithms: ['HS256'],
            });
            // Check if refresh token exists in database
            const storedToken = await this.getRefreshToken(payload.tokenId);
            if (!storedToken || storedToken.userId !== payload.userId) {
                throw new Error('Refresh token not found or invalid');
            }
            return payload;
        }
        catch (error) {
            throw new Error(`Invalid refresh token: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken(refreshToken) {
        const refreshPayload = await this.verifyRefreshToken(refreshToken);
        // Get user details (in a real implementation, you'd fetch from user table)
        const storedToken = await this.getRefreshToken(refreshPayload.tokenId);
        if (!storedToken) {
            throw new Error('Refresh token not found');
        }
        const now = Math.floor(Date.now() / 1000);
        const accessPayload = {
            userId: refreshPayload.userId,
            email: storedToken.email,
            iat: now,
            exp: now + (15 * 60),
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
    async revokeToken(tokenId) {
        await this.dynamoClient.send(new lib_dynamodb_1.DeleteCommand({
            TableName: this.tokensTableName,
            Key: { tokenId },
        }));
    }
    /**
     * Revoke all tokens for a user
     */
    async revokeAllUserTokens(userId) {
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
    async storeRefreshToken(tokenId, userId, expiresAt) {
        await this.dynamoClient.send(new lib_dynamodb_1.PutCommand({
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
    async getRefreshToken(tokenId) {
        const result = await this.dynamoClient.send(new lib_dynamodb_1.GetCommand({
            TableName: this.tokensTableName,
            Key: { tokenId },
        }));
        return result.Item;
    }
    /**
     * Check if a token has been revoked
     */
    async isTokenRevoked(tokenId) {
        const token = await this.getRefreshToken(tokenId);
        return !token; // If token doesn't exist, it's been revoked
    }
    /**
     * Get all tokens for a user (simplified implementation)
     */
    async getUserTokens(userId) {
        // This would require a GSI on userId in a real implementation
        // For now, return empty array as placeholder
        return [];
    }
    /**
     * Clean up expired tokens (should be called periodically)
     */
    async cleanupExpiredTokens() {
        const now = Math.floor(Date.now() / 1000);
        // In a real implementation, you'd scan the table and delete expired tokens
        // This is a placeholder for the cleanup logic
        console.log(`Cleaning up tokens expired before ${now}`);
    }
}
exports.JWTService = JWTService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiand0LXNlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJqd3Qtc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGtEQUFvQztBQUNwQywrQ0FBaUM7QUFDakMsOERBQTBEO0FBQzFELHdEQUFzRztBQWlCdEcsTUFBYSxVQUFVO0lBUXJCO1FBSGlCLHNCQUFpQixHQUFHLEtBQUssQ0FBQyxDQUFDLGFBQWE7UUFDeEMsdUJBQWtCLEdBQUcsSUFBSSxDQUFDLENBQUMsU0FBUztRQUduRCxNQUFNLE1BQU0sR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDdEMsSUFBSSxDQUFDLFlBQVksR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFeEQsNERBQTREO1FBQzVELElBQUksQ0FBQyxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ2pFLElBQUksQ0FBQyxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBQ3pFLElBQUksQ0FBQyxlQUFlLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsSUFBSSxFQUFFLENBQUM7SUFDN0QsQ0FBQztJQUVEOztPQUVHO0lBQ0ssY0FBYztRQUNwQixPQUFPLE1BQU0sQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsTUFBYyxFQUFFLEtBQWE7UUFLaEQsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ3BDLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFD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RCxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsNENBQTRDO0lBQzdELENBQUM7SUFFRDs7T0FFRztJQUNLLEtBQUssQ0FBQyxhQUFhLENBQUMsTUFBYztRQUN4Qyw4REFBOEQ7UUFDOUQsNkNBQTZDO1FBQzdDLE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQjtRQUN4QixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQztRQUUxQywyRUFBMkU7UUFDM0UsOENBQThDO1FBQzlDLE9BQU8sQ0FBQyxHQUFHLENBQUMscUNBQXFDLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDMUQsQ0FBQztDQUNGO0FBak9ELGdDQWlPQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGp3dCBmcm9tICdqc29ud2VidG9rZW4nO1xyXG5pbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnY3J5cHRvJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBHZXRDb21tYW5kLCBQdXRDb21tYW5kLCBEZWxldGVDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgSldUUGF5bG9hZCB7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgZW1haWw6IHN0cmluZztcclxuICBpYXQ6IG51bWJlcjtcclxuICBleHA6IG51bWJlcjtcclxuICBqdGk6IHN0cmluZzsgLy8gSldUIElEIGZvciB0b2tlbiByZXZvY2F0aW9uXHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgUmVmcmVzaFRva2VuUGF5bG9hZCB7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgdG9rZW5JZDogc3RyaW5nO1xyXG4gIGlhdDogbnVtYmVyO1xyXG4gIGV4cDogbnVtYmVyO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgSldUU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBkeW5hbW9DbGllbnQ6IER5bmFtb0RCRG9jdW1lbnRDbGllbnQ7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBqd3RTZWNyZXQ6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHJlZnJlc2hTZWNyZXQ6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHRva2Vuc1RhYmxlTmFtZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgYWNjZXNzVG9rZW5FeHBpcnkgPSAnMTVtJzsgLy8gMTUgbWludXRlc1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcmVmcmVzaFRva2VuRXhwaXJ5ID0gJzdkJzsgLy8gNyBkYXlzXHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgY29uc3QgY2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcclxuICAgIHRoaXMuZHluYW1vQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGNsaWVudCk7XHJcbiAgICBcclxuICAgIC8vIEluIHByb2R1Y3Rpb24sIHRoZXNlIHNob3VsZCBjb21lIGZyb20gQVdTIFNlY3JldHMgTWFuYWdlclxyXG4gICAgdGhpcy5qd3RTZWNyZXQgPSBwcm9jZXNzLmVudi5KV1RfU0VDUkVUIHx8IHRoaXMuZ2VuZXJhdGVTZWNyZXQoKTtcclxuICAgIHRoaXMucmVmcmVzaFNlY3JldCA9IHByb2Nlc3MuZW52LlJFRlJFU0hfU0VDUkVUIHx8IHRoaXMuZ2VuZXJhdGVTZWNyZXQoKTtcclxuICAgIHRoaXMudG9rZW5zVGFibGVOYW1lID0gcHJvY2Vzcy5lbnYuVE9LRU5TX1RBQkxFX05BTUUgfHwgJyc7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZW5lcmF0ZSBhIHNlY3VyZSByYW5kb20gc2VjcmV0XHJcbiAgICovXHJcbiAgcHJpdmF0ZSBnZW5lcmF0ZVNlY3JldCgpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGNyeXB0by5yYW5kb21CeXRlcyg2NCkudG9TdHJpbmcoJ2hleCcpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2VuZXJhdGUgYWNjZXNzIGFuZCByZWZyZXNoIHRva2VucyBmb3IgYSB1c2VyXHJcbiAgICovXHJcbiAgYXN5bmMgZ2VuZXJhdGVUb2tlbnModXNlcklkOiBzdHJpbmcsIGVtYWlsOiBzdHJpbmcpOiBQcm9taXNlPHtcclxuICAgIGFjY2Vzc1Rva2VuOiBzdHJpbmc7XHJcbiAgICByZWZyZXNoVG9rZW46IHN0cmluZztcclxuICAgIGV4cGlyZXNJbjogbnVtYmVyO1xyXG4gIH0+IHtcclxuICAgIGNvbnN0IHRva2VuSWQgPSBjcnlwdG8ucmFuZG9tVVVJRCgpO1xyXG4gICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSBhY2Nlc3MgdG9rZW5cclxuICAgIGNvbnN0IGFjY2Vzc1BheWxvYWQ6IEpXVFBheWxvYWQgPSB7XHJcbiAgICAgIHVzZXJJZCxcclxuICAgICAgZW1haWwsXHJcbiAgICAgIGlhdDogbm93LFxyXG4gICAgICBleHA6IG5vdyArICgxNSAqIDYwKSwgLy8gMTUgbWludXRlc1xyXG4gICAgICBqdGk6IHRva2VuSWQsXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGFjY2Vzc1Rva2VuID0gand0LnNpZ24oYWNjZXNzUGF5bG9hZCwgdGhpcy5qd3RTZWNyZXQsIHtcclxuICAgICAgYWxnb3JpdGhtOiAnSFMyNTYnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIHJlZnJlc2ggdG9rZW5cclxuICAgIGNvbnN0IHJlZnJlc2hQYXlsb2FkOiBSZWZyZXNoVG9rZW5QYXlsb2FkID0ge1xyXG4gICAgICB1c2VySWQsXHJcbiAgICAgIHRva2VuSWQsXHJcbiAgICAgIGlhdDogbm93LFxyXG4gICAgICBleHA6IG5vdyArICg3ICogMjQgKiA2MCAqIDYwKSwgLy8gNyBkYXlzXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlZnJlc2hUb2tlbiA9IGp3dC5zaWduKHJlZnJlc2hQYXlsb2FkLCB0aGlzLnJlZnJlc2hTZWNyZXQsIHtcclxuICAgICAgYWxnb3JpdGhtOiAnSFMyNTYnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU3RvcmUgcmVmcmVzaCB0b2tlbiBpbiBEeW5hbW9EQiBmb3IgcmV2b2NhdGlvbiBjYXBhYmlsaXR5XHJcbiAgICBhd2FpdCB0aGlzLnN0b3JlUmVmcmVzaFRva2VuKHRva2VuSWQsIHVzZXJJZCwgcmVmcmVzaFBheWxvYWQuZXhwKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBhY2Nlc3NUb2tlbixcclxuICAgICAgcmVmcmVzaFRva2VuLFxyXG4gICAgICBleHBpcmVzSW46IDE1ICogNjAsIC8vIDE1IG1pbnV0ZXMgaW4gc2Vjb25kc1xyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFZlcmlmeSBhbmQgZGVjb2RlIGFuIGFjY2VzcyB0b2tlblxyXG4gICAqL1xyXG4gIGFzeW5jIHZlcmlmeUFjY2Vzc1Rva2VuKHRva2VuOiBzdHJpbmcpOiBQcm9taXNlPEpXVFBheWxvYWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSBqd3QudmVyaWZ5KHRva2VuLCB0aGlzLmp3dFNlY3JldCwge1xyXG4gICAgICAgIGFsZ29yaXRobXM6IFsnSFMyNTYnXSxcclxuICAgICAgfSkgYXMgSldUUGF5bG9hZDtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHRva2VuIGhhcyBiZWVuIHJldm9rZWRcclxuICAgICAgY29uc3QgaXNSZXZva2VkID0gYXdhaXQgdGhpcy5pc1Rva2VuUmV2b2tlZChwYXlsb2FkLmp0aSk7XHJcbiAgICAgIGlmIChpc1Jldm9rZWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Rva2VuIGhhcyBiZWVuIHJldm9rZWQnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHBheWxvYWQ7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYWNjZXNzIHRva2VuOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogVmVyaWZ5IGFuZCBkZWNvZGUgYSByZWZyZXNoIHRva2VuXHJcbiAgICovXHJcbiAgYXN5bmMgdmVyaWZ5UmVmcmVzaFRva2VuKHRva2VuOiBzdHJpbmcpOiBQcm9taXNlPFJlZnJlc2hUb2tlblBheWxvYWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSBqd3QudmVyaWZ5KHRva2VuLCB0aGlzLnJlZnJlc2hTZWNyZXQsIHtcclxuICAgICAgICBhbGdvcml0aG1zOiBbJ0hTMjU2J10sXHJcbiAgICAgIH0pIGFzIFJlZnJlc2hUb2tlblBheWxvYWQ7XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiByZWZyZXNoIHRva2VuIGV4aXN0cyBpbiBkYXRhYmFzZVxyXG4gICAgICBjb25zdCBzdG9yZWRUb2tlbiA9IGF3YWl0IHRoaXMuZ2V0UmVmcmVzaFRva2VuKHBheWxvYWQudG9rZW5JZCk7XHJcbiAgICAgIGlmICghc3RvcmVkVG9rZW4gfHwgc3RvcmVkVG9rZW4udXNlcklkICE9PSBwYXlsb2FkLnVzZXJJZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUmVmcmVzaCB0b2tlbiBub3QgZm91bmQgb3IgaW52YWxpZCcpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gcGF5bG9hZDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWZyZXNoIHRva2VuOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InfWApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUmVmcmVzaCBhY2Nlc3MgdG9rZW4gdXNpbmcgcmVmcmVzaCB0b2tlblxyXG4gICAqL1xyXG4gIGFzeW5jIHJlZnJlc2hBY2Nlc3NUb2tlbihyZWZyZXNoVG9rZW46IHN0cmluZyk6IFByb21pc2U8e1xyXG4gICAgYWNjZXNzVG9rZW46IHN0cmluZztcclxuICAgIGV4cGlyZXNJbjogbnVtYmVyO1xyXG4gIH0+IHtcclxuICAgIGNvbnN0IHJlZnJlc2hQYXlsb2FkID0gYXdhaXQgdGhpcy52ZXJpZnlSZWZyZXNoVG9rZW4ocmVmcmVzaFRva2VuKTtcclxuICAgIFxyXG4gICAgLy8gR2V0IHVzZXIgZGV0YWlscyAoaW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3UnZCBmZXRjaCBmcm9tIHVzZXIgdGFibGUpXHJcbiAgICBjb25zdCBzdG9yZWRUb2tlbiA9IGF3YWl0IHRoaXMuZ2V0UmVmcmVzaFRva2VuKHJlZnJlc2hQYXlsb2FkLnRva2VuSWQpO1xyXG4gICAgaWYgKCFzdG9yZWRUb2tlbikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlZnJlc2ggdG9rZW4gbm90IGZvdW5kJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICBjb25zdCBhY2Nlc3NQYXlsb2FkOiBKV1RQYXlsb2FkID0ge1xyXG4gICAgICB1c2VySWQ6IHJlZnJlc2hQYXlsb2FkLnVzZXJJZCxcclxuICAgICAgZW1haWw6IHN0b3JlZFRva2VuLmVtYWlsLFxyXG4gICAgICBpYXQ6IG5vdyxcclxuICAgICAgZXhwOiBub3cgKyAoMTUgKiA2MCksIC8vIDE1IG1pbnV0ZXNcclxuICAgICAganRpOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBhY2Nlc3NUb2tlbiA9IGp3dC5zaWduKGFjY2Vzc1BheWxvYWQsIHRoaXMuand0U2VjcmV0LCB7XHJcbiAgICAgIGFsZ29yaXRobTogJ0hTMjU2JyxcclxuICAgIH0pO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIGFjY2Vzc1Rva2VuLFxyXG4gICAgICBleHBpcmVzSW46IDE1ICogNjAsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUmV2b2tlIGEgc3BlY2lmaWMgdG9rZW5cclxuICAgKi9cclxuICBhc3luYyByZXZva2VUb2tlbih0b2tlbklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGF3YWl0IHRoaXMuZHluYW1vQ2xpZW50LnNlbmQobmV3IERlbGV0ZUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudG9rZW5zVGFibGVOYW1lLFxyXG4gICAgICBLZXk6IHsgdG9rZW5JZCB9LFxyXG4gICAgfSkpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUmV2b2tlIGFsbCB0b2tlbnMgZm9yIGEgdXNlclxyXG4gICAqL1xyXG4gIGFzeW5jIHJldm9rZUFsbFVzZXJUb2tlbnModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIEluIGEgcmVhbCBpbXBsZW1lbnRhdGlvbiwgeW91J2QgbmVlZCBhIEdTSSBvbiB1c2VySWQgdG8gZWZmaWNpZW50bHkgcXVlcnkgYW5kIGRlbGV0ZSBhbGwgdG9rZW5zXHJcbiAgICAvLyBGb3Igbm93LCB3ZSdsbCBpbXBsZW1lbnQgYSBzaW1wbGUgYXBwcm9hY2hcclxuICAgIGNvbnN0IHRva2VucyA9IGF3YWl0IHRoaXMuZ2V0VXNlclRva2Vucyh1c2VySWQpO1xyXG4gICAgXHJcbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIHRva2Vucykge1xyXG4gICAgICBhd2FpdCB0aGlzLnJldm9rZVRva2VuKHRva2VuLnRva2VuSWQpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU3RvcmUgcmVmcmVzaCB0b2tlbiBpbiBEeW5hbW9EQlxyXG4gICAqL1xyXG4gIHByaXZhdGUgYXN5bmMgc3RvcmVSZWZyZXNoVG9rZW4odG9rZW5JZDogc3RyaW5nLCB1c2VySWQ6IHN0cmluZywgZXhwaXJlc0F0OiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGF3YWl0IHRoaXMuZHluYW1vQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudG9rZW5zVGFibGVOYW1lLFxyXG4gICAgICBJdGVtOiB7XHJcbiAgICAgICAgdG9rZW5JZCxcclxuICAgICAgICB1c2VySWQsXHJcbiAgICAgICAgZXhwaXJlc0F0LFxyXG4gICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIHR5cGU6ICdyZWZyZXNoJyxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldCByZWZyZXNoIHRva2VuIGZyb20gRHluYW1vREJcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGdldFJlZnJlc2hUb2tlbih0b2tlbklkOiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5keW5hbW9DbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy50b2tlbnNUYWJsZU5hbWUsXHJcbiAgICAgIEtleTogeyB0b2tlbklkIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdC5JdGVtO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2hlY2sgaWYgYSB0b2tlbiBoYXMgYmVlbiByZXZva2VkXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyBpc1Rva2VuUmV2b2tlZCh0b2tlbklkOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGNvbnN0IHRva2VuID0gYXdhaXQgdGhpcy5nZXRSZWZyZXNoVG9rZW4odG9rZW5JZCk7XHJcbiAgICByZXR1cm4gIXRva2VuOyAvLyBJZiB0b2tlbiBkb2Vzbid0IGV4aXN0LCBpdCdzIGJlZW4gcmV2b2tlZFxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0IGFsbCB0b2tlbnMgZm9yIGEgdXNlciAoc2ltcGxpZmllZCBpbXBsZW1lbnRhdGlvbilcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGdldFVzZXJUb2tlbnModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPGFueVtdPiB7XHJcbiAgICAvLyBUaGlzIHdvdWxkIHJlcXVpcmUgYSBHU0kgb24gdXNlcklkIGluIGEgcmVhbCBpbXBsZW1lbnRhdGlvblxyXG4gICAgLy8gRm9yIG5vdywgcmV0dXJuIGVtcHR5IGFycmF5IGFzIHBsYWNlaG9sZGVyXHJcbiAgICByZXR1cm4gW107XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDbGVhbiB1cCBleHBpcmVkIHRva2VucyAoc2hvdWxkIGJlIGNhbGxlZCBwZXJpb2RpY2FsbHkpXHJcbiAgICovXHJcbiAgYXN5bmMgY2xlYW51cEV4cGlyZWRUb2tlbnMoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgIFxyXG4gICAgLy8gSW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3UnZCBzY2FuIHRoZSB0YWJsZSBhbmQgZGVsZXRlIGV4cGlyZWQgdG9rZW5zXHJcbiAgICAvLyBUaGlzIGlzIGEgcGxhY2Vob2xkZXIgZm9yIHRoZSBjbGVhbnVwIGxvZ2ljXHJcbiAgICBjb25zb2xlLmxvZyhgQ2xlYW5pbmcgdXAgdG9rZW5zIGV4cGlyZWQgYmVmb3JlICR7bm93fWApO1xyXG4gIH1cclxufSJdfQ==