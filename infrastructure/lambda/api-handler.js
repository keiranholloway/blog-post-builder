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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhcGktaGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBd0c7QUFDeEcsb0RBQW9FO0FBQ3BFLG9FQUFrRjtBQUNsRiwrQkFBb0M7QUFjcEMseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUNwRSxNQUFNLGlCQUFpQixHQUFHLElBQUksc0NBQWlCLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBRTdFLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFDMUIsS0FBMkIsRUFDM0IsT0FBZ0IsRUFDZ0IsRUFBRTtJQUNsQyxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN0RCxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUUxRCwyQkFBMkI7SUFDM0IsTUFBTSxjQUFjLEdBQUc7UUFDckIsa0NBQWtDO1FBQ2xDLHVCQUF1QjtRQUN2Qix1QkFBdUI7S0FDeEIsQ0FBQztJQUVGLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDO0lBQ25FLE1BQU0sYUFBYSxHQUFHLGNBQWMsQ0FBQyxR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Q29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBQdXRJdGVtQ29tbWFuZCwgR2V0SXRlbUNvbW1hbmQsIFF1ZXJ5Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IFNRU0NsaWVudCwgU2VuZE1lc3NhZ2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNxcyc7XHJcbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50LCBQdXRFdmVudHNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJztcclxuaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSAndXVpZCc7XHJcblxyXG5pbnRlcmZhY2UgRXJyb3JSZXNwb25zZSB7XHJcbiAgZXJyb3I6IHN0cmluZztcclxuICBtZXNzYWdlOiBzdHJpbmc7XHJcbiAgcmVxdWVzdElkPzogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgU3VjY2Vzc1Jlc3BvbnNlIHtcclxuICBtZXNzYWdlOiBzdHJpbmc7XHJcbiAgZGF0YT86IGFueTtcclxuICB2ZXJzaW9uOiBzdHJpbmc7XHJcbn1cclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBzcXNDbGllbnQgPSBuZXcgU1FTQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBldmVudEJyaWRnZUNsaWVudCA9IG5ldyBFdmVudEJyaWRnZUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XHJcbiAgY29uc29sZS5sb2coJ0V2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XHJcbiAgY29uc29sZS5sb2coJ0NvbnRleHQ6JywgSlNPTi5zdHJpbmdpZnkoY29udGV4dCwgbnVsbCwgMikpO1xyXG5cclxuICAvLyBBbGxvd2VkIG9yaWdpbnMgZm9yIENPUlNcclxuICBjb25zdCBhbGxvd2VkT3JpZ2lucyA9IFtcclxuICAgICdodHRwczovL2tlaXJhbmhvbGxvd2F5LmdpdGh1Yi5pbycsXHJcbiAgICAnaHR0cDovL2xvY2FsaG9zdDozMDAwJyxcclxuICAgICdodHRwOi8vbG9jYWxob3N0OjUxNzMnLFxyXG4gIF07XHJcbiAgXHJcbiAgY29uc3QgcmVxdWVzdE9yaWdpbiA9IGV2ZW50LmhlYWRlcnMub3JpZ2luIHx8IGV2ZW50LmhlYWRlcnMuT3JpZ2luO1xyXG4gIGNvbnN0IGFsbG93ZWRPcmlnaW4gPSBhbGxvd2VkT3JpZ2lucy5pbmNsdWRlcyhyZXF1ZXN0T3JpZ2luIHx8ICcnKSA/IHJlcXVlc3RPcmlnaW4hIDogYWxsb3dlZE9yaWdpbnNbMF07XHJcblxyXG4gIGNvbnN0IGNvcnNIZWFkZXJzID0ge1xyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IGFsbG93ZWRPcmlnaW4sXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsQXV0aG9yaXphdGlvbixYLUFtei1EYXRlLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVJlcXVlc3RlZC1XaXRoJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUycsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiAndHJ1ZScsXHJcbiAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gIH07XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBIYW5kbGUgcHJlZmxpZ2h0IE9QVElPTlMgcmVxdWVzdHNcclxuICAgIGlmIChldmVudC5odHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogJycsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUm91dGUgaGFuZGxpbmdcclxuICAgIGNvbnN0IHBhdGggPSBldmVudC5wYXRoO1xyXG4gICAgY29uc3QgbWV0aG9kID0gZXZlbnQuaHR0cE1ldGhvZDtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgUHJvY2Vzc2luZyAke21ldGhvZH0gJHtwYXRofWApO1xyXG5cclxuICAgIC8vIEhlYWx0aCBjaGVjayBlbmRwb2ludFxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aCA9PT0gJy8nKSB7XHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlOiBTdWNjZXNzUmVzcG9uc2UgPSB7XHJcbiAgICAgICAgbWVzc2FnZTogJ0F1dG9tYXRlZCBCbG9nIFBvc3RlciBBUEkgaXMgcnVubmluZycsXHJcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcclxuICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgICAgICBjb250ZW50VGFibGU6IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSxcclxuICAgICAgICAgICAgdXNlclRhYmxlOiBwcm9jZXNzLmVudi5VU0VSX1RBQkxFX05BTUUsXHJcbiAgICAgICAgICAgIGF1ZGlvQnVja2V0OiBwcm9jZXNzLmVudi5BVURJT19CVUNLRVRfTkFNRSxcclxuICAgICAgICAgICAgaW1hZ2VCdWNrZXQ6IHByb2Nlc3MuZW52LklNQUdFX0JVQ0tFVF9OQU1FLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEFQSSBzdGF0dXMgZW5kcG9pbnRcclxuICAgIGlmIChtZXRob2QgPT09ICdHRVQnICYmIHBhdGggPT09ICcvYXBpL3N0YXR1cycpIHtcclxuICAgICAgY29uc3QgcmVzcG9uc2U6IFN1Y2Nlc3NSZXNwb25zZSA9IHtcclxuICAgICAgICBtZXNzYWdlOiAnQVBJIGlzIGhlYWx0aHknLFxyXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXHJcbiAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICBzZXJ2aWNlczoge1xyXG4gICAgICAgICAgICBkeW5hbW9kYjogJ2F2YWlsYWJsZScsXHJcbiAgICAgICAgICAgIHMzOiAnYXZhaWxhYmxlJyxcclxuICAgICAgICAgICAgc3FzOiAnYXZhaWxhYmxlJyxcclxuICAgICAgICAgICAgZXZlbnRicmlkZ2U6ICdhdmFpbGFibGUnLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENvbnRlbnQgZ2VuZXJhdGlvbiBlbmRwb2ludHNcclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9jb250ZW50L2dlbmVyYXRlJykge1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQ29udGVudEdlbmVyYXRpb24oZXZlbnQsIGNvbnRleHQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9hcGkvY29udGVudC9yZXZpc2UnKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVDb250ZW50UmV2aXNpb24oZXZlbnQsIGNvbnRleHQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobWV0aG9kID09PSAnR0VUJyAmJiBwYXRoLnN0YXJ0c1dpdGgoJy9hcGkvY29udGVudC9zdGF0dXMvJykpIHtcclxuICAgICAgY29uc3QgY29udGVudElkID0gcGF0aC5zcGxpdCgnLycpLnBvcCgpO1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQ29udGVudFN0YXR1cyhjb250ZW50SWQhLCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aC5zdGFydHNXaXRoKCcvYXBpL2NvbnRlbnQvJykgJiYgcGF0aC5lbmRzV2l0aCgnL21lc3NhZ2VzJykpIHtcclxuICAgICAgY29uc3QgcGF0aFBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xyXG4gICAgICBjb25zdCBjb250ZW50SWQgPSBwYXRoUGFydHNbcGF0aFBhcnRzLmxlbmd0aCAtIDJdO1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQ29udGVudE1lc3NhZ2VzKGNvbnRlbnRJZCwgY29udGV4dCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdHRVQnICYmIHBhdGguc3RhcnRzV2l0aCgnL2FwaS9jb250ZW50LycpICYmICFwYXRoLmluY2x1ZGVzKCcvJykpIHtcclxuICAgICAgY29uc3QgY29udGVudElkID0gcGF0aC5zcGxpdCgnLycpLnBvcCgpO1xyXG4gICAgICByZXR1cm4gYXdhaXQgaGFuZGxlR2V0Q29udGVudChjb250ZW50SWQhLCBjb250ZXh0LCBjb3JzSGVhZGVycyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2NvbnRlbnQvdmFsaWRhdGUnKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVDb250ZW50VmFsaWRhdGlvbihldmVudCwgY29udGV4dCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIERlZmF1bHQgNDA0IGZvciB1bm1hdGNoZWQgcm91dGVzXHJcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlOiBFcnJvclJlc3BvbnNlID0ge1xyXG4gICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgIG1lc3NhZ2U6IGBSb3V0ZSAke21ldGhvZH0gJHtwYXRofSBub3QgZm91bmRgLFxyXG4gICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShlcnJvclJlc3BvbnNlKSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdVbmhhbmRsZWQgZXJyb3I6JywgZXJyb3IpO1xyXG5cclxuICAgIGNvbnN0IGVycm9yUmVzcG9uc2U6IEVycm9yUmVzcG9uc2UgPSB7XHJcbiAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnQW4gdW5leHBlY3RlZCBlcnJvciBvY2N1cnJlZCcsXHJcbiAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGVycm9yUmVzcG9uc2UpLFxyXG4gICAgfTtcclxuICB9XHJcbn07XHJcblxyXG4vKipcclxuICogSGFuZGxlIGNvbnRlbnQgZ2VuZXJhdGlvbiByZXF1ZXN0XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVDb250ZW50R2VuZXJhdGlvbihcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShldmVudC5ib2R5IHx8ICd7fScpO1xyXG4gICAgY29uc3QgeyB0cmFuc2NyaXB0aW9uLCB1c2VySWQsIHVzZXJDb250ZXh0LCBwcmVmZXJlbmNlcyB9ID0gYm9keTtcclxuXHJcbiAgICBpZiAoIXRyYW5zY3JpcHRpb24gfHwgIXVzZXJJZCkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBlcnJvcjogJ0JhZCBSZXF1ZXN0JyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICd0cmFuc2NyaXB0aW9uIGFuZCB1c2VySWQgYXJlIHJlcXVpcmVkJyxcclxuICAgICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ3JlYXRlIGNvbnRlbnQgcmVjb3JkXHJcbiAgICBjb25zdCBjb250ZW50SWQgPSB1dWlkdjQoKTtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgUHV0SXRlbUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSEsXHJcbiAgICAgIEl0ZW06IHtcclxuICAgICAgICBpZDogeyBTOiBjb250ZW50SWQgfSxcclxuICAgICAgICB0eXBlOiB7IFM6ICdjb250ZW50JyB9LFxyXG4gICAgICAgIHVzZXJJZDogeyBTOiB1c2VySWQgfSxcclxuICAgICAgICBvcmlnaW5hbFRyYW5zY3JpcHRpb246IHsgUzogdHJhbnNjcmlwdGlvbiB9LFxyXG4gICAgICAgIHN0YXR1czogeyBTOiAncHJvY2Vzc2luZycgfSxcclxuICAgICAgICBjcmVhdGVkQXQ6IHsgUzogdGltZXN0YW1wIH0sXHJcbiAgICAgICAgdXBkYXRlZEF0OiB7IFM6IHRpbWVzdGFtcCB9LFxyXG4gICAgICAgIHVzZXJDb250ZXh0OiB7IFM6IHVzZXJDb250ZXh0IHx8ICcnIH0sXHJcbiAgICAgICAgcHJlZmVyZW5jZXM6IHsgUzogSlNPTi5zdHJpbmdpZnkocHJlZmVyZW5jZXMgfHwge30pIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gVHJpZ2dlciBjb250ZW50IGdlbmVyYXRpb24gd29ya2Zsb3dcclxuICAgIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgICBFbnRyaWVzOiBbe1xyXG4gICAgICAgIFNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5hcGknLFxyXG4gICAgICAgIERldGFpbFR5cGU6ICdDb250ZW50IEdlbmVyYXRpb24gUmVxdWVzdGVkJyxcclxuICAgICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICAgIHVzZXJJZCxcclxuICAgICAgICAgIHRyYW5zY3JpcHRpb24sXHJcbiAgICAgICAgICB1c2VyQ29udGV4dCxcclxuICAgICAgICAgIHByZWZlcmVuY2VzLFxyXG4gICAgICAgICAgdGltZXN0YW1wLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIEV2ZW50QnVzTmFtZTogcHJvY2Vzcy5lbnYuRVZFTlRfQlVTX05BTUUhLFxyXG4gICAgICB9XSxcclxuICAgIH0pKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgbWVzc2FnZTogJ0NvbnRlbnQgZ2VuZXJhdGlvbiBpbml0aWF0ZWQnLFxyXG4gICAgICAgIGRhdGE6IHsgY29udGVudElkIH0sXHJcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gY29udGVudCBnZW5lcmF0aW9uOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnRmFpbGVkIHRvIGluaXRpYXRlIGNvbnRlbnQgZ2VuZXJhdGlvbicsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBjb250ZW50IHJldmlzaW9uIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRSZXZpc2lvbihcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShldmVudC5ib2R5IHx8ICd7fScpO1xyXG4gICAgY29uc3QgeyBjb250ZW50SWQsIGN1cnJlbnRDb250ZW50LCBmZWVkYmFjaywgcmV2aXNpb25UeXBlLCB1c2VySWQgfSA9IGJvZHk7XHJcblxyXG4gICAgaWYgKCFjb250ZW50SWQgfHwgIWN1cnJlbnRDb250ZW50IHx8ICFmZWVkYmFjayB8fCAhdXNlcklkKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGVycm9yOiAnQmFkIFJlcXVlc3QnLFxyXG4gICAgICAgICAgbWVzc2FnZTogJ2NvbnRlbnRJZCwgY3VycmVudENvbnRlbnQsIGZlZWRiYWNrLCBhbmQgdXNlcklkIGFyZSByZXF1aXJlZCcsXHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENyZWF0ZSByZXZpc2lvbiByZWNvcmRcclxuICAgIGNvbnN0IHJldmlzaW9uSWQgPSB1dWlkdjQoKTtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICAvLyBUcmlnZ2VyIGNvbnRlbnQgcmV2aXNpb24gd29ya2Zsb3dcclxuICAgIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgICBFbnRyaWVzOiBbe1xyXG4gICAgICAgIFNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5hcGknLFxyXG4gICAgICAgIERldGFpbFR5cGU6ICdDb250ZW50IFJldmlzaW9uIFJlcXVlc3RlZCcsXHJcbiAgICAgICAgRGV0YWlsOiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBjb250ZW50SWQsXHJcbiAgICAgICAgICByZXZpc2lvbklkLFxyXG4gICAgICAgICAgY3VycmVudENvbnRlbnQsXHJcbiAgICAgICAgICBmZWVkYmFjayxcclxuICAgICAgICAgIHJldmlzaW9uVHlwZTogcmV2aXNpb25UeXBlIHx8ICdjb250ZW50JyxcclxuICAgICAgICAgIHVzZXJJZCxcclxuICAgICAgICAgIHRpbWVzdGFtcCxcclxuICAgICAgICB9KSxcclxuICAgICAgICBFdmVudEJ1c05hbWU6IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FISxcclxuICAgICAgfV0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIG1lc3NhZ2U6ICdDb250ZW50IHJldmlzaW9uIGluaXRpYXRlZCcsXHJcbiAgICAgICAgZGF0YTogeyByZXZpc2lvbklkIH0sXHJcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gY29udGVudCByZXZpc2lvbjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ0ZhaWxlZCB0byBpbml0aWF0ZSBjb250ZW50IHJldmlzaW9uJyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGNvbnRlbnQgc3RhdHVzIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRTdGF0dXMoXHJcbiAgY29udGVudElkOiBzdHJpbmcsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSEsXHJcbiAgICAgIEtleToge1xyXG4gICAgICAgIGlkOiB7IFM6IGNvbnRlbnRJZCB9LFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdOb3QgRm91bmQnLFxyXG4gICAgICAgICAgbWVzc2FnZTogJ0NvbnRlbnQgbm90IGZvdW5kJyxcclxuICAgICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgc3RhdHVzID0ge1xyXG4gICAgICBjb250ZW50SWQsXHJcbiAgICAgIHN0YXR1czogcmVzdWx0Lkl0ZW0uc3RhdHVzLlMhLFxyXG4gICAgICBwcm9ncmVzczogcmVzdWx0Lkl0ZW0ucHJvZ3Jlc3M/Lk4gPyBwYXJzZUludChyZXN1bHQuSXRlbS5wcm9ncmVzcy5OKSA6IHVuZGVmaW5lZCxcclxuICAgICAgY3VycmVudFN0ZXA6IHJlc3VsdC5JdGVtLmN1cnJlbnRTdGVwPy5TLFxyXG4gICAgICBlc3RpbWF0ZWRUaW1lUmVtYWluaW5nOiByZXN1bHQuSXRlbS5lc3RpbWF0ZWRUaW1lUmVtYWluaW5nPy5OID8gcGFyc2VJbnQocmVzdWx0Lkl0ZW0uZXN0aW1hdGVkVGltZVJlbWFpbmluZy5OKSA6IHVuZGVmaW5lZCxcclxuICAgICAgZXJyb3I6IHJlc3VsdC5JdGVtLmVycm9yPy5TLFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgbWVzc2FnZTogJ0NvbnRlbnQgc3RhdHVzIHJldHJpZXZlZCcsXHJcbiAgICAgICAgZGF0YTogc3RhdHVzLFxyXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgY29udGVudCBzdGF0dXM6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdGYWlsZWQgdG8gZ2V0IGNvbnRlbnQgc3RhdHVzJyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGdldCBjb250ZW50IHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUdldENvbnRlbnQoXHJcbiAgY29udGVudElkOiBzdHJpbmcsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSEsXHJcbiAgICAgIEtleToge1xyXG4gICAgICAgIGlkOiB7IFM6IGNvbnRlbnRJZCB9LFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgZXJyb3I6ICdOb3QgRm91bmQnLFxyXG4gICAgICAgICAgbWVzc2FnZTogJ0NvbnRlbnQgbm90IGZvdW5kJyxcclxuICAgICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgY29udGVudCA9IHtcclxuICAgICAgaWQ6IHJlc3VsdC5JdGVtLmlkLlMhLFxyXG4gICAgICB1c2VySWQ6IHJlc3VsdC5JdGVtLnVzZXJJZC5TISxcclxuICAgICAgdGl0bGU6IHJlc3VsdC5JdGVtLnRpdGxlPy5TLFxyXG4gICAgICBvcmlnaW5hbFRyYW5zY3JpcHRpb246IHJlc3VsdC5JdGVtLm9yaWdpbmFsVHJhbnNjcmlwdGlvbi5TISxcclxuICAgICAgY3VycmVudERyYWZ0OiByZXN1bHQuSXRlbS5jdXJyZW50RHJhZnQ/LlMgfHwgJycsXHJcbiAgICAgIGFzc29jaWF0ZWRJbWFnZTogcmVzdWx0Lkl0ZW0uYXNzb2NpYXRlZEltYWdlPy5TLFxyXG4gICAgICBpbWFnZVVybDogcmVzdWx0Lkl0ZW0uaW1hZ2VVcmw/LlMsXHJcbiAgICAgIHN0YXR1czogcmVzdWx0Lkl0ZW0uc3RhdHVzLlMhLFxyXG4gICAgICByZXZpc2lvbkhpc3Rvcnk6IHJlc3VsdC5JdGVtLnJldmlzaW9uSGlzdG9yeT8uUyA/IEpTT04ucGFyc2UocmVzdWx0Lkl0ZW0ucmV2aXNpb25IaXN0b3J5LlMpIDogW10sXHJcbiAgICAgIHB1Ymxpc2hpbmdSZXN1bHRzOiByZXN1bHQuSXRlbS5wdWJsaXNoaW5nUmVzdWx0cz8uUyA/IEpTT04ucGFyc2UocmVzdWx0Lkl0ZW0ucHVibGlzaGluZ1Jlc3VsdHMuUykgOiBbXSxcclxuICAgICAgY3JlYXRlZEF0OiByZXN1bHQuSXRlbS5jcmVhdGVkQXQuUyEsXHJcbiAgICAgIHVwZGF0ZWRBdDogcmVzdWx0Lkl0ZW0udXBkYXRlZEF0LlMhLFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgbWVzc2FnZTogJ0NvbnRlbnQgcmV0cmlldmVkJyxcclxuICAgICAgICBkYXRhOiBjb250ZW50LFxyXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgY29udGVudDonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ0ZhaWxlZCB0byBnZXQgY29udGVudCcsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhhbmRsZSBjb250ZW50IG1lc3NhZ2VzIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRNZXNzYWdlcyhcclxuICBjb250ZW50SWQ6IHN0cmluZyxcclxuICBjb250ZXh0OiBDb250ZXh0LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkFHRU5UX01FU1NBR0VTX1RBQkxFX05BTUUhLFxyXG4gICAgICBJbmRleE5hbWU6ICdDb250ZW50SWRJbmRleCcsXHJcbiAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdjb250ZW50SWQgPSA6Y29udGVudElkJyxcclxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICc6Y29udGVudElkJzogeyBTOiBjb250ZW50SWQgfSxcclxuICAgICAgfSxcclxuICAgICAgU2NhbkluZGV4Rm9yd2FyZDogZmFsc2UsIC8vIE1vc3QgcmVjZW50IGZpcnN0XHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc3QgbWVzc2FnZXMgPSByZXN1bHQuSXRlbXM/Lm1hcChpdGVtID0+ICh7XHJcbiAgICAgIGlkOiBpdGVtLmlkLlMhLFxyXG4gICAgICBjb250ZW50SWQ6IGl0ZW0uY29udGVudElkLlMhLFxyXG4gICAgICBhZ2VudFR5cGU6IGl0ZW0uYWdlbnRUeXBlLlMhLFxyXG4gICAgICBtZXNzYWdlVHlwZTogaXRlbS5tZXNzYWdlVHlwZS5TISxcclxuICAgICAgcGF5bG9hZDogaXRlbS5wYXlsb2FkLlMgPyBKU09OLnBhcnNlKGl0ZW0ucGF5bG9hZC5TKSA6IHt9LFxyXG4gICAgICBzdGF0dXM6IGl0ZW0uc3RhdHVzPy5TIHx8ICdwZW5kaW5nJyxcclxuICAgICAgZXJyb3I6IGl0ZW0uZXJyb3I/LlMsXHJcbiAgICAgIHJlc3VsdDogaXRlbS5yZXN1bHQ/LlMgPyBKU09OLnBhcnNlKGl0ZW0ucmVzdWx0LlMpIDogdW5kZWZpbmVkLFxyXG4gICAgICBjcmVhdGVkQXQ6IGl0ZW0udGltZXN0YW1wLlMhLFxyXG4gICAgICBwcm9jZXNzZWRBdDogaXRlbS5wcm9jZXNzZWRBdD8uUyxcclxuICAgIH0pKSB8fCBbXTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgbWVzc2FnZTogJ0NvbnRlbnQgbWVzc2FnZXMgcmV0cmlldmVkJyxcclxuICAgICAgICBkYXRhOiB7IG1lc3NhZ2VzIH0sXHJcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyBjb250ZW50IG1lc3NhZ2VzOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIFNlcnZlciBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnRmFpbGVkIHRvIGdldCBjb250ZW50IG1lc3NhZ2VzJyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIGNvbnRlbnQgdmFsaWRhdGlvbiByZXF1ZXN0XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVDb250ZW50VmFsaWRhdGlvbihcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShldmVudC5ib2R5IHx8ICd7fScpO1xyXG4gICAgY29uc3QgeyBjb250ZW50IH0gPSBib2R5O1xyXG5cclxuICAgIGlmICghY29udGVudCkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBlcnJvcjogJ0JhZCBSZXF1ZXN0JyxcclxuICAgICAgICAgIG1lc3NhZ2U6ICdjb250ZW50IGlzIHJlcXVpcmVkJyxcclxuICAgICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgICAgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQmFzaWMgY29udGVudCB2YWxpZGF0aW9uXHJcbiAgICBjb25zdCBpc3N1ZXM6IHN0cmluZ1tdID0gW107XHJcbiAgICBjb25zdCBzdWdnZXN0aW9uczogc3RyaW5nW10gPSBbXTtcclxuICAgIFxyXG4gICAgY29uc3Qgd29yZENvdW50ID0gY29udGVudC5zcGxpdCgvXFxzKy8pLmxlbmd0aDtcclxuICAgIGNvbnN0IGNoYXJDb3VudCA9IGNvbnRlbnQubGVuZ3RoO1xyXG5cclxuICAgIGlmICh3b3JkQ291bnQgPCAxMDApIHtcclxuICAgICAgaXNzdWVzLnB1c2goJ0NvbnRlbnQgaXMgdG9vIHNob3J0IGZvciBhIG1lYW5pbmdmdWwgYmxvZyBwb3N0Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGNoYXJDb3VudCA8IDUwMCkge1xyXG4gICAgICBpc3N1ZXMucHVzaCgnQ29udGVudCBuZWVkcyBtb3JlIGRldGFpbCBhbmQgZGVwdGgnKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIWNvbnRlbnQuaW5jbHVkZXMoJ1xcbicpKSB7XHJcbiAgICAgIHN1Z2dlc3Rpb25zLnB1c2goJ0NvbnNpZGVyIGJyZWFraW5nIGNvbnRlbnQgaW50byBwYXJhZ3JhcGhzIGZvciBiZXR0ZXIgcmVhZGFiaWxpdHknKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIS9bLiE/XSQvLnRlc3QoY29udGVudC50cmltKCkpKSB7XHJcbiAgICAgIGlzc3Vlcy5wdXNoKCdDb250ZW50IHNob3VsZCBlbmQgd2l0aCBwcm9wZXIgcHVuY3R1YXRpb24nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDYWxjdWxhdGUgcXVhbGl0eSBzY29yZVxyXG4gICAgbGV0IHNjb3JlID0gMTA7XHJcbiAgICBzY29yZSAtPSBpc3N1ZXMubGVuZ3RoICogMjtcclxuICAgIHNjb3JlIC09IHN1Z2dlc3Rpb25zLmxlbmd0aCAqIDAuNTtcclxuICAgIHNjb3JlID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAsIHNjb3JlKSk7XHJcblxyXG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IHtcclxuICAgICAgaXNWYWxpZDogaXNzdWVzLmxlbmd0aCA9PT0gMCxcclxuICAgICAgc2NvcmUsXHJcbiAgICAgIGlzc3VlcyxcclxuICAgICAgc3VnZ2VzdGlvbnMsXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBtZXNzYWdlOiAnQ29udGVudCB2YWxpZGF0aW9uIGNvbXBsZXRlZCcsXHJcbiAgICAgICAgZGF0YTogdmFsaWRhdGlvbixcclxuICAgICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciB2YWxpZGF0aW5nIGNvbnRlbnQ6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdGYWlsZWQgdG8gdmFsaWRhdGUgY29udGVudCcsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufSJdfQ==