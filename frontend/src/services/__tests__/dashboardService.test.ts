import { vi } from 'vitest';
import { dashboardService, DashboardService } from '../dashboardService';
import { BlogContent, ContentStatus } from '../../types/BlogContent';

// Mock fetch globally
global.fetch = vi.fn();

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(() => {
    service = new DashboardService('https://api.test.com');
    vi.clearAllMocks();
  });

  const mockBlogContent: BlogContent = {
    id: 'content-123',
    userId: 'user-123',
    title: 'Test Blog Post',
    originalTranscription: 'Original transcription',
    currentDraft: 'Current draft content',
    associatedImage: 'image-123',
    imageUrl: 'https://example.com/image.jpg',
    status: 'draft' as ContentStatus,
    revisionHistory: [],
    publishingResults: [],
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-02T00:00:00Z'),
  };

  describe('getRecentContent', () => {
    it('should fetch recent content successfully', async () => {
      const mockResponse = {
        items: [mockBlogContent],
        totalCount: 1,
        page: 1,
        pageSize: 10,
        hasMore: false,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getRecentContent('user-123');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboard/content/user-123'),
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should handle filters correctly', async () => {
      const mockResponse = {
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 10,
        hasMore: false,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const filters = {
        status: ['draft', 'published'] as ContentStatus[],
        platform: ['Medium', 'LinkedIn'],
        searchQuery: 'test query',
        dateRange: {
          start: new Date('2023-01-01'),
          end: new Date('2023-01-31'),
        },
      };

      await service.getRecentContent('user-123', 1, 10, filters);

      const expectedUrl = expect.stringContaining('/api/dashboard/content/user-123');
      expect(global.fetch).toHaveBeenCalledWith(
        expectedUrl,
        expect.objectContaining({
          method: 'GET',
        })
      );

      // Check that URL contains filter parameters
      const actualCall = (global.fetch as any).mock.calls[0][0];
      expect(actualCall).toContain('status=draft%2Cpublished');
      expect(actualCall).toContain('platform=Medium%2CLinkedIn');
      expect(actualCall).toContain('search=test+query');
      expect(actualCall).toContain('startDate=2023-01-01T00%3A00%3A00.000Z');
      expect(actualCall).toContain('endDate=2023-01-31T00%3A00%3A00.000Z');
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(service.getRecentContent('user-123')).rejects.toThrow(
        'Failed to fetch content: Internal Server Error'
      );
    });

    it('should transform date strings to Date objects', async () => {
      const mockResponseWithStringDates = {
        items: [{
          ...mockBlogContent,
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-02T00:00:00Z',
          revisionHistory: [{
            id: 'rev-1',
            contentId: 'content-123',
            version: 1,
            content: 'revision content',
            feedback: 'feedback',
            createdAt: '2023-01-01T12:00:00Z',
            timestamp: '2023-01-01T12:00:00Z',
            agentType: 'content' as const,
            type: 'content' as const,
          }],
          publishingResults: [{
            platform: 'Medium',
            status: 'success' as const,
            publishedUrl: 'https://medium.com/post',
            publishedAt: '2023-01-02T10:00:00Z',
          }],
        }],
        totalCount: 1,
        page: 1,
        pageSize: 10,
        hasMore: false,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponseWithStringDates,
      });

      const result = await service.getRecentContent('user-123');

      expect(result.items[0].createdAt).toBeInstanceOf(Date);
      expect(result.items[0].updatedAt).toBeInstanceOf(Date);
      expect(result.items[0].revisionHistory[0].createdAt).toBeInstanceOf(Date);
      expect(result.items[0].revisionHistory[0].timestamp).toBeInstanceOf(Date);
      expect(result.items[0].publishingResults[0].publishedAt).toBeInstanceOf(Date);
    });
  });

  describe('getDashboardStats', () => {
    it('should fetch dashboard stats successfully', async () => {
      const mockStats = {
        totalPosts: 10,
        publishedPosts: 7,
        draftPosts: 2,
        failedPosts: 1,
        recentActivity: 5,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStats,
      });

      const result = await service.getDashboardStats('user-123');

      expect(result).toEqual(mockStats);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboard/stats/user-123'),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(service.getDashboardStats('user-123')).rejects.toThrow(
        'Failed to fetch dashboard stats: Not Found'
      );
    });
  });

  describe('getContent', () => {
    it('should fetch specific content successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockBlogContent,
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-02T00:00:00Z',
        }),
      });

      const result = await service.getContent('content-123');

      expect(result.id).toBe('content-123');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/content/content-123'),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('updateContent', () => {
    it('should update content successfully', async () => {
      const updates = { title: 'Updated Title', status: 'published' as ContentStatus };
      const updatedContent = { ...mockBlogContent, ...updates };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...updatedContent,
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-02T00:00:00Z',
        }),
      });

      const result = await service.updateContent('content-123', updates);

      expect(result.title).toBe('Updated Title');
      expect(result.status).toBe('published');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/content/content-123'),
        expect.objectContaining({
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
        })
      );
    });
  });

  describe('deleteContent', () => {
    it('should delete content successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
      });

      await service.deleteContent('content-123');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/content/content-123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should handle delete errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
      });

      await expect(service.deleteContent('content-123')).rejects.toThrow(
        'Failed to delete content: Forbidden'
      );
    });
  });

  describe('searchContent', () => {
    it('should search content with query', async () => {
      const mockResponse = {
        items: [mockBlogContent],
        totalCount: 1,
        page: 1,
        pageSize: 10,
        hasMore: false,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.searchContent('user-123', 'test query');

      expect(result).toEqual(mockResponse);
      const actualCall = (global.fetch as any).mock.calls[0][0];
      expect(actualCall).toContain('search=test+query');
    });
  });

  describe('getDrafts', () => {
    it('should fetch drafts only', async () => {
      const mockResponse = {
        items: [mockBlogContent],
        totalCount: 1,
        page: 1,
        pageSize: 10,
        hasMore: false,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getDrafts('user-123');

      expect(result).toEqual(mockResponse);
      const actualCall = (global.fetch as any).mock.calls[0][0];
      expect(actualCall).toContain('status=draft%2Cready_for_review%2Crevision_requested');
    });
  });

  describe('getPublishedPosts', () => {
    it('should fetch published posts only', async () => {
      const mockResponse = {
        items: [{ ...mockBlogContent, status: 'published' as ContentStatus }],
        totalCount: 1,
        page: 1,
        pageSize: 10,
        hasMore: false,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.getPublishedPosts('user-123');

      expect(result).toEqual(mockResponse);
      const actualCall = (global.fetch as any).mock.calls[0][0];
      expect(actualCall).toContain('status=published%2Ccompleted');
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(dashboardService).toBeInstanceOf(DashboardService);
    });
  });
});