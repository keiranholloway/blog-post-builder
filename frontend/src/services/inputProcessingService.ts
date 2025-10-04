// Input Processing Service
// Handles communication with the input processing Lambda function

// Removed PWA dependencies for basic functionality

export interface AudioUploadRequest {
  audioData: string; // Base64 encoded audio
  contentType: string;
  userId: string;
}

export interface TextInputRequest {
  text: string;
  userId: string;
}

export interface InputProcessingResult {
  id: string;
  userId: string;
  type: 'audio' | 'text';
  status: 'processing' | 'completed' | 'failed';
  originalInput?: string;
  transcription?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T = any> {
  message: string;
  data?: T;
}

export interface ApiError {
  error: string;
  message: string;
  requestId?: string;
}

class InputProcessingService {
  private baseUrl: string;

  constructor() {
    // Use the deployed API URL
    this.baseUrl = import.meta.env.VITE_API_URL || 'https://fqz86w2yp5.execute-api.eu-west-1.amazonaws.com/prod';
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const config: RequestInit = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        const error = data as ApiError;
        throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Upload and process audio file
   */
  async processAudio(audioBlob: Blob, userId: string): Promise<ApiResponse<{ inputId: string; status: string }>> {
    // Simplified - always process immediately (removed offline support for now)

    // Convert blob to base64
    const audioData = await this.blobToBase64(audioBlob);
    
    const request: AudioUploadRequest = {
      audioData: audioData.split(',')[1], // Remove data:audio/webm;base64, prefix
      contentType: audioBlob.type,
      userId,
    };

    return this.makeRequest<ApiResponse<{ inputId: string; status: string }>>(
      '/api/input/audio',
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );
  }

  /**
   * Process text input
   */
  async processText(text: string, userId: string): Promise<ApiResponse<{ inputId: string; status: string; transcription: string }>> {
    // Simplified - always process immediately (removed offline support for now)

    const request: TextInputRequest = {
      text,
      userId,
    };

    return this.makeRequest<ApiResponse<{ inputId: string; status: string; transcription: string }>>(
      '/api/input/text',
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );
  }

  /**
   * Get processing status
   */
  async getStatus(inputId: string): Promise<ApiResponse<InputProcessingResult>> {
    return this.makeRequest<ApiResponse<InputProcessingResult>>(
      `/api/input/status/${inputId}`,
      {
        method: 'GET',
      }
    );
  }

  /**
   * Poll for completion with timeout
   */
  async waitForCompletion(
    inputId: string,
    timeoutMs: number = 60000,
    pollIntervalMs: number = 2000
  ): Promise<InputProcessingResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await this.getStatus(inputId);
        const result = response.data;

        if (!result) {
          throw new Error('No data returned from status check');
        }

        if (result.status === 'completed') {
          return result;
        }

        if (result.status === 'failed') {
          throw new Error(result.error || 'Processing failed');
        }

        // Still processing, wait before next poll
        await this.delay(pollIntervalMs);
      } catch (error) {
        console.error('Error polling for completion:', error);
        throw error;
      }
    }

    throw new Error('Processing timeout exceeded');
  }

  /**
   * Convert Blob to base64 string
   */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Utility function to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate audio file before processing
   */
  validateAudioFile(blob: Blob): { isValid: boolean; error?: string } {
    // Check file size (500 bytes to 25MB) - reduced minimum for better compatibility
    const minSize = 500; // 500 bytes
    const maxSize = 25 * 1024 * 1024; // 25MB

    if (blob.size < minSize) {
      return {
        isValid: false,
        error: `Audio file too small (${blob.size} bytes). Minimum size: ${minSize} bytes. Please record for at least 2-3 seconds.`,
      };
    }

    if (blob.size > maxSize) {
      return {
        isValid: false,
        error: `Audio file too large (${blob.size} bytes). Maximum size: ${maxSize} bytes`,
      };
    }

    // Check supported formats
    const supportedTypes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/mp4'];
    if (!supportedTypes.includes(blob.type)) {
      return {
        isValid: false,
        error: `Unsupported audio format: ${blob.type}. Supported formats: ${supportedTypes.join(', ')}`,
      };
    }

    return { isValid: true };
  }

  /**
   * Validate text input before processing
   */
  validateTextInput(text: string): { isValid: boolean; error?: string } {
    if (!text || text.trim().length === 0) {
      return {
        isValid: false,
        error: 'Text cannot be empty',
      };
    }

    if (text.length > 10000) {
      return {
        isValid: false,
        error: 'Text must be no more than 10,000 characters long',
      };
    }

    return { isValid: true };
  }
}

// Export singleton instance
export const inputProcessingService = new InputProcessingService();
export default inputProcessingService;