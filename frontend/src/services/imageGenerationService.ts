import { API_BASE_URL } from '../config/api';

export interface ImageGenerationRequest {
  contentId: string;
  prompt: string;
  style?: string;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
}

export interface ImageGenerationResponse {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

export interface ImageGenerationStatus {
  contentId: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  imageUrl?: string;
  error?: string;
  progress?: number;
}

class ImageGenerationService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  /**
   * Generate an image for blog content
   */
  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/image/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error generating image:', error);
      throw error;
    }
  }

  /**
   * Get image generation status
   */
  async getImageStatus(contentId: string): Promise<ImageGenerationStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/api/image/status/${contentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting image status:', error);
      throw error;
    }
  }

  /**
   * Request image revision with feedback
   */
  async requestImageRevision(contentId: string, feedback: string, newPrompt?: string): Promise<ImageGenerationResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/image/revise`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId,
          feedback,
          newPrompt,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error requesting image revision:', error);
      throw error;
    }
  }

  /**
   * Analyze content to generate appropriate image prompt
   */
  async analyzeContentForImage(content: string): Promise<{ prompt: string; style?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/image/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error analyzing content for image:', error);
      throw error;
    }
  }

  /**
   * Poll for image generation status with timeout
   */
  async pollImageStatus(
    contentId: string, 
    timeoutMs: number = 60000,
    intervalMs: number = 2000
  ): Promise<ImageGenerationStatus> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getImageStatus(contentId);
      
      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }
      
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    throw new Error('Image generation timeout');
  }

  /**
   * Generate image prompt from blog content
   */
  generateImagePrompt(title: string, content: string, style: string = 'professional'): string {
    // Extract key themes and concepts from the content
    const words = content.toLowerCase().split(/\s+/);
    const keyWords = words.filter(word => 
      word.length > 4 && 
      !['that', 'this', 'with', 'from', 'they', 'have', 'will', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other'].includes(word)
    );
    
    // Take first few key concepts
    const concepts = keyWords.slice(0, 3).join(', ');
    
    const stylePrompts = {
      professional: 'clean, modern, professional illustration',
      creative: 'artistic, creative, vibrant illustration',
      minimal: 'minimalist, simple, clean design',
      technical: 'technical diagram, infographic style',
      abstract: 'abstract, conceptual art'
    };
    
    const selectedStyle = stylePrompts[style as keyof typeof stylePrompts] || stylePrompts.professional;
    
    return `${selectedStyle} representing ${title}, featuring ${concepts}, high quality, detailed`;
  }
}

export const imageGenerationService = new ImageGenerationService();