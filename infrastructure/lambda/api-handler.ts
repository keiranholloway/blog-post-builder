import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';

interface ErrorResponse {
  error: string;
  message: string;
  requestId?: string;
}

interface SuccessResponse {
  message: string;
  data?: any;
  version: string;
}

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));

  // Allowed origins for CORS
  const allowedOrigins = [
    'https://keiranholloway.github.io',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  
  const requestOrigin = event.headers.origin || event.headers.Origin;
  const allowedOrigin = allowedOrigins.includes(requestOrigin || '') ? requestOrigin! : allowedOrigins[0];

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
      const response: SuccessResponse = {
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
      const response: SuccessResponse = {
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
      return await handleContentStatus(contentId!, context, corsHeaders);
    }

    if (method === 'GET' && path.startsWith('/api/content/') && path.endsWith('/messages')) {
      const pathParts = path.split('/');
      const contentId = pathParts[pathParts.length - 2];
      return await handleContentMessages(contentId, context, corsHeaders);
    }

    if (method === 'GET' && path.startsWith('/api/content/') && !path.includes('/')) {
      const contentId = path.split('/').pop();
      return await handleGetContent(contentId!, context, corsHeaders);
    }

    if (method === 'POST' && path === '/api/content/validate') {
      return await handleContentValidation(event, context, corsHeaders);
    }

    // Default 404 for unmatched routes
    const errorResponse: ErrorResponse = {
      error: 'Not Found',
      message: `Route ${method} ${path} not found`,
      requestId: context.awsRequestId,
    };

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify(errorResponse),
    };

  } catch (error) {
    console.error('Unhandled error:', error);

    const errorResponse: ErrorResponse = {
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

/**
 * Handle content generation request
 */
async function handleContentGeneration(
  event: APIGatewayProxyEvent,
  context: Context,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
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
    const contentId = uuidv4();
    const timestamp = new Date().toISOString();

    await dynamoClient.send(new PutItemCommand({
      TableName: process.env.CONTENT_TABLE_NAME!,
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
    await eventBridgeClient.send(new PutEventsCommand({
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
        EventBusName: process.env.EVENT_BUS_NAME!,
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

  } catch (error) {
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
async function handleContentRevision(
  event: APIGatewayProxyEvent,
  context: Context,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
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
    const revisionId = uuidv4();
    const timestamp = new Date().toISOString();

    // Trigger content revision workflow
    await eventBridgeClient.send(new PutEventsCommand({
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
        EventBusName: process.env.EVENT_BUS_NAME!,
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

  } catch (error) {
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
async function handleContentStatus(
  contentId: string,
  context: Context,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: process.env.CONTENT_TABLE_NAME!,
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
      status: result.Item.status.S!,
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

  } catch (error) {
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
async function handleGetContent(
  contentId: string,
  context: Context,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: process.env.CONTENT_TABLE_NAME!,
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
      id: result.Item.id.S!,
      userId: result.Item.userId.S!,
      title: result.Item.title?.S,
      originalTranscription: result.Item.originalTranscription.S!,
      currentDraft: result.Item.currentDraft?.S || '',
      associatedImage: result.Item.associatedImage?.S,
      imageUrl: result.Item.imageUrl?.S,
      status: result.Item.status.S!,
      revisionHistory: result.Item.revisionHistory?.S ? JSON.parse(result.Item.revisionHistory.S) : [],
      publishingResults: result.Item.publishingResults?.S ? JSON.parse(result.Item.publishingResults.S) : [],
      createdAt: result.Item.createdAt.S!,
      updatedAt: result.Item.updatedAt.S!,
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

  } catch (error) {
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
async function handleContentMessages(
  contentId: string,
  context: Context,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: process.env.AGENT_MESSAGES_TABLE_NAME!,
      IndexName: 'ContentIdIndex',
      KeyConditionExpression: 'contentId = :contentId',
      ExpressionAttributeValues: {
        ':contentId': { S: contentId },
      },
      ScanIndexForward: false, // Most recent first
    }));

    const messages = result.Items?.map(item => ({
      id: item.id.S!,
      contentId: item.contentId.S!,
      agentType: item.agentType.S!,
      messageType: item.messageType.S!,
      payload: item.payload.S ? JSON.parse(item.payload.S) : {},
      status: item.status?.S || 'pending',
      error: item.error?.S,
      result: item.result?.S ? JSON.parse(item.result.S) : undefined,
      createdAt: item.timestamp.S!,
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

  } catch (error) {
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
async function handleContentValidation(
  event: APIGatewayProxyEvent,
  context: Context,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
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
    const issues: string[] = [];
    const suggestions: string[] = [];
    
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

  } catch (error) {
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