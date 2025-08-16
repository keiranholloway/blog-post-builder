"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const uuid_1 = require("uuid");
// Initialize AWS clients
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const sqsClient = new client_sqs_1.SQSClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({ region: process.env.AWS_REGION });
const handler = async (event, context) => {
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
        console.error('Unhandled error:', error);
        const errorResponse = {
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : 'An unexpected error occurred',
            requestId: context.awsRequestId,
        };
        return {
            statusCode: 500,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhcGktaGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBd0c7QUFDeEcsb0RBQW9FO0FBQ3BFLG9FQUFrRjtBQUNsRiwrQkFBb0M7QUFjcEMseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUNwRSxNQUFNLGlCQUFpQixHQUFHLElBQUksc0NBQWlCLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBRTdFLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFDMUIsS0FBMkIsRUFDM0IsT0FBZ0IsRUFDZ0IsRUFBRTtJQUNsQyxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN0RCxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUUxRCwyQkFBMkI7SUFDM0IsTUFBTSxjQUFjLEdBQUc7UUFDckIsa0NBQWtDO1FBQ2xDLHVCQUF1QjtRQUN2Qix1QkFBdUI7S0FDeEIsQ0FBQztJQUVGLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDO0lBQ25FLE1BQU0sYUFBYSxHQUFHLGNBQWMsQ0FBQyxR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UyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2FBQ2hDLENBQUM7U0FDSCxDQUFDO0tBQ0g7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCwgUHV0SXRlbUNvbW1hbmQsIEdldEl0ZW1Db21tYW5kLCBRdWVyeUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBTUVNDbGllbnQsIFNlbmRNZXNzYWdlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xyXG5pbXBvcnQgeyBFdmVudEJyaWRnZUNsaWVudCwgUHV0RXZlbnRzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZSc7XHJcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xyXG5cclxuaW50ZXJmYWNlIEVycm9yUmVzcG9uc2Uge1xyXG4gIGVycm9yOiBzdHJpbmc7XHJcbiAgbWVzc2FnZTogc3RyaW5nO1xyXG4gIHJlcXVlc3RJZD86IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFN1Y2Nlc3NSZXNwb25zZSB7XHJcbiAgbWVzc2FnZTogc3RyaW5nO1xyXG4gIGRhdGE/OiBhbnk7XHJcbiAgdmVyc2lvbjogc3RyaW5nO1xyXG59XHJcblxyXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXHJcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3Qgc3FzQ2xpZW50ID0gbmV3IFNRU0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZXZlbnRCcmlkZ2VDbGllbnQgPSBuZXcgRXZlbnRCcmlkZ2VDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcblxyXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dFxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdFdmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xyXG4gIGNvbnNvbGUubG9nKCdDb250ZXh0OicsIEpTT04uc3RyaW5naWZ5KGNvbnRleHQsIG51bGwsIDIpKTtcclxuXHJcbiAgLy8gQWxsb3dlZCBvcmlnaW5zIGZvciBDT1JTXHJcbiAgY29uc3QgYWxsb3dlZE9yaWdpbnMgPSBbXHJcbiAgICAnaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nLFxyXG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMCcsXHJcbiAgICAnaHR0cDovL2xvY2FsaG9zdDo1MTczJyxcclxuICBdO1xyXG4gIFxyXG4gIGNvbnN0IHJlcXVlc3RPcmlnaW4gPSBldmVudC5oZWFkZXJzLm9yaWdpbiB8fCBldmVudC5oZWFkZXJzLk9yaWdpbjtcclxuICBjb25zdCBhbGxvd2VkT3JpZ2luID0gYWxsb3dlZE9yaWdpbnMuaW5jbHVkZXMocmVxdWVzdE9yaWdpbiB8fCAnJykgPyByZXF1ZXN0T3JpZ2luISA6IGFsbG93ZWRPcmlnaW5zWzBdO1xyXG5cclxuICBjb25zdCBjb3JzSGVhZGVycyA9IHtcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBhbGxvd2VkT3JpZ2luLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLEF1dGhvcml6YXRpb24sWC1BbXotRGF0ZSxYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1SZXF1ZXN0ZWQtV2l0aCcsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsUE9TVCxQVVQsREVMRVRFLE9QVElPTlMnLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzJzogJ3RydWUnLFxyXG4gICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICB9O1xyXG5cclxuICB0cnkge1xyXG4gICAgLy8gSGFuZGxlIHByZWZsaWdodCBPUFRJT05TIHJlcXVlc3RzXHJcbiAgICBpZiAoZXZlbnQuaHR0cE1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6ICcnLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJvdXRlIGhhbmRsaW5nXHJcbiAgICBjb25zdCBwYXRoID0gZXZlbnQucGF0aDtcclxuICAgIGNvbnN0IG1ldGhvZCA9IGV2ZW50Lmh0dHBNZXRob2Q7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFByb2Nlc3NpbmcgJHttZXRob2R9ICR7cGF0aH1gKTtcclxuXHJcbiAgICAvLyBIZWFsdGggY2hlY2sgZW5kcG9pbnRcclxuICAgIGlmIChtZXRob2QgPT09ICdHRVQnICYmIHBhdGggPT09ICcvJykge1xyXG4gICAgICBjb25zdCByZXNwb25zZTogU3VjY2Vzc1Jlc3BvbnNlID0ge1xyXG4gICAgICAgIG1lc3NhZ2U6ICdBdXRvbWF0ZWQgQmxvZyBQb3N0ZXIgQVBJIGlzIHJ1bm5pbmcnLFxyXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXHJcbiAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICAgICAgY29udGVudFRhYmxlOiBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUsXHJcbiAgICAgICAgICAgIHVzZXJUYWJsZTogcHJvY2Vzcy5lbnYuVVNFUl9UQUJMRV9OQU1FLFxyXG4gICAgICAgICAgICBhdWRpb0J1Y2tldDogcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUsXHJcbiAgICAgICAgICAgIGltYWdlQnVja2V0OiBwcm9jZXNzLmVudi5JTUFHRV9CVUNLRVRfTkFNRSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBBUEkgc3RhdHVzIGVuZHBvaW50XHJcbiAgICBpZiAobWV0aG9kID09PSAnR0VUJyAmJiBwYXRoID09PSAnL2FwaS9zdGF0dXMnKSB7XHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlOiBTdWNjZXNzUmVzcG9uc2UgPSB7XHJcbiAgICAgICAgbWVzc2FnZTogJ0FQSSBpcyBoZWFsdGh5JyxcclxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxyXG4gICAgICAgIGRhdGE6IHtcclxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgc2VydmljZXM6IHtcclxuICAgICAgICAgICAgZHluYW1vZGI6ICdhdmFpbGFibGUnLFxyXG4gICAgICAgICAgICBzMzogJ2F2YWlsYWJsZScsXHJcbiAgICAgICAgICAgIHNxczogJ2F2YWlsYWJsZScsXHJcbiAgICAgICAgICAgIGV2ZW50YnJpZGdlOiAnYXZhaWxhYmxlJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDb250ZW50IGdlbmVyYXRpb24gZW5kcG9pbnRzXHJcbiAgICBpZiAobWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9hcGkvY29udGVudC9nZW5lcmF0ZScpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUNvbnRlbnRHZW5lcmF0aW9uKGV2ZW50LCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2NvbnRlbnQvcmV2aXNlJykge1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQ29udGVudFJldmlzaW9uKGV2ZW50LCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aC5zdGFydHNXaXRoKCcvYXBpL2NvbnRlbnQvc3RhdHVzLycpKSB7XHJcbiAgICAgIGNvbnN0IGNvbnRlbnRJZCA9IHBhdGguc3BsaXQoJy8nKS5wb3AoKTtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUNvbnRlbnRTdGF0dXMoY29udGVudElkISwgY29udGV4dCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdHRVQnICYmIHBhdGguc3RhcnRzV2l0aCgnL2FwaS9jb250ZW50LycpICYmIHBhdGguZW5kc1dpdGgoJy9tZXNzYWdlcycpKSB7XHJcbiAgICAgIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcclxuICAgICAgY29uc3QgY29udGVudElkID0gcGF0aFBhcnRzW3BhdGhQYXJ0cy5sZW5ndGggLSAyXTtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUNvbnRlbnRNZXNzYWdlcyhjb250ZW50SWQsIGNvbnRleHQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobWV0aG9kID09PSAnR0VUJyAmJiBwYXRoLnN0YXJ0c1dpdGgoJy9hcGkvY29udGVudC8nKSAmJiAhcGF0aC5pbmNsdWRlcygnLycpKSB7XHJcbiAgICAgIGNvbnN0IGNvbnRlbnRJZCA9IHBhdGguc3BsaXQoJy8nKS5wb3AoKTtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUdldENvbnRlbnQoY29udGVudElkISwgY29udGV4dCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9jb250ZW50L3ZhbGlkYXRlJykge1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQ29udGVudFZhbGlkYXRpb24oZXZlbnQsIGNvbnRleHQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBJbWFnZSBnZW5lcmF0aW9uIGVuZHBvaW50c1xyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aC5zdGFydHNXaXRoKCcvYXBpL2ltYWdlL3N0YXR1cy8nKSkge1xyXG4gICAgICBjb25zdCBjb250ZW50SWQgPSBwYXRoLnNwbGl0KCcvJykucG9wKCk7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVJbWFnZVN0YXR1cyhjb250ZW50SWQhLCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2ltYWdlL2FuYWx5emUnKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVJbWFnZUFuYWx5c2lzKGV2ZW50LCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGVmYXVsdCA0MDQgZm9yIHVubWF0Y2hlZCByb3V0ZXNcclxuICAgIGNvbnN0IGVycm9yUmVzcG9uc2U6IEVycm9yUmVzcG9uc2UgPSB7XHJcbiAgICAgIGVycm9yOiAnTm90IEZvdW5kJyxcclxuICAgICAgbWVzc2FnZTogYFJvdXRlICR7bWV0aG9kfSAke3BhdGh9IG5vdCBmb3VuZGAsXHJcbiAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGVycm9yUmVzcG9uc2UpLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1VuaGFuZGxlZCBlcnJvcjonLCBlcnJvcik7XHJcblxyXG4gICAgY29uc3QgZXJyb3JSZXNwb25zZTogRXJyb3JSZXNwb25zZSA9IHtcclxuICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdBbiB1bmV4cGVjdGVkIGVycm9yIG9jY3VycmVkJyxcclxuICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoZXJyb3JSZXNwb25zZSksXHJcbiAgICB9O1xyXG4gIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgY29udGVudCBnZW5lcmF0aW9uIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRHZW5lcmF0aW9uKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkgfHwgJ3t9Jyk7XHJcbiAgICBjb25zdCB7IHRyYW5zY3JpcHRpb24sIHVzZXJJZCwgdXNlckNvbnRleHQsIHByZWZlcmVuY2VzIH0gPSBib2R5O1xyXG5cclxuICAgIGlmICghdHJhbnNjcmlwdGlvbiB8fCAhdXNlcklkKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnQmFkIFJlcXVlc3QnLFxyXG4gICAgICAgICAgbWVzc2FnZTogJ3RyYW5zY3JpcHRpb24gYW5kIHVzZXJJZCBhcmUgcmVxdWlyZWQnLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgY29udGVudCByZWNvcmRcclxuICAgIGNvbnN0IGNvbnRlbnRJZCA9IHV1aWR2NCgpO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBQdXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FISxcclxuICAgICAgSXRlbToge1xyXG4gICAgICAgIGlkOiB7IFM6IGNvbnRlbnRJZCB9LFxyXG4gICAgICAgIHR5cGU6IHsgUzogJ2NvbnRlbnQnIH0sXHJcbiAgICAgICAgdXNlcklkOiB7IFM6IHVzZXJJZCB9LFxyXG4gICAgICAgIG9yaWdpbmFsVHJhbnNjcmlwdGlvbjogeyBTOiB0cmFuc2NyaXB0aW9uIH0sXHJcbiAgICAgICAgc3RhdHVzOiB7IFM6ICdwcm9jZXNzaW5nJyB9LFxyXG4gICAgICAgIGNyZWF0ZWRBdDogeyBTOiB0aW1lc3RhbXAgfSxcclxuICAgICAgICB1cGRhdGVkQXQ6IHsgUzogdGltZXN0YW1wIH0sXHJcbiAgICAgICAgdXNlckNvbnRleHQ6IHsgUzogdXNlckNvbnRleHQgfHwgJycgfSxcclxuICAgICAgICBwcmVmZXJlbmNlczogeyBTOiBKU09OLnN0cmluZ2lmeShwcmVmZXJlbmNlcyB8fCB7fSkgfSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBUcmlnZ2VyIGNvbnRlbnQgZ2VuZXJhdGlvbiB3b3JrZmxvd1xyXG4gICAgYXdhaXQgZXZlbnRCcmlkZ2VDbGllbnQuc2VuZChuZXcgUHV0RXZlbnRzQ29tbWFuZCh7XHJcbiAgICAgIEVudHJpZXM6IFt7XHJcbiAgICAgICAgU291cmNlOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmFwaScsXHJcbiAgICAgICAgRGV0YWlsVHlwZTogJ0NvbnRlbnQgR2VuZXJhdGlvbiBSZXF1ZXN0ZWQnLFxyXG4gICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgY29udGVudElkLFxyXG4gICAgICAgICAgdXNlcklkLFxyXG4gICAgICAgICAgdHJhbnNjcmlwdGlvbixcclxuICAgICAgICAgIHVzZXJDb250ZXh0LFxyXG4gICAgICAgICAgcHJlZmVyZW5jZXMsXHJcbiAgICAgICAgICB0aW1lc3RhbXAsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgRXZlbnRCdXNOYW1lOiBwcm9jZXNzLmVudi5FVkVOVF9CVVNfTkFNRSEsXHJcbiAgICAgIH1dLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBtZXNzYWdlOiAnQ29udGVudCBnZW5lcmF0aW9uIGluaXRpYXRlZCcsXHJcbiAgICAgICAgZGF0YTogeyBjb250ZW50SWQgfSxcclxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBjb250ZW50IGdlbmVyYXRpb246JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdGYWlsZWQgdG8gaW5pdGlhdGUgY29udGVudCBnZW5lcmF0aW9uJyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGNvbnRlbnQgcmV2aXNpb24gcmVxdWVzdFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ29udGVudFJldmlzaW9uKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkgfHwgJ3t9Jyk7XHJcbiAgICBjb25zdCB7IGNvbnRlbnRJZCwgY3VycmVudENvbnRlbnQsIGZlZWRiYWNrLCByZXZpc2lvblR5cGUsIHVzZXJJZCB9ID0gYm9keTtcclxuXHJcbiAgICBpZiAoIWNvbnRlbnRJZCB8fCAhY3VycmVudENvbnRlbnQgfHwgIWZlZWRiYWNrIHx8ICF1c2VySWQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdCYWQgUmVxdWVzdCcsXHJcbiAgICAgICAgICBtZXNzYWdlOiAnY29udGVudElkLCBjdXJyZW50Q29udGVudCwgZmVlZGJhY2ssIGFuZCB1c2VySWQgYXJlIHJlcXVpcmVkJyxcclxuICAgICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ3JlYXRlIHJldmlzaW9uIHJlY29yZFxyXG4gICAgY29uc3QgcmV2aXNpb25JZCA9IHV1aWR2NCgpO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIC8vIFRyaWdnZXIgY29udGVudCByZXZpc2lvbiB3b3JrZmxvd1xyXG4gICAgYXdhaXQgZXZlbnRCcmlkZ2VDbGllbnQuc2VuZChuZXcgUHV0RXZlbnRzQ29tbWFuZCh7XHJcbiAgICAgIEVudHJpZXM6IFt7XHJcbiAgICAgICAgU291cmNlOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmFwaScsXHJcbiAgICAgICAgRGV0YWlsVHlwZTogJ0NvbnRlbnQgUmV2aXNpb24gUmVxdWVzdGVkJyxcclxuICAgICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICAgIHJldmlzaW9uSWQsXHJcbiAgICAgICAgICBjdXJyZW50Q29udGVudCxcclxuICAgICAgICAgIGZlZWRiYWNrLFxyXG4gICAgICAgICAgcmV2aXNpb25UeXBlOiByZXZpc2lvblR5cGUgfHwgJ2NvbnRlbnQnLFxyXG4gICAgICAgICAgdXNlcklkLFxyXG4gICAgICAgICAgdGltZXN0YW1wLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIEV2ZW50QnVzTmFtZTogcHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUhLFxyXG4gICAgICB9XSxcclxuICAgIH0pKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgbWVzc2FnZTogJ0NvbnRlbnQgcmV2aXNpb24gaW5pdGlhdGVkJyxcclxuICAgICAgICBkYXRhOiB7IHJldmlzaW9uSWQgfSxcclxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBjb250ZW50IHJldmlzaW9uOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnRmFpbGVkIHRvIGluaXRpYXRlIGNvbnRlbnQgcmV2aXNpb24nLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgY29udGVudCBzdGF0dXMgcmVxdWVzdFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ29udGVudFN0YXR1cyhcclxuICBjb250ZW50SWQ6IHN0cmluZyxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBHZXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FISxcclxuICAgICAgS2V5OiB7XHJcbiAgICAgICAgaWQ6IHsgUzogY29udGVudElkIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgICAgICBtZXNzYWdlOiAnQ29udGVudCBub3QgZm91bmQnLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBzdGF0dXMgPSB7XHJcbiAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgc3RhdHVzOiByZXN1bHQuSXRlbS5zdGF0dXMuUyEsXHJcbiAgICAgIHByb2dyZXNzOiByZXN1bHQuSXRlbS5wcm9ncmVzcz8uTiA/IHBhcnNlSW50KHJlc3VsdC5JdGVtLnByb2dyZXNzLk4pIDogdW5kZWZpbmVkLFxyXG4gICAgICBjdXJyZW50U3RlcDogcmVzdWx0Lkl0ZW0uY3VycmVudFN0ZXA/LlMsXHJcbiAgICAgIGVzdGltYXRlZFRpbWVSZW1haW5pbmc6IHJlc3VsdC5JdGVtLmVzdGltYXRlZFRpbWVSZW1haW5pbmc/Lk4gPyBwYXJzZUludChyZXN1bHQuSXRlbS5lc3RpbWF0ZWRUaW1lUmVtYWluaW5nLk4pIDogdW5kZWZpbmVkLFxyXG4gICAgICBlcnJvcjogcmVzdWx0Lkl0ZW0uZXJyb3I/LlMsXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBtZXNzYWdlOiAnQ29udGVudCBzdGF0dXMgcmV0cmlldmVkJyxcclxuICAgICAgICBkYXRhOiBzdGF0dXMsXHJcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyBjb250ZW50IHN0YXR1czonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ0ZhaWxlZCB0byBnZXQgY29udGVudCBzdGF0dXMnLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgZ2V0IGNvbnRlbnQgcmVxdWVzdFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlR2V0Q29udGVudChcclxuICBjb250ZW50SWQ6IHN0cmluZyxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBHZXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FISxcclxuICAgICAgS2V5OiB7XHJcbiAgICAgICAgaWQ6IHsgUzogY29udGVudElkIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgICAgICBtZXNzYWdlOiAnQ29udGVudCBub3QgZm91bmQnLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjb250ZW50ID0ge1xyXG4gICAgICBpZDogcmVzdWx0Lkl0ZW0uaWQuUyEsXHJcbiAgICAgIHVzZXJJZDogcmVzdWx0Lkl0ZW0udXNlcklkLlMhLFxyXG4gICAgICB0aXRsZTogcmVzdWx0Lkl0ZW0udGl0bGU/LlMsXHJcbiAgICAgIG9yaWdpbmFsVHJhbnNjcmlwdGlvbjogcmVzdWx0Lkl0ZW0ub3JpZ2luYWxUcmFuc2NyaXB0aW9uLlMhLFxyXG4gICAgICBjdXJyZW50RHJhZnQ6IHJlc3VsdC5JdGVtLmN1cnJlbnREcmFmdD8uUyB8fCAnJyxcclxuICAgICAgYXNzb2NpYXRlZEltYWdlOiByZXN1bHQuSXRlbS5hc3NvY2lhdGVkSW1hZ2U/LlMsXHJcbiAgICAgIGltYWdlVXJsOiByZXN1bHQuSXRlbS5pbWFnZVVybD8uUyxcclxuICAgICAgc3RhdHVzOiByZXN1bHQuSXRlbS5zdGF0dXMuUyEsXHJcbiAgICAgIHJldmlzaW9uSGlzdG9yeTogcmVzdWx0Lkl0ZW0ucmV2aXNpb25IaXN0b3J5Py5TID8gSlNPTi5wYXJzZShyZXN1bHQuSXRlbS5yZXZpc2lvbkhpc3RvcnkuUykgOiBbXSxcclxuICAgICAgcHVibGlzaGluZ1Jlc3VsdHM6IHJlc3VsdC5JdGVtLnB1Ymxpc2hpbmdSZXN1bHRzPy5TID8gSlNPTi5wYXJzZShyZXN1bHQuSXRlbS5wdWJsaXNoaW5nUmVzdWx0cy5TKSA6IFtdLFxyXG4gICAgICBjcmVhdGVkQXQ6IHJlc3VsdC5JdGVtLmNyZWF0ZWRBdC5TISxcclxuICAgICAgdXBkYXRlZEF0OiByZXN1bHQuSXRlbS51cGRhdGVkQXQuUyEsXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBtZXNzYWdlOiAnQ29udGVudCByZXRyaWV2ZWQnLFxyXG4gICAgICAgIGRhdGE6IGNvbnRlbnQsXHJcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyBjb250ZW50OicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnRmFpbGVkIHRvIGdldCBjb250ZW50JyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGNvbnRlbnQgbWVzc2FnZXMgcmVxdWVzdFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ29udGVudE1lc3NhZ2VzKFxyXG4gIGNvbnRlbnRJZDogc3RyaW5nLFxyXG4gIGNvbnRleHQ6IENvbnRleHQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZHluYW1vQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuQUdFTlRfTUVTU0FHRVNfVEFCTEVfTkFNRSEsXHJcbiAgICAgIEluZGV4TmFtZTogJ0NvbnRlbnRJZEluZGV4JyxcclxuICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ2NvbnRlbnRJZCA9IDpjb250ZW50SWQnLFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgJzpjb250ZW50SWQnOiB7IFM6IGNvbnRlbnRJZCB9LFxyXG4gICAgICB9LFxyXG4gICAgICBTY2FuSW5kZXhGb3J3YXJkOiBmYWxzZSwgLy8gTW9zdCByZWNlbnQgZmlyc3RcclxuICAgIH0pKTtcclxuXHJcbiAgICBjb25zdCBtZXNzYWdlcyA9IHJlc3VsdC5JdGVtcz8ubWFwKGl0ZW0gPT4gKHtcclxuICAgICAgaWQ6IGl0ZW0uaWQuUyEsXHJcbiAgICAgIGNvbnRlbnRJZDogaXRlbS5jb250ZW50SWQuUyEsXHJcbiAgICAgIGFnZW50VHlwZTogaXRlbS5hZ2VudFR5cGUuUyEsXHJcbiAgICAgIG1lc3NhZ2VUeXBlOiBpdGVtLm1lc3NhZ2VUeXBlLlMhLFxyXG4gICAgICBwYXlsb2FkOiBpdGVtLnBheWxvYWQuUyA/IEpTT04ucGFyc2UoaXRlbS5wYXlsb2FkLlMpIDoge30sXHJcbiAgICAgIHN0YXR1czogaXRlbS5zdGF0dXM/LlMgfHwgJ3BlbmRpbmcnLFxyXG4gICAgICBlcnJvcjogaXRlbS5lcnJvcj8uUyxcclxuICAgICAgcmVzdWx0OiBpdGVtLnJlc3VsdD8uUyA/IEpTT04ucGFyc2UoaXRlbS5yZXN1bHQuUykgOiB1bmRlZmluZWQsXHJcbiAgICAgIGNyZWF0ZWRBdDogaXRlbS50aW1lc3RhbXAuUyEsXHJcbiAgICAgIHByb2Nlc3NlZEF0OiBpdGVtLnByb2Nlc3NlZEF0Py5TLFxyXG4gICAgfSkpIHx8IFtdO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBtZXNzYWdlOiAnQ29udGVudCBtZXNzYWdlcyByZXRyaWV2ZWQnLFxyXG4gICAgICAgIGRhdGE6IHsgbWVzc2FnZXMgfSxcclxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIGNvbnRlbnQgbWVzc2FnZXM6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdGYWlsZWQgdG8gZ2V0IGNvbnRlbnQgbWVzc2FnZXMnLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgY29udGVudCB2YWxpZGF0aW9uIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRWYWxpZGF0aW9uKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkgfHwgJ3t9Jyk7XHJcbiAgICBjb25zdCB7IGNvbnRlbnQgfSA9IGJvZHk7XHJcblxyXG4gICAgaWYgKCFjb250ZW50KSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnQmFkIFJlcXVlc3QnLFxyXG4gICAgICAgICAgbWVzc2FnZTogJ2NvbnRlbnQgaXMgcmVxdWlyZWQnLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBCYXNpYyBjb250ZW50IHZhbGlkYXRpb25cclxuICAgIGNvbnN0IGlzc3Vlczogc3RyaW5nW10gPSBbXTtcclxuICAgIGNvbnN0IHN1Z2dlc3Rpb25zOiBzdHJpbmdbXSA9IFtdO1xyXG4gICAgXHJcbiAgICBjb25zdCB3b3JkQ291bnQgPSBjb250ZW50LnNwbGl0KC9cXHMrLykubGVuZ3RoO1xyXG4gICAgY29uc3QgY2hhckNvdW50ID0gY29udGVudC5sZW5ndGg7XHJcblxyXG4gICAgaWYgKHdvcmRDb3VudCA8IDEwMCkge1xyXG4gICAgICBpc3N1ZXMucHVzaCgnQ29udGVudCBpcyB0b28gc2hvcnQgZm9yIGEgbWVhbmluZ2Z1bCBibG9nIHBvc3QnKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoY2hhckNvdW50IDwgNTAwKSB7XHJcbiAgICAgIGlzc3Vlcy5wdXNoKCdDb250ZW50IG5lZWRzIG1vcmUgZGV0YWlsIGFuZCBkZXB0aCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghY29udGVudC5pbmNsdWRlcygnXFxuJykpIHtcclxuICAgICAgc3VnZ2VzdGlvbnMucHVzaCgnQ29uc2lkZXIgYnJlYWtpbmcgY29udGVudCBpbnRvIHBhcmFncmFwaHMgZm9yIGJldHRlciByZWFkYWJpbGl0eScpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghL1suIT9dJC8udGVzdChjb250ZW50LnRyaW0oKSkpIHtcclxuICAgICAgaXNzdWVzLnB1c2goJ0NvbnRlbnQgc2hvdWxkIGVuZCB3aXRoIHByb3BlciBwdW5jdHVhdGlvbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENhbGN1bGF0ZSBxdWFsaXR5IHNjb3JlXHJcbiAgICBsZXQgc2NvcmUgPSAxMDtcclxuICAgIHNjb3JlIC09IGlzc3Vlcy5sZW5ndGggKiAyO1xyXG4gICAgc2NvcmUgLT0gc3VnZ2VzdGlvbnMubGVuZ3RoICogMC41O1xyXG4gICAgc2NvcmUgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMCwgc2NvcmUpKTtcclxuXHJcbiAgICBjb25zdCB2YWxpZGF0aW9uID0ge1xyXG4gICAgICBpc1ZhbGlkOiBpc3N1ZXMubGVuZ3RoID09PSAwLFxyXG4gICAgICBzY29yZSxcclxuICAgICAgaXNzdWVzLFxyXG4gICAgICBzdWdnZXN0aW9ucyxcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IHZhbGlkYXRpb24gY29tcGxldGVkJyxcclxuICAgICAgICBkYXRhOiB2YWxpZGF0aW9uLFxyXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHZhbGlkYXRpbmcgY29udGVudDonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ0ZhaWxlZCB0byB2YWxpZGF0ZSBjb250ZW50JyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGltYWdlIHN0YXR1cyByZXF1ZXN0XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVJbWFnZVN0YXR1cyhcclxuICBjb250ZW50SWQ6IHN0cmluZyxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBHZXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FISxcclxuICAgICAgS2V5OiB7XHJcbiAgICAgICAgaWQ6IHsgUzogY29udGVudElkIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgICAgICBtZXNzYWdlOiAnQ29udGVudCBub3QgZm91bmQnLFxyXG4gICAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBzdGF0dXMgPSByZXN1bHQuSXRlbS5zdGF0dXMuUyE7XHJcbiAgICBjb25zdCBpbWFnZVVybCA9IHJlc3VsdC5JdGVtLmltYWdlVXJsPy5TO1xyXG4gICAgY29uc3QgZXJyb3IgPSByZXN1bHQuSXRlbS5lcnJvcj8uUztcclxuXHJcbiAgICBsZXQgaW1hZ2VTdGF0dXM6ICdwZW5kaW5nJyB8ICdnZW5lcmF0aW5nJyB8ICdjb21wbGV0ZWQnIHwgJ2ZhaWxlZCcgPSAncGVuZGluZyc7XHJcbiAgICBcclxuICAgIGlmIChzdGF0dXMgPT09ICdnZW5lcmF0aW5nX2ltYWdlJykge1xyXG4gICAgICBpbWFnZVN0YXR1cyA9ICdnZW5lcmF0aW5nJztcclxuICAgIH0gZWxzZSBpZiAoc3RhdHVzID09PSAnaW1hZ2VfZ2VuZXJhdGVkJyAmJiBpbWFnZVVybCkge1xyXG4gICAgICBpbWFnZVN0YXR1cyA9ICdjb21wbGV0ZWQnO1xyXG4gICAgfSBlbHNlIGlmIChzdGF0dXMgPT09ICdpbWFnZV9nZW5lcmF0aW9uX2ZhaWxlZCcpIHtcclxuICAgICAgaW1hZ2VTdGF0dXMgPSAnZmFpbGVkJztcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgY29udGVudElkLFxyXG4gICAgICAgIHN0YXR1czogaW1hZ2VTdGF0dXMsXHJcbiAgICAgICAgaW1hZ2VVcmwsXHJcbiAgICAgICAgZXJyb3IsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgaW1hZ2Ugc3RhdHVzOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnRmFpbGVkIHRvIGdldCBpbWFnZSBzdGF0dXMnLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgaW1hZ2UgYW5hbHlzaXMgcmVxdWVzdFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlSW1hZ2VBbmFseXNpcyhcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShldmVudC5ib2R5IHx8ICd7fScpO1xyXG4gICAgY29uc3QgeyBjb250ZW50IH0gPSBib2R5O1xyXG5cclxuICAgIGlmICghY29udGVudCkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBlcnJvcjogJ0JhZCBSZXF1ZXN0JyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICdjb250ZW50IGlzIHJlcXVpcmVkJyxcclxuICAgICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQW5hbHl6ZSBjb250ZW50IHRvIGdlbmVyYXRlIGltYWdlIHByb21wdFxyXG4gICAgY29uc3Qgd29yZHMgPSBjb250ZW50LnRvTG93ZXJDYXNlKCkuc3BsaXQoL1xccysvKTtcclxuICAgIGNvbnN0IGtleVdvcmRzID0gd29yZHMuZmlsdGVyKCh3b3JkOiBzdHJpbmcpID0+IFxyXG4gICAgICB3b3JkLmxlbmd0aCA+IDQgJiYgXHJcbiAgICAgICFbJ3RoYXQnLCAndGhpcycsICd3aXRoJywgJ2Zyb20nLCAndGhleScsICdoYXZlJywgJ3dpbGwnLCAnYmVlbicsICd3ZXJlJywgJ3NhaWQnLCAnZWFjaCcsICd3aGljaCcsICd0aGVpcicsICd0aW1lJywgJ3dvdWxkJywgJ3RoZXJlJywgJ2NvdWxkJywgJ290aGVyJ10uaW5jbHVkZXMod29yZClcclxuICAgICk7XHJcbiAgICBcclxuICAgIC8vIFRha2UgZmlyc3QgZmV3IGtleSBjb25jZXB0c1xyXG4gICAgY29uc3QgY29uY2VwdHMgPSBrZXlXb3Jkcy5zbGljZSgwLCAzKS5qb2luKCcsICcpO1xyXG4gICAgXHJcbiAgICAvLyBEZXRlcm1pbmUgc3R5bGUgYmFzZWQgb24gY29udGVudFxyXG4gICAgbGV0IHN0eWxlID0gJ3Byb2Zlc3Npb25hbCc7XHJcbiAgICBpZiAoY29udGVudC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdjcmVhdGl2ZScpIHx8IGNvbnRlbnQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnYXJ0JykpIHtcclxuICAgICAgc3R5bGUgPSAnY3JlYXRpdmUnO1xyXG4gICAgfSBlbHNlIGlmIChjb250ZW50LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ3RlY2huaWNhbCcpIHx8IGNvbnRlbnQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnY29kZScpKSB7XHJcbiAgICAgIHN0eWxlID0gJ3RlY2huaWNhbCc7XHJcbiAgICB9IGVsc2UgaWYgKGNvbnRlbnQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnbWluaW1hbCcpIHx8IGNvbnRlbnQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnc2ltcGxlJykpIHtcclxuICAgICAgc3R5bGUgPSAnbWluaW1hbCc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGNvbnN0IHByb21wdCA9IGBjbGVhbiwgbW9kZXJuLCBwcm9mZXNzaW9uYWwgaWxsdXN0cmF0aW9uIHJlcHJlc2VudGluZyAke2NvbmNlcHRzfSwgaGlnaCBxdWFsaXR5LCBkZXRhaWxlZGA7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIHByb21wdCxcclxuICAgICAgICBzdHlsZSxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgYW5hbHl6aW5nIGNvbnRlbnQgZm9yIGltYWdlOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnRmFpbGVkIHRvIGFuYWx5emUgY29udGVudCcsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufSJdfQ==