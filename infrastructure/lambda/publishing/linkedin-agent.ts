import { BasePublishingAgent, PublishingConfig, PublishResult, FormattedContent } from './base-publishing-agent';
import { BlogContent } from '../../../frontend/src/types/BlogContent';

interface LinkedInCredentials {
  accessToken: string;
  personUrn?: string;
}

interface LinkedInPost {
  author: string;
  lifecycleState: 'PUBLISHED' | 'DRAFT';
  specificContent: {
    'com.linkedin.ugc.ShareContent': {
      shareCommentary: {
        text: string;
      };
      shareMediaCategory: 'NONE' | 'IMAGE' | 'VIDEO' | 'ARTICLE';
      media?: Array<{
        status: 'READY';
        description: {
          text: string;
        };
        media: string;
        title: {
          text: string;
        };
      }>;
    };
  };
  visibility: {
    'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' | 'CONNECTIONS';
  };
}

interface LinkedInPublishResponse {
  id: string;
  activity: string;
}

export class LinkedInPublishingAgent extends BasePublishingAgent {
  readonly platformName = 'LinkedIn';
  readonly supportedFeatures = ['images', 'professional-formatting', 'hashtags', 'mentions'];

  private readonly baseUrl = 'https://api.linkedin.com/v2';

  async validateCredentials(credentials: Record<string, any>): Promise<boolean> {
    try {
      this.validateRequiredCredentials(credentials, ['accessToken']);
      const linkedInCreds = credentials as LinkedInCredentials;
      
      // Validate token by fetching user profile
      const response = await fetch(`${this.baseUrl}/people/~`, {
        headers: {
          'Authorization': `Bearer ${linkedInCreds.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.ok;
    } catch (error) {
      console.error('LinkedIn credential validation failed:', error);
      return false;
    }
  }

  async formatContent(content: BlogContent, imageUrl?: string): Promise<FormattedContent> {
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
      } else if (line.length > 10 && line.length < 100 && !line.includes('.')) {
        title = line;
        body = lines.slice(i + 1).join('\n').trim();
        break;
      }
    }

    // Format content for LinkedIn's professional context
    const formattedBody = this.formatForLinkedIn(body);
    const tags = this.extractTags(formattedBody);

    return {
      title: title.substring(0, 200), // LinkedIn title limit
      body: formattedBody.substring(0, 3000), // LinkedIn post limit
      tags: tags.slice(0, 10), // Reasonable hashtag limit
      imageUrl,
      metadata: {
        visibility: 'PUBLIC',
        lifecycleState: 'PUBLISHED'
      }
    };
  }

  async publish(formattedContent: FormattedContent, config: PublishingConfig): Promise<PublishResult> {
    try {
      const credentials = config.credentials as LinkedInCredentials;
      
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

      const postData: LinkedInPost = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: (formattedContent.metadata?.lifecycleState as 'PUBLISHED' | 'DRAFT') || 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: postText
            },
            shareMediaCategory: formattedContent.imageUrl ? 'IMAGE' : 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': (formattedContent.metadata?.visibility as 'PUBLIC' | 'CONNECTIONS') || 'PUBLIC'
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
          media: 'urn:li:digitalmediaAsset:placeholder', // Would be actual media URN
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

      const result: LinkedInPublishResponse = await response.json();

      return {
        success: true,
        platformUrl: `https://www.linkedin.com/feed/update/${result.activity}`,
        platformId: result.id,
        metadata: {
          activity: result.activity,
          personUrn
        }
      };
    } catch (error) {
      console.error('LinkedIn publishing failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async getPublishingStatus(platformId: string, config: PublishingConfig): Promise<'published' | 'draft' | 'failed' | 'unknown'> {
    try {
      const credentials = config.credentials as LinkedInCredentials;
      
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
    } catch (error) {
      console.error('Failed to get LinkedIn post status:', error);
      return 'unknown';
    }
  }

  private formatForLinkedIn(content: string): string {
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