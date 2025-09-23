import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authenticationService } from '../authenticationService';
import { Platform } from '../../types/OAuth';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock window.open
const mockWindowOpen = vi.fn();
Object.defineProperty(window, 'open', {
  value: mockWindowOpen,
  writable: true
});

// Mock sessionStorage
const mockSessionStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};
Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
  writable: true
});

describe('AuthenticationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    vi.stubEnv('REACT_APP_MEDIUM_CLIENT_ID', 'test-medium-client-id');
    vi.stubEnv('REACT_APP_LINKEDIN_CLIENT_ID', 'test-linkedin-client-id');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initiateAuth', () => {
    it('should generate authorization URL for Medium', async () => {
      const userId = 'test-user-123';
      const platform = Platform.MEDIUM;

      const authUrl = await authenticationService.initiateAuth(platform, userId);

      expect(authUrl).toContain('https://medium.com/m/oauth/authorize');
      expect(authUrl).toContain('client_id=test-medium-client-id');
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).toContain('scope=basicProfile+publishPost');
      expect(mockSessionStorage.setItem).toHaveBeenCalled();
    });

    it('should generate authorization URL for LinkedIn', async () => {
      const userId = 'test-user-123';
      const platform = Platform.LINKEDIN;

      const authUrl = await authenticationService.initiateAuth(platform, userId);

      expect(authUrl).toContain('https://www.linkedin.com/oauth/v2/authorization');
      expect(authUrl).toContain('client_id=test-linkedin-client-id');
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).toContain('scope=r_liteprofile+w_member_social');
      expect(mockSessionStorage.setItem).toHaveBeenCalled();
    });

    it('should throw error when client ID is not configured', async () => {
      vi.stubEnv('REACT_APP_MEDIUM_CLIENT_ID', '');
      const userId = 'test-user-123';
      const platform = Platform.MEDIUM;

      await expect(authenticationService.initiateAuth(platform, userId))
        .rejects.toThrow('medium client ID not configured');
    });

    it('should store OAuth state in session storage', async () => {
      const userId = 'test-user-123';
      const platform = Platform.MEDIUM;

      await authenticationService.initiateAuth(platform, userId);

      expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
        expect.stringMatching(/^oauth_state_/),
        expect.stringContaining('"platform":"medium"')
      );
    });
  });

  describe('handleCallback', () => {
    it('should successfully handle OAuth callback', async () => {
      const code = 'test-auth-code';
      const state = 'test-state-123';
      const mockStateData = {
        state,
        platform: Platform.MEDIUM,
        userId: 'test-user-123',
        createdAt: new Date().toISOString()
      };

      mockSessionStorage.getItem.mockReturnValue(JSON.stringify(mockStateData));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: {
            accessToken: 'test-access-token',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            tokenType: 'Bearer',
            scope: ['basicProfile', 'publishPost']
          }
        })
      });

      const result = await authenticationService.handleCallback(code, state);

      expect(result.success).toBe(true);
      expect(result.token?.accessToken).toBe('test-access-token');
      expect(result.platform).toBe(Platform.MEDIUM);
      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(`oauth_state_${state}`);
    });

    it('should handle invalid state parameter', async () => {
      const code = 'test-auth-code';
      const state = 'invalid-state';

      mockSessionStorage.getItem.mockReturnValue(null);

      const result = await authenticationService.handleCallback(code, state);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid or expired state parameter');
    });

    it('should handle token exchange failure', async () => {
      const code = 'test-auth-code';
      const state = 'test-state-123';
      const mockStateData = {
        state,
        platform: Platform.MEDIUM,
        userId: 'test-user-123',
        createdAt: new Date().toISOString()
      };

      mockSessionStorage.getItem.mockReturnValue(JSON.stringify(mockStateData));
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request'
      });

      const result = await authenticationService.handleCallback(code, state);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token exchange failed');
    });
  });

  describe('getConnectedPlatforms', () => {
    it('should fetch connected platforms for user', async () => {
      const userId = 'test-user-123';
      const mockPlatforms = [
        {
          platform: Platform.MEDIUM,
          isActive: true,
          connectedAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          needsRenewal: false
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPlatforms
      });

      const result = await authenticationService.getConnectedPlatforms(userId);

      expect(result).toEqual(mockPlatforms);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/auth/platforms/${userId}`),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should handle fetch error', async () => {
      const userId = 'test-user-123';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error'
      });

      await expect(authenticationService.getConnectedPlatforms(userId))
        .rejects.toThrow('Failed to fetch platforms');
    });
  });

  describe('disconnectPlatform', () => {
    it('should successfully disconnect platform', async () => {
      const userId = 'test-user-123';
      const platform = Platform.MEDIUM;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      await authenticationService.disconnectPlatform(userId, platform);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/auth/platforms/${userId}/${platform}`),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should handle disconnect error', async () => {
      const userId = 'test-user-123';
      const platform = Platform.MEDIUM;

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found'
      });

      await expect(authenticationService.disconnectPlatform(userId, platform))
        .rejects.toThrow('Failed to disconnect platform');
    });
  });

  describe('checkTokenStatus', () => {
    it('should check token validity', async () => {
      const userId = 'test-user-123';
      const platform = Platform.MEDIUM;
      const mockStatus = {
        valid: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus
      });

      const result = await authenticationService.checkTokenStatus(userId, platform);

      expect(result).toEqual(mockStatus);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/auth/status/${userId}/${platform}`),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('refreshToken', () => {
    it('should successfully refresh token', async () => {
      const userId = 'test-user-123';
      const platform = Platform.MEDIUM;
      const mockRefreshResult = {
        success: true,
        token: {
          accessToken: 'new-access-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          tokenType: 'Bearer',
          scope: ['basicProfile', 'publishPost']
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRefreshResult
      });

      const result = await authenticationService.refreshToken(userId, platform);

      expect(result.success).toBe(true);
      expect(result.token?.accessToken).toBe('new-access-token');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/refresh'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ userId, platform })
        })
      );
    });

    it('should handle refresh failure', async () => {
      const userId = 'test-user-123';
      const platform = Platform.MEDIUM;

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request'
      });

      const result = await authenticationService.refreshToken(userId, platform);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token refresh failed');
    });
  });
});