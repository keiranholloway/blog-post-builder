import { BasePublishingAgent, PublishingConfig, PublishResult, FormattedContent } from './base-publishing-agent';
import { BlogContent } from '../../../frontend/src/types/BlogContent';

interface MediumCredentials {
  accessToken: string;
  authorId?: string;
}

interface MediumPost {
  title: string;
  contentFormat: 'html' | 'markdown';
  content: string;
  tags?: string[];
  publishStatus: 'public' | 'draft' | 'unlisted';
  license?: string;
  notifyFollowers?: boolean;
}

interface MediumPublishResponse {
  data: {
    id: string;
    title: string;
    authorId: string;
    tags: string[];
    url: string;
    canonicalUrl: string;
    publishStatus: string;
    publishedAt: number;
    license: string;
    licenseUrl: string;
  };
}

export class MediumPublishingAgent extends BasePublishingAgent {
  readonly platformName = 'Medium';
  readonly supportedFeatures = ['tags', 'images', 'markdown', 'drafts', 'scheduling'];

  private readonly baseUrl = 'https://api.medium.com/v1';

  async validateCredentials(credentials: Record<string, any>): Promise<boolean> {
    try {
      this.validateRequiredCredentials(credentials, ['accessToken']);
      const mediumCreds = credentials as MediumCredentials;
      
      // Validate token by fetching user info
      const response = await fetch(`${this.baseUrl}/me`, {
        headers: {
          'Authorization': `Bearer ${mediumCreds.accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      return response.ok;
    } catch (error) {
      console.error('Medium credential validation failed:', error);
      return false;
    }
  }

  async formatContent(content: BlogContent, imageUrl?: string): Promise<FormattedContent> {
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
      } else if (line.length > 10 && line.length < 100 && !line.includes('.')) {
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
      title: title.substring(0, 100), // Medium title limit
      body: this.formatMarkdownForMedium(body),
      tags: tags.slice(0, 5), // Medium allows max 5 tags
      imageUrl,
      metadata: {
        publishStatus: 'public',
        license: 'all-rights-reserved',
        notifyFollowers: true
      }
    };
  }

  async publish(formattedContent: FormattedContent, config: PublishingConfig): Promise<PublishResult> {
    try {
      const credentials = config.credentials as MediumCredentials;
      
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

      const postData: MediumPost = {
        title: formattedContent.title,
        contentFormat: 'markdown',
        content: formattedContent.body,
        tags: formattedContent.tags || [],
        publishStatus: (formattedContent.metadata?.publishStatus as 'public' | 'draft' | 'unlisted') || 'public',
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

      const result: MediumPublishResponse = await response.json();

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
    } catch (error) {
      console.error('Medium publishing failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async getPublishingStatus(platformId: string, config: PublishingConfig): Promise<'published' | 'draft' | 'failed' | 'unknown'> {
    try {
      const credentials = config.credentials as MediumCredentials;
      
      // Medium doesn't provide a direct API to get post status by ID
      // This would require storing the post data or using a different approach
      // For now, we'll return 'unknown' as Medium posts are typically published immediately
      return 'unknown';
    } catch (error) {
      console.error('Failed to get Medium post status:', error);
      return 'unknown';
    }
  }

  private formatMarkdownForMedium(content: string): string {
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