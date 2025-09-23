"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const base_publishing_agent_1 = require("../lambda/publishing/base-publishing-agent");
const medium_agent_1 = require("../lambda/publishing/medium-agent");
const linkedin_agent_1 = require("../lambda/publishing/linkedin-agent");
const publishing_agent_registry_1 = require("../lambda/publishing/publishing-agent-registry");
// Mock fetch globally
global.fetch = globals_1.jest.fn();
(0, globals_1.describe)('BasePublishingAgent', () => {
    class TestPublishingAgent extends base_publishing_agent_1.BasePublishingAgent {
        constructor() {
            super(...arguments);
            this.platformName = 'Test';
            this.supportedFeatures = ['test-feature'];
        }
        async validateCredentials(credentials) {
            return credentials.token === 'valid-token';
        }
        async formatContent(content, imageUrl) {
            return {
                title: 'Test Title',
                body: content.currentDraft,
                imageUrl
            };
        }
        async publish(formattedContent, config) {
            return {
                success: true,
                platformUrl: 'https://test.com/post/123',
                platformId: '123'
            };
        }
        async getPublishingStatus(platformId, config) {
            return 'published';
        }
    }
    let agent;
    (0, globals_1.beforeEach)(() => {
        agent = new TestPublishingAgent();
    });
    (0, globals_1.it)('should validate required credentials', () => {
        (0, globals_1.expect)(() => {
            agent.validateRequiredCredentials({ token: 'test' }, ['token', 'secret']);
        }).toThrow('Missing required credential: secret');
        (0, globals_1.expect)(() => {
            agent.validateRequiredCredentials({ token: 'test', secret: 'secret' }, ['token', 'secret']);
        }).not.toThrow();
    });
    (0, globals_1.it)('should sanitize content', () => {
        const maliciousContent = '<script>alert("xss")</script><p>Safe content</p><iframe src="evil.com"></iframe>';
        const sanitized = agent.sanitizeContent(maliciousContent);
        (0, globals_1.expect)(sanitized).not.toContain('<script>');
        (0, globals_1.expect)(sanitized).not.toContain('<iframe>');
        (0, globals_1.expect)(sanitized).toContain('<p>Safe content</p>');
    });
    (0, globals_1.it)('should extract tags from content', () => {
        const content = 'This is a post about #javascript and #typescript. Also #webdev';
        const tags = agent.extractTags(content);
        (0, globals_1.expect)(tags).toEqual(['javascript', 'typescript', 'webdev']);
    });
    (0, globals_1.it)('should remove duplicate tags', () => {
        const content = 'Post about #javascript and #javascript again';
        const tags = agent.extractTags(content);
        (0, globals_1.expect)(tags).toEqual(['javascript']);
    });
});
(0, globals_1.describe)('MediumPublishingAgent', () => {
    let agent;
    let mockFetch;
    (0, globals_1.beforeEach)(() => {
        agent = new medium_agent_1.MediumPublishingAgent();
        mockFetch = fetch;
        mockFetch.mockClear();
    });
    (0, globals_1.it)('should have correct platform properties', () => {
        (0, globals_1.expect)(agent.platformName).toBe('Medium');
        (0, globals_1.expect)(agent.supportedFeatures).toContain('tags');
        (0, globals_1.expect)(agent.supportedFeatures).toContain('images');
        (0, globals_1.expect)(agent.supportedFeatures).toContain('markdown');
    });
    (0, globals_1.it)('should validate credentials successfully', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: { id: 'user123' } })
        });
        const isValid = await agent.validateCredentials({ accessToken: 'valid-token' });
        (0, globals_1.expect)(isValid).toBe(true);
        (0, globals_1.expect)(mockFetch).toHaveBeenCalledWith('https://api.medium.com/v1/me', globals_1.expect.objectContaining({
            headers: globals_1.expect.objectContaining({
                'Authorization': 'Bearer valid-token'
            })
        }));
    });
    (0, globals_1.it)('should handle credential validation failure', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401
        });
        const isValid = await agent.validateCredentials({ accessToken: 'invalid-token' });
        (0, globals_1.expect)(isValid).toBe(false);
    });
    (0, globals_1.it)('should format content correctly', async () => {
        const blogContent = {
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
        (0, globals_1.expect)(formatted.title).toBe('Test Title');
        (0, globals_1.expect)(formatted.body).toContain('![Test Title](https://example.com/image.jpg)');
        (0, globals_1.expect)(formatted.body).toContain('This is the body content');
        (0, globals_1.expect)(formatted.tags).toEqual(['javascript', 'webdev']);
        (0, globals_1.expect)(formatted.imageUrl).toBe('https://example.com/image.jpg');
    });
    (0, globals_1.it)('should publish content successfully', async () => {
        // Mock user info request
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: { id: 'user123' } })
        });
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
        });
        const formattedContent = {
            title: 'Test Post',
            body: 'Test content',
            tags: ['test']
        };
        const config = {
            platform: 'medium',
            credentials: { accessToken: 'valid-token' }
        };
        const result = await agent.publish(formattedContent, config);
        (0, globals_1.expect)(result.success).toBe(true);
        (0, globals_1.expect)(result.platformUrl).toBe('https://medium.com/@user/test-post-123');
        (0, globals_1.expect)(result.platformId).toBe('post123');
    });
    (0, globals_1.it)('should handle publish failure', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            text: async () => 'Bad Request'
        });
        const formattedContent = {
            title: 'Test Post',
            body: 'Test content'
        };
        const config = {
            platform: 'medium',
            credentials: { accessToken: 'invalid-token' }
        };
        const result = await agent.publish(formattedContent, config);
        (0, globals_1.expect)(result.success).toBe(false);
        (0, globals_1.expect)(result.error).toContain('Medium API error');
    });
});
(0, globals_1.describe)('LinkedInPublishingAgent', () => {
    let agent;
    let mockFetch;
    (0, globals_1.beforeEach)(() => {
        agent = new linkedin_agent_1.LinkedInPublishingAgent();
        mockFetch = fetch;
        mockFetch.mockClear();
    });
    (0, globals_1.it)('should have correct platform properties', () => {
        (0, globals_1.expect)(agent.platformName).toBe('LinkedIn');
        (0, globals_1.expect)(agent.supportedFeatures).toContain('images');
        (0, globals_1.expect)(agent.supportedFeatures).toContain('professional-formatting');
        (0, globals_1.expect)(agent.supportedFeatures).toContain('hashtags');
    });
    (0, globals_1.it)('should format content for professional context', async () => {
        const blogContent = {
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
        (0, globals_1.expect)(formatted.title).toBe('Professional Insight');
        (0, globals_1.expect)(formatted.body).toContain('**Professional Insight**');
        (0, globals_1.expect)(formatted.tags).toEqual(['leadership', 'technology']);
    });
    (0, globals_1.it)('should publish to LinkedIn successfully', async () => {
        // Mock profile request
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'person123' })
        });
        // Mock publish request
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                id: 'ugc123',
                activity: 'urn:li:activity:123'
            })
        });
        const formattedContent = {
            title: 'Professional Update',
            body: 'Professional content',
            tags: ['leadership']
        };
        const config = {
            platform: 'linkedin',
            credentials: { accessToken: 'valid-token' }
        };
        const result = await agent.publish(formattedContent, config);
        (0, globals_1.expect)(result.success).toBe(true);
        (0, globals_1.expect)(result.platformUrl).toContain('linkedin.com/feed/update');
        (0, globals_1.expect)(result.platformId).toBe('ugc123');
    });
});
(0, globals_1.describe)('PublishingAgentRegistry', () => {
    let registry;
    (0, globals_1.beforeEach)(() => {
        // Create a new instance for each test
        registry = new publishing_agent_registry_1.PublishingAgentRegistry();
        registry.registerDefaultAgents();
    });
    (0, globals_1.it)('should register default agents', () => {
        const platforms = registry.getSupportedPlatforms();
        (0, globals_1.expect)(platforms).toContain('medium');
        (0, globals_1.expect)(platforms).toContain('linkedin');
    });
    (0, globals_1.it)('should get agent by platform name', () => {
        const mediumAgent = registry.getAgent('medium');
        (0, globals_1.expect)(mediumAgent).toBeInstanceOf(medium_agent_1.MediumPublishingAgent);
        const linkedinAgent = registry.getAgent('linkedin');
        (0, globals_1.expect)(linkedinAgent).toBeInstanceOf(linkedin_agent_1.LinkedInPublishingAgent);
    });
    (0, globals_1.it)('should return null for unknown platform', () => {
        const unknownAgent = registry.getAgent('unknown');
        (0, globals_1.expect)(unknownAgent).toBeNull();
    });
    (0, globals_1.it)('should enable and disable agents', () => {
        (0, globals_1.expect)(registry.getAgent('medium')).not.toBeNull();
        registry.disableAgent('medium');
        (0, globals_1.expect)(registry.getAgent('medium')).toBeNull();
        registry.enableAgent('medium');
        (0, globals_1.expect)(registry.getAgent('medium')).not.toBeNull();
    });
    (0, globals_1.it)('should register custom agents', () => {
        class CustomAgent extends base_publishing_agent_1.BasePublishingAgent {
            constructor() {
                super(...arguments);
                this.platformName = 'Custom';
                this.supportedFeatures = ['custom-feature'];
            }
            async validateCredentials() { return true; }
            async formatContent() {
                return { title: 'Custom', body: 'Custom content' };
            }
            async publish() {
                return { success: true };
            }
            async getPublishingStatus() {
                return 'published';
            }
        }
        const customAgent = new CustomAgent();
        registry.registerAgent('custom', customAgent);
        (0, globals_1.expect)(registry.getSupportedPlatforms()).toContain('custom');
        (0, globals_1.expect)(registry.getAgent('custom')).toBe(customAgent);
    });
    (0, globals_1.it)('should unregister agents', () => {
        (0, globals_1.expect)(registry.getAgent('medium')).not.toBeNull();
        const unregistered = registry.unregisterAgent('medium');
        (0, globals_1.expect)(unregistered).toBe(true);
        (0, globals_1.expect)(registry.getAgent('medium')).toBeNull();
    });
    (0, globals_1.it)('should get platform features', () => {
        const mediumFeatures = registry.getPlatformFeatures('medium');
        (0, globals_1.expect)(mediumFeatures).toContain('tags');
        (0, globals_1.expect)(mediumFeatures).toContain('images');
        (0, globals_1.expect)(mediumFeatures).toContain('markdown');
    });
    (0, globals_1.it)('should publish to multiple platforms', async () => {
        const mockMediumAgent = {
            formatContent: globals_1.jest.fn(),
            publish: globals_1.jest.fn()
        };
        mockMediumAgent.formatContent.mockResolvedValue({ title: 'Test', body: 'Content' });
        mockMediumAgent.publish.mockResolvedValue({ success: true, platformId: 'medium123' });
        const mockLinkedInAgent = {
            formatContent: globals_1.jest.fn(),
            publish: globals_1.jest.fn()
        };
        mockLinkedInAgent.formatContent.mockResolvedValue({ title: 'Test', body: 'Content' });
        mockLinkedInAgent.publish.mockResolvedValue({ success: true, platformId: 'linkedin123' });
        // Replace agents with mocks
        registry.agents.set('medium', {
            name: 'medium',
            agent: mockMediumAgent,
            isEnabled: true
        });
        registry.agents.set('linkedin', {
            name: 'linkedin',
            agent: mockLinkedInAgent,
            isEnabled: true
        });
        const blogContent = {
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
        const results = await registry.publishToMultiplePlatforms(['medium', 'linkedin'], blogContent, configs);
        (0, globals_1.expect)(results.size).toBe(2);
        (0, globals_1.expect)(results.get('medium')?.success).toBe(true);
        (0, globals_1.expect)(results.get('linkedin')?.success).toBe(true);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHVibGlzaGluZy1hZ2VudC1mcmFtZXdvcmsudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInB1Ymxpc2hpbmctYWdlbnQtZnJhbWV3b3JrLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSwyQ0FBdUU7QUFDdkUsc0ZBQW9JO0FBQ3BJLG9FQUEwRTtBQUMxRSx3RUFBOEU7QUFDOUUsOEZBQXlGO0FBR3pGLHNCQUFzQjtBQUN0QixNQUFNLENBQUMsS0FBSyxHQUFHLGNBQUksQ0FBQyxFQUFFLEVBQXVDLENBQUM7QUFFOUQsSUFBQSxrQkFBUSxFQUFDLHFCQUFxQixFQUFFLEdBQUcsRUFBRTtJQUNuQyxNQUFNLG1CQUFvQixTQUFRLDJDQUFtQjtRQUFyRDs7WUFDVyxpQkFBWSxHQUFHLE1BQU0sQ0FBQztZQUN0QixzQkFBaUIsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBeUJoRCxDQUFDO1FBdkJDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxXQUFnQztZQUN4RCxPQUFPLFdBQVcsQ0FBQyxLQUFLLEtBQUssYUFBYSxDQUFDO1FBQzdDLENBQUM7UUFFRCxLQUFLLENBQUMsYUFBYSxDQUFDLE9BQW9CLEVBQUUsUUFBaUI7WUFDekQsT0FBTztnQkFDTCxLQUFLLEVBQUUsWUFBWTtnQkFDbkIsSUFBSSxFQUFFLE9BQU8sQ0FBQyxZQUFZO2dCQUMxQixRQUFRO2FBQ1QsQ0FBQztRQUNKLENBQUM7UUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLGdCQUFrQyxFQUFFLE1BQXdCO1lBQ3hFLE9BQU87Z0JBQ0wsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsV0FBVyxFQUFFLDJCQUEyQjtnQkFDeEMsVUFBVSxFQUFFLEtBQUs7YUFDbEIsQ0FBQztRQUNKLENBQUM7UUFFRCxLQUFLLENBQUMsbUJBQW1CLENBQUMsVUFBa0IsRUFBRSxNQUF3QjtZQUNwRSxPQUFPLFdBQVcsQ0FBQztRQUNyQixDQUFDO0tBQ0Y7SUFFRCxJQUFJLEtBQTBCLENBQUM7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QUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN0RCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZGVzY3JpYmUsIGl0LCBleHBlY3QsIGJlZm9yZUVhY2gsIGplc3QgfSBmcm9tICdAamVzdC9nbG9iYWxzJztcclxuaW1wb3J0IHsgQmFzZVB1Ymxpc2hpbmdBZ2VudCwgUHVibGlzaGluZ0NvbmZpZywgUHVibGlzaFJlc3VsdCwgRm9ybWF0dGVkQ29udGVudCB9IGZyb20gJy4uL2xhbWJkYS9wdWJsaXNoaW5nL2Jhc2UtcHVibGlzaGluZy1hZ2VudCc7XHJcbmltcG9ydCB7IE1lZGl1bVB1Ymxpc2hpbmdBZ2VudCB9IGZyb20gJy4uL2xhbWJkYS9wdWJsaXNoaW5nL21lZGl1bS1hZ2VudCc7XHJcbmltcG9ydCB7IExpbmtlZEluUHVibGlzaGluZ0FnZW50IH0gZnJvbSAnLi4vbGFtYmRhL3B1Ymxpc2hpbmcvbGlua2VkaW4tYWdlbnQnO1xyXG5pbXBvcnQgeyBQdWJsaXNoaW5nQWdlbnRSZWdpc3RyeSB9IGZyb20gJy4uL2xhbWJkYS9wdWJsaXNoaW5nL3B1Ymxpc2hpbmctYWdlbnQtcmVnaXN0cnknO1xyXG5pbXBvcnQgeyBCbG9nQ29udGVudCB9IGZyb20gJy4uLy4uL2Zyb250ZW5kL3NyYy90eXBlcy9CbG9nQ29udGVudCc7XHJcblxyXG4vLyBNb2NrIGZldGNoIGdsb2JhbGx5XHJcbmdsb2JhbC5mZXRjaCA9IGplc3QuZm4oKSBhcyBqZXN0Lk1vY2tlZEZ1bmN0aW9uPHR5cGVvZiBmZXRjaD47XHJcblxyXG5kZXNjcmliZSgnQmFzZVB1Ymxpc2hpbmdBZ2VudCcsICgpID0+IHtcclxuICBjbGFzcyBUZXN0UHVibGlzaGluZ0FnZW50IGV4dGVuZHMgQmFzZVB1Ymxpc2hpbmdBZ2VudCB7XHJcbiAgICByZWFkb25seSBwbGF0Zm9ybU5hbWUgPSAnVGVzdCc7XHJcbiAgICByZWFkb25seSBzdXBwb3J0ZWRGZWF0dXJlcyA9IFsndGVzdC1mZWF0dXJlJ107XHJcblxyXG4gICAgYXN5bmMgdmFsaWRhdGVDcmVkZW50aWFscyhjcmVkZW50aWFsczogUmVjb3JkPHN0cmluZywgYW55Pik6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgICByZXR1cm4gY3JlZGVudGlhbHMudG9rZW4gPT09ICd2YWxpZC10b2tlbic7XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgZm9ybWF0Q29udGVudChjb250ZW50OiBCbG9nQ29udGVudCwgaW1hZ2VVcmw/OiBzdHJpbmcpOiBQcm9taXNlPEZvcm1hdHRlZENvbnRlbnQ+IHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICB0aXRsZTogJ1Rlc3QgVGl0bGUnLFxyXG4gICAgICAgIGJvZHk6IGNvbnRlbnQuY3VycmVudERyYWZ0LFxyXG4gICAgICAgIGltYWdlVXJsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgcHVibGlzaChmb3JtYXR0ZWRDb250ZW50OiBGb3JtYXR0ZWRDb250ZW50LCBjb25maWc6IFB1Ymxpc2hpbmdDb25maWcpOiBQcm9taXNlPFB1Ymxpc2hSZXN1bHQ+IHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIHBsYXRmb3JtVXJsOiAnaHR0cHM6Ly90ZXN0LmNvbS9wb3N0LzEyMycsXHJcbiAgICAgICAgcGxhdGZvcm1JZDogJzEyMydcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBnZXRQdWJsaXNoaW5nU3RhdHVzKHBsYXRmb3JtSWQ6IHN0cmluZywgY29uZmlnOiBQdWJsaXNoaW5nQ29uZmlnKTogUHJvbWlzZTwncHVibGlzaGVkJyB8ICdkcmFmdCcgfCAnZmFpbGVkJyB8ICd1bmtub3duJz4ge1xyXG4gICAgICByZXR1cm4gJ3B1Ymxpc2hlZCc7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBsZXQgYWdlbnQ6IFRlc3RQdWJsaXNoaW5nQWdlbnQ7XHJcblxyXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xyXG4gICAgYWdlbnQgPSBuZXcgVGVzdFB1Ymxpc2hpbmdBZ2VudCgpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIHZhbGlkYXRlIHJlcXVpcmVkIGNyZWRlbnRpYWxzJywgKCkgPT4ge1xyXG4gICAgZXhwZWN0KCgpID0+IHtcclxuICAgICAgKGFnZW50IGFzIGFueSkudmFsaWRhdGVSZXF1aXJlZENyZWRlbnRpYWxzKHsgdG9rZW46ICd0ZXN0JyB9LCBbJ3Rva2VuJywgJ3NlY3JldCddKTtcclxuICAgIH0pLnRvVGhyb3coJ01pc3NpbmcgcmVxdWlyZWQgY3JlZGVudGlhbDogc2VjcmV0Jyk7XHJcblxyXG4gICAgZXhwZWN0KCgpID0+IHtcclxuICAgICAgKGFnZW50IGFzIGFueSkudmFsaWRhdGVSZXF1aXJlZENyZWRlbnRpYWxzKHsgdG9rZW46ICd0ZXN0Jywgc2VjcmV0OiAnc2VjcmV0JyB9LCBbJ3Rva2VuJywgJ3NlY3JldCddKTtcclxuICAgIH0pLm5vdC50b1Rocm93KCk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdzaG91bGQgc2FuaXRpemUgY29udGVudCcsICgpID0+IHtcclxuICAgIGNvbnN0IG1hbGljaW91c0NvbnRlbnQgPSAnPHNjcmlwdD5hbGVydChcInhzc1wiKTwvc2NyaXB0PjxwPlNhZmUgY29udGVudDwvcD48aWZyYW1lIHNyYz1cImV2aWwuY29tXCI+PC9pZnJhbWU+JztcclxuICAgIGNvbnN0IHNhbml0aXplZCA9IChhZ2VudCBhcyBhbnkpLnNhbml0aXplQ29udGVudChtYWxpY2lvdXNDb250ZW50KTtcclxuICAgIFxyXG4gICAgZXhwZWN0KHNhbml0aXplZCkubm90LnRvQ29udGFpbignPHNjcmlwdD4nKTtcclxuICAgIGV4cGVjdChzYW5pdGl6ZWQpLm5vdC50b0NvbnRhaW4oJzxpZnJhbWU+Jyk7XHJcbiAgICBleHBlY3Qoc2FuaXRpemVkKS50b0NvbnRhaW4oJzxwPlNhZmUgY29udGVudDwvcD4nKTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ3Nob3VsZCBleHRyYWN0IHRhZ3MgZnJvbSBjb250ZW50JywgKCkgPT4ge1xyXG4gICAgY29uc3QgY29udGVudCA9ICdUaGlzIGlzIGEgcG9zdCBhYm91dCAjamF2YXNjcmlwdCBhbmQgI3R5cGVzY3JpcHQuIEFsc28gI3dlYmRldic7XHJcbiAgICBjb25zdCB0YWdzID0gKGFnZW50IGFzIGFueSkuZXh0cmFjdFRhZ3MoY29udGVudCk7XHJcbiAgICBcclxuICAgIGV4cGVjdCh0YWdzKS50b0VxdWFsKFsnamF2YXNjcmlwdCcsICd0eXBlc2NyaXB0JywgJ3dlYmRldiddKTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ3Nob3VsZCByZW1vdmUgZHVwbGljYXRlIHRhZ3MnLCAoKSA9PiB7XHJcbiAgICBjb25zdCBjb250ZW50ID0gJ1Bvc3QgYWJvdXQgI2phdmFzY3JpcHQgYW5kICNqYXZhc2NyaXB0IGFnYWluJztcclxuICAgIGNvbnN0IHRhZ3MgPSAoYWdlbnQgYXMgYW55KS5leHRyYWN0VGFncyhjb250ZW50KTtcclxuICAgIFxyXG4gICAgZXhwZWN0KHRhZ3MpLnRvRXF1YWwoWydqYXZhc2NyaXB0J10pO1xyXG4gIH0pO1xyXG59KTtcclxuXHJcbmRlc2NyaWJlKCdNZWRpdW1QdWJsaXNoaW5nQWdlbnQnLCAoKSA9PiB7XHJcbiAgbGV0IGFnZW50OiBNZWRpdW1QdWJsaXNoaW5nQWdlbnQ7XHJcbiAgbGV0IG1vY2tGZXRjaDogamVzdC5Nb2NrZWRGdW5jdGlvbjx0eXBlb2YgZmV0Y2g+O1xyXG5cclxuICBiZWZvcmVFYWNoKCgpID0+IHtcclxuICAgIGFnZW50ID0gbmV3IE1lZGl1bVB1Ymxpc2hpbmdBZ2VudCgpO1xyXG4gICAgbW9ja0ZldGNoID0gZmV0Y2ggYXMgamVzdC5Nb2NrZWRGdW5jdGlvbjx0eXBlb2YgZmV0Y2g+O1xyXG4gICAgbW9ja0ZldGNoLm1vY2tDbGVhcigpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIGhhdmUgY29ycmVjdCBwbGF0Zm9ybSBwcm9wZXJ0aWVzJywgKCkgPT4ge1xyXG4gICAgZXhwZWN0KGFnZW50LnBsYXRmb3JtTmFtZSkudG9CZSgnTWVkaXVtJyk7XHJcbiAgICBleHBlY3QoYWdlbnQuc3VwcG9ydGVkRmVhdHVyZXMpLnRvQ29udGFpbigndGFncycpO1xyXG4gICAgZXhwZWN0KGFnZW50LnN1cHBvcnRlZEZlYXR1cmVzKS50b0NvbnRhaW4oJ2ltYWdlcycpO1xyXG4gICAgZXhwZWN0KGFnZW50LnN1cHBvcnRlZEZlYXR1cmVzKS50b0NvbnRhaW4oJ21hcmtkb3duJyk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdzaG91bGQgdmFsaWRhdGUgY3JlZGVudGlhbHMgc3VjY2Vzc2Z1bGx5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgbW9ja0ZldGNoLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgIG9rOiB0cnVlLFxyXG4gICAgICBqc29uOiBhc3luYyAoKSA9PiAoeyBkYXRhOiB7IGlkOiAndXNlcjEyMycgfSB9KVxyXG4gICAgfSBhcyBSZXNwb25zZSk7XHJcblxyXG4gICAgY29uc3QgaXNWYWxpZCA9IGF3YWl0IGFnZW50LnZhbGlkYXRlQ3JlZGVudGlhbHMoeyBhY2Nlc3NUb2tlbjogJ3ZhbGlkLXRva2VuJyB9KTtcclxuICAgIGV4cGVjdChpc1ZhbGlkKS50b0JlKHRydWUpO1xyXG4gICAgZXhwZWN0KG1vY2tGZXRjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgoXHJcbiAgICAgICdodHRwczovL2FwaS5tZWRpdW0uY29tL3YxL21lJyxcclxuICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xyXG4gICAgICAgIGhlYWRlcnM6IGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcclxuICAgICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciB2YWxpZC10b2tlbidcclxuICAgICAgICB9KVxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ3Nob3VsZCBoYW5kbGUgY3JlZGVudGlhbCB2YWxpZGF0aW9uIGZhaWx1cmUnLCBhc3luYyAoKSA9PiB7XHJcbiAgICBtb2NrRmV0Y2gubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHtcclxuICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICBzdGF0dXM6IDQwMVxyXG4gICAgfSBhcyBSZXNwb25zZSk7XHJcblxyXG4gICAgY29uc3QgaXNWYWxpZCA9IGF3YWl0IGFnZW50LnZhbGlkYXRlQ3JlZGVudGlhbHMoeyBhY2Nlc3NUb2tlbjogJ2ludmFsaWQtdG9rZW4nIH0pO1xyXG4gICAgZXhwZWN0KGlzVmFsaWQpLnRvQmUoZmFsc2UpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIGZvcm1hdCBjb250ZW50IGNvcnJlY3RseScsIGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IGJsb2dDb250ZW50OiBCbG9nQ29udGVudCA9IHtcclxuICAgICAgaWQ6ICd0ZXN0LWlkJyxcclxuICAgICAgdXNlcklkOiAndXNlci1pZCcsXHJcbiAgICAgIG9yaWdpbmFsVHJhbnNjcmlwdGlvbjogJ09yaWdpbmFsIHRleHQnLFxyXG4gICAgICBjdXJyZW50RHJhZnQ6ICcjIFRlc3QgVGl0bGVcXG5cXG5UaGlzIGlzIHRoZSBib2R5IGNvbnRlbnQgd2l0aCAjamF2YXNjcmlwdCBhbmQgI3dlYmRldiB0YWdzLicsXHJcbiAgICAgIHN0YXR1czogJ2RyYWZ0JyxcclxuICAgICAgcmV2aXNpb25IaXN0b3J5OiBbXSxcclxuICAgICAgcHVibGlzaGluZ1Jlc3VsdHM6IFtdLFxyXG4gICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCksXHJcbiAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKVxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBmb3JtYXR0ZWQgPSBhd2FpdCBhZ2VudC5mb3JtYXRDb250ZW50KGJsb2dDb250ZW50LCAnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZS5qcGcnKTtcclxuXHJcbiAgICBleHBlY3QoZm9ybWF0dGVkLnRpdGxlKS50b0JlKCdUZXN0IFRpdGxlJyk7XHJcbiAgICBleHBlY3QoZm9ybWF0dGVkLmJvZHkpLnRvQ29udGFpbignIVtUZXN0IFRpdGxlXShodHRwczovL2V4YW1wbGUuY29tL2ltYWdlLmpwZyknKTtcclxuICAgIGV4cGVjdChmb3JtYXR0ZWQuYm9keSkudG9Db250YWluKCdUaGlzIGlzIHRoZSBib2R5IGNvbnRlbnQnKTtcclxuICAgIGV4cGVjdChmb3JtYXR0ZWQudGFncykudG9FcXVhbChbJ2phdmFzY3JpcHQnLCAnd2ViZGV2J10pO1xyXG4gICAgZXhwZWN0KGZvcm1hdHRlZC5pbWFnZVVybCkudG9CZSgnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZS5qcGcnKTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ3Nob3VsZCBwdWJsaXNoIGNvbnRlbnQgc3VjY2Vzc2Z1bGx5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgLy8gTW9jayB1c2VyIGluZm8gcmVxdWVzdFxyXG4gICAgbW9ja0ZldGNoLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgIG9rOiB0cnVlLFxyXG4gICAgICBqc29uOiBhc3luYyAoKSA9PiAoeyBkYXRhOiB7IGlkOiAndXNlcjEyMycgfSB9KVxyXG4gICAgfSBhcyBSZXNwb25zZSk7XHJcblxyXG4gICAgLy8gTW9jayBwdWJsaXNoIHJlcXVlc3RcclxuICAgIG1vY2tGZXRjaC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICBvazogdHJ1ZSxcclxuICAgICAganNvbjogYXN5bmMgKCkgPT4gKHtcclxuICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICBpZDogJ3Bvc3QxMjMnLFxyXG4gICAgICAgICAgdGl0bGU6ICdUZXN0IFBvc3QnLFxyXG4gICAgICAgICAgdXJsOiAnaHR0cHM6Ly9tZWRpdW0uY29tL0B1c2VyL3Rlc3QtcG9zdC0xMjMnLFxyXG4gICAgICAgICAgY2Fub25pY2FsVXJsOiAnaHR0cHM6Ly9tZWRpdW0uY29tL0B1c2VyL3Rlc3QtcG9zdC0xMjMnLFxyXG4gICAgICAgICAgcHVibGlzaGVkQXQ6IERhdGUubm93KCksXHJcbiAgICAgICAgICBhdXRob3JJZDogJ3VzZXIxMjMnXHJcbiAgICAgICAgfVxyXG4gICAgICB9KVxyXG4gICAgfSBhcyBSZXNwb25zZSk7XHJcblxyXG4gICAgY29uc3QgZm9ybWF0dGVkQ29udGVudDogRm9ybWF0dGVkQ29udGVudCA9IHtcclxuICAgICAgdGl0bGU6ICdUZXN0IFBvc3QnLFxyXG4gICAgICBib2R5OiAnVGVzdCBjb250ZW50JyxcclxuICAgICAgdGFnczogWyd0ZXN0J11cclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgY29uZmlnOiBQdWJsaXNoaW5nQ29uZmlnID0ge1xyXG4gICAgICBwbGF0Zm9ybTogJ21lZGl1bScsXHJcbiAgICAgIGNyZWRlbnRpYWxzOiB7IGFjY2Vzc1Rva2VuOiAndmFsaWQtdG9rZW4nIH1cclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgYWdlbnQucHVibGlzaChmb3JtYXR0ZWRDb250ZW50LCBjb25maWcpO1xyXG5cclxuICAgIGV4cGVjdChyZXN1bHQuc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICAgIGV4cGVjdChyZXN1bHQucGxhdGZvcm1VcmwpLnRvQmUoJ2h0dHBzOi8vbWVkaXVtLmNvbS9AdXNlci90ZXN0LXBvc3QtMTIzJyk7XHJcbiAgICBleHBlY3QocmVzdWx0LnBsYXRmb3JtSWQpLnRvQmUoJ3Bvc3QxMjMnKTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ3Nob3VsZCBoYW5kbGUgcHVibGlzaCBmYWlsdXJlJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgbW9ja0ZldGNoLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgc3RhdHVzOiA0MDAsXHJcbiAgICAgIHRleHQ6IGFzeW5jICgpID0+ICdCYWQgUmVxdWVzdCdcclxuICAgIH0gYXMgUmVzcG9uc2UpO1xyXG5cclxuICAgIGNvbnN0IGZvcm1hdHRlZENvbnRlbnQ6IEZvcm1hdHRlZENvbnRlbnQgPSB7XHJcbiAgICAgIHRpdGxlOiAnVGVzdCBQb3N0JyxcclxuICAgICAgYm9keTogJ1Rlc3QgY29udGVudCdcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgY29uZmlnOiBQdWJsaXNoaW5nQ29uZmlnID0ge1xyXG4gICAgICBwbGF0Zm9ybTogJ21lZGl1bScsXHJcbiAgICAgIGNyZWRlbnRpYWxzOiB7IGFjY2Vzc1Rva2VuOiAnaW52YWxpZC10b2tlbicgfVxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBhZ2VudC5wdWJsaXNoKGZvcm1hdHRlZENvbnRlbnQsIGNvbmZpZyk7XHJcblxyXG4gICAgZXhwZWN0KHJlc3VsdC5zdWNjZXNzKS50b0JlKGZhbHNlKTtcclxuICAgIGV4cGVjdChyZXN1bHQuZXJyb3IpLnRvQ29udGFpbignTWVkaXVtIEFQSSBlcnJvcicpO1xyXG4gIH0pO1xyXG59KTtcclxuXHJcbmRlc2NyaWJlKCdMaW5rZWRJblB1Ymxpc2hpbmdBZ2VudCcsICgpID0+IHtcclxuICBsZXQgYWdlbnQ6IExpbmtlZEluUHVibGlzaGluZ0FnZW50O1xyXG4gIGxldCBtb2NrRmV0Y2g6IGplc3QuTW9ja2VkRnVuY3Rpb248dHlwZW9mIGZldGNoPjtcclxuXHJcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XHJcbiAgICBhZ2VudCA9IG5ldyBMaW5rZWRJblB1Ymxpc2hpbmdBZ2VudCgpO1xyXG4gICAgbW9ja0ZldGNoID0gZmV0Y2ggYXMgamVzdC5Nb2NrZWRGdW5jdGlvbjx0eXBlb2YgZmV0Y2g+O1xyXG4gICAgbW9ja0ZldGNoLm1vY2tDbGVhcigpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIGhhdmUgY29ycmVjdCBwbGF0Zm9ybSBwcm9wZXJ0aWVzJywgKCkgPT4ge1xyXG4gICAgZXhwZWN0KGFnZW50LnBsYXRmb3JtTmFtZSkudG9CZSgnTGlua2VkSW4nKTtcclxuICAgIGV4cGVjdChhZ2VudC5zdXBwb3J0ZWRGZWF0dXJlcykudG9Db250YWluKCdpbWFnZXMnKTtcclxuICAgIGV4cGVjdChhZ2VudC5zdXBwb3J0ZWRGZWF0dXJlcykudG9Db250YWluKCdwcm9mZXNzaW9uYWwtZm9ybWF0dGluZycpO1xyXG4gICAgZXhwZWN0KGFnZW50LnN1cHBvcnRlZEZlYXR1cmVzKS50b0NvbnRhaW4oJ2hhc2h0YWdzJyk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdzaG91bGQgZm9ybWF0IGNvbnRlbnQgZm9yIHByb2Zlc3Npb25hbCBjb250ZXh0JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgY29uc3QgYmxvZ0NvbnRlbnQ6IEJsb2dDb250ZW50ID0ge1xyXG4gICAgICBpZDogJ3Rlc3QtaWQnLFxyXG4gICAgICB1c2VySWQ6ICd1c2VyLWlkJyxcclxuICAgICAgb3JpZ2luYWxUcmFuc2NyaXB0aW9uOiAnT3JpZ2luYWwgdGV4dCcsXHJcbiAgICAgIGN1cnJlbnREcmFmdDogJyMgUHJvZmVzc2lvbmFsIEluc2lnaHRcXG5cXG5UaGlzIGlzIGEga2V5IGluc2lnaHQgYWJvdXQgI2xlYWRlcnNoaXAgYW5kICN0ZWNobm9sb2d5LicsXHJcbiAgICAgIHN0YXR1czogJ2RyYWZ0JyxcclxuICAgICAgcmV2aXNpb25IaXN0b3J5OiBbXSxcclxuICAgICAgcHVibGlzaGluZ1Jlc3VsdHM6IFtdLFxyXG4gICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCksXHJcbiAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKVxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBmb3JtYXR0ZWQgPSBhd2FpdCBhZ2VudC5mb3JtYXRDb250ZW50KGJsb2dDb250ZW50KTtcclxuXHJcbiAgICBleHBlY3QoZm9ybWF0dGVkLnRpdGxlKS50b0JlKCdQcm9mZXNzaW9uYWwgSW5zaWdodCcpO1xyXG4gICAgZXhwZWN0KGZvcm1hdHRlZC5ib2R5KS50b0NvbnRhaW4oJyoqUHJvZmVzc2lvbmFsIEluc2lnaHQqKicpO1xyXG4gICAgZXhwZWN0KGZvcm1hdHRlZC50YWdzKS50b0VxdWFsKFsnbGVhZGVyc2hpcCcsICd0ZWNobm9sb2d5J10pO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIHB1Ymxpc2ggdG8gTGlua2VkSW4gc3VjY2Vzc2Z1bGx5JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgLy8gTW9jayBwcm9maWxlIHJlcXVlc3RcclxuICAgIG1vY2tGZXRjaC5tb2NrUmVzb2x2ZWRWYWx1ZU9uY2Uoe1xyXG4gICAgICBvazogdHJ1ZSxcclxuICAgICAganNvbjogYXN5bmMgKCkgPT4gKHsgaWQ6ICdwZXJzb24xMjMnIH0pXHJcbiAgICB9IGFzIFJlc3BvbnNlKTtcclxuXHJcbiAgICAvLyBNb2NrIHB1Ymxpc2ggcmVxdWVzdFxyXG4gICAgbW9ja0ZldGNoLm1vY2tSZXNvbHZlZFZhbHVlT25jZSh7XHJcbiAgICAgIG9rOiB0cnVlLFxyXG4gICAgICBqc29uOiBhc3luYyAoKSA9PiAoe1xyXG4gICAgICAgIGlkOiAndWdjMTIzJyxcclxuICAgICAgICBhY3Rpdml0eTogJ3VybjpsaTphY3Rpdml0eToxMjMnXHJcbiAgICAgIH0pXHJcbiAgICB9IGFzIFJlc3BvbnNlKTtcclxuXHJcbiAgICBjb25zdCBmb3JtYXR0ZWRDb250ZW50OiBGb3JtYXR0ZWRDb250ZW50ID0ge1xyXG4gICAgICB0aXRsZTogJ1Byb2Zlc3Npb25hbCBVcGRhdGUnLFxyXG4gICAgICBib2R5OiAnUHJvZmVzc2lvbmFsIGNvbnRlbnQnLFxyXG4gICAgICB0YWdzOiBbJ2xlYWRlcnNoaXAnXVxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBjb25maWc6IFB1Ymxpc2hpbmdDb25maWcgPSB7XHJcbiAgICAgIHBsYXRmb3JtOiAnbGlua2VkaW4nLFxyXG4gICAgICBjcmVkZW50aWFsczogeyBhY2Nlc3NUb2tlbjogJ3ZhbGlkLXRva2VuJyB9XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGFnZW50LnB1Ymxpc2goZm9ybWF0dGVkQ29udGVudCwgY29uZmlnKTtcclxuXHJcbiAgICBleHBlY3QocmVzdWx0LnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XHJcbiAgICBleHBlY3QocmVzdWx0LnBsYXRmb3JtVXJsKS50b0NvbnRhaW4oJ2xpbmtlZGluLmNvbS9mZWVkL3VwZGF0ZScpO1xyXG4gICAgZXhwZWN0KHJlc3VsdC5wbGF0Zm9ybUlkKS50b0JlKCd1Z2MxMjMnKTtcclxuICB9KTtcclxufSk7XHJcblxyXG5kZXNjcmliZSgnUHVibGlzaGluZ0FnZW50UmVnaXN0cnknLCAoKSA9PiB7XHJcbiAgbGV0IHJlZ2lzdHJ5OiBQdWJsaXNoaW5nQWdlbnRSZWdpc3RyeTtcclxuXHJcbiAgYmVmb3JlRWFjaCgoKSA9PiB7XHJcbiAgICAvLyBDcmVhdGUgYSBuZXcgaW5zdGFuY2UgZm9yIGVhY2ggdGVzdFxyXG4gICAgcmVnaXN0cnkgPSBuZXcgKFB1Ymxpc2hpbmdBZ2VudFJlZ2lzdHJ5IGFzIGFueSkoKTtcclxuICAgIChyZWdpc3RyeSBhcyBhbnkpLnJlZ2lzdGVyRGVmYXVsdEFnZW50cygpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIHJlZ2lzdGVyIGRlZmF1bHQgYWdlbnRzJywgKCkgPT4ge1xyXG4gICAgY29uc3QgcGxhdGZvcm1zID0gcmVnaXN0cnkuZ2V0U3VwcG9ydGVkUGxhdGZvcm1zKCk7XHJcbiAgICBleHBlY3QocGxhdGZvcm1zKS50b0NvbnRhaW4oJ21lZGl1bScpO1xyXG4gICAgZXhwZWN0KHBsYXRmb3JtcykudG9Db250YWluKCdsaW5rZWRpbicpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIGdldCBhZ2VudCBieSBwbGF0Zm9ybSBuYW1lJywgKCkgPT4ge1xyXG4gICAgY29uc3QgbWVkaXVtQWdlbnQgPSByZWdpc3RyeS5nZXRBZ2VudCgnbWVkaXVtJyk7XHJcbiAgICBleHBlY3QobWVkaXVtQWdlbnQpLnRvQmVJbnN0YW5jZU9mKE1lZGl1bVB1Ymxpc2hpbmdBZ2VudCk7XHJcblxyXG4gICAgY29uc3QgbGlua2VkaW5BZ2VudCA9IHJlZ2lzdHJ5LmdldEFnZW50KCdsaW5rZWRpbicpO1xyXG4gICAgZXhwZWN0KGxpbmtlZGluQWdlbnQpLnRvQmVJbnN0YW5jZU9mKExpbmtlZEluUHVibGlzaGluZ0FnZW50KTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ3Nob3VsZCByZXR1cm4gbnVsbCBmb3IgdW5rbm93biBwbGF0Zm9ybScsICgpID0+IHtcclxuICAgIGNvbnN0IHVua25vd25BZ2VudCA9IHJlZ2lzdHJ5LmdldEFnZW50KCd1bmtub3duJyk7XHJcbiAgICBleHBlY3QodW5rbm93bkFnZW50KS50b0JlTnVsbCgpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIGVuYWJsZSBhbmQgZGlzYWJsZSBhZ2VudHMnLCAoKSA9PiB7XHJcbiAgICBleHBlY3QocmVnaXN0cnkuZ2V0QWdlbnQoJ21lZGl1bScpKS5ub3QudG9CZU51bGwoKTtcclxuICAgIFxyXG4gICAgcmVnaXN0cnkuZGlzYWJsZUFnZW50KCdtZWRpdW0nKTtcclxuICAgIGV4cGVjdChyZWdpc3RyeS5nZXRBZ2VudCgnbWVkaXVtJykpLnRvQmVOdWxsKCk7XHJcbiAgICBcclxuICAgIHJlZ2lzdHJ5LmVuYWJsZUFnZW50KCdtZWRpdW0nKTtcclxuICAgIGV4cGVjdChyZWdpc3RyeS5nZXRBZ2VudCgnbWVkaXVtJykpLm5vdC50b0JlTnVsbCgpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIHJlZ2lzdGVyIGN1c3RvbSBhZ2VudHMnLCAoKSA9PiB7XHJcbiAgICBjbGFzcyBDdXN0b21BZ2VudCBleHRlbmRzIEJhc2VQdWJsaXNoaW5nQWdlbnQge1xyXG4gICAgICByZWFkb25seSBwbGF0Zm9ybU5hbWUgPSAnQ3VzdG9tJztcclxuICAgICAgcmVhZG9ubHkgc3VwcG9ydGVkRmVhdHVyZXMgPSBbJ2N1c3RvbS1mZWF0dXJlJ107XHJcblxyXG4gICAgICBhc3luYyB2YWxpZGF0ZUNyZWRlbnRpYWxzKCk6IFByb21pc2U8Ym9vbGVhbj4geyByZXR1cm4gdHJ1ZTsgfVxyXG4gICAgICBhc3luYyBmb3JtYXRDb250ZW50KCk6IFByb21pc2U8Rm9ybWF0dGVkQ29udGVudD4geyBcclxuICAgICAgICByZXR1cm4geyB0aXRsZTogJ0N1c3RvbScsIGJvZHk6ICdDdXN0b20gY29udGVudCcgfTsgXHJcbiAgICAgIH1cclxuICAgICAgYXN5bmMgcHVibGlzaCgpOiBQcm9taXNlPFB1Ymxpc2hSZXN1bHQ+IHsgXHJcbiAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9OyBcclxuICAgICAgfVxyXG4gICAgICBhc3luYyBnZXRQdWJsaXNoaW5nU3RhdHVzKCk6IFByb21pc2U8J3B1Ymxpc2hlZCcgfCAnZHJhZnQnIHwgJ2ZhaWxlZCcgfCAndW5rbm93bic+IHsgXHJcbiAgICAgICAgcmV0dXJuICdwdWJsaXNoZWQnOyBcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGN1c3RvbUFnZW50ID0gbmV3IEN1c3RvbUFnZW50KCk7XHJcbiAgICByZWdpc3RyeS5yZWdpc3RlckFnZW50KCdjdXN0b20nLCBjdXN0b21BZ2VudCk7XHJcblxyXG4gICAgZXhwZWN0KHJlZ2lzdHJ5LmdldFN1cHBvcnRlZFBsYXRmb3JtcygpKS50b0NvbnRhaW4oJ2N1c3RvbScpO1xyXG4gICAgZXhwZWN0KHJlZ2lzdHJ5LmdldEFnZW50KCdjdXN0b20nKSkudG9CZShjdXN0b21BZ2VudCk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdzaG91bGQgdW5yZWdpc3RlciBhZ2VudHMnLCAoKSA9PiB7XHJcbiAgICBleHBlY3QocmVnaXN0cnkuZ2V0QWdlbnQoJ21lZGl1bScpKS5ub3QudG9CZU51bGwoKTtcclxuICAgIFxyXG4gICAgY29uc3QgdW5yZWdpc3RlcmVkID0gcmVnaXN0cnkudW5yZWdpc3RlckFnZW50KCdtZWRpdW0nKTtcclxuICAgIGV4cGVjdCh1bnJlZ2lzdGVyZWQpLnRvQmUodHJ1ZSk7XHJcbiAgICBleHBlY3QocmVnaXN0cnkuZ2V0QWdlbnQoJ21lZGl1bScpKS50b0JlTnVsbCgpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnc2hvdWxkIGdldCBwbGF0Zm9ybSBmZWF0dXJlcycsICgpID0+IHtcclxuICAgIGNvbnN0IG1lZGl1bUZlYXR1cmVzID0gcmVnaXN0cnkuZ2V0UGxhdGZvcm1GZWF0dXJlcygnbWVkaXVtJyk7XHJcbiAgICBleHBlY3QobWVkaXVtRmVhdHVyZXMpLnRvQ29udGFpbigndGFncycpO1xyXG4gICAgZXhwZWN0KG1lZGl1bUZlYXR1cmVzKS50b0NvbnRhaW4oJ2ltYWdlcycpO1xyXG4gICAgZXhwZWN0KG1lZGl1bUZlYXR1cmVzKS50b0NvbnRhaW4oJ21hcmtkb3duJyk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdzaG91bGQgcHVibGlzaCB0byBtdWx0aXBsZSBwbGF0Zm9ybXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICBjb25zdCBtb2NrTWVkaXVtQWdlbnQgPSB7XHJcbiAgICAgIGZvcm1hdENvbnRlbnQ6IGplc3QuZm4oKSxcclxuICAgICAgcHVibGlzaDogamVzdC5mbigpXHJcbiAgICB9IGFzIGFueTtcclxuICAgIFxyXG4gICAgbW9ja01lZGl1bUFnZW50LmZvcm1hdENvbnRlbnQubW9ja1Jlc29sdmVkVmFsdWUoeyB0aXRsZTogJ1Rlc3QnLCBib2R5OiAnQ29udGVudCcgfSk7XHJcbiAgICBtb2NrTWVkaXVtQWdlbnQucHVibGlzaC5tb2NrUmVzb2x2ZWRWYWx1ZSh7IHN1Y2Nlc3M6IHRydWUsIHBsYXRmb3JtSWQ6ICdtZWRpdW0xMjMnIH0pO1xyXG5cclxuICAgIGNvbnN0IG1vY2tMaW5rZWRJbkFnZW50ID0ge1xyXG4gICAgICBmb3JtYXRDb250ZW50OiBqZXN0LmZuKCksXHJcbiAgICAgIHB1Ymxpc2g6IGplc3QuZm4oKVxyXG4gICAgfSBhcyBhbnk7XHJcbiAgICBcclxuICAgIG1vY2tMaW5rZWRJbkFnZW50LmZvcm1hdENvbnRlbnQubW9ja1Jlc29sdmVkVmFsdWUoeyB0aXRsZTogJ1Rlc3QnLCBib2R5OiAnQ29udGVudCcgfSk7XHJcbiAgICBtb2NrTGlua2VkSW5BZ2VudC5wdWJsaXNoLm1vY2tSZXNvbHZlZFZhbHVlKHsgc3VjY2VzczogdHJ1ZSwgcGxhdGZvcm1JZDogJ2xpbmtlZGluMTIzJyB9KTtcclxuXHJcbiAgICAvLyBSZXBsYWNlIGFnZW50cyB3aXRoIG1vY2tzXHJcbiAgICAocmVnaXN0cnkgYXMgYW55KS5hZ2VudHMuc2V0KCdtZWRpdW0nLCB7IFxyXG4gICAgICBuYW1lOiAnbWVkaXVtJywgXHJcbiAgICAgIGFnZW50OiBtb2NrTWVkaXVtQWdlbnQsIFxyXG4gICAgICBpc0VuYWJsZWQ6IHRydWUgXHJcbiAgICB9KTtcclxuICAgIChyZWdpc3RyeSBhcyBhbnkpLmFnZW50cy5zZXQoJ2xpbmtlZGluJywgeyBcclxuICAgICAgbmFtZTogJ2xpbmtlZGluJywgXHJcbiAgICAgIGFnZW50OiBtb2NrTGlua2VkSW5BZ2VudCwgXHJcbiAgICAgIGlzRW5hYmxlZDogdHJ1ZSBcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGJsb2dDb250ZW50OiBCbG9nQ29udGVudCA9IHtcclxuICAgICAgaWQ6ICd0ZXN0LWlkJyxcclxuICAgICAgdXNlcklkOiAndXNlci1pZCcsXHJcbiAgICAgIG9yaWdpbmFsVHJhbnNjcmlwdGlvbjogJ09yaWdpbmFsJyxcclxuICAgICAgY3VycmVudERyYWZ0OiAnVGVzdCBjb250ZW50JyxcclxuICAgICAgc3RhdHVzOiAnZHJhZnQnLFxyXG4gICAgICByZXZpc2lvbkhpc3Rvcnk6IFtdLFxyXG4gICAgICBwdWJsaXNoaW5nUmVzdWx0czogW10sXHJcbiAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKSxcclxuICAgICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGNvbmZpZ3MgPSBuZXcgTWFwKFtcclxuICAgICAgWydtZWRpdW0nLCB7IHBsYXRmb3JtOiAnbWVkaXVtJywgY3JlZGVudGlhbHM6IHsgYWNjZXNzVG9rZW46ICd0b2tlbjEnIH0gfV0sXHJcbiAgICAgIFsnbGlua2VkaW4nLCB7IHBsYXRmb3JtOiAnbGlua2VkaW4nLCBjcmVkZW50aWFsczogeyBhY2Nlc3NUb2tlbjogJ3Rva2VuMicgfSB9XVxyXG4gICAgXSk7XHJcblxyXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHJlZ2lzdHJ5LnB1Ymxpc2hUb011bHRpcGxlUGxhdGZvcm1zKFxyXG4gICAgICBbJ21lZGl1bScsICdsaW5rZWRpbiddLFxyXG4gICAgICBibG9nQ29udGVudCxcclxuICAgICAgY29uZmlnc1xyXG4gICAgKTtcclxuXHJcbiAgICBleHBlY3QocmVzdWx0cy5zaXplKS50b0JlKDIpO1xyXG4gICAgZXhwZWN0KHJlc3VsdHMuZ2V0KCdtZWRpdW0nKT8uc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICAgIGV4cGVjdChyZXN1bHRzLmdldCgnbGlua2VkaW4nKT8uc3VjY2VzcykudG9CZSh0cnVlKTtcclxuICB9KTtcclxufSk7Il19