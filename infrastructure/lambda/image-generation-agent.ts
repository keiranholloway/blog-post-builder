import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import fetch from 'node-fetch';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});

const CONTENT_TABLE = process.env.CONTENT_TABLE!;
const IMAGE_BUCKET = process.env.IMAGE_BUCKET!;
const ORCHESTRATOR_QUEUE = process.env.ORCHESTRATOR_QUEUE!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

interface ImageGenerationRequest {
  contentId: string;
  prompt: string;
  style?: string;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
}

interface ImageGenerationResponse {
  success: boolean;
  imageUrl?: string;
  error?: string;
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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
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

    const request: ImageGenerationRequest = JSON.parse(event.body);
    
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
    await updateContentWithImage(request.contentId, imageResult.imageUrl!);
    
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

  } catch (error) {
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

async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
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
        quality: 'standard',
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

    // Download and store the image in S3
    const storedImageUrl = await storeImageInS3(imageUrl, request.contentId);

    return {
      success: true,
      imageUrl: storedImageUrl
    };

  } catch (error) {
    console.error('Error generating image:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during image generation'
    };
  }
}

async function storeImageInS3(imageUrl: string, contentId: string): Promise<string> {
  try {
    // Download the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const imageBuffer = await response.arrayBuffer();
    const key = `images/${contentId}/${Date.now()}.png`;

    // Upload to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: IMAGE_BUCKET,
      Key: key,
      Body: new Uint8Array(imageBuffer),
      ContentType: 'image/png',
    }));

    // Return the S3 URL
    return `https://${IMAGE_BUCKET}.s3.amazonaws.com/${key}`;

  } catch (error) {
    console.error('Error storing image in S3:', error);
    throw error;
  }
}

async function updateContentStatus(contentId: string, status: string, error?: string) {
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

async function updateContentWithImage(contentId: string, imageUrl: string) {
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

async function notifyOrchestrator(contentId: string, event: string, data: any) {
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: ORCHESTRATOR_QUEUE,
    MessageBody: JSON.stringify({
      contentId,
      event,
      data,
      timestamp: new Date().toISOString(),
    }),
  }));
}