import { APIGatewayProxyEvent, APIGatewayProxyResult, SQSEvent, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });

// Environment variables
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME!;
const IMAGE_BUCKET = process.env.IMAGE_BUCKET_NAME!;
const ORCHESTRATOR_QUEUE = process.env.ORCHESTRATOR_QUEUE_URL!;
const EVENT_BUS = process.env.EVENT_BUS_NAME!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

// Types for image generation
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
  dimensions: { width: number; height: number };
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

// CORS helper function
function getCorsHeaders(origin: string | undefined): Record<string, string> {
  const allowedOrigins = [
    'https://keiranholloway.github.io',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'false',
    'Content-Type': 'application/json',
  };
}

/**
 * Main handler for image generation agent - supports both API Gateway and SQS events
 */
export const handler = async (event: APIGatewayProxyEvent | SQSEvent, context?: Context): Promise<APIGatewayProxyResult | void> => {
  console.log('Image Generation Agent Event:', JSON.stringify(event, null, 2));

  // Check if this is an SQS event (agent communication)
  if ('Records' in event) {
    return handleSQSEvent(event as SQSEvent);
  }

  // Handle API Gateway event (direct API calls)
  return handleAPIGatewayEvent(event as APIGatewayProxyEvent);
};

/**
 * Handle SQS events from the orchestrator
 */
async function handleSQSEvent(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      console.log(`Processing message: ${message.messageType} for workflow ${message.workflowId}`);

      switch (message.messageType) {
        case 'request':
          await handleImageGenerationRequest(message.payload);
          break;
        
        case 'revision':
          await handleImageRevisionRequest(message.payload);
          break;
        
        default:
          console.warn(`Unknown message type: ${message.messageType}`);
      }

    } catch (error) {
      console.error('Error processing SQS record:', error);
      // Let the message go to DLQ for manual inspection
      throw error;
    }
  }
}

/**
 * Handle API Gateway events (direct API calls)
 */
async function handleAPIGatewayEvent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = getCorsHeaders(event.headers.origin);

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    if (path.includes('/generate') && method === 'POST') {
      return await handleDirectImageGeneration(event, corsHeaders);
    } else if (path.includes('/revise') && method === 'POST') {
      return await handleDirectImageRevision(event, corsHeaders);
    } else if (path.includes('/analyze') && method === 'POST') {
      return await handleContentAnalysis(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };

  } catch (error) {
    console.error('API Gateway error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

/**
 * Handle image generation request from orchestrator
 */
async function handleImageGenerationRequest(request: ImageGenerationRequest): Promise<void> {
  console.log(`Generating image for workflow ${request.workflowId}, content ${request.contentId}`);

  try {
    // Analyze content to determine appropriate image concepts
    const analysis = await analyzeContentForImageGeneration(request.content);
    
    // Use provided prompt or generate one from analysis
    const finalPrompt = request.prompt || analysis.suggestedPrompt;
    const finalStyle = request.style || analysis.suggestedStyle;

    // Generate image using MCP servers or fallback to OpenAI
    const imageResult = await generateImageWithMCP({
      prompt: finalPrompt,
      style: finalStyle,
      size: request.size || '1024x1024',
      quality: 'standard'
    });
    
    if (!imageResult.success) {
      throw new Error(imageResult.error || 'Image generation failed');
    }

    // Optimize and store the image
    const optimizedResult = await optimizeAndStoreImage(
      imageResult.imageUrl!,
      request.contentId,
      {
        originalSize: 0, // Will be calculated during optimization
        optimizedSize: 0,
        dimensions: { width: 1024, height: 1024 },
        format: 'webp',
        generatedAt: new Date().toISOString(),
        model: 'dall-e-3',
        prompt: finalPrompt,
        style: finalStyle
      }
    );

    // Send success response back to orchestrator
    await sendResponseToOrchestrator({
      workflowId: request.workflowId,
      stepId: request.stepId,
      messageType: 'response',
      payload: {
        success: true,
        imageUrl: optimizedResult.optimizedImageUrl,
        originalImageUrl: optimizedResult.imageUrl,
        metadata: optimizedResult.metadata,
        analysis: analysis,
      },
    });

    // Publish success event
    await publishEvent('Image Generation Completed', {
      workflowId: request.workflowId,
      stepId: request.stepId,
      contentId: request.contentId,
      imageUrl: optimizedResult.optimizedImageUrl,
      metadata: optimizedResult.metadata,
    });

    console.log(`Image generation completed for workflow ${request.workflowId}`);

  } catch (error) {
    console.error(`Image generation failed for workflow ${request.workflowId}:`, error);

    // Send error response back to orchestrator
    await sendResponseToOrchestrator({
      workflowId: request.workflowId,
      stepId: request.stepId,
      messageType: 'error',
      payload: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: isRetryableError(error),
      },
    });

    // Publish failure event
    await publishEvent('Image Generation Failed', {
      workflowId: request.workflowId,
      stepId: request.stepId,
      contentId: request.contentId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Handle image revision request from orchestrator
 */
async function handleImageRevisionRequest(request: ImageRevisionRequest): Promise<void> {
  console.log(`Processing image revision for workflow ${request.workflowId}`);

  try {
    // Generate revised prompt based on feedback
    const revisedPrompt = await generateRevisedPrompt(request.currentImageUrl, request.feedback, request.newPrompt);
    
    // Generate new image with revised prompt
    const imageResult = await generateImageWithMCP({
      prompt: revisedPrompt,
      size: '1024x1024',
      quality: 'standard'
    });
    
    if (!imageResult.success) {
      throw new Error(imageResult.error || 'Image revision failed');
    }

    // Optimize and store the revised image
    const optimizedResult = await optimizeAndStoreImage(
      imageResult.imageUrl!,
      request.contentId,
      {
        originalSize: 0,
        optimizedSize: 0,
        dimensions: { width: 1024, height: 1024 },
        format: 'webp',
        generatedAt: new Date().toISOString(),
        model: 'dall-e-3',
        prompt: revisedPrompt,
        style: 'revised'
      }
    );

    // Send success response back to orchestrator
    await sendResponseToOrchestrator({
      workflowId: request.workflowId,
      stepId: request.stepId,
      messageType: 'response',
      payload: {
        success: true,
        imageUrl: optimizedResult.optimizedImageUrl,
        originalImageUrl: optimizedResult.imageUrl,
        metadata: optimizedResult.metadata,
        feedback: request.feedback,
      },
    });

    console.log(`Image revision completed for workflow ${request.workflowId}`);

  } catch (error) {
    console.error(`Image revision failed for workflow ${request.workflowId}:`, error);

    // Send error response back to orchestrator
    await sendResponseToOrchestrator({
      workflowId: request.workflowId,
      stepId: request.stepId,
      messageType: 'error',
      payload: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: isRetryableError(error),
      },
    });
  }
}

/**
 * Generate image using MCP servers with fallback to OpenAI
 */
async function generateImageWithMCP(request: MCPImageRequest): Promise<ImageGenerationResponse> {
  try {
    // First try MCP servers (if configured)
    const mcpResult = await tryMCPImageGeneration(request);
    if (mcpResult.success) {
      return mcpResult;
    }

    console.log('MCP image generation failed, falling back to OpenAI');
    
    // Fallback to OpenAI DALL-E
    return await generateImageWithOpenAI(request);

  } catch (error) {
    console.error('Error in image generation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during image generation'
    };
  }
}

/**
 * Try to generate image using MCP servers
 */
async function tryMCPImageGeneration(request: MCPImageRequest): Promise<ImageGenerationResponse> {
  try {
    // This would integrate with actual MCP servers
    // For now, we'll simulate MCP server communication
    console.log('Attempting MCP image generation with prompt:', request.prompt);
    
    // In a real implementation, this would:
    // 1. Connect to configured MCP servers
    // 2. Send image generation request
    // 3. Handle the response
    
    // For now, return failure to trigger OpenAI fallback
    return {
      success: false,
      error: 'MCP servers not configured'
    };

  } catch (error) {
    console.error('MCP image generation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'MCP generation failed'
    };
  }
}

/**
 * Generate image using OpenAI DALL-E as fallback
 */
async function generateImageWithOpenAI(request: MCPImageRequest): Promise<ImageGenerationResponse> {
  try {
    if (!OPENAI_API_KEY) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: request.prompt,
        n: 1,
        size: request.size || '1024x1024',
        quality: request.quality || 'standard',
        response_format: 'url',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json() as any;
      return {
        success: false,
        error: `OpenAI API error: ${errorData.error?.message || 'Unknown error'}`
      };
    }

    const data = await response.json() as any;
    const imageUrl = data.data[0]?.url;

    if (!imageUrl) {
      return {
        success: false,
        error: 'No image URL returned from OpenAI'
      };
    }

    return {
      success: true,
      imageUrl: imageUrl
    };

  } catch (error) {
    console.error('Error generating image with OpenAI:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during OpenAI image generation'
    };
  }
}

/**
 * Analyze content to determine appropriate image concepts
 */
async function analyzeContentForImageGeneration(content: string): Promise<ContentAnalysisResult> {
  try {
    // Extract key concepts from content
    const concepts = extractKeyConceptsFromContent(content);
    
    // Determine tone and style
    const tone = determineToneFromContent(content);
    
    // Identify visual elements
    const visualElements = identifyVisualElements(content);
    
    // Generate suggested prompt
    const suggestedPrompt = generateImagePromptFromAnalysis(concepts, tone, visualElements);
    
    // Determine suggested style
    const suggestedStyle = determineStyleFromTone(tone);

    return {
      concepts,
      tone,
      visualElements,
      suggestedPrompt,
      suggestedStyle
    };

  } catch (error) {
    console.error('Error analyzing content for image generation:', error);
    
    // Return default analysis
    return {
      concepts: ['technology', 'innovation'],
      tone: 'professional',
      visualElements: ['abstract', 'modern'],
      suggestedPrompt: 'Professional illustration representing technology and innovation, modern abstract design',
      suggestedStyle: 'professional'
    };
  }
}

/**
 * Extract key concepts from blog content
 */
function extractKeyConceptsFromContent(content: string): string[] {
  const techTerms = [
    'aws', 'azure', 'gcp', 'cloud', 'kubernetes', 'docker', 'serverless',
    'devops', 'finops', 'infrastructure', 'architecture', 'security',
    'platform engineering', 'backstage', 'cost optimization', 'automation',
    'monitoring', 'observability', 'microservices', 'containers', 'ai',
    'machine learning', 'data', 'analytics', 'transformation', 'digital',
    'enterprise', 'scalability', 'performance', 'reliability', 'innovation'
  ];

  const contentLower = content.toLowerCase();
  const foundConcepts = techTerms.filter(term => 
    contentLower.includes(term.toLowerCase())
  );

  // Add general concepts if no specific tech terms found
  if (foundConcepts.length === 0) {
    foundConcepts.push('technology', 'business', 'innovation');
  }

  return foundConcepts.slice(0, 5); // Limit to top 5 concepts
}

/**
 * Determine tone from content
 */
function determineToneFromContent(content: string): string {
  const contentLower = content.toLowerCase();
  
  // Look for indicators of different tones
  if (contentLower.includes('enterprise') || contentLower.includes('business') || contentLower.includes('strategy')) {
    return 'professional';
  } else if (contentLower.includes('creative') || contentLower.includes('design') || contentLower.includes('art')) {
    return 'creative';
  } else if (contentLower.includes('technical') || contentLower.includes('architecture') || contentLower.includes('engineering')) {
    return 'technical';
  } else if (contentLower.includes('simple') || contentLower.includes('clean') || contentLower.includes('minimal')) {
    return 'minimal';
  }
  
  return 'professional'; // Default tone
}

/**
 * Identify visual elements from content
 */
function identifyVisualElements(content: string): string[] {
  const visualKeywords = {
    'abstract': ['concept', 'idea', 'theory', 'abstract'],
    'diagram': ['process', 'workflow', 'architecture', 'system'],
    'chart': ['data', 'metrics', 'analytics', 'performance'],
    'network': ['connection', 'integration', 'api', 'network'],
    'cloud': ['cloud', 'aws', 'azure', 'gcp'],
    'modern': ['modern', 'contemporary', 'current', 'latest'],
    'geometric': ['structure', 'framework', 'pattern', 'design']
  };

  const contentLower = content.toLowerCase();
  const elements: string[] = [];

  for (const [element, keywords] of Object.entries(visualKeywords)) {
    if (keywords.some(keyword => contentLower.includes(keyword))) {
      elements.push(element);
    }
  }

  return elements.length > 0 ? elements : ['abstract', 'modern'];
}

/**
 * Generate image prompt from analysis
 */
function generateImagePromptFromAnalysis(concepts: string[], tone: string, visualElements: string[]): string {
  const styleMap = {
    'professional': 'clean, modern, professional illustration',
    'creative': 'artistic, creative, vibrant illustration',
    'minimal': 'minimalist, simple, clean design',
    'technical': 'technical diagram, infographic style',
    'abstract': 'abstract, conceptual art'
  };

  const baseStyle = styleMap[tone as keyof typeof styleMap] || styleMap.professional;
  const conceptsText = concepts.slice(0, 3).join(', ');
  const elementsText = visualElements.slice(0, 2).join(' and ');

  return `${baseStyle} representing ${conceptsText}, featuring ${elementsText} elements, high quality, detailed, suitable for blog post header`;
}

/**
 * Determine style from tone
 */
function determineStyleFromTone(tone: string): string {
  const styleMap = {
    'professional': 'professional',
    'creative': 'creative',
    'minimal': 'minimal',
    'technical': 'technical'
  };

  return styleMap[tone as keyof typeof styleMap] || 'professional';
}

/**
 * Generate revised prompt based on feedback
 */
async function generateRevisedPrompt(currentImageUrl: string, feedback: string, newPrompt?: string): Promise<string> {
  if (newPrompt) {
    return newPrompt;
  }

  // Analyze feedback to determine what changes to make
  const feedbackLower = feedback.toLowerCase();
  let revisionInstructions = '';

  if (feedbackLower.includes('color') || feedbackLower.includes('bright') || feedbackLower.includes('vibrant')) {
    revisionInstructions += 'more colorful and vibrant, ';
  }
  
  if (feedbackLower.includes('simple') || feedbackLower.includes('minimal') || feedbackLower.includes('clean')) {
    revisionInstructions += 'simpler and more minimal, ';
  }
  
  if (feedbackLower.includes('professional') || feedbackLower.includes('business')) {
    revisionInstructions += 'more professional and business-oriented, ';
  }
  
  if (feedbackLower.includes('creative') || feedbackLower.includes('artistic')) {
    revisionInstructions += 'more creative and artistic, ';
  }

  // If no specific instructions found, use the feedback directly
  if (!revisionInstructions) {
    revisionInstructions = feedback + ', ';
  }

  return `Professional illustration with ${revisionInstructions}high quality, detailed, suitable for blog post`;
}

/**
 * Optimize and store image in S3
 */
async function optimizeAndStoreImage(imageUrl: string, contentId: string, metadata: ImageMetadata): Promise<{
  imageUrl: string;
  optimizedImageUrl: string;
  metadata: ImageMetadata;
}> {
  try {
    // Download the original image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const originalBuffer = await response.arrayBuffer();
    const originalSize = originalBuffer.byteLength;

    // Create optimized version using Sharp
    const optimizedBuffer = await sharp(Buffer.from(originalBuffer))
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const optimizedSize = optimizedBuffer.byteLength;

    // Store both original and optimized versions
    const timestamp = Date.now();
    const originalKey = `images/${contentId}/original-${timestamp}.png`;
    const optimizedKey = `images/${contentId}/optimized-${timestamp}.webp`;

    // Upload original image
    await s3Client.send(new PutObjectCommand({
      Bucket: IMAGE_BUCKET,
      Key: originalKey,
      Body: new Uint8Array(originalBuffer),
      ContentType: 'image/png',
      Metadata: {
        contentId: contentId,
        type: 'original',
        generatedAt: metadata.generatedAt,
        prompt: metadata.prompt
      }
    }));

    // Upload optimized image
    await s3Client.send(new PutObjectCommand({
      Bucket: IMAGE_BUCKET,
      Key: optimizedKey,
      Body: optimizedBuffer,
      ContentType: 'image/webp',
      Metadata: {
        contentId: contentId,
        type: 'optimized',
        generatedAt: metadata.generatedAt,
        prompt: metadata.prompt
      }
    }));

    // Get image dimensions
    const imageInfo = await sharp(Buffer.from(originalBuffer)).metadata();

    const finalMetadata: ImageMetadata = {
      ...metadata,
      originalSize,
      optimizedSize,
      dimensions: {
        width: imageInfo.width || 1024,
        height: imageInfo.height || 1024
      },
      format: 'webp'
    };

    return {
      imageUrl: `https://${IMAGE_BUCKET}.s3.amazonaws.com/${originalKey}`,
      optimizedImageUrl: `https://${IMAGE_BUCKET}.s3.amazonaws.com/${optimizedKey}`,
      metadata: finalMetadata
    };

  } catch (error) {
    console.error('Error optimizing and storing image:', error);
    throw error;
  }
}

/**
 * Handle direct image generation API call
 */
async function handleDirectImageGeneration(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const request = JSON.parse(event.body);
    
    if (!request.contentId || !request.prompt) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'contentId and prompt are required' }),
      };
    }

    // Generate image directly
    const imageResult = await generateImageWithMCP({
      prompt: request.prompt,
      style: request.style,
      size: request.size || '1024x1024',
      quality: 'standard'
    });
    
    if (!imageResult.success) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: imageResult.error }),
      };
    }

    // Optimize and store the image
    const optimizedResult = await optimizeAndStoreImage(
      imageResult.imageUrl!,
      request.contentId,
      {
        originalSize: 0,
        optimizedSize: 0,
        dimensions: { width: 1024, height: 1024 },
        format: 'webp',
        generatedAt: new Date().toISOString(),
        model: 'dall-e-3',
        prompt: request.prompt,
        style: request.style || 'professional'
      }
    );

    // Update content record
    await updateContentWithImage(request.contentId, optimizedResult.optimizedImageUrl);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        imageUrl: optimizedResult.optimizedImageUrl,
        originalImageUrl: optimizedResult.imageUrl,
        metadata: optimizedResult.metadata
      }),
    };

  } catch (error) {
    console.error('Direct image generation error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error during image generation',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

/**
 * Handle direct image revision API call
 */
async function handleDirectImageRevision(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const request = JSON.parse(event.body);
    
    if (!request.contentId || !request.feedback) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'contentId and feedback are required' }),
      };
    }

    // Generate revised prompt
    const revisedPrompt = await generateRevisedPrompt(
      request.currentImageUrl || '',
      request.feedback,
      request.newPrompt
    );

    // Generate new image
    const imageResult = await generateImageWithMCP({
      prompt: revisedPrompt,
      size: '1024x1024',
      quality: 'standard'
    });
    
    if (!imageResult.success) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: imageResult.error }),
      };
    }

    // Optimize and store the revised image
    const optimizedResult = await optimizeAndStoreImage(
      imageResult.imageUrl!,
      request.contentId,
      {
        originalSize: 0,
        optimizedSize: 0,
        dimensions: { width: 1024, height: 1024 },
        format: 'webp',
        generatedAt: new Date().toISOString(),
        model: 'dall-e-3',
        prompt: revisedPrompt,
        style: 'revised'
      }
    );

    // Update content record
    await updateContentWithImage(request.contentId, optimizedResult.optimizedImageUrl);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        imageUrl: optimizedResult.optimizedImageUrl,
        originalImageUrl: optimizedResult.imageUrl,
        metadata: optimizedResult.metadata
      }),
    };

  } catch (error) {
    console.error('Direct image revision error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error during image revision',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

/**
 * Handle content analysis for image generation
 */
async function handleContentAnalysis(event: APIGatewayProxyEvent, corsHeaders: Record<string, string>): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const request = JSON.parse(event.body);
    
    if (!request.content) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'content is required' }),
      };
    }

    // Analyze content for image generation
    const analysis = await analyzeContentForImageGeneration(request.content);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        prompt: analysis.suggestedPrompt,
        style: analysis.suggestedStyle,
        concepts: analysis.concepts,
        tone: analysis.tone,
        visualElements: analysis.visualElements
      }),
    };

  } catch (error) {
    console.error('Content analysis error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error during content analysis',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

/**
 * Send response back to orchestrator
 */
async function sendResponseToOrchestrator(response: {
  workflowId: string;
  stepId: string;
  messageType: 'response' | 'error';
  payload: any;
}): Promise<void> {
  const message = {
    messageId: uuidv4(),
    workflowId: response.workflowId,
    stepId: response.stepId,
    agentType: 'image-generator',
    messageType: response.messageType,
    payload: response.payload,
    timestamp: new Date().toISOString(),
  };

  await sqsClient.send(new SendMessageCommand({
    QueueUrl: ORCHESTRATOR_QUEUE,
    MessageBody: JSON.stringify(message),
    MessageAttributes: {
      workflowId: {
        StringValue: response.workflowId,
        DataType: 'String',
      },
      stepId: {
        StringValue: response.stepId,
        DataType: 'String',
      },
      agentType: {
        StringValue: 'image-generator',
        DataType: 'String',
      },
    },
  }));
}

/**
 * Publish event to EventBridge
 */
async function publishEvent(eventType: string, detail: any): Promise<void> {
  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      Source: 'automated-blog-poster.image-agent',
      DetailType: eventType,
      Detail: JSON.stringify(detail),
      EventBusName: EVENT_BUS,
    }],
  }));
}

/**
 * Update content status in DynamoDB
 */
async function updateContentStatus(contentId: string, status: string, error?: string): Promise<void> {
  const updateExpression = error 
    ? 'SET #status = :status, #error = :error, #updatedAt = :updatedAt'
    : 'SET #status = :status, #updatedAt = :updatedAt';
    
  const expressionAttributeValues = error
    ? { ':status': status, ':error': error, ':updatedAt': new Date().toISOString() }
    : { ':status': status, ':updatedAt': new Date().toISOString() };

  await docClient.send(new UpdateCommand({
    TableName: CONTENT_TABLE,
    Key: { id: contentId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      ...(error && { '#error': 'error' })
    },
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

/**
 * Update content record with image URL
 */
async function updateContentWithImage(contentId: string, imageUrl: string): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: CONTENT_TABLE,
    Key: { id: contentId },
    UpdateExpression: 'SET #imageUrl = :imageUrl, #status = :status, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#imageUrl': 'imageUrl',
      '#status': 'status',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':imageUrl': imageUrl,
      ':status': 'image_generated',
      ':updatedAt': new Date().toISOString(),
    },
  }));
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(error: any): boolean {
  // Network errors, timeouts, and temporary service issues are retryable
  if (error.code === 'NetworkingError' || error.code === 'TimeoutError') {
    return true;
  }

  // Rate limiting errors are retryable
  if (error.statusCode === 429) {
    return true;
  }

  // Server errors (5xx) are generally retryable
  if (error.statusCode >= 500) {
    return true;
  }

  // Client errors (4xx) are generally not retryable
  return false;
}

// Export types for testing
export type {
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageRevisionRequest,
  ImageMetadata,
  ContentAnalysisResult,
  MCPImageRequest
};