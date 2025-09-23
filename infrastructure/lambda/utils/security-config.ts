import { SecretsManagerClient, GetSecretValueCommand, CreateSecretCommand, UpdateSecretCommand } from '@aws-sdk/client-secrets-manager';
import * as crypto from 'crypto';

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

export class SecurityConfigService {
  private readonly secretsClient: SecretsManagerClient;
  private readonly secretName: string;
  private cachedConfig: SecurityConfig | null = null;

  constructor() {
    this.secretsClient = new SecretsManagerClient({});
    this.secretName = process.env.SECURITY_CONFIG_SECRET || 'automated-blog-poster/security-config';
  }

  /**
   * Get security configuration
   */
  async getSecurityConfig(): Promise<SecurityConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    try {
      const result = await this.secretsClient.send(new GetSecretValueCommand({
        SecretId: this.secretName,
      }));

      if (result.SecretString) {
        this.cachedConfig = JSON.parse(result.SecretString);
        return this.cachedConfig!;
      }
    } catch (error) {
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
  private createDefaultConfig(): SecurityConfig {
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
        authenticated: 1000, // 1000 requests per window for authenticated users
        anonymous: 100, // 100 requests per window for anonymous users
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
  private async createSecurityConfig(config: SecurityConfig): Promise<void> {
    try {
      await this.secretsClient.send(new CreateSecretCommand({
        Name: this.secretName,
        Description: 'Security configuration for automated blog poster',
        SecretString: JSON.stringify(config, null, 2),
      }));
    } catch (error) {
      // If secret already exists, update it
      await this.secretsClient.send(new UpdateSecretCommand({
        SecretId: this.secretName,
        SecretString: JSON.stringify(config, null, 2),
      }));
    }
  }

  /**
   * Update security configuration
   */
  async updateSecurityConfig(updates: Partial<SecurityConfig>): Promise<SecurityConfig> {
    const currentConfig = await this.getSecurityConfig();
    const updatedConfig = { ...currentConfig, ...updates };

    await this.secretsClient.send(new UpdateSecretCommand({
      SecretId: this.secretName,
      SecretString: JSON.stringify(updatedConfig, null, 2),
    }));

    this.cachedConfig = updatedConfig;
    return updatedConfig;
  }

  /**
   * Rotate JWT secrets
   */
  async rotateJWTSecrets(): Promise<void> {
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
  private generateSecureSecret(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Validate password against policy
   */
  validatePassword(password: string, policy?: SecurityConfig['passwordPolicy']): {
    isValid: boolean;
    errors: string[];
  } {
    const config = policy || this.cachedConfig?.passwordPolicy || this.createDefaultConfig().passwordPolicy;
    const errors: string[] = [];

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
  async isOriginAllowed(origin: string): Promise<boolean> {
    const config = await this.getSecurityConfig();
    return config.corsOrigins.includes(origin) || config.corsOrigins.includes('*');
  }

  /**
   * Get rate limit for user type
   */
  async getRateLimit(isAuthenticated: boolean): Promise<{ limit: number; windowMinutes: number }> {
    const config = await this.getSecurityConfig();
    return {
      limit: isAuthenticated ? config.rateLimits.authenticated : config.rateLimits.anonymous,
      windowMinutes: config.rateLimits.windowMinutes,
    };
  }

  /**
   * Encrypt sensitive data
   */
  async encryptData(data: string): Promise<string> {
    const config = await this.getSecurityConfig();
    const cipher = crypto.createCipher('aes-256-cbc', config.encryptionKey);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  async decryptData(encryptedData: string): Promise<string> {
    const config = await this.getSecurityConfig();
    const decipher = crypto.createDecipher('aes-256-cbc', config.encryptionKey);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Clear cached configuration (force reload)
   */
  clearCache(): void {
    this.cachedConfig = null;
  }
}