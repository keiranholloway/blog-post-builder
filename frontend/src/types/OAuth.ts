export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
  scope: string[];
  authUrl: string;
  tokenUrl: string;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  tokenType: string;
  scope: string[];
}

export interface OAuthState {
  state: string;
  platform: Platform;
  userId: string;
  createdAt: Date;
}

export type Platform = 'medium' | 'linkedin' | 'dev.to' | 'hashnode' | 'custom';

export interface AuthenticationResult {
  success: boolean;
  token?: OAuthToken;
  error?: string;
  platform: Platform;
}

export interface PlatformAuthConfig {
  medium: OAuthConfig;
  linkedin: OAuthConfig;
}