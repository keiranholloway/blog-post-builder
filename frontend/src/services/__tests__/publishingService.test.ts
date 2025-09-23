import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock the API_BASE_URL before importing
vi.mock('../config/api', () => ({
  API_BASE_URL: 'https://api.test.com'
}));

// Import after mocking
import { publishingService, PublishingConfig, PublishRequest } from '../publishingService';

describe('PublishingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSupportedPlatforms', () => {
    it('should fetch supported platforms successfully', async () => {
      const mockPlatforms = [
        { name: 'medium', features: ['tags', 'images', 'markdown'] },
        { name: 'linkedin', features: ['images', 'professional-formatting'] }
      ];

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ platforms: mockPlatforms })
      });

      const platforms = await publishingService.getSupportedPlatforms();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/publishing/platforms',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
      expect(platforms).toEqual(mockPlatforms);
    });

    it('should handle fetch error', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error'
      });

      await expect(publishingService.getSupportedPlatforms()).rejects.toThrow(
        'Failed to get platforms: Internal Server Error'
      );
    });
  });

  describe('validateCredentials', () => {
    it('should validate credentials successfully', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true })
      });

      const isValid = await publishingService.validateCredentials('medium', {
        accessToken: 'valid-token'
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/publishing/validate-credentials',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: 'medium',
            credentials: { accessToken: 'valid-token' }
          })
        })
      );
      expect(isValid).toBe(true);
    });

    it('should handle invalid credentials', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: false })
      });

      const isValid = await publishingService.validateCredentials('medium', {
        accessToken: 'invalid-token'
      });

      expect(isValid).toBe(false);
    });

    it('should handle validation error', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request'
      });

      await expect(
        publishingService.validateCredentials('medium', { accessToken: 'token' })
      ).rejects.toThrow('Failed to validate credentials: Bad Request');
    });
  });

  describe('publishContent', () => {
    it('should publish content successfully', async () => {
      const mockResponse = {
        success: true,
        results: {
          medium: { success: true, platformUrl: 'https://medium.com/post/123' },
          linkedin: { success: true, platformUrl: 'https://linkedin.com/post/456' }
        }
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: PublishRequest = {
        contentId: 'content-123',
        platforms: ['medium', 'linkedin'],
        configs: {
          medium: { platform: 'medium', credentials: { accessToken: 'token1' } },
          linkedin: { platform: 'linkedin', credentials: { accessToken: 'token2' } }
        },
        imageUrl: 'https://example.com/image.jpg'
      };

      const result = await publishingService.publishContent(request);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/publishing/publish',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle publish error', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error'
      });

      const request: PublishRequest = {
        contentId: 'content-123',
        platforms: ['medium'],
        configs: {
          medium: { platform: 'medium', credentials: { accessToken: 'token' } }
        }
      };

      await expect(publishingService.publishContent(request)).rejects.toThrow(
        'Failed to publish content: Internal Server Error'
      );
    });
  });

  describe('getPublishingStatus', () => {
    it('should get publishing status successfully', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'published' })
      });

      const config: PublishingConfig = {
        platform: 'medium',
        credentials: { accessToken: 'token' }
      };

      const status = await publishingService.getPublishingStatus(
        'content-123',
        'medium',
        'post-456',
        config
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/publishing/status',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentId: 'content-123',
            platform: 'medium',
            platformId: 'post-456',
            config
          })
        })
      );
      expect(status).toBe('published');
    });
  });

  describe('getFormatPreview', () => {
    it('should get format preview successfully', async () => {
      const mockFormattedContent = {
        title: 'Test Title',
        body: 'Formatted content',
        tags: ['test', 'preview'],
        imageUrl: 'https://example.com/image.jpg'
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ formattedContent: mockFormattedContent })
      });

      const result = await publishingService.getFormatPreview(
        'content-123',
        'medium',
        'https://example.com/image.jpg'
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/publishing/format-preview',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentId: 'content-123',
            platform: 'medium',
            imageUrl: 'https://example.com/image.jpg'
          })
        })
      );
      expect(result).toEqual(mockFormattedContent);
    });
  });

  describe('publishToMultiplePlatforms', () => {
    it('should publish to multiple platforms', async () => {
      const mockResponse = {
        success: true,
        results: {
          medium: { success: true, platformUrl: 'https://medium.com/post/123' },
          linkedin: { success: true, platformUrl: 'https://linkedin.com/post/456' }
        }
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const platformConfigs = new Map([
        ['medium', { platform: 'medium', credentials: { accessToken: 'token1' } }],
        ['linkedin', { platform: 'linkedin', credentials: { accessToken: 'token2' } }]
      ]);

      const result = await publishingService.publishToMultiplePlatforms(
        'content-123',
        platformConfigs,
        'https://example.com/image.jpg'
      );

      expect(result).toEqual(mockResponse);
    });
  });

  describe('retryFailedPublishing', () => {
    it('should retry failed platforms only', async () => {
      const mockResponse = {
        success: true,
        results: {
          linkedin: { success: true, platformUrl: 'https://linkedin.com/post/456' }
        }
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const platformConfigs = new Map([
        ['medium', { platform: 'medium', credentials: { accessToken: 'token1' } }],
        ['linkedin', { platform: 'linkedin', credentials: { accessToken: 'token2' } }]
      ]);

      const result = await publishingService.retryFailedPublishing(
        'content-123',
        ['linkedin'], // Only retry LinkedIn
        platformConfigs
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/publishing/publish',
        expect.objectContaining({
          body: JSON.stringify({
            contentId: 'content-123',
            platforms: ['linkedin'],
            configs: {
              linkedin: { platform: 'linkedin', credentials: { accessToken: 'token2' } }
            }
          })
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('utility methods', () => {
    it('should get platform display names', () => {
      expect(publishingService.getPlatformDisplayName('medium')).toBe('Medium');
      expect(publishingService.getPlatformDisplayName('linkedin')).toBe('LinkedIn');
      expect(publishingService.getPlatformDisplayName('unknown')).toBe('unknown');
    });

    it('should get platform icons', () => {
      expect(publishingService.getPlatformIcon('medium')).toBe('📝');
      expect(publishingService.getPlatformIcon('linkedin')).toBe('💼');
      expect(publishingService.getPlatformIcon('unknown')).toBe('📄');
    });

    it('should format publishing errors', () => {
      expect(publishingService.formatPublishingError('401 unauthorized')).toContain('Authentication failed');
      expect(publishingService.formatPublishingError('403 forbidden')).toContain('Permission denied');
      expect(publishingService.formatPublishingError('429 rate limit')).toContain('Rate limit exceeded');
      expect(publishingService.formatPublishingError('500 internal server')).toContain('Server error');
      expect(publishingService.formatPublishingError('network error')).toContain('Network error');
      expect(publishingService.formatPublishingError('custom error')).toBe('custom error');
    });
  });
});