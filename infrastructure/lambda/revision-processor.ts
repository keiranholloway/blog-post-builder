import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({});

const CONTENT_TABLE = process.env.CONTENT_TABLE!;
const AGENT_MESSAGES_TABLE = process.env.AGENT_MESSAGES_TABLE!;
const CONTENT_GENERATION_QUEUE = process.env.CONTENT_GENERATION_QUEUE!;
const IMAGE_GENERATION_QUEUE = process.env.IMAGE_GENERATION_QUEUE!;

interface RevisionRequest {
  contentId: string;
  feedback: string;
  revisionType: 'content' | 'image';
  userId?: string;
  priority?: 'low' | 'medium' | 'high';
  specificChanges?: string[];
}

interface RevisionHistory {
  id: string;
  timestamp: string;
  feedback: string;
  revisionType: 'content' | 'image';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  userId?: string;
  result?: any;
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
      return await handleGetRevisionHistory(contentId!, corsHeaders);
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

  } catch (error) {
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

async function handleContentRevision(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const request: RevisionRequest = JSON.parse(event.body);
    
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
    const revisionId = uuidv4();
    const revision: RevisionHistory = {
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

  } catch (error) {
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

async function handleImageRevision(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const request: RevisionRequest = JSON.parse(event.body);
    
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
    const revisionId = uuidv4();
    const revision: RevisionHistory = {
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
    const imagePrompt = await generateImagePromptFromFeedback(
      content.currentDraft,
      content.title,
      request.feedback,
      content.imageUrl
    );

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

  } catch (error) {
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

async function handleGetRevisionHistory(
  contentId: string,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
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

  } catch (error) {
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

async function handleBatchRevision(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
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

  } catch (error) {
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

async function getContent(contentId: string) {
  const result = await docClient.send(new GetCommand({
    TableName: CONTENT_TABLE,
    Key: { id: contentId },
  }));
  return result.Item;
}

async function addRevisionToContent(contentId: string, revision: RevisionHistory) {
  // Get current content to append to revision history
  const content = await getContent(contentId);
  const currentHistory = content?.revisionHistory || [];
  const updatedHistory = [...currentHistory, revision];

  await docClient.send(new UpdateCommand({
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

async function updateContentStatus(contentId: string, status: string) {
  await docClient.send(new UpdateCommand({
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

async function updateRevisionStatus(contentId: string, revisionId: string, status: string, result?: any, error?: string) {
  const content = await getContent(contentId);
  if (!content?.revisionHistory) return;

  const updatedHistory = content.revisionHistory.map((revision: RevisionHistory) => {
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

  await docClient.send(new UpdateCommand({
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

async function analyzeFeedback(feedback: string, type: 'content' | 'image') {
  // Simple feedback analysis - in production, this could use AI for better analysis
  const feedbackLower = feedback.toLowerCase();
  
  let category = 'general';
  let estimatedTime = 60; // seconds
  let approach = 'revision';

  if (type === 'content') {
    if (feedbackLower.includes('tone') || feedbackLower.includes('style')) {
      category = 'tone';
      estimatedTime = 45;
    } else if (feedbackLower.includes('structure') || feedbackLower.includes('organize')) {
      category = 'structure';
      estimatedTime = 90;
    } else if (feedbackLower.includes('length') || feedbackLower.includes('shorter') || feedbackLower.includes('longer')) {
      category = 'length';
      estimatedTime = 30;
    } else if (feedbackLower.includes('information') || feedbackLower.includes('add') || feedbackLower.includes('remove')) {
      category = 'information';
      estimatedTime = 120;
    }
  } else {
    if (feedbackLower.includes('color') || feedbackLower.includes('bright') || feedbackLower.includes('dark')) {
      category = 'colors';
      estimatedTime = 45;
    } else if (feedbackLower.includes('style') || feedbackLower.includes('artistic')) {
      category = 'style';
      estimatedTime = 60;
    } else if (feedbackLower.includes('composition') || feedbackLower.includes('layout')) {
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

async function generateImagePromptFromFeedback(
  content: string,
  title: string,
  feedback: string,
  currentImageUrl?: string
): Promise<string> {
  // Extract key concepts from content
  const words = content.toLowerCase().split(/\s+/);
  const keyWords = words.filter(word => 
    word.length > 4 && 
    !['that', 'this', 'with', 'from', 'they', 'have', 'will', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other'].includes(word)
  );
  
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

async function sendRevisionToQueue(queueUrl: string, message: any) {
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({
      ...message,
      timestamp: new Date().toISOString(),
      type: 'revision_request',
    }),
  }));
}

async function processRevision(request: RevisionRequest) {
  // This is a helper function for batch processing
  const revisionId = uuidv4();
  
  try {
    const content = await getContent(request.contentId);
    if (!content) {
      throw new Error('Content not found');
    }

    const revision: RevisionHistory = {
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
    } else {
      const imagePrompt = await generateImagePromptFromFeedback(
        content.currentDraft,
        content.title,
        request.feedback,
        content.imageUrl
      );
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

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}