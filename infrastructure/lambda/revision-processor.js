"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const uuid_1 = require("uuid");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new client_sqs_1.SQSClient({});
const CONTENT_TABLE = process.env.CONTENT_TABLE;
const AGENT_MESSAGES_TABLE = process.env.AGENT_MESSAGES_TABLE;
const CONTENT_GENERATION_QUEUE = process.env.CONTENT_GENERATION_QUEUE;
const IMAGE_GENERATION_QUEUE = process.env.IMAGE_GENERATION_QUEUE;
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
const handler = async (event) => {
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
        console.log(`Processing ${method} ${path}`);
        // Route handling
        if (method === 'POST' && path === '/api/revision/content') {
            return await handleContentRevision(event, corsHeaders);
        }
        if (method === 'POST' && path === '/api/revision/image') {
            return await handleImageRevision(event, corsHeaders);
        }
        if (method === 'GET' && path.startsWith('/api/revision/history/')) {
            const contentId = path.split('/').pop();
            return await handleGetRevisionHistory(contentId, corsHeaders);
        }
        if (method === 'POST' && path === '/api/revision/batch') {
            return await handleBatchRevision(event, corsHeaders);
        }
        // Default 404
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Route not found' }),
        };
    }
    catch (error) {
        console.error('Revision processor error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error'
            }),
        };
    }
};
exports.handler = handler;
async function handleContentRevision(event, corsHeaders) {
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
        // Get current content
        const content = await getContent(request.contentId);
        if (!content) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Content not found' }),
            };
        }
        // Create revision history entry
        const revisionId = (0, uuid_1.v4)();
        const revision = {
            id: revisionId,
            timestamp: new Date().toISOString(),
            feedback: request.feedback,
            revisionType: 'content',
            status: 'pending',
            userId: request.userId,
        };
        // Update content with new revision
        await addRevisionToContent(request.contentId, revision);
        // Update content status
        await updateContentStatus(request.contentId, 'processing_revision');
        // Analyze feedback to determine revision approach
        const revisionPlan = await analyzeFeedback(request.feedback, 'content');
        // Send revision request to content generation queue
        await sendRevisionToQueue(CONTENT_GENERATION_QUEUE, {
            contentId: request.contentId,
            revisionId,
            feedback: request.feedback,
            revisionPlan,
            currentContent: content.currentDraft,
            title: content.title,
            originalTranscription: content.originalTranscription,
            priority: request.priority || 'medium',
        });
        // Update revision status
        await updateRevisionStatus(request.contentId, revisionId, 'processing');
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                revisionId,
                message: 'Content revision request submitted successfully',
                estimatedTime: revisionPlan.estimatedTime,
            }),
        };
    }
    catch (error) {
        console.error('Error handling content revision:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Failed to process content revision',
                details: error instanceof Error ? error.message : 'Unknown error'
            }),
        };
    }
}
async function handleImageRevision(event, corsHeaders) {
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
        // Get current content
        const content = await getContent(request.contentId);
        if (!content) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Content not found' }),
            };
        }
        // Create revision history entry
        const revisionId = (0, uuid_1.v4)();
        const revision = {
            id: revisionId,
            timestamp: new Date().toISOString(),
            feedback: request.feedback,
            revisionType: 'image',
            status: 'pending',
            userId: request.userId,
        };
        // Update content with new revision
        await addRevisionToContent(request.contentId, revision);
        // Update content status
        await updateContentStatus(request.contentId, 'processing_image_revision');
        // Analyze feedback to create new image prompt
        const imagePrompt = await generateImagePromptFromFeedback(content.currentDraft, content.title, request.feedback, content.imageUrl);
        // Send revision request to image generation queue
        await sendRevisionToQueue(IMAGE_GENERATION_QUEUE, {
            contentId: request.contentId,
            revisionId,
            feedback: request.feedback,
            prompt: imagePrompt,
            previousImageUrl: content.imageUrl,
            priority: request.priority || 'medium',
        });
        // Update revision status
        await updateRevisionStatus(request.contentId, revisionId, 'processing');
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                revisionId,
                message: 'Image revision request submitted successfully',
                newPrompt: imagePrompt,
            }),
        };
    }
    catch (error) {
        console.error('Error handling image revision:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Failed to process image revision',
                details: error instanceof Error ? error.message : 'Unknown error'
            }),
        };
    }
}
async function handleGetRevisionHistory(contentId, corsHeaders) {
    try {
        const content = await getContent(contentId);
        if (!content) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Content not found' }),
            };
        }
        const revisionHistory = content.revisionHistory || [];
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                contentId,
                revisions: revisionHistory,
                totalRevisions: revisionHistory.length,
            }),
        };
    }
    catch (error) {
        console.error('Error getting revision history:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Failed to get revision history',
                details: error instanceof Error ? error.message : 'Unknown error'
            }),
        };
    }
}
async function handleBatchRevision(event, corsHeaders) {
    try {
        if (!event.body) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Request body is required' }),
            };
        }
        const { contentId, contentFeedback, imageFeedback, userId } = JSON.parse(event.body);
        if (!contentId || (!contentFeedback && !imageFeedback)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: 'contentId and at least one feedback type are required'
                }),
            };
        }
        const results = [];
        // Process content revision if provided
        if (contentFeedback) {
            const contentResult = await processRevision({
                contentId,
                feedback: contentFeedback,
                revisionType: 'content',
                userId,
            });
            results.push({ type: 'content', ...contentResult });
        }
        // Process image revision if provided
        if (imageFeedback) {
            const imageResult = await processRevision({
                contentId,
                feedback: imageFeedback,
                revisionType: 'image',
                userId,
            });
            results.push({ type: 'image', ...imageResult });
        }
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: 'Batch revision requests submitted successfully',
                results,
            }),
        };
    }
    catch (error) {
        console.error('Error handling batch revision:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Failed to process batch revision',
                details: error instanceof Error ? error.message : 'Unknown error'
            }),
        };
    }
}
// Helper functions
async function getContent(contentId) {
    const result = await docClient.send(new lib_dynamodb_1.GetCommand({
        TableName: CONTENT_TABLE,
        Key: { id: contentId },
    }));
    return result.Item;
}
async function addRevisionToContent(contentId, revision) {
    // Get current content to append to revision history
    const content = await getContent(contentId);
    const currentHistory = content?.revisionHistory || [];
    const updatedHistory = [...currentHistory, revision];
    await docClient.send(new lib_dynamodb_1.UpdateCommand({
        TableName: CONTENT_TABLE,
        Key: { id: contentId },
        UpdateExpression: 'SET #revisionHistory = :history, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
            '#revisionHistory': 'revisionHistory',
            '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
            ':history': updatedHistory,
            ':updatedAt': new Date().toISOString(),
        },
    }));
}
async function updateContentStatus(contentId, status) {
    await docClient.send(new lib_dynamodb_1.UpdateCommand({
        TableName: CONTENT_TABLE,
        Key: { id: contentId },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
            '#status': 'status',
            '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
            ':status': status,
            ':updatedAt': new Date().toISOString(),
        },
    }));
}
async function updateRevisionStatus(contentId, revisionId, status, result, error) {
    const content = await getContent(contentId);
    if (!content?.revisionHistory)
        return;
    const updatedHistory = content.revisionHistory.map((revision) => {
        if (revision.id === revisionId) {
            return {
                ...revision,
                status,
                ...(result && { result }),
                ...(error && { error }),
            };
        }
        return revision;
    });
    await docClient.send(new lib_dynamodb_1.UpdateCommand({
        TableName: CONTENT_TABLE,
        Key: { id: contentId },
        UpdateExpression: 'SET #revisionHistory = :history, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
            '#revisionHistory': 'revisionHistory',
            '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
            ':history': updatedHistory,
            ':updatedAt': new Date().toISOString(),
        },
    }));
}
async function analyzeFeedback(feedback, type) {
    // Simple feedback analysis - in production, this could use AI for better analysis
    const feedbackLower = feedback.toLowerCase();
    let category = 'general';
    let estimatedTime = 60; // seconds
    let approach = 'revision';
    if (type === 'content') {
        if (feedbackLower.includes('tone') || feedbackLower.includes('style')) {
            category = 'tone';
            estimatedTime = 45;
        }
        else if (feedbackLower.includes('structure') || feedbackLower.includes('organize')) {
            category = 'structure';
            estimatedTime = 90;
        }
        else if (feedbackLower.includes('length') || feedbackLower.includes('shorter') || feedbackLower.includes('longer')) {
            category = 'length';
            estimatedTime = 30;
        }
        else if (feedbackLower.includes('information') || feedbackLower.includes('add') || feedbackLower.includes('remove')) {
            category = 'information';
            estimatedTime = 120;
        }
    }
    else {
        if (feedbackLower.includes('color') || feedbackLower.includes('bright') || feedbackLower.includes('dark')) {
            category = 'colors';
            estimatedTime = 45;
        }
        else if (feedbackLower.includes('style') || feedbackLower.includes('artistic')) {
            category = 'style';
            estimatedTime = 60;
        }
        else if (feedbackLower.includes('composition') || feedbackLower.includes('layout')) {
            category = 'composition';
            estimatedTime = 75;
        }
    }
    return {
        category,
        estimatedTime,
        approach,
        priority: feedbackLower.includes('urgent') ? 'high' : 'medium',
    };
}
async function generateImagePromptFromFeedback(content, title, feedback, currentImageUrl) {
    // Extract key concepts from content
    const words = content.toLowerCase().split(/\s+/);
    const keyWords = words.filter(word => word.length > 4 &&
        !['that', 'this', 'with', 'from', 'they', 'have', 'will', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other'].includes(word));
    const concepts = keyWords.slice(0, 3).join(', ');
    // Analyze feedback for style preferences
    const feedbackLower = feedback.toLowerCase();
    let styleModifiers = '';
    if (feedbackLower.includes('colorful') || feedbackLower.includes('vibrant')) {
        styleModifiers += ', vibrant colors, colorful';
    }
    if (feedbackLower.includes('dark') || feedbackLower.includes('moody')) {
        styleModifiers += ', dark mood, dramatic lighting';
    }
    if (feedbackLower.includes('minimal') || feedbackLower.includes('simple')) {
        styleModifiers += ', minimalist, clean, simple';
    }
    if (feedbackLower.includes('artistic') || feedbackLower.includes('creative')) {
        styleModifiers += ', artistic, creative, expressive';
    }
    if (feedbackLower.includes('professional') || feedbackLower.includes('business')) {
        styleModifiers += ', professional, clean, modern';
    }
    return `Professional illustration representing ${title}, featuring ${concepts}${styleModifiers}, high quality, detailed`;
}
async function sendRevisionToQueue(queueUrl, message) {
    await sqsClient.send(new client_sqs_1.SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
            ...message,
            timestamp: new Date().toISOString(),
            type: 'revision_request',
        }),
    }));
}
async function processRevision(request) {
    // This is a helper function for batch processing
    const revisionId = (0, uuid_1.v4)();
    try {
        const content = await getContent(request.contentId);
        if (!content) {
            throw new Error('Content not found');
        }
        const revision = {
            id: revisionId,
            timestamp: new Date().toISOString(),
            feedback: request.feedback,
            revisionType: request.revisionType,
            status: 'pending',
            userId: request.userId,
        };
        await addRevisionToContent(request.contentId, revision);
        if (request.revisionType === 'content') {
            const revisionPlan = await analyzeFeedback(request.feedback, 'content');
            await sendRevisionToQueue(CONTENT_GENERATION_QUEUE, {
                contentId: request.contentId,
                revisionId,
                feedback: request.feedback,
                revisionPlan,
                currentContent: content.currentDraft,
                title: content.title,
                originalTranscription: content.originalTranscription,
            });
        }
        else {
            const imagePrompt = await generateImagePromptFromFeedback(content.currentDraft, content.title, request.feedback, content.imageUrl);
            await sendRevisionToQueue(IMAGE_GENERATION_QUEUE, {
                contentId: request.contentId,
                revisionId,
                feedback: request.feedback,
                prompt: imagePrompt,
                previousImageUrl: content.imageUrl,
            });
        }
        await updateRevisionStatus(request.contentId, revisionId, 'processing');
        return {
            success: true,
            revisionId,
            message: `${request.revisionType} revision submitted successfully`,
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmV2aXNpb24tcHJvY2Vzc29yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicmV2aXNpb24tcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLDhEQUEwRDtBQUMxRCx3REFBc0c7QUFDdEcsb0RBQW9FO0FBQ3BFLCtCQUFvQztBQUdwQyxNQUFNLFlBQVksR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDNUMsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sU0FBUyxHQUFHLElBQUksc0JBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUVwQyxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWMsQ0FBQztBQUNqRCxNQUFNLG9CQUFvQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQXFCLENBQUM7QUFDL0QsTUFBTSx3QkFBd0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLHdCQUF5QixDQUFDO0FBQ3ZFLE1BQU0sc0JBQXNCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQkFBdUIsQ0FBQztBQXNCbkUsdUJBQXVCO0FBQ3ZCLFNBQVMsY0FBYyxDQUFDLE1BQTBCO0lBQ2hELE1BQU0sY0FBYyxHQUFHO1FBQ3JCLGtDQUFrQztRQUNsQyx1QkFBdUI7UUFDdkIsdUJBQXVCO0tBQ3hCLENBQUM7SUFFRixNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksY0FBYyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFN0YsT0FBTztRQUNMLDZCQUE2QixFQUFFLGFBQWE7UUFDNUMsOEJBQThCLEVBQUUsdUZBQXVGO1FBQ3ZILDhCQUE4QixFQUFFLDZCQUE2QjtRQUM3RCxrQ0FBa0MsRUFBRSxPQUFPO1FBQzNDLGNBQWMs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QVBJR2F0ZXdheVByb3h5UmVzdWx0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgR2V0Q29tbWFuZCwgVXBkYXRlQ29tbWFuZCwgUHV0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcbmltcG9ydCB7IFNRU0NsaWVudCwgU2VuZE1lc3NhZ2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNxcyc7XHJcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xyXG5pbXBvcnQgZmV0Y2ggZnJvbSAnbm9kZS1mZXRjaCc7XHJcblxyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuY29uc3Qgc3FzQ2xpZW50ID0gbmV3IFNRU0NsaWVudCh7fSk7XHJcblxyXG5jb25zdCBDT05URU5UX1RBQkxFID0gcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRSE7XHJcbmNvbnN0IEFHRU5UX01FU1NBR0VTX1RBQkxFID0gcHJvY2Vzcy5lbnYuQUdFTlRfTUVTU0FHRVNfVEFCTEUhO1xyXG5jb25zdCBDT05URU5UX0dFTkVSQVRJT05fUVVFVUUgPSBwcm9jZXNzLmVudi5DT05URU5UX0dFTkVSQVRJT05fUVVFVUUhO1xyXG5jb25zdCBJTUFHRV9HRU5FUkFUSU9OX1FVRVVFID0gcHJvY2Vzcy5lbnYuSU1BR0VfR0VORVJBVElPTl9RVUVVRSE7XHJcblxyXG5pbnRlcmZhY2UgUmV2aXNpb25SZXF1ZXN0IHtcclxuICBjb250ZW50SWQ6IHN0cmluZztcclxuICBmZWVkYmFjazogc3RyaW5nO1xyXG4gIHJldmlzaW9uVHlwZTogJ2NvbnRlbnQnIHwgJ2ltYWdlJztcclxuICB1c2VySWQ/OiBzdHJpbmc7XHJcbiAgcHJpb3JpdHk/OiAnbG93JyB8ICdtZWRpdW0nIHwgJ2hpZ2gnO1xyXG4gIHNwZWNpZmljQ2hhbmdlcz86IHN0cmluZ1tdO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUmV2aXNpb25IaXN0b3J5IHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG4gIGZlZWRiYWNrOiBzdHJpbmc7XHJcbiAgcmV2aXNpb25UeXBlOiAnY29udGVudCcgfCAnaW1hZ2UnO1xyXG4gIHN0YXR1czogJ3BlbmRpbmcnIHwgJ3Byb2Nlc3NpbmcnIHwgJ2NvbXBsZXRlZCcgfCAnZmFpbGVkJztcclxuICB1c2VySWQ/OiBzdHJpbmc7XHJcbiAgcmVzdWx0PzogYW55O1xyXG4gIGVycm9yPzogc3RyaW5nO1xyXG59XHJcblxyXG4vLyBDT1JTIGhlbHBlciBmdW5jdGlvblxyXG5mdW5jdGlvbiBnZXRDb3JzSGVhZGVycyhvcmlnaW46IHN0cmluZyB8IHVuZGVmaW5lZCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xyXG4gIGNvbnN0IGFsbG93ZWRPcmlnaW5zID0gW1xyXG4gICAgJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJyxcclxuICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLFxyXG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycsXHJcbiAgXTtcclxuICBcclxuICBjb25zdCBhbGxvd2VkT3JpZ2luID0gb3JpZ2luICYmIGFsbG93ZWRPcmlnaW5zLmluY2x1ZGVzKG9yaWdpbikgPyBvcmlnaW4gOiBhbGxvd2VkT3JpZ2luc1swXTtcclxuICBcclxuICByZXR1cm4ge1xyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IGFsbG93ZWRPcmlnaW4sXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsQXV0aG9yaXphdGlvbixYLUFtei1EYXRlLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVJlcXVlc3RlZC1XaXRoJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUycsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiAnZmFsc2UnLFxyXG4gICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xyXG4gIGNvbnN0IGNvcnNIZWFkZXJzID0gZ2V0Q29yc0hlYWRlcnMoZXZlbnQuaGVhZGVycy5vcmlnaW4pO1xyXG5cclxuICAvLyBIYW5kbGUgcHJlZmxpZ2h0IHJlcXVlc3RzXHJcbiAgaWYgKGV2ZW50Lmh0dHBNZXRob2QgPT09ICdPUFRJT05TJykge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogJycsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHBhdGggPSBldmVudC5wYXRoO1xyXG4gICAgY29uc3QgbWV0aG9kID0gZXZlbnQuaHR0cE1ldGhvZDtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgUHJvY2Vzc2luZyAke21ldGhvZH0gJHtwYXRofWApO1xyXG5cclxuICAgIC8vIFJvdXRlIGhhbmRsaW5nXHJcbiAgICBpZiAobWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9hcGkvcmV2aXNpb24vY29udGVudCcpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUNvbnRlbnRSZXZpc2lvbihldmVudCwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9yZXZpc2lvbi9pbWFnZScpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUltYWdlUmV2aXNpb24oZXZlbnQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobWV0aG9kID09PSAnR0VUJyAmJiBwYXRoLnN0YXJ0c1dpdGgoJy9hcGkvcmV2aXNpb24vaGlzdG9yeS8nKSkge1xyXG4gICAgICBjb25zdCBjb250ZW50SWQgPSBwYXRoLnNwbGl0KCcvJykucG9wKCk7XHJcbiAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVHZXRSZXZpc2lvbkhpc3RvcnkoY29udGVudElkISwgY29yc0hlYWRlcnMpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9yZXZpc2lvbi9iYXRjaCcpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUJhdGNoUmV2aXNpb24oZXZlbnQsIGNvcnNIZWFkZXJzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBEZWZhdWx0IDQwNFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNDA0LFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1JvdXRlIG5vdCBmb3VuZCcgfSksXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignUmV2aXNpb24gcHJvY2Vzc29yIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIHNlcnZlciBlcnJvcicsXHJcbiAgICAgICAgZGV0YWlsczogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufTtcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRSZXZpc2lvbihcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29yc0hlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cclxuKTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICB0cnkge1xyXG4gICAgaWYgKCFldmVudC5ib2R5KSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlcXVlc3Q6IFJldmlzaW9uUmVxdWVzdCA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XHJcbiAgICBcclxuICAgIGlmICghcmVxdWVzdC5jb250ZW50SWQgfHwgIXJlcXVlc3QuZmVlZGJhY2spIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ2NvbnRlbnRJZCBhbmQgZmVlZGJhY2sgYXJlIHJlcXVpcmVkJyB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZXQgY3VycmVudCBjb250ZW50XHJcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgZ2V0Q29udGVudChyZXF1ZXN0LmNvbnRlbnRJZCk7XHJcbiAgICBpZiAoIWNvbnRlbnQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0NvbnRlbnQgbm90IGZvdW5kJyB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgcmV2aXNpb24gaGlzdG9yeSBlbnRyeVxyXG4gICAgY29uc3QgcmV2aXNpb25JZCA9IHV1aWR2NCgpO1xyXG4gICAgY29uc3QgcmV2aXNpb246IFJldmlzaW9uSGlzdG9yeSA9IHtcclxuICAgICAgaWQ6IHJldmlzaW9uSWQsXHJcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICBmZWVkYmFjazogcmVxdWVzdC5mZWVkYmFjayxcclxuICAgICAgcmV2aXNpb25UeXBlOiAnY29udGVudCcsXHJcbiAgICAgIHN0YXR1czogJ3BlbmRpbmcnLFxyXG4gICAgICB1c2VySWQ6IHJlcXVlc3QudXNlcklkLFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBVcGRhdGUgY29udGVudCB3aXRoIG5ldyByZXZpc2lvblxyXG4gICAgYXdhaXQgYWRkUmV2aXNpb25Ub0NvbnRlbnQocmVxdWVzdC5jb250ZW50SWQsIHJldmlzaW9uKTtcclxuXHJcbiAgICAvLyBVcGRhdGUgY29udGVudCBzdGF0dXNcclxuICAgIGF3YWl0IHVwZGF0ZUNvbnRlbnRTdGF0dXMocmVxdWVzdC5jb250ZW50SWQsICdwcm9jZXNzaW5nX3JldmlzaW9uJyk7XHJcblxyXG4gICAgLy8gQW5hbHl6ZSBmZWVkYmFjayB0byBkZXRlcm1pbmUgcmV2aXNpb24gYXBwcm9hY2hcclxuICAgIGNvbnN0IHJldmlzaW9uUGxhbiA9IGF3YWl0IGFuYWx5emVGZWVkYmFjayhyZXF1ZXN0LmZlZWRiYWNrLCAnY29udGVudCcpO1xyXG5cclxuICAgIC8vIFNlbmQgcmV2aXNpb24gcmVxdWVzdCB0byBjb250ZW50IGdlbmVyYXRpb24gcXVldWVcclxuICAgIGF3YWl0IHNlbmRSZXZpc2lvblRvUXVldWUoQ09OVEVOVF9HRU5FUkFUSU9OX1FVRVVFLCB7XHJcbiAgICAgIGNvbnRlbnRJZDogcmVxdWVzdC5jb250ZW50SWQsXHJcbiAgICAgIHJldmlzaW9uSWQsXHJcbiAgICAgIGZlZWRiYWNrOiByZXF1ZXN0LmZlZWRiYWNrLFxyXG4gICAgICByZXZpc2lvblBsYW4sXHJcbiAgICAgIGN1cnJlbnRDb250ZW50OiBjb250ZW50LmN1cnJlbnREcmFmdCxcclxuICAgICAgdGl0bGU6IGNvbnRlbnQudGl0bGUsXHJcbiAgICAgIG9yaWdpbmFsVHJhbnNjcmlwdGlvbjogY29udGVudC5vcmlnaW5hbFRyYW5zY3JpcHRpb24sXHJcbiAgICAgIHByaW9yaXR5OiByZXF1ZXN0LnByaW9yaXR5IHx8ICdtZWRpdW0nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVXBkYXRlIHJldmlzaW9uIHN0YXR1c1xyXG4gICAgYXdhaXQgdXBkYXRlUmV2aXNpb25TdGF0dXMocmVxdWVzdC5jb250ZW50SWQsIHJldmlzaW9uSWQsICdwcm9jZXNzaW5nJyk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgcmV2aXNpb25JZCxcclxuICAgICAgICBtZXNzYWdlOiAnQ29udGVudCByZXZpc2lvbiByZXF1ZXN0IHN1Ym1pdHRlZCBzdWNjZXNzZnVsbHknLFxyXG4gICAgICAgIGVzdGltYXRlZFRpbWU6IHJldmlzaW9uUGxhbi5lc3RpbWF0ZWRUaW1lLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBoYW5kbGluZyBjb250ZW50IHJldmlzaW9uOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ0ZhaWxlZCB0byBwcm9jZXNzIGNvbnRlbnQgcmV2aXNpb24nLFxyXG4gICAgICAgIGRldGFpbHM6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUltYWdlUmV2aXNpb24oXHJcbiAgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGlmICghZXZlbnQuYm9keSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUmVxdWVzdCBib2R5IGlzIHJlcXVpcmVkJyB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXF1ZXN0OiBSZXZpc2lvblJlcXVlc3QgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkpO1xyXG4gICAgXHJcbiAgICBpZiAoIXJlcXVlc3QuY29udGVudElkIHx8ICFyZXF1ZXN0LmZlZWRiYWNrKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdjb250ZW50SWQgYW5kIGZlZWRiYWNrIGFyZSByZXF1aXJlZCcgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2V0IGN1cnJlbnQgY29udGVudFxyXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IGdldENvbnRlbnQocmVxdWVzdC5jb250ZW50SWQpO1xyXG4gICAgaWYgKCFjb250ZW50KSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDA0LFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdDb250ZW50IG5vdCBmb3VuZCcgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ3JlYXRlIHJldmlzaW9uIGhpc3RvcnkgZW50cnlcclxuICAgIGNvbnN0IHJldmlzaW9uSWQgPSB1dWlkdjQoKTtcclxuICAgIGNvbnN0IHJldmlzaW9uOiBSZXZpc2lvbkhpc3RvcnkgPSB7XHJcbiAgICAgIGlkOiByZXZpc2lvbklkLFxyXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgZmVlZGJhY2s6IHJlcXVlc3QuZmVlZGJhY2ssXHJcbiAgICAgIHJldmlzaW9uVHlwZTogJ2ltYWdlJyxcclxuICAgICAgc3RhdHVzOiAncGVuZGluZycsXHJcbiAgICAgIHVzZXJJZDogcmVxdWVzdC51c2VySWQsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFVwZGF0ZSBjb250ZW50IHdpdGggbmV3IHJldmlzaW9uXHJcbiAgICBhd2FpdCBhZGRSZXZpc2lvblRvQ29udGVudChyZXF1ZXN0LmNvbnRlbnRJZCwgcmV2aXNpb24pO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBjb250ZW50IHN0YXR1c1xyXG4gICAgYXdhaXQgdXBkYXRlQ29udGVudFN0YXR1cyhyZXF1ZXN0LmNvbnRlbnRJZCwgJ3Byb2Nlc3NpbmdfaW1hZ2VfcmV2aXNpb24nKTtcclxuXHJcbiAgICAvLyBBbmFseXplIGZlZWRiYWNrIHRvIGNyZWF0ZSBuZXcgaW1hZ2UgcHJvbXB0XHJcbiAgICBjb25zdCBpbWFnZVByb21wdCA9IGF3YWl0IGdlbmVyYXRlSW1hZ2VQcm9tcHRGcm9tRmVlZGJhY2soXHJcbiAgICAgIGNvbnRlbnQuY3VycmVudERyYWZ0LFxyXG4gICAgICBjb250ZW50LnRpdGxlLFxyXG4gICAgICByZXF1ZXN0LmZlZWRiYWNrLFxyXG4gICAgICBjb250ZW50LmltYWdlVXJsXHJcbiAgICApO1xyXG5cclxuICAgIC8vIFNlbmQgcmV2aXNpb24gcmVxdWVzdCB0byBpbWFnZSBnZW5lcmF0aW9uIHF1ZXVlXHJcbiAgICBhd2FpdCBzZW5kUmV2aXNpb25Ub1F1ZXVlKElNQUdFX0dFTkVSQVRJT05fUVVFVUUsIHtcclxuICAgICAgY29udGVudElkOiByZXF1ZXN0LmNvbnRlbnRJZCxcclxuICAgICAgcmV2aXNpb25JZCxcclxuICAgICAgZmVlZGJhY2s6IHJlcXVlc3QuZmVlZGJhY2ssXHJcbiAgICAgIHByb21wdDogaW1hZ2VQcm9tcHQsXHJcbiAgICAgIHByZXZpb3VzSW1hZ2VVcmw6IGNvbnRlbnQuaW1hZ2VVcmwsXHJcbiAgICAgIHByaW9yaXR5OiByZXF1ZXN0LnByaW9yaXR5IHx8ICdtZWRpdW0nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVXBkYXRlIHJldmlzaW9uIHN0YXR1c1xyXG4gICAgYXdhaXQgdXBkYXRlUmV2aXNpb25TdGF0dXMocmVxdWVzdC5jb250ZW50SWQsIHJldmlzaW9uSWQsICdwcm9jZXNzaW5nJyk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgcmV2aXNpb25JZCxcclxuICAgICAgICBtZXNzYWdlOiAnSW1hZ2UgcmV2aXNpb24gcmVxdWVzdCBzdWJtaXR0ZWQgc3VjY2Vzc2Z1bGx5JyxcclxuICAgICAgICBuZXdQcm9tcHQ6IGltYWdlUHJvbXB0LFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBoYW5kbGluZyBpbWFnZSByZXZpc2lvbjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdGYWlsZWQgdG8gcHJvY2VzcyBpbWFnZSByZXZpc2lvbicsXHJcbiAgICAgICAgZGV0YWlsczogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlR2V0UmV2aXNpb25IaXN0b3J5KFxyXG4gIGNvbnRlbnRJZDogc3RyaW5nLFxyXG4gIGNvcnNIZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBnZXRDb250ZW50KGNvbnRlbnRJZCk7XHJcbiAgICBpZiAoIWNvbnRlbnQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0NvbnRlbnQgbm90IGZvdW5kJyB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXZpc2lvbkhpc3RvcnkgPSBjb250ZW50LnJldmlzaW9uSGlzdG9yeSB8fCBbXTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgY29udGVudElkLFxyXG4gICAgICAgIHJldmlzaW9uczogcmV2aXNpb25IaXN0b3J5LFxyXG4gICAgICAgIHRvdGFsUmV2aXNpb25zOiByZXZpc2lvbkhpc3RvcnkubGVuZ3RoLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIHJldmlzaW9uIGhpc3Rvcnk6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGVycm9yOiAnRmFpbGVkIHRvIGdldCByZXZpc2lvbiBoaXN0b3J5JyxcclxuICAgICAgICBkZXRhaWxzOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xyXG4gICAgICB9KSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVCYXRjaFJldmlzaW9uKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb3JzSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoIWV2ZW50LmJvZHkpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1JlcXVlc3QgYm9keSBpcyByZXF1aXJlZCcgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgeyBjb250ZW50SWQsIGNvbnRlbnRGZWVkYmFjaywgaW1hZ2VGZWVkYmFjaywgdXNlcklkIH0gPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkpO1xyXG4gICAgXHJcbiAgICBpZiAoIWNvbnRlbnRJZCB8fCAoIWNvbnRlbnRGZWVkYmFjayAmJiAhaW1hZ2VGZWVkYmFjaykpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBcclxuICAgICAgICAgIGVycm9yOiAnY29udGVudElkIGFuZCBhdCBsZWFzdCBvbmUgZmVlZGJhY2sgdHlwZSBhcmUgcmVxdWlyZWQnIFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlc3VsdHMgPSBbXTtcclxuXHJcbiAgICAvLyBQcm9jZXNzIGNvbnRlbnQgcmV2aXNpb24gaWYgcHJvdmlkZWRcclxuICAgIGlmIChjb250ZW50RmVlZGJhY2spIHtcclxuICAgICAgY29uc3QgY29udGVudFJlc3VsdCA9IGF3YWl0IHByb2Nlc3NSZXZpc2lvbih7XHJcbiAgICAgICAgY29udGVudElkLFxyXG4gICAgICAgIGZlZWRiYWNrOiBjb250ZW50RmVlZGJhY2ssXHJcbiAgICAgICAgcmV2aXNpb25UeXBlOiAnY29udGVudCcsXHJcbiAgICAgICAgdXNlcklkLFxyXG4gICAgICB9KTtcclxuICAgICAgcmVzdWx0cy5wdXNoKHsgdHlwZTogJ2NvbnRlbnQnLCAuLi5jb250ZW50UmVzdWx0IH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFByb2Nlc3MgaW1hZ2UgcmV2aXNpb24gaWYgcHJvdmlkZWRcclxuICAgIGlmIChpbWFnZUZlZWRiYWNrKSB7XHJcbiAgICAgIGNvbnN0IGltYWdlUmVzdWx0ID0gYXdhaXQgcHJvY2Vzc1JldmlzaW9uKHtcclxuICAgICAgICBjb250ZW50SWQsXHJcbiAgICAgICAgZmVlZGJhY2s6IGltYWdlRmVlZGJhY2ssXHJcbiAgICAgICAgcmV2aXNpb25UeXBlOiAnaW1hZ2UnLFxyXG4gICAgICAgIHVzZXJJZCxcclxuICAgICAgfSk7XHJcbiAgICAgIHJlc3VsdHMucHVzaCh7IHR5cGU6ICdpbWFnZScsIC4uLmltYWdlUmVzdWx0IH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdCYXRjaCByZXZpc2lvbiByZXF1ZXN0cyBzdWJtaXR0ZWQgc3VjY2Vzc2Z1bGx5JyxcclxuICAgICAgICByZXN1bHRzLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBoYW5kbGluZyBiYXRjaCByZXZpc2lvbjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdGYWlsZWQgdG8gcHJvY2VzcyBiYXRjaCByZXZpc2lvbicsXHJcbiAgICAgICAgZGV0YWlsczogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuLy8gSGVscGVyIGZ1bmN0aW9uc1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gZ2V0Q29udGVudChjb250ZW50SWQ6IHN0cmluZykge1xyXG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgIEtleTogeyBpZDogY29udGVudElkIH0sXHJcbiAgfSkpO1xyXG4gIHJldHVybiByZXN1bHQuSXRlbTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gYWRkUmV2aXNpb25Ub0NvbnRlbnQoY29udGVudElkOiBzdHJpbmcsIHJldmlzaW9uOiBSZXZpc2lvbkhpc3RvcnkpIHtcclxuICAvLyBHZXQgY3VycmVudCBjb250ZW50IHRvIGFwcGVuZCB0byByZXZpc2lvbiBoaXN0b3J5XHJcbiAgY29uc3QgY29udGVudCA9IGF3YWl0IGdldENvbnRlbnQoY29udGVudElkKTtcclxuICBjb25zdCBjdXJyZW50SGlzdG9yeSA9IGNvbnRlbnQ/LnJldmlzaW9uSGlzdG9yeSB8fCBbXTtcclxuICBjb25zdCB1cGRhdGVkSGlzdG9yeSA9IFsuLi5jdXJyZW50SGlzdG9yeSwgcmV2aXNpb25dO1xyXG5cclxuICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgVXBkYXRlQ29tbWFuZCh7XHJcbiAgICBUYWJsZU5hbWU6IENPTlRFTlRfVEFCTEUsXHJcbiAgICBLZXk6IHsgaWQ6IGNvbnRlbnRJZCB9LFxyXG4gICAgVXBkYXRlRXhwcmVzc2lvbjogJ1NFVCAjcmV2aXNpb25IaXN0b3J5ID0gOmhpc3RvcnksICN1cGRhdGVkQXQgPSA6dXBkYXRlZEF0JyxcclxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczoge1xyXG4gICAgICAnI3JldmlzaW9uSGlzdG9yeSc6ICdyZXZpc2lvbkhpc3RvcnknLFxyXG4gICAgICAnI3VwZGF0ZWRBdCc6ICd1cGRhdGVkQXQnLFxyXG4gICAgfSxcclxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgJzpoaXN0b3J5JzogdXBkYXRlZEhpc3RvcnksXHJcbiAgICAgICc6dXBkYXRlZEF0JzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgfSxcclxuICB9KSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZUNvbnRlbnRTdGF0dXMoY29udGVudElkOiBzdHJpbmcsIHN0YXR1czogc3RyaW5nKSB7XHJcbiAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgS2V5OiB7IGlkOiBjb250ZW50SWQgfSxcclxuICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsICN1cGRhdGVkQXQgPSA6dXBkYXRlZEF0JyxcclxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczoge1xyXG4gICAgICAnI3N0YXR1cyc6ICdzdGF0dXMnLFxyXG4gICAgICAnI3VwZGF0ZWRBdCc6ICd1cGRhdGVkQXQnLFxyXG4gICAgfSxcclxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgJzpzdGF0dXMnOiBzdGF0dXMsXHJcbiAgICAgICc6dXBkYXRlZEF0JzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgfSxcclxuICB9KSk7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZVJldmlzaW9uU3RhdHVzKGNvbnRlbnRJZDogc3RyaW5nLCByZXZpc2lvbklkOiBzdHJpbmcsIHN0YXR1czogc3RyaW5nLCByZXN1bHQ/OiBhbnksIGVycm9yPzogc3RyaW5nKSB7XHJcbiAgY29uc3QgY29udGVudCA9IGF3YWl0IGdldENvbnRlbnQoY29udGVudElkKTtcclxuICBpZiAoIWNvbnRlbnQ/LnJldmlzaW9uSGlzdG9yeSkgcmV0dXJuO1xyXG5cclxuICBjb25zdCB1cGRhdGVkSGlzdG9yeSA9IGNvbnRlbnQucmV2aXNpb25IaXN0b3J5Lm1hcCgocmV2aXNpb246IFJldmlzaW9uSGlzdG9yeSkgPT4ge1xyXG4gICAgaWYgKHJldmlzaW9uLmlkID09PSByZXZpc2lvbklkKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgLi4ucmV2aXNpb24sXHJcbiAgICAgICAgc3RhdHVzLFxyXG4gICAgICAgIC4uLihyZXN1bHQgJiYgeyByZXN1bHQgfSksXHJcbiAgICAgICAgLi4uKGVycm9yICYmIHsgZXJyb3IgfSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmV2aXNpb247XHJcbiAgfSk7XHJcblxyXG4gIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBVcGRhdGVDb21tYW5kKHtcclxuICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgIEtleTogeyBpZDogY29udGVudElkIH0sXHJcbiAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUICNyZXZpc2lvbkhpc3RvcnkgPSA6aGlzdG9yeSwgI3VwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnLFxyXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XHJcbiAgICAgICcjcmV2aXNpb25IaXN0b3J5JzogJ3JldmlzaW9uSGlzdG9yeScsXHJcbiAgICAgICcjdXBkYXRlZEF0JzogJ3VwZGF0ZWRBdCcsXHJcbiAgICB9LFxyXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAnOmhpc3RvcnknOiB1cGRhdGVkSGlzdG9yeSxcclxuICAgICAgJzp1cGRhdGVkQXQnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICB9LFxyXG4gIH0pKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gYW5hbHl6ZUZlZWRiYWNrKGZlZWRiYWNrOiBzdHJpbmcsIHR5cGU6ICdjb250ZW50JyB8ICdpbWFnZScpIHtcclxuICAvLyBTaW1wbGUgZmVlZGJhY2sgYW5hbHlzaXMgLSBpbiBwcm9kdWN0aW9uLCB0aGlzIGNvdWxkIHVzZSBBSSBmb3IgYmV0dGVyIGFuYWx5c2lzXHJcbiAgY29uc3QgZmVlZGJhY2tMb3dlciA9IGZlZWRiYWNrLnRvTG93ZXJDYXNlKCk7XHJcbiAgXHJcbiAgbGV0IGNhdGVnb3J5ID0gJ2dlbmVyYWwnO1xyXG4gIGxldCBlc3RpbWF0ZWRUaW1lID0gNjA7IC8vIHNlY29uZHNcclxuICBsZXQgYXBwcm9hY2ggPSAncmV2aXNpb24nO1xyXG5cclxuICBpZiAodHlwZSA9PT0gJ2NvbnRlbnQnKSB7XHJcbiAgICBpZiAoZmVlZGJhY2tMb3dlci5pbmNsdWRlcygndG9uZScpIHx8IGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ3N0eWxlJykpIHtcclxuICAgICAgY2F0ZWdvcnkgPSAndG9uZSc7XHJcbiAgICAgIGVzdGltYXRlZFRpbWUgPSA0NTtcclxuICAgIH0gZWxzZSBpZiAoZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnc3RydWN0dXJlJykgfHwgZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnb3JnYW5pemUnKSkge1xyXG4gICAgICBjYXRlZ29yeSA9ICdzdHJ1Y3R1cmUnO1xyXG4gICAgICBlc3RpbWF0ZWRUaW1lID0gOTA7XHJcbiAgICB9IGVsc2UgaWYgKGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ2xlbmd0aCcpIHx8IGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ3Nob3J0ZXInKSB8fCBmZWVkYmFja0xvd2VyLmluY2x1ZGVzKCdsb25nZXInKSkge1xyXG4gICAgICBjYXRlZ29yeSA9ICdsZW5ndGgnO1xyXG4gICAgICBlc3RpbWF0ZWRUaW1lID0gMzA7XHJcbiAgICB9IGVsc2UgaWYgKGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ2luZm9ybWF0aW9uJykgfHwgZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnYWRkJykgfHwgZmVlZGJhY2tMb3dlci5pbmNsdWRlcygncmVtb3ZlJykpIHtcclxuICAgICAgY2F0ZWdvcnkgPSAnaW5mb3JtYXRpb24nO1xyXG4gICAgICBlc3RpbWF0ZWRUaW1lID0gMTIwO1xyXG4gICAgfVxyXG4gIH0gZWxzZSB7XHJcbiAgICBpZiAoZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnY29sb3InKSB8fCBmZWVkYmFja0xvd2VyLmluY2x1ZGVzKCdicmlnaHQnKSB8fCBmZWVkYmFja0xvd2VyLmluY2x1ZGVzKCdkYXJrJykpIHtcclxuICAgICAgY2F0ZWdvcnkgPSAnY29sb3JzJztcclxuICAgICAgZXN0aW1hdGVkVGltZSA9IDQ1O1xyXG4gICAgfSBlbHNlIGlmIChmZWVkYmFja0xvd2VyLmluY2x1ZGVzKCdzdHlsZScpIHx8IGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ2FydGlzdGljJykpIHtcclxuICAgICAgY2F0ZWdvcnkgPSAnc3R5bGUnO1xyXG4gICAgICBlc3RpbWF0ZWRUaW1lID0gNjA7XHJcbiAgICB9IGVsc2UgaWYgKGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ2NvbXBvc2l0aW9uJykgfHwgZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnbGF5b3V0JykpIHtcclxuICAgICAgY2F0ZWdvcnkgPSAnY29tcG9zaXRpb24nO1xyXG4gICAgICBlc3RpbWF0ZWRUaW1lID0gNzU7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4ge1xyXG4gICAgY2F0ZWdvcnksXHJcbiAgICBlc3RpbWF0ZWRUaW1lLFxyXG4gICAgYXBwcm9hY2gsXHJcbiAgICBwcmlvcml0eTogZmVlZGJhY2tMb3dlci5pbmNsdWRlcygndXJnZW50JykgPyAnaGlnaCcgOiAnbWVkaXVtJyxcclxuICB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUltYWdlUHJvbXB0RnJvbUZlZWRiYWNrKFxyXG4gIGNvbnRlbnQ6IHN0cmluZyxcclxuICB0aXRsZTogc3RyaW5nLFxyXG4gIGZlZWRiYWNrOiBzdHJpbmcsXHJcbiAgY3VycmVudEltYWdlVXJsPzogc3RyaW5nXHJcbik6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgLy8gRXh0cmFjdCBrZXkgY29uY2VwdHMgZnJvbSBjb250ZW50XHJcbiAgY29uc3Qgd29yZHMgPSBjb250ZW50LnRvTG93ZXJDYXNlKCkuc3BsaXQoL1xccysvKTtcclxuICBjb25zdCBrZXlXb3JkcyA9IHdvcmRzLmZpbHRlcih3b3JkID0+IFxyXG4gICAgd29yZC5sZW5ndGggPiA0ICYmIFxyXG4gICAgIVsndGhhdCcsICd0aGlzJywgJ3dpdGgnLCAnZnJvbScsICd0aGV5JywgJ2hhdmUnLCAnd2lsbCcsICdiZWVuJywgJ3dlcmUnLCAnc2FpZCcsICdlYWNoJywgJ3doaWNoJywgJ3RoZWlyJywgJ3RpbWUnLCAnd291bGQnLCAndGhlcmUnLCAnY291bGQnLCAnb3RoZXInXS5pbmNsdWRlcyh3b3JkKVxyXG4gICk7XHJcbiAgXHJcbiAgY29uc3QgY29uY2VwdHMgPSBrZXlXb3Jkcy5zbGljZSgwLCAzKS5qb2luKCcsICcpO1xyXG4gIFxyXG4gIC8vIEFuYWx5emUgZmVlZGJhY2sgZm9yIHN0eWxlIHByZWZlcmVuY2VzXHJcbiAgY29uc3QgZmVlZGJhY2tMb3dlciA9IGZlZWRiYWNrLnRvTG93ZXJDYXNlKCk7XHJcbiAgbGV0IHN0eWxlTW9kaWZpZXJzID0gJyc7XHJcbiAgXHJcbiAgaWYgKGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ2NvbG9yZnVsJykgfHwgZmVlZGJhY2tMb3dlci5pbmNsdWRlcygndmlicmFudCcpKSB7XHJcbiAgICBzdHlsZU1vZGlmaWVycyArPSAnLCB2aWJyYW50IGNvbG9ycywgY29sb3JmdWwnO1xyXG4gIH1cclxuICBpZiAoZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnZGFyaycpIHx8IGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ21vb2R5JykpIHtcclxuICAgIHN0eWxlTW9kaWZpZXJzICs9ICcsIGRhcmsgbW9vZCwgZHJhbWF0aWMgbGlnaHRpbmcnO1xyXG4gIH1cclxuICBpZiAoZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnbWluaW1hbCcpIHx8IGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ3NpbXBsZScpKSB7XHJcbiAgICBzdHlsZU1vZGlmaWVycyArPSAnLCBtaW5pbWFsaXN0LCBjbGVhbiwgc2ltcGxlJztcclxuICB9XHJcbiAgaWYgKGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ2FydGlzdGljJykgfHwgZmVlZGJhY2tMb3dlci5pbmNsdWRlcygnY3JlYXRpdmUnKSkge1xyXG4gICAgc3R5bGVNb2RpZmllcnMgKz0gJywgYXJ0aXN0aWMsIGNyZWF0aXZlLCBleHByZXNzaXZlJztcclxuICB9XHJcbiAgaWYgKGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ3Byb2Zlc3Npb25hbCcpIHx8IGZlZWRiYWNrTG93ZXIuaW5jbHVkZXMoJ2J1c2luZXNzJykpIHtcclxuICAgIHN0eWxlTW9kaWZpZXJzICs9ICcsIHByb2Zlc3Npb25hbCwgY2xlYW4sIG1vZGVybic7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gYFByb2Zlc3Npb25hbCBpbGx1c3RyYXRpb24gcmVwcmVzZW50aW5nICR7dGl0bGV9LCBmZWF0dXJpbmcgJHtjb25jZXB0c30ke3N0eWxlTW9kaWZpZXJzfSwgaGlnaCBxdWFsaXR5LCBkZXRhaWxlZGA7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHNlbmRSZXZpc2lvblRvUXVldWUocXVldWVVcmw6IHN0cmluZywgbWVzc2FnZTogYW55KSB7XHJcbiAgYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XHJcbiAgICBRdWV1ZVVybDogcXVldWVVcmwsXHJcbiAgICBNZXNzYWdlQm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAuLi5tZXNzYWdlLFxyXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgdHlwZTogJ3JldmlzaW9uX3JlcXVlc3QnLFxyXG4gICAgfSksXHJcbiAgfSkpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBwcm9jZXNzUmV2aXNpb24ocmVxdWVzdDogUmV2aXNpb25SZXF1ZXN0KSB7XHJcbiAgLy8gVGhpcyBpcyBhIGhlbHBlciBmdW5jdGlvbiBmb3IgYmF0Y2ggcHJvY2Vzc2luZ1xyXG4gIGNvbnN0IHJldmlzaW9uSWQgPSB1dWlkdjQoKTtcclxuICBcclxuICB0cnkge1xyXG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IGdldENvbnRlbnQocmVxdWVzdC5jb250ZW50SWQpO1xyXG4gICAgaWYgKCFjb250ZW50KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29udGVudCBub3QgZm91bmQnKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXZpc2lvbjogUmV2aXNpb25IaXN0b3J5ID0ge1xyXG4gICAgICBpZDogcmV2aXNpb25JZCxcclxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIGZlZWRiYWNrOiByZXF1ZXN0LmZlZWRiYWNrLFxyXG4gICAgICByZXZpc2lvblR5cGU6IHJlcXVlc3QucmV2aXNpb25UeXBlLFxyXG4gICAgICBzdGF0dXM6ICdwZW5kaW5nJyxcclxuICAgICAgdXNlcklkOiByZXF1ZXN0LnVzZXJJZCxcclxuICAgIH07XHJcblxyXG4gICAgYXdhaXQgYWRkUmV2aXNpb25Ub0NvbnRlbnQocmVxdWVzdC5jb250ZW50SWQsIHJldmlzaW9uKTtcclxuXHJcbiAgICBpZiAocmVxdWVzdC5yZXZpc2lvblR5cGUgPT09ICdjb250ZW50Jykge1xyXG4gICAgICBjb25zdCByZXZpc2lvblBsYW4gPSBhd2FpdCBhbmFseXplRmVlZGJhY2socmVxdWVzdC5mZWVkYmFjaywgJ2NvbnRlbnQnKTtcclxuICAgICAgYXdhaXQgc2VuZFJldmlzaW9uVG9RdWV1ZShDT05URU5UX0dFTkVSQVRJT05fUVVFVUUsIHtcclxuICAgICAgICBjb250ZW50SWQ6IHJlcXVlc3QuY29udGVudElkLFxyXG4gICAgICAgIHJldmlzaW9uSWQsXHJcbiAgICAgICAgZmVlZGJhY2s6IHJlcXVlc3QuZmVlZGJhY2ssXHJcbiAgICAgICAgcmV2aXNpb25QbGFuLFxyXG4gICAgICAgIGN1cnJlbnRDb250ZW50OiBjb250ZW50LmN1cnJlbnREcmFmdCxcclxuICAgICAgICB0aXRsZTogY29udGVudC50aXRsZSxcclxuICAgICAgICBvcmlnaW5hbFRyYW5zY3JpcHRpb246IGNvbnRlbnQub3JpZ2luYWxUcmFuc2NyaXB0aW9uLFxyXG4gICAgICB9KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnN0IGltYWdlUHJvbXB0ID0gYXdhaXQgZ2VuZXJhdGVJbWFnZVByb21wdEZyb21GZWVkYmFjayhcclxuICAgICAgICBjb250ZW50LmN1cnJlbnREcmFmdCxcclxuICAgICAgICBjb250ZW50LnRpdGxlLFxyXG4gICAgICAgIHJlcXVlc3QuZmVlZGJhY2ssXHJcbiAgICAgICAgY29udGVudC5pbWFnZVVybFxyXG4gICAgICApO1xyXG4gICAgICBhd2FpdCBzZW5kUmV2aXNpb25Ub1F1ZXVlKElNQUdFX0dFTkVSQVRJT05fUVVFVUUsIHtcclxuICAgICAgICBjb250ZW50SWQ6IHJlcXVlc3QuY29udGVudElkLFxyXG4gICAgICAgIHJldmlzaW9uSWQsXHJcbiAgICAgICAgZmVlZGJhY2s6IHJlcXVlc3QuZmVlZGJhY2ssXHJcbiAgICAgICAgcHJvbXB0OiBpbWFnZVByb21wdCxcclxuICAgICAgICBwcmV2aW91c0ltYWdlVXJsOiBjb250ZW50LmltYWdlVXJsLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB1cGRhdGVSZXZpc2lvblN0YXR1cyhyZXF1ZXN0LmNvbnRlbnRJZCwgcmV2aXNpb25JZCwgJ3Byb2Nlc3NpbmcnKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICByZXZpc2lvbklkLFxyXG4gICAgICBtZXNzYWdlOiBgJHtyZXF1ZXN0LnJldmlzaW9uVHlwZX0gcmV2aXNpb24gc3VibWl0dGVkIHN1Y2Nlc3NmdWxseWAsXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcclxuICAgIH07XHJcbiAgfVxyXG59Il19