import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

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

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));

  const corsHeaders = {
    'Access-Control-Allow-Origin': event.headers.origin || '*',
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