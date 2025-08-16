import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revisionService } from '../revisionService';

// Mock fetch globally
global.fetch = vi.fn();

describe('RevisionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requestContentRevision', () => {
    it('should submit content revision successfully', async () => {
      const mockResponse = {
        success: true,
        revisionId: 'revision-123',
        message: 'Content revision request submitted successfully',
        estimatedTime: 60
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await revisionService.requestContentRevision(
        'content-123',
        'Please make it more engaging'
      );

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/revision/content'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentId: 'content-123',
            feedback: 'Please make it more engaging',
            revisionType: 'content'
          }),
        })
      );
    });

    it('should handle content revision errors', async () => {
      const mockError = { error: 'Content not found' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => mockError,
      });

      await expect(revisionService.requestContentRevision('invalid-id', 'test feedback'))
        .rejects.toThrow('Content not found');
    });

    it('should include options in content revision request', async () => {
      const mockResponse = {
        success: true,
        revisionId: 'revision-123',
        message: 'Content revision request submitted successfully'
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await revisionService.requestContentRevision(
        'content-123',
        'Please make it more engaging',
        {
          userId: 'user-123',
          priority: 'high',
          specificChanges: ['tone', 'structure']
        }
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/revision/content'),
        expect.objectContaining({
          body: JSON.stringify({
            contentId: 'content-123',
            feedback: 'Please make it more engaging',
            revisionType: 'content',
            userId: 'user-123',
            priority: 'high',
            specificChanges: ['tone', 'structure']
          }),
        })
      );
    });
  });

  describe('requestImageRevision', () => {
    it('should submit image revision successfully', async () => {
      const mockResponse = {
        success: true,
        revisionId: 'revision-456',
        message: 'Image revision request submitted successfully',
        newPrompt: 'Colorful illustration of technology'
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await revisionService.requestImageRevision(
        'content-123',
        'Make it more colorful'
      );

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/revision/image'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            contentId: 'content-123',
            feedback: 'Make it more colorful',
            revisionType: 'image'
          }),
        })
      );
    });

    it('should handle image revision errors', async () => {
      const mockError = { error: 'Image generation failed' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => mockError,
      });

      await expect(revisionService.requestImageRevision('content-123', 'test feedback'))
        .rejects.toThrow('Image generation failed');
    });
  });

  describe('requestBatchRevision', () => {
    it('should submit batch revision successfully', async () => {
      const mockResponse = {
        success: true,
        message: 'Batch revision requests submitted successfully',
        results: [
          { type: 'content', success: true, revisionId: 'rev-1' },
          { type: 'image', success: true, revisionId: 'rev-2' }
        ]
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await revisionService.requestBatchRevision({
        contentId: 'content-123',
        contentFeedback: 'Make it more engaging',
        imageFeedback: 'Make it more colorful',
        userId: 'user-123'
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/revision/batch'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            contentId: 'content-123',
            contentFeedback: 'Make it more engaging',
            imageFeedback: 'Make it more colorful',
            userId: 'user-123'
          }),
        })
      );
    });
  });

  describe('getRevisionHistory', () => {
    it('should retrieve revision history successfully', async () => {
      const mockHistory = {
        contentId: 'content-123',
        revisions: [
          {
            id: 'rev-1',
            timestamp: '2024-01-01T10:00:00Z',
            feedback: 'Make it more engaging',
            revisionType: 'content',
            status: 'completed'
          }
        ],
        totalRevisions: 1
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistory,
      });

      const result = await revisionService.getRevisionHistory('content-123');

      expect(result).toEqual(mockHistory);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/revision/history/content-123'),
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });

  describe('getPendingRevisions', () => {
    it('should filter and return only pending revisions', async () => {
      const mockHistory = {
        contentId: 'content-123',
        revisions: [
          {
            id: 'rev-1',
            timestamp: '2024-01-01T10:00:00Z',
            feedback: 'Make it more engaging',
            revisionType: 'content',
            status: 'completed'
          },
          {
            id: 'rev-2',
            timestamp: '2024-01-01T11:00:00Z',
            feedback: 'Make it colorful',
            revisionType: 'image',
            status: 'processing'
          },
          {
            id: 'rev-3',
            timestamp: '2024-01-01T12:00:00Z',
            feedback: 'Add more details',
            revisionType: 'content',
            status: 'pending'
          }
        ],
        totalRevisions: 3
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistory,
      });

      const result = await revisionService.getPendingRevisions('content-123');

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('processing');
      expect(result[1].status).toBe('pending');
    });
  });

  describe('hasPendingRevisions', () => {
    it('should return true when there are pending revisions', async () => {
      const mockHistory = {
        contentId: 'content-123',
        revisions: [
          {
            id: 'rev-1',
            timestamp: '2024-01-01T10:00:00Z',
            feedback: 'Make it more engaging',
            revisionType: 'content',
            status: 'pending'
          }
        ],
        totalRevisions: 1
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistory,
      });

      const result = await revisionService.hasPendingRevisions('content-123');

      expect(result).toBe(true);
    });

    it('should return false when there are no pending revisions', async () => {
      const mockHistory = {
        contentId: 'content-123',
        revisions: [
          {
            id: 'rev-1',
            timestamp: '2024-01-01T10:00:00Z',
            feedback: 'Make it more engaging',
            revisionType: 'content',
            status: 'completed'
          }
        ],
        totalRevisions: 1
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistory,
      });

      const result = await revisionService.hasPendingRevisions('content-123');

      expect(result).toBe(false);
    });
  });

  describe('getRevisionStats', () => {
    it('should calculate revision statistics correctly', async () => {
      const mockHistory = {
        contentId: 'content-123',
        revisions: [
          {
            id: 'rev-1',
            revisionType: 'content',
            status: 'completed'
          },
          {
            id: 'rev-2',
            revisionType: 'image',
            status: 'failed'
          },
          {
            id: 'rev-3',
            revisionType: 'content',
            status: 'pending'
          },
          {
            id: 'rev-4',
            revisionType: 'image',
            status: 'processing'
          }
        ],
        totalRevisions: 4
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistory,
      });

      const result = await revisionService.getRevisionStats('content-123');

      expect(result).toEqual({
        total: 4,
        completed: 1,
        failed: 1,
        pending: 2,
        contentRevisions: 2,
        imageRevisions: 2
      });
    });
  });

  describe('retryRevision', () => {
    it('should retry a failed content revision', async () => {
      const mockHistory = {
        contentId: 'content-123',
        revisions: [
          {
            id: 'rev-1',
            feedback: 'Make it more engaging',
            revisionType: 'content',
            status: 'failed',
            userId: 'user-123'
          }
        ],
        totalRevisions: 1
      };

      const mockRetryResponse = {
        success: true,
        revisionId: 'rev-2',
        message: 'Content revision request submitted successfully'
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockHistory,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockRetryResponse,
        });

      const result = await revisionService.retryRevision('content-123', 'rev-1');

      expect(result).toEqual(mockRetryResponse);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error when trying to retry non-failed revision', async () => {
      const mockHistory = {
        contentId: 'content-123',
        revisions: [
          {
            id: 'rev-1',
            feedback: 'Make it more engaging',
            revisionType: 'content',
            status: 'completed'
          }
        ],
        totalRevisions: 1
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistory,
      });

      await expect(revisionService.retryRevision('content-123', 'rev-1'))
        .rejects.toThrow('Can only retry failed revisions');
    });
  });

  describe('getEstimatedCompletionTime', () => {
    it('should calculate estimated completion time correctly', async () => {
      const mockHistory = {
        contentId: 'content-123',
        revisions: [
          {
            id: 'rev-1',
            revisionType: 'content',
            status: 'pending'
          },
          {
            id: 'rev-2',
            revisionType: 'image',
            status: 'processing'
          },
          {
            id: 'rev-3',
            revisionType: 'content',
            status: 'completed'
          }
        ],
        totalRevisions: 3
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockHistory,
      });

      const result = await revisionService.getEstimatedCompletionTime('content-123');

      // 60 seconds for content + 45 seconds for image = 105 seconds
      expect(result).toBe(105);
    });
  });

  describe('validateFeedback', () => {
    it('should validate feedback correctly', () => {
      const validFeedback = 'Please adjust the tone to be more professional and engaging';
      const result = revisionService.validateFeedback(validFeedback, 'content');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should identify empty feedback as invalid', () => {
      const result = revisionService.validateFeedback('', 'content');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Feedback cannot be empty');
    });

    it('should identify too short feedback as invalid', () => {
      const result = revisionService.validateFeedback('short', 'content');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Feedback should be at least 10 characters long');
    });

    it('should identify too long feedback as invalid', () => {
      const longFeedback = 'a'.repeat(1001);
      const result = revisionService.validateFeedback(longFeedback, 'content');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Feedback should be less than 1000 characters');
    });

    it('should provide suggestions for vague feedback', () => {
      const vagueFeedback = 'This is not good';
      const result = revisionService.validateFeedback(vagueFeedback, 'content');

      expect(result.suggestions).toContain('Consider specifying what aspect to change: tone, structure, information, or length');
    });

    it('should suggest constructive feedback for negative language', () => {
      const negativeFeedback = 'This is bad and wrong';
      const result = revisionService.validateFeedback(negativeFeedback, 'content');

      expect(result.suggestions).toContain('Try to provide constructive feedback about what you\'d like to see instead');
    });
  });
});