import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { publishingRegistry } from './publishing/publishing-agent-registry';
import { BlogContent } from '../../frontend/src/types/BlogContent';
import { PublishingConfig, PublishResult } from './publishing/base-publishing-agent';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({});

interface PublishRequest {
  contentId: string;
  platforms: string[];
  configs: Record<string, PublishingConfig>;
  imageUrl?: string;
  retryFailedOnly?: boolean;
}

interface PublishStatusRequest {
  contentId: string;
  platform: string;
  platformId: string;
  config: PublishingConfig;
}

interface PublishingJob {
  id: string;
  contentId: string;
  platform: string;
  config: PublishingConfig;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'retrying';
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  result?: PublishResult;
  createdAt: string;
  updatedAt: string;
  nextRetryAt?: string;
}

interface PublishingOrchestrationResult {
  jobId: string;
  contentId: string;
  totalPlatforms: number;
  successfulPlatforms: number;
  failedPlatforms: number;
  status: 'completed' | 'partial' | 'failed' | 'in_progress';
  results: Record<string, PublishResult>;
  jobs: Record<string, PublishingJob>;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };

  try {
    const path = event.path;
    const method = event.httpMethod;

    if (method === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    switch (path) {
      case '/publishing/platforms':
        return await handleGetPlatforms();
      
      case '/publishing/validate-credentials':
        return await handleValidateCredentials(event);
      
      case '/publishing/publish':
        return await handlePublish(event);
      
      case '/publishing/status':
        return await handleGetStatus(event);
      
      case '/publishing/format-preview':
        return await handleFormatPreview(event);
      
      case '/publishing/orchestrate':
        return await handleOrchestrate(event);
      
      case '/publishing/retry':
        return await handleRetryFailed(event);
      
      case '/publishing/job-status':
        return await handleGetJobStatus(event);
      
      case '/publishing/cancel':
        return await handleCancelJob(event);
      
      default:
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Endpoint not found' })
        };
    }
  } catch (error) {
    console.error('Publishing orchestrator error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

async function handleGetPlatforms(): Promise<APIGatewayProxyResult> {
  const platforms = publishingRegistry.getSupportedPlatforms().map(platform => ({
    name: platform,
    features: publishingRegistry.getPlatformFeatures(platform)
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({ platforms })
  };
}

async function handleValidateCredentials(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { platform, credentials } = body;

  if (!platform || !credentials) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Platform and credentials are required' })
    };
  }

  try {
    const isValid = await publishingRegistry.validateCredentials(platform, credentials);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ valid: isValid })
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        valid: false, 
        error: error instanceof Error ? error.message : 'Validation failed' 
      })
    };
  }
}

async function handlePublish(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}') as PublishRequest;
  const { contentId, platforms, configs, imageUrl, retryFailedOnly } = body;

  if (!contentId || !platforms || !configs) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'ContentId, platforms, and configs are required' })
    };
  }

  try {
    // Get content from DynamoDB
    const contentResult = await docClient.send(new GetCommand({
      TableName: process.env.CONTENT_TABLE_NAME!,
      Key: { id: contentId }
    }));

    if (!contentResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Content not found' })
      };
    }

    const content = contentResult.Item as BlogContent;
    
    // Filter platforms if retrying failed only
    let targetPlatforms = platforms;
    if (retryFailedOnly && content.publishingResults) {
      const failedPlatforms = content.publishingResults
        .filter((result: any) => !result.success)
        .map((result: any) => result.platform);
      targetPlatforms = platforms.filter(p => failedPlatforms.includes(p));
    }

    if (targetPlatforms.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ 
          success: true,
          message: 'No platforms to retry',
          results: {}
        })
      };
    }

    const configMap = new Map(Object.entries(configs));
    
    // Publish to multiple platforms with enhanced error handling
    const results = await publishWithRetry(
      targetPlatforms,
      content,
      configMap,
      imageUrl
    );

    // Update content with publishing results
    const existingResults = content.publishingResults || [];
    const updatedResults = [...existingResults];

    // Update or add results for each platform
    Array.from(results.entries()).forEach(([platform, result]) => {
      const existingIndex = updatedResults.findIndex((r: any) => r.platform === platform);
      const newResult = {
        platform,
        ...result,
        publishedAt: new Date().toISOString()
      };

      if (existingIndex >= 0) {
        updatedResults[existingIndex] = newResult;
      } else {
        updatedResults.push(newResult);
      }
    });

    await docClient.send(new UpdateCommand({
      TableName: process.env.CONTENT_TABLE_NAME!,
      Key: { id: contentId },
      UpdateExpression: 'SET publishingResults = :results, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':results': updatedResults,
        ':updatedAt': new Date().toISOString()
      }
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: true,
        results: Object.fromEntries(results)
      })
    };
  } catch (error) {
    console.error('Publishing error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Publishing failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

async function handleGetStatus(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}') as PublishStatusRequest;
  const { contentId, platform, platformId, config } = body;

  if (!contentId || !platform || !platformId || !config) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'All parameters are required' })
    };
  }

  try {
    const status = await publishingRegistry.getPublishingStatus(platform, platformId, config);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ status })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to get status',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

async function handleFormatPreview(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { contentId, platform, imageUrl } = body;

  if (!contentId || !platform) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'ContentId and platform are required' })
    };
  }

  try {
    // Get content from DynamoDB
    const contentResult = await docClient.send(new GetCommand({
      TableName: process.env.CONTENT_TABLE_NAME!,
      Key: { id: contentId }
    }));

    if (!contentResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Content not found' })
      };
    }

    const content = contentResult.Item as BlogContent;
    const formattedContent = await publishingRegistry.formatContent(platform, content, imageUrl);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ formattedContent })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Format preview failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

async function handleOrchestrate(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}') as PublishRequest;
  const { contentId, platforms, configs, imageUrl } = body;

  if (!contentId || !platforms || !configs) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'ContentId, platforms, and configs are required' })
    };
  }

  try {
    const jobId = `job_${contentId}_${Date.now()}`;
    const orchestrationResult = await orchestratePublishing(jobId, contentId, platforms, configs, imageUrl);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(orchestrationResult)
    };
  } catch (error) {
    console.error('Orchestration error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Orchestration failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

async function handleRetryFailed(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { jobId } = body;

  if (!jobId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'JobId is required' })
    };
  }

  try {
    const result = await retryFailedJobs(jobId);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Retry error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Retry failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

async function handleGetJobStatus(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const jobId = event.queryStringParameters?.jobId;

  if (!jobId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'JobId is required' })
    };
  }

  try {
    const status = await getJobStatus(jobId);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(status)
    };
  } catch (error) {
    console.error('Get job status error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to get job status',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

async function handleCancelJob(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { jobId } = body;

  if (!jobId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'JobId is required' })
    };
  }

  try {
    await cancelJob(jobId);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: true, message: 'Job cancelled' })
    };
  } catch (error) {
    console.error('Cancel job error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: 'Failed to cancel job',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

// Helper functions for orchestration

async function publishWithRetry(
  platforms: string[],
  content: BlogContent,
  configs: Map<string, PublishingConfig>,
  imageUrl?: string,
  maxAttempts: number = 3
): Promise<Map<string, PublishResult>> {
  const results = new Map<string, PublishResult>();
  
  for (const platform of platforms) {
    const config = configs.get(platform);
    if (!config) {
      results.set(platform, {
        success: false,
        error: `No configuration found for platform: ${platform}`
      });
      continue;
    }

    let lastError: string | undefined;
    let success = false;

    for (let attempt = 1; attempt <= maxAttempts && !success; attempt++) {
      try {
        console.log(`Publishing to ${platform}, attempt ${attempt}/${maxAttempts}`);
        const result = await publishingRegistry.publish(platform, content, config, imageUrl);
        
        if (result.success) {
          results.set(platform, result);
          success = true;
        } else {
          lastError = result.error;
          if (attempt < maxAttempts) {
            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, attempt - 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!success) {
      results.set(platform, {
        success: false,
        error: lastError || 'Failed after maximum retry attempts'
      });
    }
  }

  return results;
}

async function orchestratePublishing(
  jobId: string,
  contentId: string,
  platforms: string[],
  configs: Record<string, PublishingConfig>,
  imageUrl?: string
): Promise<PublishingOrchestrationResult> {
  const jobs: Record<string, PublishingJob> = {};
  const results: Record<string, PublishResult> = {};
  
  // Create individual jobs for each platform
  for (const platform of platforms) {
    const config = configs[platform];
    if (!config) {
      results[platform] = {
        success: false,
        error: `No configuration found for platform: ${platform}`
      };
      continue;
    }

    const platformJobId = `${jobId}_${platform}`;
    const job: PublishingJob = {
      id: platformJobId,
      contentId,
      platform,
      config,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    jobs[platform] = job;

    // Store job in DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.PUBLISHING_JOBS_TABLE_NAME!,
      Item: job
    }));

    // Queue job for processing
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.PUBLISHING_QUEUE_URL!,
      MessageBody: JSON.stringify({
        jobId: platformJobId,
        contentId,
        platform,
        config,
        imageUrl
      }),
      DelaySeconds: 0
    }));
  }

  const orchestrationResult: PublishingOrchestrationResult = {
    jobId,
    contentId,
    totalPlatforms: platforms.length,
    successfulPlatforms: 0,
    failedPlatforms: 0,
    status: 'in_progress',
    results,
    jobs
  };

  // Store orchestration result
  await docClient.send(new PutCommand({
    TableName: process.env.PUBLISHING_ORCHESTRATION_TABLE_NAME!,
    Item: {
      jobId,
      ...orchestrationResult,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }));

  return orchestrationResult;
}

async function retryFailedJobs(jobId: string): Promise<PublishingOrchestrationResult> {
  // Get orchestration result
  const orchestrationResult = await docClient.send(new GetCommand({
    TableName: process.env.PUBLISHING_ORCHESTRATION_TABLE_NAME!,
    Key: { jobId }
  }));

  if (!orchestrationResult.Item) {
    throw new Error('Job not found');
  }

  const result = orchestrationResult.Item as PublishingOrchestrationResult;
  
  // Find failed jobs
  const failedJobs = Object.values(result.jobs).filter(job => 
    job.status === 'failed' && job.attempts < job.maxAttempts
  );

  // Retry failed jobs
  for (const job of failedJobs) {
    job.status = 'pending';
    job.attempts += 1;
    job.updatedAt = new Date().toISOString();
    job.nextRetryAt = new Date(Date.now() + Math.pow(2, job.attempts) * 1000).toISOString();

    // Update job in DynamoDB
    await docClient.send(new UpdateCommand({
      TableName: process.env.PUBLISHING_JOBS_TABLE_NAME!,
      Key: { id: job.id },
      UpdateExpression: 'SET #status = :status, attempts = :attempts, updatedAt = :updatedAt, nextRetryAt = :nextRetryAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': job.status,
        ':attempts': job.attempts,
        ':updatedAt': job.updatedAt,
        ':nextRetryAt': job.nextRetryAt
      }
    }));

    // Re-queue job
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.PUBLISHING_QUEUE_URL!,
      MessageBody: JSON.stringify({
        jobId: job.id,
        contentId: job.contentId,
        platform: job.platform,
        config: job.config
      }),
      DelaySeconds: Math.pow(2, job.attempts) // Exponential backoff
    }));
  }

  return result;
}

async function getJobStatus(jobId: string): Promise<PublishingOrchestrationResult | null> {
  const result = await docClient.send(new GetCommand({
    TableName: process.env.PUBLISHING_ORCHESTRATION_TABLE_NAME!,
    Key: { jobId }
  }));

  return result.Item as PublishingOrchestrationResult || null;
}

async function cancelJob(jobId: string): Promise<void> {
  // Update orchestration status
  await docClient.send(new UpdateCommand({
    TableName: process.env.PUBLISHING_ORCHESTRATION_TABLE_NAME!,
    Key: { jobId },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': 'cancelled',
      ':updatedAt': new Date().toISOString()
    }
  }));

  // Cancel individual jobs
  const jobs = await docClient.send(new QueryCommand({
    TableName: process.env.PUBLISHING_JOBS_TABLE_NAME!,
    IndexName: 'JobIdIndex',
    KeyConditionExpression: 'jobId = :jobId',
    ExpressionAttributeValues: {
      ':jobId': jobId
    }
  }));

  if (jobs.Items) {
    for (const job of jobs.Items) {
      if (job.status === 'pending' || job.status === 'in_progress') {
        await docClient.send(new UpdateCommand({
          TableName: process.env.PUBLISHING_JOBS_TABLE_NAME!,
          Key: { id: job.id },
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':status': 'cancelled',
            ':updatedAt': new Date().toISOString()
          }
        }));
      }
    }
  }
}