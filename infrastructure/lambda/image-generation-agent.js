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
const node_fetch_1 = __importDefault(require("node-fetch"));
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new client_s3_1.S3Client({});
const sqsClient = new client_sqs_1.SQSClient({});
const CONTENT_TABLE = process.env.CONTENT_TABLE;
const IMAGE_BUCKET = process.env.IMAGE_BUCKET;
const ORCHESTRATOR_QUEUE = process.env.ORCHESTRATOR_QUEUE;
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
        // Update content status to indicate image generation in progress
        await updateContentStatus(request.contentId, 'generating_image');
        // Generate image using OpenAI DALL-E
        const imageResult = await generateImage(request);
        if (!imageResult.success) {
            await updateContentStatus(request.contentId, 'image_generation_failed', imageResult.error);
            return {
                statusCode: 500,
                headers: corsHeaders,
                body: JSON.stringify({ error: imageResult.error }),
            };
        }
        // Store image URL in content record
        await updateContentWithImage(request.contentId, imageResult.imageUrl);
        // Notify orchestrator that image generation is complete
        await notifyOrchestrator(request.contentId, 'image_generated', {
            imageUrl: imageResult.imageUrl,
        });
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                imageUrl: imageResult.imageUrl,
            }),
        };
    }
    catch (error) {
        console.error('Image generation error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal server error during image generation',
                details: error instanceof Error ? error.message : 'Unknown error'
            }),
        };
    }
};
exports.handler = handler;
async function generateImage(request) {
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
                quality: 'standard',
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
        // Download and store the image in S3
        const storedImageUrl = await storeImageInS3(imageUrl, request.contentId);
        return {
            success: true,
            imageUrl: storedImageUrl
        };
    }
    catch (error) {
        console.error('Error generating image:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during image generation'
        };
    }
}
async function storeImageInS3(imageUrl, contentId) {
    try {
        // Download the image
        const response = await (0, node_fetch_1.default)(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.statusText}`);
        }
        const imageBuffer = await response.arrayBuffer();
        const key = `images/${contentId}/${Date.now()}.png`;
        // Upload to S3
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: IMAGE_BUCKET,
            Key: key,
            Body: new Uint8Array(imageBuffer),
            ContentType: 'image/png',
        }));
        // Return the S3 URL
        return `https://${IMAGE_BUCKET}.s3.amazonaws.com/${key}`;
    }
    catch (error) {
        console.error('Error storing image in S3:', error);
        throw error;
    }
}
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
async function notifyOrchestrator(contentId, event, data) {
    await sqsClient.send(new client_sqs_1.SendMessageCommand({
        QueueUrl: ORCHESTRATOR_QUEUE,
        MessageBody: JSON.stringify({
            contentId,
            event,
            data,
            timestamp: new Date().toISOString(),
        }),
    }));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImltYWdlLWdlbmVyYXRpb24tYWdlbnQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUEwRjtBQUMxRixrREFBZ0U7QUFDaEUsb0RBQW9FO0FBQ3BFLDREQUErQjtBQUUvQixNQUFNLFlBQVksR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDNUMsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sUUFBUSxHQUFHLElBQUksb0JBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUNsQyxNQUFNLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxDQUFDLENBQUM7QUFFcEMsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFjLENBQUM7QUFDakQsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFhLENBQUM7QUFDL0MsTUFBTSxrQkFBa0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFtQixDQUFDO0FBQzNELE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBZSxDQUFDO0FBZW5ELHVCQUF1QjtBQUN2QixTQUFTLGNBQWMsQ0FBQyxNQUEwQjtJQUNoRCxNQUFNLGNBQWMsR0FBRztRQUNyQixrQ0FBa0M7UUFDbEMsdUJBQXVCO1FBQ3ZCLHVCQUF1QjtLQUN4QixDQUFDO0lBRUYsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRTdGLE9BQU87UUFDTCw2QkFBNkIsRUFBRSxhQUFhO1FBQzVDLDhCQUE4QixFQUFF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QUNyRCxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUM7QUFFRCxLQUFLLFVBQVUsc0JBQXNCLENBQUMsU0FBaUIsRUFBRSxRQUFnQjtJQUN2RSxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSw0QkFBYSxDQUFDO1FBQ3JDLFNBQVMsRUFBRSxhQUFhO1FBQ3hCLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxTQUFTLEVBQUU7UUFDdEIsZ0JBQWdCLEVBQUUsdUVBQXVFO1FBQ3pGLHdCQUF3QixFQUFFO1lBQ3hCLFdBQVcsRUFBRSxVQUFVO1lBQ3ZCLFNBQVMsRUFBRSxRQUFRO1lBQ25CLFlBQVksRUFBRSxXQUFXO1NBQzFCO1FBQ0QseUJBQXlCLEVBQUU7WUFDekIsV0FBVyxFQUFFLFFBQVE7WUFDckIsU0FBUyxFQUFFLGlCQUFpQjtZQUM1QixZQUFZLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7U0FDdkM7S0FDRixDQUFDLENBQUMsQ0FBQztBQUNOLENBQUM7QUFFRCxLQUFLLFVBQVUsa0JBQWtCLENBQUMsU0FBaUIsRUFBRSxLQUFhLEVBQUUsSUFBUztJQUMzRSxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSwrQkFBa0IsQ0FBQztRQUMxQyxRQUFRLEVBQUUsa0JBQWtCO1FBQzVCLFdBQVcsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO1lBQzFCLFNBQVM7WUFDVCxLQUFLO1lBQ0wsSUFBSTtZQUNKLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtTQUNwQyxDQUFDO0tBQ0gsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIEdldENvbW1hbmQsIFVwZGF0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBTM0NsaWVudCwgUHV0T2JqZWN0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XHJcbmltcG9ydCB7IFNRU0NsaWVudCwgU2VuZE1lc3NhZ2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNxcyc7XHJcbmltcG9ydCBmZXRjaCBmcm9tICdub2RlLWZldGNoJztcclxuXHJcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7fSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5jb25zdCBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7fSk7XHJcbmNvbnN0IHNxc0NsaWVudCA9IG5ldyBTUVNDbGllbnQoe30pO1xyXG5cclxuY29uc3QgQ09OVEVOVF9UQUJMRSA9IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEUhO1xyXG5jb25zdCBJTUFHRV9CVUNLRVQgPSBwcm9jZXNzLmVudi5JTUFHRV9CVUNLRVQhO1xyXG5jb25zdCBPUkNIRVNUUkFUT1JfUVVFVUUgPSBwcm9jZXNzLmVudi5PUkNIRVNUUkFUT1JfUVVFVUUhO1xyXG5jb25zdCBPUEVOQUlfQVBJX0tFWSA9IHByb2Nlc3MuZW52Lk9QRU5BSV9BUElfS0VZITtcclxuXHJcbmludGVyZmFjZSBJbWFnZUdlbmVyYXRpb25SZXF1ZXN0IHtcclxuICBjb250ZW50SWQ6IHN0cmluZztcclxuICBwcm9tcHQ6IHN0cmluZztcclxuICBzdHlsZT86IHN0cmluZztcclxuICBzaXplPzogJzEwMjR4MTAyNCcgfCAnMTc5MngxMDI0JyB8ICcxMDI0eDE3OTInO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgSW1hZ2VHZW5lcmF0aW9uUmVzcG9uc2Uge1xyXG4gIHN1Y2Nlc3M6IGJvb2xlYW47XHJcbiAgaW1hZ2VVcmw/OiBzdHJpbmc7XHJcbiAgZXJyb3I/OiBzdHJpbmc7XHJcbn1cclxuXHJcbi8vIENPUlMgaGVscGVyIGZ1bmN0aW9uXHJcbmZ1bmN0aW9uIGdldENvcnNIZWFkZXJzKG9yaWdpbjogc3RyaW5nIHwgdW5kZWZpbmVkKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XHJcbiAgY29uc3QgYWxsb3dlZE9yaWdpbnMgPSBbXHJcbiAgICAnaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nLFxyXG4gICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMCcsXHJcbiAgICAnaHR0cDovL2xvY2FsaG9zdDo1MTczJyxcclxuICBdO1xyXG4gIFxyXG4gIGNvbnN0IGFsbG93ZWRPcmlnaW4gPSBvcmlnaW4gJiYgYWxsb3dlZE9yaWdpbnMuaW5jbHVkZXMob3JpZ2luKSA/IG9yaWdpbiA6IGFsbG93ZWRPcmlnaW5zWzBdO1xyXG4gIFxyXG4gIHJldHVybiB7XHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogYWxsb3dlZE9yaWdpbixcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxBdXRob3JpemF0aW9uLFgtQW16LURhdGUsWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtUmVxdWVzdGVkLVdpdGgnLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULFBPU1QsUFVULERFTEVURSxPUFRJT05TJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6ICdmYWxzZScsXHJcbiAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XHJcbiAgY29uc3QgY29yc0hlYWRlcnMgPSBnZXRDb3JzSGVhZGVycyhldmVudC5oZWFkZXJzLm9yaWdpbik7XHJcblxyXG4gIC8vIEhhbmRsZSBwcmVmbGlnaHQgcmVxdWVzdHNcclxuICBpZiAoZXZlbnQuaHR0cE1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiAnJyxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICB0cnkge1xyXG4gICAgaWYgKCFldmVudC5ib2R5KSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlcXVlc3Q6IEltYWdlR2VuZXJhdGlvblJlcXVlc3QgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkpO1xyXG4gICAgXHJcbiAgICBpZiAoIXJlcXVlc3QuY29udGVudElkIHx8ICFyZXF1ZXN0LnByb21wdCkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnY29udGVudElkIGFuZCBwcm9tcHQgYXJlIHJlcXVpcmVkJyB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBVcGRhdGUgY29udGVudCBzdGF0dXMgdG8gaW5kaWNhdGUgaW1hZ2UgZ2VuZXJhdGlvbiBpbiBwcm9ncmVzc1xyXG4gICAgYXdhaXQgdXBkYXRlQ29udGVudFN0YXR1cyhyZXF1ZXN0LmNvbnRlbnRJZCwgJ2dlbmVyYXRpbmdfaW1hZ2UnKTtcclxuXHJcbiAgICAvLyBHZW5lcmF0ZSBpbWFnZSB1c2luZyBPcGVuQUkgREFMTC1FXHJcbiAgICBjb25zdCBpbWFnZVJlc3VsdCA9IGF3YWl0IGdlbmVyYXRlSW1hZ2UocmVxdWVzdCk7XHJcbiAgICBcclxuICAgIGlmICghaW1hZ2VSZXN1bHQuc3VjY2Vzcykge1xyXG4gICAgICBhd2FpdCB1cGRhdGVDb250ZW50U3RhdHVzKHJlcXVlc3QuY29udGVudElkLCAnaW1hZ2VfZ2VuZXJhdGlvbl9mYWlsZWQnLCBpbWFnZVJlc3VsdC5lcnJvcik7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IGltYWdlUmVzdWx0LmVycm9yIH0pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFN0b3JlIGltYWdlIFVSTCBpbiBjb250ZW50IHJlY29yZFxyXG4gICAgYXdhaXQgdXBkYXRlQ29udGVudFdpdGhJbWFnZShyZXF1ZXN0LmNvbnRlbnRJZCwgaW1hZ2VSZXN1bHQuaW1hZ2VVcmwhKTtcclxuICAgIFxyXG4gICAgLy8gTm90aWZ5IG9yY2hlc3RyYXRvciB0aGF0IGltYWdlIGdlbmVyYXRpb24gaXMgY29tcGxldGVcclxuICAgIGF3YWl0IG5vdGlmeU9yY2hlc3RyYXRvcihyZXF1ZXN0LmNvbnRlbnRJZCwgJ2ltYWdlX2dlbmVyYXRlZCcsIHtcclxuICAgICAgaW1hZ2VVcmw6IGltYWdlUmVzdWx0LmltYWdlVXJsLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgaW1hZ2VVcmw6IGltYWdlUmVzdWx0LmltYWdlVXJsLFxyXG4gICAgICB9KSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdJbWFnZSBnZW5lcmF0aW9uIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgXHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBzZXJ2ZXIgZXJyb3IgZHVyaW5nIGltYWdlIGdlbmVyYXRpb24nLFxyXG4gICAgICAgIGRldGFpbHM6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn07XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUltYWdlKHJlcXVlc3Q6IEltYWdlR2VuZXJhdGlvblJlcXVlc3QpOiBQcm9taXNlPEltYWdlR2VuZXJhdGlvblJlc3BvbnNlPiB7XHJcbiAgdHJ5IHtcclxuICAgIGlmICghT1BFTkFJX0FQSV9LRVkpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogJ09wZW5BSSBBUEkga2V5IG5vdCBjb25maWd1cmVkJ1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goJ2h0dHBzOi8vYXBpLm9wZW5haS5jb20vdjEvaW1hZ2VzL2dlbmVyYXRpb25zJywge1xyXG4gICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdBdXRob3JpemF0aW9uJzogYEJlYXJlciAke09QRU5BSV9BUElfS0VZfWAsXHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIG1vZGVsOiAnZGFsbC1lLTMnLFxyXG4gICAgICAgIHByb21wdDogcmVxdWVzdC5wcm9tcHQsXHJcbiAgICAgICAgbjogMSxcclxuICAgICAgICBzaXplOiByZXF1ZXN0LnNpemUgfHwgJzEwMjR4MTAyNCcsXHJcbiAgICAgICAgcXVhbGl0eTogJ3N0YW5kYXJkJyxcclxuICAgICAgICByZXNwb25zZV9mb3JtYXQ6ICd1cmwnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcclxuICAgICAgY29uc3QgZXJyb3JEYXRhID0gYXdhaXQgcmVzcG9uc2UuanNvbigpIGFzIGFueTtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYE9wZW5BSSBBUEkgZXJyb3I6ICR7ZXJyb3JEYXRhLmVycm9yPy5tZXNzYWdlIHx8ICdVbmtub3duIGVycm9yJ31gXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyBhbnk7XHJcbiAgICBjb25zdCBpbWFnZVVybCA9IGRhdGEuZGF0YVswXT8udXJsO1xyXG5cclxuICAgIGlmICghaW1hZ2VVcmwpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogJ05vIGltYWdlIFVSTCByZXR1cm5lZCBmcm9tIE9wZW5BSSdcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBEb3dubG9hZCBhbmQgc3RvcmUgdGhlIGltYWdlIGluIFMzXHJcbiAgICBjb25zdCBzdG9yZWRJbWFnZVVybCA9IGF3YWl0IHN0b3JlSW1hZ2VJblMzKGltYWdlVXJsLCByZXF1ZXN0LmNvbnRlbnRJZCk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgaW1hZ2VVcmw6IHN0b3JlZEltYWdlVXJsXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2VuZXJhdGluZyBpbWFnZTonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3IgZHVyaW5nIGltYWdlIGdlbmVyYXRpb24nXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gc3RvcmVJbWFnZUluUzMoaW1hZ2VVcmw6IHN0cmluZywgY29udGVudElkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gIHRyeSB7XHJcbiAgICAvLyBEb3dubG9hZCB0aGUgaW1hZ2VcclxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goaW1hZ2VVcmwpO1xyXG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBkb3dubG9hZCBpbWFnZTogJHtyZXNwb25zZS5zdGF0dXNUZXh0fWApO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGltYWdlQnVmZmVyID0gYXdhaXQgcmVzcG9uc2UuYXJyYXlCdWZmZXIoKTtcclxuICAgIGNvbnN0IGtleSA9IGBpbWFnZXMvJHtjb250ZW50SWR9LyR7RGF0ZS5ub3coKX0ucG5nYDtcclxuXHJcbiAgICAvLyBVcGxvYWQgdG8gUzNcclxuICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xyXG4gICAgICBCdWNrZXQ6IElNQUdFX0JVQ0tFVCxcclxuICAgICAgS2V5OiBrZXksXHJcbiAgICAgIEJvZHk6IG5ldyBVaW50OEFycmF5KGltYWdlQnVmZmVyKSxcclxuICAgICAgQ29udGVudFR5cGU6ICdpbWFnZS9wbmcnLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFJldHVybiB0aGUgUzMgVVJMXHJcbiAgICByZXR1cm4gYGh0dHBzOi8vJHtJTUFHRV9CVUNLRVR9LnMzLmFtYXpvbmF3cy5jb20vJHtrZXl9YDtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHN0b3JpbmcgaW1hZ2UgaW4gUzM6JywgZXJyb3IpO1xyXG4gICAgdGhyb3cgZXJyb3I7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVDb250ZW50U3RhdHVzKGNvbnRlbnRJZDogc3RyaW5nLCBzdGF0dXM6IHN0cmluZywgZXJyb3I/OiBzdHJpbmcpIHtcclxuICBjb25zdCB1cGRhdGVFeHByZXNzaW9uID0gZXJyb3IgXHJcbiAgICA/ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsICNlcnJvciA9IDplcnJvciwgI3VwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnXHJcbiAgICA6ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsICN1cGRhdGVkQXQgPSA6dXBkYXRlZEF0JztcclxuICAgIFxyXG4gIGNvbnN0IGV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXMgPSBlcnJvclxyXG4gICAgPyB7ICc6c3RhdHVzJzogc3RhdHVzLCAnOmVycm9yJzogZXJyb3IsICc6dXBkYXRlZEF0JzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH1cclxuICAgIDogeyAnOnN0YXR1cyc6IHN0YXR1cywgJzp1cGRhdGVkQXQnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfTtcclxuXHJcbiAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBDT05URU5UX1RBQkxFLFxyXG4gICAgS2V5OiB7IGlkOiBjb250ZW50SWQgfSxcclxuICAgIFVwZGF0ZUV4cHJlc3Npb246IHVwZGF0ZUV4cHJlc3Npb24sXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcclxuICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJyxcclxuICAgICAgJyN1cGRhdGVkQXQnOiAndXBkYXRlZEF0JyxcclxuICAgICAgLi4uKGVycm9yICYmIHsgJyNlcnJvcic6ICdlcnJvcicgfSlcclxuICAgIH0sXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiBleHByZXNzaW9uQXR0cmlidXRlVmFsdWVzLFxyXG4gIH0pKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gdXBkYXRlQ29udGVudFdpdGhJbWFnZShjb250ZW50SWQ6IHN0cmluZywgaW1hZ2VVcmw6IHN0cmluZykge1xyXG4gIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBVcGRhdGVDb21tYW5kKHtcclxuICAgIFRhYmxlTmFtZTogQ09OVEVOVF9UQUJMRSxcclxuICAgIEtleTogeyBpZDogY29udGVudElkIH0sXHJcbiAgICBVcGRhdGVFeHByZXNzaW9uOiAnU0VUICNpbWFnZVVybCA9IDppbWFnZVVybCwgI3N0YXR1cyA9IDpzdGF0dXMsICN1cGRhdGVkQXQgPSA6dXBkYXRlZEF0JyxcclxuICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczoge1xyXG4gICAgICAnI2ltYWdlVXJsJzogJ2ltYWdlVXJsJyxcclxuICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJyxcclxuICAgICAgJyN1cGRhdGVkQXQnOiAndXBkYXRlZEF0JyxcclxuICAgIH0sXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICc6aW1hZ2VVcmwnOiBpbWFnZVVybCxcclxuICAgICAgJzpzdGF0dXMnOiAnaW1hZ2VfZ2VuZXJhdGVkJyxcclxuICAgICAgJzp1cGRhdGVkQXQnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICB9LFxyXG4gIH0pKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gbm90aWZ5T3JjaGVzdHJhdG9yKGNvbnRlbnRJZDogc3RyaW5nLCBldmVudDogc3RyaW5nLCBkYXRhOiBhbnkpIHtcclxuICBhd2FpdCBzcXNDbGllbnQuc2VuZChuZXcgU2VuZE1lc3NhZ2VDb21tYW5kKHtcclxuICAgIFF1ZXVlVXJsOiBPUkNIRVNUUkFUT1JfUVVFVUUsXHJcbiAgICBNZXNzYWdlQm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICBjb250ZW50SWQsXHJcbiAgICAgIGV2ZW50LFxyXG4gICAgICBkYXRhLFxyXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIH0pLFxyXG4gIH0pKTtcclxufSJdfQ==