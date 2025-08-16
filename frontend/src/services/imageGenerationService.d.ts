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
declare class ImageGenerationService {
    private baseUrl;
    constructor();
    /**
     * Generate an image for blog content
     */
    generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse>;
    /**
     * Get image generation status
     */
    getImageStatus(contentId: string): Promise<ImageGenerationStatus>;
    /**
     * Request image revision with feedback
     */
    requestImageRevision(contentId: string, feedback: string, newPrompt?: string): Promise<ImageGenerationResponse>;
    /**
     * Analyze content to generate appropriate image prompt
     */
    analyzeContentForImage(content: string): Promise<{
        prompt: string;
        style?: string;
    }>;
    /**
     * Poll for image generation status with timeout
     */
    pollImageStatus(contentId: string, timeoutMs?: number, intervalMs?: number): Promise<ImageGenerationStatus>;
    /**
     * Generate image prompt from blog content
     */
    generateImagePrompt(title: string, content: string, style?: string): string;
}
export declare const imageGenerationService: ImageGenerationService;
export {};
