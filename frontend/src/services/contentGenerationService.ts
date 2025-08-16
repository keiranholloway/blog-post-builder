import { ContentGenerationPayload, ContentRevisionPayload, AgentMessage } from '../types/AgentMessage';
import { BlogContent } from '../types/BlogContent';

export interface ContentGenerationRequest {
  transcription: string;
  userId: string;
  userContext?: string;
  preferences?: UserContentPreferences;
}

export interface UserContentPreferences {
  tone?: 'professional' | 'casual' | 'technical' | 'conversational';
  length?: 'short' | 'medium' | 'long';
  targetAudience?: string;
  writingStyle?: string;
  topics?: string[];
}

export interface ContentRevisionRequest {
  contentId: string;
  currentContent: string;
  feedback: string;
  revisionType: 'content' | 'style' | 'structure' | 'tone';
  userId: string;
}

export interface ContentGenerationStatus {
  contentId: string;
  status: 'processing' | 'completed' | 'failed' | 'revision_requested';
  progress?: number;
  currentStep?: string;
  estimatedTimeRemaining?: number;
  error?: string;
}

export interface GeneratedContent {
  title: string;
  content: string;
  summary: string;
  wordCount: number;
  readingTime: number;
  tags: string[];
  quality: {
    score: number;
    issues: string[];
    suggestions: string[];
  };
}

class ContentGenerationService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = (import.meta as any).env?.VITE_API_BASE_URL || '/api';
  }

  /**
   * Initiate content generation from transcription
   */
  async generateContent(request: ContentGenerationRequest): Promise<{ contentId: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/content/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcription: request.transcription,
          userId: request.userId,
          userContext: request.userContext,
          preferences: request.preferences || this.getDefaultPreferences(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return { contentId: data.data.contentId };

    } catch (error) {
      console.error('Error initiating content generation:', error);
      throw new Error(
        error instanceof Error 
          ? error.message 
          : 'Failed to initiate content generation'
      );
    }
  }

  /**
   * Request content revision with feedback
   */
  async requestRevision(request: ContentRevisionRequest): Promise<{ revisionId: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/content/revise`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return { revisionId: data.data.revisionId };

    } catch (error) {
      console.error('Error requesting content revision:', error);
      throw new Error(
        error instanceof Error 
          ? error.message 
          : 'Failed to request content revision'
      );
    }
  }

  /**
   * Get content generation status
   */
  async getContentStatus(contentId: string): Promise<ContentGenerationStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/content/status/${contentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;

    } catch (error) {
      console.error('Error getting content status:', error);
      throw new Error(
        error instanceof Error 
          ? error.message 
          : 'Failed to get content status'
      );
    }
  }

  /**
   * Get generated content by ID
   */
  async getGeneratedContent(contentId: string): Promise<BlogContent> {
    try {
      const response = await fetch(`${this.baseUrl}/content/${contentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const response_data = await response.json();
      const data = response_data.data;
      
      // Transform API response to BlogContent type
      return {
        id: data.id,
        userId: data.userId,
        title: data.title,
        originalTranscription: data.originalTranscription,
        currentDraft: data.currentDraft,
        associatedImage: data.associatedImage,
        imageUrl: data.imageUrl,
        status: data.status,
        revisionHistory: data.revisionHistory || [],
        publishingResults: data.publishingResults || [],
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

    } catch (error) {
      console.error('Error getting generated content:', error);
      throw new Error(
        error instanceof Error 
          ? error.message 
          : 'Failed to get generated content'
      );
    }
  }

  /**
   * Get agent messages for a content item
   */
  async getAgentMessages(contentId: string): Promise<AgentMessage[]> {
    try {
      const response = await fetch(`${this.baseUrl}/content/${contentId}/messages`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const response_data = await response.json();
      const data = response_data.data;
      
      // Transform API response to AgentMessage type
      return data.messages.map((msg: any) => ({
        id: msg.id,
        contentId: msg.contentId,
        agentType: msg.agentType,
        messageType: msg.messageType,
        payload: msg.payload,
        status: msg.status,
        error: msg.error,
        result: msg.result,
        createdAt: new Date(msg.createdAt),
        processedAt: msg.processedAt ? new Date(msg.processedAt) : undefined,
      }));

    } catch (error) {
      console.error('Error getting agent messages:', error);
      throw new Error(
        error instanceof Error 
          ? error.message 
          : 'Failed to get agent messages'
      );
    }
  }

  /**
   * Validate content quality
   */
  async validateContent(content: string): Promise<{
    isValid: boolean;
    score: number;
    issues: string[];
    suggestions: string[];
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/content/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data;

    } catch (error) {
      console.error('Error validating content:', error);
      throw new Error(
        error instanceof Error 
          ? error.message 
          : 'Failed to validate content'
      );
    }
  }

  /**
   * Poll for content status updates
   */
  async pollContentStatus(
    contentId: string,
    onUpdate: (status: ContentGenerationStatus) => void,
    intervalMs: number = 2000,
    maxAttempts: number = 150 // 5 minutes with 2-second intervals
  ): Promise<ContentGenerationStatus> {
    let attempts = 0;

    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          attempts++;
          const status = await this.getContentStatus(contentId);
          
          onUpdate(status);

          if (status.status === 'completed' || status.status === 'failed') {
            resolve(status);
            return;
          }

          if (attempts >= maxAttempts) {
            reject(new Error('Polling timeout: Content generation took too long'));
            return;
          }

          setTimeout(poll, intervalMs);

        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }

  /**
   * Get default user preferences
   */
  private getDefaultPreferences(): UserContentPreferences {
    return {
      tone: 'conversational',
      length: 'medium',
      targetAudience: 'general audience',
      writingStyle: 'clear and engaging',
      topics: [],
    };
  }

  /**
   * Create content generation payload for agent message
   */
  createContentGenerationPayload(
    transcription: string,
    userContext: string,
    writingStyle: string
  ): ContentGenerationPayload {
    return {
      transcription,
      userContext,
      writingStyle,
    };
  }

  /**
   * Create content revision payload for agent message
   */
  createContentRevisionPayload(
    currentContent: string,
    feedback: string,
    userContext: string
  ): ContentRevisionPayload {
    return {
      currentContent,
      feedback,
      userContext,
    };
  }
}

// Export singleton instance
export const contentGenerationService = new ContentGenerationService();
export default contentGenerationService;