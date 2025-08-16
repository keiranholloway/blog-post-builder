export type Platform = 'medium' | 'linkedin' | 'dev.to' | 'hashnode' | 'custom';

export interface EncryptedCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string[];
}

export interface PlatformConfig {
  autoPublish: boolean;
  defaultTags: string[];
  customSettings: Record<string, any>;
}

export interface PlatformConnection {
  platform: Platform;
  credentials: EncryptedCredentials;
  isActive: boolean;
  lastUsed?: Date;
  configuration: PlatformConfig;
  connectedAt: Date;
  updatedAt: Date;
}

export interface PlatformConnectionCreateInput {
  platform: Platform;
  credentials: EncryptedCredentials;
  configuration?: Partial<PlatformConfig>;
}

export interface PlatformConnectionUpdateInput {
  credentials?: EncryptedCredentials;
  isActive?: boolean;
  configuration?: Partial<PlatformConfig>;
  lastUsed?: Date;
}

// Platform-specific configuration types
export interface MediumConfig extends PlatformConfig {
  publicationId?: string;
  license: 'all-rights-reserved' | 'cc-40-by' | 'cc-40-by-sa' | 'cc-40-by-nd' | 'cc-40-by-nc' | 'cc-40-by-nc-nd' | 'cc-40-by-nc-sa' | 'cc-40-zero' | 'public-domain';
  notifyFollowers: boolean;
}

export interface LinkedInConfig extends PlatformConfig {
  visibility: 'PUBLIC' | 'CONNECTIONS';
  commentingEnabled: boolean;
}