"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const publishing_agent_registry_1 = require("./publishing/publishing-agent-registry");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new client_sqs_1.SQSClient({});
const handler = async (event) => {
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
    }
    catch (error) {
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
exports.handler = handler;
async function handleGetPlatforms() {
    const platforms = publishing_agent_registry_1.publishingRegistry.getSupportedPlatforms().map(platform => ({
        name: platform,
        features: publishing_agent_registry_1.publishingRegistry.getPlatformFeatures(platform)
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
async function handleValidateCredentials(event) {
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
        const isValid = await publishing_agent_registry_1.publishingRegistry.validateCredentials(platform, credentials);
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ valid: isValid })
        };
    }
    catch (error) {
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
async function handlePublish(event) {
    const body = JSON.parse(event.body || '{}');
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
        const contentResult = await docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: process.env.CONTENT_TABLE_NAME,
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
        const content = contentResult.Item;
        // Filter platforms if retrying failed only
        let targetPlatforms = platforms;
        if (retryFailedOnly && content.publishingResults) {
            const failedPlatforms = content.publishingResults
                .filter((result) => !result.success)
                .map((result) => result.platform);
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
        const results = await publishWithRetry(targetPlatforms, content, configMap, imageUrl);
        // Update content with publishing results
        const existingResults = content.publishingResults || [];
        const updatedResults = [...existingResults];
        // Update or add results for each platform
        Array.from(results.entries()).forEach(([platform, result]) => {
            const existingIndex = updatedResults.findIndex((r) => r.platform === platform);
            const newResult = {
                platform,
                ...result,
                publishedAt: new Date().toISOString()
            };
            if (existingIndex >= 0) {
                updatedResults[existingIndex] = newResult;
            }
            else {
                updatedResults.push(newResult);
            }
        });
        await docClient.send(new lib_dynamodb_1.UpdateCommand({
            TableName: process.env.CONTENT_TABLE_NAME,
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
    }
    catch (error) {
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
async function handleGetStatus(event) {
    const body = JSON.parse(event.body || '{}');
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
        const status = await publishing_agent_registry_1.publishingRegistry.getPublishingStatus(platform, platformId, config);
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ status })
        };
    }
    catch (error) {
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
async function handleFormatPreview(event) {
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
        const contentResult = await docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: process.env.CONTENT_TABLE_NAME,
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
        const content = contentResult.Item;
        const formattedContent = await publishing_agent_registry_1.publishingRegistry.formatContent(platform, content, imageUrl);
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ formattedContent })
        };
    }
    catch (error) {
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
async function handleOrchestrate(event) {
    const body = JSON.parse(event.body || '{}');
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
    }
    catch (error) {
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
async function handleRetryFailed(event) {
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
    }
    catch (error) {
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
async function handleGetJobStatus(event) {
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
    }
    catch (error) {
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
async function handleCancelJob(event) {
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
    }
    catch (error) {
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
async function publishWithRetry(platforms, content, configs, imageUrl, maxAttempts = 3) {
    const results = new Map();
    for (const platform of platforms) {
        const config = configs.get(platform);
        if (!config) {
            results.set(platform, {
                success: false,
                error: `No configuration found for platform: ${platform}`
            });
            continue;
        }
        let lastError;
        let success = false;
        for (let attempt = 1; attempt <= maxAttempts && !success; attempt++) {
            try {
                console.log(`Publishing to ${platform}, attempt ${attempt}/${maxAttempts}`);
                const result = await publishing_agent_registry_1.publishingRegistry.publish(platform, content, config, imageUrl);
                if (result.success) {
                    results.set(platform, result);
                    success = true;
                }
                else {
                    lastError = result.error;
                    if (attempt < maxAttempts) {
                        // Exponential backoff: 1s, 2s, 4s
                        const delay = Math.pow(2, attempt - 1) * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            catch (error) {
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
async function orchestratePublishing(jobId, contentId, platforms, configs, imageUrl) {
    const jobs = {};
    const results = {};
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
        const job = {
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
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: process.env.PUBLISHING_JOBS_TABLE_NAME,
            Item: job
        }));
        // Queue job for processing
        await sqsClient.send(new client_sqs_1.SendMessageCommand({
            QueueUrl: process.env.PUBLISHING_QUEUE_URL,
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
    const orchestrationResult = {
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
    await docClient.send(new lib_dynamodb_1.PutCommand({
        TableName: process.env.PUBLISHING_ORCHESTRATION_TABLE_NAME,
        Item: {
            jobId,
            ...orchestrationResult,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    }));
    return orchestrationResult;
}
async function retryFailedJobs(jobId) {
    // Get orchestration result
    const orchestrationResult = await docClient.send(new lib_dynamodb_1.GetCommand({
        TableName: process.env.PUBLISHING_ORCHESTRATION_TABLE_NAME,
        Key: { jobId }
    }));
    if (!orchestrationResult.Item) {
        throw new Error('Job not found');
    }
    const result = orchestrationResult.Item;
    // Find failed jobs
    const failedJobs = Object.values(result.jobs).filter(job => job.status === 'failed' && job.attempts < job.maxAttempts);
    // Retry failed jobs
    for (const job of failedJobs) {
        job.status = 'pending';
        job.attempts += 1;
        job.updatedAt = new Date().toISOString();
        job.nextRetryAt = new Date(Date.now() + Math.pow(2, job.attempts) * 1000).toISOString();
        // Update job in DynamoDB
        await docClient.send(new lib_dynamodb_1.UpdateCommand({
            TableName: process.env.PUBLISHING_JOBS_TABLE_NAME,
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
        await sqsClient.send(new client_sqs_1.SendMessageCommand({
            QueueUrl: process.env.PUBLISHING_QUEUE_URL,
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
async function getJobStatus(jobId) {
    const result = await docClient.send(new lib_dynamodb_1.GetCommand({
        TableName: process.env.PUBLISHING_ORCHESTRATION_TABLE_NAME,
        Key: { jobId }
    }));
    return result.Item || null;
}
async function cancelJob(jobId) {
    // Update orchestration status
    await docClient.send(new lib_dynamodb_1.UpdateCommand({
        TableName: process.env.PUBLISHING_ORCHESTRATION_TABLE_NAME,
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
    const jobs = await docClient.send(new lib_dynamodb_1.QueryCommand({
        TableName: process.env.PUBLISHING_JOBS_TABLE_NAME,
        IndexName: 'JobIdIndex',
        KeyConditionExpression: 'jobId = :jobId',
        ExpressionAttributeValues: {
            ':jobId': jobId
        }
    }));
    if (jobs.Items) {
        for (const job of jobs.Items) {
            if (job.status === 'pending' || job.status === 'in_progress') {
                await docClient.send(new lib_dynamodb_1.UpdateCommand({
                    TableName: process.env.PUBLISHING_JOBS_TABLE_NAME,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHVibGlzaGluZy1vcmNoZXN0cmF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwdWJsaXNoaW5nLW9yY2hlc3RyYXRvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILG9EQUFvRTtBQUNwRSxzRkFBNEU7QUFJNUUsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQzVDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztBQUM1RCxNQUFNLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxDQUFDLENBQUM7QUEyQzdCLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFBRSxLQUEyQixFQUFrQyxFQUFFO0lBQzNGLE1BQU0sT0FBTyxHQUFHO1FBQ2QsY0FBYyxFQUFFLGtCQUFrQjtRQUNsQyw2QkFBNkIsRUFBRSxHQUFHO1FBQ2xDLDhCQUE4QixFQUFFLDRCQUE0QjtRQUM1RCw4QkFBOEIsRUFBRSw2QkFBNkI7S0FDOUQsQ0FBQztJQUVGLElBQUk7UUFDRixNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDO1FBQ3hCLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUM7UUFFaEMsSUFBSSxNQUFNLEtBQUssU0FBUyxFQUFFO1lBQ3hCLE9BQU8sRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsRUFBRSxFQUFFLENBQUM7U0FDL0M7UUFFRCxRQUFRLElBQUksRUFBRTtZQUNaLEtBQUssdUJBQXVCO2dCQUMxQixPQUFPLE1BQU0sa0JBQWtCLEVBQUUsQ0FBQztZQUVwQyxLQUFLLGtDQUFrQztnQkFDckMsT0FBTyxNQUFNLHlCQUF5QixDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRWhELEtBQUsscUJBQXFCO2dCQUN4QixPQUFPLE1BQU0sYUFBYSxDQUFDLEtB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QUMsQ0FBQztJQUVKLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRTtRQUNkLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRTtZQUM1QixJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssU0FBUyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssYUFBYSxFQUFFO2dCQUM1RCxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSw0QkFBYSxDQUFDO29CQUNyQyxTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMkI7b0JBQ2xELEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFO29CQUNuQixnQkFBZ0IsRUFBRSwrQ0FBK0M7b0JBQ2pFLHdCQUF3QixFQUFFO3dCQUN4QixTQUFTLEVBQUUsUUFBUTtxQkFDcEI7b0JBQ0QseUJBQXlCLEVBQUU7d0JBQ3pCLFNBQVMsRUFBRSxXQUFXO3dCQUN0QixZQUFZLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7cUJBQ3ZDO2lCQUNGLENBQUMsQ0FBQyxDQUFDO2FBQ0w7U0FDRjtLQUNGO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBHZXRDb21tYW5kLCBVcGRhdGVDb21tYW5kLCBRdWVyeUNvbW1hbmQsIFB1dENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBTUVNDbGllbnQsIFNlbmRNZXNzYWdlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xyXG5pbXBvcnQgeyBwdWJsaXNoaW5nUmVnaXN0cnkgfSBmcm9tICcuL3B1Ymxpc2hpbmcvcHVibGlzaGluZy1hZ2VudC1yZWdpc3RyeSc7XHJcbmltcG9ydCB7IEJsb2dDb250ZW50IH0gZnJvbSAnLi4vLi4vZnJvbnRlbmQvc3JjL3R5cGVzL0Jsb2dDb250ZW50JztcclxuaW1wb3J0IHsgUHVibGlzaGluZ0NvbmZpZywgUHVibGlzaFJlc3VsdCB9IGZyb20gJy4vcHVibGlzaGluZy9iYXNlLXB1Ymxpc2hpbmctYWdlbnQnO1xyXG5cclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcclxuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb0NsaWVudCk7XHJcbmNvbnN0IHNxc0NsaWVudCA9IG5ldyBTUVNDbGllbnQoe30pO1xyXG5cclxuaW50ZXJmYWNlIFB1Ymxpc2hSZXF1ZXN0IHtcclxuICBjb250ZW50SWQ6IHN0cmluZztcclxuICBwbGF0Zm9ybXM6IHN0cmluZ1tdO1xyXG4gIGNvbmZpZ3M6IFJlY29yZDxzdHJpbmcsIFB1Ymxpc2hpbmdDb25maWc+O1xyXG4gIGltYWdlVXJsPzogc3RyaW5nO1xyXG4gIHJldHJ5RmFpbGVkT25seT86IGJvb2xlYW47XHJcbn1cclxuXHJcbmludGVyZmFjZSBQdWJsaXNoU3RhdHVzUmVxdWVzdCB7XHJcbiAgY29udGVudElkOiBzdHJpbmc7XHJcbiAgcGxhdGZvcm06IHN0cmluZztcclxuICBwbGF0Zm9ybUlkOiBzdHJpbmc7XHJcbiAgY29uZmlnOiBQdWJsaXNoaW5nQ29uZmlnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUHVibGlzaGluZ0pvYiB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBjb250ZW50SWQ6IHN0cmluZztcclxuICBwbGF0Zm9ybTogc3RyaW5nO1xyXG4gIGNvbmZpZzogUHVibGlzaGluZ0NvbmZpZztcclxuICBzdGF0dXM6ICdwZW5kaW5nJyB8ICdpbl9wcm9ncmVzcycgfCAnY29tcGxldGVkJyB8ICdmYWlsZWQnIHwgJ3JldHJ5aW5nJztcclxuICBhdHRlbXB0czogbnVtYmVyO1xyXG4gIG1heEF0dGVtcHRzOiBudW1iZXI7XHJcbiAgbGFzdEVycm9yPzogc3RyaW5nO1xyXG4gIHJlc3VsdD86IFB1Ymxpc2hSZXN1bHQ7XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgdXBkYXRlZEF0OiBzdHJpbmc7XHJcbiAgbmV4dFJldHJ5QXQ/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBQdWJsaXNoaW5nT3JjaGVzdHJhdGlvblJlc3VsdCB7XHJcbiAgam9iSWQ6IHN0cmluZztcclxuICBjb250ZW50SWQ6IHN0cmluZztcclxuICB0b3RhbFBsYXRmb3JtczogbnVtYmVyO1xyXG4gIHN1Y2Nlc3NmdWxQbGF0Zm9ybXM6IG51bWJlcjtcclxuICBmYWlsZWRQbGF0Zm9ybXM6IG51bWJlcjtcclxuICBzdGF0dXM6ICdjb21wbGV0ZWQnIHwgJ3BhcnRpYWwnIHwgJ2ZhaWxlZCcgfCAnaW5fcHJvZ3Jlc3MnO1xyXG4gIHJlc3VsdHM6IFJlY29yZDxzdHJpbmcsIFB1Ymxpc2hSZXN1bHQ+O1xyXG4gIGpvYnM6IFJlY29yZDxzdHJpbmcsIFB1Ymxpc2hpbmdKb2I+O1xyXG59XHJcblxyXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xyXG4gIGNvbnN0IGhlYWRlcnMgPSB7XHJcbiAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxBdXRob3JpemF0aW9uJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUydcclxuICB9O1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgcGF0aCA9IGV2ZW50LnBhdGg7XHJcbiAgICBjb25zdCBtZXRob2QgPSBldmVudC5odHRwTWV0aG9kO1xyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdPUFRJT05TJykge1xyXG4gICAgICByZXR1cm4geyBzdGF0dXNDb2RlOiAyMDAsIGhlYWRlcnMsIGJvZHk6ICcnIH07XHJcbiAgICB9XHJcblxyXG4gICAgc3dpdGNoIChwYXRoKSB7XHJcbiAgICAgIGNhc2UgJy9wdWJsaXNoaW5nL3BsYXRmb3Jtcyc6XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUdldFBsYXRmb3JtcygpO1xyXG4gICAgICBcclxuICAgICAgY2FzZSAnL3B1Ymxpc2hpbmcvdmFsaWRhdGUtY3JlZGVudGlhbHMnOlxyXG4gICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVWYWxpZGF0ZUNyZWRlbnRpYWxzKGV2ZW50KTtcclxuICAgICAgXHJcbiAgICAgIGNhc2UgJy9wdWJsaXNoaW5nL3B1Ymxpc2gnOlxyXG4gICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVQdWJsaXNoKGV2ZW50KTtcclxuICAgICAgXHJcbiAgICAgIGNhc2UgJy9wdWJsaXNoaW5nL3N0YXR1cyc6XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUdldFN0YXR1cyhldmVudCk7XHJcbiAgICAgIFxyXG4gICAgICBjYXNlICcvcHVibGlzaGluZy9mb3JtYXQtcHJldmlldyc6XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUZvcm1hdFByZXZpZXcoZXZlbnQpO1xyXG4gICAgICBcclxuICAgICAgY2FzZSAnL3B1Ymxpc2hpbmcvb3JjaGVzdHJhdGUnOlxyXG4gICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVPcmNoZXN0cmF0ZShldmVudCk7XHJcbiAgICAgIFxyXG4gICAgICBjYXNlICcvcHVibGlzaGluZy9yZXRyeSc6XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZVJldHJ5RmFpbGVkKGV2ZW50KTtcclxuICAgICAgXHJcbiAgICAgIGNhc2UgJy9wdWJsaXNoaW5nL2pvYi1zdGF0dXMnOlxyXG4gICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVHZXRKb2JTdGF0dXMoZXZlbnQpO1xyXG4gICAgICBcclxuICAgICAgY2FzZSAnL3B1Ymxpc2hpbmcvY2FuY2VsJzpcclxuICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQ2FuY2VsSm9iKGV2ZW50KTtcclxuICAgICAgXHJcbiAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgICAgIGhlYWRlcnMsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnRW5kcG9pbnQgbm90IGZvdW5kJyB9KVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1B1Ymxpc2hpbmcgb3JjaGVzdHJhdG9yIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVycyxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBcclxuICAgICAgICBlcnJvcjogJ0ludGVybmFsIHNlcnZlciBlcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcclxuICAgICAgfSlcclxuICAgIH07XHJcbiAgfVxyXG59O1xyXG5cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlR2V0UGxhdGZvcm1zKCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgY29uc3QgcGxhdGZvcm1zID0gcHVibGlzaGluZ1JlZ2lzdHJ5LmdldFN1cHBvcnRlZFBsYXRmb3JtcygpLm1hcChwbGF0Zm9ybSA9PiAoe1xyXG4gICAgbmFtZTogcGxhdGZvcm0sXHJcbiAgICBmZWF0dXJlczogcHVibGlzaGluZ1JlZ2lzdHJ5LmdldFBsYXRmb3JtRmVhdHVyZXMocGxhdGZvcm0pXHJcbiAgfSkpO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgaGVhZGVyczoge1xyXG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICB9LFxyXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBwbGF0Zm9ybXMgfSlcclxuICB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVWYWxpZGF0ZUNyZWRlbnRpYWxzKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSB8fCAne30nKTtcclxuICBjb25zdCB7IHBsYXRmb3JtLCBjcmVkZW50aWFscyB9ID0gYm9keTtcclxuXHJcbiAgaWYgKCFwbGF0Zm9ybSB8fCAhY3JlZGVudGlhbHMpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUGxhdGZvcm0gYW5kIGNyZWRlbnRpYWxzIGFyZSByZXF1aXJlZCcgfSlcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgaXNWYWxpZCA9IGF3YWl0IHB1Ymxpc2hpbmdSZWdpc3RyeS52YWxpZGF0ZUNyZWRlbnRpYWxzKHBsYXRmb3JtLCBjcmVkZW50aWFscyk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyB2YWxpZDogaXNWYWxpZCB9KVxyXG4gICAgfTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgXHJcbiAgICAgICAgdmFsaWQ6IGZhbHNlLCBcclxuICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVmFsaWRhdGlvbiBmYWlsZWQnIFxyXG4gICAgICB9KVxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVB1Ymxpc2goZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShldmVudC5ib2R5IHx8ICd7fScpIGFzIFB1Ymxpc2hSZXF1ZXN0O1xyXG4gIGNvbnN0IHsgY29udGVudElkLCBwbGF0Zm9ybXMsIGNvbmZpZ3MsIGltYWdlVXJsLCByZXRyeUZhaWxlZE9ubHkgfSA9IGJvZHk7XHJcblxyXG4gIGlmICghY29udGVudElkIHx8ICFwbGF0Zm9ybXMgfHwgIWNvbmZpZ3MpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnQ29udGVudElkLCBwbGF0Zm9ybXMsIGFuZCBjb25maWdzIGFyZSByZXF1aXJlZCcgfSlcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICB0cnkge1xyXG4gICAgLy8gR2V0IGNvbnRlbnQgZnJvbSBEeW5hbW9EQlxyXG4gICAgY29uc3QgY29udGVudFJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUhLFxyXG4gICAgICBLZXk6IHsgaWQ6IGNvbnRlbnRJZCB9XHJcbiAgICB9KSk7XHJcblxyXG4gICAgaWYgKCFjb250ZW50UmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcclxuICAgICAgICB9LFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdDb250ZW50IG5vdCBmb3VuZCcgfSlcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjb250ZW50ID0gY29udGVudFJlc3VsdC5JdGVtIGFzIEJsb2dDb250ZW50O1xyXG4gICAgXHJcbiAgICAvLyBGaWx0ZXIgcGxhdGZvcm1zIGlmIHJldHJ5aW5nIGZhaWxlZCBvbmx5XHJcbiAgICBsZXQgdGFyZ2V0UGxhdGZvcm1zID0gcGxhdGZvcm1zO1xyXG4gICAgaWYgKHJldHJ5RmFpbGVkT25seSAmJiBjb250ZW50LnB1Ymxpc2hpbmdSZXN1bHRzKSB7XHJcbiAgICAgIGNvbnN0IGZhaWxlZFBsYXRmb3JtcyA9IGNvbnRlbnQucHVibGlzaGluZ1Jlc3VsdHNcclxuICAgICAgICAuZmlsdGVyKChyZXN1bHQ6IGFueSkgPT4gIXJlc3VsdC5zdWNjZXNzKVxyXG4gICAgICAgIC5tYXAoKHJlc3VsdDogYW55KSA9PiByZXN1bHQucGxhdGZvcm0pO1xyXG4gICAgICB0YXJnZXRQbGF0Zm9ybXMgPSBwbGF0Zm9ybXMuZmlsdGVyKHAgPT4gZmFpbGVkUGxhdGZvcm1zLmluY2x1ZGVzKHApKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGFyZ2V0UGxhdGZvcm1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBcclxuICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgICBtZXNzYWdlOiAnTm8gcGxhdGZvcm1zIHRvIHJldHJ5JyxcclxuICAgICAgICAgIHJlc3VsdHM6IHt9XHJcbiAgICAgICAgfSlcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjb25maWdNYXAgPSBuZXcgTWFwKE9iamVjdC5lbnRyaWVzKGNvbmZpZ3MpKTtcclxuICAgIFxyXG4gICAgLy8gUHVibGlzaCB0byBtdWx0aXBsZSBwbGF0Zm9ybXMgd2l0aCBlbmhhbmNlZCBlcnJvciBoYW5kbGluZ1xyXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHB1Ymxpc2hXaXRoUmV0cnkoXHJcbiAgICAgIHRhcmdldFBsYXRmb3JtcyxcclxuICAgICAgY29udGVudCxcclxuICAgICAgY29uZmlnTWFwLFxyXG4gICAgICBpbWFnZVVybFxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBVcGRhdGUgY29udGVudCB3aXRoIHB1Ymxpc2hpbmcgcmVzdWx0c1xyXG4gICAgY29uc3QgZXhpc3RpbmdSZXN1bHRzID0gY29udGVudC5wdWJsaXNoaW5nUmVzdWx0cyB8fCBbXTtcclxuICAgIGNvbnN0IHVwZGF0ZWRSZXN1bHRzID0gWy4uLmV4aXN0aW5nUmVzdWx0c107XHJcblxyXG4gICAgLy8gVXBkYXRlIG9yIGFkZCByZXN1bHRzIGZvciBlYWNoIHBsYXRmb3JtXHJcbiAgICBBcnJheS5mcm9tKHJlc3VsdHMuZW50cmllcygpKS5mb3JFYWNoKChbcGxhdGZvcm0sIHJlc3VsdF0pID0+IHtcclxuICAgICAgY29uc3QgZXhpc3RpbmdJbmRleCA9IHVwZGF0ZWRSZXN1bHRzLmZpbmRJbmRleCgocjogYW55KSA9PiByLnBsYXRmb3JtID09PSBwbGF0Zm9ybSk7XHJcbiAgICAgIGNvbnN0IG5ld1Jlc3VsdCA9IHtcclxuICAgICAgICBwbGF0Zm9ybSxcclxuICAgICAgICAuLi5yZXN1bHQsXHJcbiAgICAgICAgcHVibGlzaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgaWYgKGV4aXN0aW5nSW5kZXggPj0gMCkge1xyXG4gICAgICAgIHVwZGF0ZWRSZXN1bHRzW2V4aXN0aW5nSW5kZXhdID0gbmV3UmVzdWx0O1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHVwZGF0ZWRSZXN1bHRzLnB1c2gobmV3UmVzdWx0KTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSEsXHJcbiAgICAgIEtleTogeyBpZDogY29udGVudElkIH0sXHJcbiAgICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgcHVibGlzaGluZ1Jlc3VsdHMgPSA6cmVzdWx0cywgdXBkYXRlZEF0ID0gOnVwZGF0ZWRBdCcsXHJcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAnOnJlc3VsdHMnOiB1cGRhdGVkUmVzdWx0cyxcclxuICAgICAgICAnOnVwZGF0ZWRBdCc6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgICB9XHJcbiAgICB9KSk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgXHJcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICByZXN1bHRzOiBPYmplY3QuZnJvbUVudHJpZXMocmVzdWx0cylcclxuICAgICAgfSlcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1B1Ymxpc2hpbmcgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgXHJcbiAgICAgICAgZXJyb3I6ICdQdWJsaXNoaW5nIGZhaWxlZCcsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcclxuICAgICAgfSlcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVHZXRTdGF0dXMoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShldmVudC5ib2R5IHx8ICd7fScpIGFzIFB1Ymxpc2hTdGF0dXNSZXF1ZXN0O1xyXG4gIGNvbnN0IHsgY29udGVudElkLCBwbGF0Zm9ybSwgcGxhdGZvcm1JZCwgY29uZmlnIH0gPSBib2R5O1xyXG5cclxuICBpZiAoIWNvbnRlbnRJZCB8fCAhcGxhdGZvcm0gfHwgIXBsYXRmb3JtSWQgfHwgIWNvbmZpZykge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdBbGwgcGFyYW1ldGVycyBhcmUgcmVxdWlyZWQnIH0pXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHN0YXR1cyA9IGF3YWl0IHB1Ymxpc2hpbmdSZWdpc3RyeS5nZXRQdWJsaXNoaW5nU3RhdHVzKHBsYXRmb3JtLCBwbGF0Zm9ybUlkLCBjb25maWcpO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBzdGF0dXMgfSlcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IFxyXG4gICAgICAgIGVycm9yOiAnRmFpbGVkIHRvIGdldCBzdGF0dXMnLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXHJcbiAgICAgIH0pXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlRm9ybWF0UHJldmlldyhldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkgfHwgJ3t9Jyk7XHJcbiAgY29uc3QgeyBjb250ZW50SWQsIHBsYXRmb3JtLCBpbWFnZVVybCB9ID0gYm9keTtcclxuXHJcbiAgaWYgKCFjb250ZW50SWQgfHwgIXBsYXRmb3JtKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0NvbnRlbnRJZCBhbmQgcGxhdGZvcm0gYXJlIHJlcXVpcmVkJyB9KVxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBHZXQgY29udGVudCBmcm9tIER5bmFtb0RCXHJcbiAgICBjb25zdCBjb250ZW50UmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSEsXHJcbiAgICAgIEtleTogeyBpZDogY29udGVudElkIH1cclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIWNvbnRlbnRSZXN1bHQuSXRlbSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0NvbnRlbnQgbm90IGZvdW5kJyB9KVxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGNvbnRlbnQgPSBjb250ZW50UmVzdWx0Lkl0ZW0gYXMgQmxvZ0NvbnRlbnQ7XHJcbiAgICBjb25zdCBmb3JtYXR0ZWRDb250ZW50ID0gYXdhaXQgcHVibGlzaGluZ1JlZ2lzdHJ5LmZvcm1hdENvbnRlbnQocGxhdGZvcm0sIGNvbnRlbnQsIGltYWdlVXJsKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBmb3JtYXR0ZWRDb250ZW50IH0pXHJcbiAgICB9O1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBcclxuICAgICAgICBlcnJvcjogJ0Zvcm1hdCBwcmV2aWV3IGZhaWxlZCcsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcclxuICAgICAgfSlcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVPcmNoZXN0cmF0ZShldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkgfHwgJ3t9JykgYXMgUHVibGlzaFJlcXVlc3Q7XHJcbiAgY29uc3QgeyBjb250ZW50SWQsIHBsYXRmb3JtcywgY29uZmlncywgaW1hZ2VVcmwgfSA9IGJvZHk7XHJcblxyXG4gIGlmICghY29udGVudElkIHx8ICFwbGF0Zm9ybXMgfHwgIWNvbmZpZ3MpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnQ29udGVudElkLCBwbGF0Zm9ybXMsIGFuZCBjb25maWdzIGFyZSByZXF1aXJlZCcgfSlcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3Qgam9iSWQgPSBgam9iXyR7Y29udGVudElkfV8ke0RhdGUubm93KCl9YDtcclxuICAgIGNvbnN0IG9yY2hlc3RyYXRpb25SZXN1bHQgPSBhd2FpdCBvcmNoZXN0cmF0ZVB1Ymxpc2hpbmcoam9iSWQsIGNvbnRlbnRJZCwgcGxhdGZvcm1zLCBjb25maWdzLCBpbWFnZVVybCk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KG9yY2hlc3RyYXRpb25SZXN1bHQpXHJcbiAgICB9O1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdPcmNoZXN0cmF0aW9uIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IFxyXG4gICAgICAgIGVycm9yOiAnT3JjaGVzdHJhdGlvbiBmYWlsZWQnLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXHJcbiAgICAgIH0pXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlUmV0cnlGYWlsZWQoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShldmVudC5ib2R5IHx8ICd7fScpO1xyXG4gIGNvbnN0IHsgam9iSWQgfSA9IGJvZHk7XHJcblxyXG4gIGlmICgham9iSWQpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSm9iSWQgaXMgcmVxdWlyZWQnIH0pXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJldHJ5RmFpbGVkSm9icyhqb2JJZCk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzdWx0KVxyXG4gICAgfTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignUmV0cnkgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNTAwLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgXHJcbiAgICAgICAgZXJyb3I6ICdSZXRyeSBmYWlsZWQnLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXHJcbiAgICAgIH0pXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlR2V0Sm9iU3RhdHVzKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgY29uc3Qgam9iSWQgPSBldmVudC5xdWVyeVN0cmluZ1BhcmFtZXRlcnM/LmpvYklkO1xyXG5cclxuICBpZiAoIWpvYklkKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ0pvYklkIGlzIHJlcXVpcmVkJyB9KVxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBzdGF0dXMgPSBhd2FpdCBnZXRKb2JTdGF0dXMoam9iSWQpO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHN0YXR1cylcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0dldCBqb2Igc3RhdHVzIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IFxyXG4gICAgICAgIGVycm9yOiAnRmFpbGVkIHRvIGdldCBqb2Igc3RhdHVzJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xyXG4gICAgICB9KVxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNhbmNlbEpvYihldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQpOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4ge1xyXG4gIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkgfHwgJ3t9Jyk7XHJcbiAgY29uc3QgeyBqb2JJZCB9ID0gYm9keTtcclxuXHJcbiAgaWYgKCFqb2JJZCkge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonXHJcbiAgICAgIH0sXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdKb2JJZCBpcyByZXF1aXJlZCcgfSlcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICB0cnkge1xyXG4gICAgYXdhaXQgY2FuY2VsSm9iKGpvYklkKTtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJ1xyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHN1Y2Nlc3M6IHRydWUsIG1lc3NhZ2U6ICdKb2IgY2FuY2VsbGVkJyB9KVxyXG4gICAgfTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignQ2FuY2VsIGpvYiBlcnJvcjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcclxuICAgICAgfSxcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBcclxuICAgICAgICBlcnJvcjogJ0ZhaWxlZCB0byBjYW5jZWwgam9iJyxcclxuICAgICAgICBtZXNzYWdlOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xyXG4gICAgICB9KVxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEhlbHBlciBmdW5jdGlvbnMgZm9yIG9yY2hlc3RyYXRpb25cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHB1Ymxpc2hXaXRoUmV0cnkoXHJcbiAgcGxhdGZvcm1zOiBzdHJpbmdbXSxcclxuICBjb250ZW50OiBCbG9nQ29udGVudCxcclxuICBjb25maWdzOiBNYXA8c3RyaW5nLCBQdWJsaXNoaW5nQ29uZmlnPixcclxuICBpbWFnZVVybD86IHN0cmluZyxcclxuICBtYXhBdHRlbXB0czogbnVtYmVyID0gM1xyXG4pOiBQcm9taXNlPE1hcDxzdHJpbmcsIFB1Ymxpc2hSZXN1bHQ+PiB7XHJcbiAgY29uc3QgcmVzdWx0cyA9IG5ldyBNYXA8c3RyaW5nLCBQdWJsaXNoUmVzdWx0PigpO1xyXG4gIFxyXG4gIGZvciAoY29uc3QgcGxhdGZvcm0gb2YgcGxhdGZvcm1zKSB7XHJcbiAgICBjb25zdCBjb25maWcgPSBjb25maWdzLmdldChwbGF0Zm9ybSk7XHJcbiAgICBpZiAoIWNvbmZpZykge1xyXG4gICAgICByZXN1bHRzLnNldChwbGF0Zm9ybSwge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBgTm8gY29uZmlndXJhdGlvbiBmb3VuZCBmb3IgcGxhdGZvcm06ICR7cGxhdGZvcm19YFxyXG4gICAgICB9KTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IGxhc3RFcnJvcjogc3RyaW5nIHwgdW5kZWZpbmVkO1xyXG4gICAgbGV0IHN1Y2Nlc3MgPSBmYWxzZTtcclxuXHJcbiAgICBmb3IgKGxldCBhdHRlbXB0ID0gMTsgYXR0ZW1wdCA8PSBtYXhBdHRlbXB0cyAmJiAhc3VjY2VzczsgYXR0ZW1wdCsrKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFB1Ymxpc2hpbmcgdG8gJHtwbGF0Zm9ybX0sIGF0dGVtcHQgJHthdHRlbXB0fS8ke21heEF0dGVtcHRzfWApO1xyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHB1Ymxpc2hpbmdSZWdpc3RyeS5wdWJsaXNoKHBsYXRmb3JtLCBjb250ZW50LCBjb25maWcsIGltYWdlVXJsKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAocmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICAgIHJlc3VsdHMuc2V0KHBsYXRmb3JtLCByZXN1bHQpO1xyXG4gICAgICAgICAgc3VjY2VzcyA9IHRydWU7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGxhc3RFcnJvciA9IHJlc3VsdC5lcnJvcjtcclxuICAgICAgICAgIGlmIChhdHRlbXB0IDwgbWF4QXR0ZW1wdHMpIHtcclxuICAgICAgICAgICAgLy8gRXhwb25lbnRpYWwgYmFja29mZjogMXMsIDJzLCA0c1xyXG4gICAgICAgICAgICBjb25zdCBkZWxheSA9IE1hdGgucG93KDIsIGF0dGVtcHQgLSAxKSAqIDEwMDA7XHJcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCBkZWxheSkpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBsYXN0RXJyb3IgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJztcclxuICAgICAgICBpZiAoYXR0ZW1wdCA8IG1heEF0dGVtcHRzKSB7XHJcbiAgICAgICAgICBjb25zdCBkZWxheSA9IE1hdGgucG93KDIsIGF0dGVtcHQgLSAxKSAqIDEwMDA7XHJcbiAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgZGVsYXkpKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXN1Y2Nlc3MpIHtcclxuICAgICAgcmVzdWx0cy5zZXQocGxhdGZvcm0sIHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogbGFzdEVycm9yIHx8ICdGYWlsZWQgYWZ0ZXIgbWF4aW11bSByZXRyeSBhdHRlbXB0cydcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gcmVzdWx0cztcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gb3JjaGVzdHJhdGVQdWJsaXNoaW5nKFxyXG4gIGpvYklkOiBzdHJpbmcsXHJcbiAgY29udGVudElkOiBzdHJpbmcsXHJcbiAgcGxhdGZvcm1zOiBzdHJpbmdbXSxcclxuICBjb25maWdzOiBSZWNvcmQ8c3RyaW5nLCBQdWJsaXNoaW5nQ29uZmlnPixcclxuICBpbWFnZVVybD86IHN0cmluZ1xyXG4pOiBQcm9taXNlPFB1Ymxpc2hpbmdPcmNoZXN0cmF0aW9uUmVzdWx0PiB7XHJcbiAgY29uc3Qgam9iczogUmVjb3JkPHN0cmluZywgUHVibGlzaGluZ0pvYj4gPSB7fTtcclxuICBjb25zdCByZXN1bHRzOiBSZWNvcmQ8c3RyaW5nLCBQdWJsaXNoUmVzdWx0PiA9IHt9O1xyXG4gIFxyXG4gIC8vIENyZWF0ZSBpbmRpdmlkdWFsIGpvYnMgZm9yIGVhY2ggcGxhdGZvcm1cclxuICBmb3IgKGNvbnN0IHBsYXRmb3JtIG9mIHBsYXRmb3Jtcykge1xyXG4gICAgY29uc3QgY29uZmlnID0gY29uZmlnc1twbGF0Zm9ybV07XHJcbiAgICBpZiAoIWNvbmZpZykge1xyXG4gICAgICByZXN1bHRzW3BsYXRmb3JtXSA9IHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogYE5vIGNvbmZpZ3VyYXRpb24gZm91bmQgZm9yIHBsYXRmb3JtOiAke3BsYXRmb3JtfWBcclxuICAgICAgfTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGxhdGZvcm1Kb2JJZCA9IGAke2pvYklkfV8ke3BsYXRmb3JtfWA7XHJcbiAgICBjb25zdCBqb2I6IFB1Ymxpc2hpbmdKb2IgPSB7XHJcbiAgICAgIGlkOiBwbGF0Zm9ybUpvYklkLFxyXG4gICAgICBjb250ZW50SWQsXHJcbiAgICAgIHBsYXRmb3JtLFxyXG4gICAgICBjb25maWcsXHJcbiAgICAgIHN0YXR1czogJ3BlbmRpbmcnLFxyXG4gICAgICBhdHRlbXB0czogMCxcclxuICAgICAgbWF4QXR0ZW1wdHM6IDMsXHJcbiAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxyXG4gICAgfTtcclxuXHJcbiAgICBqb2JzW3BsYXRmb3JtXSA9IGpvYjtcclxuXHJcbiAgICAvLyBTdG9yZSBqb2IgaW4gRHluYW1vREJcclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5QVUJMSVNISU5HX0pPQlNfVEFCTEVfTkFNRSEsXHJcbiAgICAgIEl0ZW06IGpvYlxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFF1ZXVlIGpvYiBmb3IgcHJvY2Vzc2luZ1xyXG4gICAgYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XHJcbiAgICAgIFF1ZXVlVXJsOiBwcm9jZXNzLmVudi5QVUJMSVNISU5HX1FVRVVFX1VSTCEsXHJcbiAgICAgIE1lc3NhZ2VCb2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgam9iSWQ6IHBsYXRmb3JtSm9iSWQsXHJcbiAgICAgICAgY29udGVudElkLFxyXG4gICAgICAgIHBsYXRmb3JtLFxyXG4gICAgICAgIGNvbmZpZyxcclxuICAgICAgICBpbWFnZVVybFxyXG4gICAgICB9KSxcclxuICAgICAgRGVsYXlTZWNvbmRzOiAwXHJcbiAgICB9KSk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBvcmNoZXN0cmF0aW9uUmVzdWx0OiBQdWJsaXNoaW5nT3JjaGVzdHJhdGlvblJlc3VsdCA9IHtcclxuICAgIGpvYklkLFxyXG4gICAgY29udGVudElkLFxyXG4gICAgdG90YWxQbGF0Zm9ybXM6IHBsYXRmb3Jtcy5sZW5ndGgsXHJcbiAgICBzdWNjZXNzZnVsUGxhdGZvcm1zOiAwLFxyXG4gICAgZmFpbGVkUGxhdGZvcm1zOiAwLFxyXG4gICAgc3RhdHVzOiAnaW5fcHJvZ3Jlc3MnLFxyXG4gICAgcmVzdWx0cyxcclxuICAgIGpvYnNcclxuICB9O1xyXG5cclxuICAvLyBTdG9yZSBvcmNoZXN0cmF0aW9uIHJlc3VsdFxyXG4gIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuUFVCTElTSElOR19PUkNIRVNUUkFUSU9OX1RBQkxFX05BTUUhLFxyXG4gICAgSXRlbToge1xyXG4gICAgICBqb2JJZCxcclxuICAgICAgLi4ub3JjaGVzdHJhdGlvblJlc3VsdCxcclxuICAgICAgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIHVwZGF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXHJcbiAgICB9XHJcbiAgfSkpO1xyXG5cclxuICByZXR1cm4gb3JjaGVzdHJhdGlvblJlc3VsdDtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmV0cnlGYWlsZWRKb2JzKGpvYklkOiBzdHJpbmcpOiBQcm9taXNlPFB1Ymxpc2hpbmdPcmNoZXN0cmF0aW9uUmVzdWx0PiB7XHJcbiAgLy8gR2V0IG9yY2hlc3RyYXRpb24gcmVzdWx0XHJcbiAgY29uc3Qgb3JjaGVzdHJhdGlvblJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuUFVCTElTSElOR19PUkNIRVNUUkFUSU9OX1RBQkxFX05BTUUhLFxyXG4gICAgS2V5OiB7IGpvYklkIH1cclxuICB9KSk7XHJcblxyXG4gIGlmICghb3JjaGVzdHJhdGlvblJlc3VsdC5JdGVtKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0pvYiBub3QgZm91bmQnKTtcclxuICB9XHJcblxyXG4gIGNvbnN0IHJlc3VsdCA9IG9yY2hlc3RyYXRpb25SZXN1bHQuSXRlbSBhcyBQdWJsaXNoaW5nT3JjaGVzdHJhdGlvblJlc3VsdDtcclxuICBcclxuICAvLyBGaW5kIGZhaWxlZCBqb2JzXHJcbiAgY29uc3QgZmFpbGVkSm9icyA9IE9iamVjdC52YWx1ZXMocmVzdWx0LmpvYnMpLmZpbHRlcihqb2IgPT4gXHJcbiAgICBqb2Iuc3RhdHVzID09PSAnZmFpbGVkJyAmJiBqb2IuYXR0ZW1wdHMgPCBqb2IubWF4QXR0ZW1wdHNcclxuICApO1xyXG5cclxuICAvLyBSZXRyeSBmYWlsZWQgam9ic1xyXG4gIGZvciAoY29uc3Qgam9iIG9mIGZhaWxlZEpvYnMpIHtcclxuICAgIGpvYi5zdGF0dXMgPSAncGVuZGluZyc7XHJcbiAgICBqb2IuYXR0ZW1wdHMgKz0gMTtcclxuICAgIGpvYi51cGRhdGVkQXQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBqb2IubmV4dFJldHJ5QXQgPSBuZXcgRGF0ZShEYXRlLm5vdygpICsgTWF0aC5wb3coMiwgam9iLmF0dGVtcHRzKSAqIDEwMDApLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgLy8gVXBkYXRlIGpvYiBpbiBEeW5hbW9EQlxyXG4gICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LlBVQkxJU0hJTkdfSk9CU19UQUJMRV9OQU1FISxcclxuICAgICAgS2V5OiB7IGlkOiBqb2IuaWQgfSxcclxuICAgICAgVXBkYXRlRXhwcmVzc2lvbjogJ1NFVCAjc3RhdHVzID0gOnN0YXR1cywgYXR0ZW1wdHMgPSA6YXR0ZW1wdHMsIHVwZGF0ZWRBdCA9IDp1cGRhdGVkQXQsIG5leHRSZXRyeUF0ID0gOm5leHRSZXRyeUF0JyxcclxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XHJcbiAgICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJ1xyXG4gICAgICB9LFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgJzpzdGF0dXMnOiBqb2Iuc3RhdHVzLFxyXG4gICAgICAgICc6YXR0ZW1wdHMnOiBqb2IuYXR0ZW1wdHMsXHJcbiAgICAgICAgJzp1cGRhdGVkQXQnOiBqb2IudXBkYXRlZEF0LFxyXG4gICAgICAgICc6bmV4dFJldHJ5QXQnOiBqb2IubmV4dFJldHJ5QXRcclxuICAgICAgfVxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFJlLXF1ZXVlIGpvYlxyXG4gICAgYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XHJcbiAgICAgIFF1ZXVlVXJsOiBwcm9jZXNzLmVudi5QVUJMSVNISU5HX1FVRVVFX1VSTCEsXHJcbiAgICAgIE1lc3NhZ2VCb2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgam9iSWQ6IGpvYi5pZCxcclxuICAgICAgICBjb250ZW50SWQ6IGpvYi5jb250ZW50SWQsXHJcbiAgICAgICAgcGxhdGZvcm06IGpvYi5wbGF0Zm9ybSxcclxuICAgICAgICBjb25maWc6IGpvYi5jb25maWdcclxuICAgICAgfSksXHJcbiAgICAgIERlbGF5U2Vjb25kczogTWF0aC5wb3coMiwgam9iLmF0dGVtcHRzKSAvLyBFeHBvbmVudGlhbCBiYWNrb2ZmXHJcbiAgICB9KSk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBnZXRKb2JTdGF0dXMoam9iSWQ6IHN0cmluZyk6IFByb21pc2U8UHVibGlzaGluZ09yY2hlc3RyYXRpb25SZXN1bHQgfCBudWxsPiB7XHJcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5QVUJMSVNISU5HX09SQ0hFU1RSQVRJT05fVEFCTEVfTkFNRSEsXHJcbiAgICBLZXk6IHsgam9iSWQgfVxyXG4gIH0pKTtcclxuXHJcbiAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIFB1Ymxpc2hpbmdPcmNoZXN0cmF0aW9uUmVzdWx0IHx8IG51bGw7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNhbmNlbEpvYihqb2JJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgLy8gVXBkYXRlIG9yY2hlc3RyYXRpb24gc3RhdHVzXHJcbiAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5QVUJMSVNISU5HX09SQ0hFU1RSQVRJT05fVEFCTEVfTkFNRSEsXHJcbiAgICBLZXk6IHsgam9iSWQgfSxcclxuICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsIHVwZGF0ZWRBdCA9IDp1cGRhdGVkQXQnLFxyXG4gICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XHJcbiAgICAgICcjc3RhdHVzJzogJ3N0YXR1cydcclxuICAgIH0sXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICc6c3RhdHVzJzogJ2NhbmNlbGxlZCcsXHJcbiAgICAgICc6dXBkYXRlZEF0JzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXHJcbiAgICB9XHJcbiAgfSkpO1xyXG5cclxuICAvLyBDYW5jZWwgaW5kaXZpZHVhbCBqb2JzXHJcbiAgY29uc3Qgam9icyA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5QVUJMSVNISU5HX0pPQlNfVEFCTEVfTkFNRSEsXHJcbiAgICBJbmRleE5hbWU6ICdKb2JJZEluZGV4JyxcclxuICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdqb2JJZCA9IDpqb2JJZCcsXHJcbiAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICc6am9iSWQnOiBqb2JJZFxyXG4gICAgfVxyXG4gIH0pKTtcclxuXHJcbiAgaWYgKGpvYnMuSXRlbXMpIHtcclxuICAgIGZvciAoY29uc3Qgam9iIG9mIGpvYnMuSXRlbXMpIHtcclxuICAgICAgaWYgKGpvYi5zdGF0dXMgPT09ICdwZW5kaW5nJyB8fCBqb2Iuc3RhdHVzID09PSAnaW5fcHJvZ3Jlc3MnKSB7XHJcbiAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5QVUJMSVNISU5HX0pPQlNfVEFCTEVfTkFNRSEsXHJcbiAgICAgICAgICBLZXk6IHsgaWQ6IGpvYi5pZCB9LFxyXG4gICAgICAgICAgVXBkYXRlRXhwcmVzc2lvbjogJ1NFVCAjc3RhdHVzID0gOnN0YXR1cywgdXBkYXRlZEF0ID0gOnVwZGF0ZWRBdCcsXHJcbiAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcclxuICAgICAgICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJ1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgJzpzdGF0dXMnOiAnY2FuY2VsbGVkJyxcclxuICAgICAgICAgICAgJzp1cGRhdGVkQXQnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbn0iXX0=