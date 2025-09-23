"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const uuid_1 = require("uuid");
const error_handler_1 = require("./utils/error-handler");
const auth_middleware_1 = require("./auth/auth-middleware");
const audit_logger_1 = require("./utils/audit-logger");
// Initialize AWS clients with retry configuration
const dynamoClient = new client_dynamodb_1.DynamoDBClient({
    region: process.env.AWS_REGION,
    maxAttempts: 3,
});
const sqsClient = new client_sqs_1.SQSClient({
    region: process.env.AWS_REGION,
    maxAttempts: 3,
});
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({
    region: process.env.AWS_REGION,
    maxAttempts: 3,
});
// Initialize error handler
const errorHandler = new error_handler_1.ErrorHandler();
// Initialize authentication middleware
const authMiddleware = new auth_middleware_1.AuthMiddleware();
// Initialize audit logger
const auditLogger = new audit_logger_1.AuditLogger();
// Helper function to determine HTTP status code from error
function getStatusCodeForError(error) {
    if (error instanceof error_handler_1.ValidationError)
        return 400;
    if (error.name.includes('NotFound'))
        return 404;
    if (error.name.includes('Unauthorized'))
        return 401;
    if (error.name.includes('Forbidden'))
        return 403;
    if (error.name.includes('Throttling'))
        return 429;
    if (error.name.includes('Timeout'))
        return 408;
    return 500;
}
const handler = async (event, context) => {
    const errorContext = {
        functionName: context.functionName,
        requestId: context.awsRequestId,
        operation: `${event.httpMethod} ${event.path}`,
        userId: event.requestContext?.authorizer?.userId,
    };
    console.log('Event:', JSON.stringify(event, null, 2));
    console.log('Context:', JSON.stringify(context, null, 2));
    // Allowed origins for CORS
    const allowedOrigins = [
        'https://keiranholloway.github.io',
        'http://localhost:3000',
        'http://localhost:5173',
    ];
    const requestOrigin = event.headers.origin || event.headers.Origin;
    const allowedOrigin = allowedOrigins.includes(requestOrigin || '') ? requestOrigin : allowedOrigins[0];
    const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'Content-Type': 'application/json',
    };
    try {
        // Handle preflight OPTIONS requests
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: '',
            };
        }
        // Route handling
        const path = event.path;
        const method = event.httpMethod;
        console.log(`Processing ${method} ${path}`);
        // Health check endpoint
        if (method === 'GET' && path === '/') {
            const response = {
                message: 'Automated Blog Poster API is running',
                version: '1.0.0',
                data: {
                    timestamp: new Date().toISOString(),
                    requestId: context.awsRequestId,
                    environment: {
                        contentTable: process.env.CONTENT_TABLE_NAME,
                        userTable: process.env.USER_TABLE_NAME,
                        audioBucket: process.env.AUDIO_BUCKET_NAME,
                        imageBucket: process.env.IMAGE_BUCKET_NAME,
                    },
                },
            };
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify(response),
            };
        }
        // API status endpoint
        if (method === 'GET' && path === '/api/status') {
            const response = {
                message: 'API is healthy',
                version: '1.0.0',
                data: {
                    timestamp: new Date().toISOString(),
                    services: {
                        dynamodb: 'available',
                        s3: 'available',
                        sqs: 'available',
                        eventbridge: 'available',
                    },
                },
            };
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify(response),
            };
        }
        // Content generation endpoints
        if (method === 'POST' && path === '/api/content/generate') {
            return await handleContentGeneration(event, context, corsHeaders);
        }
        if (method === 'POST' && path === '/api/content/revise') {
            return await handleContentRevision(event, context, corsHeaders);
        }
        if (method === 'GET' && path.startsWith('/api/content/status/')) {
            const contentId = path.split('/').pop();
            return await handleContentStatus(contentId, context, corsHeaders);
        }
        if (method === 'GET' && path.startsWith('/api/content/') && path.endsWith('/messages')) {
            const pathParts = path.split('/');
            const contentId = pathParts[pathParts.length - 2];
            return await handleContentMessages(contentId, context, corsHeaders);
        }
        if (method === 'GET' && path.startsWith('/api/content/') && !path.includes('/')) {
            const contentId = path.split('/').pop();
            return await handleGetContent(contentId, context, corsHeaders);
        }
        if (method === 'POST' && path === '/api/content/validate') {
            return await handleContentValidation(event, context, corsHeaders);
        }
        // Image generation endpoints
        if (method === 'GET' && path.startsWith('/api/image/status/')) {
            const contentId = path.split('/').pop();
            return await handleImageStatus(contentId, context, corsHeaders);
        }
        if (method === 'POST' && path === '/api/image/analyze') {
            return await handleImageAnalysis(event, context, corsHeaders);
        }
        // Default 404 for unmatched routes
        const errorResponse = {
            error: 'Not Found',
            message: `Route ${method} ${path} not found`,
            requestId: context.awsRequestId,
        };
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify(errorResponse),
        };
    }
    catch (error) {
        const err = error;
        await errorHandler.handleError(err, errorContext);
        const errorResponse = errorHandler.createUserFriendlyResponse(err, errorContext);
        return {
            statusCode: getStatusCodeForError(err),
            headers: corsHeaders,
            body: JSON.stringify(errorResponse),
        };
    }
};
exports.handler = handler;
/**
 * Handle content generation request
 */
async function handleContentGeneration(event, context, corsHeaders) {
    try {
        const body = JSON.parse(event.body || '{}');
        const { transcription, userId, userContext, preferences } = body;
        if (!transcription || !userId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: 'transcription and userId are required',
                    requestId: context.awsRequestId,
                }),
            };
        }
        // Create content record
        const contentId = (0, uuid_1.v4)();
        const timestamp = new Date().toISOString();
        await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
            TableName: process.env.CONTENT_TABLE_NAME,
            Item: {
                id: { S: contentId },
                type: { S: 'content' },
                userId: { S: userId },
                originalTranscription: { S: transcription },
                status: { S: 'processing' },
                createdAt: { S: timestamp },
                updatedAt: { S: timestamp },
                userContext: { S: userContext || '' },
                preferences: { S: JSON.stringify(preferences || {}) },
            },
        }));
        // Trigger content generation workflow
        await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
            Entries: [{
                    Source: 'automated-blog-poster.api',
                    DetailType: 'Content Generation Requested',
                    Detail: JSON.stringify({
                        contentId,
                        userId,
                        transcription,
                        userContext,
                        preferences,
                        timestamp,
                    }),
                    EventBusName: process.env.EVENT_BUS_NAME,
                }],
        }));
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Content generation initiated',
                data: { contentId },
                version: '1.0.0',
            }),
        };
    }
    catch (error) {
        console.error('Error in content generation:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Failed to initiate content generation',
                requestId: context.awsRequestId,
            }),
        };
    }
}
/**
 * Handle content revision request
 */
async function handleContentRevision(event, context, corsHeaders) {
    try {
        const body = JSON.parse(event.body || '{}');
        const { contentId, currentContent, feedback, revisionType, userId } = body;
        if (!contentId || !currentContent || !feedback || !userId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: 'contentId, currentContent, feedback, and userId are required',
                    requestId: context.awsRequestId,
                }),
            };
        }
        // Create revision record
        const revisionId = (0, uuid_1.v4)();
        const timestamp = new Date().toISOString();
        // Trigger content revision workflow
        await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
            Entries: [{
                    Source: 'automated-blog-poster.api',
                    DetailType: 'Content Revision Requested',
                    Detail: JSON.stringify({
                        contentId,
                        revisionId,
                        currentContent,
                        feedback,
                        revisionType: revisionType || 'content',
                        userId,
                        timestamp,
                    }),
                    EventBusName: process.env.EVENT_BUS_NAME,
                }],
        }));
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Content revision initiated',
                data: { revisionId },
                version: '1.0.0',
            }),
        };
    }
    catch (error) {
        console.error('Error in content revision:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Failed to initiate content revision',
                requestId: context.awsRequestId,
            }),
        };
    }
}
/**
 * Handle content status request
 */
async function handleContentStatus(contentId, context, corsHeaders) {
    try {
        const result = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
            TableName: process.env.CONTENT_TABLE_NAME,
            Key: {
                id: { S: contentId },
            },
        }));
        if (!result.Item) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Not Found',
                    message: 'Content not found',
                    requestId: context.awsRequestId,
                }),
            };
        }
        const status = {
            contentId,
            status: result.Item.status.S,
            progress: result.Item.progress?.N ? parseInt(result.Item.progress.N) : undefined,
            currentStep: result.Item.currentStep?.S,
            estimatedTimeRemaining: result.Item.estimatedTimeRemaining?.N ? parseInt(result.Item.estimatedTimeRemaining.N) : undefined,
            error: result.Item.error?.S,
        };
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Content status retrieved',
                data: status,
                version: '1.0.0',
            }),
        };
    }
    catch (error) {
        console.error('Error getting content status:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Failed to get content status',
                requestId: context.awsRequestId,
            }),
        };
    }
}
/**
 * Handle get content request
 */
async function handleGetContent(contentId, context, corsHeaders) {
    try {
        const result = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
            TableName: process.env.CONTENT_TABLE_NAME,
            Key: {
                id: { S: contentId },
            },
        }));
        if (!result.Item) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Not Found',
                    message: 'Content not found',
                    requestId: context.awsRequestId,
                }),
            };
        }
        const content = {
            id: result.Item.id.S,
            userId: result.Item.userId.S,
            title: result.Item.title?.S,
            originalTranscription: result.Item.originalTranscription.S,
            currentDraft: result.Item.currentDraft?.S || '',
            associatedImage: result.Item.associatedImage?.S,
            imageUrl: result.Item.imageUrl?.S,
            status: result.Item.status.S,
            revisionHistory: result.Item.revisionHistory?.S ? JSON.parse(result.Item.revisionHistory.S) : [],
            publishingResults: result.Item.publishingResults?.S ? JSON.parse(result.Item.publishingResults.S) : [],
            createdAt: result.Item.createdAt.S,
            updatedAt: result.Item.updatedAt.S,
        };
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Content retrieved',
                data: content,
                version: '1.0.0',
            }),
        };
    }
    catch (error) {
        console.error('Error getting content:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Failed to get content',
                requestId: context.awsRequestId,
            }),
        };
    }
}
/**
 * Handle content messages request
 */
async function handleContentMessages(contentId, context, corsHeaders) {
    try {
        const result = await dynamoClient.send(new client_dynamodb_1.QueryCommand({
            TableName: process.env.AGENT_MESSAGES_TABLE_NAME,
            IndexName: 'ContentIdIndex',
            KeyConditionExpression: 'contentId = :contentId',
            ExpressionAttributeValues: {
                ':contentId': { S: contentId },
            },
            ScanIndexForward: false, // Most recent first
        }));
        const messages = result.Items?.map(item => ({
            id: item.id.S,
            contentId: item.contentId.S,
            agentType: item.agentType.S,
            messageType: item.messageType.S,
            payload: item.payload.S ? JSON.parse(item.payload.S) : {},
            status: item.status?.S || 'pending',
            error: item.error?.S,
            result: item.result?.S ? JSON.parse(item.result.S) : undefined,
            createdAt: item.timestamp.S,
            processedAt: item.processedAt?.S,
        })) || [];
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Content messages retrieved',
                data: { messages },
                version: '1.0.0',
            }),
        };
    }
    catch (error) {
        console.error('Error getting content messages:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Failed to get content messages',
                requestId: context.awsRequestId,
            }),
        };
    }
}
/**
 * Handle content validation request
 */
async function handleContentValidation(event, context, corsHeaders) {
    try {
        const body = JSON.parse(event.body || '{}');
        const { content } = body;
        if (!content) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: 'content is required',
                    requestId: context.awsRequestId,
                }),
            };
        }
        // Basic content validation
        const issues = [];
        const suggestions = [];
        const wordCount = content.split(/\s+/).length;
        const charCount = content.length;
        if (wordCount < 100) {
            issues.push('Content is too short for a meaningful blog post');
        }
        if (charCount < 500) {
            issues.push('Content needs more detail and depth');
        }
        if (!content.includes('\n')) {
            suggestions.push('Consider breaking content into paragraphs for better readability');
        }
        if (!/[.!?]$/.test(content.trim())) {
            issues.push('Content should end with proper punctuation');
        }
        // Calculate quality score
        let score = 10;
        score -= issues.length * 2;
        score -= suggestions.length * 0.5;
        score = Math.max(0, Math.min(10, score));
        const validation = {
            isValid: issues.length === 0,
            score,
            issues,
            suggestions,
        };
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Content validation completed',
                data: validation,
                version: '1.0.0',
            }),
        };
    }
    catch (error) {
        console.error('Error validating content:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Failed to validate content',
                requestId: context.awsRequestId,
            }),
        };
    }
}
/**
 * Handle image status request
 */
async function handleImageStatus(contentId, context, corsHeaders) {
    try {
        const result = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
            TableName: process.env.CONTENT_TABLE_NAME,
            Key: {
                id: { S: contentId },
            },
        }));
        if (!result.Item) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Not Found',
                    message: 'Content not found',
                    requestId: context.awsRequestId,
                }),
            };
        }
        const status = result.Item.status.S;
        const imageUrl = result.Item.imageUrl?.S;
        const error = result.Item.error?.S;
        let imageStatus = 'pending';
        if (status === 'generating_image') {
            imageStatus = 'generating';
        }
        else if (status === 'image_generated' && imageUrl) {
            imageStatus = 'completed';
        }
        else if (status === 'image_generation_failed') {
            imageStatus = 'failed';
        }
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                contentId,
                status: imageStatus,
                imageUrl,
                error,
            }),
        };
    }
    catch (error) {
        console.error('Error getting image status:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Failed to get image status',
                requestId: context.awsRequestId,
            }),
        };
    }
}
/**
 * Handle image analysis request
 */
async function handleImageAnalysis(event, context, corsHeaders) {
    try {
        const body = JSON.parse(event.body || '{}');
        const { content } = body;
        if (!content) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: 'content is required',
                    requestId: context.awsRequestId,
                }),
            };
        }
        // Analyze content to generate image prompt
        const words = content.toLowerCase().split(/\s+/);
        const keyWords = words.filter((word) => word.length > 4 &&
            !['that', 'this', 'with', 'from', 'they', 'have', 'will', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other'].includes(word));
        // Take first few key concepts
        const concepts = keyWords.slice(0, 3).join(', ');
        // Determine style based on content
        let style = 'professional';
        if (content.toLowerCase().includes('creative') || content.toLowerCase().includes('art')) {
            style = 'creative';
        }
        else if (content.toLowerCase().includes('technical') || content.toLowerCase().includes('code')) {
            style = 'technical';
        }
        else if (content.toLowerCase().includes('minimal') || content.toLowerCase().includes('simple')) {
            style = 'minimal';
        }
        const prompt = `clean, modern, professional illustration representing ${concepts}, high quality, detailed`;
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                prompt,
                style,
            }),
        };
    }
    catch (error) {
        console.error('Error analyzing content for image:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Failed to analyze content',
                requestId: context.awsRequestId,
            }),
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhcGktaGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBd0c7QUFDeEcsb0RBQW9FO0FBQ3BFLG9FQUFrRjtBQUNsRiwrQkFBb0M7QUFDcEMseURBQTRGO0FBQzVGLDREQUE0RTtBQUM1RSx1REFBbUQ7QUFnQm5ELGtEQUFrRDtBQUNsRCxNQUFNLFlBQVksR0FBRyxJQUFJLGdDQUFjLENBQUM7SUFDdEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVTtJQUM5QixXQUFXLEVBQUUsQ0FBQztDQUNmLENBQUMsQ0FBQztBQUNILE1BQU0sU0FBUyxHQUFHLElBQUksc0JBQVMsQ0FBQztJQUM5QixNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVO0lBQzlCLFdBQVcsRUFBRSxDQUFDO0NBQ2YsQ0FBQyxDQUFDO0FBQ0gsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLHNDQUFpQixDQUFDO0lBQzlDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVU7SUFDOUIsV0FBVyxFQUFFLENBQUM7Q0FDZixDQUFDLENBQUM7QUFFSCwyQkFBMkI7QUFDM0IsTUFBTSxZQUFZLEdBQUcsSUFBSSw0QkFBWSxFQUFFLENBQUM7QUFFeEMsdUNBQXVDO0FBQ3ZDLE1BQU0sY0FBYyxHQUFHLElBQUksZ0NBQWMsRUFBRSxDQUFDO0FBRTVDLDBCQUEwQjtBQUMxQixNQUFNLFdBQVcsR0FBRyxJQUFJLDBCQUFXLEVBQUUsQ0FBQztBQUV0QywyREFBMkQ7QUFDM0QsU0FBUyxxQkFBcUIsQ0FBQyxLQUFZO0lBQ3pDLElBQUksS0FBSyxZQUFZLCtCQUFlO1FBQUUsT0FBTyxHQUFHLENBQUM7SUFDakQsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUM7UUFBRSxPQUFPLEdBQUcsQ0FBQztJQUNoRCxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQztRQUFFLE9BQU8sR0FBRyxDQUFDO0lBQ3BELElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDO1FBQUUsT0FBTyxHQUFHLENBQUM7SUFDakQsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUM7UUFBRSxPQUFPLEdBQUcsQ0FBQztJQUNsRCxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztRQUFFLE9BQU8sR0FBRyxDQUFDO0lBQy9DLE9BQU8sR0FBRyxDQUFDO0FBQ2IsQ0FBQztBQUVNLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFDMUIsS0FBMkIsRUFDM0IsT0FBZ0IsRUFDZ0IsRUFBRTtJQUNsQyxNQUFNLFlBQVksR0FBRztRQUNuQixZQUFZLEVBQUUsT0FBTyxDQUFDLFlBQVk7UUFDbEMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO1FBQy9CLFNBQVMsRUFBRSxHQUFHLEtBQUssQ0FBQyxVQUFVLElBQUksS0FBSyxDQUFDLElBQUksRUFBRTtRQUM5QyxNQUFNLEVBQUUsS0FBSyxDQUFDLGNBQWMsRUFBRSxVQUFVLEVBQUUsTUFBTTtLQUNqRCxDQUFDO0lBRUYsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDdEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFMUQsMkJBQTJCO0lBQzNCLE1BQU0sY0FBYyxHQUFHO1FBQ3JCLGtDQUFrQztRQUNsQyx1QkFBdUI7UUFDdkIsdUJBQXVCO0tBQ3hCLENBQUM7SUFFRixNQUFNLGFBQWEsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztJQUNuRSxNQUFNLGFBQWEsR0FBRyxjQUFjLENBQUMsUUFBUSxDQUFDLGFBQWEsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFeEcsTUFBTSxXQUFXLEdBQUc7UUFDbEIsNkJBQTZCLEVBQUUsYUFBYTtRQUM1Qyw4QkFBOEIsRUFBRSx1RkFBdUY7UUFDdkgsOEJBQThCLEVBQUUsNkJBQTZCO1FBQzdELGtDQUFrQyxFQUFFLE1BQU07UUFDMUMsY0FBYyxFQUFFLGtCQUFrQjtLQUNuQyxDQUFDO0lBRUYsSUFBSTtRQUNGLG9DQUFvQztRQUNwQyxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFO1lBQ2xDLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxFQUFFO2FBQ1QsQ0FBQztTQUNIO1FBRUQsaUJBQWlCO1FBQ2pCLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUM7UUFDeEIsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQztRQUVoQyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsTUFBTSxJQUFJLElBQUksRUFBRSxDQUFDLENBQUM7UUFFNUMsd0JBQXdCO1FBQ3hCLElBQUksTUFBTSxLQUFLLEtBQUssSUFBSSxJQUFJLEtBQUssR0FBRyxFQUFFO1lBQ3BDLE1BQU0sUUFBUSxHQUFvQjtnQkFDaEMsT0FBTyxFQUFFLHNDQUFzQztnQkFDL0MsT0FBTyxFQUFFLE9BQU87Z0JBQ2hCLElBQUksRUFBRTtvQkFDSixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7b0JBQ25DLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTtvQkFDL0IsV0FBVyxFQUFFO3dCQUNYLFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQjt3QkFDNUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZTt3QkFDdEMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCO3dCQUMxQyxXQUFXLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUI7cUJBQzNDO2lCQUNGO2FBQ0YsQ0FBQztZQUVGLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQzthQUMvQixDQUFDO1NBQ0g7UUFFRCxzQkFBc0I7UUFDdEIsSUFBSSxNQUFNLEtBQUssS0FBSyxJQUFJLElBQUksS0FBSyxhQUFhLEVBQUU7WUFDOUMsTUFBTSxRQUFRLEdBQW9CO2dCQUNoQyxPQUFPLEVBQUUsZ0JBQWdCO2dCQUN6QixPQUFPLEVBQUUsT0FBTztnQkFDaEIsSUFBSSxFQUFFO29CQUNKLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtvQkFDbkMsUUFBUSxFQUFFO3dCQUNSLFFBQVEsRUFBRSxXQUFXO3dCQUNyQixFQUFFLEVBQUUsV0FBVzt3QkFDZixHQUFHLEVBQUUsV0FBVzt3QkFDaEIsV0FBVyxFQUFFLFdBQVc7cUJBQ3pCO2lCQUNGO2FBQ0YsQ0FBQztZQUVGLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQzthQUMvQixDQUFDO1NBQ0g7UUFFRCwrQkFBK0I7UUFDL0IsSUFBSSxNQUFNLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyx1QkFBdUIsRUFBRTtZQUN6RCxPQUFPLE1BQU0sdUJBQXVCLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxXQUFXLENBQUMsQ0FBQztTQUNuRTtRQUVELElBQUksTUFBTSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUsscUJBQXFCLEVBQUU7WUFDdkQsT0FBTyxNQUFNLHFCQUFxQixDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDakU7UUFFRCxJQUFJLE1BQU0sS0FBSyxLQUFLLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFO1lBQy9ELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDeEMsT0FBTyxNQUFNLG1CQUFtQixDQUFDLFNBQVUsRUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDcEU7UUFFRCxJQUFJLE1BQU0sS0FBSyxLQUFLLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxlQUFlLENBQUMsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFO1lBQ3RGLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDbEMsTUFBTSxTQUFTLEdBQUcsU0FBUyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUM7WUFDbEQsT0FBTyxNQUFNLHFCQUFxQixDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDckU7UUFFRCxJQUFJLE1BQU0sS0FBSyxLQUFLLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUU7WUFDL0UsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUN4QyxPQUFPLE1BQU0sZ0JBQWdCLENBQUMsU0FBVSxFQUFFLE9BQU8sRUFBRSxXQUFXLENBQUMsQ0FBQztTQUNqRTtRQUVELElBQUksTUFBTSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssdUJBQXVCLEVBQUU7WUFDekQsT0FBTyxNQUFNLHVCQUF1QixDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7U0FDbkU7UUFFRCw2QkFBNkI7UUFDN0IsSUFBSSxNQUFNLEtBQUssS0FBSyxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsb0JBQW9CLENBQUMsRUFBRTtZQUM3RCxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO1lBQ3hDLE9BQU8sTUFBTSxpQkFBaUIsQ0FBQyxTQUFVLEVBQUUsT0FBTyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQ2xFO1FBRUQsSUFBSSxNQUFNLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxvQkFBb0IsRUFBRTtZQUN0RCxPQUFPLE1BQU0sbUJBQW1CLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxXQUFXLENBQUMsQ0FBQztTQUMvRDtRQUVELG1DQUFtQztRQUNuQyxNQUFNLGFBQWEsR0FBa0I7WUFDbkMsS0FBSyxFQUFFLFdBQVc7WUFDbEIsT0FBTyxFQUFFLFNBQVMsTUFBTSxJQUFJLElBQUksWUFBWTtZQUM1QyxTQUFTLEVBQUUsT0FBTyxDQUFDLFlBQVk7U0FDaEMsQ0FBQztRQUVGLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQztTQUNwQyxDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE1BQU0sR0FBRyxHQUFHLEtBQWMsQ0FBQztRQUMzQixNQUFNLFlBQVksQ0FBQyxXQUFXLENBQUMsR0FBRyxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBRWxELE1BQU0sYUFBYSxHQUFHLFlBQVksQ0FBQywwQkFBMEIsQ0FBQyxHQUFHLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFFakYsT0FBTztZQUNMLFVBQVUsRUFBRSxxQkFBcUIsQ0FBQyxHQUFHLENBQUM7WUFDdEMsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDO1NBQ3BDLENBQUM7S0FDSDtBQUNILENBQUMsQ0FBQztBQS9KVyxRQUFBLE9BQU8sV0ErSmxCO0FBRUY7O0dBRUc7QUFDSCxLQUFLLFVBQVUsdUJBQXVCLENBQ3BDLEtBQTJCLEVBQzNCLE9BQWdCLEVBQ2hCLFdBQW1DO0lBRW5DLElBQUk7UUFDRixNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLENBQUM7UUFDNUMsTUFBTSxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBRSxHQUFHLElBQUksQ0FBQztRQUVqRSxJQUFJLENBQUMsYUFBYSxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQzdCLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixLQUFLLEVBQUUsYUFBYTtvQkFDcEIsT0FBTyxFQUFFLHVDQUF1QztvQkFDaEQsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2lCQUNoQyxDQUFDO2FBQ0gsQ0FBQztTQUNIO1FBRUQsd0JBQXdCO1FBQ3hCLE1BQU0sU0FBUyxHQUFHLElBQUEsU0FBTSxHQUFFLENBQUM7UUFDM0IsTUFBTSxTQUFTLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUUzQyxNQUFNLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxnQ0FBYyxDQUFDO1lBQ3pDLFNBQVMsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFtQjtZQUMxQyxJQUFJLEVBQUU7Z0JBQ0osRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRTtnQkFDcEIsSUFBSSxFQUFFLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRTtnQkFDdEIsTUFBTSxFQUFFLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRTtnQkFDckIscUJBQXFCLEVBQUUsRUFBRSxDQUFDLEVBQUUsYUFBYSxFQUFFO2dCQUMzQyxNQUFNLEVBQUUsRUFBRSxDQUFDLEVBQUUsWUFBWSxFQUFFO2dCQUMzQixTQUFTLEVBQUUsRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFO2dCQUMzQixTQUFTLEVBQUUsRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFO2dCQUMzQixXQUFXLEVBQUUsRUFBRSxDQUFDLEVBQUUsV0FBVyxJQUFJLEVBQUUsRUFBRTtnQkFDckMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQyxFQUFFO2FBQ3REO1NBQ0YsQ0FBQyxDQUFDLENBQUM7UUFFSixzQ0FBc0M7UUFDdEMsTUFBTSxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxxQ0FBZ0IsQ0FBQztZQUNoRCxPQUFPLEVBQUUsQ0FBQztvQkFDUixNQUFNLEVBQUUsMkJBQTJCO29CQUNuQyxVQUFVLEVBQUUsOEJBQThCO29CQUMxQyxNQUFNLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQzt3QkFDckIsU0FBUzt3QkFDVCxNQUFNO3dCQUNOLGFBQWE7d0JBQ2IsV0FBVzt3QkFDWCxXQUFXO3dCQUNYLFNBQVM7cUJBQ1YsQ0FBQztvQkFDRixZQUFZLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFlO2lCQUMxQyxDQUFDO1NBQ0gsQ0FBQyxDQUFDLENBQUM7UUFFSixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsT0FBTyxFQUFFLDhCQUE4QjtnQkFDdkMsSUFBSSxFQUFFLEVBQUUsU0FBUyxFQUFFO2dCQUNuQixPQUFPLEVBQUUsT0FBTzthQUNqQixDQUFDO1NBQ0gsQ0FBQztLQUVIO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLDhCQUE4QixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3JELE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNuQixLQUFLLEVBQUUsdUJBQXVCO2dCQUM5QixPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsdUNBQXVDO2dCQUN6RixTQUFTLEVBQUUsT0FBTyxDQUFDLFlBQVk7YUFDaEMsQ0FBQztTQUNILENBQUM7S0FDSDtBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSxxQkFBcUIsQ0FDbEMsS0FBMkIsRUFDM0IsT0FBZ0IsRUFDaEIsV0FBbUM7SUFFbkMsSUFBSTtRQUNGLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsQ0FBQztRQUM1QyxNQUFNLEVBQUUsU0FBUyxFQUFFLGNBQWMsRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFFLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQztRQUUzRSxJQUFJLENBQUMsU0FBUyxJQUFJLENBQUMsY0FBYyxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ3pELE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixLQUFLLEVBQUUsYUFBYTtvQkFDcEIsT0FBTyxFQUFFLDhEQUE4RDtvQkFDdkUsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2lCQUNoQyxDQUFDO2FBQ0gsQ0FBQztTQUNIO1FBRUQseUJBQXlCO1FBQ3pCLE1BQU0sVUFBVSxHQUFHLElBQUEsU0FBTSxHQUFFLENBQUM7UUFDNUIsTUFBTSxTQUFTLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUUzQyxvQ0FBb0M7UUFDcEMsTUFBTSxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxxQ0FBZ0IsQ0FBQztZQUNoRCxPQUFPLEVBQUUsQ0FBQztvQkFDUixNQUFNLEVBQUUsMkJBQTJCO29CQUNuQyxVQUFVLEVBQUUsNEJBQTRCO29CQUN4QyxNQUFNLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQzt3QkFDckIsU0FBUzt3QkFDVCxVQUFVO3dCQUNWLGNBQWM7d0JBQ2QsUUFBUTt3QkFDUixZQUFZLEVBQUUsWUFBWSxJQUFJLFNBQVM7d0JBQ3ZDLE1BQU07d0JBQ04sU0FBUztxQkFDVixDQUFDO29CQUNGLFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWU7aUJBQzFDLENBQUM7U0FDSCxDQUFDLENBQUMsQ0FBQztRQUVKLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNuQixPQUFPLEVBQUUsNEJBQTRCO2dCQUNyQyxJQUFJLEVBQUUsRUFBRSxVQUFVLEVBQUU7Z0JBQ3BCLE9BQU8sRUFBRSxPQUFPO2FBQ2pCLENBQUM7U0FDSCxDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsNEJBQTRCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbkQsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUM7Z0JBQ3ZGLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTthQUNoQyxDQUFDO1NBQ0gsQ0FBQztLQUNIO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLG1CQUFtQixDQUNoQyxTQUFpQixFQUNqQixPQUFnQixFQUNoQixXQUFtQztJQUVuQyxJQUFJO1FBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksZ0NBQWMsQ0FBQztZQUN4RCxTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBbUI7WUFDMUMsR0FBRyxFQUFFO2dCQUNILEVBQUUsRUFBRSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUU7YUFDckI7U0FDRixDQUFDLENBQUMsQ0FBQztRQUVKLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFO1lBQ2hCLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixLQUFLLEVBQUUsV0FBVztvQkFDbEIsT0FBTyxFQUFFLG1CQUFtQjtvQkFDNUIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2lCQUNoQyxDQUFDO2FBQ0gsQ0FBQztTQUNIO1FBRUQsTUFBTSxNQUFNLEdBQUc7WUFDYixTQUFTO1lBQ1QsTUFBTSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUU7WUFDN0IsUUFBUSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQ2hGLFdBQVcsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ3ZDLHNCQUFzQixFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUMxSCxLQUFLLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztTQUM1QixDQUFDO1FBRUYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLE9BQU8sRUFBRSwwQkFBMEI7Z0JBQ25DLElBQUksRUFBRSxNQUFNO2dCQUNaLE9BQU8sRUFBRSxPQUFPO2FBQ2pCLENBQUM7U0FDSCxDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsK0JBQStCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDdEQsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyw4QkFBOEI7Z0JBQ2hGLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTthQUNoQyxDQUFDO1NBQ0gsQ0FBQztLQUNIO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLGdCQUFnQixDQUM3QixTQUFpQixFQUNqQixPQUFnQixFQUNoQixXQUFtQztJQUVuQyxJQUFJO1FBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksZ0NBQWMsQ0FBQztZQUN4RCxTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBbUI7WUFDMUMsR0FBRyxFQUFFO2dCQUNILEVBQUUsRUFBRSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUU7YUFDckI7U0FDRixDQUFDLENBQUMsQ0FBQztRQUVKLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFO1lBQ2hCLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixLQUFLLEVBQUUsV0FBVztvQkFDbEIsT0FBTyxFQUFFLG1CQUFtQjtvQkFDNUIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2lCQUNoQyxDQUFDO2FBQ0gsQ0FBQztTQUNIO1FBRUQsTUFBTSxPQUFPLEdBQUc7WUFDZCxFQUFFLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBRTtZQUNyQixNQUFNLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBRTtZQUM3QixLQUFLLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUMzQixxQkFBcUIsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLENBQUU7WUFDM0QsWUFBWSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUMsSUFBSSxFQUFFO1lBQy9DLGVBQWUsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQy9DLFFBQVEsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2pDLE1BQU0sRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFFO1lBQzdCLGVBQWUsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUU7WUFDaEcsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUN0RyxTQUFTLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBRTtZQUNuQyxTQUFTLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBRTtTQUNwQyxDQUFDO1FBRUYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLE9BQU8sRUFBRSxtQkFBbUI7Z0JBQzVCLElBQUksRUFBRSxPQUFPO2dCQUNiLE9BQU8sRUFBRSxPQUFPO2FBQ2pCLENBQUM7U0FDSCxDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDL0MsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyx1QkFBdUI7Z0JBQ3pFLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTthQUNoQyxDQUFDO1NBQ0gsQ0FBQztLQUNIO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLHFCQUFxQixDQUNsQyxTQUFpQixFQUNqQixPQUFnQixFQUNoQixXQUFtQztJQUVuQyxJQUFJO1FBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksOEJBQVksQ0FBQztZQUN0RCxTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBMEI7WUFDakQsU0FBUyxFQUFFLGdCQUFnQjtZQUMzQixzQkFBc0IsRUFBRSx3QkFBd0I7WUFDaEQseUJBQXlCLEVBQUU7Z0JBQ3pCLFlBQVksRUFBRSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUU7YUFDL0I7WUFDRCxnQkFBZ0IsRUFBRSxLQUFLLEVBQUUsb0JBQW9CO1NBQzlDLENBQUMsQ0FBQyxDQUFDO1FBRUosTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQzFDLEVBQUUsRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUU7WUFDZCxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFFO1lBQzVCLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUU7WUFDNUIsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBRTtZQUNoQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUN6RCxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksU0FBUztZQUNuQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ3BCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQzlELFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUU7WUFDNUIsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztTQUNqQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7UUFFVixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsT0FBTyxFQUFFLDRCQUE0QjtnQkFDckMsSUFBSSxFQUFFLEVBQUUsUUFBUSxFQUFFO2dCQUNsQixPQUFPLEVBQUUsT0FBTzthQUNqQixDQUFDO1NBQ0gsQ0FBQztLQUVIO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3hELE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxXQUFXO1lBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNuQixLQUFLLEVBQUUsdUJBQXVCO2dCQUM5QixPQUFPLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZ0NBQWdDO2dCQUNsRixTQUFTLEVBQUUsT0FBTyxDQUFDLFlBQVk7YUFDaEMsQ0FBQztTQUNILENBQUM7S0FDSDtBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILEtBQUssVUFBVSx1QkFBdUIsQ0FDcEMsS0FBMkIsRUFDM0IsT0FBZ0IsRUFDaEIsV0FBbUM7SUFFbkMsSUFBSTtRQUNGLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsQ0FBQztRQUM1QyxNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsSUFBSSxDQUFDO1FBRXpCLElBQUksQ0FBQyxPQUFPLEVBQUU7WUFDWixPQUFPO2dCQUNMLFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDbkIsS0FBSyxFQUFFLGFBQWE7b0JBQ3BCLE9BQU8sRUFBRSxxQkFBcUI7b0JBQzlCLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTtpQkFDaEMsQ0FBQzthQUNILENBQUM7U0FDSDtRQUVELDJCQUEyQjtRQUMzQixNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7UUFDNUIsTUFBTSxXQUFXLEdBQWEsRUFBRSxDQUFDO1FBRWpDLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDO1FBQzlDLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUM7UUFFakMsSUFBSSxTQUFTLEdBQUcsR0FBRyxFQUFFO1lBQ25CLE1BQU0sQ0FBQyxJQUFJLENBQUMsaURBQWlELENBQUMsQ0FBQztTQUNoRTtRQUVELElBQUksU0FBUyxHQUFHLEdBQUcsRUFBRTtZQUNuQixNQUFNLENBQUMsSUFBSSxDQUFDLHFDQUFxQyxDQUFDLENBQUM7U0FDcEQ7UUFFRCxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRTtZQUMzQixXQUFXLENBQUMsSUFBSSxDQUFDLGtFQUFrRSxDQUFDLENBQUM7U0FDdEY7UUFFRCxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUMsRUFBRTtZQUNsQyxNQUFNLENBQUMsSUFBSSxDQUFDLDRDQUE0QyxDQUFDLENBQUM7U0FDM0Q7UUFFRCwwQkFBMEI7UUFDMUIsSUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFDO1FBQ2YsS0FBSyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBQzNCLEtBQUssSUFBSSxXQUFXLENBQUMsTUFBTSxHQUFHLEdBQUcsQ0FBQztRQUNsQyxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztRQUV6QyxNQUFNLFVBQVUsR0FBRztZQUNqQixPQUFPLEVBQUUsTUFBTSxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQzVCLEtBQUs7WUFDTCxNQUFNO1lBQ04sV0FBVztTQUNaLENBQUM7UUFFRixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsT0FBTyxFQUFFLDhCQUE4QjtnQkFDdkMsSUFBSSxFQUFFLFVBQVU7Z0JBQ2hCLE9BQU8sRUFBRSxPQUFPO2FBQ2pCLENBQUM7U0FDSCxDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsMkJBQTJCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbEQsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyw0QkFBNEI7Z0JBQzlFLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTthQUNoQyxDQUFDO1NBQ0gsQ0FBQztLQUNIO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLGlCQUFpQixDQUM5QixTQUFpQixFQUNqQixPQUFnQixFQUNoQixXQUFtQztJQUVuQyxJQUFJO1FBQ0YsTUFBTSxNQUFNLEdBQUcsTUFBTSxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksZ0NBQWMsQ0FBQztZQUN4RCxTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBbUI7WUFDMUMsR0FBRyxFQUFFO2dCQUNILEVBQUUsRUFBRSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUU7YUFDckI7U0FDRixDQUFDLENBQUMsQ0FBQztRQUVKLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFO1lBQ2hCLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixLQUFLLEVBQUUsV0FBVztvQkFDbEIsT0FBTyxFQUFFLG1CQUFtQjtvQkFDNUIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2lCQUNoQyxDQUFDO2FBQ0gsQ0FBQztTQUNIO1FBRUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBRSxDQUFDO1FBQ3JDLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUN6QyxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7UUFFbkMsSUFBSSxXQUFXLEdBQXNELFNBQVMsQ0FBQztRQUUvRSxJQUFJLE1BQU0sS0FBSyxrQkFBa0IsRUFBRTtZQUNqQyxXQUFXLEdBQUcsWUFBWSxDQUFDO1NBQzVCO2FBQU0sSUFBSSxNQUFNLEtBQUssaUJBQWlCLElBQUksUUFBUSxFQUFFO1lBQ25ELFdBQVcsR0FBRyxXQUFXLENBQUM7U0FDM0I7YUFBTSxJQUFJLE1BQU0sS0FBSyx5QkFBeUIsRUFBRTtZQUMvQyxXQUFXLEdBQUcsUUFBUSxDQUFDO1NBQ3hCO1FBRUQsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLFNBQVM7Z0JBQ1QsTUFBTSxFQUFFLFdBQVc7Z0JBQ25CLFFBQVE7Z0JBQ1IsS0FBSzthQUNOLENBQUM7U0FDSCxDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsNkJBQTZCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDcEQsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLFdBQVc7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyw0QkFBNEI7Z0JBQzlFLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTthQUNoQyxDQUFDO1NBQ0gsQ0FBQztLQUNIO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLG1CQUFtQixDQUNoQyxLQUEyQixFQUMzQixPQUFnQixFQUNoQixXQUFtQztJQUVuQyxJQUFJO1FBQ0YsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxDQUFDO1FBQzVDLE1BQU0sRUFBRSxPQUFPLEVBQUUsR0FBRyxJQUFJLENBQUM7UUFFekIsSUFBSSxDQUFDLE9BQU8sRUFBRTtZQUNaLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixLQUFLLEVBQUUsYUFBYTtvQkFDcEIsT0FBTyxFQUFFLHFCQUFxQjtvQkFDOUIsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2lCQUNoQyxDQUFDO2FBQ0gsQ0FBQztTQUNIO1FBRUQsMkNBQTJDO1FBQzNDLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDakQsTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQVksRUFBRSxFQUFFLENBQzdDLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUNmLENBQUMsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FDdkssQ0FBQztRQUVGLDhCQUE4QjtRQUM5QixNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFakQsbUNBQW1DO1FBQ25DLElBQUksS0FBSyxHQUFHLGNBQWMsQ0FBQztRQUMzQixJQUFJLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksT0FBTyxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRTtZQUN2RixLQUFLLEdBQUcsVUFBVSxDQUFDO1NBQ3BCO2FBQU0sSUFBSSxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEVBQUU7WUFDaEcsS0FBSyxHQUFHLFdBQVcsQ0FBQztTQUNyQjthQUFNLElBQUksT0FBTyxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxFQUFFO1lBQ2hHLEtBQUssR0FBRyxTQUFTLENBQUM7U0FDbkI7UUFFRCxNQUFNLE1BQU0sR0FBRyx5REFBeUQsUUFBUSwwQkFBMEIsQ0FBQztRQUUzRyxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsTUFBTTtnQkFDTixLQUFLO2FBQ04sQ0FBQztTQUNILENBQUM7S0FFSDtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ2QsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQ0FBb0MsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMzRCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsS0FBSyxFQUFFLHVCQUF1QjtnQkFDOUIsT0FBTyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLDJCQUEyQjtnQkFDN0UsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2FBQ2hDLENBQUM7U0FDSCxDQUFDO0tBQ0g7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCwgUHV0SXRlbUNvbW1hbmQsIEdldEl0ZW1Db21tYW5kLCBRdWVyeUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBTUVNDbGllbnQsIFNlbmRNZXNzYWdlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xyXG5pbXBvcnQgeyBFdmVudEJyaWRnZUNsaWVudCwgUHV0RXZlbnRzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZSc7XHJcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xyXG5pbXBvcnQgeyBFcnJvckhhbmRsZXIsIERFRkFVTFRfUkVUUllfQ09ORklHLCBWYWxpZGF0aW9uRXJyb3IgfSBmcm9tICcuL3V0aWxzL2Vycm9yLWhhbmRsZXInO1xyXG5pbXBvcnQgeyBBdXRoTWlkZGxld2FyZSwgQXV0aGVudGljYXRlZEV2ZW50IH0gZnJvbSAnLi9hdXRoL2F1dGgtbWlkZGxld2FyZSc7XHJcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi91dGlscy9hdWRpdC1sb2dnZXInO1xyXG5cclxuaW50ZXJmYWNlIEVycm9yUmVzcG9uc2Uge1xyXG4gIGVycm9yOiBzdHJpbmc7XHJcbiAgbWVzc2FnZTogc3RyaW5nO1xyXG4gIHJlcXVlc3RJZD86IHN0cmluZztcclxuICByZXRyeWFibGU/OiBib29sZWFuO1xyXG4gIHN1Z2dlc3RlZEFjdGlvbj86IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFN1Y2Nlc3NSZXNwb25zZSB7XHJcbiAgbWVzc2FnZTogc3RyaW5nO1xyXG4gIGRhdGE/OiBhbnk7XHJcbiAgdmVyc2lvbjogc3RyaW5nO1xyXG59XHJcblxyXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzIHdpdGggcmV0cnkgY29uZmlndXJhdGlvblxyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyBcclxuICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04sXHJcbiAgbWF4QXR0ZW1wdHM6IDMsXHJcbn0pO1xyXG5jb25zdCBzcXNDbGllbnQgPSBuZXcgU1FTQ2xpZW50KHsgXHJcbiAgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OLFxyXG4gIG1heEF0dGVtcHRzOiAzLFxyXG59KTtcclxuY29uc3QgZXZlbnRCcmlkZ2VDbGllbnQgPSBuZXcgRXZlbnRCcmlkZ2VDbGllbnQoeyBcclxuICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04sXHJcbiAgbWF4QXR0ZW1wdHM6IDMsXHJcbn0pO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBlcnJvciBoYW5kbGVyXHJcbmNvbnN0IGVycm9ySGFuZGxlciA9IG5ldyBFcnJvckhhbmRsZXIoKTtcclxuXHJcbi8vIEluaXRpYWxpemUgYXV0aGVudGljYXRpb24gbWlkZGxld2FyZVxyXG5jb25zdCBhdXRoTWlkZGxld2FyZSA9IG5ldyBBdXRoTWlkZGxld2FyZSgpO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBhdWRpdCBsb2dnZXJcclxuY29uc3QgYXVkaXRMb2dnZXIgPSBuZXcgQXVkaXRMb2dnZXIoKTtcclxuXHJcbi8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgSFRUUCBzdGF0dXMgY29kZSBmcm9tIGVycm9yXHJcbmZ1bmN0aW9uIGdldFN0YXR1c0NvZGVGb3JFcnJvcihlcnJvcjogRXJyb3IpOiBudW1iZXIge1xyXG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIFZhbGlkYXRpb25FcnJvcikgcmV0dXJuIDQwMDtcclxuICBpZiAoZXJyb3IubmFtZS5pbmNsdWRlcygnTm90Rm91bmQnKSkgcmV0dXJuIDQwNDtcclxuICBpZiAoZXJyb3IubmFtZS5pbmNsdWRlcygnVW5hdXRob3JpemVkJykpIHJldHVybiA0MDE7XHJcbiAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ0ZvcmJpZGRlbicpKSByZXR1cm4gNDAzO1xyXG4gIGlmIChlcnJvci5uYW1lLmluY2x1ZGVzKCdUaHJvdHRsaW5nJykpIHJldHVybiA0Mjk7XHJcbiAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ1RpbWVvdXQnKSkgcmV0dXJuIDQwODtcclxuICByZXR1cm4gNTAwO1xyXG59XHJcblxyXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dFxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xyXG4gIGNvbnN0IGVycm9yQ29udGV4dCA9IHtcclxuICAgIGZ1bmN0aW9uTmFtZTogY29udGV4dC5mdW5jdGlvbk5hbWUsXHJcbiAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgb3BlcmF0aW9uOiBgJHtldmVudC5odHRwTWV0aG9kfSAke2V2ZW50LnBhdGh9YCxcclxuICAgIHVzZXJJZDogZXZlbnQucmVxdWVzdENvbnRleHQ/LmF1dGhvcml6ZXI/LnVzZXJJZCxcclxuICB9O1xyXG5cclxuICBjb25zb2xlLmxvZygnRXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcclxuICBjb25zb2xlLmxvZygnQ29udGV4dDonLCBKU09OLnN0cmluZ2lmeShjb250ZXh0LCBudWxsLCAyKSk7XHJcblxyXG4gIC8vIEFsbG93ZWQgb3JpZ2lucyBmb3IgQ09SU1xyXG4gIGNvbnN0IGFsbG93ZWRPcmlnaW5zID0gW1xyXG4gICAgJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJyxcclxuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLFxyXG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycsXHJcbiAgXTtcclxuICBcclxuICBjb25zdCByZXF1ZXN0T3JpZ2luID0gZXZlbnQuaGVhZGVycy5vcmlnaW4gfHwgZXZlbnQuaGVhZGVycy5PcmlnaW47XHJcbiAgY29uc3QgYWxsb3dlZE9yaWdpbiA9IGFsbG93ZWRPcmlnaW5zLmluY2x1ZGVzKHJlcXVlc3RPcmlnaW4gfHwgJycpID8gcmVxdWVzdE9yaWdpbiEgOiBhbGxvd2VkT3JpZ2luc1swXTtcclxuXHJcbiAgY29uc3QgY29yc0hlYWRlcnMgPSB7XHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYWxsb3dlZE9yaWdpbixcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxBdXRob3JpemF0aW9uLFgtQW16LURhdGUsWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtUmVxdWVzdGVkLVdpdGgnLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULFBPU1QsUFVULERFTEVURSxPUFRJT05TJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6ICd0cnVlJyxcclxuICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgfTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIEhhbmRsZSBwcmVmbGlnaHQgT1BUSU9OUyByZXF1ZXN0c1xyXG4gICAgaWYgKGV2ZW50Lmh0dHBNZXRob2QgPT09ICdPUFRJT05TJykge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiAnJyxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSb3V0ZSBoYW5kbGluZ1xyXG4gICAgY29uc3QgcGF0aCA9IGV2ZW50LnBhdGg7XHJcbiAgICBjb25zdCBtZXRob2QgPSBldmVudC5odHRwTWV0aG9kO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nICR7bWV0aG9kfSAke3BhdGh9YCk7XHJcblxyXG4gICAgLy8gSGVhbHRoIGNoZWNrIGVuZHBvaW50XHJcbiAgICBpZiAobWV0aG9kID09PSAnR0VUJyAmJiBwYXRoID09PSAnLycpIHtcclxuICAgICAgY29uc3QgcmVzcG9uc2U6IFN1Y2Nlc3NSZXNwb25zZSA9IHtcclxuICAgICAgICBtZXNzYWdlOiAnQXV0b21hdGVkIEJsb2cgUG9zdGVyIEFQSSBpcyBydW5uaW5nJyxcclxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxyXG4gICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgICAgIGNvbnRlbnRUYWJsZTogcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FLFxyXG4gICAgICAgICAgICB1c2VyVGFibGU6IHByb2Nlc3MuZW52LlVTRVJfVEFCTEVfTkFNRSxcclxuICAgICAgICAgICAgYXVkaW9CdWNrZXQ6IHByb2Nlc3MuZW52LkFVRElPX0JVQ0tFVF9OQU1FLFxyXG4gICAgICAgICAgICBpbWFnZUJ1Y2tldDogcHJvY2Vzcy5lbnYuSU1BR0VfQlVDS0VUX05BTUUsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH07XHJcblxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQVBJIHN0YXR1cyBlbmRwb2ludFxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aCA9PT0gJy9hcGkvc3RhdHVzJykge1xyXG4gICAgICBjb25zdCByZXNwb25zZTogU3VjY2Vzc1Jlc3BvbnNlID0ge1xyXG4gICAgICAgIG1lc3NhZ2U6ICdBUEkgaXMgaGVhbHRoeScsXHJcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcclxuICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgIHNlcnZpY2VzOiB7XHJcbiAgICAgICAgICAgIGR5bmFtb2RiOiAnYXZhaWxhYmxlJyxcclxuICAgICAgICAgICAgczM6ICdhdmFpbGFibGUnLFxyXG4gICAgICAgICAgICBzcXM6ICdhdmFpbGFibGUnLFxyXG4gICAgICAgICAgICBldmVudGJyaWRnZTogJ2F2YWlsYWJsZScsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH07XHJcblxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ29udGVudCBnZW5lcmF0aW9uIGVuZHBvaW50c1xyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2NvbnRlbnQvZ2VuZXJhdGUnKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVDb250ZW50R2VuZXJhdGlvbihldmVudCwgY29udGV4dCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9jb250ZW50L3JldmlzZScpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUNvbnRlbnRSZXZpc2lvbihldmVudCwgY29udGV4dCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdHRVQnICYmIHBhdGguc3RhcnRzV2l0aCgnL2FwaS9jb250ZW50L3N0YXR1cy8nKSkge1xyXG4gICAgICBjb25zdCBjb250ZW50SWQgPSBwYXRoLnNwbGl0KCcvJykucG9wKCk7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVDb250ZW50U3RhdHVzKGNvbnRlbnRJZCEsIGNvbnRleHQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobWV0aG9kID09PSAnR0VUJyAmJiBwYXRoLnN0YXJ0c1dpdGgoJy9hcGkvY29udGVudC8nKSAmJiBwYXRoLmVuZHNXaXRoKCcvbWVzc2FnZXMnKSkge1xyXG4gICAgICBjb25zdCBwYXRoUGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XHJcbiAgICAgIGNvbnN0IGNvbnRlbnRJZCA9IHBhdGhQYXJ0c1twYXRoUGFydHMubGVuZ3RoIC0gMl07XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVDb250ZW50TWVzc2FnZXMoY29udGVudElkLCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aC5zdGFydHNXaXRoKCcvYXBpL2NvbnRlbnQvJykgJiYgIXBhdGguaW5jbHVkZXMoJy8nKSkge1xyXG4gICAgICBjb25zdCBjb250ZW50SWQgPSBwYXRoLnNwbGl0KCcvJykucG9wKCk7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVHZXRDb250ZW50KGNvbnRlbnRJZCEsIGNvbnRleHQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9hcGkvY29udGVudC92YWxpZGF0ZScpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUNvbnRlbnRWYWxpZGF0aW9uKGV2ZW50LCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSW1hZ2UgZ2VuZXJhdGlvbiBlbmRwb2ludHNcclxuICAgIGlmIChtZXRob2QgPT09ICdHRVQnICYmIHBhdGguc3RhcnRzV2l0aCgnL2FwaS9pbWFnZS9zdGF0dXMvJykpIHtcclxuICAgICAgY29uc3QgY29udGVudElkID0gcGF0aC5zcGxpdCgnLycpLnBvcCgpO1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlSW1hZ2VTdGF0dXMoY29udGVudElkISwgY29udGV4dCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9pbWFnZS9hbmFseXplJykge1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlSW1hZ2VBbmFseXNpcyhldmVudCwgY29udGV4dCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIERlZmF1bHQgNDA0IGZvciB1bm1hdGNoZWQgcm91dGVzXHJcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlOiBFcnJvclJlc3BvbnNlID0ge1xyXG4gICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgIG1lc3NhZ2U6IGBSb3V0ZSAke21ldGhvZH0gJHtwYXRofSBub3QgZm91bmRgLFxyXG4gICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShlcnJvclJlc3BvbnNlKSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zdCBlcnIgPSBlcnJvciBhcyBFcnJvcjtcclxuICAgIGF3YWl0IGVycm9ySGFuZGxlci5oYW5kbGVFcnJvcihlcnIsIGVycm9yQ29udGV4dCk7XHJcblxyXG4gICAgY29uc3QgZXJyb3JSZXNwb25zZSA9IGVycm9ySGFuZGxlci5jcmVhdGVVc2VyRnJpZW5kbHlSZXNwb25zZShlcnIsIGVycm9yQ29udGV4dCk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogZ2V0U3RhdHVzQ29kZUZvckVycm9yKGVyciksXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShlcnJvclJlc3BvbnNlKSxcclxuICAgIH07XHJcbiAgfVxyXG59O1xyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBjb250ZW50IGdlbmVyYXRpb24gcmVxdWVzdFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ29udGVudEdlbmVyYXRpb24oXHJcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LFxyXG4gIGNvbnRleHQ6IENvbnRleHQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSB8fCAne30nKTtcclxuICAgIGNvbnN0IHsgdHJhbnNjcmlwdGlvbiwgdXNlcklkLCB1c2VyQ29udGV4dCwgcHJlZmVyZW5jZXMgfSA9IGJvZHk7XHJcblxyXG4gICAgaWYgKCF0cmFuc2NyaXB0aW9uIHx8ICF1c2VySWQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdCYWQgUmVxdWVzdCcsXHJcbiAgICAgICAgICBtZXNzYWdlOiAndHJhbnNjcmlwdGlvbiBhbmQgdXNlcklkIGFyZSByZXF1aXJlZCcsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENyZWF0ZSBjb250ZW50IHJlY29yZFxyXG4gICAgY29uc3QgY29udGVudElkID0gdXVpZHY0KCk7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IFB1dEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUhLFxyXG4gICAgICBJdGVtOiB7XHJcbiAgICAgICAgaWQ6IHsgUzogY29udGVudElkIH0sXHJcbiAgICAgICAgdHlwZTogeyBTOiAnY29udGVudCcgfSxcclxuICAgICAgICB1c2VySWQ6IHsgUzogdXNlcklkIH0sXHJcbiAgICAgICAgb3JpZ2luYWxUcmFuc2NyaXB0aW9uOiB7IFM6IHRyYW5zY3JpcHRpb24gfSxcclxuICAgICAgICBzdGF0dXM6IHsgUzogJ3Byb2Nlc3NpbmcnIH0sXHJcbiAgICAgICAgY3JlYXRlZEF0OiB7IFM6IHRpbWVzdGFtcCB9LFxyXG4gICAgICAgIHVwZGF0ZWRBdDogeyBTOiB0aW1lc3RhbXAgfSxcclxuICAgICAgICB1c2VyQ29udGV4dDogeyBTOiB1c2VyQ29udGV4dCB8fCAnJyB9LFxyXG4gICAgICAgIHByZWZlcmVuY2VzOiB7IFM6IEpTT04uc3RyaW5naWZ5KHByZWZlcmVuY2VzIHx8IHt9KSB9LFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFRyaWdnZXIgY29udGVudCBnZW5lcmF0aW9uIHdvcmtmbG93XHJcbiAgICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcclxuICAgICAgRW50cmllczogW3tcclxuICAgICAgICBTb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuYXBpJyxcclxuICAgICAgICBEZXRhaWxUeXBlOiAnQ29udGVudCBHZW5lcmF0aW9uIFJlcXVlc3RlZCcsXHJcbiAgICAgICAgRGV0YWlsOiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBjb250ZW50SWQsXHJcbiAgICAgICAgICB1c2VySWQsXHJcbiAgICAgICAgICB0cmFuc2NyaXB0aW9uLFxyXG4gICAgICAgICAgdXNlckNvbnRleHQsXHJcbiAgICAgICAgICBwcmVmZXJlbmNlcyxcclxuICAgICAgICAgIHRpbWVzdGFtcCxcclxuICAgICAgICB9KSxcclxuICAgICAgICBFdmVudEJ1c05hbWU6IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FISxcclxuICAgICAgfV0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IGdlbmVyYXRpb24gaW5pdGlhdGVkJyxcclxuICAgICAgICBkYXRhOiB7IGNvbnRlbnRJZCB9LFxyXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGNvbnRlbnQgZ2VuZXJhdGlvbjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ0ZhaWxlZCB0byBpbml0aWF0ZSBjb250ZW50IGdlbmVyYXRpb24nLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgY29udGVudCByZXZpc2lvbiByZXF1ZXN0XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVDb250ZW50UmV2aXNpb24oXHJcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LFxyXG4gIGNvbnRleHQ6IENvbnRleHQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSB8fCAne30nKTtcclxuICAgIGNvbnN0IHsgY29udGVudElkLCBjdXJyZW50Q29udGVudCwgZmVlZGJhY2ssIHJldmlzaW9uVHlwZSwgdXNlcklkIH0gPSBib2R5O1xyXG5cclxuICAgIGlmICghY29udGVudElkIHx8ICFjdXJyZW50Q29udGVudCB8fCAhZmVlZGJhY2sgfHwgIXVzZXJJZCkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBlcnJvcjogJ0JhZCBSZXF1ZXN0JyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICdjb250ZW50SWQsIGN1cnJlbnRDb250ZW50LCBmZWVkYmFjaywgYW5kIHVzZXJJZCBhcmUgcmVxdWlyZWQnLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgcmV2aXNpb24gcmVjb3JkXHJcbiAgICBjb25zdCByZXZpc2lvbklkID0gdXVpZHY0KCk7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgLy8gVHJpZ2dlciBjb250ZW50IHJldmlzaW9uIHdvcmtmbG93XHJcbiAgICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcclxuICAgICAgRW50cmllczogW3tcclxuICAgICAgICBTb3VyY2U6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuYXBpJyxcclxuICAgICAgICBEZXRhaWxUeXBlOiAnQ29udGVudCBSZXZpc2lvbiBSZXF1ZXN0ZWQnLFxyXG4gICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgY29udGVudElkLFxyXG4gICAgICAgICAgcmV2aXNpb25JZCxcclxuICAgICAgICAgIGN1cnJlbnRDb250ZW50LFxyXG4gICAgICAgICAgZmVlZGJhY2ssXHJcbiAgICAgICAgICByZXZpc2lvblR5cGU6IHJldmlzaW9uVHlwZSB8fCAnY29udGVudCcsXHJcbiAgICAgICAgICB1c2VySWQsXHJcbiAgICAgICAgICB0aW1lc3RhbXAsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgRXZlbnRCdXNOYW1lOiBwcm9jZXNzLmVudi5FVkVOVF9CVVNfTkFNRSEsXHJcbiAgICAgIH1dLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBtZXNzYWdlOiAnQ29udGVudCByZXZpc2lvbiBpbml0aWF0ZWQnLFxyXG4gICAgICAgIGRhdGE6IHsgcmV2aXNpb25JZCB9LFxyXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGNvbnRlbnQgcmV2aXNpb246JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdGYWlsZWQgdG8gaW5pdGlhdGUgY29udGVudCByZXZpc2lvbicsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBjb250ZW50IHN0YXR1cyByZXF1ZXN0XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVDb250ZW50U3RhdHVzKFxyXG4gIGNvbnRlbnRJZDogc3RyaW5nLFxyXG4gIGNvbnRleHQ6IENvbnRleHQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUhLFxyXG4gICAgICBLZXk6IHtcclxuICAgICAgICBpZDogeyBTOiBjb250ZW50SWQgfSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDA0LFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnTm90IEZvdW5kJyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHN0YXR1cyA9IHtcclxuICAgICAgY29udGVudElkLFxyXG4gICAgICBzdGF0dXM6IHJlc3VsdC5JdGVtLnN0YXR1cy5TISxcclxuICAgICAgcHJvZ3Jlc3M6IHJlc3VsdC5JdGVtLnByb2dyZXNzPy5OID8gcGFyc2VJbnQocmVzdWx0Lkl0ZW0ucHJvZ3Jlc3MuTikgOiB1bmRlZmluZWQsXHJcbiAgICAgIGN1cnJlbnRTdGVwOiByZXN1bHQuSXRlbS5jdXJyZW50U3RlcD8uUyxcclxuICAgICAgZXN0aW1hdGVkVGltZVJlbWFpbmluZzogcmVzdWx0Lkl0ZW0uZXN0aW1hdGVkVGltZVJlbWFpbmluZz8uTiA/IHBhcnNlSW50KHJlc3VsdC5JdGVtLmVzdGltYXRlZFRpbWVSZW1haW5pbmcuTikgOiB1bmRlZmluZWQsXHJcbiAgICAgIGVycm9yOiByZXN1bHQuSXRlbS5lcnJvcj8uUyxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IHN0YXR1cyByZXRyaWV2ZWQnLFxyXG4gICAgICAgIGRhdGE6IHN0YXR1cyxcclxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIGNvbnRlbnQgc3RhdHVzOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnRmFpbGVkIHRvIGdldCBjb250ZW50IHN0YXR1cycsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBnZXQgY29udGVudCByZXF1ZXN0XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVHZXRDb250ZW50KFxyXG4gIGNvbnRlbnRJZDogc3RyaW5nLFxyXG4gIGNvbnRleHQ6IENvbnRleHQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUhLFxyXG4gICAgICBLZXk6IHtcclxuICAgICAgICBpZDogeyBTOiBjb250ZW50SWQgfSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDA0LFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnTm90IEZvdW5kJyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGNvbnRlbnQgPSB7XHJcbiAgICAgIGlkOiByZXN1bHQuSXRlbS5pZC5TISxcclxuICAgICAgdXNlcklkOiByZXN1bHQuSXRlbS51c2VySWQuUyEsXHJcbiAgICAgIHRpdGxlOiByZXN1bHQuSXRlbS50aXRsZT8uUyxcclxuICAgICAgb3JpZ2luYWxUcmFuc2NyaXB0aW9uOiByZXN1bHQuSXRlbS5vcmlnaW5hbFRyYW5zY3JpcHRpb24uUyEsXHJcbiAgICAgIGN1cnJlbnREcmFmdDogcmVzdWx0Lkl0ZW0uY3VycmVudERyYWZ0Py5TIHx8ICcnLFxyXG4gICAgICBhc3NvY2lhdGVkSW1hZ2U6IHJlc3VsdC5JdGVtLmFzc29jaWF0ZWRJbWFnZT8uUyxcclxuICAgICAgaW1hZ2VVcmw6IHJlc3VsdC5JdGVtLmltYWdlVXJsPy5TLFxyXG4gICAgICBzdGF0dXM6IHJlc3VsdC5JdGVtLnN0YXR1cy5TISxcclxuICAgICAgcmV2aXNpb25IaXN0b3J5OiByZXN1bHQuSXRlbS5yZXZpc2lvbkhpc3Rvcnk/LlMgPyBKU09OLnBhcnNlKHJlc3VsdC5JdGVtLnJldmlzaW9uSGlzdG9yeS5TKSA6IFtdLFxyXG4gICAgICBwdWJsaXNoaW5nUmVzdWx0czogcmVzdWx0Lkl0ZW0ucHVibGlzaGluZ1Jlc3VsdHM/LlMgPyBKU09OLnBhcnNlKHJlc3VsdC5JdGVtLnB1Ymxpc2hpbmdSZXN1bHRzLlMpIDogW10sXHJcbiAgICAgIGNyZWF0ZWRBdDogcmVzdWx0Lkl0ZW0uY3JlYXRlZEF0LlMhLFxyXG4gICAgICB1cGRhdGVkQXQ6IHJlc3VsdC5JdGVtLnVwZGF0ZWRBdC5TISxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IHJldHJpZXZlZCcsXHJcbiAgICAgICAgZGF0YTogY29udGVudCxcclxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIGNvbnRlbnQ6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdGYWlsZWQgdG8gZ2V0IGNvbnRlbnQnLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgY29udGVudCBtZXNzYWdlcyByZXF1ZXN0XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVDb250ZW50TWVzc2FnZXMoXHJcbiAgY29udGVudElkOiBzdHJpbmcsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5BR0VOVF9NRVNTQUdFU19UQUJMRV9OQU1FISxcclxuICAgICAgSW5kZXhOYW1lOiAnQ29udGVudElkSW5kZXgnLFxyXG4gICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAnY29udGVudElkID0gOmNvbnRlbnRJZCcsXHJcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAnOmNvbnRlbnRJZCc6IHsgUzogY29udGVudElkIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIFNjYW5JbmRleEZvcndhcmQ6IGZhbHNlLCAvLyBNb3N0IHJlY2VudCBmaXJzdFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGNvbnN0IG1lc3NhZ2VzID0gcmVzdWx0Lkl0ZW1zPy5tYXAoaXRlbSA9PiAoe1xyXG4gICAgICBpZDogaXRlbS5pZC5TISxcclxuICAgICAgY29udGVudElkOiBpdGVtLmNvbnRlbnRJZC5TISxcclxuICAgICAgYWdlbnRUeXBlOiBpdGVtLmFnZW50VHlwZS5TISxcclxuICAgICAgbWVzc2FnZVR5cGU6IGl0ZW0ubWVzc2FnZVR5cGUuUyEsXHJcbiAgICAgIHBheWxvYWQ6IGl0ZW0ucGF5bG9hZC5TID8gSlNPTi5wYXJzZShpdGVtLnBheWxvYWQuUykgOiB7fSxcclxuICAgICAgc3RhdHVzOiBpdGVtLnN0YXR1cz8uUyB8fCAncGVuZGluZycsXHJcbiAgICAgIGVycm9yOiBpdGVtLmVycm9yPy5TLFxyXG4gICAgICByZXN1bHQ6IGl0ZW0ucmVzdWx0Py5TID8gSlNPTi5wYXJzZShpdGVtLnJlc3VsdC5TKSA6IHVuZGVmaW5lZCxcclxuICAgICAgY3JlYXRlZEF0OiBpdGVtLnRpbWVzdGFtcC5TISxcclxuICAgICAgcHJvY2Vzc2VkQXQ6IGl0ZW0ucHJvY2Vzc2VkQXQ/LlMsXHJcbiAgICB9KSkgfHwgW107XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IG1lc3NhZ2VzIHJldHJpZXZlZCcsXHJcbiAgICAgICAgZGF0YTogeyBtZXNzYWdlcyB9LFxyXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgY29udGVudCBtZXNzYWdlczonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ0ZhaWxlZCB0byBnZXQgY29udGVudCBtZXNzYWdlcycsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBjb250ZW50IHZhbGlkYXRpb24gcmVxdWVzdFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ29udGVudFZhbGlkYXRpb24oXHJcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LFxyXG4gIGNvbnRleHQ6IENvbnRleHQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSB8fCAne30nKTtcclxuICAgIGNvbnN0IHsgY29udGVudCB9ID0gYm9keTtcclxuXHJcbiAgICBpZiAoIWNvbnRlbnQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdCYWQgUmVxdWVzdCcsXHJcbiAgICAgICAgICBtZXNzYWdlOiAnY29udGVudCBpcyByZXF1aXJlZCcsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEJhc2ljIGNvbnRlbnQgdmFsaWRhdGlvblxyXG4gICAgY29uc3QgaXNzdWVzOiBzdHJpbmdbXSA9IFtdO1xyXG4gICAgY29uc3Qgc3VnZ2VzdGlvbnM6IHN0cmluZ1tdID0gW107XHJcbiAgICBcclxuICAgIGNvbnN0IHdvcmRDb3VudCA9IGNvbnRlbnQuc3BsaXQoL1xccysvKS5sZW5ndGg7XHJcbiAgICBjb25zdCBjaGFyQ291bnQgPSBjb250ZW50Lmxlbmd0aDtcclxuXHJcbiAgICBpZiAod29yZENvdW50IDwgMTAwKSB7XHJcbiAgICAgIGlzc3Vlcy5wdXNoKCdDb250ZW50IGlzIHRvbyBzaG9ydCBmb3IgYSBtZWFuaW5nZnVsIGJsb2cgcG9zdCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChjaGFyQ291bnQgPCA1MDApIHtcclxuICAgICAgaXNzdWVzLnB1c2goJ0NvbnRlbnQgbmVlZHMgbW9yZSBkZXRhaWwgYW5kIGRlcHRoJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFjb250ZW50LmluY2x1ZGVzKCdcXG4nKSkge1xyXG4gICAgICBzdWdnZXN0aW9ucy5wdXNoKCdDb25zaWRlciBicmVha2luZyBjb250ZW50IGludG8gcGFyYWdyYXBocyBmb3IgYmV0dGVyIHJlYWRhYmlsaXR5Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCEvWy4hP10kLy50ZXN0KGNvbnRlbnQudHJpbSgpKSkge1xyXG4gICAgICBpc3N1ZXMucHVzaCgnQ29udGVudCBzaG91bGQgZW5kIHdpdGggcHJvcGVyIHB1bmN0dWF0aW9uJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ2FsY3VsYXRlIHF1YWxpdHkgc2NvcmVcclxuICAgIGxldCBzY29yZSA9IDEwO1xyXG4gICAgc2NvcmUgLT0gaXNzdWVzLmxlbmd0aCAqIDI7XHJcbiAgICBzY29yZSAtPSBzdWdnZXN0aW9ucy5sZW5ndGggKiAwLjU7XHJcbiAgICBzY29yZSA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEwLCBzY29yZSkpO1xyXG5cclxuICAgIGNvbnN0IHZhbGlkYXRpb24gPSB7XHJcbiAgICAgIGlzVmFsaWQ6IGlzc3Vlcy5sZW5ndGggPT09IDAsXHJcbiAgICAgIHNjb3JlLFxyXG4gICAgICBpc3N1ZXMsXHJcbiAgICAgIHN1Z2dlc3Rpb25zLFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgbWVzc2FnZTogJ0NvbnRlbnQgdmFsaWRhdGlvbiBjb21wbGV0ZWQnLFxyXG4gICAgICAgIGRhdGE6IHZhbGlkYXRpb24sXHJcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgdmFsaWRhdGluZyBjb250ZW50OicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnRmFpbGVkIHRvIHZhbGlkYXRlIGNvbnRlbnQnLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgaW1hZ2Ugc3RhdHVzIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUltYWdlU3RhdHVzKFxyXG4gIGNvbnRlbnRJZDogc3RyaW5nLFxyXG4gIGNvbnRleHQ6IENvbnRleHQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUhLFxyXG4gICAgICBLZXk6IHtcclxuICAgICAgICBpZDogeyBTOiBjb250ZW50SWQgfSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDA0LFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnTm90IEZvdW5kJyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IG5vdCBmb3VuZCcsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHN0YXR1cyA9IHJlc3VsdC5JdGVtLnN0YXR1cy5TITtcclxuICAgIGNvbnN0IGltYWdlVXJsID0gcmVzdWx0Lkl0ZW0uaW1hZ2VVcmw/LlM7XHJcbiAgICBjb25zdCBlcnJvciA9IHJlc3VsdC5JdGVtLmVycm9yPy5TO1xyXG5cclxuICAgIGxldCBpbWFnZVN0YXR1czogJ3BlbmRpbmcnIHwgJ2dlbmVyYXRpbmcnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJyA9ICdwZW5kaW5nJztcclxuICAgIFxyXG4gICAgaWYgKHN0YXR1cyA9PT0gJ2dlbmVyYXRpbmdfaW1hZ2UnKSB7XHJcbiAgICAgIGltYWdlU3RhdHVzID0gJ2dlbmVyYXRpbmcnO1xyXG4gICAgfSBlbHNlIGlmIChzdGF0dXMgPT09ICdpbWFnZV9nZW5lcmF0ZWQnICYmIGltYWdlVXJsKSB7XHJcbiAgICAgIGltYWdlU3RhdHVzID0gJ2NvbXBsZXRlZCc7XHJcbiAgICB9IGVsc2UgaWYgKHN0YXR1cyA9PT0gJ2ltYWdlX2dlbmVyYXRpb25fZmFpbGVkJykge1xyXG4gICAgICBpbWFnZVN0YXR1cyA9ICdmYWlsZWQnO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBjb250ZW50SWQsXHJcbiAgICAgICAgc3RhdHVzOiBpbWFnZVN0YXR1cyxcclxuICAgICAgICBpbWFnZVVybCxcclxuICAgICAgICBlcnJvcixcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyBpbWFnZSBzdGF0dXM6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdGYWlsZWQgdG8gZ2V0IGltYWdlIHN0YXR1cycsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBpbWFnZSBhbmFseXNpcyByZXF1ZXN0XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVJbWFnZUFuYWx5c2lzKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkgfHwgJ3t9Jyk7XHJcbiAgICBjb25zdCB7IGNvbnRlbnQgfSA9IGJvZHk7XHJcblxyXG4gICAgaWYgKCFjb250ZW50KSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnQmFkIFJlcXVlc3QnLFxyXG4gICAgICAgICAgbWVzc2FnZTogJ2NvbnRlbnQgaXMgcmVxdWlyZWQnLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBBbmFseXplIGNvbnRlbnQgdG8gZ2VuZXJhdGUgaW1hZ2UgcHJvbXB0XHJcbiAgICBjb25zdCB3b3JkcyA9IGNvbnRlbnQudG9Mb3dlckNhc2UoKS5zcGxpdCgvXFxzKy8pO1xyXG4gICAgY29uc3Qga2V5V29yZHMgPSB3b3Jkcy5maWx0ZXIoKHdvcmQ6IHN0cmluZykgPT4gXHJcbiAgICAgIHdvcmQubGVuZ3RoID4gNCAmJiBcclxuICAgICAgIVsndGhhdCcsICd0aGlzJywgJ3dpdGgnLCAnZnJvbScsICd0aGV5JywgJ2hhdmUnLCAnd2lsbCcsICdiZWVuJywgJ3dlcmUnLCAnc2FpZCcsICdlYWNoJywgJ3doaWNoJywgJ3RoZWlyJywgJ3RpbWUnLCAnd291bGQnLCAndGhlcmUnLCAnY291bGQnLCAnb3RoZXInXS5pbmNsdWRlcyh3b3JkKVxyXG4gICAgKTtcclxuICAgIFxyXG4gICAgLy8gVGFrZSBmaXJzdCBmZXcga2V5IGNvbmNlcHRzXHJcbiAgICBjb25zdCBjb25jZXB0cyA9IGtleVdvcmRzLnNsaWNlKDAsIDMpLmpvaW4oJywgJyk7XHJcbiAgICBcclxuICAgIC8vIERldGVybWluZSBzdHlsZSBiYXNlZCBvbiBjb250ZW50XHJcbiAgICBsZXQgc3R5bGUgPSAncHJvZmVzc2lvbmFsJztcclxuICAgIGlmIChjb250ZW50LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ2NyZWF0aXZlJykgfHwgY29udGVudC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdhcnQnKSkge1xyXG4gICAgICBzdHlsZSA9ICdjcmVhdGl2ZSc7XHJcbiAgICB9IGVsc2UgaWYgKGNvbnRlbnQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygndGVjaG5pY2FsJykgfHwgY29udGVudC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdjb2RlJykpIHtcclxuICAgICAgc3R5bGUgPSAndGVjaG5pY2FsJztcclxuICAgIH0gZWxzZSBpZiAoY29udGVudC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdtaW5pbWFsJykgfHwgY29udGVudC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdzaW1wbGUnKSkge1xyXG4gICAgICBzdHlsZSA9ICdtaW5pbWFsJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgY29uc3QgcHJvbXB0ID0gYGNsZWFuLCBtb2Rlcm4sIHByb2Zlc3Npb25hbCBpbGx1c3RyYXRpb24gcmVwcmVzZW50aW5nICR7Y29uY2VwdHN9LCBoaWdoIHF1YWxpdHksIGRldGFpbGVkYDtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgcHJvbXB0LFxyXG4gICAgICAgIHN0eWxlLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBhbmFseXppbmcgY29udGVudCBmb3IgaW1hZ2U6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdGYWlsZWQgdG8gYW5hbHl6ZSBjb250ZW50JyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59Il19