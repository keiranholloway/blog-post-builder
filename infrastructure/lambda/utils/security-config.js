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
exports.SecurityConfigService = void 0;
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
const crypto = __importStar(require("crypto"));
class SecurityConfigService {
    constructor() {
        this.cachedConfig = null;
        this.secretsClient = new client_secrets_manager_1.SecretsManagerClient({});
        this.secretName = process.env.SECURITY_CONFIG_SECRET || 'automated-blog-poster/security-config';
    }
    /**
     * Get security configuration
     */
    async getSecurityConfig() {
        if (this.cachedConfig) {
            return this.cachedConfig;
        }
        try {
            const result = await this.secretsClient.send(new client_secrets_manager_1.GetSecretValueCommand({
                SecretId: this.secretName,
            }));
            if (result.SecretString) {
                this.cachedConfig = JSON.parse(result.SecretString);
                return this.cachedConfig;
            }
        }
        catch (error) {
            console.log('Security config not found, creating default configuration');
        }
        // Create default configuration if not found
        const defaultConfig = this.createDefaultConfig();
        await this.createSecurityConfig(defaultConfig);
        this.cachedConfig = defaultConfig;
        return defaultConfig;
    }
    /**
     * Create default security configuration
     */
    createDefaultConfig() {
        return {
            jwtSecret: this.generateSecureSecret(),
            refreshSecret: this.generateSecureSecret(),
            encryptionKey: this.generateSecureSecret(),
            corsOrigins: [
                'https://keiranholloway.github.io',
                'http://localhost:3000',
                'http://localhost:5173',
            ],
            rateLimits: {
                authenticated: 1000,
                anonymous: 100,
                windowMinutes: 15,
            },
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
        };
    }
    /**
     * Create security configuration in Secrets Manager
     */
    async createSecurityConfig(config) {
        try {
            await this.secretsClient.send(new client_secrets_manager_1.CreateSecretCommand({
                Name: this.secretName,
                Description: 'Security configuration for automated blog poster',
                SecretString: JSON.stringify(config, null, 2),
            }));
        }
        catch (error) {
            // If secret already exists, update it
            await this.secretsClient.send(new client_secrets_manager_1.UpdateSecretCommand({
                SecretId: this.secretName,
                SecretString: JSON.stringify(config, null, 2),
            }));
        }
    }
    /**
     * Update security configuration
     */
    async updateSecurityConfig(updates) {
        const currentConfig = await this.getSecurityConfig();
        const updatedConfig = { ...currentConfig, ...updates };
        await this.secretsClient.send(new client_secrets_manager_1.UpdateSecretCommand({
            SecretId: this.secretName,
            SecretString: JSON.stringify(updatedConfig, null, 2),
        }));
        this.cachedConfig = updatedConfig;
        return updatedConfig;
    }
    /**
     * Rotate JWT secrets
     */
    async rotateJWTSecrets() {
        const config = await this.getSecurityConfig();
        const updatedConfig = {
            ...config,
            jwtSecret: this.generateSecureSecret(),
            refreshSecret: this.generateSecureSecret(),
        };
        await this.updateSecurityConfig(updatedConfig);
        console.log('JWT secrets rotated successfully');
    }
    /**
     * Generate a cryptographically secure secret
     */
    generateSecureSecret() {
        return crypto.randomBytes(64).toString('hex');
    }
    /**
     * Validate password against policy
     */
    validatePassword(password, policy) {
        const config = policy || this.cachedConfig?.passwordPolicy || this.createDefaultConfig().passwordPolicy;
        const errors = [];
        if (password.length < config.minLength) {
            errors.push(`Password must be at least ${config.minLength} characters long`);
        }
        if (config.requireUppercase && !/[A-Z]/.test(password)) {
            errors.push('Password must contain at least one uppercase letter');
        }
        if (config.requireLowercase && !/[a-z]/.test(password)) {
            errors.push('Password must contain at least one lowercase letter');
        }
        if (config.requireNumbers && !/\d/.test(password)) {
            errors.push('Password must contain at least one number');
        }
        if (config.requireSymbols && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            errors.push('Password must contain at least one special character');
        }
        return {
            isValid: errors.length === 0,
            errors,
        };
    }
    /**
     * Check if origin is allowed
     */
    async isOriginAllowed(origin) {
        const config = await this.getSecurityConfig();
        return config.corsOrigins.includes(origin) || config.corsOrigins.includes('*');
    }
    /**
     * Get rate limit for user type
     */
    async getRateLimit(isAuthenticated) {
        const config = await this.getSecurityConfig();
        return {
            limit: isAuthenticated ? config.rateLimits.authenticated : config.rateLimits.anonymous,
            windowMinutes: config.rateLimits.windowMinutes,
        };
    }
    /**
     * Encrypt sensitive data
     */
    async encryptData(data) {
        const config = await this.getSecurityConfig();
        const cipher = crypto.createCipher('aes-256-cbc', config.encryptionKey);
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }
    /**
     * Decrypt sensitive data
     */
    async decryptData(encryptedData) {
        const config = await this.getSecurityConfig();
        const decipher = crypto.createDecipher('aes-256-cbc', config.encryptionKey);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    /**
     * Clear cached configuration (force reload)
     */
    clearCache() {
        this.cachedConfig = null;
    }
}
exports.SecurityConfigService = SecurityConfigService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjdXJpdHktY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic2VjdXJpdHktY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsNEVBQXdJO0FBQ3hJLCtDQUFpQztBQTBCakMsTUFBYSxxQkFBcUI7SUFLaEM7UUFGUSxpQkFBWSxHQUEwQixJQUFJLENBQUM7UUFHakQsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLDZDQUFvQixDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ2xELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQkFBc0IsSUFBSSx1Q0FBdUMsQ0FBQztJQUNsRyxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsaUJBQWlCO1FBQ3JCLElBQUksSUFBSSxDQUFDLFlBQVksRUFBRTtZQUNyQixPQUFPLElBQUksQ0FBQyxZQUFZLENBQUM7U0FDMUI7UUFFRCxJQUFJO1lBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLDhDQUFxQixDQUFDO2dCQUNyRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVU7YUFDMUIsQ0FBQyxDQUFDLENBQUM7WUFFSixJQUFJLE1BQU0sQ0FBQyxZQUFZLEVBQUU7Z0JBQ3ZCLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7Z0JBQ3BELE9BQU8sSUFBSSxDQUFDLFlBQWEsQ0FBQzthQUMzQjtTQUNGO1FBQUMsT0FBTyxLQUFLLEVBQUU7WUFDZCxPQUFPLENBQUMsR0FBRyxDQUFDLDJEQUEyRCxDQUFDLENBQUM7U0FDMUU7UUFFRCw0Q0FBNEM7UUFDNUMsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7UUFDakQsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDL0MsSUFBSSxDQUFDLFlBQVksR0FBRyxhQUFhLENBQUM7UUFFbEMsT0FBTyxhQUFhLENBQUM7SUFDdkIsQ0FBQztJQUVEOztPQUVHO0lBQ0ssbUJBQW1CO1FBQ3pCLE9BQU87WUFDTCxTQUFTLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixFQUFFO1lBQ3RDLGFBQWEsRUFBRSxJQUFJLENBQUMsb0JBQW9CLEVBQUU7WUFDMUMsYUFBYSxFQUFFLElBQUksQ0FBQyxvQkFBb0IsRUFBRTtZQUMxQyxXQUFXLEVBQUU7Z0JBQ1gsa0NBQWtDO2dCQUNsQyx1QkFBdUI7Z0JBQ3ZCLHVCQUF1QjthQUN4QjtZQUNELFVBQVUsRUFBRTtnQkFDVixhQUFhLEVBQUUsSUFBSTtnQkFDbkIsU0FBUyxFQUFFLEdBQUc7Z0JBQ2QsYUFBYSxFQUFFLEVBQUU7YUFDbEI7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLEVBQUU7Z0JBQ2IsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxJQUFJO2FBQ3JCO1lBQ0QsYUFBYSxFQUFFO2dCQUNiLGlCQUFpQixFQUFFLEtBQUs7Z0JBQ3hCLGtCQUFrQixFQUFFLElBQUk7Z0JBQ3hCLHFCQUFxQixFQUFFLENBQUM7YUFDekI7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ0ssS0FBSyxDQUFDLG9CQUFvQixDQUFDLE1BQXNCO1FBQ3ZELElBQUk7WUFDRixNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksNENBQW1CLENBQUM7Z0JBQ3BELElBQUksRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDckIsV0FBVyxFQUFFLGtEQUFrRDtnQkFDL0QsWUFBWSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7YUFDOUMsQ0FBQyxDQUFDLENBQUM7U0FDTDtRQUFDLE9BQU8sS0FBSyxFQUFFO1lBQ2Qsc0NBQXNDO1lBQ3RDLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSw0Q0FBbUIsQ0FBQztnQkFDcEQsUUFBUSxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUN6QixZQUFZLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQzthQUM5QyxDQUFDLENBQUMsQ0FBQztTQUNMO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQixDQUFDLE9BQWdDO1FBQ3pELE1BQU0sYUFBYSxHQUFHLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7UUFDckQsTUFBTSxhQUFhLEdBQUcsRUFBRSxHQUFHLGFBQWEsRUFBRSxHQUFHLE9BQU8sRUFBRSxDQUFDO1FBRXZELE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSw0Q0FBbUIsQ0FBQztZQUNwRCxRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDekIsWUFBWSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7U0FDckQsQ0FBQyxDQUFDLENBQUM7UUFFSixJQUFJLENBQUMsWUFBWSxHQUFHLGFBQWEsQ0FBQztRQUNsQyxPQUFPLGFBQWEsQ0FBQztJQUN2QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCO1FBQ3BCLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7UUFFOUMsTUFBTSxhQUFhLEdBQUc7WUFDcEIsR0FBRyxNQUFNO1lBQ1QsU0FBUyxFQUFFLElBQUksQ0FBQyxvQkFBb0IsRUFBRTtZQUN0QyxhQUFhLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixFQUFFO1NBQzNDLENBQUM7UUFFRixNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUUvQyxPQUFPLENBQUMsR0FBRyxDQUFDLGtDQUFrQyxDQUFDLENBQUM7SUFDbEQsQ0FBQztJQUVEOztPQUVHO0lBQ0ssb0JBQW9CO1FBQzFCLE9BQU8sTUFBTSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDaEQsQ0FBQztJQUVEOztPQUVHO0lBQ0gsZ0JBQWdCLENBQUMsUUFBZ0IsRUFBRSxNQUF5QztRQUkxRSxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksSUFBSSxDQUFDLFlBQVksRUFBRSxjQUFjLElBQUksSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUMsY0FBYyxDQUFDO1FBQ3hHLE1BQU0sTUFBTSxHQUFhLEVBQUUsQ0FBQztRQUU1QixJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLFNBQVMsRUFBRTtZQUN0QyxNQUFNLENBQUMsSUFBSSxDQUFDLDZCQUE2QixNQUFNLENBQUMsU0FBUyxrQkFBa0IsQ0FBQyxDQUFDO1NBQzlFO1FBRUQsSUFBSSxNQUFNLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFO1lBQ3RELE1BQU0sQ0FBQyxJQUFJLENBQUMscURBQXFELENBQUMsQ0FBQztTQUNwRTtRQUVELElBQUksTUFBTSxDQUFDLGdCQUFnQixJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRTtZQUN0RCxNQUFNLENBQUMsSUFBSSxDQUFDLHFEQUFxRCxDQUFDLENBQUM7U0FDcEU7UUFFRCxJQUFJLE1BQU0sQ0FBQyxjQUFjLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFO1lBQ2pELE1BQU0sQ0FBQyxJQUFJLENBQUMsMkNBQTJDLENBQUMsQ0FBQztTQUMxRDtRQUVELElBQUksTUFBTSxDQUFDLGNBQWMsSUFBSSxDQUFDLHVDQUF1QyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRTtZQUNwRixNQUFNLENBQUMsSUFBSSxDQUFDLHNEQUFzRCxDQUFDLENBQUM7U0FDckU7UUFFRCxPQUFPO1lBQ0wsT0FBTyxFQUFFLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUM1QixNQUFNO1NBQ1AsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxlQUFlLENBQUMsTUFBYztRQUNsQyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQzlDLE9BQU8sTUFBTSxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksTUFBTSxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDakYsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxlQUF3QjtRQUN6QyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQzlDLE9BQU87WUFDTCxLQUFLLEVBQUUsZUFBZSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxTQUFTO1lBQ3RGLGFBQWEsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLGFBQWE7U0FDL0MsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBWTtRQUM1QixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQzlDLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUN4RSxJQUFJLFNBQVMsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbkQsU0FBUyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDakMsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxhQUFxQjtRQUNyQyxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQzlDLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUM1RSxJQUFJLFNBQVMsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDOUQsU0FBUyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDcEMsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsVUFBVTtRQUNSLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDO0lBQzNCLENBQUM7Q0FDRjtBQXRORCxzREFzTkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTZWNyZXRzTWFuYWdlckNsaWVudCwgR2V0U2VjcmV0VmFsdWVDb21tYW5kLCBDcmVhdGVTZWNyZXRDb21tYW5kLCBVcGRhdGVTZWNyZXRDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNlY3JldHMtbWFuYWdlcic7XHJcbmltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdjcnlwdG8nO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBTZWN1cml0eUNvbmZpZyB7XHJcbiAgand0U2VjcmV0OiBzdHJpbmc7XHJcbiAgcmVmcmVzaFNlY3JldDogc3RyaW5nO1xyXG4gIGVuY3J5cHRpb25LZXk6IHN0cmluZztcclxuICBjb3JzT3JpZ2luczogc3RyaW5nW107XHJcbiAgcmF0ZUxpbWl0czoge1xyXG4gICAgYXV0aGVudGljYXRlZDogbnVtYmVyO1xyXG4gICAgYW5vbnltb3VzOiBudW1iZXI7XHJcbiAgICB3aW5kb3dNaW51dGVzOiBudW1iZXI7XHJcbiAgfTtcclxuICBwYXNzd29yZFBvbGljeToge1xyXG4gICAgbWluTGVuZ3RoOiBudW1iZXI7XHJcbiAgICByZXF1aXJlVXBwZXJjYXNlOiBib29sZWFuO1xyXG4gICAgcmVxdWlyZUxvd2VyY2FzZTogYm9vbGVhbjtcclxuICAgIHJlcXVpcmVOdW1iZXJzOiBib29sZWFuO1xyXG4gICAgcmVxdWlyZVN5bWJvbHM6IGJvb2xlYW47XHJcbiAgfTtcclxuICBzZXNzaW9uQ29uZmlnOiB7XHJcbiAgICBhY2Nlc3NUb2tlbkV4cGlyeTogc3RyaW5nO1xyXG4gICAgcmVmcmVzaFRva2VuRXhwaXJ5OiBzdHJpbmc7XHJcbiAgICBtYXhDb25jdXJyZW50U2Vzc2lvbnM6IG51bWJlcjtcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgU2VjdXJpdHlDb25maWdTZXJ2aWNlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IHNlY3JldHNDbGllbnQ6IFNlY3JldHNNYW5hZ2VyQ2xpZW50O1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjcmV0TmFtZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgY2FjaGVkQ29uZmlnOiBTZWN1cml0eUNvbmZpZyB8IG51bGwgPSBudWxsO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuc2VjcmV0c0NsaWVudCA9IG5ldyBTZWNyZXRzTWFuYWdlckNsaWVudCh7fSk7XHJcbiAgICB0aGlzLnNlY3JldE5hbWUgPSBwcm9jZXNzLmVudi5TRUNVUklUWV9DT05GSUdfU0VDUkVUIHx8ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIvc2VjdXJpdHktY29uZmlnJztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldCBzZWN1cml0eSBjb25maWd1cmF0aW9uXHJcbiAgICovXHJcbiAgYXN5bmMgZ2V0U2VjdXJpdHlDb25maWcoKTogUHJvbWlzZTxTZWN1cml0eUNvbmZpZz4ge1xyXG4gICAgaWYgKHRoaXMuY2FjaGVkQ29uZmlnKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLmNhY2hlZENvbmZpZztcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnNlY3JldHNDbGllbnQuc2VuZChuZXcgR2V0U2VjcmV0VmFsdWVDb21tYW5kKHtcclxuICAgICAgICBTZWNyZXRJZDogdGhpcy5zZWNyZXROYW1lLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAocmVzdWx0LlNlY3JldFN0cmluZykge1xyXG4gICAgICAgIHRoaXMuY2FjaGVkQ29uZmlnID0gSlNPTi5wYXJzZShyZXN1bHQuU2VjcmV0U3RyaW5nKTtcclxuICAgICAgICByZXR1cm4gdGhpcy5jYWNoZWRDb25maWchO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmxvZygnU2VjdXJpdHkgY29uZmlnIG5vdCBmb3VuZCwgY3JlYXRpbmcgZGVmYXVsdCBjb25maWd1cmF0aW9uJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ3JlYXRlIGRlZmF1bHQgY29uZmlndXJhdGlvbiBpZiBub3QgZm91bmRcclxuICAgIGNvbnN0IGRlZmF1bHRDb25maWcgPSB0aGlzLmNyZWF0ZURlZmF1bHRDb25maWcoKTtcclxuICAgIGF3YWl0IHRoaXMuY3JlYXRlU2VjdXJpdHlDb25maWcoZGVmYXVsdENvbmZpZyk7XHJcbiAgICB0aGlzLmNhY2hlZENvbmZpZyA9IGRlZmF1bHRDb25maWc7XHJcbiAgICBcclxuICAgIHJldHVybiBkZWZhdWx0Q29uZmlnO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlIGRlZmF1bHQgc2VjdXJpdHkgY29uZmlndXJhdGlvblxyXG4gICAqL1xyXG4gIHByaXZhdGUgY3JlYXRlRGVmYXVsdENvbmZpZygpOiBTZWN1cml0eUNvbmZpZyB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBqd3RTZWNyZXQ6IHRoaXMuZ2VuZXJhdGVTZWN1cmVTZWNyZXQoKSxcclxuICAgICAgcmVmcmVzaFNlY3JldDogdGhpcy5nZW5lcmF0ZVNlY3VyZVNlY3JldCgpLFxyXG4gICAgICBlbmNyeXB0aW9uS2V5OiB0aGlzLmdlbmVyYXRlU2VjdXJlU2VjcmV0KCksXHJcbiAgICAgIGNvcnNPcmlnaW5zOiBbXHJcbiAgICAgICAgJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJyxcclxuICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDozMDAwJyxcclxuICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDo1MTczJyxcclxuICAgICAgXSxcclxuICAgICAgcmF0ZUxpbWl0czoge1xyXG4gICAgICAgIGF1dGhlbnRpY2F0ZWQ6IDEwMDAsIC8vIDEwMDAgcmVxdWVzdHMgcGVyIHdpbmRvdyBmb3IgYXV0aGVudGljYXRlZCB1c2Vyc1xyXG4gICAgICAgIGFub255bW91czogMTAwLCAvLyAxMDAgcmVxdWVzdHMgcGVyIHdpbmRvdyBmb3IgYW5vbnltb3VzIHVzZXJzXHJcbiAgICAgICAgd2luZG93TWludXRlczogMTUsXHJcbiAgICAgIH0sXHJcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XHJcbiAgICAgICAgbWluTGVuZ3RoOiAxMixcclxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxyXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXHJcbiAgICAgICAgcmVxdWlyZU51bWJlcnM6IHRydWUsXHJcbiAgICAgICAgcmVxdWlyZVN5bWJvbHM6IHRydWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIHNlc3Npb25Db25maWc6IHtcclxuICAgICAgICBhY2Nlc3NUb2tlbkV4cGlyeTogJzE1bScsXHJcbiAgICAgICAgcmVmcmVzaFRva2VuRXhwaXJ5OiAnN2QnLFxyXG4gICAgICAgIG1heENvbmN1cnJlbnRTZXNzaW9uczogNSxcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGUgc2VjdXJpdHkgY29uZmlndXJhdGlvbiBpbiBTZWNyZXRzIE1hbmFnZXJcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGNyZWF0ZVNlY3VyaXR5Q29uZmlnKGNvbmZpZzogU2VjdXJpdHlDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IHRoaXMuc2VjcmV0c0NsaWVudC5zZW5kKG5ldyBDcmVhdGVTZWNyZXRDb21tYW5kKHtcclxuICAgICAgICBOYW1lOiB0aGlzLnNlY3JldE5hbWUsXHJcbiAgICAgICAgRGVzY3JpcHRpb246ICdTZWN1cml0eSBjb25maWd1cmF0aW9uIGZvciBhdXRvbWF0ZWQgYmxvZyBwb3N0ZXInLFxyXG4gICAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkoY29uZmlnLCBudWxsLCAyKSxcclxuICAgICAgfSkpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgLy8gSWYgc2VjcmV0IGFscmVhZHkgZXhpc3RzLCB1cGRhdGUgaXRcclxuICAgICAgYXdhaXQgdGhpcy5zZWNyZXRzQ2xpZW50LnNlbmQobmV3IFVwZGF0ZVNlY3JldENvbW1hbmQoe1xyXG4gICAgICAgIFNlY3JldElkOiB0aGlzLnNlY3JldE5hbWUsXHJcbiAgICAgICAgU2VjcmV0U3RyaW5nOiBKU09OLnN0cmluZ2lmeShjb25maWcsIG51bGwsIDIpLFxyXG4gICAgICB9KSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBVcGRhdGUgc2VjdXJpdHkgY29uZmlndXJhdGlvblxyXG4gICAqL1xyXG4gIGFzeW5jIHVwZGF0ZVNlY3VyaXR5Q29uZmlnKHVwZGF0ZXM6IFBhcnRpYWw8U2VjdXJpdHlDb25maWc+KTogUHJvbWlzZTxTZWN1cml0eUNvbmZpZz4ge1xyXG4gICAgY29uc3QgY3VycmVudENvbmZpZyA9IGF3YWl0IHRoaXMuZ2V0U2VjdXJpdHlDb25maWcoKTtcclxuICAgIGNvbnN0IHVwZGF0ZWRDb25maWcgPSB7IC4uLmN1cnJlbnRDb25maWcsIC4uLnVwZGF0ZXMgfTtcclxuXHJcbiAgICBhd2FpdCB0aGlzLnNlY3JldHNDbGllbnQuc2VuZChuZXcgVXBkYXRlU2VjcmV0Q29tbWFuZCh7XHJcbiAgICAgIFNlY3JldElkOiB0aGlzLnNlY3JldE5hbWUsXHJcbiAgICAgIFNlY3JldFN0cmluZzogSlNPTi5zdHJpbmdpZnkodXBkYXRlZENvbmZpZywgbnVsbCwgMiksXHJcbiAgICB9KSk7XHJcblxyXG4gICAgdGhpcy5jYWNoZWRDb25maWcgPSB1cGRhdGVkQ29uZmlnO1xyXG4gICAgcmV0dXJuIHVwZGF0ZWRDb25maWc7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSb3RhdGUgSldUIHNlY3JldHNcclxuICAgKi9cclxuICBhc3luYyByb3RhdGVKV1RTZWNyZXRzKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgY29uZmlnID0gYXdhaXQgdGhpcy5nZXRTZWN1cml0eUNvbmZpZygpO1xyXG4gICAgXHJcbiAgICBjb25zdCB1cGRhdGVkQ29uZmlnID0ge1xyXG4gICAgICAuLi5jb25maWcsXHJcbiAgICAgIGp3dFNlY3JldDogdGhpcy5nZW5lcmF0ZVNlY3VyZVNlY3JldCgpLFxyXG4gICAgICByZWZyZXNoU2VjcmV0OiB0aGlzLmdlbmVyYXRlU2VjdXJlU2VjcmV0KCksXHJcbiAgICB9O1xyXG5cclxuICAgIGF3YWl0IHRoaXMudXBkYXRlU2VjdXJpdHlDb25maWcodXBkYXRlZENvbmZpZyk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCdKV1Qgc2VjcmV0cyByb3RhdGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2VuZXJhdGUgYSBjcnlwdG9ncmFwaGljYWxseSBzZWN1cmUgc2VjcmV0XHJcbiAgICovXHJcbiAgcHJpdmF0ZSBnZW5lcmF0ZVNlY3VyZVNlY3JldCgpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIGNyeXB0by5yYW5kb21CeXRlcyg2NCkudG9TdHJpbmcoJ2hleCcpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogVmFsaWRhdGUgcGFzc3dvcmQgYWdhaW5zdCBwb2xpY3lcclxuICAgKi9cclxuICB2YWxpZGF0ZVBhc3N3b3JkKHBhc3N3b3JkOiBzdHJpbmcsIHBvbGljeT86IFNlY3VyaXR5Q29uZmlnWydwYXNzd29yZFBvbGljeSddKToge1xyXG4gICAgaXNWYWxpZDogYm9vbGVhbjtcclxuICAgIGVycm9yczogc3RyaW5nW107XHJcbiAgfSB7XHJcbiAgICBjb25zdCBjb25maWcgPSBwb2xpY3kgfHwgdGhpcy5jYWNoZWRDb25maWc/LnBhc3N3b3JkUG9saWN5IHx8IHRoaXMuY3JlYXRlRGVmYXVsdENvbmZpZygpLnBhc3N3b3JkUG9saWN5O1xyXG4gICAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xyXG5cclxuICAgIGlmIChwYXNzd29yZC5sZW5ndGggPCBjb25maWcubWluTGVuZ3RoKSB7XHJcbiAgICAgIGVycm9ycy5wdXNoKGBQYXNzd29yZCBtdXN0IGJlIGF0IGxlYXN0ICR7Y29uZmlnLm1pbkxlbmd0aH0gY2hhcmFjdGVycyBsb25nYCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGNvbmZpZy5yZXF1aXJlVXBwZXJjYXNlICYmICEvW0EtWl0vLnRlc3QocGFzc3dvcmQpKSB7XHJcbiAgICAgIGVycm9ycy5wdXNoKCdQYXNzd29yZCBtdXN0IGNvbnRhaW4gYXQgbGVhc3Qgb25lIHVwcGVyY2FzZSBsZXR0ZXInKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoY29uZmlnLnJlcXVpcmVMb3dlcmNhc2UgJiYgIS9bYS16XS8udGVzdChwYXNzd29yZCkpIHtcclxuICAgICAgZXJyb3JzLnB1c2goJ1Bhc3N3b3JkIG11c3QgY29udGFpbiBhdCBsZWFzdCBvbmUgbG93ZXJjYXNlIGxldHRlcicpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChjb25maWcucmVxdWlyZU51bWJlcnMgJiYgIS9cXGQvLnRlc3QocGFzc3dvcmQpKSB7XHJcbiAgICAgIGVycm9ycy5wdXNoKCdQYXNzd29yZCBtdXN0IGNvbnRhaW4gYXQgbGVhc3Qgb25lIG51bWJlcicpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChjb25maWcucmVxdWlyZVN5bWJvbHMgJiYgIS9bIUAjJCVeJiooKV8rXFwtPVxcW1xcXXt9Oyc6XCJcXFxcfCwuPD5cXC8/XS8udGVzdChwYXNzd29yZCkpIHtcclxuICAgICAgZXJyb3JzLnB1c2goJ1Bhc3N3b3JkIG11c3QgY29udGFpbiBhdCBsZWFzdCBvbmUgc3BlY2lhbCBjaGFyYWN0ZXInKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBpc1ZhbGlkOiBlcnJvcnMubGVuZ3RoID09PSAwLFxyXG4gICAgICBlcnJvcnMsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2hlY2sgaWYgb3JpZ2luIGlzIGFsbG93ZWRcclxuICAgKi9cclxuICBhc3luYyBpc09yaWdpbkFsbG93ZWQob3JpZ2luOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMuZ2V0U2VjdXJpdHlDb25maWcoKTtcclxuICAgIHJldHVybiBjb25maWcuY29yc09yaWdpbnMuaW5jbHVkZXMob3JpZ2luKSB8fCBjb25maWcuY29yc09yaWdpbnMuaW5jbHVkZXMoJyonKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldCByYXRlIGxpbWl0IGZvciB1c2VyIHR5cGVcclxuICAgKi9cclxuICBhc3luYyBnZXRSYXRlTGltaXQoaXNBdXRoZW50aWNhdGVkOiBib29sZWFuKTogUHJvbWlzZTx7IGxpbWl0OiBudW1iZXI7IHdpbmRvd01pbnV0ZXM6IG51bWJlciB9PiB7XHJcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLmdldFNlY3VyaXR5Q29uZmlnKCk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBsaW1pdDogaXNBdXRoZW50aWNhdGVkID8gY29uZmlnLnJhdGVMaW1pdHMuYXV0aGVudGljYXRlZCA6IGNvbmZpZy5yYXRlTGltaXRzLmFub255bW91cyxcclxuICAgICAgd2luZG93TWludXRlczogY29uZmlnLnJhdGVMaW1pdHMud2luZG93TWludXRlcyxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFbmNyeXB0IHNlbnNpdGl2ZSBkYXRhXHJcbiAgICovXHJcbiAgYXN5bmMgZW5jcnlwdERhdGEoZGF0YTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMuZ2V0U2VjdXJpdHlDb25maWcoKTtcclxuICAgIGNvbnN0IGNpcGhlciA9IGNyeXB0by5jcmVhdGVDaXBoZXIoJ2Flcy0yNTYtY2JjJywgY29uZmlnLmVuY3J5cHRpb25LZXkpO1xyXG4gICAgbGV0IGVuY3J5cHRlZCA9IGNpcGhlci51cGRhdGUoZGF0YSwgJ3V0ZjgnLCAnaGV4Jyk7XHJcbiAgICBlbmNyeXB0ZWQgKz0gY2lwaGVyLmZpbmFsKCdoZXgnKTtcclxuICAgIHJldHVybiBlbmNyeXB0ZWQ7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBEZWNyeXB0IHNlbnNpdGl2ZSBkYXRhXHJcbiAgICovXHJcbiAgYXN5bmMgZGVjcnlwdERhdGEoZW5jcnlwdGVkRGF0YTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHRoaXMuZ2V0U2VjdXJpdHlDb25maWcoKTtcclxuICAgIGNvbnN0IGRlY2lwaGVyID0gY3J5cHRvLmNyZWF0ZURlY2lwaGVyKCdhZXMtMjU2LWNiYycsIGNvbmZpZy5lbmNyeXB0aW9uS2V5KTtcclxuICAgIGxldCBkZWNyeXB0ZWQgPSBkZWNpcGhlci51cGRhdGUoZW5jcnlwdGVkRGF0YSwgJ2hleCcsICd1dGY4Jyk7XHJcbiAgICBkZWNyeXB0ZWQgKz0gZGVjaXBoZXIuZmluYWwoJ3V0ZjgnKTtcclxuICAgIHJldHVybiBkZWNyeXB0ZWQ7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDbGVhciBjYWNoZWQgY29uZmlndXJhdGlvbiAoZm9yY2UgcmVsb2FkKVxyXG4gICAqL1xyXG4gIGNsZWFyQ2FjaGUoKTogdm9pZCB7XHJcbiAgICB0aGlzLmNhY2hlZENvbmZpZyA9IG51bGw7XHJcbiAgfVxyXG59Il19