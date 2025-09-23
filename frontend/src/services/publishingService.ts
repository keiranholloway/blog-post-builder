import { API_BASE_URL } from '../config/api';

export interface Platform {
  name: string;
  features: string[];
}

export interface PublishingCredentials {
  [key: string]: any;
}

export interface PublishingConfig {
  platform: string;
  credentials: PublishingCredentials;
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

export interface PublishRequest {
  contentId: string;
  platforms: string[];
  configs: Record<string, PublishingConfig>;
  imageUrl?: string;
}

export interface PublishResponse {
  success: boolean;
  results: Record<string, PublishResult>;
}

class PublishingService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${API_BASE_URL}/publishing`;
  }

  async getSupportedPlatforms(): Promise<Platform[]> {
    try {
      const response = await fetch(`${this.baseUrl}/platforms`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get platforms: ${response.statusText}`);
      }

      const data = await response.json();
      return data.platforms;
    } catch (error) {
      console.error('Error getting supported platforms:', error);
      throw error;
    }
  }

  async validateCredentials(platform: string, credentials: PublishingCredentials): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/validate-credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform,
          credentials,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to validate credentials: ${response.statusText}`);
      }

      const data = await response.json();
      return data.valid;
    } catch (error) {
      console.error('Error validating credentials:', error);
      throw error;
    }
  }

  async publishContent(request: PublishRequest): Promise<PublishResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to publish content: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error publishing content:', error);
      throw error;
    }
  }

  async getPublishingStatus(
    contentId: string,
    platform: string,
    platformId: string,
    config: PublishingConfig
  ): Promise<'published' | 'draft' | 'failed' | 'unknown'> {
    try {
      const response = await fetch(`${this.baseUrl}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId,
          platform,
          platformId,
          config,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get publishing status: ${response.statusText}`);
      }

      const data = await response.json();
      return data.status;
    } catch (error) {
      console.error('Error getting publishing status:', error);
      throw error;
    }
  }

  async getFormatPreview(
    contentId: string,
    platform: string,
    imageUrl?: string
  ): Promise<FormattedContent> {
    try {
      const response = await fetch(`${this.baseUrl}/format-preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId,
          platform,
          imageUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get format preview: ${response.statusText}`);
      }

      const data = await response.json();
      return data.formattedContent;
    } catch (error) {
      console.error('Error getting format preview:', error);
      throw error;
    }
  }

  async publishToMultiplePlatforms(
    contentId: string,
    platformConfigs: Map<string, PublishingConfig>,
    imageUrl?: string
  ): Promise<PublishResponse> {
    const platforms = Array.from(platformConfigs.keys());
    const configs = Object.fromEntries(platformConfigs);

    return this.publishContent({
      contentId,
      platforms,
      configs,
      imageUrl,
    });
  }

  async retryFailedPublishing(
    contentId: string,
    failedPlatforms: string[],
    platformConfigs: Map<string, PublishingConfig>,
    imageUrl?: string
  ): Promise<PublishResponse> {
    const configs = Object.fromEntries(
      Array.from(platformConfigs.entries()).filter(([platform]) =>
        failedPlatforms.includes(platform)
      )
    );

    return this.publishContent({
      contentId,
      platforms: failedPlatforms,
      configs,
      imageUrl,
    });
  }

  getPlatformDisplayName(platform: string): string {
    const displayNames: Record<string, string> = {
      medium: 'Medium',
      linkedin: 'LinkedIn',
      twitter: 'Twitter',
      dev: 'Dev.to',
      hashnode: 'Hashnode',
    };

    return displayNames[platform.toLowerCase()] || platform;
  }

  getPlatformIcon(platform: string): string {
    const icons: Record<string, string> = {
      medium: '📝',
      linkedin: '💼',
      twitter: '🐦',
      dev: '👩‍💻',
      hashnode: '#️⃣',
    };

    return icons[platform.toLowerCase()] || '📄';
  }

  formatPublishingError(error: string): string {
    // Format common API errors into user-friendly messages
    if (error.includes('401') || error.includes('unauthorized')) {
      return 'Authentication failed. Please check your credentials and try again.';
    }
    if (error.includes('403') || error.includes('forbidden')) {
      return 'Permission denied. Please check your account permissions.';
    }
    if (error.includes('429') || error.includes('rate limit')) {
      return 'Rate limit exceeded. Please wait a few minutes and try again.';
    }
    if (error.includes('500') || error.includes('internal server')) {
      return 'Server error occurred. Please try again later.';
    }
    if (error.includes('network') || error.includes('fetch')) {
      return 'Network error. Please check your connection and try again.';
    }

    return error;
  }
}

export const publishingService = new PublishingService();