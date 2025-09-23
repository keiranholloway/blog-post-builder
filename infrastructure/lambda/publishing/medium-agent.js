"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediumPublishingAgent = void 0;
const base_publishing_agent_1 = require("./base-publishing-agent");
class MediumPublishingAgent extends base_publishing_agent_1.BasePublishingAgent {
    constructor() {
        super(...arguments);
        this.platformName = 'Medium';
        this.supportedFeatures = ['tags', 'images', 'markdown', 'drafts', 'scheduling'];
        this.baseUrl = 'https://api.medium.com/v1';
    }
    async validateCredentials(credentials) {
        try {
            this.validateRequiredCredentials(credentials, ['accessToken']);
            const mediumCreds = credentials;
            // Validate token by fetching user info
            const response = await fetch(`${this.baseUrl}/me`, {
                headers: {
                    'Authorization': `Bearer ${mediumCreds.accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            return response.ok;
        }
        catch (error) {
            console.error('Medium credential validation failed:', error);
            return false;
        }
    }
    async formatContent(content, imageUrl) {
        const sanitizedContent = this.sanitizeContent(content.currentDraft);
        const tags = this.extractTags(sanitizedContent);
        // Extract title from content (first line or first heading)
        const lines = sanitizedContent.split('\n');
        let title = 'Untitled Post';
        let body = sanitizedContent;
        // Look for title in first few lines
        for (let i = 0; i < Math.min(3, lines.length); i++) {
            const line = lines[i].trim();
            if (line.startsWith('# ')) {
                title = line.substring(2).trim();
                body = lines.slice(i + 1).join('\n').trim();
                break;
            }
            else if (line.length > 10 && line.length < 100 && !line.includes('.')) {
                title = line;
                body = lines.slice(i + 1).join('\n').trim();
                break;
            }
        }
        // Add image to content if provided
        if (imageUrl) {
            body = `![${title}](${imageUrl})\n\n${body}`;
        }
        return {
            title: title.substring(0, 100),
            body: this.formatMarkdownForMedium(body),
            tags: tags.slice(0, 5),
            imageUrl,
            metadata: {
                publishStatus: 'public',
                license: 'all-rights-reserved',
                notifyFollowers: true
            }
        };
    }
    async publish(formattedContent, config) {
        try {
            const credentials = config.credentials;
            // Get author ID if not provided
            let authorId = credentials.authorId;
            if (!authorId) {
                const userResponse = await fetch(`${this.baseUrl}/me`, {
                    headers: {
                        'Authorization': `Bearer ${credentials.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                if (!userResponse.ok) {
                    throw new Error('Failed to get user information');
                }
                const userData = await userResponse.json();
                authorId = userData.data.id;
            }
            const postData = {
                title: formattedContent.title,
                contentFormat: 'markdown',
                content: formattedContent.body,
                tags: formattedContent.tags || [],
                publishStatus: formattedContent.metadata?.publishStatus || 'public',
                license: formattedContent.metadata?.license || 'all-rights-reserved',
                notifyFollowers: formattedContent.metadata?.notifyFollowers !== false
            };
            const response = await fetch(`${this.baseUrl}/users/${authorId}/posts`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${credentials.accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(postData)
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Medium API error: ${response.status} - ${errorText}`);
            }
            const result = await response.json();
            return {
                success: true,
                platformUrl: result.data.url,
                platformId: result.data.id,
                metadata: {
                    canonicalUrl: result.data.canonicalUrl,
                    publishedAt: result.data.publishedAt,
                    authorId: result.data.authorId
                }
            };
        }
        catch (error) {
            console.error('Medium publishing failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
    async getPublishingStatus(platformId, config) {
        try {
            const credentials = config.credentials;
            // Medium doesn't provide a direct API to get post status by ID
            // This would require storing the post data or using a different approach
            // For now, we'll return 'unknown' as Medium posts are typically published immediately
            return 'unknown';
        }
        catch (error) {
            console.error('Failed to get Medium post status:', error);
            return 'unknown';
        }
    }
    formatMarkdownForMedium(content) {
        // Medium-specific markdown formatting
        return content
            // Ensure proper heading formatting
            .replace(/^#{1,6}\s+/gm, (match) => match)
            // Ensure proper list formatting
            .replace(/^\s*[-*+]\s+/gm, '* ')
            // Ensure proper numbered list formatting
            .replace(/^\s*\d+\.\s+/gm, (match) => match.trim() + ' ')
            // Clean up extra whitespace
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}
exports.MediumPublishingAgent = MediumPublishingAgent;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVkaXVtLWFnZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibWVkaXVtLWFnZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1FQUFpSDtBQWlDakgsTUFBYSxxQkFBc0IsU0FBUSwyQ0FBbUI7SUFBOUQ7O1FBQ1csaUJBQVksR0FBRyxRQUFRLENBQUM7UUFDeEIsc0JBQWlCLEdBQUcsQ0FBQyxNQUFNLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFFbkUsWUFBTyxHQUFHLDJCQUEyQixDQUFDO0lBK0p6RCxDQUFDO0lBN0pDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxXQUFnQztRQUN4RCxJQUFJO1lBQ0YsSUFBSSxDQUFDLDJCQUEyQixDQUFDLFdBQVcsRUFBRSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUM7WUFDL0QsTUFBTSxXQUFXLEdBQUcsV0FBZ0MsQ0FBQztZQUVyRCx1Q0FBdUM7WUFDdkMsTUFBTSxRQUFRLEdBQUcsTUFBTSxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxLQUFLLEVBQUU7Z0JBQ2pELE9BQU8sRUFBRTtvQkFDUCxlQUFlLEVBQUUsVUFBVSxXQUFXLENBQUMsV0FBVyxFQUFFO29CQUNwRCxjQUFjLEVBQUUsa0JBQWtCO29CQUNsQyxRQUFRLEVBQUUsa0JBQWtCO2lCQUM3QjthQUNGLENBQUMsQ0FBQztZQUVILE9BQU8sUUFBUSxDQUFDLEVBQUUsQ0FBQztTQUNwQjtRQUFDLE9BQU8sS0FBSyxFQUFFO1lBQ2QsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQ0FBc0MsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUM3RCxPQUFPLEtBQUssQ0FBQztTQUNkO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsT0FBb0IsRUFBRSxRQUFpQjtRQUN6RCxNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxD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QyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsR0FBRyxHQUFHLENBQUM7WUFDekQsNEJBQTRCO2FBQzNCLE9BQU8sQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDO2FBQzFCLElBQUksRUFBRSxDQUFDO0lBQ1osQ0FBQztDQUNGO0FBbktELHNEQW1LQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEJhc2VQdWJsaXNoaW5nQWdlbnQsIFB1Ymxpc2hpbmdDb25maWcsIFB1Ymxpc2hSZXN1bHQsIEZvcm1hdHRlZENvbnRlbnQgfSBmcm9tICcuL2Jhc2UtcHVibGlzaGluZy1hZ2VudCc7XHJcbmltcG9ydCB7IEJsb2dDb250ZW50IH0gZnJvbSAnLi4vLi4vLi4vZnJvbnRlbmQvc3JjL3R5cGVzL0Jsb2dDb250ZW50JztcclxuXHJcbmludGVyZmFjZSBNZWRpdW1DcmVkZW50aWFscyB7XHJcbiAgYWNjZXNzVG9rZW46IHN0cmluZztcclxuICBhdXRob3JJZD86IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIE1lZGl1bVBvc3Qge1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgY29udGVudEZvcm1hdDogJ2h0bWwnIHwgJ21hcmtkb3duJztcclxuICBjb250ZW50OiBzdHJpbmc7XHJcbiAgdGFncz86IHN0cmluZ1tdO1xyXG4gIHB1Ymxpc2hTdGF0dXM6ICdwdWJsaWMnIHwgJ2RyYWZ0JyB8ICd1bmxpc3RlZCc7XHJcbiAgbGljZW5zZT86IHN0cmluZztcclxuICBub3RpZnlGb2xsb3dlcnM/OiBib29sZWFuO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTWVkaXVtUHVibGlzaFJlc3BvbnNlIHtcclxuICBkYXRhOiB7XHJcbiAgICBpZDogc3RyaW5nO1xyXG4gICAgdGl0bGU6IHN0cmluZztcclxuICAgIGF1dGhvcklkOiBzdHJpbmc7XHJcbiAgICB0YWdzOiBzdHJpbmdbXTtcclxuICAgIHVybDogc3RyaW5nO1xyXG4gICAgY2Fub25pY2FsVXJsOiBzdHJpbmc7XHJcbiAgICBwdWJsaXNoU3RhdHVzOiBzdHJpbmc7XHJcbiAgICBwdWJsaXNoZWRBdDogbnVtYmVyO1xyXG4gICAgbGljZW5zZTogc3RyaW5nO1xyXG4gICAgbGljZW5zZVVybDogc3RyaW5nO1xyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBNZWRpdW1QdWJsaXNoaW5nQWdlbnQgZXh0ZW5kcyBCYXNlUHVibGlzaGluZ0FnZW50IHtcclxuICByZWFkb25seSBwbGF0Zm9ybU5hbWUgPSAnTWVkaXVtJztcclxuICByZWFkb25seSBzdXBwb3J0ZWRGZWF0dXJlcyA9IFsndGFncycsICdpbWFnZXMnLCAnbWFya2Rvd24nLCAnZHJhZnRzJywgJ3NjaGVkdWxpbmcnXTtcclxuXHJcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlVXJsID0gJ2h0dHBzOi8vYXBpLm1lZGl1bS5jb20vdjEnO1xyXG5cclxuICBhc3luYyB2YWxpZGF0ZUNyZWRlbnRpYWxzKGNyZWRlbnRpYWxzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICB0aGlzLnZhbGlkYXRlUmVxdWlyZWRDcmVkZW50aWFscyhjcmVkZW50aWFscywgWydhY2Nlc3NUb2tlbiddKTtcclxuICAgICAgY29uc3QgbWVkaXVtQ3JlZHMgPSBjcmVkZW50aWFscyBhcyBNZWRpdW1DcmVkZW50aWFscztcclxuICAgICAgXHJcbiAgICAgIC8vIFZhbGlkYXRlIHRva2VuIGJ5IGZldGNoaW5nIHVzZXIgaW5mb1xyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke3RoaXMuYmFzZVVybH0vbWVgLCB7XHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7bWVkaXVtQ3JlZHMuYWNjZXNzVG9rZW59YCxcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICAnQWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24nXHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIHJldHVybiByZXNwb25zZS5vaztcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ01lZGl1bSBjcmVkZW50aWFsIHZhbGlkYXRpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZm9ybWF0Q29udGVudChjb250ZW50OiBCbG9nQ29udGVudCwgaW1hZ2VVcmw/OiBzdHJpbmcpOiBQcm9taXNlPEZvcm1hdHRlZENvbnRlbnQ+IHtcclxuICAgIGNvbnN0IHNhbml0aXplZENvbnRlbnQgPSB0aGlzLnNhbml0aXplQ29udGVudChjb250ZW50LmN1cnJlbnREcmFmdCk7XHJcbiAgICBjb25zdCB0YWdzID0gdGhpcy5leHRyYWN0VGFncyhzYW5pdGl6ZWRDb250ZW50KTtcclxuICAgIFxyXG4gICAgLy8gRXh0cmFjdCB0aXRsZSBmcm9tIGNvbnRlbnQgKGZpcnN0IGxpbmUgb3IgZmlyc3QgaGVhZGluZylcclxuICAgIGNvbnN0IGxpbmVzID0gc2FuaXRpemVkQ29udGVudC5zcGxpdCgnXFxuJyk7XHJcbiAgICBsZXQgdGl0bGUgPSAnVW50aXRsZWQgUG9zdCc7XHJcbiAgICBsZXQgYm9keSA9IHNhbml0aXplZENvbnRlbnQ7XHJcblxyXG4gICAgLy8gTG9vayBmb3IgdGl0bGUgaW4gZmlyc3QgZmV3IGxpbmVzXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IE1hdGgubWluKDMsIGxpbmVzLmxlbmd0aCk7IGkrKykge1xyXG4gICAgICBjb25zdCBsaW5lID0gbGluZXNbaV0udHJpbSgpO1xyXG4gICAgICBpZiAobGluZS5zdGFydHNXaXRoKCcjICcpKSB7XHJcbiAgICAgICAgdGl0bGUgPSBsaW5lLnN1YnN0cmluZygyKS50cmltKCk7XHJcbiAgICAgICAgYm9keSA9IGxpbmVzLnNsaWNlKGkgKyAxKS5qb2luKCdcXG4nKS50cmltKCk7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH0gZWxzZSBpZiAobGluZS5sZW5ndGggPiAxMCAmJiBsaW5lLmxlbmd0aCA8IDEwMCAmJiAhbGluZS5pbmNsdWRlcygnLicpKSB7XHJcbiAgICAgICAgdGl0bGUgPSBsaW5lO1xyXG4gICAgICAgIGJvZHkgPSBsaW5lcy5zbGljZShpICsgMSkuam9pbignXFxuJykudHJpbSgpO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQWRkIGltYWdlIHRvIGNvbnRlbnQgaWYgcHJvdmlkZWRcclxuICAgIGlmIChpbWFnZVVybCkge1xyXG4gICAgICBib2R5ID0gYCFbJHt0aXRsZX1dKCR7aW1hZ2VVcmx9KVxcblxcbiR7Ym9keX1gO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHRpdGxlOiB0aXRsZS5zdWJzdHJpbmcoMCwgMTAwKSwgLy8gTWVkaXVtIHRpdGxlIGxpbWl0XHJcbiAgICAgIGJvZHk6IHRoaXMuZm9ybWF0TWFya2Rvd25Gb3JNZWRpdW0oYm9keSksXHJcbiAgICAgIHRhZ3M6IHRhZ3Muc2xpY2UoMCwgNSksIC8vIE1lZGl1bSBhbGxvd3MgbWF4IDUgdGFnc1xyXG4gICAgICBpbWFnZVVybCxcclxuICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICBwdWJsaXNoU3RhdHVzOiAncHVibGljJyxcclxuICAgICAgICBsaWNlbnNlOiAnYWxsLXJpZ2h0cy1yZXNlcnZlZCcsXHJcbiAgICAgICAgbm90aWZ5Rm9sbG93ZXJzOiB0cnVlXHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBhc3luYyBwdWJsaXNoKGZvcm1hdHRlZENvbnRlbnQ6IEZvcm1hdHRlZENvbnRlbnQsIGNvbmZpZzogUHVibGlzaGluZ0NvbmZpZyk6IFByb21pc2U8UHVibGlzaFJlc3VsdD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY3JlZGVudGlhbHMgPSBjb25maWcuY3JlZGVudGlhbHMgYXMgTWVkaXVtQ3JlZGVudGlhbHM7XHJcbiAgICAgIFxyXG4gICAgICAvLyBHZXQgYXV0aG9yIElEIGlmIG5vdCBwcm92aWRlZFxyXG4gICAgICBsZXQgYXV0aG9ySWQgPSBjcmVkZW50aWFscy5hdXRob3JJZDtcclxuICAgICAgaWYgKCFhdXRob3JJZCkge1xyXG4gICAgICAgIGNvbnN0IHVzZXJSZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke3RoaXMuYmFzZVVybH0vbWVgLCB7XHJcbiAgICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAgICdBdXRob3JpemF0aW9uJzogYEJlYXJlciAke2NyZWRlbnRpYWxzLmFjY2Vzc1Rva2VufWAsXHJcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXVzZXJSZXNwb25zZS5vaykge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZ2V0IHVzZXIgaW5mb3JtYXRpb24nKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgdXNlckRhdGEgPSBhd2FpdCB1c2VyUmVzcG9uc2UuanNvbigpO1xyXG4gICAgICAgIGF1dGhvcklkID0gdXNlckRhdGEuZGF0YS5pZDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcG9zdERhdGE6IE1lZGl1bVBvc3QgPSB7XHJcbiAgICAgICAgdGl0bGU6IGZvcm1hdHRlZENvbnRlbnQudGl0bGUsXHJcbiAgICAgICAgY29udGVudEZvcm1hdDogJ21hcmtkb3duJyxcclxuICAgICAgICBjb250ZW50OiBmb3JtYXR0ZWRDb250ZW50LmJvZHksXHJcbiAgICAgICAgdGFnczogZm9ybWF0dGVkQ29udGVudC50YWdzIHx8IFtdLFxyXG4gICAgICAgIHB1Ymxpc2hTdGF0dXM6IChmb3JtYXR0ZWRDb250ZW50Lm1ldGFkYXRhPy5wdWJsaXNoU3RhdHVzIGFzICdwdWJsaWMnIHwgJ2RyYWZ0JyB8ICd1bmxpc3RlZCcpIHx8ICdwdWJsaWMnLFxyXG4gICAgICAgIGxpY2Vuc2U6IGZvcm1hdHRlZENvbnRlbnQubWV0YWRhdGE/LmxpY2Vuc2UgfHwgJ2FsbC1yaWdodHMtcmVzZXJ2ZWQnLFxyXG4gICAgICAgIG5vdGlmeUZvbGxvd2VyczogZm9ybWF0dGVkQ29udGVudC5tZXRhZGF0YT8ubm90aWZ5Rm9sbG93ZXJzICE9PSBmYWxzZVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHt0aGlzLmJhc2VVcmx9L3VzZXJzLyR7YXV0aG9ySWR9L3Bvc3RzYCwge1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdBdXRob3JpemF0aW9uJzogYEJlYXJlciAke2NyZWRlbnRpYWxzLmFjY2Vzc1Rva2VufWAsXHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgJ0FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJ1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocG9zdERhdGEpXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xyXG4gICAgICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1lZGl1bSBBUEkgZXJyb3I6ICR7cmVzcG9uc2Uuc3RhdHVzfSAtICR7ZXJyb3JUZXh0fWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQ6IE1lZGl1bVB1Ymxpc2hSZXNwb25zZSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBwbGF0Zm9ybVVybDogcmVzdWx0LmRhdGEudXJsLFxyXG4gICAgICAgIHBsYXRmb3JtSWQ6IHJlc3VsdC5kYXRhLmlkLFxyXG4gICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICBjYW5vbmljYWxVcmw6IHJlc3VsdC5kYXRhLmNhbm9uaWNhbFVybCxcclxuICAgICAgICAgIHB1Ymxpc2hlZEF0OiByZXN1bHQuZGF0YS5wdWJsaXNoZWRBdCxcclxuICAgICAgICAgIGF1dGhvcklkOiByZXN1bHQuZGF0YS5hdXRob3JJZFxyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ01lZGl1bSBwdWJsaXNoaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRQdWJsaXNoaW5nU3RhdHVzKHBsYXRmb3JtSWQ6IHN0cmluZywgY29uZmlnOiBQdWJsaXNoaW5nQ29uZmlnKTogUHJvbWlzZTwncHVibGlzaGVkJyB8ICdkcmFmdCcgfCAnZmFpbGVkJyB8ICd1bmtub3duJz4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY3JlZGVudGlhbHMgPSBjb25maWcuY3JlZGVudGlhbHMgYXMgTWVkaXVtQ3JlZGVudGlhbHM7XHJcbiAgICAgIFxyXG4gICAgICAvLyBNZWRpdW0gZG9lc24ndCBwcm92aWRlIGEgZGlyZWN0IEFQSSB0byBnZXQgcG9zdCBzdGF0dXMgYnkgSURcclxuICAgICAgLy8gVGhpcyB3b3VsZCByZXF1aXJlIHN0b3JpbmcgdGhlIHBvc3QgZGF0YSBvciB1c2luZyBhIGRpZmZlcmVudCBhcHByb2FjaFxyXG4gICAgICAvLyBGb3Igbm93LCB3ZSdsbCByZXR1cm4gJ3Vua25vd24nIGFzIE1lZGl1bSBwb3N0cyBhcmUgdHlwaWNhbGx5IHB1Ymxpc2hlZCBpbW1lZGlhdGVseVxyXG4gICAgICByZXR1cm4gJ3Vua25vd24nO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGdldCBNZWRpdW0gcG9zdCBzdGF0dXM6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gJ3Vua25vd24nO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBmb3JtYXRNYXJrZG93bkZvck1lZGl1bShjb250ZW50OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgLy8gTWVkaXVtLXNwZWNpZmljIG1hcmtkb3duIGZvcm1hdHRpbmdcclxuICAgIHJldHVybiBjb250ZW50XHJcbiAgICAgIC8vIEVuc3VyZSBwcm9wZXIgaGVhZGluZyBmb3JtYXR0aW5nXHJcbiAgICAgIC5yZXBsYWNlKC9eI3sxLDZ9XFxzKy9nbSwgKG1hdGNoKSA9PiBtYXRjaClcclxuICAgICAgLy8gRW5zdXJlIHByb3BlciBsaXN0IGZvcm1hdHRpbmdcclxuICAgICAgLnJlcGxhY2UoL15cXHMqWy0qK11cXHMrL2dtLCAnKiAnKVxyXG4gICAgICAvLyBFbnN1cmUgcHJvcGVyIG51bWJlcmVkIGxpc3QgZm9ybWF0dGluZ1xyXG4gICAgICAucmVwbGFjZSgvXlxccypcXGQrXFwuXFxzKy9nbSwgKG1hdGNoKSA9PiBtYXRjaC50cmltKCkgKyAnICcpXHJcbiAgICAgIC8vIENsZWFuIHVwIGV4dHJhIHdoaXRlc3BhY2VcclxuICAgICAgLnJlcGxhY2UoL1xcbnszLH0vZywgJ1xcblxcbicpXHJcbiAgICAgIC50cmltKCk7XHJcbiAgfVxyXG59Il19