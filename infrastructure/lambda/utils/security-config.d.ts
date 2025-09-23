export interface SecurityConfig {
    jwtSecret: string;
    refreshSecret: string;
    encryptionKey: string;
    corsOrigins: string[];
    rateLimits: {
        authenticated: number;
        anonymous: number;
        windowMinutes: number;
    };
    passwordPolicy: {
        minLength: number;
        requireUppercase: boolean;
        requireLowercase: boolean;
        requireNumbers: boolean;
        requireSymbols: boolean;
    };
    sessionConfig: {
        accessTokenExpiry: string;
        refreshTokenExpiry: string;
        maxConcurrentSessions: number;
    };
}
export declare class SecurityConfigService {
    private readonly secretsClient;
    private readonly secretName;
    private cachedConfig;
    constructor();
    /**
     * Get security configuration
     */
    getSecurityConfig(): Promise<SecurityConfig>;
    /**
     * Create default security configuration
     */
    private createDefaultConfig;
    /**
     * Create security configuration in Secrets Manager
     */
    private createSecurityConfig;
    /**
     * Update security configuration
     */
    updateSecurityConfig(updates: Partial<SecurityConfig>): Promise<SecurityConfig>;
    /**
     * Rotate JWT secrets
     */
    rotateJWTSecrets(): Promise<void>;
    /**
     * Generate a cryptographically secure secret
     */
    private generateSecureSecret;
    /**
     * Validate password against policy
     */
    validatePassword(password: string, policy?: SecurityConfig['passwordPolicy']): {
        isValid: boolean;
        errors: string[];
    };
    /**
     * Check if origin is allowed
     */
    isOriginAllowed(origin: string): Promise<boolean>;
    /**
     * Get rate limit for user type
     */
    getRateLimit(isAuthenticated: boolean): Promise<{
        limit: number;
        windowMinutes: number;
    }>;
    /**
     * Encrypt sensitive data
     */
    encryptData(data: string): Promise<string>;
    /**
     * Decrypt sensitive data
     */
    decryptData(encryptedData: string): Promise<string>;
    /**
     * Clear cached configuration (force reload)
     */
    clearCache(): void;
}
