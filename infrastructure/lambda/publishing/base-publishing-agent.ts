import { BlogContent } from '../../../frontend/src/types/BlogContent';

export interface PublishingConfig {
  platform: string;
  credentials: Record<string, any>;
  formatOptions?: Record<string, any>;
}

export interface PublishResult {
  success: boolean;
  platformUrl?: string;
  platformId?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface FormattedContent {
  title: string;
  body: string;
  tags?: string[];
  imageUrl?: string;
  metadata?: Record<string, any>;
}

export interface PublishingAgent {
  readonly platformName: string;
  readonly supportedFeatures: string[];
  
  validateCredentials(credentials: Record<string, any>): Promise<boolean>;
  formatContent(content: BlogContent, imageUrl?: string): Promise<FormattedContent>;
  publish(formattedContent: FormattedContent, config: PublishingConfig): Promise<PublishResult>;
  getPublishingStatus(platformId: string, config: PublishingConfig): Promise<'published' | 'draft' | 'failed' | 'unknown'>;
}

export abstract class BasePublishingAgent implements PublishingAgent {
  abstract readonly platformName: string;
  abstract readonly supportedFeatures: string[];

  abstract validateCredentials(credentials: Record<string, any>): Promise<boolean>;
  abstract formatContent(content: BlogContent, imageUrl?: string): Promise<FormattedContent>;
  abstract publish(formattedContent: FormattedContent, config: PublishingConfig): Promise<PublishResult>;
  abstract getPublishingStatus(platformId: string, config: PublishingConfig): Promise<'published' | 'draft' | 'failed' | 'unknown'>;

  protected validateRequiredCredentials(credentials: Record<string, any>, requiredFields: string[]): void {
    for (const field of requiredFields) {
      if (!credentials[field]) {
        throw new Error(`Missing required credential: ${field}`);
      }
    }
  }

  protected sanitizeContent(content: string): string {
    // Remove potentially harmful content and normalize formatting
    return content
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
      .trim();
  }

  protected extractTags(content: string): string[] {
    // Extract hashtags from content
    const tagRegex = /#(\w+)/g;
    const tags: string[] = [];
    let match;
    
    while ((match = tagRegex.exec(content)) !== null) {
      tags.push(match[1]);
    }
    
    return [...new Set(tags)]; // Remove duplicates
  }

  protected formatImageForPlatform(imageUrl: string, platformRequirements: { maxWidth?: number; maxHeight?: number; format?: string }): string {
    // In a real implementation, this would handle image resizing and format conversion
    // For now, return the original URL
    return imageUrl;
  }
}