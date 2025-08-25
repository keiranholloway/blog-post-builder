"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const node_fetch_1 = __importDefault(require("node-fetch"));
const uuid_1 = require("uuid");
const sharp_1 = __importDefault(require("sharp"));
// Initialize AWS clients
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
const sqsClient = new client_sqs_1.SQSClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({ region: process.env.AWS_REGION });
// Environment variables
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME;
const IMAGE_BUCKET = process.env.IMAGE_BUCKET_NAME;
const ORCHESTRATOR_QUEUE = process.env.ORCHESTRATOR_QUEUE_URL;
const EVENT_BUS = process.env.EVENT_BUS_NAME;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// CORS helper function
function getCorsHeaders(origin) {
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
const handler = async (event, context) => {
    console.log('Image Generation Agent Event:', JSON.stringify(event, null, 2));
    // Check if this is an SQS event (agent communication)
    if ('Records' in event) {
        return handleSQSEvent(event);
    }
    // Handle API Gateway event (direct API calls)
    return handleAPIGatewayEvent(event);
};
exports.handler = handler;
/**
 * Handle SQS events from the orchestrator
 */
async function handleSQSEvent(event) {
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
        }
        catch (error) {
            console.error('Error processing SQS record:', error);
            // Let the message go to DLQ for manual inspection
            throw error;
        }
    }
}
/**
 * Handle API Gateway events (direct API calls)
 */
async function handleAPIGatewayEvent(event) {
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
        }
        else if (path.includes('/revise') && method === 'POST') {
            return await handleDirectImageRevision(event, corsHeaders);
        }
        else if (path.includes('/analyze') && method === 'POST') {
            return await handleContentAnalysis(event, corsHeaders);
        }
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Endpoint not found' }),
        };
    }
    catch (error) {
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
async function handleImageGenerationRequest(request) {
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
        const optimizedResult = await optimizeAndStoreImage(imageResult.imageUrl, request.contentId, {
            originalSize: 0,
            optimizedSize: 0,
            dimensions: { width: 1024, height: 1024 },
            format: 'webp',
            generatedAt: new Date().toISOString(),
            model: 'dall-e-3',
            prompt: finalPrompt,
            style: finalStyle
        });
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
    }
    catch (error) {
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
async function handleImageRevisionRequest(request) {
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
        const optimizedResult = await optimizeAndStoreImage(imageResult.imageUrl, request.contentId, {
            originalSize: 0,
            optimizedSize: 0,
            dimensions: { width: 1024, height: 1024 },
            format: 'webp',
            generatedAt: new Date().toISOString(),
            model: 'dall-e-3',
            prompt: revisedPrompt,
            style: 'revised'
        });
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
    }
    catch (error) {
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
async function generateImageWithMCP(request) {
    try {
        // First try MCP servers (if configured)
        const mcpResult = await tryMCPImageGeneration(request);
        if (mcpResult.success) {
            return mcpResult;
        }
        console.log('MCP image generation failed, falling back to OpenAI');
        // Fallback to OpenAI DALL-E
        return await generateImageWithOpenAI(request);
    }
    catch (error) {
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
async function tryMCPImageGeneration(request) {
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
    }
    catch (error) {
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
async function generateImageWithOpenAI(request) {
    try {
        if (!OPENAI_API_KEY) {
            return {
                success: false,
                error: 'OpenAI API key not configured'
            };
        }
        const response = await (0, node_fetch_1.default)('https://api.openai.com/v1/images/generations', {
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
            const errorData = await response.json();
            return {
                success: false,
                error: `OpenAI API error: ${errorData.error?.message || 'Unknown error'}`
            };
        }
        const data = await response.json();
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
    }
    catch (error) {
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
async function analyzeContentForImageGeneration(content) {
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
    }
    catch (error) {
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
function extractKeyConceptsFromContent(content) {
    const techTerms = [
        'aws', 'azure', 'gcp', 'cloud', 'kubernetes', 'docker', 'serverless',
        'devops', 'finops', 'infrastructure', 'architecture', 'security',
        'platform engineering', 'backstage', 'cost optimization', 'automation',
        'monitoring', 'observability', 'microservices', 'containers', 'ai',
        'machine learning', 'data', 'analytics', 'transformation', 'digital',
        'enterprise', 'scalability', 'performance', 'reliability', 'innovation'
    ];
    const contentLower = content.toLowerCase();
    const foundConcepts = techTerms.filter(term => contentLower.includes(term.toLowerCase()));
    // Add general concepts if no specific tech terms found
    if (foundConcepts.length === 0) {
        foundConcepts.push('technology', 'business', 'innovation');
    }
    return foundConcepts.slice(0, 5); // Limit to top 5 concepts
}
/**
 * Determine tone from content
 */
function determineToneFromContent(content) {
    const contentLower = content.toLowerCase();
    // Look for indicators of different tones
    if (contentLower.includes('enterprise') || contentLower.includes('business') || contentLower.includes('strategy')) {
        return 'professional';
    }
    else if (contentLower.includes('creative') || contentLower.includes('design') || contentLower.includes('art')) {
        return 'creative';
    }
    else if (contentLower.includes('technical') || contentLower.includes('architecture') || contentLower.includes('engineering')) {
        return 'technical';
    }
    else if (contentLower.includes('simple') || contentLower.includes('clean') || contentLower.includes('minimal')) {
        return 'minimal';
    }
    return 'professional'; // Default tone
}
/**
 * Identify visual elements from content
 */
function identifyVisualElements(content) {
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
    const elements = [];
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
function generateImagePromptFromAnalysis(concepts, tone, visualElements) {
    const styleMap = {
        'professional': 'clean, modern, professional illustration',
        'creative': 'artistic, creative, vibrant illustration',
        'minimal': 'minimalist, simple, clean design',
        'technical': 'technical diagram, infographic style',
        'abstract': 'abstract, conceptual art'
    };
    const baseStyle = styleMap[tone] || styleMap.professional;
    const conceptsText = concepts.slice(0, 3).join(', ');
    const elementsText = visualElements.slice(0, 2).join(' and ');
    return `${baseStyle} representing ${conceptsText}, featuring ${elementsText} elements, high quality, detailed, suitable for blog post header`;
}
/**
 * Determine style from tone
 */
function determineStyleFromTone(tone) {
    const styleMap = {
        'professional': 'professional',
        'creative': 'creative',
        'minimal': 'minimal',
        'technical': 'technical'
    };
    return styleMap[tone] || 'professional';
}
/**
 * Generate revised prompt based on feedback
 */
async function generateRevisedPrompt(currentImageUrl, feedback, newPrompt) {
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
async function optimizeAndStoreImage(imageUrl, contentId, metadata) {
    try {
        // Download the original image
        const response = await (0, node_fetch_1.default)(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.statusText}`);
        }
        const originalBuffer = await response.arrayBuffer();
        const originalSize = originalBuffer.byteLength;
        // Create optimized version using Sharp
        const optimizedBuffer = await (0, sharp_1.default)(Buffer.from(originalBuffer))
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
        const optimizedSize = optimizedBuffer.byteLength;
        // Store both original and optimized versions
        const timestamp = Date.now();
        const originalKey = `images/${contentId}/original-${timestamp}.png`;
        const optimizedKey = `images/${contentId}/optimized-${timestamp}.webp`;
        // Upload original image
        await s3Client.send(new client_s3_1.PutObjectCommand({
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
        await s3Client.send(new client_s3_1.PutObjectCommand({
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
        const imageInfo = await (0, sharp_1.default)(Buffer.from(originalBuffer)).metadata();
        const finalMetadata = {
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
    }
    catch (error) {
        console.error('Error optimizing and storing image:', error);
        throw error;
    }
}
/**
 * Handle direct image generation API call
 */
async function handleDirectImageGeneration(event, corsHeaders) {
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
        const optimizedResult = await optimizeAndStoreImage(imageResult.imageUrl, request.contentId, {
            originalSize: 0,
            optimizedSize: 0,
            dimensions: { width: 1024, height: 1024 },
            format: 'webp',
            generatedAt: new Date().toISOString(),
            model: 'dall-e-3',
            prompt: request.prompt,
            style: request.style || 'professional'
        });
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
    }
    catch (error) {
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
async function handleDirectImageRevision(event, corsHeaders) {
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
        const revisedPrompt = await generateRevisedPrompt(request.currentImageUrl || '', request.feedback, request.newPrompt);
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
        const optimizedResult = await optimizeAndStoreImage(imageResult.imageUrl, request.contentId, {
            originalSize: 0,
            optimizedSize: 0,
            dimensions: { width: 1024, height: 1024 },
            format: 'webp',
            generatedAt: new Date().toISOString(),
            model: 'dall-e-3',
            prompt: revisedPrompt,
            style: 'revised'
        });
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
    }
    catch (error) {
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
async function handleContentAnalysis(event, corsHeaders) {
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
    }
    catch (error) {
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
async function sendResponseToOrchestrator(response) {
    const message = {
        messageId: (0, uuid_1.v4)(),
        workflowId: response.workflowId,
        stepId: response.stepId,
        agentType: 'image-generator',
        messageType: response.messageType,
        payload: response.payload,
        timestamp: new Date().toISOString(),
    };
    await sqsClient.send(new client_sqs_1.SendMessageCommand({
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
async function publishEvent(eventType, detail) {
    await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
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
async function updateContentStatus(contentId, status, error) {
    const updateExpression = error
        ? 'SET #status = :status, #error = :error, #updatedAt = :updatedAt'
        : 'SET #status = :status, #updatedAt = :updatedAt';
    const expressionAttributeValues = error
        ? { ':status': status, ':error': error, ':updatedAt': new Date().toISOString() }
        : { ':status': status, ':updatedAt': new Date().toISOString() };
    await docClient.send(new lib_dynamodb_1.UpdateCommand({
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
async function updateContentWithImage(contentId, imageUrl) {
    await docClient.send(new lib_dynamodb_1.UpdateCommand({
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
function isRetryableError(error) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImltYWdlLWdlbmVyYXRpb24tYWdlbnQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUEwRjtBQUMxRixrREFBa0Y7QUFDbEYsb0RBQW9FO0FBQ3BFLG9FQUFrRjtBQUNsRiw0REFBK0I7QUFDL0IsK0JBQW9DO0FBQ3BDLGtEQUEwQjtBQUUxQix5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDNUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQkFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUNsRSxNQUFNLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBQ3BFLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxzQ0FBaUIsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFFcEYsd0JBQXdCO0FBQ3hCLE1BQU0sYUFBYSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQW1CLENBQUM7QUFDdEQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBa0IsQ0FBQztBQUNwRCxNQUFNLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXVCLENBQUM7QUFDL0QsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFlLENBQUM7QUFDOUMsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFlLENBQUM7QUEwRG5ELHVCQUF1QjtBQUN2QixTQUFTLGNBQWMsQ0FBQyxNQUEwQjtJQUNoRCxNQUFNLGNBQWMsR0FBRztRQUNyQixrQ0FBa0M7UUFDbEMsdUJBQXVCO1FBQ3ZCLHVCQUF1QjtLQUN4QixDQUFDO0lBRUYsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRTdGLE9BQU87UUFDTCw2QkFBNkIsRUFBRSxhQUFhO1FBQzVDLDhCQUE4QixFQUFFLHVGQUF1RjtRQUN2SCw4QkFBOEIsRUFBRSw2QkFBNkI7UUFDN0Qsa0NBQWtDLEVBQUUsT0FBTztRQUMzQyxjQUFjLEVBQUUsa0JBQWtCO0tBQ25DLENBQUM7QUFDSixDQUFDO0FBRUQ7O0dBRUc7QUFDSSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBc0MsRUFBRSxPQUFpQixFQUF5QyxFQUFFO0lBQ2hJLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0JBQStCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFN0Usc0RBQXNEO0lBQ3RELElBQUksU0FBUyxJQUFJLEtBQUssRUFBRTtRQUN0QixPQUFPLGNBQWMsQ0FBQyxLQUFpQixDQUFDLENBQUM7S0FDMUM7SUFFRCw4Q0FBOEM7SUFDOUMsT0FBTyxxQkFBcUIsQ0FBQyxLQUE2QixDQUFDLENBQUM7QUFDOUQsQ0FBQyxDQUFDO0FBVlcsUUFBQSxPQUFPLFdBVWxCO0FBRUY7O0dBRUc7QUFDSCxLQUFLLFVBQVUsY0FBYyxDQUFDLEtBQWU7SUFDM0MsS0FBSyxNQUFNLE1BQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFO1FBQ2xDLElBQUk7WUFDRixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUN4QyxPQUFPLENBQUMsR0FBRyxDQUFDLHVCQUF1QixPQUFPLENBQUMsV0FBVyxpQkFBaUIsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7WUFFN0YsUUFBUSxPQUFPLENBQUMsV0FBVyxFQUFFO2dCQUMzQixLQUFLLFNBQVM7b0JBQ1osTUFBTSw0QkFBNEIsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7b0JBQ3BELE1BQU07Z0JBRVIsS0FBSyxVQUFVO29CQUNiLE1BQU0sMEJBQTBCLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO29CQUNsRCxNQUFNO2dCQUVSO29CQUNFLE9BQU8sQ0FBQyxJQUFJLENBQUMseUJBQXlCLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO2FBQ2hFO1NBRUY7UUFBQyxPQUFPLEtBQUssRUFBRTtZQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDckQsa0RBQWtEO1lBQ2xELE1BQU0sS0FBSyxDQUFDO1NBQ2I7S0FDRjtBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSxxQkFBcUIsQ0FBQyxLQUEyQjtJQUM5RCxNQUFNLFdBQVcsR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUV6RCw0QkFBNEI7SUFDNUIsSUFBSSxLQUFLLENBQUMsVUFBVSxLQUFLLFNBQVMsRUFBRTtRQUNsQyxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsRUFBRTtTQUNULENBQUM7S0FDSDtJQUVELElBQUk7UUFDRixNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDO1FBQ3hCLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUM7UUFFaEMsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxJQUFJLE1BQU0sS0FBSyxNQUFNLEVBQUU7WUFDbkQsT0FBTyxNQUFNLDJCQUEyQixDQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQztTQUM5RDthQUFNLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxNQUFNLEtBQUssTUFBTSxFQUFFO1lBQ3hELE9BQU8sTUFBTSx5QkFBeUIsQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDNUQ7YUFBTSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksTUFBTSxLQUFLLE1BQU0sRUFBRTtZQUN6RCxPQUFPLE1BQU0scUJBQXFCLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQ3hEO1FBRUQsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsb0JBQW9CLEVBQUUsQ0FBQztTQUN0RCxDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDM0MsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlO2FBQ2xFLENBQUM7U0FDSCxDQUFDO0tBQ0g7QUFDSCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxLQUFLLFVBQVUsNEJBQTRCLENBQUMsT0FBK0I7SUFDekUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQ0FBaUMsT0FBTyxDQUFDLFVBQVUsYUFBYSxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUVqRyxJQUFJO1FBQ0YsMERBQTBEO1FBQzFELE1BQU0sUUFBUSxHQUFHLE1BQU0sZ0NBQWdDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRXpFLG9EQUFvRDtRQUNwRCxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsTUFBTSxJQUFJLFFBQVEsQ0FBQyxlQUFlLENBQUM7UUFDL0QsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEtBQUssSUFBSSxRQUFRLENBQUMsY0FBYyxDQUFDO1FBRTVELHlEQUF5RDtRQUN6RCxNQUFNLFdBQVcsR0FBRyxNQUFNLG9CQUFvQixDQUFDO1lBQzdDLE1BQU0sRUFBRSxXQUFXO1lBQ25CLEtBQUssRUFBRSxVQUFVO1lBQ2pCLElBQUksRUFBRSxPQUFPLENBQUMsSUFBSSxJQUFJLFdBQVc7WUFDakMsT0FBTyxFQUFFLFVBQVU7U0FDcEIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUU7WUFDeEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxXQUFXLENBQUMsS0FBSyxJQUFJLHlCQUF5QixDQUFDLENBQUM7U0FDakU7UUFFRCwrQkFBK0I7UUFDL0IsTUFBTSxlQUFlLEdBQUcsTUFBTSxxQkFBcUIsQ0FDakQsV0FBVyxDQUFDLFFBQVMsRUFDckIsT0FBTyxDQUFDLFNBQVMsRUFDakI7WUFDRSxZQUFZLEVBQUUsQ0FBQztZQUNmLGFBQWEsRUFBRSxDQUFDO1lBQ2hCLFVBQVUsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRTtZQUN6QyxNQUFNLEVBQUUsTUFBTTtZQUNkLFdBQVcsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtZQUNyQyxLQUFLLEVBQUUsVUFBVTtZQUNqQixNQUFNLEVBQUUsV0FBVztZQUNuQixLQUFLLEVBQUUsVUFBVTtTQUNsQixDQUNGLENBQUM7UUFFRiw2Q0FBNkM7UUFDN0MsTUFBTSwwQkFBMEIsQ0FBQztZQUMvQixVQUFVLEVBQUUsT0FBTyxDQUFDLFVBQVU7WUFDOUIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNO1lBQ3RCLFdBQVcsRUFBRSxVQUFVO1lBQ3ZCLE9BQU8sRUFBRTtnQkFDUCxPQUFPLEVBQUUsSUFBSTtnQkFDYixRQUFRLEVBQUUsZUFBZSxDQUFDLGlCQUFpQjtnQkFDM0MsZ0JBQWdCLEVBQUUsZUFBZSxDQUFDLFFBQVE7Z0JBQzFDLFFBQVEsRUFBRSxlQUFlLENBQUMsUUFBUTtnQkFDbEMsUUFBUSxFQUFFLFFBQVE7YUFDbkI7U0FDRixDQUFDLENBQUM7UUFFSCx3QkFBd0I7UUFDeEIsTUFBTSxZQUFZLENBQUMsNEJBQTRCLEVBQUU7WUFDL0MsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO1lBQzlCLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtZQUN0QixTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVM7WUFDNUIsUUFBUSxFQUFFLGVBQWUsQ0FBQyxpQkFBaUI7WUFDM0MsUUFBUSxFQUFFLGVBQWUsQ0FBQyxRQUFRO1NBQ25DLENBQUMsQ0FBQztRQUVILE9BQU8sQ0FBQyxHQUFHLENBQUMsMkNBQTJDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0tBRTlFO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLHdDQUF3QyxPQUFPLENBQUMsVUFBVSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFcEYsMkNBQTJDO1FBQzNDLE1BQU0sMEJBQTBCLENBQUM7WUFDL0IsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO1lBQzlCLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtZQUN0QixXQUFXLEVBQUUsT0FBTztZQUNwQixPQUFPLEVBQUU7Z0JBQ1AsT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7Z0JBQy9ELFNBQVMsRUFBRSxnQkFBZ0IsQ0FBQyxLQUFLLENBQUM7YUFDbkM7U0FDRixDQUFDLENBQUM7UUFFSCx3QkFBd0I7UUFDeEIsTUFBTSxZQUFZLENBQUMseUJBQXlCLEVBQUU7WUFDNUMsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO1lBQzlCLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtZQUN0QixTQUFTLEVBQUUsT0FBTyxDQUFDLFNBQVM7WUFDNUIsS0FBSyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7U0FDaEUsQ0FBQyxDQUFDO0tBQ0o7QUFDSCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxLQUFLLFVBQVUsMEJBQTBCLENBQUMsT0FBNkI7SUFDckUsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQ0FBMEMsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFFNUUsSUFBSTtRQUNGLDRDQUE0QztRQUM1QyxNQUFNLGFBQWEsR0FBRyxNQUFNLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxlQUFlLEVBQUUsT0FBTyxDQUFDLFFBQVEsRUFBRSxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFaEgseUNBQXlDO1FBQ3pDLE1BQU0sV0FBVyxHQUFHLE1BQU0sb0JBQW9CLENBQUM7WUFDN0MsTUFBTSxFQUFFLGFBQWE7WUFDckIsSUFBSSxFQUFFLFdBQVc7WUFDakIsT0FBTyxFQUFFLFVBQVU7U0FDcEIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUU7WUFDeEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxXQUFXLENBQUMsS0FBSyxJQUFJLHVCQUF1QixDQUFDLENBQUM7U0FDL0Q7UUFFRCx1Q0FBdUM7UUFDdkMsTUFBTSxlQUFlLEdBQUcsTUFBTSxxQkFBcUIsQ0FDakQsV0FBVyxDQUFDLFFBQVMsRUFDckIsT0FBTyxDQUFDLFNBQVMsRUFDakI7WUFDRSxZQUFZLEVBQUUsQ0FBQztZQUNmLGFBQWEsRUFBRSxDQUFDO1lBQ2hCLFVBQVUsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRTtZQUN6QyxNQUFNLEVBQUUsTUFBTTtZQUNkLFdBQVcsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtZQUNyQyxLQUFLLEVBQUUsVUFBVTtZQUNqQixNQUFNLEVBQUUsYUFBYTtZQUNyQixLQUFLLEVBQUUsU0FBUztTQUNqQixDQUNGLENBQUM7UUFFRiw2Q0FBNkM7UUFDN0MsTUFBTSwwQkFBMEIsQ0FBQztZQUMvQixVQUFVLEVBQUUsT0FBTyxDQUFDLFVBQVU7WUFDOUIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNO1lBQ3RCLFdBQVcsRUFBRSxVQUFVO1lBQ3ZCLE9BQU8sRUFBRTtnQkFDUCxPQUFPLEVBQUUsSUFBSTtnQkFDYixRQUFRLEVBQUUsZUFBZSxDQUFDLGlCQUFpQjtnQkFDM0MsZ0JBQWdCLEVBQUUsZUFBZSxDQUFDLFFBQVE7Z0JBQzFDLFFBQVEsRUFBRSxlQUFlLENBQUMsUUFBUTtnQkFDbEMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRO2FBQzNCO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7S0FFNUU7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsc0NBQXNDLE9BQU8sQ0FBQyxVQUFVLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUVsRiwyQ0FBMkM7UUFDM0MsTUFBTSwwQkFBMEIsQ0FBQztZQUMvQixVQUFVLEVBQUUsT0FBTyxDQUFDLFVBQVU7WUFDOUIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNO1lBQ3RCLFdBQVcsRUFBRSxPQUFPO1lBQ3BCLE9BQU8sRUFBRTtnQkFDUCxPQUFPLEVBQUUsS0FBSztnQkFDZCxLQUFLLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtnQkFDL0QsU0FBUyxFQUFFLGdCQUFnQixDQUFDLEtBQUssQ0FBQzthQUNuQztTQUNGLENBQUMsQ0FBQztLQUNKO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLG9CQUFvQixDQUFDLE9BQXdCO0lBQzFELElBQUk7UUFDRix3Q0FBd0M7UUFDeEMsTUFBTSxTQUFTLEdBQUcsTUFBTSxxQkFBcUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN2RCxJQUFJLFNBQVMsQ0FBQyxPQUFPLEVBQUU7WUFDckIsT0FBTyxTQUFTLENBQUM7U0FDbEI7UUFFRCxPQUFPLENBQUMsR0FBRyxDQUFDLHFEQUFxRCxDQUFDLENBQUM7UUFFbkUsNEJBQTRCO1FBQzVCLE9BQU8sTUFBTSx1QkFBdUIsQ0FBQyxPQUFPLENBQUMsQ0FBQztLQUUvQztJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ2QsT0FBTyxDQUFDLEtBQUssQ0FBQyw0QkFBNEIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNuRCxPQUFPO1lBQ0wsT0FBTyxFQUFFLEtBQUs7WUFDZCxLQUFLLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsdUNBQXVDO1NBQ3hGLENBQUM7S0FDSDtBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSxxQkFBcUIsQ0FBQyxPQUF3QjtJQUMzRCxJQUFJO1FBQ0YsK0NBQStDO1FBQy9DLG1EQUFtRDtRQUNuRCxPQUFPLENBQUMsR0FBRyxDQUFDLDhDQUE4QyxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUU1RSx3Q0FBd0M7UUFDeEMsdUNBQXVDO1FBQ3ZDLG1DQUFtQztRQUNuQyx5QkFBeUI7UUFFekIscURBQXFEO1FBQ3JELE9BQU87WUFDTCxPQUFPLEVBQUUsS0FBSztZQUNkLEtBQUssRUFBRSw0QkFBNEI7U0FDcEMsQ0FBQztLQUVIO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLDZCQUE2QixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3BELE9BQU87WUFDTCxPQUFPLEVBQUUsS0FBSztZQUNkLEtBQUssRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyx1QkFBdUI7U0FDeEUsQ0FBQztLQUNIO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLHVCQUF1QixDQUFDLE9BQXdCO0lBQzdELElBQUk7UUFDRixJQUFJLENBQUMsY0FBYyxFQUFFO1lBQ25CLE9BQU87Z0JBQ0wsT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLCtCQUErQjthQUN2QyxDQUFDO1NBQ0g7UUFFRCxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUEsb0JBQUssRUFBQyw4Q0FBOEMsRUFBRTtZQUMzRSxNQUFNLEVBQUUsTUFBTTtZQUNkLE9BQU8sRUFBRTtnQkFDUCxlQUFlLEVBQUUsVUFBVSxjQUFjLEVBQUU7Z0JBQzNDLGNBQWMsRUFBRSxrQkFBa0I7YUFDbkM7WUFDRCxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsS0FBSyxFQUFFLFVBQVU7Z0JBQ2pCLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtnQkFDdEIsQ0FBQyxFQUFFLENBQUM7Z0JBQ0osSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLElBQUksV0FBVztnQkFDakMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPLElBQUksVUFBVTtnQkFDdEMsZUFBZSxFQUFFLEtBQUs7YUFDdkIsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFO1lBQ2hCLE1BQU0sU0FBUyxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBUyxDQUFDO1lBQy9DLE9BQU87Z0JBQ0wsT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLHFCQUFxQixTQUFTLENBQUMsS0FBSyxFQUFFLE9BQU8sSUFBSSxlQUFlLEVBQUU7YUFDMUUsQ0FBQztTQUNIO1FBRUQsTUFBTSxJQUFJLEdBQUcsTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFTLENBQUM7UUFDMUMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUM7UUFFbkMsSUFBSSxDQUFDLFFBQVEsRUFBRTtZQUNiLE9BQU87Z0JBQ0wsT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLG1DQUFtQzthQUMzQyxDQUFDO1NBQ0g7UUFFRCxPQUFPO1lBQ0wsT0FBTyxFQUFFLElBQUk7WUFDYixRQUFRLEVBQUUsUUFBUTtTQUNuQixDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMscUNBQXFDLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDNUQsT0FBTztZQUNMLE9BQU8sRUFBRSxLQUFLO1lBQ2QsS0FBSyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLDhDQUE4QztTQUMvRixDQUFDO0tBQ0g7QUFDSCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxLQUFLLFVBQVUsZ0NBQWdDLENBQUMsT0FBZTtJQUM3RCxJQUFJO1FBQ0Ysb0NBQW9DO1FBQ3BDLE1BQU0sUUFBUSxHQUFHLDZCQUE2QixDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRXhELDJCQUEyQjtRQUMzQixNQUFNLElBQUksR0FBRyx3QkFBd0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUUvQywyQkFBMkI7UUFDM0IsTUFBTSxjQUFjLEdBQUcsc0JBQXNCLENBQUMsT0FBTyxDQUFDLENBQUM7UUFFdkQsNEJBQTRCO1FBQzVCLE1BQU0sZUFBZSxHQUFHLCtCQUErQixDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsY0FBYyxDQUFDLENBQUM7UUFFeEYsNEJBQTRCO1FBQzVCLE1BQU0sY0FBYyxHQUFHLHNCQUFzQixDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXBELE9BQU87WUFDTCxRQUFRO1lBQ1IsSUFBSTtZQUNKLGNBQWM7WUFDZCxlQUFlO1lBQ2YsY0FBYztTQUNmLENBQUM7S0FFSDtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ2QsT0FBTyxDQUFDLEtBQUssQ0FBQywrQ0FBK0MsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV0RSwwQkFBMEI7UUFDMUIsT0FBTztZQUNMLFFBQVEsRUFBRSxDQUFDLFlBQVksRUFBRSxZQUFZLENBQUM7WUFDdEMsSUFBSSxFQUFFLGNBQWM7WUFDcEIsY0FBYyxFQUFFLENBQUMsVUFBVSxFQUFFLFFBQVEsQ0FBQztZQUN0QyxlQUFlLEVBQUUsMEZBQTBGO1lBQzNHLGNBQWMsRUFBRSxjQUFjO1NBQy9CLENBQUM7S0FDSDtBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsNkJBQTZCLENBQUMsT0FBZTtJQUNwRCxNQUFNLFNBQVMsR0FBRztRQUNoQixLQUFLLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRSxZQUFZO1FBQ3BFLFFBQVEsRUFBRSxRQUFRLEVBQUUsZ0JBQWdCLEVBQUUsY0FBYyxFQUFFLFVBQVU7UUFDaEUsc0JBQXNCLEVBQUUsV0FBVyxFQUFFLG1CQUFtQixFQUFFLFlBQVk7UUFDdEUsWUFBWSxFQUFFLGVBQWUsRUFBRSxlQUFlLEVBQUUsWUFBWSxFQUFFLElBQUk7UUFDbEUsa0JBQWtCLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxnQkFBZ0IsRUFBRSxTQUFTO1FBQ3BFLFlBQVksRUFBRSxhQUFhLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBRSxZQUFZO0tBQ3hFLENBQUM7SUFFRixNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDM0MsTUFBTSxhQUFhLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUM1QyxZQUFZLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUMxQyxDQUFDO0lBRUYsdURBQXVEO0lBQ3ZELElBQUksYUFBYSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7UUFDOUIsYUFBYSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsVUFBVSxFQUFFLFlBQVksQ0FBQyxDQUFDO0tBQzVEO0lBRUQsT0FBTyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLDBCQUEwQjtBQUM5RCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLHdCQUF3QixDQUFDLE9BQWU7SUFDL0MsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRTNDLHlDQUF5QztJQUN6QyxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLElBQUksWUFBWSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1FBQ2pILE9BQU8sY0FBYyxDQUFDO0tBQ3ZCO1NBQU0sSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksWUFBWSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRTtRQUMvRyxPQUFPLFVBQVUsQ0FBQztLQUNuQjtTQUFNLElBQUksWUFBWSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUU7UUFDOUgsT0FBTyxXQUFXLENBQUM7S0FDcEI7U0FBTSxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksWUFBWSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxFQUFFO1FBQ2hILE9BQU8sU0FBUyxDQUFDO0tBQ2xCO0lBRUQsT0FBTyxjQUFjLENBQUMsQ0FBQyxlQUFlO0FBQ3hDLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsc0JBQXNCLENBQUMsT0FBZTtJQUM3QyxNQUFNLGNBQWMsR0FBRztRQUNyQixVQUFVLEVBQUUsQ0FBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxVQUFVLENBQUM7UUFDckQsU0FBUyxFQUFFLENBQUMsU0FBUyxFQUFFLFVBQVUsRUFBRSxjQUFjLEVBQUUsUUFBUSxDQUFDO1FBQzVELE9BQU8sRUFBRSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFFLGFBQWEsQ0FBQztRQUN4RCxTQUFTLEVBQUUsQ0FBQyxZQUFZLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxTQUFTLENBQUM7UUFDMUQsT0FBTyxFQUFFLENBQUMsT0FBTyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDO1FBQ3pDLFFBQVEsRUFBRSxDQUFDLFFBQVEsRUFBRSxjQUFjLEVBQUUsU0FBUyxFQUFFLFFBQVEsQ0FBQztRQUN6RCxXQUFXLEVBQUUsQ0FBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxRQUFRLENBQUM7S0FDN0QsQ0FBQztJQUVGLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUMzQyxNQUFNLFFBQVEsR0FBYSxFQUFFLENBQUM7SUFFOUIsS0FBSyxNQUFNLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLEVBQUU7UUFDaEUsSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUFFO1lBQzVELFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7U0FDeEI7S0FDRjtJQUVELE9BQU8sUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLENBQUM7QUFDakUsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUywrQkFBK0IsQ0FBQyxRQUFrQixFQUFFLElBQVksRUFBRSxjQUF3QjtJQUNqRyxNQUFNLFFBQVEsR0FBRztRQUNmLGNBQWMsRUFBRSwwQ0FBMEM7UUFDMUQsVUFBVSxFQUFFLDBDQUEwQztRQUN0RCxTQUFTLEVBQUUsa0NBQWtDO1FBQzdDLFdBQVcsRUFBRSxzQ0FBc0M7UUFDbkQsVUFBVSxFQUFFLDBCQUEwQjtLQUN2QyxDQUFDO0lBRUYsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLElBQTZCLENBQUMsSUFBSSxRQUFRLENBQUMsWUFBWSxDQUFDO0lBQ25GLE1BQU0sWUFBWSxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNyRCxNQUFNLFlBQVksR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7SUFFOUQsT0FBTyxHQUFHLFNBQVMsaUJBQWlCLFlBQVksZUFBZSxZQUFZLGtFQUFrRSxDQUFDO0FBQ2hKLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsc0JBQXNCLENBQUMsSUFBWTtJQUMxQyxNQUFNLFFBQVEsR0FBRztRQUNmLGNBQWMsRUFBRSxjQUFjO1FBQzlCLFVBQVUsRUFBRSxVQUFVO1FBQ3RCLFNBQVMsRUFBRSxTQUFTO1FBQ3BCLFdBQVcsRUFBRSxXQUFXO0tBQ3pCLENBQUM7SUFFRixPQUFPLFFBQVEsQ0FBQyxJQUE2QixDQUFDLElBQUksY0FBYyxDQUFDO0FBQ25FLENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSxxQkFBcUIsQ0FBQyxlQUF1QixFQUFFLFFBQWdCLEVBQUUsU0FBa0I7SUFDaEcsSUFBSSxTQUFTLEVBQUU7UUFDYixPQUFPLFNBQVMsQ0FBQztLQUNsQjtJQUVELHFEQUFxRDtJQUNyRCxNQUFNLGFBQWEsR0FBRyxRQUFRLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDN0MsSUFBSSxvQkFBb0IsR0FBRyxFQUFFLENBQUM7SUFFOUIsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsRUFBRTtRQUM1RyxvQkFBb0IsSUFBSSw2QkFBNkIsQ0FBQztLQUN2RDtJQUVELElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUU7UUFDNUcsb0JBQW9CLElBQUksNEJBQTRCLENBQUM7S0FDdEQ7SUFFRCxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBRTtRQUNoRixvQkFBb0IsSUFBSSwyQ0FBMkMsQ0FBQztLQUNyRTtJQUVELElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1FBQzVFLG9CQUFvQixJQUFJLDhCQUE4QixDQUFDO0tBQ3hEO0lBRUQsK0RBQStEO0lBQy9ELElBQUksQ0FBQyxvQkFBb0IsRUFBRTtRQUN6QixvQkFBb0IsR0FBRyxRQUFRLEdBQUcsSUFBSSxDQUFDO0tBQ3hDO0lBRUQsT0FBTyxrQ0FBa0Msb0JBQW9CLGdEQUFnRCxDQUFDO0FBQ2hILENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSxxQkFBcUIsQ0FBQyxRQUFnQixFQUFFLFNBQWlCLEVBQUUsUUFBdUI7SUFLL0YsSUFBSTtRQUNGLDhCQUE4QjtRQUM5QixNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUEsb0JBQUssRUFBQyxRQUFRLENBQUMsQ0FBQztRQUN2QyxJQUFJLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRTtZQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixRQUFRLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztTQUNyRTtRQUVELE1BQU0sY0FBYyxHQUFHLE1BQU0sUUFBUSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ3BELE1BQU0sWUFBWSxHQUFHLGNBQWMsQ0FBQyxVQUFVLENBQUM7UUFFL0MsdUNBQXVDO1FBQ3ZDLE1BQU0sZUFBZSxHQUFHLE1BQU0sSUFBQSxlQUFLLEVBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQzthQUM3RCxNQUFNLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsa0JBQWtCLEVBQUUsSUFBSSxFQUFFLENBQUM7YUFDL0QsSUFBSSxDQUFDLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRSxDQUFDO2FBQ3JCLFFBQVEsRUFBRSxDQUFDO1FBRWQsTUFBTSxhQUFhLEdBQUcsZUFBZSxDQUFDLFVBQVUsQ0FBQztRQUVqRCw2Q0FBNkM7UUFDN0MsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzdCLE1BQU0sV0FBVyxHQUFHLFVBQVUsU0FBUyxhQUFhLFNBQVMsTUFBTSxDQUFDO1FBQ3BFLE1BQU0sWUFBWSxHQUFHLFVBQVUsU0FBUyxjQUFjLFNBQVMsT0FBTyxDQUFDO1FBRXZFLHdCQUF3QjtRQUN4QixNQUFNLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSw0QkFBZ0IsQ0FBQztZQUN2QyxNQUFNLEVBQUUsWUFBWTtZQUNwQixHQUFHLEVBQUUsV0FBVztZQUNoQixJQUFJLEVBQUUsSUFBSSxVQUFVLENBQUMsY0FBYyxDQUFDO1lBQ3BDLFdBQVcsRUFBRSxXQUFXO1lBQ3hCLFFBQVEsRUFBRTtnQkFDUixTQUFTLEVBQUUsU0FBUztnQkFDcEIsSUFBSSxFQUFFLFVBQVU7Z0JBQ2hCLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVztnQkFDakMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxNQUFNO2FBQ3hCO1NBQ0YsQ0FBQyxDQUFDLENBQUM7UUFFSix5QkFBeUI7UUFDekIsTUFBTSxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksNEJBQWdCLENBQUM7WUFDdkMsTUFBTSxFQUFFLFlBQVk7WUFDcEIsR0FBRyxFQUFFLFlBQVk7WUFDakIsSUFBSSxFQUFFLGVBQWU7WUFDckIsV0FBVyxFQUFFLFlBQVk7WUFDekIsUUFBUSxFQUFFO2dCQUNSLFNBQVMsRUFBRSxTQUFTO2dCQUNwQixJQUFJLEVBQUUsV0FBVztnQkFDakIsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXO2dCQUNqQyxNQUFNLEVBQUUsUUFBUSxDQUFDLE1BQU07YUFDeEI7U0FDRixDQUFDLENBQUMsQ0FBQztRQUVKLHVCQUF1QjtRQUN2QixNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUEsZUFBSyxFQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUV0RSxNQUFNLGFBQWEsR0FBa0I7WUFDbkMsR0FBRyxRQUFRO1lBQ1gsWUFBWTtZQUNaLGFBQWE7WUFDYixVQUFVLEVBQUU7Z0JBQ1YsS0FBSyxFQUFFLFNBQVMsQ0FBQyxLQUFLLElBQUksSUFBSTtnQkFDOUIsTUFBTSxFQUFFLFNBQVMsQ0FBQyxNQUFNLElBQUksSUFBSTthQUNqQztZQUNELE1BQU0sRUFBRSxNQUFNO1NBQ2YsQ0FBQztRQUVGLE9BQU87WUFDTCxRQUFRLEVBQUUsV0FBVyxZQUFZLHFCQUFxQixXQUFXLEVBQUU7WUFDbkUsaUJBQWlCLEVBQUUsV0FBVyxZQUFZLHFCQUFxQixZQUFZLEVBQUU7WUFDN0UsUUFBUSxFQUFFLGFBQWE7U0FDeEIsQ0FBQztLQUVIO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLHFDQUFxQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzVELE1BQU0sS0FBSyxDQUFDO0tBQ2I7QUFDSCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxLQUFLLFVBQVUsMkJBQTJCLENBQUMsS0FBMkIsRUFBRSxXQUFtQztJQUN6RyxJQUFJO1FBQ0YsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUU7WUFDZixPQUFPO2dCQUNMLFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSwwQkFBMEIsRUFBRSxDQUFDO2FBQzVELENBQUM7U0FDSDtRQUVELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXZDLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRTtZQUN6QyxPQUFPO2dCQUNMLFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxtQ0FBbUMsRUFBRSxDQUFDO2FBQ3JFLENBQUM7U0FDSDtRQUVELDBCQUEwQjtRQUMxQixNQUFNLFdBQVcsR0FBRyxNQUFNLG9CQUFvQixDQUFDO1lBQzdDLE1BQU0sRUFBRSxPQUFPLENBQUMsTUFBTTtZQUN0QixLQUFLLEVBQUUsT0FBTyxDQUFDLEtBQUs7WUFDcEIsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLElBQUksV0FBVztZQUNqQyxPQUFPLEVBQUUsVUFBVTtTQUNwQixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsV0FBVyxDQUFDLE9BQU8sRUFBRTtZQUN4QixPQUFPO2dCQUNMLFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxXQUFXLENBQUMsS0FBSyxFQUFFLENBQUM7YUFDbkQsQ0FBQztTQUNIO1FBRUQsK0JBQStCO1FBQy9CLE1BQU0sZUFBZSxHQUFHLE1BQU0scUJBQXFCLENBQ2pELFdBQVcsQ0FBQyxRQUFTLEVBQ3JCLE9BQU8sQ0FBQyxTQUFTLEVBQ2pCO1lBQ0UsWUFBWSxFQUFFLENBQUM7WUFDZixhQUFhLEVBQUUsQ0FBQztZQUNoQixVQUFVLEVBQUUsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUU7WUFDekMsTUFBTSxFQUFFLE1BQU07WUFDZCxXQUFXLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7WUFDckMsS0FBSyxFQUFFLFVBQVU7WUFDakIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNO1lBQ3RCLEtBQUssRUFBRSxPQUFPLENBQUMsS0FBSyxJQUFJLGNBQWM7U0FDdkMsQ0FDRixDQUFDO1FBRUYsd0JBQXdCO1FBQ3hCLE1BQU0sc0JBQXNCLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxlQUFlLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUVuRixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsUUFBUSxFQUFFLGVBQWUsQ0FBQyxpQkFBaUI7Z0JBQzNDLGdCQUFnQixFQUFFLGVBQWUsQ0FBQyxRQUFRO2dCQUMxQyxRQUFRLEVBQUUsZUFBZSxDQUFDLFFBQVE7YUFDbkMsQ0FBQztTQUNILENBQUM7S0FFSDtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ2QsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN2RCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsS0FBSyxFQUFFLCtDQUErQztnQkFDdEQsT0FBTyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7YUFDbEUsQ0FBQztTQUNILENBQUM7S0FDSDtBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSx5QkFBeUIsQ0FBQyxLQUEyQixFQUFFLFdBQW1DO0lBQ3ZHLElBQUk7UUFDRixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRTtZQUNmLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLDBCQUEwQixFQUFFLENBQUM7YUFDNUQsQ0FBQztTQUNIO1FBRUQsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFdkMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFO1lBQzNDLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHFDQUFxQyxFQUFFLENBQUM7YUFDdkUsQ0FBQztTQUNIO1FBRUQsMEJBQTBCO1FBQzFCLE1BQU0sYUFBYSxHQUFHLE1BQU0scUJBQXFCLENBQy9DLE9BQU8sQ0FBQyxlQUFlLElBQUksRUFBRSxFQUM3QixPQUFPLENBQUMsUUFBUSxFQUNoQixPQUFPLENBQUMsU0FBUyxDQUNsQixDQUFDO1FBRUYscUJBQXFCO1FBQ3JCLE1BQU0sV0FBVyxHQUFHLE1BQU0sb0JBQW9CLENBQUM7WUFDN0MsTUFBTSxFQUFFLGFBQWE7WUFDckIsSUFBSSxFQUFFLFdBQVc7WUFDakIsT0FBTyxFQUFFLFVBQVU7U0FDcEIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUU7WUFDeEIsT0FBTztnQkFDTCxVQUFVLEVBQUUsR0FBRztnQkFDZixPQUFPLEVBQUUsV0FBVztnQkFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxDQUFDLEtBQUssRUFBRSxDQUFDO2FBQ25ELENBQUM7U0FDSDtRQUVELHVDQUF1QztRQUN2QyxNQUFNLGVBQWUsR0FBRyxNQUFNLHFCQUFxQixDQUNqRCxXQUFXLENBQUMsUUFBUyxFQUNyQixPQUFPLENBQUMsU0FBUyxFQUNqQjtZQUNFLFlBQVksRUFBRSxDQUFDO1lBQ2YsYUFBYSxFQUFFLENBQUM7WUFDaEIsVUFBVSxFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFO1lBQ3pDLE1BQU0sRUFBRSxNQUFNO1lBQ2QsV0FBVyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ3JDLEtBQUssRUFBRSxVQUFVO1lBQ2pCLE1BQU0sRUFBRSxhQUFhO1lBQ3JCLEtBQUssRUFBRSxTQUFTO1NBQ2pCLENBQ0YsQ0FBQztRQUVGLHdCQUF3QjtRQUN4QixNQUFNLHNCQUFzQixDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsZUFBZSxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFFbkYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLE9BQU8sRUFBRSxJQUFJO2dCQUNiLFFBQVEsRUFBRSxlQUFlLENBQUMsaUJBQWlCO2dCQUMzQyxnQkFBZ0IsRUFBRSxlQUFlLENBQUMsUUFBUTtnQkFDMUMsUUFBUSxFQUFFLGVBQWUsQ0FBQyxRQUFRO2FBQ25DLENBQUM7U0FDSCxDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsOEJBQThCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDckQsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLEtBQUssRUFBRSw2Q0FBNkM7Z0JBQ3BELE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlO2FBQ2xFLENBQUM7U0FDSCxDQUFDO0tBQ0g7QUFDSCxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxLQUFLLFVBQVUscUJBQXFCLENBQUMsS0FBMkIsRUFBRSxXQUFtQztJQUNuRyxJQUFJO1FBQ0YsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUU7WUFDZixPQUFPO2dCQUNMLFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSwwQkFBMEIsRUFBRSxDQUFDO2FBQzVELENBQUM7U0FDSDtRQUVELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXZDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFO1lBQ3BCLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHFCQUFxQixFQUFFLENBQUM7YUFDdkQsQ0FBQztTQUNIO1FBRUQsdUNBQXVDO1FBQ3ZDLE1BQU0sUUFBUSxHQUFHLE1BQU0sZ0NBQWdDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRXpFLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNuQixNQUFNLEVBQUUsUUFBUSxDQUFDLGVBQWU7Z0JBQ2hDLEtBQUssRUFBRSxRQUFRLENBQUMsY0FBYztnQkFDOUIsUUFBUSxFQUFFLFFBQVEsQ0FBQyxRQUFRO2dCQUMzQixJQUFJLEVBQUUsUUFBUSxDQUFDLElBQUk7Z0JBQ25CLGNBQWMsRUFBRSxRQUFRLENBQUMsY0FBYzthQUN4QyxDQUFDO1NBQ0gsQ0FBQztLQUVIO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLHlCQUF5QixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ2hELE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNuQixLQUFLLEVBQUUsK0NBQStDO2dCQUN0RCxPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTthQUNsRSxDQUFDO1NBQ0gsQ0FBQztLQUNIO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLDBCQUEwQixDQUFDLFFBS3pDO0lBQ0MsTUFBTSxPQUFPLEdBQUc7UUFDZCxTQUFTLEVBQUUsSUFBQSxTQUFNLEdBQUU7UUFDbkIsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVO1FBQy9CLE1BQU0sRUFBRSxRQUFRLENBQUMsTUFBTTtRQUN2QixTQUFTLEVBQUUsaUJBQWlCO1FBQzVCLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVztRQUNqQyxPQUFPLEVBQUUsUUFBUSxDQUFDLE9BQU87UUFDekIsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO0tBQ3BDLENBQUM7SUFFRixNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSwrQkFBa0IsQ0FBQztRQUMxQyxRQUFRLEVBQUUsa0JBQWtCO1FBQzVCLFdBQVcsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQztRQUNwQyxpQkFBaUIsRUFBRTtZQUNqQixVQUFVLEVBQUU7Z0JBQ1YsV0FBVyxFQUFFLFFBQVEsQ0FBQyxVQUFVO2dCQUNoQyxRQUFRLEVBQUUsUUFBUTthQUNuQjtZQUNELE1BQU0sRUFBRTtnQkFDTixXQUFXLEVBQUUsUUFBUSxDQUFDLE1BQU07Z0JBQzVCLFFBQVEsRUFBRSxRQUFRO2FBQ25CO1lBQ0QsU0FBUyxFQUFFO2dCQUNULFdBQVcsRUFBRSxpQkFBaUI7Z0JBQzlCLFFBQVEsRUFBRSxRQUFRO2FBQ25CO1NBQ0Y7S0FDRixDQUFDLENBQUMsQ0FBQztBQUNOLENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSxZQUFZLENBQUMsU0FBaUIsRUFBRSxNQUFXO0lBQ3hELE1BQU0saUJBQWlCLENBQUMsSUFBSSxDQUFDLElBQUkscUNBQWdCLENBQUM7UUFDaEQsT0FBTyxFQUFFLENBQUM7Z0JBQ1IsTUFBTSxFQUFFLG1DQUFtQztnQkFDM0MsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLE1BQU0sRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQztnQkFDOUIsWUFBWSxFQUFFLFNBQVM7YUFDeEIsQ0FBQztLQUNILENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLG1CQUFtQixDQUFDLFNBQWlCLEVBQUUsTUFBYyxFQUFFLEtBQWM7SUFDbEYsTUFBTSxnQkFBZ0IsR0FBRyxLQUFLO1FBQzVCLENBQUMsQ0FBQyxpRUFBaUU7UUFDbkUsQ0FBQyxDQUFDLGdEQUFnRCxDQUFDO0lBRXJELE1BQU0seUJBQXlCLEdBQUcsS0FBSztRQUNyQyxDQUFDLENBQUMsRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLEVBQUU7UUFDaEYsQ0FBQyxDQUFDLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDO0lBRWxFLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLDRCQUFhLENBQUM7UUFDckMsU0FBUyxFQUFFLGFBQWE7UUFDeEIsR0FBRyxFQUFFLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRTtRQUN0QixnQkFBZ0IsRUFBRSxnQkFBZ0I7UUFDbEMsd0JBQXdCLEVBQUU7WUFDeEIsU0FBUyxFQUFFLFFBQVE7WUFDbkIsWUFBWSxFQUFFLFdBQVc7WUFDekIsR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQztTQUNwQztRQUNELHlCQUF5QixFQUFFLHlCQUF5QjtLQUNyRCxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSxzQkFBc0IsQ0FBQyxTQUFpQixFQUFFLFFBQWdCO0lBQ3ZFLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLDRCQUFhLENBQUM7UUFDckMsU0FBUyxFQUFFLGFBQWE7UUFDeEIsR0FBRyxFQUFFLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRTtRQUN0QixnQkFBZ0IsRUFBRSx1RUFBdUU7UUFDekYsd0JBQXdCLEVBQUU7WUFDeEIsV0FBVyxFQUFFLFVBQVU7WUFDdkIsU0FBUyxFQUFFLFFBQVE7WUFDbkIsWUFBWSxFQUFFLFdBQVc7U0FDMUI7UUFDRCx5QkFBeUIsRUFBRTtZQUN6QixXQUFXLEVBQUUsUUFBUTtZQUNyQixTQUFTLEVBQUUsaUJBQWlCO1lBQzVCLFlBQVksRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtTQUN2QztLQUNGLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxnQkFBZ0IsQ0FBQyxLQUFVO0lBQ2xDLHVFQUF1RTtJQUN2RSxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssaUJBQWlCLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxjQUFjLEVBQUU7UUFDckUsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUVELHFDQUFxQztJQUNyQyxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssR0FBRyxFQUFFO1FBQzVCLE9BQU8sSUFBSSxDQUFDO0tBQ2I7SUFFRCw4Q0FBOEM7SUFDOUMsSUFBSSxLQUFLLENBQUMsVUFBVSxJQUFJLEdBQUcsRUFBRTtRQUMzQixPQUFPLElBQUksQ0FBQztLQUNiO0lBRUQsa0RBQWtEO0lBQ2xELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgR2V0Q29tbWFuZCwgVXBkYXRlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcbmltcG9ydCB7IFMzQ2xpZW50LCBQdXRPYmplY3RDb21tYW5kLCBHZXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcclxuaW1wb3J0IHsgU1FTQ2xpZW50LCBTZW5kTWVzc2FnZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc3FzJztcclxuaW1wb3J0IHsgRXZlbnRCcmlkZ2VDbGllbnQsIFB1dEV2ZW50c0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZXZlbnRicmlkZ2UnO1xyXG5pbXBvcnQgZmV0Y2ggZnJvbSAnbm9kZS1mZXRjaCc7XHJcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xyXG5pbXBvcnQgc2hhcnAgZnJvbSAnc2hhcnAnO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5jb25zdCBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3Qgc3FzQ2xpZW50ID0gbmV3IFNRU0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZXZlbnRCcmlkZ2VDbGllbnQgPSBuZXcgRXZlbnRCcmlkZ2VDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcblxyXG4vLyBFbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuY29uc3QgQ09OVEVOVF9UQUJMRSA9IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSE7XHJcbmNvbnN0IElNQUdFX0JVQ0tFVCA9IHByb2Nlc3MuZW52LklNQUdFX0JVQ0tFVF9OQU1FITtcclxuY29uc3QgT1JDSEVTVFJBVE9SX1FVRVVFID0gcHJvY2Vzcy5lbnYuT1JDSEVTVFJBVE9SX1FVRVVFX1VSTCE7XHJcbmNvbnN0IEVWRU5UX0JVUyA9IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FITtcclxuY29uc3QgT1BFTkFJX0FQSV9LRVkgPSBwcm9jZXNzLmVudi5PUEVOQUlfQVBJX0tFWSE7XHJcblxyXG4vLyBUeXBlcyBmb3IgaW1hZ2UgZ2VuZXJhdGlvblxyXG5pbnRlcmZhY2UgSW1hZ2VHZW5lcmF0aW9uUmVxdWVzdCB7XHJcbiAgd29ya2Zsb3dJZDogc3RyaW5nO1xyXG4gIHN0ZXBJZDogc3RyaW5nO1xyXG4gIGNvbnRlbnRJZDogc3RyaW5nO1xyXG4gIGNvbnRlbnQ6IHN0cmluZztcclxuICBwcm9tcHQ/OiBzdHJpbmc7XHJcbiAgc3R5bGU/OiAncHJvZmVzc2lvbmFsJyB8ICdjcmVhdGl2ZScgfCAnbWluaW1hbCcgfCAndGVjaG5pY2FsJyB8ICdhYnN0cmFjdCc7XHJcbiAgc2l6ZT86ICcxMDI0eDEwMjQnIHwgJzE3OTJ4MTAyNCcgfCAnMTAyNHgxNzkyJztcclxuICB1c2VySWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIEltYWdlR2VuZXJhdGlvblJlc3BvbnNlIHtcclxuICBzdWNjZXNzOiBib29sZWFuO1xyXG4gIGltYWdlVXJsPzogc3RyaW5nO1xyXG4gIG9wdGltaXplZEltYWdlVXJsPzogc3RyaW5nO1xyXG4gIG1ldGFkYXRhPzogSW1hZ2VNZXRhZGF0YTtcclxuICBlcnJvcj86IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIEltYWdlUmV2aXNpb25SZXF1ZXN0IHtcclxuICB3b3JrZmxvd0lkOiBzdHJpbmc7XHJcbiAgc3RlcElkOiBzdHJpbmc7XHJcbiAgY29udGVudElkOiBzdHJpbmc7XHJcbiAgY3VycmVudEltYWdlVXJsOiBzdHJpbmc7XHJcbiAgZmVlZGJhY2s6IHN0cmluZztcclxuICBuZXdQcm9tcHQ/OiBzdHJpbmc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBJbWFnZU1ldGFkYXRhIHtcclxuICBvcmlnaW5hbFNpemU6IG51bWJlcjtcclxuICBvcHRpbWl6ZWRTaXplOiBudW1iZXI7XHJcbiAgZGltZW5zaW9uczogeyB3aWR0aDogbnVtYmVyOyBoZWlnaHQ6IG51bWJlciB9O1xyXG4gIGZvcm1hdDogc3RyaW5nO1xyXG4gIGdlbmVyYXRlZEF0OiBzdHJpbmc7XHJcbiAgbW9kZWw6IHN0cmluZztcclxuICBwcm9tcHQ6IHN0cmluZztcclxuICBzdHlsZTogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQ29udGVudEFuYWx5c2lzUmVzdWx0IHtcclxuICBjb25jZXB0czogc3RyaW5nW107XHJcbiAgdG9uZTogc3RyaW5nO1xyXG4gIHZpc3VhbEVsZW1lbnRzOiBzdHJpbmdbXTtcclxuICBzdWdnZXN0ZWRQcm9tcHQ6IHN0cmluZztcclxuICBzdWdnZXN0ZWRTdHlsZTogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTUNQSW1hZ2VSZXF1ZXN0IHtcclxuICBwcm9tcHQ6IHN0cmluZztcclxuICBzdHlsZT86IHN0cmluZztcclxuICBzaXplPzogc3RyaW5nO1xyXG4gIHF1YWxpdHk/OiAnc3RhbmRhcmQnIHwgJ2hkJztcclxufVxyXG5cclxuLy8gQ09SUyBoZWxwZXIgZnVuY3Rpb25cclxuZnVuY3Rpb24gZ2V0Q29yc0hlYWRlcnMob3JpZ2luOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcclxuICBjb25zdCBhbGxvd2VkT3JpZ2lucyA9IFtcclxuICAgICdodHRwczovL2tlaXJhbmhvbGxvd2F5LmdpdGh1Yi5pbycsXHJcbiAgICAnaHR0cDovL2xvY2FsaG9zdDozMDAwJyxcclxuICAgICdodHRwOi8vbG9jYWxob3N0OjUxNzMnLFxyXG4gIF07XHJcbiAgXHJcbiAgY29uc3QgYWxsb3dlZE9yaWdpbiA9IG9yaWdpbiAmJiBhbGxvd2VkT3JpZ2lucy5pbmNsdWRlcyhvcmlnaW4pID8gb3JpZ2luIDogYWxsb3dlZE9yaWdpbnNbMF07XHJcbiAgXHJcbiAgcmV0dXJuIHtcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBhbGxvd2VkT3JpZ2luLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLEF1dGhvcml6YXRpb24sWC1BbXotRGF0ZSxYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1SZXF1ZXN0ZWQtV2l0aCcsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsUE9TVCxQVVQsREVMRVRFLE9QVElPTlMnLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzJzogJ2ZhbHNlJyxcclxuICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgfTtcclxufVxyXG5cclxuLyoqXHJcbiAqIE1haW4gaGFuZGxlciBmb3IgaW1hZ2UgZ2VuZXJhdGlvbiBhZ2VudCAtIHN1cHBvcnRzIGJvdGggQVBJIEdhdGV3YXkgYW5kIFNRUyBldmVudHNcclxuICovXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCB8IFNRU0V2ZW50LCBjb250ZXh0PzogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0IHwgdm9pZD4gPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdJbWFnZSBHZW5lcmF0aW9uIEFnZW50IEV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XHJcblxyXG4gIC8vIENoZWNrIGlmIHRoaXMgaXMgYW4gU1FTIGV2ZW50IChhZ2VudCBjb21tdW5pY2F0aW9uKVxyXG4gIGlmICgnUmVjb3JkcycgaW4gZXZlbnQpIHtcclxuICAgIHJldHVybiBoYW5kbGVTUVNFdmVudChldmVudCBhcyBTUVNFdmVudCk7XHJcbiAgfVxyXG5cclxuICAvLyBIYW5kbGUgQVBJIEdhdGV3YXkgZXZlbnQgKGRpcmVjdCBBUEkgY2FsbHMpXHJcbiAgcmV0dXJuIGhhbmRsZUFQSUdhdGV3YXlFdmVudChldmVudCBhcyBBUElHYXRld2F5UHJveHlFdmVudCk7XHJcbn07XHJcblxyXG4vKipcclxuICogSGFuZGxlIFNRUyBldmVudHMgZnJvbSB0aGUgb3JjaGVzdHJhdG9yXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVTUVNFdmVudChldmVudDogU1FTRXZlbnQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBtZXNzYWdlID0gSlNPTi5wYXJzZShyZWNvcmQuYm9keSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIG1lc3NhZ2U6ICR7bWVzc2FnZS5tZXNzYWdlVHlwZX0gZm9yIHdvcmtmbG93ICR7bWVzc2FnZS53b3JrZmxvd0lkfWApO1xyXG5cclxuICAgICAgc3dpdGNoIChtZXNzYWdlLm1lc3NhZ2VUeXBlKSB7XHJcbiAgICAgICAgY2FzZSAncmVxdWVzdCc6XHJcbiAgICAgICAgICBhd2FpdCBoYW5kbGVJbWFnZUdlbmVyYXRpb25SZXF1ZXN0KG1lc3NhZ2UucGF5bG9hZCk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICBcclxuICAgICAgICBjYXNlICdyZXZpc2lvbic6XHJcbiAgICAgICAgICBhd2FpdCBoYW5kbGVJbWFnZVJldmlzaW9uUmVxdWVzdChtZXNzYWdlLnBheWxvYWQpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgIGNvbnNvbGUud2FybihgVW5rbm93biBtZXNzYWdlIHR5cGU6ICR7bWVzc2FnZS5tZXNzYWdlVHlwZX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHByb2Nlc3NpbmcgU1FTIHJlY29yZDonLCBlcnJvcik7XHJcbiAgICAgIC8vIExldCB0aGUgbWVzc2FnZSBnbyB0byBETFEgZm9yIG1hbnVhbCBpbnNwZWN0aW9uXHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBBUEkgR2F0ZXdheSBldmVudHMgKGRpcmVjdCBBUEkgY2FsbHMpXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVBUElHYXRld2F5RXZlbnQoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICBjb25zdCBjb3JzSGVhZGVycyA9IGdldENvcnNIZWFkZXJzKGV2ZW50LmhlYWRlcnMub3JpZ2luKTtcclxuXHJcbiAgLy8gSGFuZGxlIHByZWZsaWdodCByZXF1ZXN0c1xyXG4gIGlmIChldmVudC5odHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6ICcnLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBwYXRoID0gZXZlbnQucGF0aDtcclxuICAgIGNvbnN0IG1ldGhvZCA9IGV2ZW50Lmh0dHBNZXRob2Q7XHJcblxyXG4gICAgaWYgKHBhdGguaW5jbHVkZXMoJy9nZW5lcmF0ZScpICYmIG1ldGhvZCA9PT0gJ1BPU1QnKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVEaXJlY3RJbWFnZUdlbmVyYXRpb24oZXZlbnQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH0gZWxzZSBpZiAocGF0aC5pbmNsdWRlcygnL3JldmlzZScpICYmIG1ldGhvZCA9PT0gJ1BPU1QnKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVEaXJlY3RJbWFnZVJldmlzaW9uKGV2ZW50LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9IGVsc2UgaWYgKHBhdGguaW5jbHVkZXMoJy9hbmFseXplJykgJiYgbWV0aG9kID09PSAnUE9TVCcpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUNvbnRlbnRBbmFseXNpcyhldmVudCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdFbmRwb2ludCBub3QgZm91bmQnIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0FQSSBHYXRld2F5IGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgXHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3InLFxyXG4gICAgICAgIGRldGFpbHM6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgaW1hZ2UgZ2VuZXJhdGlvbiByZXF1ZXN0IGZyb20gb3JjaGVzdHJhdG9yXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVJbWFnZUdlbmVyYXRpb25SZXF1ZXN0KHJlcXVlc3Q6IEltYWdlR2VuZXJhdGlvblJlcXVlc3QpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zb2xlLmxvZyhgR2VuZXJhdGluZyBpbWFnZSBmb3Igd29ya2Zsb3cgJHtyZXF1ZXN0LndvcmtmbG93SWR9LCBjb250ZW50ICR7cmVxdWVzdC5jb250ZW50SWR9YCk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBBbmFseXplIGNvbnRlbnQgdG8gZGV0ZXJtaW5lIGFwcHJvcHJpYXRlIGltYWdlIGNvbmNlcHRzXHJcbiAgICBjb25zdCBhbmFseXNpcyA9IGF3YWl0IGFuYWx5emVDb250ZW50Rm9ySW1hZ2VHZW5lcmF0aW9uKHJlcXVlc3QuY29udGVudCk7XHJcbiAgICBcclxuICAgIC8vIFVzZSBwcm92aWRlZCBwcm9tcHQgb3IgZ2VuZXJhdGUgb25lIGZyb20gYW5hbHlzaXNcclxuICAgIGNvbnN0IGZpbmFsUHJvbXB0ID0gcmVxdWVzdC5wcm9tcHQgfHwgYW5hbHlzaXMuc3VnZ2VzdGVkUHJvbXB0O1xyXG4gICAgY29uc3QgZmluYWxTdHlsZSA9IHJlcXVlc3Quc3R5bGUgfHwgYW5hbHlzaXMuc3VnZ2VzdGVkU3R5bGU7XHJcblxyXG4gICAgLy8gR2VuZXJhdGUgaW1hZ2UgdXNpbmcgTUNQIHNlcnZlcnMgb3IgZmFsbGJhY2sgdG8gT3BlbkFJXHJcbiAgICBjb25zdCBpbWFnZVJlc3VsdCA9IGF3YWl0IGdlbmVyYXRlSW1hZ2VXaXRoTUNQKHtcclxuICAgICAgcHJvbXB0OiBmaW5hbFByb21wdCxcclxuICAgICAgc3R5bGU6IGZpbmFsU3R5bGUsXHJcbiAgICAgIHNpemU6IHJlcXVlc3Quc2l6ZSB8fCAnMTAyNHgxMDI0JyxcclxuICAgICAgcXVhbGl0eTogJ3N0YW5kYXJkJ1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGlmICghaW1hZ2VSZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoaW1hZ2VSZXN1bHQuZXJyb3IgfHwgJ0ltYWdlIGdlbmVyYXRpb24gZmFpbGVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gT3B0aW1pemUgYW5kIHN0b3JlIHRoZSBpbWFnZVxyXG4gICAgY29uc3Qgb3B0aW1pemVkUmVzdWx0ID0gYXdhaXQgb3B0aW1pemVBbmRTdG9yZUltYWdlKFxyXG4gICAgICBpbWFnZVJlc3VsdC5pbWFnZVVybCEsXHJcbiAgICAgIHJlcXVlc3QuY29udGVudElkLFxyXG4gICAgICB7XHJcbiAgICAgICAgb3JpZ2luYWxTaXplOiAwLCAvLyBXaWxsIGJlIGNhbGN1bGF0ZWQgZHVyaW5nIG9wdGltaXphdGlvblxyXG4gICAgICAgIG9wdGltaXplZFNpemU6IDAsXHJcbiAgICAgICAgZGltZW5zaW9uczogeyB3aWR0aDogMTAyNCwgaGVpZ2h0OiAxMDI0IH0sXHJcbiAgICAgICAgZm9ybWF0OiAnd2VicCcsXHJcbiAgICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICBtb2RlbDogJ2RhbGwtZS0zJyxcclxuICAgICAgICBwcm9tcHQ6IGZpbmFsUHJvbXB0LFxyXG4gICAgICAgIHN0eWxlOiBmaW5hbFN0eWxlXHJcbiAgICAgIH1cclxuICAgICk7XHJcblxyXG4gICAgLy8gU2VuZCBzdWNjZXNzIHJlc3BvbnNlIGJhY2sgdG8gb3JjaGVzdHJhdG9yXHJcbiAgICBhd2FpdCBzZW5kUmVzcG9uc2VUb09yY2hlc3RyYXRvcih7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHJlcXVlc3Qud29ya2Zsb3dJZCxcclxuICAgICAgc3RlcElkOiByZXF1ZXN0LnN0ZXBJZCxcclxuICAgICAgbWVzc2FnZVR5cGU6ICdyZXNwb25zZScsXHJcbiAgICAgIHBheWxvYWQ6IHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIGltYWdlVXJsOiBvcHRpbWl6ZWRSZXN1bHQub3B0aW1pemVkSW1hZ2VVcmwsXHJcbiAgICAgICAgb3JpZ2luYWxJbWFnZVVybDogb3B0aW1pemVkUmVzdWx0LmltYWdlVXJsLFxyXG4gICAgICAgIG1ldGFkYXRhOiBvcHRpbWl6ZWRSZXN1bHQubWV0YWRhdGEsXHJcbiAgICAgICAgYW5hbHlzaXM6IGFuYWx5c2lzLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUHVibGlzaCBzdWNjZXNzIGV2ZW50XHJcbiAgICBhd2FpdCBwdWJsaXNoRXZlbnQoJ0ltYWdlIEdlbmVyYXRpb24gQ29tcGxldGVkJywge1xyXG4gICAgICB3b3JrZmxvd0lkOiByZXF1ZXN0LndvcmtmbG93SWQsXHJcbiAgICAgIHN0ZXBJZDogcmVxdWVzdC5zdGVwSWQsXHJcbiAgICAgIGNvbnRlbnRJZDogcmVxdWVzdC5jb250ZW50SWQsXHJcbiAgICAgIGltYWdlVXJsOiBvcHRpbWl6ZWRSZXN1bHQub3B0aW1pemVkSW1hZ2VVcmwsXHJcbiAgICAgIG1ldGFkYXRhOiBvcHRpbWl6ZWRSZXN1bHQubWV0YWRhdGEsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgSW1hZ2UgZ2VuZXJhdGlvbiBjb21wbGV0ZWQgZm9yIHdvcmtmbG93ICR7cmVxdWVzdC53b3JrZmxvd0lkfWApO1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcihgSW1hZ2UgZ2VuZXJhdGlvbiBmYWlsZWQgZm9yIHdvcmtmbG93ICR7cmVxdWVzdC53b3JrZmxvd0lkfTpgLCBlcnJvcik7XHJcblxyXG4gICAgLy8gU2VuZCBlcnJvciByZXNwb25zZSBiYWNrIHRvIG9yY2hlc3RyYXRvclxyXG4gICAgYXdhaXQgc2VuZFJlc3BvbnNlVG9PcmNoZXN0cmF0b3Ioe1xyXG4gICAgICB3b3JrZmxvd0lkOiByZXF1ZXN0LndvcmtmbG93SWQsXHJcbiAgICAgIHN0ZXBJZDogcmVxdWVzdC5zdGVwSWQsXHJcbiAgICAgIG1lc3NhZ2VUeXBlOiAnZXJyb3InLFxyXG4gICAgICBwYXlsb2FkOiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxyXG4gICAgICAgIHJldHJ5YWJsZTogaXNSZXRyeWFibGVFcnJvcihlcnJvciksXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBQdWJsaXNoIGZhaWx1cmUgZXZlbnRcclxuICAgIGF3YWl0IHB1Ymxpc2hFdmVudCgnSW1hZ2UgR2VuZXJhdGlvbiBGYWlsZWQnLCB7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHJlcXVlc3Qud29ya2Zsb3dJZCxcclxuICAgICAgc3RlcElkOiByZXF1ZXN0LnN0ZXBJZCxcclxuICAgICAgY29udGVudElkOiByZXF1ZXN0LmNvbnRlbnRJZCxcclxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGltYWdlIHJldmlzaW9uIHJlcXVlc3QgZnJvbSBvcmNoZXN0cmF0b3JcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUltYWdlUmV2aXNpb25SZXF1ZXN0KHJlcXVlc3Q6IEltYWdlUmV2aXNpb25SZXF1ZXN0KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc29sZS5sb2coYFByb2Nlc3NpbmcgaW1hZ2UgcmV2aXNpb24gZm9yIHdvcmtmbG93ICR7cmVxdWVzdC53b3JrZmxvd0lkfWApO1xyXG5cclxuICB0cnkge1xyXG4gICAgLy8gR2VuZXJhdGUgcmV2aXNlZCBwcm9tcHQgYmFzZWQgb24gZmVlZGJhY2tcclxuICAgIGNvbnN0IHJldmlzZWRQcm9tcHQgPSBhd2FpdCBnZW5lcmF0ZVJldmlzZWRQcm9tcHQocmVxdWVzdC5jdXJyZW50SW1hZ2VVcmwsIHJlcXVlc3QuZmVlZGJhY2ssIHJlcXVlc3QubmV3UHJvbXB0KTtcclxuICAgIFxyXG4gICAgLy8gR2VuZXJhdGUgbmV3IGltYWdlIHdpdGggcmV2aXNlZCBwcm9tcHRcclxuICAgIGNvbnN0IGltYWdlUmVzdWx0ID0gYXdhaXQgZ2VuZXJhdGVJbWFnZVdpdGhNQ1Aoe1xyXG4gICAgICBwcm9tcHQ6IHJldmlzZWRQcm9tcHQsXHJcbiAgICAgIHNpemU6ICcxMDI0eDEwMjQnLFxyXG4gICAgICBxdWFsaXR5OiAnc3RhbmRhcmQnXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgaWYgKCFpbWFnZVJlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihpbWFnZVJlc3VsdC5lcnJvciB8fCAnSW1hZ2UgcmV2aXNpb24gZmFpbGVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gT3B0aW1pemUgYW5kIHN0b3JlIHRoZSByZXZpc2VkIGltYWdlXHJcbiAgICBjb25zdCBvcHRpbWl6ZWRSZXN1bHQgPSBhd2FpdCBvcHRpbWl6ZUFuZFN0b3JlSW1hZ2UoXHJcbiAgICAgIGltYWdlUmVzdWx0LmltYWdlVXJsISxcclxuICAgICAgcmVxdWVzdC5jb250ZW50SWQsXHJcbiAgICAgIHtcclxuICAgICAgICBvcmlnaW5hbFNpemU6IDAsXHJcbiAgICAgICAgb3B0aW1pemVkU2l6ZTogMCxcclxuICAgICAgICBkaW1lbnNpb25zOiB7IHdpZHRoOiAxMDI0LCBoZWlnaHQ6IDEwMjQgfSxcclxuICAgICAgICBmb3JtYXQ6ICd3ZWJwJyxcclxuICAgICAgICBnZW5lcmF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIG1vZGVsOiAnZGFsbC1lLTMnLFxyXG4gICAgICAgIHByb21wdDogcmV2aXNlZFByb21wdCxcclxuICAgICAgICBzdHlsZTogJ3JldmlzZWQnXHJcbiAgICAgIH1cclxuICAgICk7XHJcblxyXG4gICAgLy8gU2VuZCBzdWNjZXNzIHJlc3BvbnNlIGJhY2sgdG8gb3JjaGVzdHJhdG9yXHJcbiAgICBhd2FpdCBzZW5kUmVzcG9uc2VUb09yY2hlc3RyYXRvcih7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHJlcXVlc3Qud29ya2Zsb3dJZCxcclxuICAgICAgc3RlcElkOiByZXF1ZXN0LnN0ZXBJZCxcclxuICAgICAgbWVzc2FnZVR5cGU6ICdyZXNwb25zZScsXHJcbiAgICAgIHBheWxvYWQ6IHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIGltYWdlVXJsOiBvcHRpbWl6ZWRSZXN1bHQub3B0aW1pemVkSW1hZ2VVcmwsXHJcbiAgICAgICAgb3JpZ2luYWxJbWFnZVVybDogb3B0aW1pemVkUmVzdWx0LmltYWdlVXJsLFxyXG4gICAgICAgIG1ldGFkYXRhOiBvcHRpbWl6ZWRSZXN1bHQubWV0YWRhdGEsXHJcbiAgICAgICAgZmVlZGJhY2s6IHJlcXVlc3QuZmVlZGJhY2ssXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgSW1hZ2UgcmV2aXNpb24gY29tcGxldGVkIGZvciB3b3JrZmxvdyAke3JlcXVlc3Qud29ya2Zsb3dJZH1gKTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoYEltYWdlIHJldmlzaW9uIGZhaWxlZCBmb3Igd29ya2Zsb3cgJHtyZXF1ZXN0LndvcmtmbG93SWR9OmAsIGVycm9yKTtcclxuXHJcbiAgICAvLyBTZW5kIGVycm9yIHJlc3BvbnNlIGJhY2sgdG8gb3JjaGVzdHJhdG9yXHJcbiAgICBhd2FpdCBzZW5kUmVzcG9uc2VUb09yY2hlc3RyYXRvcih7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHJlcXVlc3Qud29ya2Zsb3dJZCxcclxuICAgICAgc3RlcElkOiByZXF1ZXN0LnN0ZXBJZCxcclxuICAgICAgbWVzc2FnZVR5cGU6ICdlcnJvcicsXHJcbiAgICAgIHBheWxvYWQ6IHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcicsXHJcbiAgICAgICAgcmV0cnlhYmxlOiBpc1JldHJ5YWJsZUVycm9yKGVycm9yKSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEdlbmVyYXRlIGltYWdlIHVzaW5nIE1DUCBzZXJ2ZXJzIHdpdGggZmFsbGJhY2sgdG8gT3BlbkFJXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUltYWdlV2l0aE1DUChyZXF1ZXN0OiBNQ1BJbWFnZVJlcXVlc3QpOiBQcm9taXNlPEltYWdlR2VuZXJhdGlvblJlc3BvbnNlPiB7XHJcbiAgdHJ5IHtcclxuICAgIC8vIEZpcnN0IHRyeSBNQ1Agc2VydmVycyAoaWYgY29uZmlndXJlZClcclxuICAgIGNvbnN0IG1jcFJlc3VsdCA9IGF3YWl0IHRyeU1DUEltYWdlR2VuZXJhdGlvbihyZXF1ZXN0KTtcclxuICAgIGlmIChtY3BSZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICByZXR1cm4gbWNwUmVzdWx0O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUubG9nKCdNQ1AgaW1hZ2UgZ2VuZXJhdGlvbiBmYWlsZWQsIGZhbGxpbmcgYmFjayB0byBPcGVuQUknKTtcclxuICAgIFxyXG4gICAgLy8gRmFsbGJhY2sgdG8gT3BlbkFJIERBTEwtRVxyXG4gICAgcmV0dXJuIGF3YWl0IGdlbmVyYXRlSW1hZ2VXaXRoT3BlbkFJKHJlcXVlc3QpO1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gaW1hZ2UgZ2VuZXJhdGlvbjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3IgZHVyaW5nIGltYWdlIGdlbmVyYXRpb24nXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIFRyeSB0byBnZW5lcmF0ZSBpbWFnZSB1c2luZyBNQ1Agc2VydmVyc1xyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gdHJ5TUNQSW1hZ2VHZW5lcmF0aW9uKHJlcXVlc3Q6IE1DUEltYWdlUmVxdWVzdCk6IFByb21pc2U8SW1hZ2VHZW5lcmF0aW9uUmVzcG9uc2U+IHtcclxuICB0cnkge1xyXG4gICAgLy8gVGhpcyB3b3VsZCBpbnRlZ3JhdGUgd2l0aCBhY3R1YWwgTUNQIHNlcnZlcnNcclxuICAgIC8vIEZvciBub3csIHdlJ2xsIHNpbXVsYXRlIE1DUCBzZXJ2ZXIgY29tbXVuaWNhdGlvblxyXG4gICAgY29uc29sZS5sb2coJ0F0dGVtcHRpbmcgTUNQIGltYWdlIGdlbmVyYXRpb24gd2l0aCBwcm9tcHQ6JywgcmVxdWVzdC5wcm9tcHQpO1xyXG4gICAgXHJcbiAgICAvLyBJbiBhIHJlYWwgaW1wbGVtZW50YXRpb24sIHRoaXMgd291bGQ6XHJcbiAgICAvLyAxLiBDb25uZWN0IHRvIGNvbmZpZ3VyZWQgTUNQIHNlcnZlcnNcclxuICAgIC8vIDIuIFNlbmQgaW1hZ2UgZ2VuZXJhdGlvbiByZXF1ZXN0XHJcbiAgICAvLyAzLiBIYW5kbGUgdGhlIHJlc3BvbnNlXHJcbiAgICBcclxuICAgIC8vIEZvciBub3csIHJldHVybiBmYWlsdXJlIHRvIHRyaWdnZXIgT3BlbkFJIGZhbGxiYWNrXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgZXJyb3I6ICdNQ1Agc2VydmVycyBub3QgY29uZmlndXJlZCdcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdNQ1AgaW1hZ2UgZ2VuZXJhdGlvbiBlcnJvcjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ01DUCBnZW5lcmF0aW9uIGZhaWxlZCdcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogR2VuZXJhdGUgaW1hZ2UgdXNpbmcgT3BlbkFJIERBTEwtRSBhcyBmYWxsYmFja1xyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVJbWFnZVdpdGhPcGVuQUkocmVxdWVzdDogTUNQSW1hZ2VSZXF1ZXN0KTogUHJvbWlzZTxJbWFnZUdlbmVyYXRpb25SZXNwb25zZT4ge1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoIU9QRU5BSV9BUElfS0VZKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6ICdPcGVuQUkgQVBJIGtleSBub3QgY29uZmlndXJlZCdcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKCdodHRwczovL2FwaS5vcGVuYWkuY29tL3YxL2ltYWdlcy9nZW5lcmF0aW9ucycsIHtcclxuICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHtPUEVOQUlfQVBJX0tFWX1gLFxyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBtb2RlbDogJ2RhbGwtZS0zJyxcclxuICAgICAgICBwcm9tcHQ6IHJlcXVlc3QucHJvbXB0LFxyXG4gICAgICAgIG46IDEsXHJcbiAgICAgICAgc2l6ZTogcmVxdWVzdC5zaXplIHx8ICcxMDI0eDEwMjQnLFxyXG4gICAgICAgIHF1YWxpdHk6IHJlcXVlc3QucXVhbGl0eSB8fCAnc3RhbmRhcmQnLFxyXG4gICAgICAgIHJlc3BvbnNlX2Zvcm1hdDogJ3VybCcsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xyXG4gICAgICBjb25zdCBlcnJvckRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCkgYXMgYW55O1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBgT3BlbkFJIEFQSSBlcnJvcjogJHtlcnJvckRhdGEuZXJyb3I/Lm1lc3NhZ2UgfHwgJ1Vua25vd24gZXJyb3InfWBcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVzcG9uc2UuanNvbigpIGFzIGFueTtcclxuICAgIGNvbnN0IGltYWdlVXJsID0gZGF0YS5kYXRhWzBdPy51cmw7XHJcblxyXG4gICAgaWYgKCFpbWFnZVVybCkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiAnTm8gaW1hZ2UgVVJMIHJldHVybmVkIGZyb20gT3BlbkFJJ1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgIGltYWdlVXJsOiBpbWFnZVVybFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdlbmVyYXRpbmcgaW1hZ2Ugd2l0aCBPcGVuQUk6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yIGR1cmluZyBPcGVuQUkgaW1hZ2UgZ2VuZXJhdGlvbidcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogQW5hbHl6ZSBjb250ZW50IHRvIGRldGVybWluZSBhcHByb3ByaWF0ZSBpbWFnZSBjb25jZXB0c1xyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gYW5hbHl6ZUNvbnRlbnRGb3JJbWFnZUdlbmVyYXRpb24oY29udGVudDogc3RyaW5nKTogUHJvbWlzZTxDb250ZW50QW5hbHlzaXNSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgLy8gRXh0cmFjdCBrZXkgY29uY2VwdHMgZnJvbSBjb250ZW50XHJcbiAgICBjb25zdCBjb25jZXB0cyA9IGV4dHJhY3RLZXlDb25jZXB0c0Zyb21Db250ZW50KGNvbnRlbnQpO1xyXG4gICAgXHJcbiAgICAvLyBEZXRlcm1pbmUgdG9uZSBhbmQgc3R5bGVcclxuICAgIGNvbnN0IHRvbmUgPSBkZXRlcm1pbmVUb25lRnJvbUNvbnRlbnQoY29udGVudCk7XHJcbiAgICBcclxuICAgIC8vIElkZW50aWZ5IHZpc3VhbCBlbGVtZW50c1xyXG4gICAgY29uc3QgdmlzdWFsRWxlbWVudHMgPSBpZGVudGlmeVZpc3VhbEVsZW1lbnRzKGNvbnRlbnQpO1xyXG4gICAgXHJcbiAgICAvLyBHZW5lcmF0ZSBzdWdnZXN0ZWQgcHJvbXB0XHJcbiAgICBjb25zdCBzdWdnZXN0ZWRQcm9tcHQgPSBnZW5lcmF0ZUltYWdlUHJvbXB0RnJvbUFuYWx5c2lzKGNvbmNlcHRzLCB0b25lLCB2aXN1YWxFbGVtZW50cyk7XHJcbiAgICBcclxuICAgIC8vIERldGVybWluZSBzdWdnZXN0ZWQgc3R5bGVcclxuICAgIGNvbnN0IHN1Z2dlc3RlZFN0eWxlID0gZGV0ZXJtaW5lU3R5bGVGcm9tVG9uZSh0b25lKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBjb25jZXB0cyxcclxuICAgICAgdG9uZSxcclxuICAgICAgdmlzdWFsRWxlbWVudHMsXHJcbiAgICAgIHN1Z2dlc3RlZFByb21wdCxcclxuICAgICAgc3VnZ2VzdGVkU3R5bGVcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBhbmFseXppbmcgY29udGVudCBmb3IgaW1hZ2UgZ2VuZXJhdGlvbjonLCBlcnJvcik7XHJcbiAgICBcclxuICAgIC8vIFJldHVybiBkZWZhdWx0IGFuYWx5c2lzXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBjb25jZXB0czogWyd0ZWNobm9sb2d5JywgJ2lubm92YXRpb24nXSxcclxuICAgICAgdG9uZTogJ3Byb2Zlc3Npb25hbCcsXHJcbiAgICAgIHZpc3VhbEVsZW1lbnRzOiBbJ2Fic3RyYWN0JywgJ21vZGVybiddLFxyXG4gICAgICBzdWdnZXN0ZWRQcm9tcHQ6ICdQcm9mZXNzaW9uYWwgaWxsdXN0cmF0aW9uIHJlcHJlc2VudGluZyB0ZWNobm9sb2d5IGFuZCBpbm5vdmF0aW9uLCBtb2Rlcm4gYWJzdHJhY3QgZGVzaWduJyxcclxuICAgICAgc3VnZ2VzdGVkU3R5bGU6ICdwcm9mZXNzaW9uYWwnXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEV4dHJhY3Qga2V5IGNvbmNlcHRzIGZyb20gYmxvZyBjb250ZW50XHJcbiAqL1xyXG5mdW5jdGlvbiBleHRyYWN0S2V5Q29uY2VwdHNGcm9tQ29udGVudChjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XHJcbiAgY29uc3QgdGVjaFRlcm1zID0gW1xyXG4gICAgJ2F3cycsICdhenVyZScsICdnY3AnLCAnY2xvdWQnLCAna3ViZXJuZXRlcycsICdkb2NrZXInLCAnc2VydmVybGVzcycsXHJcbiAgICAnZGV2b3BzJywgJ2Zpbm9wcycsICdpbmZyYXN0cnVjdHVyZScsICdhcmNoaXRlY3R1cmUnLCAnc2VjdXJpdHknLFxyXG4gICAgJ3BsYXRmb3JtIGVuZ2luZWVyaW5nJywgJ2JhY2tzdGFnZScsICdjb3N0IG9wdGltaXphdGlvbicsICdhdXRvbWF0aW9uJyxcclxuICAgICdtb25pdG9yaW5nJywgJ29ic2VydmFiaWxpdHknLCAnbWljcm9zZXJ2aWNlcycsICdjb250YWluZXJzJywgJ2FpJyxcclxuICAgICdtYWNoaW5lIGxlYXJuaW5nJywgJ2RhdGEnLCAnYW5hbHl0aWNzJywgJ3RyYW5zZm9ybWF0aW9uJywgJ2RpZ2l0YWwnLFxyXG4gICAgJ2VudGVycHJpc2UnLCAnc2NhbGFiaWxpdHknLCAncGVyZm9ybWFuY2UnLCAncmVsaWFiaWxpdHknLCAnaW5ub3ZhdGlvbidcclxuICBdO1xyXG5cclxuICBjb25zdCBjb250ZW50TG93ZXIgPSBjb250ZW50LnRvTG93ZXJDYXNlKCk7XHJcbiAgY29uc3QgZm91bmRDb25jZXB0cyA9IHRlY2hUZXJtcy5maWx0ZXIodGVybSA9PiBcclxuICAgIGNvbnRlbnRMb3dlci5pbmNsdWRlcyh0ZXJtLnRvTG93ZXJDYXNlKCkpXHJcbiAgKTtcclxuXHJcbiAgLy8gQWRkIGdlbmVyYWwgY29uY2VwdHMgaWYgbm8gc3BlY2lmaWMgdGVjaCB0ZXJtcyBmb3VuZFxyXG4gIGlmIChmb3VuZENvbmNlcHRzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgZm91bmRDb25jZXB0cy5wdXNoKCd0ZWNobm9sb2d5JywgJ2J1c2luZXNzJywgJ2lubm92YXRpb24nKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBmb3VuZENvbmNlcHRzLnNsaWNlKDAsIDUpOyAvLyBMaW1pdCB0byB0b3AgNSBjb25jZXB0c1xyXG59XHJcblxyXG4vKipcclxuICogRGV0ZXJtaW5lIHRvbmUgZnJvbSBjb250ZW50XHJcbiAqL1xyXG5mdW5jdGlvbiBkZXRlcm1pbmVUb25lRnJvbUNvbnRlbnQoY29udGVudDogc3RyaW5nKTogc3RyaW5nIHtcclxuICBjb25zdCBjb250ZW50TG93ZXIgPSBjb250ZW50LnRvTG93ZXJDYXNlKCk7XHJcbiAgXHJcbiAgLy8gTG9vayBmb3IgaW5kaWNhdG9ycyBvZiBkaWZmZXJlbnQgdG9uZXNcclxuICBpZiAoY29udGVudExvd2VyLmluY2x1ZGVzKCdlbnRlcnByaXNlJykgfHwgY29udGVudExvd2VyLmluY2x1ZGVzKCdidXNpbmVzcycpIHx8IGNvbnRlbnRMb3dlci5pbmNsdWRlcygnc3RyYXRlZ3knKSkge1xyXG4gICAgcmV0dXJuICdwcm9mZXNzaW9uYWwnO1xyXG4gIH0gZWxzZSBpZiAoY29udGVudExvd2VyLmluY2x1ZGVzKCdjcmVhdGl2ZScpIHx8IGNvbnRlbnRMb3dlci5pbmNsdWRlcygnZGVzaWduJykgfHwgY29udGVudExvd2VyLmluY2x1ZGVzKCdhcnQnKSkge1xyXG4gICAgcmV0dXJuICdjcmVhdGl2ZSc7XHJcbiAgfSBlbHNlIGlmIChjb250ZW50TG93ZXIuaW5jbHVkZXMoJ3RlY2huaWNhbCcpIHx8IGNvbnRlbnRMb3dlci5pbmNsdWRlcygnYXJjaGl0ZWN0dXJlJykgfHwgY29udGVudExvd2VyLmluY2x1ZGVzKCdlbmdpbmVlcmluZycpKSB7XHJcbiAgICByZXR1cm4gJ3RlY2huaWNhbCc7XHJcbiAgfSBlbHNlIGlmIChjb250ZW50TG93ZXIuaW5jbHVkZXMoJ3NpbXBsZScpIHx8IGNvbnRlbnRMb3dlci5pbmNsdWRlcygnY2xlYW4nKSB8fCBjb250ZW50TG93ZXIuaW5jbHVkZXMoJ21pbmltYWwnKSkge1xyXG4gICAgcmV0dXJuICdtaW5pbWFsJztcclxuICB9XHJcbiAgXHJcbiAgcmV0dXJuICdwcm9mZXNzaW9uYWwnOyAvLyBEZWZhdWx0IHRvbmVcclxufVxyXG5cclxuLyoqXHJcbiAqIElkZW50aWZ5IHZpc3VhbCBlbGVtZW50cyBmcm9tIGNvbnRlbnRcclxuICovXHJcbmZ1bmN0aW9uIGlkZW50aWZ5VmlzdWFsRWxlbWVudHMoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xyXG4gIGNvbnN0IHZpc3VhbEtleXdvcmRzID0ge1xyXG4gICAgJ2Fic3RyYWN0JzogWydjb25jZXB0JywgJ2lkZWEnLCAndGhlb3J5JywgJ2Fic3RyYWN0J10sXHJcbiAgICAnZGlhZ3JhbSc6IFsncHJvY2VzcycsICd3b3JrZmxvdycsICdhcmNoaXRlY3R1cmUnLCAnc3lzdGVtJ10sXHJcbiAgICAnY2hhcnQnOiBbJ2RhdGEnLCAnbWV0cmljcycsICdhbmFseXRpY3MnLCAncGVyZm9ybWFuY2UnXSxcclxuICAgICduZXR3b3JrJzogWydjb25uZWN0aW9uJywgJ2ludGVncmF0aW9uJywgJ2FwaScsICduZXR3b3JrJ10sXHJcbiAgICAnY2xvdWQnOiBbJ2Nsb3VkJywgJ2F3cycsICdhenVyZScsICdnY3AnXSxcclxuICAgICdtb2Rlcm4nOiBbJ21vZGVybicsICdjb250ZW1wb3JhcnknLCAnY3VycmVudCcsICdsYXRlc3QnXSxcclxuICAgICdnZW9tZXRyaWMnOiBbJ3N0cnVjdHVyZScsICdmcmFtZXdvcmsnLCAncGF0dGVybicsICdkZXNpZ24nXVxyXG4gIH07XHJcblxyXG4gIGNvbnN0IGNvbnRlbnRMb3dlciA9IGNvbnRlbnQudG9Mb3dlckNhc2UoKTtcclxuICBjb25zdCBlbGVtZW50czogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgZm9yIChjb25zdCBbZWxlbWVudCwga2V5d29yZHNdIG9mIE9iamVjdC5lbnRyaWVzKHZpc3VhbEtleXdvcmRzKSkge1xyXG4gICAgaWYgKGtleXdvcmRzLnNvbWUoa2V5d29yZCA9PiBjb250ZW50TG93ZXIuaW5jbHVkZXMoa2V5d29yZCkpKSB7XHJcbiAgICAgIGVsZW1lbnRzLnB1c2goZWxlbWVudCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gZWxlbWVudHMubGVuZ3RoID4gMCA/IGVsZW1lbnRzIDogWydhYnN0cmFjdCcsICdtb2Rlcm4nXTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEdlbmVyYXRlIGltYWdlIHByb21wdCBmcm9tIGFuYWx5c2lzXHJcbiAqL1xyXG5mdW5jdGlvbiBnZW5lcmF0ZUltYWdlUHJvbXB0RnJvbUFuYWx5c2lzKGNvbmNlcHRzOiBzdHJpbmdbXSwgdG9uZTogc3RyaW5nLCB2aXN1YWxFbGVtZW50czogc3RyaW5nW10pOiBzdHJpbmcge1xyXG4gIGNvbnN0IHN0eWxlTWFwID0ge1xyXG4gICAgJ3Byb2Zlc3Npb25hbCc6ICdjbGVhbiwgbW9kZXJuLCBwcm9mZXNzaW9uYWwgaWxsdXN0cmF0aW9uJyxcclxuICAgICdjcmVhdGl2ZSc6ICdhcnRpc3RpYywgY3JlYXRpdmUsIHZpYnJhbnQgaWxsdXN0cmF0aW9uJyxcclxuICAgICdtaW5pbWFsJzogJ21pbmltYWxpc3QsIHNpbXBsZSwgY2xlYW4gZGVzaWduJyxcclxuICAgICd0ZWNobmljYWwnOiAndGVjaG5pY2FsIGRpYWdyYW0sIGluZm9ncmFwaGljIHN0eWxlJyxcclxuICAgICdhYnN0cmFjdCc6ICdhYnN0cmFjdCwgY29uY2VwdHVhbCBhcnQnXHJcbiAgfTtcclxuXHJcbiAgY29uc3QgYmFzZVN0eWxlID0gc3R5bGVNYXBbdG9uZSBhcyBrZXlvZiB0eXBlb2Ygc3R5bGVNYXBdIHx8IHN0eWxlTWFwLnByb2Zlc3Npb25hbDtcclxuICBjb25zdCBjb25jZXB0c1RleHQgPSBjb25jZXB0cy5zbGljZSgwLCAzKS5qb2luKCcsICcpO1xyXG4gIGNvbnN0IGVsZW1lbnRzVGV4dCA9IHZpc3VhbEVsZW1lbnRzLnNsaWNlKDAsIDIpLmpvaW4oJyBhbmQgJyk7XHJcblxyXG4gIHJldHVybiBgJHtiYXNlU3R5bGV9IHJlcHJlc2VudGluZyAke2NvbmNlcHRzVGV4dH0sIGZlYXR1cmluZyAke2VsZW1lbnRzVGV4dH0gZWxlbWVudHMsIGhpZ2ggcXVhbGl0eSwgZGV0YWlsZWQsIHN1aXRhYmxlIGZvciBibG9nIHBvc3QgaGVhZGVyYDtcclxufVxyXG5cclxuLyoqXHJcbiAqIERldGVybWluZSBzdHlsZSBmcm9tIHRvbmVcclxuICovXHJcbmZ1bmN0aW9uIGRldGVybWluZVN0eWxlRnJvbVRvbmUodG9uZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICBjb25zdCBzdHlsZU1hcCA9IHtcclxuICAgICdwcm9mZXNzaW9uYWwnOiAncHJvZmVzc2lvbmFsJyxcclxuICAgICdjcmVhdGl2ZSc6ICdjcmVhdGl2ZScsXHJcbiAgICAnbWluaW1hbCc6ICdtaW5pbWFsJyxcclxuICAgICd0ZWNobmljYWwnOiAndGVjaG5pY2FsJ1xyXG4gIH07XHJcblxyXG4gIHJldHVybiBzdHlsZU1hcFt0b25lIGFzIGtleW9mIHR5cGVvZiBzdHlsZU1hcF0gfHwgJ3Byb2Zlc3Npb25hbCc7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBHZW5lcmF0ZSByZXZpc2VkIHByb21wdCBiYXNlZCBvbiBmZWVkYmFja1xyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVSZXZpc2VkUHJvbXB0KGN1cnJlbnRJbWFnZVVybDogc3RyaW5nLCBmZWVkYmFjazogc3RyaW5nLCBuZXdQcm9tcHQ/OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gIGlmIChuZXdQcm9tcHQpIHtcclxuICAgIHJldHVybiBuZXdQcm9tcHQ7XHJcbiAgfVxyXG5cclxuICAvLyBBbmFseXplIGZlZWRiYWNrIHRvIGRldGVybWluZSB3aGF0IGNoYW5nZXMgdG8gbWFrZVxyXG4gIGNvbnN0IGZlZWRiYWNrTG93ZXIgPSBmZWVkYmFjay50b0xvd2VyQ2FzZSgpO1xyXG4gIGxldCByZXZpc2lvbkluc3RydWN0aW9ucyA9ICcnO1xyXG5cclxuICBpZiAoZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnY29sb3InKSB8fCBmZWVkYmFja0xvd2VyLmluY2x1ZGVzKCdicmlnaHQnKSB8fCBmZWVkYmFja0xvd2VyLmluY2x1ZGVzKCd2aWJyYW50JykpIHtcclxuICAgIHJldmlzaW9uSW5zdHJ1Y3Rpb25zICs9ICdtb3JlIGNvbG9yZnVsIGFuZCB2aWJyYW50LCAnO1xyXG4gIH1cclxuICBcclxuICBpZiAoZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnc2ltcGxlJykgfHwgZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnbWluaW1hbCcpIHx8IGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ2NsZWFuJykpIHtcclxuICAgIHJldmlzaW9uSW5zdHJ1Y3Rpb25zICs9ICdzaW1wbGVyIGFuZCBtb3JlIG1pbmltYWwsICc7XHJcbiAgfVxyXG4gIFxyXG4gIGlmIChmZWVkYmFja0xvd2VyLmluY2x1ZGVzKCdwcm9mZXNzaW9uYWwnKSB8fCBmZWVkYmFja0xvd2VyLmluY2x1ZGVzKCdidXNpbmVzcycpKSB7XHJcbiAgICByZXZpc2lvbkluc3RydWN0aW9ucyArPSAnbW9yZSBwcm9mZXNzaW9uYWwgYW5kIGJ1c2luZXNzLW9yaWVudGVkLCAnO1xyXG4gIH1cclxuICBcclxuICBpZiAoZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnY3JlYXRpdmUnKSB8fCBmZWVkYmFja0xvd2VyLmluY2x1ZGVzKCdhcnRpc3RpYycpKSB7XHJcbiAgICByZXZpc2lvbkluc3RydWN0aW9ucyArPSAnbW9yZSBjcmVhdGl2ZSBhbmQgYXJ0aXN0aWMsICc7XHJcbiAgfVxyXG5cclxuICAvLyBJZiBubyBzcGVjaWZpYyBpbnN0cnVjdGlvbnMgZm91bmQsIHVzZSB0aGUgZmVlZGJhY2sgZGlyZWN0bHlcclxuICBpZiAoIXJldmlzaW9uSW5zdHJ1Y3Rpb25zKSB7XHJcbiAgICByZXZpc2lvbkluc3RydWN0aW9ucyA9IGZlZWRiYWNrICsgJywgJztcclxuICB9XHJcblxyXG4gIHJldHVybiBgUHJvZmVzc2lvbmFsIGlsbHVzdHJhdGlvbiB3aXRoICR7cmV2aXNpb25JbnN0cnVjdGlvbnN9aGlnaCBxdWFsaXR5LCBkZXRhaWxlZCwgc3VpdGFibGUgZm9yIGJsb2cgcG9zdGA7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBPcHRpbWl6ZSBhbmQgc3RvcmUgaW1hZ2UgaW4gUzNcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIG9wdGltaXplQW5kU3RvcmVJbWFnZShpbWFnZVVybDogc3RyaW5nLCBjb250ZW50SWQ6IHN0cmluZywgbWV0YWRhdGE6IEltYWdlTWV0YWRhdGEpOiBQcm9taXNlPHtcclxuICBpbWFnZVVybDogc3RyaW5nO1xyXG4gIG9wdGltaXplZEltYWdlVXJsOiBzdHJpbmc7XHJcbiAgbWV0YWRhdGE6IEltYWdlTWV0YWRhdGE7XHJcbn0+IHtcclxuICB0cnkge1xyXG4gICAgLy8gRG93bmxvYWQgdGhlIG9yaWdpbmFsIGltYWdlXHJcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGltYWdlVXJsKTtcclxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gZG93bmxvYWQgaW1hZ2U6ICR7cmVzcG9uc2Uuc3RhdHVzVGV4dH1gKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBvcmlnaW5hbEJ1ZmZlciA9IGF3YWl0IHJlc3BvbnNlLmFycmF5QnVmZmVyKCk7XHJcbiAgICBjb25zdCBvcmlnaW5hbFNpemUgPSBvcmlnaW5hbEJ1ZmZlci5ieXRlTGVuZ3RoO1xyXG5cclxuICAgIC8vIENyZWF0ZSBvcHRpbWl6ZWQgdmVyc2lvbiB1c2luZyBTaGFycFxyXG4gICAgY29uc3Qgb3B0aW1pemVkQnVmZmVyID0gYXdhaXQgc2hhcnAoQnVmZmVyLmZyb20ob3JpZ2luYWxCdWZmZXIpKVxyXG4gICAgICAucmVzaXplKDEwMjQsIDEwMjQsIHsgZml0OiAnaW5zaWRlJywgd2l0aG91dEVubGFyZ2VtZW50OiB0cnVlIH0pXHJcbiAgICAgIC53ZWJwKHsgcXVhbGl0eTogODUgfSlcclxuICAgICAgLnRvQnVmZmVyKCk7XHJcblxyXG4gICAgY29uc3Qgb3B0aW1pemVkU2l6ZSA9IG9wdGltaXplZEJ1ZmZlci5ieXRlTGVuZ3RoO1xyXG5cclxuICAgIC8vIFN0b3JlIGJvdGggb3JpZ2luYWwgYW5kIG9wdGltaXplZCB2ZXJzaW9uc1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gRGF0ZS5ub3coKTtcclxuICAgIGNvbnN0IG9yaWdpbmFsS2V5ID0gYGltYWdlcy8ke2NvbnRlbnRJZH0vb3JpZ2luYWwtJHt0aW1lc3RhbXB9LnBuZ2A7XHJcbiAgICBjb25zdCBvcHRpbWl6ZWRLZXkgPSBgaW1hZ2VzLyR7Y29udGVudElkfS9vcHRpbWl6ZWQtJHt0aW1lc3RhbXB9LndlYnBgO1xyXG5cclxuICAgIC8vIFVwbG9hZCBvcmlnaW5hbCBpbWFnZVxyXG4gICAgYXdhaXQgczNDbGllbnQuc2VuZChuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XHJcbiAgICAgIEJ1Y2tldDogSU1BR0VfQlVDS0VULFxyXG4gICAgICBLZXk6IG9yaWdpbmFsS2V5LFxyXG4gICAgICBCb2R5OiBuZXcgVWludDhBcnJheShvcmlnaW5hbEJ1ZmZlciksXHJcbiAgICAgIENvbnRlbnRUeXBlOiAnaW1hZ2UvcG5nJyxcclxuICAgICAgTWV0YWRhdGE6IHtcclxuICAgICAgICBjb250ZW50SWQ6IGNvbnRlbnRJZCxcclxuICAgICAgICB0eXBlOiAnb3JpZ2luYWwnLFxyXG4gICAgICAgIGdlbmVyYXRlZEF0OiBtZXRhZGF0YS5nZW5lcmF0ZWRBdCxcclxuICAgICAgICBwcm9tcHQ6IG1ldGFkYXRhLnByb21wdFxyXG4gICAgICB9XHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gVXBsb2FkIG9wdGltaXplZCBpbWFnZVxyXG4gICAgYXdhaXQgczNDbGllbnQuc2VuZChuZXcgUHV0T2JqZWN0Q29tbWFuZCh7XHJcbiAgICAgIEJ1Y2tldDogSU1BR0VfQlVDS0VULFxyXG4gICAgICBLZXk6IG9wdGltaXplZEtleSxcclxuICAgICAgQm9keTogb3B0aW1pemVkQnVmZmVyLFxyXG4gICAgICBDb250ZW50VHlwZTogJ2ltYWdlL3dlYnAnLFxyXG4gICAgICBNZXRhZGF0YToge1xyXG4gICAgICAgIGNvbnRlbnRJZDogY29udGVudElkLFxyXG4gICAgICAgIHR5cGU6ICdvcHRpbWl6ZWQnLFxyXG4gICAgICAgIGdlbmVyYXRlZEF0OiBtZXRhZGF0YS5nZW5lcmF0ZWRBdCxcclxuICAgICAgICBwcm9tcHQ6IG1ldGFkYXRhLnByb21wdFxyXG4gICAgICB9XHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gR2V0IGltYWdlIGRpbWVuc2lvbnNcclxuICAgIGNvbnN0IGltYWdlSW5mbyA9IGF3YWl0IHNoYXJwKEJ1ZmZlci5mcm9tKG9yaWdpbmFsQnVmZmVyKSkubWV0YWRhdGEoKTtcclxuXHJcbiAgICBjb25zdCBmaW5hbE1ldGFkYXRhOiBJbWFnZU1ldGFkYXRhID0ge1xyXG4gICAgICAuLi5tZXRhZGF0YSxcclxuICAgICAgb3JpZ2luYWxTaXplLFxyXG4gICAgICBvcHRpbWl6ZWRTaXplLFxyXG4gICAgICBkaW1lbnNpb25zOiB7XHJcbiAgICAgICAgd2lkdGg6IGltYWdlSW5mby53aWR0aCB8fCAxMDI0LFxyXG4gICAgICAgIGhlaWdodDogaW1hZ2VJbmZvLmhlaWdodCB8fCAxMDI0XHJcbiAgICAgIH0sXHJcbiAgICAgIGZvcm1hdDogJ3dlYnAnXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIGltYWdlVXJsOiBgaHR0cHM6Ly8ke0lNQUdFX0JVQ0tFVH0uczMuYW1hem9uYXdzLmNvbS8ke29yaWdpbmFsS2V5fWAsXHJcbiAgICAgIG9wdGltaXplZEltYWdlVXJsOiBgaHR0cHM6Ly8ke0lNQUdFX0JVQ0tFVH0uczMuYW1hem9uYXdzLmNvbS8ke29wdGltaXplZEtleX1gLFxyXG4gICAgICBtZXRhZGF0YTogZmluYWxNZXRhZGF0YVxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIG9wdGltaXppbmcgYW5kIHN0b3JpbmcgaW1hZ2U6JywgZXJyb3IpO1xyXG4gICAgdGhyb3cgZXJyb3I7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGRpcmVjdCBpbWFnZSBnZW5lcmF0aW9uIEFQSSBjYWxsXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVEaXJlY3RJbWFnZUdlbmVyYXRpb24oZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGlmICghZXZlbnQuYm9keSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXF1ZXN0ID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcclxuICAgIFxyXG4gICAgaWYgKCFyZXF1ZXN0LmNvbnRlbnRJZCB8fCAhcmVxdWVzdC5wcm9tcHQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ2NvbnRlbnRJZCBhbmQgcHJvbXB0IGFyZSByZXF1aXJlZCcgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2VuZXJhdGUgaW1hZ2UgZGlyZWN0bHlcclxuICAgIGNvbnN0IGltYWdlUmVzdWx0ID0gYXdhaXQgZ2VuZXJhdGVJbWFnZVdpdGhNQ1Aoe1xyXG4gICAgICBwcm9tcHQ6IHJlcXVlc3QucHJvbXB0LFxyXG4gICAgICBzdHlsZTogcmVxdWVzdC5zdHlsZSxcclxuICAgICAgc2l6ZTogcmVxdWVzdC5zaXplIHx8ICcxMDI0eDEwMjQnLFxyXG4gICAgICBxdWFsaXR5OiAnc3RhbmRhcmQnXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgaWYgKCFpbWFnZVJlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IGltYWdlUmVzdWx0LmVycm9yIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIE9wdGltaXplIGFuZCBzdG9yZSB0aGUgaW1hZ2VcclxuICAgIGNvbnN0IG9wdGltaXplZFJlc3VsdCA9IGF3YWl0IG9wdGltaXplQW5kU3RvcmVJbWFnZShcclxuICAgICAgaW1hZ2VSZXN1bHQuaW1hZ2VVcmwhLFxyXG4gICAgICByZXF1ZXN0LmNvbnRlbnRJZCxcclxuICAgICAge1xyXG4gICAgICAgIG9yaWdpbmFsU2l6ZTogMCxcclxuICAgICAgICBvcHRpbWl6ZWRTaXplOiAwLFxyXG4gICAgICAgIGRpbWVuc2lvbnM6IHsgd2lkdGg6IDEwMjQsIGhlaWdodDogMTAyNCB9LFxyXG4gICAgICAgIGZvcm1hdDogJ3dlYnAnLFxyXG4gICAgICAgIGdlbmVyYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgbW9kZWw6ICdkYWxsLWUtMycsXHJcbiAgICAgICAgcHJvbXB0OiByZXF1ZXN0LnByb21wdCxcclxuICAgICAgICBzdHlsZTogcmVxdWVzdC5zdHlsZSB8fCAncHJvZmVzc2lvbmFsJ1xyXG4gICAgICB9XHJcbiAgICApO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBjb250ZW50IHJlY29yZFxyXG4gICAgYXdhaXQgdXBkYXRlQ29udGVudFdpdGhJbWFnZShyZXF1ZXN0LmNvbnRlbnRJZCwgb3B0aW1pemVkUmVzdWx0Lm9wdGltaXplZEltYWdlVXJsKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICBpbWFnZVVybDogb3B0aW1pemVkUmVzdWx0Lm9wdGltaXplZEltYWdlVXJsLFxyXG4gICAgICAgIG9yaWdpbmFsSW1hZ2VVcmw6IG9wdGltaXplZFJlc3VsdC5pbWFnZVVybCxcclxuICAgICAgICBtZXRhZGF0YTogb3B0aW1pemVkUmVzdWx0Lm1ldGFkYXRhXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0RpcmVjdCBpbWFnZSBnZW5lcmF0aW9uIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgXHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3IgZHVyaW5nIGltYWdlIGdlbmVyYXRpb24nLFxyXG4gICAgICAgIGRldGFpbHM6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgZGlyZWN0IGltYWdlIHJldmlzaW9uIEFQSSBjYWxsXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVEaXJlY3RJbWFnZVJldmlzaW9uKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCwgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoIWV2ZW50LmJvZHkpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVxdWVzdCA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XHJcbiAgICBcclxuICAgIGlmICghcmVxdWVzdC5jb250ZW50SWQgfHwgIXJlcXVlc3QuZmVlZGJhY2spIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ2NvbnRlbnRJZCBhbmQgZmVlZGJhY2sgYXJlIHJlcXVpcmVkJyB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZW5lcmF0ZSByZXZpc2VkIHByb21wdFxyXG4gICAgY29uc3QgcmV2aXNlZFByb21wdCA9IGF3YWl0IGdlbmVyYXRlUmV2aXNlZFByb21wdChcclxuICAgICAgcmVxdWVzdC5jdXJyZW50SW1hZ2VVcmwgfHwgJycsXHJcbiAgICAgIHJlcXVlc3QuZmVlZGJhY2ssXHJcbiAgICAgIHJlcXVlc3QubmV3UHJvbXB0XHJcbiAgICApO1xyXG5cclxuICAgIC8vIEdlbmVyYXRlIG5ldyBpbWFnZVxyXG4gICAgY29uc3QgaW1hZ2VSZXN1bHQgPSBhd2FpdCBnZW5lcmF0ZUltYWdlV2l0aE1DUCh7XHJcbiAgICAgIHByb21wdDogcmV2aXNlZFByb21wdCxcclxuICAgICAgc2l6ZTogJzEwMjR4MTAyNCcsXHJcbiAgICAgIHF1YWxpdHk6ICdzdGFuZGFyZCdcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBpZiAoIWltYWdlUmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogaW1hZ2VSZXN1bHQuZXJyb3IgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gT3B0aW1pemUgYW5kIHN0b3JlIHRoZSByZXZpc2VkIGltYWdlXHJcbiAgICBjb25zdCBvcHRpbWl6ZWRSZXN1bHQgPSBhd2FpdCBvcHRpbWl6ZUFuZFN0b3JlSW1hZ2UoXHJcbiAgICAgIGltYWdlUmVzdWx0LmltYWdlVXJsISxcclxuICAgICAgcmVxdWVzdC5jb250ZW50SWQsXHJcbiAgICAgIHtcclxuICAgICAgICBvcmlnaW5hbFNpemU6IDAsXHJcbiAgICAgICAgb3B0aW1pemVkU2l6ZTogMCxcclxuICAgICAgICBkaW1lbnNpb25zOiB7IHdpZHRoOiAxMDI0LCBoZWlnaHQ6IDEwMjQgfSxcclxuICAgICAgICBmb3JtYXQ6ICd3ZWJwJyxcclxuICAgICAgICBnZW5lcmF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIG1vZGVsOiAnZGFsbC1lLTMnLFxyXG4gICAgICAgIHByb21wdDogcmV2aXNlZFByb21wdCxcclxuICAgICAgICBzdHlsZTogJ3JldmlzZWQnXHJcbiAgICAgIH1cclxuICAgICk7XHJcblxyXG4gICAgLy8gVXBkYXRlIGNvbnRlbnQgcmVjb3JkXHJcbiAgICBhd2FpdCB1cGRhdGVDb250ZW50V2l0aEltYWdlKHJlcXVlc3QuY29udGVudElkLCBvcHRpbWl6ZWRSZXN1bHQub3B0aW1pemVkSW1hZ2VVcmwpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIGltYWdlVXJsOiBvcHRpbWl6ZWRSZXN1bHQub3B0aW1pemVkSW1hZ2VVcmwsXHJcbiAgICAgICAgb3JpZ2luYWxJbWFnZVVybDogb3B0aW1pemVkUmVzdWx0LmltYWdlVXJsLFxyXG4gICAgICAgIG1ldGFkYXRhOiBvcHRpbWl6ZWRSZXN1bHQubWV0YWRhdGFcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRGlyZWN0IGltYWdlIHJldmlzaW9uIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgXHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3IgZHVyaW5nIGltYWdlIHJldmlzaW9uJyxcclxuICAgICAgICBkZXRhaWxzOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGNvbnRlbnQgYW5hbHlzaXMgZm9yIGltYWdlIGdlbmVyYXRpb25cclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRBbmFseXNpcyhldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgaWYgKCFldmVudC5ib2R5KSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlcXVlc3QgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkpO1xyXG4gICAgXHJcbiAgICBpZiAoIXJlcXVlc3QuY29udGVudCkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnY29udGVudCBpcyByZXF1aXJlZCcgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQW5hbHl6ZSBjb250ZW50IGZvciBpbWFnZSBnZW5lcmF0aW9uXHJcbiAgICBjb25zdCBhbmFseXNpcyA9IGF3YWl0IGFuYWx5emVDb250ZW50Rm9ySW1hZ2VHZW5lcmF0aW9uKHJlcXVlc3QuY29udGVudCk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIHByb21wdDogYW5hbHlzaXMuc3VnZ2VzdGVkUHJvbXB0LFxyXG4gICAgICAgIHN0eWxlOiBhbmFseXNpcy5zdWdnZXN0ZWRTdHlsZSxcclxuICAgICAgICBjb25jZXB0czogYW5hbHlzaXMuY29uY2VwdHMsXHJcbiAgICAgICAgdG9uZTogYW5hbHlzaXMudG9uZSxcclxuICAgICAgICB2aXN1YWxFbGVtZW50czogYW5hbHlzaXMudmlzdWFsRWxlbWVudHNcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignQ29udGVudCBhbmFseXNpcyBlcnJvcjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IFxyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgc2VydmVyIGVycm9yIGR1cmluZyBjb250ZW50IGFuYWx5c2lzJyxcclxuICAgICAgICBkZXRhaWxzOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogU2VuZCByZXNwb25zZSBiYWNrIHRvIG9yY2hlc3RyYXRvclxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gc2VuZFJlc3BvbnNlVG9PcmNoZXN0cmF0b3IocmVzcG9uc2U6IHtcclxuICB3b3JrZmxvd0lkOiBzdHJpbmc7XHJcbiAgc3RlcElkOiBzdHJpbmc7XHJcbiAgbWVzc2FnZVR5cGU6ICdyZXNwb25zZScgfCAnZXJyb3InO1xyXG4gIHBheWxvYWQ6IGFueTtcclxufSk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGNvbnN0IG1lc3NhZ2UgPSB7XHJcbiAgICBtZXNzYWdlSWQ6IHV1aWR2NCgpLFxyXG4gICAgd29ya2Zsb3dJZDogcmVzcG9uc2Uud29ya2Zsb3dJZCxcclxuICAgIHN0ZXBJZDogcmVzcG9uc2Uuc3RlcElkLFxyXG4gICAgYWdlbnRUeXBlOiAnaW1hZ2UtZ2VuZXJhdG9yJyxcclxuICAgIG1lc3NhZ2VUeXBlOiByZXNwb25zZS5tZXNzYWdlVHlwZSxcclxuICAgIHBheWxvYWQ6IHJlc3BvbnNlLnBheWxvYWQsXHJcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICB9O1xyXG5cclxuICBhd2FpdCBzcXNDbGllbnQuc2VuZChuZXcgU2VuZE1lc3NhZ2VDb21tYW5kKHtcclxuICAgIFF1ZXVlVXJsOiBPUkNIRVNUUkFUT1JfUVVFVUUsXHJcbiAgICBNZXNzYWdlQm9keTogSlNPTi5zdHJpbmdpZnkobWVzc2FnZSksXHJcbiAgICBNZXNzYWdlQXR0cmlidXRlczoge1xyXG4gICAgICB3b3JrZmxvd0lkOiB7XHJcbiAgICAgICAgU3RyaW5nVmFsdWU6IHJlc3BvbnNlLndvcmtmbG93SWQsXHJcbiAgICAgICAgRGF0YVR5cGU6ICdTdHJpbmcnLFxyXG4gICAgICB9LFxyXG4gICAgICBzdGVwSWQ6IHtcclxuICAgICAgICBTdHJpbmdWYWx1ZTogcmVzcG9uc2Uuc3RlcElkLFxyXG4gICAgICAgIERhdGFUeXBlOiAnU3RyaW5nJyxcclxuICAgICAgfSxcclxuICAgICAgYWdlbnRUeXBlOiB7XHJcbiAgICAgICAgU3RyaW5nVmFsdWU6ICdpbWFnZS1nZW5lcmF0b3InLFxyXG4gICAgICAgIERhdGFUeXBlOiAnU3RyaW5nJyxcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgfSkpO1xyXG59XHJcblxyXG4vKipcclxuICogUHVibGlzaCBldmVudCB0byBFdmVudEJyaWRnZVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gcHVibGlzaEV2ZW50KGV2ZW50VHlwZTogc3RyaW5nLCBkZXRhaWw6IGFueSk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgRW50cmllczogW3tcclxuICAgICAgU291cmNlOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmltYWdlLWFnZW50JyxcclxuICAgICAgRGV0YWlsVHlwZTogZXZlbnRUeXBlLFxyXG4gICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KGRldGFpbCksXHJcbiAgICAgIEV2ZW50QnVzTmFtZTogRVZFTlRfQlVTLFxyXG4gICAgfV0sXHJcbiAgfSkpO1xyXG59XHJcblxyXG4vKipcclxuICogVXBkYXRlIGNvbnRlbnQgc3RhdHVzIGluIER5bmFtb0RCXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVDb250ZW50U3RhdHVzKGNvbnRlbnRJZDogc3RyaW5nLCBzdGF0dXM6IHN0cmluZywgZXJyb3I/OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCB1cGRhdGVFeHByZXNzaW9uID0gZXJyb3IgXHJcbiAgICA/ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsICNlcnJvciA9IDplcnJvciwgI3VwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnXHJcbiAgICA6ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsICN1cGRhdGVkQXQgPSA6dXBkYXRlZEF0JztcclxuICAgIFxyXG4gIGNvbnN0IGV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXMgPSBlcnJvclxyXG4gICAgPyB7ICc6c3RhdHVzJzogc3RhdHVzLCAnOmVycm9yJzogZXJyb3IsICc6dXBkYXRlZEF0JzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH1cclxuICAgIDogeyAnOnN0YXR1cyc6IHN0YXR1cywgJzp1cGRhdGVkQXQnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfTtcclxuXHJcbiAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgS2V5OiB7IGlkOiBjb250ZW50SWQgfSxcclxuICAgIFVwZGF0ZUV4cHJlc3Npb246IHVwZGF0ZUV4cHJlc3Npb24sXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcclxuICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJyxcclxuICAgICAgJyN1cGRhdGVkQXQnOiAndXBkYXRlZEF0JyxcclxuICAgICAgLi4uKGVycm9yICYmIHsgJyNlcnJvcic6ICdlcnJvcicgfSlcclxuICAgIH0sXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiBleHByZXNzaW9uQXR0cmlidXRlVmFsdWVzLFxyXG4gIH0pKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFVwZGF0ZSBjb250ZW50IHJlY29yZCB3aXRoIGltYWdlIFVSTFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gdXBkYXRlQ29udGVudFdpdGhJbWFnZShjb250ZW50SWQ6IHN0cmluZywgaW1hZ2VVcmw6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBVcGRhdGVDb21tYW5kKHtcclxuICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgIEtleTogeyBpZDogY29udGVudElkIH0sXHJcbiAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUICNpbWFnZVVybCA9IDppbWFnZVVybCwgI3N0YXR1cyA9IDpzdGF0dXMsICN1cGRhdGVkQXQgPSA6dXBkYXRlZEF0JyxcclxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczoge1xyXG4gICAgICAnI2ltYWdlVXJsJzogJ2ltYWdlVXJsJyxcclxuICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJyxcclxuICAgICAgJyN1cGRhdGVkQXQnOiAndXBkYXRlZEF0JyxcclxuICAgIH0sXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICc6aW1hZ2VVcmwnOiBpbWFnZVVybCxcclxuICAgICAgJzpzdGF0dXMnOiAnaW1hZ2VfZ2VuZXJhdGVkJyxcclxuICAgICAgJzp1cGRhdGVkQXQnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICB9LFxyXG4gIH0pKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIERldGVybWluZSBpZiBhbiBlcnJvciBpcyByZXRyeWFibGVcclxuICovXHJcbmZ1bmN0aW9uIGlzUmV0cnlhYmxlRXJyb3IoZXJyb3I6IGFueSk6IGJvb2xlYW4ge1xyXG4gIC8vIE5ldHdvcmsgZXJyb3JzLCB0aW1lb3V0cywgYW5kIHRlbXBvcmFyeSBzZXJ2aWNlIGlzc3VlcyBhcmUgcmV0cnlhYmxlXHJcbiAgaWYgKGVycm9yLmNvZGUgPT09ICdOZXR3b3JraW5nRXJyb3InIHx8IGVycm9yLmNvZGUgPT09ICdUaW1lb3V0RXJyb3InKSB7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcblxyXG4gIC8vIFJhdGUgbGltaXRpbmcgZXJyb3JzIGFyZSByZXRyeWFibGVcclxuICBpZiAoZXJyb3Iuc3RhdHVzQ29kZSA9PT0gNDI5KSB7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcblxyXG4gIC8vIFNlcnZlciBlcnJvcnMgKDV4eCkgYXJlIGdlbmVyYWxseSByZXRyeWFibGVcclxuICBpZiAoZXJyb3Iuc3RhdHVzQ29kZSA+PSA1MDApIHtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxuXHJcbiAgLy8gQ2xpZW50IGVycm9ycyAoNHh4KSBhcmUgZ2VuZXJhbGx5IG5vdCByZXRyeWFibGVcclxuICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbi8vIEV4cG9ydCB0eXBlcyBmb3IgdGVzdGluZ1xyXG5leHBvcnQgdHlwZSB7XHJcbiAgSW1hZ2VHZW5lcmF0aW9uUmVxdWVzdCxcclxuICBJbWFnZUdlbmVyYXRpb25SZXNwb25zZSxcclxuICBJbWFnZVJldmlzaW9uUmVxdWVzdCxcclxuICBJbWFnZU1ldGFkYXRhLFxyXG4gIENvbnRlbnRBbmFseXNpc1Jlc3VsdCxcclxuICBNQ1BJbWFnZVJlcXVlc3RcclxufTsiXX0=