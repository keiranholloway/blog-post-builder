import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BasePublishingAgent, PublishingConfig, PublishResult, FormattedContent } from '../lambda/publishing/base-publishing-agent';
import { MediumPublishingAgent } from '../lambda/publishing/medium-agent';
import { LinkedInPublishingAgent } from '../lambda/publishing/linkedin-agent';
import { PublishingAgentRegistry } from '../lambda/publishing/publishing-agent-registry';
import { BlogContent } from '../../frontend/src/types/BlogContent';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('BasePublishingAgent', () => {
  class TestPublishingAgent extends BasePublishingAgent {
    readonly platformName = 'Test';
    readonly supportedFeatures = ['test-feature'];

    async validateCredentials(credentials: Record<string, any>): Promise<boolean> {
      return credentials.token === 'valid-token';
    }

    async formatContent(content: BlogContent, imageUrl?: string): Promise<FormattedContent> {
      return {
        title: 'Test Title',
        body: content.currentDraft,
        imageUrl
      };
    }

    async publish(formattedContent: FormattedContent, config: PublishingConfig): Promise<PublishResult> {
      return {
        success: true,
        platformUrl: 'https://test.com/post/123',
        platformId: '123'
      };
    }

    async getPublishingStatus(platformId: string, config: PublishingConfig): Promise<'published' | 'draft' | 'failed' | 'unknown'> {
      return 'published';
    }
  }

  let agent: TestPublishingAgent;

  beforeEach(() => {
    agent = new TestPublishingAgent();
  });

  it('should validate required credentials', () => {
    expect(() => {
      (agent as any).validateRequiredCredentials({ token: 'test' }, ['token', 'secret']);
    }).toThrow('Missing required credential: secret');

    expect(() => {
      (agent as any).validateRequiredCredentials({ token: 'test', secret: 'secret' }, ['token', 'secret']);
    }).not.toThrow();
  });

  it('should sanitize content', () => {
    const maliciousContent = '<script>alert("xss")</script><p>Safe content</p><iframe src="evil.com"></iframe>';
    const sanitized = (agent as any).sanitizeContent(maliciousContent);
    
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('<iframe>');
    expect(sanitized).toContain('<p>Safe content</p>');
  });

  it('should extract tags from content', () => {
    const content = 'This is a post about #javascript and #typescript. Also #webdev';
    const tags = (agent as any).extractTags(content);
    
    expect(tags).toEqual(['javascript', 'typescript', 'webdev']);
  });

  it('should remove duplicate tags', () => {
    const content = 'Post about #javascript and #javascript again';
    const tags = (agent as any).extractTags(content);
    
    expect(tags).toEqual(['javascript']);
  });
});

describe('MediumPublishingAgent', () => {
  let agent: MediumPublishingAgent;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    agent = new MediumPublishingAgent();
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockClear();
  });

  it('should have correct platform properties', () => {
    expect(agent.platformName).toBe('Medium');
    expect(agent.supportedFeatures).toContain('tags');
    expect(agent.supportedFeatures).toContain('images');
    expect(agent.supportedFeatures).toContain('markdown');
  });

  it('should validate credentials successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'user123' } })
    } as Response);

    const isValid = await agent.validateCredentials({ accessToken: 'valid-token' });
    expect(isValid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.medium.com/v1/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer valid-token'
        })
      })
    );
  });

  it('should handle credential validation failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401
    } as Response);

    const isValid = await agent.validateCredentials({ accessToken: 'invalid-token' });
    expect(isValid).toBe(false);
  });

  it('should format content correctly', async () => {
    const blogContent: BlogContent = {
      id: 'test-id',
      userId: 'user-id',
      originalTranscription: 'Original text',
      currentDraft: '# Test Title\n\nThis is the body content with #javascript and #webdev tags.',
      status: 'draft',
      revisionHistory: [],
      publishingResults: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const formatted = await agent.formatContent(blogContent, 'https://example.com/image.jpg');

    expect(formatted.title).toBe('Test Title');
    expect(formatted.body).toContain('![Test Title](https://example.com/image.jpg)');
    expect(formatted.body).toContain('This is the body content');
    expect(formatted.tags).toEqual(['javascript', 'webdev']);
    expect(formatted.imageUrl).toBe('https://example.com/image.jpg');
  });

  it('should publish content successfully', async () => {
    // Mock user info request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'user123' } })
    } as Response);

    // Mock publish request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 'post123',
          title: 'Test Post',
          url: 'https://medium.com/@user/test-post-123',
          canonicalUrl: 'https://medium.com/@user/test-post-123',
          publishedAt: Date.now(),
          authorId: 'user123'
        }
      })
    } as Response);

    const formattedContent: FormattedContent = {
      title: 'Test Post',
      body: 'Test content',
      tags: ['test']
    };

    const config: PublishingConfig = {
      platform: 'medium',
      credentials: { accessToken: 'valid-token' }
    };

    const result = await agent.publish(formattedContent, config);

    expect(result.success).toBe(true);
    expect(result.platformUrl).toBe('https://medium.com/@user/test-post-123');
    expect(result.platformId).toBe('post123');
  });

  it('should handle publish failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request'
    } as Response);

    const formattedContent: FormattedContent = {
      title: 'Test Post',
      body: 'Test content'
    };

    const config: PublishingConfig = {
      platform: 'medium',
      credentials: { accessToken: 'invalid-token' }
    };

    const result = await agent.publish(formattedContent, config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Medium API error');
  });
});

describe('LinkedInPublishingAgent', () => {
  let agent: LinkedInPublishingAgent;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    agent = new LinkedInPublishingAgent();
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockClear();
  });

  it('should have correct platform properties', () => {
    expect(agent.platformName).toBe('LinkedIn');
    expect(agent.supportedFeatures).toContain('images');
    expect(agent.supportedFeatures).toContain('professional-formatting');
    expect(agent.supportedFeatures).toContain('hashtags');
  });

  it('should format content for professional context', async () => {
    const blogContent: BlogContent = {
      id: 'test-id',
      userId: 'user-id',
      originalTranscription: 'Original text',
      currentDraft: '# Professional Insight\n\nThis is a key insight about #leadership and #technology.',
      status: 'draft',
      revisionHistory: [],
      publishingResults: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const formatted = await agent.formatContent(blogContent);

    expect(formatted.title).toBe('Professional Insight');
    expect(formatted.body).toContain('**Professional Insight**');
    expect(formatted.tags).toEqual(['leadership', 'technology']);
  });

  it('should publish to LinkedIn successfully', async () => {
    // Mock profile request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'person123' })
    } as Response);

    // Mock publish request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'ugc123',
        activity: 'urn:li:activity:123'
      })
    } as Response);

    const formattedContent: FormattedContent = {
      title: 'Professional Update',
      body: 'Professional content',
      tags: ['leadership']
    };

    const config: PublishingConfig = {
      platform: 'linkedin',
      credentials: { accessToken: 'valid-token' }
    };

    const result = await agent.publish(formattedContent, config);

    expect(result.success).toBe(true);
    expect(result.platformUrl).toContain('linkedin.com/feed/update');
    expect(result.platformId).toBe('ugc123');
  });
});

describe('PublishingAgentRegistry', () => {
  let registry: PublishingAgentRegistry;

  beforeEach(() => {
    // Create a new instance for each test
    registry = new (PublishingAgentRegistry as any)();
    (registry as any).registerDefaultAgents();
  });

  it('should register default agents', () => {
    const platforms = registry.getSupportedPlatforms();
    expect(platforms).toContain('medium');
    expect(platforms).toContain('linkedin');
  });

  it('should get agent by platform name', () => {
    const mediumAgent = registry.getAgent('medium');
    expect(mediumAgent).toBeInstanceOf(MediumPublishingAgent);

    const linkedinAgent = registry.getAgent('linkedin');
    expect(linkedinAgent).toBeInstanceOf(LinkedInPublishingAgent);
  });

  it('should return null for unknown platform', () => {
    const unknownAgent = registry.getAgent('unknown');
    expect(unknownAgent).toBeNull();
  });

  it('should enable and disable agents', () => {
    expect(registry.getAgent('medium')).not.toBeNull();
    
    registry.disableAgent('medium');
    expect(registry.getAgent('medium')).toBeNull();
    
    registry.enableAgent('medium');
    expect(registry.getAgent('medium')).not.toBeNull();
  });

  it('should register custom agents', () => {
    class CustomAgent extends BasePublishingAgent {
      readonly platformName = 'Custom';
      readonly supportedFeatures = ['custom-feature'];

      async validateCredentials(): Promise<boolean> { return true; }
      async formatContent(): Promise<FormattedContent> { 
        return { title: 'Custom', body: 'Custom content' }; 
      }
      async publish(): Promise<PublishResult> { 
        return { success: true }; 
      }
      async getPublishingStatus(): Promise<'published' | 'draft' | 'failed' | 'unknown'> { 
        return 'published'; 
      }
    }

    const customAgent = new CustomAgent();
    registry.registerAgent('custom', customAgent);

    expect(registry.getSupportedPlatforms()).toContain('custom');
    expect(registry.getAgent('custom')).toBe(customAgent);
  });

  it('should unregister agents', () => {
    expect(registry.getAgent('medium')).not.toBeNull();
    
    const unregistered = registry.unregisterAgent('medium');
    expect(unregistered).toBe(true);
    expect(registry.getAgent('medium')).toBeNull();
  });

  it('should get platform features', () => {
    const mediumFeatures = registry.getPlatformFeatures('medium');
    expect(mediumFeatures).toContain('tags');
    expect(mediumFeatures).toContain('images');
    expect(mediumFeatures).toContain('markdown');
  });

  it('should publish to multiple platforms', async () => {
    const mockMediumAgent = {
      formatContent: jest.fn(),
      publish: jest.fn()
    } as any;
    
    mockMediumAgent.formatContent.mockResolvedValue({ title: 'Test', body: 'Content' });
    mockMediumAgent.publish.mockResolvedValue({ success: true, platformId: 'medium123' });

    const mockLinkedInAgent = {
      formatContent: jest.fn(),
      publish: jest.fn()
    } as any;
    
    mockLinkedInAgent.formatContent.mockResolvedValue({ title: 'Test', body: 'Content' });
    mockLinkedInAgent.publish.mockResolvedValue({ success: true, platformId: 'linkedin123' });

    // Replace agents with mocks
    (registry as any).agents.set('medium', { 
      name: 'medium', 
      agent: mockMediumAgent, 
      isEnabled: true 
    });
    (registry as any).agents.set('linkedin', { 
      name: 'linkedin', 
      agent: mockLinkedInAgent, 
      isEnabled: true 
    });

    const blogContent: BlogContent = {
      id: 'test-id',
      userId: 'user-id',
      originalTranscription: 'Original',
      currentDraft: 'Test content',
      status: 'draft',
      revisionHistory: [],
      publishingResults: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const configs = new Map([
      ['medium', { platform: 'medium', credentials: { accessToken: 'token1' } }],
      ['linkedin', { platform: 'linkedin', credentials: { accessToken: 'token2' } }]
    ]);

    const results = await registry.publishToMultiplePlatforms(
      ['medium', 'linkedin'],
      blogContent,
      configs
    );

    expect(results.size).toBe(2);
    expect(results.get('medium')?.success).toBe(true);
    expect(results.get('linkedin')?.success).toBe(true);
  });
});