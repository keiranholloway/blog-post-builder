import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageGenerationService } from '../imageGenerationService';

// Mock fetch globally
global.fetch = vi.fn();

describe('ImageGenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateImage', () => {
    it('should generate image successfully', async () => {
      const mockResponse = {
        success: true,
        imageUrl: 'https://example.com/image.png'
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request = {
        contentId: 'test-content-id',
        prompt: 'A beautiful landscape',
        size: '1024x1024' as const
      };

      const result = await imageGenerationService.generateImage(request);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/image/generate'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })
      );
    });

    it('should handle generation errors', async () => {
      const mockError = { error: 'Generation failed' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => mockError,
      });

      const request = {
        contentId: 'test-content-id',
        prompt: 'A beautiful landscape'
      };

      await expect(imageGenerationService.generateImage(request))
        .rejects.toThrow('Generation failed');
    });
  });

  describe('getImageStatus', () => {
    it('should get image status successfully', async () => {
      const mockStatus = {
        contentId: 'test-content-id',
        status: 'completed' as const,
        imageUrl: 'https://example.com/image.png'
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      });

      const result = await imageGenerationService.getImageStatus('test-content-id');

      expect(result).toEqual(mockStatus);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/image/status/test-content-id'),
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });

  describe('requestImageRevision', () => {
    it('should request image revision successfully', async () => {
      const mockResponse = {
        success: true,
        imageUrl: 'https://example.com/revised-image.png'
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await imageGenerationService.requestImageRevision(
        'test-content-id',
        'Make it more colorful',
        'A colorful landscape'
      );

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/image/revise'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            contentId: 'test-content-id',
            feedback: 'Make it more colorful',
            newPrompt: 'A colorful landscape'
          }),
        })
      );
    });
  });

  describe('analyzeContentForImage', () => {
    it('should analyze content and return image prompt', async () => {
      const mockAnalysis = {
        prompt: 'Professional illustration of technology and innovation',
        style: 'professional'
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockAnalysis,
      });

      const content = 'This article discusses the latest trends in technology and innovation.';
      const result = await imageGenerationService.analyzeContentForImage(content);

      expect(result).toEqual(mockAnalysis);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/image/analyze'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content }),
        })
      );
    });
  });

  describe('pollImageStatus', () => {
    it('should poll until completion', async () => {
      const pendingStatus = {
        contentId: 'test-content-id',
        status: 'generating' as const
      };

      const completedStatus = {
        contentId: 'test-content-id',
        status: 'completed' as const,
        imageUrl: 'https://example.com/image.png'
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => pendingStatus,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => completedStatus,
        });

      const result = await imageGenerationService.pollImageStatus('test-content-id', 5000, 100);

      expect(result).toEqual(completedStatus);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should timeout if generation takes too long', async () => {
      const pendingStatus = {
        contentId: 'test-content-id',
        status: 'generating' as const
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => pendingStatus,
      });

      await expect(imageGenerationService.pollImageStatus('test-content-id', 200, 50))
        .rejects.toThrow('Image generation timeout');
    });
  });

  describe('generateImagePrompt', () => {
    it('should generate appropriate image prompt from content', () => {
      const title = 'The Future of AI';
      const content = 'Artificial intelligence is revolutionizing technology and changing how we work with automation and machine learning algorithms.';
      
      const prompt = imageGenerationService.generateImagePrompt(title, content, 'professional');
      
      expect(prompt).toContain('professional illustration');
      expect(prompt).toContain('The Future of AI');
      expect(prompt).toContain('artificial');
      expect(prompt).toContain('intelligence');
    });

    it('should handle different styles', () => {
      const title = 'Creative Design';
      const content = 'Design thinking involves creativity and innovation in problem solving.';
      
      const prompt = imageGenerationService.generateImagePrompt(title, content, 'creative');
      
      expect(prompt).toContain('artistic, creative, vibrant illustration');
    });

    it('should default to professional style', () => {
      const title = 'Business Strategy';
      const content = 'Strategic planning requires careful analysis and execution.';
      
      const prompt = imageGenerationService.generateImagePrompt(title, content);
      
      expect(prompt).toContain('clean, modern, professional illustration');
    });

    it('should handle technical content appropriately', () => {
      const title = 'AWS Lambda Architecture';
      const content = 'This guide covers serverless functions, API Gateway integration, and DynamoDB connections for scalable applications.';
      
      const prompt = imageGenerationService.generateImagePrompt(title, content, 'technical');
      
      expect(prompt).toContain('technical diagram');
      expect(prompt).toContain('AWS Lambda Architecture');
      expect(prompt).toContain('serverless');
    });

    it('should extract key concepts correctly', () => {
      const title = 'Cloud Cost Optimization';
      const content = 'Learn about FinOps practices, AWS cost management, resource optimization, and budget monitoring for enterprise workloads.';
      
      const prompt = imageGenerationService.generateImagePrompt(title, content, 'professional');
      
      expect(prompt.toLowerCase()).toContain('finops');
      expect(prompt.toLowerCase()).toContain('cost');
      expect(prompt.toLowerCase()).toContain('optimization');
    });
  });
});