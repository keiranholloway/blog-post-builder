import { APIGatewayProxyEvent, APIGatewayProxyResult, SQSEvent, Context } from 'aws-lambda';
interface ImageGenerationRequest {
    workflowId: string;
    stepId: string;
    contentId: string;
    content: string;
    prompt?: string;
    style?: 'professional' | 'creative' | 'minimal' | 'technical' | 'abstract';
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    userId: string;
}
interface ImageGenerationResponse {
    success: boolean;
    imageUrl?: string;
    optimizedImageUrl?: string;
    metadata?: ImageMetadata;
    error?: string;
}
interface ImageRevisionRequest {
    workflowId: string;
    stepId: string;
    contentId: string;
    currentImageUrl: string;
    feedback: string;
    newPrompt?: string;
    userId: string;
}
interface ImageMetadata {
    originalSize: number;
    optimizedSize: number;
    dimensions: {
        width: number;
        height: number;
    };
    format: string;
    generatedAt: string;
    model: string;
    prompt: string;
    style: string;
}
interface ContentAnalysisResult {
    concepts: string[];
    tone: string;
    visualElements: string[];
    suggestedPrompt: string;
    suggestedStyle: string;
}
interface MCPImageRequest {
    prompt: string;
    style?: string;
    size?: string;
    quality?: 'standard' | 'hd';
}
/**
 * Main handler for image generation agent - supports both API Gateway and SQS events
 */
export declare const handler: (event: APIGatewayProxyEvent | SQSEvent, context?: Context) => Promise<APIGatewayProxyResult | void>;
export type { ImageGenerationRequest, ImageGenerationResponse, ImageRevisionRequest, ImageMetadata, ContentAnalysisResult, MCPImageRequest };
