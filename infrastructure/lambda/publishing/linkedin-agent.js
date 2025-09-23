"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinkedInPublishingAgent = void 0;
const base_publishing_agent_1 = require("./base-publishing-agent");
class LinkedInPublishingAgent extends base_publishing_agent_1.BasePublishingAgent {
    constructor() {
        super(...arguments);
        this.platformName = 'LinkedIn';
        this.supportedFeatures = ['images', 'professional-formatting', 'hashtags', 'mentions'];
        this.baseUrl = 'https://api.linkedin.com/v2';
    }
    async validateCredentials(credentials) {
        try {
            this.validateRequiredCredentials(credentials, ['accessToken']);
            const linkedInCreds = credentials;
            // Validate token by fetching user profile
            const response = await fetch(`${this.baseUrl}/people/~`, {
                headers: {
                    'Authorization': `Bearer ${linkedInCreds.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.ok;
        }
        catch (error) {
            console.error('LinkedIn credential validation failed:', error);
            return false;
        }
    }
    async formatContent(content, imageUrl) {
        const sanitizedContent = this.sanitizeContent(content.currentDraft);
        // Extract title and body
        const lines = sanitizedContent.split('\n');
        let title = 'Professional Update';
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
        // Format content for LinkedIn's professional context
        const formattedBody = this.formatForLinkedIn(body);
        const tags = this.extractTags(formattedBody);
        return {
            title: title.substring(0, 200),
            body: formattedBody.substring(0, 3000),
            tags: tags.slice(0, 10),
            imageUrl,
            metadata: {
                visibility: 'PUBLIC',
                lifecycleState: 'PUBLISHED'
            }
        };
    }
    async publish(formattedContent, config) {
        try {
            const credentials = config.credentials;
            // Get person URN if not provided
            let personUrn = credentials.personUrn;
            if (!personUrn) {
                const profileResponse = await fetch(`${this.baseUrl}/people/~`, {
                    headers: {
                        'Authorization': `Bearer ${credentials.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                if (!profileResponse.ok) {
                    throw new Error('Failed to get user profile');
                }
                const profileData = await profileResponse.json();
                personUrn = profileData.id;
            }
            // Prepare post content
            let postText = formattedContent.body;
            if (formattedContent.tags && formattedContent.tags.length > 0) {
                postText += '\n\n' + formattedContent.tags.map(tag => `#${tag}`).join(' ');
            }
            const postData = {
                author: `urn:li:person:${personUrn}`,
                lifecycleState: formattedContent.metadata?.lifecycleState || 'PUBLISHED',
                specificContent: {
                    'com.linkedin.ugc.ShareContent': {
                        shareCommentary: {
                            text: postText
                        },
                        shareMediaCategory: formattedContent.imageUrl ? 'IMAGE' : 'NONE'
                    }
                },
                visibility: {
                    'com.linkedin.ugc.MemberNetworkVisibility': formattedContent.metadata?.visibility || 'PUBLIC'
                }
            };
            // Add image if provided
            if (formattedContent.imageUrl) {
                // In a real implementation, you would need to upload the image first
                // and get a LinkedIn media URN. For now, we'll skip image upload.
                postData.specificContent['com.linkedin.ugc.ShareContent'].media = [{
                        status: 'READY',
                        description: {
                            text: formattedContent.title
                        },
                        media: 'urn:li:digitalmediaAsset:placeholder',
                        title: {
                            text: formattedContent.title
                        }
                    }];
            }
            const response = await fetch(`${this.baseUrl}/ugcPosts`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${credentials.accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Restli-Protocol-Version': '2.0.0'
                },
                body: JSON.stringify(postData)
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`LinkedIn API error: ${response.status} - ${errorText}`);
            }
            const result = await response.json();
            return {
                success: true,
                platformUrl: `https://www.linkedin.com/feed/update/${result.activity}`,
                platformId: result.id,
                metadata: {
                    activity: result.activity,
                    personUrn
                }
            };
        }
        catch (error) {
            console.error('LinkedIn publishing failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
    async getPublishingStatus(platformId, config) {
        try {
            const credentials = config.credentials;
            const response = await fetch(`${this.baseUrl}/ugcPosts/${platformId}`, {
                headers: {
                    'Authorization': `Bearer ${credentials.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                return 'unknown';
            }
            const postData = await response.json();
            const lifecycleState = postData.lifecycleState;
            switch (lifecycleState) {
                case 'PUBLISHED':
                    return 'published';
                case 'DRAFT':
                    return 'draft';
                default:
                    return 'unknown';
            }
        }
        catch (error) {
            console.error('Failed to get LinkedIn post status:', error);
            return 'unknown';
        }
    }
    formatForLinkedIn(content) {
        // Format content for LinkedIn's professional context
        return content
            // Convert markdown headers to bold text for better LinkedIn display
            .replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
            // Convert markdown bold to LinkedIn format
            .replace(/\*\*(.*?)\*\*/g, '**$1**')
            // Convert markdown italic to LinkedIn format
            .replace(/\*(.*?)\*/g, '*$1*')
            // Convert markdown links to plain text with URL
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
            // Convert bullet points to LinkedIn-friendly format
            .replace(/^\s*[-*+]\s+/gm, '• ')
            // Convert numbered lists
            .replace(/^\s*(\d+)\.\s+/gm, '$1. ')
            // Add professional tone indicators
            .replace(/^(.+)$/gm, (match, line) => {
            // Add thought leadership indicators for key insights
            if (line.trim().length > 50 && line.includes('insight') || line.includes('learn')) {
                return `💡 ${line}`;
            }
            return line;
        })
            // Clean up extra whitespace
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}
exports.LinkedInPublishingAgent = LinkedInPublishingAgent;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGlua2VkaW4tYWdlbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJsaW5rZWRpbi1hZ2VudC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtRUFBaUg7QUF1Q2pILE1BQWEsdUJBQXdCLFNBQVEsMkNBQW1CO0lBQWhFOztRQUNXLGlCQUFZLEdBQUcsVUFBVSxDQUFDO1FBQzFCLHNCQUFpQixHQUFHLENBQUMsUUFBUSxFQUFFLHlCQUF5QixFQUFFLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUUxRSxZQUFPLEdBQUcsNkJBQTZCLENBQUM7SUFzTjNELENBQUM7SUFwTkMsS0FBSyxDQUFDLG1CQUFtQixDQUFDLFdBQWdDO1FBQ3hELElBQUk7WUFDRixJQUFJLENBQUMsMkJBQTJCLENBQUMsV0FBVyxFQUFFLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQztZQUMvRCxNQUFNLGFBQWEsR0FBRyxXQUFrQyxDQUFDO1lBRXpELDBDQUEwQztZQUMxQyxNQUFNLFFBQVEsR0FBRyxNQUFNLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxPQUFPLFdBQVcsRUFBRTtnQkFDdkQsT0FBTyxFQUFFO29CQUNQLGVBQWUsRUFBRSxVQUFVLGFBQWEsQ0FBQyxXQUFXLEVBQUU7b0JBQ3RELGNBQWMsRUFBRSxrQkFBa0I7aUJBQ25DO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsT0FBTyxRQUFRLENBQUMsRUFBRSxDQUFDO1NBQ3BCO1FBQUMsT0FBTyxLQUFLLEVBQUU7WUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLHdDQUF3QyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQy9ELE9BQU8sS0FBSyxDQUFDO1NBQ2Q7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLGFBQWEsQ0FBQyxPQUFvQixFQUFFLFFBQWlCO1FBQ3pELE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFcEUseUJBQXlCO1FBQ3pCLE1BQU0s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Z0JBQWdCLEVBQUUsSUFBSSxDQUFDO1lBQ2hDLHlCQUF5QjthQUN4QixPQUFPLENBQUMsa0JBQWtCLEVBQUUsTUFBTSxDQUFDO1lBQ3BDLG1DQUFtQzthQUNsQyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxFQUFFO1lBQ25DLHFEQUFxRDtZQUNyRCxJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxNQUFNLEdBQUcsRUFBRSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRTtnQkFDakYsT0FBTyxNQUFNLElBQUksRUFBRSxDQUFDO2FBQ3JCO1lBQ0QsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDLENBQUM7WUFDRiw0QkFBNEI7YUFDM0IsT0FBTyxDQUFDLFNBQVMsRUFBRSxNQUFNLENBQUM7YUFDMUIsSUFBSSxFQUFFLENBQUM7SUFDWixDQUFDO0NBQ0Y7QUExTkQsMERBME5DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQmFzZVB1Ymxpc2hpbmdBZ2VudCwgUHVibGlzaGluZ0NvbmZpZywgUHVibGlzaFJlc3VsdCwgRm9ybWF0dGVkQ29udGVudCB9IGZyb20gJy4vYmFzZS1wdWJsaXNoaW5nLWFnZW50JztcclxuaW1wb3J0IHsgQmxvZ0NvbnRlbnQgfSBmcm9tICcuLi8uLi8uLi9mcm9udGVuZC9zcmMvdHlwZXMvQmxvZ0NvbnRlbnQnO1xyXG5cclxuaW50ZXJmYWNlIExpbmtlZEluQ3JlZGVudGlhbHMge1xyXG4gIGFjY2Vzc1Rva2VuOiBzdHJpbmc7XHJcbiAgcGVyc29uVXJuPzogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTGlua2VkSW5Qb3N0IHtcclxuICBhdXRob3I6IHN0cmluZztcclxuICBsaWZlY3ljbGVTdGF0ZTogJ1BVQkxJU0hFRCcgfCAnRFJBRlQnO1xyXG4gIHNwZWNpZmljQ29udGVudDoge1xyXG4gICAgJ2NvbS5saW5rZWRpbi51Z2MuU2hhcmVDb250ZW50Jzoge1xyXG4gICAgICBzaGFyZUNvbW1lbnRhcnk6IHtcclxuICAgICAgICB0ZXh0OiBzdHJpbmc7XHJcbiAgICAgIH07XHJcbiAgICAgIHNoYXJlTWVkaWFDYXRlZ29yeTogJ05PTkUnIHwgJ0lNQUdFJyB8ICdWSURFTycgfCAnQVJUSUNMRSc7XHJcbiAgICAgIG1lZGlhPzogQXJyYXk8e1xyXG4gICAgICAgIHN0YXR1czogJ1JFQURZJztcclxuICAgICAgICBkZXNjcmlwdGlvbjoge1xyXG4gICAgICAgICAgdGV4dDogc3RyaW5nO1xyXG4gICAgICAgIH07XHJcbiAgICAgICAgbWVkaWE6IHN0cmluZztcclxuICAgICAgICB0aXRsZToge1xyXG4gICAgICAgICAgdGV4dDogc3RyaW5nO1xyXG4gICAgICAgIH07XHJcbiAgICAgIH0+O1xyXG4gICAgfTtcclxuICB9O1xyXG4gIHZpc2liaWxpdHk6IHtcclxuICAgICdjb20ubGlua2VkaW4udWdjLk1lbWJlck5ldHdvcmtWaXNpYmlsaXR5JzogJ1BVQkxJQycgfCAnQ09OTkVDVElPTlMnO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBMaW5rZWRJblB1Ymxpc2hSZXNwb25zZSB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBhY3Rpdml0eTogc3RyaW5nO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgTGlua2VkSW5QdWJsaXNoaW5nQWdlbnQgZXh0ZW5kcyBCYXNlUHVibGlzaGluZ0FnZW50IHtcclxuICByZWFkb25seSBwbGF0Zm9ybU5hbWUgPSAnTGlua2VkSW4nO1xyXG4gIHJlYWRvbmx5IHN1cHBvcnRlZEZlYXR1cmVzID0gWydpbWFnZXMnLCAncHJvZmVzc2lvbmFsLWZvcm1hdHRpbmcnLCAnaGFzaHRhZ3MnLCAnbWVudGlvbnMnXTtcclxuXHJcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlVXJsID0gJ2h0dHBzOi8vYXBpLmxpbmtlZGluLmNvbS92Mic7XHJcblxyXG4gIGFzeW5jIHZhbGlkYXRlQ3JlZGVudGlhbHMoY3JlZGVudGlhbHM6IFJlY29yZDxzdHJpbmcsIGFueT4pOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHRoaXMudmFsaWRhdGVSZXF1aXJlZENyZWRlbnRpYWxzKGNyZWRlbnRpYWxzLCBbJ2FjY2Vzc1Rva2VuJ10pO1xyXG4gICAgICBjb25zdCBsaW5rZWRJbkNyZWRzID0gY3JlZGVudGlhbHMgYXMgTGlua2VkSW5DcmVkZW50aWFscztcclxuICAgICAgXHJcbiAgICAgIC8vIFZhbGlkYXRlIHRva2VuIGJ5IGZldGNoaW5nIHVzZXIgcHJvZmlsZVxyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke3RoaXMuYmFzZVVybH0vcGVvcGxlL35gLCB7XHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7bGlua2VkSW5DcmVkcy5hY2Nlc3NUb2tlbn1gLFxyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICByZXR1cm4gcmVzcG9uc2Uub2s7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdMaW5rZWRJbiBjcmVkZW50aWFsIHZhbGlkYXRpb24gZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZm9ybWF0Q29udGVudChjb250ZW50OiBCbG9nQ29udGVudCwgaW1hZ2VVcmw/OiBzdHJpbmcpOiBQcm9taXNlPEZvcm1hdHRlZENvbnRlbnQ+IHtcclxuICAgIGNvbnN0IHNhbml0aXplZENvbnRlbnQgPSB0aGlzLnNhbml0aXplQ29udGVudChjb250ZW50LmN1cnJlbnREcmFmdCk7XHJcbiAgICBcclxuICAgIC8vIEV4dHJhY3QgdGl0bGUgYW5kIGJvZHlcclxuICAgIGNvbnN0IGxpbmVzID0gc2FuaXRpemVkQ29udGVudC5zcGxpdCgnXFxuJyk7XHJcbiAgICBsZXQgdGl0bGUgPSAnUHJvZmVzc2lvbmFsIFVwZGF0ZSc7XHJcbiAgICBsZXQgYm9keSA9IHNhbml0aXplZENvbnRlbnQ7XHJcblxyXG4gICAgLy8gTG9vayBmb3IgdGl0bGUgaW4gZmlyc3QgZmV3IGxpbmVzXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IE1hdGgubWluKDMsIGxpbmVzLmxlbmd0aCk7IGkrKykge1xyXG4gICAgICBjb25zdCBsaW5lID0gbGluZXNbaV0udHJpbSgpO1xyXG4gICAgICBpZiAobGluZS5zdGFydHNXaXRoKCcjICcpKSB7XHJcbiAgICAgICAgdGl0bGUgPSBsaW5lLnN1YnN0cmluZygyKS50cmltKCk7XHJcbiAgICAgICAgYm9keSA9IGxpbmVzLnNsaWNlKGkgKyAxKS5qb2luKCdcXG4nKS50cmltKCk7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH0gZWxzZSBpZiAobGluZS5sZW5ndGggPiAxMCAmJiBsaW5lLmxlbmd0aCA8IDEwMCAmJiAhbGluZS5pbmNsdWRlcygnLicpKSB7XHJcbiAgICAgICAgdGl0bGUgPSBsaW5lO1xyXG4gICAgICAgIGJvZHkgPSBsaW5lcy5zbGljZShpICsgMSkuam9pbignXFxuJykudHJpbSgpO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRm9ybWF0IGNvbnRlbnQgZm9yIExpbmtlZEluJ3MgcHJvZmVzc2lvbmFsIGNvbnRleHRcclxuICAgIGNvbnN0IGZvcm1hdHRlZEJvZHkgPSB0aGlzLmZvcm1hdEZvckxpbmtlZEluKGJvZHkpO1xyXG4gICAgY29uc3QgdGFncyA9IHRoaXMuZXh0cmFjdFRhZ3MoZm9ybWF0dGVkQm9keSk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgdGl0bGU6IHRpdGxlLnN1YnN0cmluZygwLCAyMDApLCAvLyBMaW5rZWRJbiB0aXRsZSBsaW1pdFxyXG4gICAgICBib2R5OiBmb3JtYXR0ZWRCb2R5LnN1YnN0cmluZygwLCAzMDAwKSwgLy8gTGlua2VkSW4gcG9zdCBsaW1pdFxyXG4gICAgICB0YWdzOiB0YWdzLnNsaWNlKDAsIDEwKSwgLy8gUmVhc29uYWJsZSBoYXNodGFnIGxpbWl0XHJcbiAgICAgIGltYWdlVXJsLFxyXG4gICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgIHZpc2liaWxpdHk6ICdQVUJMSUMnLFxyXG4gICAgICAgIGxpZmVjeWNsZVN0YXRlOiAnUFVCTElTSEVEJ1xyXG4gICAgICB9XHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHVibGlzaChmb3JtYXR0ZWRDb250ZW50OiBGb3JtYXR0ZWRDb250ZW50LCBjb25maWc6IFB1Ymxpc2hpbmdDb25maWcpOiBQcm9taXNlPFB1Ymxpc2hSZXN1bHQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNyZWRlbnRpYWxzID0gY29uZmlnLmNyZWRlbnRpYWxzIGFzIExpbmtlZEluQ3JlZGVudGlhbHM7XHJcbiAgICAgIFxyXG4gICAgICAvLyBHZXQgcGVyc29uIFVSTiBpZiBub3QgcHJvdmlkZWRcclxuICAgICAgbGV0IHBlcnNvblVybiA9IGNyZWRlbnRpYWxzLnBlcnNvblVybjtcclxuICAgICAgaWYgKCFwZXJzb25Vcm4pIHtcclxuICAgICAgICBjb25zdCBwcm9maWxlUmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHt0aGlzLmJhc2VVcmx9L3Blb3BsZS9+YCwge1xyXG4gICAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHtjcmVkZW50aWFscy5hY2Nlc3NUb2tlbn1gLFxyXG4gICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFwcm9maWxlUmVzcG9uc2Uub2spIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGdldCB1c2VyIHByb2ZpbGUnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgcHJvZmlsZURhdGEgPSBhd2FpdCBwcm9maWxlUmVzcG9uc2UuanNvbigpO1xyXG4gICAgICAgIHBlcnNvblVybiA9IHByb2ZpbGVEYXRhLmlkO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBQcmVwYXJlIHBvc3QgY29udGVudFxyXG4gICAgICBsZXQgcG9zdFRleHQgPSBmb3JtYXR0ZWRDb250ZW50LmJvZHk7XHJcbiAgICAgIGlmIChmb3JtYXR0ZWRDb250ZW50LnRhZ3MgJiYgZm9ybWF0dGVkQ29udGVudC50YWdzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBwb3N0VGV4dCArPSAnXFxuXFxuJyArIGZvcm1hdHRlZENvbnRlbnQudGFncy5tYXAodGFnID0+IGAjJHt0YWd9YCkuam9pbignICcpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBwb3N0RGF0YTogTGlua2VkSW5Qb3N0ID0ge1xyXG4gICAgICAgIGF1dGhvcjogYHVybjpsaTpwZXJzb246JHtwZXJzb25Vcm59YCxcclxuICAgICAgICBsaWZlY3ljbGVTdGF0ZTogKGZvcm1hdHRlZENvbnRlbnQubWV0YWRhdGE/LmxpZmVjeWNsZVN0YXRlIGFzICdQVUJMSVNIRUQnIHwgJ0RSQUZUJykgfHwgJ1BVQkxJU0hFRCcsXHJcbiAgICAgICAgc3BlY2lmaWNDb250ZW50OiB7XHJcbiAgICAgICAgICAnY29tLmxpbmtlZGluLnVnYy5TaGFyZUNvbnRlbnQnOiB7XHJcbiAgICAgICAgICAgIHNoYXJlQ29tbWVudGFyeToge1xyXG4gICAgICAgICAgICAgIHRleHQ6IHBvc3RUZXh0XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHNoYXJlTWVkaWFDYXRlZ29yeTogZm9ybWF0dGVkQ29udGVudC5pbWFnZVVybCA/ICdJTUFHRScgOiAnTk9ORSdcclxuICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIHZpc2liaWxpdHk6IHtcclxuICAgICAgICAgICdjb20ubGlua2VkaW4udWdjLk1lbWJlck5ldHdvcmtWaXNpYmlsaXR5JzogKGZvcm1hdHRlZENvbnRlbnQubWV0YWRhdGE/LnZpc2liaWxpdHkgYXMgJ1BVQkxJQycgfCAnQ09OTkVDVElPTlMnKSB8fCAnUFVCTElDJ1xyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIEFkZCBpbWFnZSBpZiBwcm92aWRlZFxyXG4gICAgICBpZiAoZm9ybWF0dGVkQ29udGVudC5pbWFnZVVybCkge1xyXG4gICAgICAgIC8vIEluIGEgcmVhbCBpbXBsZW1lbnRhdGlvbiwgeW91IHdvdWxkIG5lZWQgdG8gdXBsb2FkIHRoZSBpbWFnZSBmaXJzdFxyXG4gICAgICAgIC8vIGFuZCBnZXQgYSBMaW5rZWRJbiBtZWRpYSBVUk4uIEZvciBub3csIHdlJ2xsIHNraXAgaW1hZ2UgdXBsb2FkLlxyXG4gICAgICAgIHBvc3REYXRhLnNwZWNpZmljQ29udGVudFsnY29tLmxpbmtlZGluLnVnYy5TaGFyZUNvbnRlbnQnXS5tZWRpYSA9IFt7XHJcbiAgICAgICAgICBzdGF0dXM6ICdSRUFEWScsXHJcbiAgICAgICAgICBkZXNjcmlwdGlvbjoge1xyXG4gICAgICAgICAgICB0ZXh0OiBmb3JtYXR0ZWRDb250ZW50LnRpdGxlXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgbWVkaWE6ICd1cm46bGk6ZGlnaXRhbG1lZGlhQXNzZXQ6cGxhY2Vob2xkZXInLCAvLyBXb3VsZCBiZSBhY3R1YWwgbWVkaWEgVVJOXHJcbiAgICAgICAgICB0aXRsZToge1xyXG4gICAgICAgICAgICB0ZXh0OiBmb3JtYXR0ZWRDb250ZW50LnRpdGxlXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfV07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goYCR7dGhpcy5iYXNlVXJsfS91Z2NQb3N0c2AsIHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHtjcmVkZW50aWFscy5hY2Nlc3NUb2tlbn1gLFxyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAgICdYLVJlc3RsaS1Qcm90b2NvbC1WZXJzaW9uJzogJzIuMC4wJ1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocG9zdERhdGEpXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xyXG4gICAgICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYExpbmtlZEluIEFQSSBlcnJvcjogJHtyZXNwb25zZS5zdGF0dXN9IC0gJHtlcnJvclRleHR9YCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdDogTGlua2VkSW5QdWJsaXNoUmVzcG9uc2UgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XHJcblxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgcGxhdGZvcm1Vcmw6IGBodHRwczovL3d3dy5saW5rZWRpbi5jb20vZmVlZC91cGRhdGUvJHtyZXN1bHQuYWN0aXZpdHl9YCxcclxuICAgICAgICBwbGF0Zm9ybUlkOiByZXN1bHQuaWQsXHJcbiAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgIGFjdGl2aXR5OiByZXN1bHQuYWN0aXZpdHksXHJcbiAgICAgICAgICBwZXJzb25Vcm5cclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdMaW5rZWRJbiBwdWJsaXNoaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRQdWJsaXNoaW5nU3RhdHVzKHBsYXRmb3JtSWQ6IHN0cmluZywgY29uZmlnOiBQdWJsaXNoaW5nQ29uZmlnKTogUHJvbWlzZTwncHVibGlzaGVkJyB8ICdkcmFmdCcgfCAnZmFpbGVkJyB8ICd1bmtub3duJz4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY3JlZGVudGlhbHMgPSBjb25maWcuY3JlZGVudGlhbHMgYXMgTGlua2VkSW5DcmVkZW50aWFscztcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goYCR7dGhpcy5iYXNlVXJsfS91Z2NQb3N0cy8ke3BsYXRmb3JtSWR9YCwge1xyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdBdXRob3JpemF0aW9uJzogYEJlYXJlciAke2NyZWRlbnRpYWxzLmFjY2Vzc1Rva2VufWAsXHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nXHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcclxuICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBwb3N0RGF0YSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuICAgICAgY29uc3QgbGlmZWN5Y2xlU3RhdGUgPSBwb3N0RGF0YS5saWZlY3ljbGVTdGF0ZTtcclxuICAgICAgXHJcbiAgICAgIHN3aXRjaCAobGlmZWN5Y2xlU3RhdGUpIHtcclxuICAgICAgICBjYXNlICdQVUJMSVNIRUQnOlxyXG4gICAgICAgICAgcmV0dXJuICdwdWJsaXNoZWQnO1xyXG4gICAgICAgIGNhc2UgJ0RSQUZUJzpcclxuICAgICAgICAgIHJldHVybiAnZHJhZnQnO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gZ2V0IExpbmtlZEluIHBvc3Qgc3RhdHVzOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuICd1bmtub3duJztcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgZm9ybWF0Rm9yTGlua2VkSW4oY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIC8vIEZvcm1hdCBjb250ZW50IGZvciBMaW5rZWRJbidzIHByb2Zlc3Npb25hbCBjb250ZXh0XHJcbiAgICByZXR1cm4gY29udGVudFxyXG4gICAgICAvLyBDb252ZXJ0IG1hcmtkb3duIGhlYWRlcnMgdG8gYm9sZCB0ZXh0IGZvciBiZXR0ZXIgTGlua2VkSW4gZGlzcGxheVxyXG4gICAgICAucmVwbGFjZSgvXiN7MSw2fVxccysoLispJC9nbSwgJyoqJDEqKicpXHJcbiAgICAgIC8vIENvbnZlcnQgbWFya2Rvd24gYm9sZCB0byBMaW5rZWRJbiBmb3JtYXRcclxuICAgICAgLnJlcGxhY2UoL1xcKlxcKiguKj8pXFwqXFwqL2csICcqKiQxKionKVxyXG4gICAgICAvLyBDb252ZXJ0IG1hcmtkb3duIGl0YWxpYyB0byBMaW5rZWRJbiBmb3JtYXRcclxuICAgICAgLnJlcGxhY2UoL1xcKiguKj8pXFwqL2csICcqJDEqJylcclxuICAgICAgLy8gQ29udmVydCBtYXJrZG93biBsaW5rcyB0byBwbGFpbiB0ZXh0IHdpdGggVVJMXHJcbiAgICAgIC5yZXBsYWNlKC9cXFsoW15cXF1dKylcXF1cXCgoW14pXSspXFwpL2csICckMSAoJDIpJylcclxuICAgICAgLy8gQ29udmVydCBidWxsZXQgcG9pbnRzIHRvIExpbmtlZEluLWZyaWVuZGx5IGZvcm1hdFxyXG4gICAgICAucmVwbGFjZSgvXlxccypbLSorXVxccysvZ20sICfigKIgJylcclxuICAgICAgLy8gQ29udmVydCBudW1iZXJlZCBsaXN0c1xyXG4gICAgICAucmVwbGFjZSgvXlxccyooXFxkKylcXC5cXHMrL2dtLCAnJDEuICcpXHJcbiAgICAgIC8vIEFkZCBwcm9mZXNzaW9uYWwgdG9uZSBpbmRpY2F0b3JzXHJcbiAgICAgIC5yZXBsYWNlKC9eKC4rKSQvZ20sIChtYXRjaCwgbGluZSkgPT4ge1xyXG4gICAgICAgIC8vIEFkZCB0aG91Z2h0IGxlYWRlcnNoaXAgaW5kaWNhdG9ycyBmb3Iga2V5IGluc2lnaHRzXHJcbiAgICAgICAgaWYgKGxpbmUudHJpbSgpLmxlbmd0aCA+IDUwICYmIGxpbmUuaW5jbHVkZXMoJ2luc2lnaHQnKSB8fCBsaW5lLmluY2x1ZGVzKCdsZWFybicpKSB7XHJcbiAgICAgICAgICByZXR1cm4gYPCfkqEgJHtsaW5lfWA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiBsaW5lO1xyXG4gICAgICB9KVxyXG4gICAgICAvLyBDbGVhbiB1cCBleHRyYSB3aGl0ZXNwYWNlXHJcbiAgICAgIC5yZXBsYWNlKC9cXG57Myx9L2csICdcXG5cXG4nKVxyXG4gICAgICAudHJpbSgpO1xyXG4gIH1cclxufSJdfQ==