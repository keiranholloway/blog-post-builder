import { describe, it, expect, beforeEach, vi } from 'vitest';
import contentGenerationService, { 
  ContentGenerationRequest, 
  ContentRevisionRequest,
  UserContentPreferences 
} from '../contentGenerationService';
import { BlogContent } from '../../types/BlogContent';
import { AgentMessage } from '../../types/AgentMessage';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock environment variable
vi.mock('import.meta', () => ({
  env: {
    VITE_API_BASE_URL: 'https://api.example.com'
  }
}));

describe('ContentGenerationService', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('generateContent', () => {
    it('should successfully initiate content generation', async () => {
      const mockResponse = {
        message: 'Content generation initiated',
        data: { contentId: 'content-123' },
        version: '1.0.0'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: ContentGenerationRequest = {
        transcription: 'I want to write about the benefits of meditation and mindfulness practices.',
        userId: 'user-123',
        userContext: 'Wellness blogger focused on mental health',
        preferences: {
          tone: 'conversational',
          length: 'medium',
          targetAudience: 'general wellness enthusiasts',
          writingStyle: 'warm and encouraging'
        }
      };

      const result = await contentGenerationService.generateContent(request);

      expect(result.contentId).toBe('content-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/content/generate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transcription: request.transcription,
            userId: request.userId,
            userContext: request.userContext,
            preferences: request.preferences
          })
        }
      );
    });

    it('should use default preferences when none provided', async () => {
      const mockResponse = {
        message: 'Content generation initiated',
        data: { contentId: 'content-456' },
        version: '1.0.0'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: ContentGenerationRequest = {
        transcription: 'Simple transcription without preferences',
        userId: 'user-456'
      };

      await contentGenerationService.generateContent(request);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/content/generate',
        expect.objectContaining({
          body: expect.stringContaining('"tone":"conversational"')
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid transcription' })
      });

      const request: ContentGenerationRequest = {
        transcription: '',
        userId: 'user-123'
      };

      await expect(contentGenerationService.generateContent(request))
        .rejects.toThrow('Invalid transcription');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const request: ContentGenerationRequest = {
        transcription: 'Test transcription',
        userId: 'user-123'
      };

      await expect(contentGenerationService.generateContent(request))
        .rejects.toThrow('Network error');
    });
  });

  describe('requestRevision', () => {
    it('should successfully request content revision', async () => {
      const mockResponse = {
        message: 'Content revision initiated',
        data: { revisionId: 'revision-123' },
        version: '1.0.0'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const request: ContentRevisionRequest = {
        contentId: 'content-123',
        currentContent: 'This is the current blog post content.',
        feedback: 'Please make it more engaging and add examples.',
        revisionType: 'style',
        userId: 'user-123'
      };

      const result = await contentGenerationService.requestRevision(request);

      expect(result.revisionId).toBe('revision-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/content/revise',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request)
        }
      );
    });

    it('should handle revision request errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Content not found' })
      });

      const request: ContentRevisionRequest = {
        contentId: 'nonexistent-content',
        currentContent: 'Content',
        feedback: 'Feedback',
        revisionType: 'content',
        userId: 'user-123'
      };

      await expect(contentGenerationService.requestRevision(request))
        .rejects.toThrow('Content not found');
    });
  });

  describe('getContentStatus', () => {
    it('should retrieve content status successfully', async () => {
      const mockStatus = {
        message: 'Content status retrieved',
        data: {
          contentId: 'content-123',
          status: 'processing',
          progress: 50,
          currentStep: 'content-generation',
          estimatedTimeRemaining: 120
        },
        version: '1.0.0'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus
      });

      const status = await contentGenerationService.getContentStatus('content-123');

      expect(status.contentId).toBe('content-123');
      expect(status.status).toBe('processing');
      expect(status.progress).toBe(50);
      expect(status.currentStep).toBe('content-generation');
      expect(status.estimatedTimeRemaining).toBe(120);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/content/status/content-123',
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    });

    it('should handle status retrieval errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Not found' })
      });

      await expect(contentGenerationService.getContentStatus('nonexistent-content'))
        .rejects.toThrow('HTTP 404: Not Found');
    });
  });

  describe('getGeneratedContent', () => {
    it('should retrieve generated content successfully', async () => {
      const mockContentData = {
        id: 'content-123',
        userId: 'user-123',
        title: 'The Power of Mindfulness',
        originalTranscription: 'I want to write about meditation...',
        currentDraft: 'Mindfulness and meditation have become...',
        associatedImage: 'image-123',
        imageUrl: 'https://example.com/image.jpg',
        status: 'ready_for_review',
        revisionHistory: [],
        publishingResults: [],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T01:00:00Z'
      };

      const mockResponse = {
        message: 'Content retrieved',
        data: mockContentData,
        version: '1.0.0'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const content = await contentGenerationService.getGeneratedContent('content-123');

      expect(content.id).toBe('content-123');
      expect(content.title).toBe('The Power of Mindfulness');
      expect(content.status).toBe('ready_for_review');
      expect(content.createdAt).toBeInstanceOf(Date);
      expect(content.updatedAt).toBeInstanceOf(Date);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/content/content-123',
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    });
  });

  describe('getAgentMessages', () => {
    it('should retrieve agent messages successfully', async () => {
      const mockMessagesData = [
        {
          id: 'msg-1',
          contentId: 'content-123',
          agentType: 'content',
          messageType: 'generate_content',
          payload: { transcription: 'test' },
          status: 'completed',
          createdAt: '2023-01-01T00:00:00Z',
          processedAt: '2023-01-01T00:01:00Z'
        },
        {
          id: 'msg-2',
          contentId: 'content-123',
          agentType: 'image',
          messageType: 'generate_image',
          payload: { content: 'test content' },
          status: 'processing',
          createdAt: '2023-01-01T00:02:00Z'
        }
      ];

      const mockResponse = {
        message: 'Content messages retrieved',
        data: { messages: mockMessagesData },
        version: '1.0.0'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const messages = await contentGenerationService.getAgentMessages('content-123');

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('msg-1');
      expect(messages[0].agentType).toBe('content');
      expect(messages[0].status).toBe('completed');
      expect(messages[0].createdAt).toBeInstanceOf(Date);
      expect(messages[0].processedAt).toBeInstanceOf(Date);

      expect(messages[1].id).toBe('msg-2');
      expect(messages[1].agentType).toBe('image');
      expect(messages[1].processedAt).toBeUndefined();
    });
  });

  describe('validateContent', () => {
    it('should validate content successfully', async () => {
      const mockValidation = {
        message: 'Content validation completed',
        data: {
          isValid: true,
          score: 8.5,
          issues: [],
          suggestions: ['Consider adding more examples']
        },
        version: '1.0.0'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockValidation
      });

      const validation = await contentGenerationService.validateContent(
        'This is a well-written blog post with good structure and content.'
      );

      expect(validation.isValid).toBe(true);
      expect(validation.score).toBe(8.5);
      expect(validation.issues).toEqual([]);
      expect(validation.suggestions).toContain('Consider adding more examples');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/content/validate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: 'This is a well-written blog post with good structure and content.'
          })
        }
      );
    });

    it('should identify content issues', async () => {
      const mockValidation = {
        message: 'Content validation completed',
        data: {
          isValid: false,
          score: 4.0,
          issues: ['Content is too short', 'Missing proper conclusion'],
          suggestions: ['Add more detail', 'Include a summary']
        },
        version: '1.0.0'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockValidation
      });

      const validation = await contentGenerationService.validateContent('Short content');

      expect(validation.isValid).toBe(false);
      expect(validation.score).toBe(4.0);
      expect(validation.issues).toContain('Content is too short');
      expect(validation.suggestions).toContain('Add more detail');
    });
  });

  describe('pollContentStatus', () => {
    it('should poll until content is completed', async () => {
      const statusUpdates = [
        { contentId: 'content-123', status: 'processing', progress: 25 },
        { contentId: 'content-123', status: 'processing', progress: 50 },
        { contentId: 'content-123', status: 'processing', progress: 75 },
        { contentId: 'content-123', status: 'completed', progress: 100 }
      ];

      let callCount = 0;
      mockFetch.mockImplementation(() => {
        const status = statusUpdates[callCount++];
        return Promise.resolve({
          ok: true,
          json: async () => ({
            message: 'Content status retrieved',
            data: status,
            version: '1.0.0'
          })
        });
      });

      const updateCallback = vi.fn();
      
      const finalStatus = await contentGenerationService.pollContentStatus(
        'content-123',
        updateCallback,
        10, // Very short interval for testing
        10  // Max attempts
      );

      expect(finalStatus.status).toBe('completed');
      expect(finalStatus.progress).toBe(100);
      expect(updateCallback).toHaveBeenCalledTimes(4);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should timeout after max attempts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: 'Content status retrieved',
          data: { contentId: 'content-123', status: 'processing', progress: 50 },
          version: '1.0.0'
        })
      });

      const updateCallback = vi.fn();
      
      await expect(
        contentGenerationService.pollContentStatus(
          'content-123',
          updateCallback,
          10, // Very short interval
          3   // Max 3 attempts
        )
      ).rejects.toThrow('Polling timeout: Content generation took too long');

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(updateCallback).toHaveBeenCalledTimes(3);
    });

    it('should resolve immediately on failed status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: 'Content status retrieved',
          data: { 
            contentId: 'content-123', 
            status: 'failed', 
            error: 'Content generation failed' 
          },
          version: '1.0.0'
        })
      });

      const updateCallback = vi.fn();
      
      const finalStatus = await contentGenerationService.pollContentStatus(
        'content-123',
        updateCallback,
        10,
        10
      );

      expect(finalStatus.status).toBe('failed');
      expect(finalStatus.error).toBe('Content generation failed');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(updateCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Payload Creation Helpers', () => {
    it('should create content generation payload correctly', () => {
      const payload = contentGenerationService.createContentGenerationPayload(
        'Test transcription',
        'User context',
        'Writing style'
      );

      expect(payload).toEqual({
        transcription: 'Test transcription',
        userContext: 'User context',
        writingStyle: 'Writing style'
      });
    });

    it('should create content revision payload correctly', () => {
      const payload = contentGenerationService.createContentRevisionPayload(
        'Current content',
        'Feedback',
        'User context'
      );

      expect(payload).toEqual({
        currentContent: 'Current content',
        feedback: 'Feedback',
        userContext: 'User context'
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => { throw new Error('Invalid JSON'); }
      });

      await expect(
        contentGenerationService.generateContent({
          transcription: 'test',
          userId: 'user-123'
        })
      ).rejects.toThrow('HTTP 500: Internal Server Error');
    });

    it('should handle fetch failures', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Fetch failed'));

      await expect(
        contentGenerationService.getContentStatus('content-123')
      ).rejects.toThrow('Fetch failed');
    });
  });
});