import { Platform as OAuthPlatform, OAuthConfig, OAuthToken, AuthenticationResult, OAuthState } from '../types/OAuth';
import { Platform } from '../types/PlatformConnection';
import { PlatformConnection } from '../types/PlatformConnection';
import { API_BASE_URL } from '../config/api';

class AuthenticationService {
  private getConfigs(): Record<string, OAuthConfig> {
    return {
      medium: {
        clientId: process.env.REACT_APP_MEDIUM_CLIENT_ID || '',
        redirectUri: `${window.location.origin}/auth/callback`,
        scope: ['basicProfile', 'publishPost'],
        authUrl: 'https://medium.com/m/oauth/authorize',
        tokenUrl: 'https://api.medium.com/v1/tokens'
      },
      linkedin: {
        clientId: process.env.REACT_APP_LINKEDIN_CLIENT_ID || '',
        redirectUri: `${window.location.origin}/auth/callback`,
        scope: ['r_liteprofile', 'w_member_social'],
        authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
        tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken'
      }
    };
  }

  /**
   * Initiates OAuth 2.0 authorization flow for a platform
   */
  async initiateAuth(platform: Platform, userId: string): Promise<string> {
    const configs = this.getConfigs();
    const config = configs[platform];
    if (!config.clientId) {
      throw new Error(`${platform} client ID not configured`);
    }

    // Generate and store state for CSRF protection
    const state = this.generateState();
    const oauthState: OAuthState = {
      state,
      platform,
      userId,
      createdAt: new Date()
    };

    // Store state in session storage for verification
    sessionStorage.setItem(`oauth_state_${state}`, JSON.stringify(oauthState));

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scope.join(' '),
      response_type: 'code',
      state
    });

    return `${config.authUrl}?${params.toString()}`;
  }

  /**
   * Handles OAuth callback and exchanges code for token
   */
  async handleCallback(code: string, state: string): Promise<AuthenticationResult> {
    try {
      // Verify state parameter
      const storedStateData = sessionStorage.getItem(`oauth_state_${state}`);
      if (!storedStateData) {
        throw new Error('Invalid or expired state parameter');
      }

      const oauthState: OAuthState = JSON.parse(storedStateData);
      
      // Clean up stored state
      sessionStorage.removeItem(`oauth_state_${state}`);

      // Exchange code for token via backend
      const response = await fetch(`${API_BASE_URL}/auth/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          platform: oauthState.platform,
          userId: oauthState.userId
        })
      });

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      return {
        success: true,
        token: result.token,
        platform: oauthState.platform
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
        platform: 'medium' as OAuthPlatform // Default, will be overridden by actual platform
      };
    }
  }

  /**
   * Gets connected platforms for a user
   */
  async getConnectedPlatforms(userId: string): Promise<PlatformConnection[]> {
    const response = await fetch(`${API_BASE_URL}/auth/platforms/${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch platforms: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Disconnects a platform for a user
   */
  async disconnectPlatform(userId: string, platform: Platform): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/auth/platforms/${userId}/${platform}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to disconnect platform: ${response.statusText}`);
    }
  }

  /**
   * Checks if a platform token needs renewal
   */
  async checkTokenStatus(userId: string, platform: Platform): Promise<{ valid: boolean; expiresAt?: Date }> {
    const response = await fetch(`${API_BASE_URL}/auth/status/${userId}/${platform}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to check token status: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Refreshes an expired token
   */
  async refreshToken(userId: string, platform: Platform): Promise<AuthenticationResult> {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        platform
      })
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Token refresh failed: ${response.statusText}`,
        platform
      };
    }

    const result = await response.json();
    
    return {
      success: true,
      token: result.token,
      platform
    };
  }

  private generateState(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
}

export const authenticationService = new AuthenticationService();