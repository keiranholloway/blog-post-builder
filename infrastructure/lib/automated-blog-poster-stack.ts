import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';

export class AutomatedBlogPosterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Tables with proper indexes
    const contentTable = new dynamodb.Table(this, 'ContentTable', {
      tableName: `automated-blog-poster-content-${Date.now()}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying content by user
    contentTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying content by status
    contentTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
    });

    const userTable = new dynamodb.Table(this, 'UserTable', {
      tableName: `automated-blog-poster-users-${Date.now()}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying users by email
    userTable.addGlobalSecondaryIndex({
      indexName: 'EmailIndex',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
    });

    // Agent Messages Table for tracking agent communications
    const agentMessagesTable = new dynamodb.Table(this, 'AgentMessagesTable', {
      tableName: `automated-blog-poster-agent-messages-${Date.now()}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying messages by content ID
    agentMessagesTable.addGlobalSecondaryIndex({
      indexName: 'ContentIdIndex',
      partitionKey: { name: 'contentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying messages by status
    agentMessagesTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // S3 Buckets with comprehensive lifecycle policies
    const audioBucket = new s3.Bucket(this, 'AudioBucket', {
      bucketName: `automated-blog-poster-audio-${this.account}-${Date.now()}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'DeleteAudioFiles',
          expiration: cdk.Duration.days(7), // Auto-delete audio files after 7 days
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const imageBucket = new s3.Bucket(this, 'ImageBucket', {
      bucketName: `automated-blog-poster-images-${this.account}-${Date.now()}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'TransitionToIA',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30), // Move to IA after 30 days
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90), // Move to Glacier after 90 days
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // SQS Queues for agent communication
    const agentQueue = new sqs.Queue(this, 'AgentQueue', {
      queueName: 'automated-blog-poster-agents',
      visibilityTimeout: cdk.Duration.minutes(15),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'AgentDLQ', {
          queueName: 'automated-blog-poster-agents-dlq',
        }),
        maxReceiveCount: 3,
      },
    });

    // EventBridge for event-driven architecture
    const eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: 'automated-blog-poster-events',
    });

    // Secrets Manager for platform credentials
    const platformCredentials = new secretsmanager.Secret(this, 'PlatformCredentials', {
      secretName: 'automated-blog-poster/platform-credentials',
      description: 'OAuth credentials for publishing platforms',
    });

    // Lambda function for API handling with proper error handling
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'api-handler.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        CONTENT_TABLE_NAME: contentTable.tableName,
        USER_TABLE_NAME: userTable.tableName,
        AGENT_MESSAGES_TABLE_NAME: agentMessagesTable.tableName,
        AUDIO_BUCKET_NAME: audioBucket.bucketName,
        IMAGE_BUCKET_NAME: imageBucket.bucketName,
        AGENT_QUEUE_URL: agentQueue.queueUrl,
        EVENT_BUS_NAME: eventBus.eventBusName,
        PLATFORM_CREDENTIALS_SECRET: platformCredentials.secretArn,
        NODE_ENV: 'production',
      },
      deadLetterQueue: new sqs.Queue(this, 'ApiHandlerDLQ', {
        queueName: 'automated-blog-poster-api-dlq',
      }),
    });

    // Lambda function for input processing (audio and text)
    const inputProcessor = new lambda.Function(this, 'InputProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'input-processor.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.minutes(5), // Longer timeout for audio processing
      memorySize: 512, // More memory for audio processing
      environment: {
        CONTENT_TABLE_NAME: contentTable.tableName,
        AUDIO_BUCKET_NAME: audioBucket.bucketName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        NODE_ENV: 'production',
      },
      deadLetterQueue: new sqs.Queue(this, 'InputProcessorDLQ', {
        queueName: 'automated-blog-poster-input-processor-dlq',
      }),
    });

    // SQS Queues for agent communication
    const contentGenerationQueue = new sqs.Queue(this, 'ContentGenerationQueue', {
      queueName: 'automated-blog-poster-content-generation',
      visibilityTimeout: cdk.Duration.minutes(15),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'ContentGenerationDLQ', {
          queueName: 'automated-blog-poster-content-generation-dlq',
        }),
        maxReceiveCount: 3,
      },
    });

    const imageGenerationQueue = new sqs.Queue(this, 'ImageGenerationQueue', {
      queueName: 'automated-blog-poster-image-generation',
      visibilityTimeout: cdk.Duration.minutes(10),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'ImageGenerationDLQ', {
          queueName: 'automated-blog-poster-image-generation-dlq',
        }),
        maxReceiveCount: 3,
      },
    });

    // Lambda function for content orchestration
    const contentOrchestrator = new lambda.Function(this, 'ContentOrchestrator', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'content-orchestrator.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        CONTENT_TABLE_NAME: contentTable.tableName,
        AGENT_MESSAGES_TABLE_NAME: agentMessagesTable.tableName,
        CONTENT_GENERATION_QUEUE_URL: contentGenerationQueue.queueUrl,
        IMAGE_GENERATION_QUEUE_URL: imageGenerationQueue.queueUrl,
        EVENT_BUS_NAME: eventBus.eventBusName,
        NODE_ENV: 'production',
      },
      deadLetterQueue: new sqs.Queue(this, 'ContentOrchestratorDLQ', {
        queueName: 'automated-blog-poster-content-orchestrator-dlq',
      }),
    });

    // Grant permissions for API Handler
    contentTable.grantReadWriteData(apiHandler);
    userTable.grantReadWriteData(apiHandler);
    agentMessagesTable.grantReadWriteData(apiHandler);
    audioBucket.grantReadWrite(apiHandler);
    imageBucket.grantReadWrite(apiHandler);
    agentQueue.grantSendMessages(apiHandler);
    eventBus.grantPutEventsTo(apiHandler);
    platformCredentials.grantRead(apiHandler);

    // Grant permissions for Input Processor
    contentTable.grantReadWriteData(inputProcessor);
    audioBucket.grantReadWrite(inputProcessor);
    eventBus.grantPutEventsTo(inputProcessor);
    
    // Grant Transcribe permissions to Input Processor
    inputProcessor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:StartTranscriptionJob',
        'transcribe:GetTranscriptionJob',
        'transcribe:ListTranscriptionJobs',
      ],
      resources: ['*'],
    }));

    // Grant permissions for Content Orchestrator
    contentTable.grantReadWriteData(contentOrchestrator);
    agentMessagesTable.grantReadWriteData(contentOrchestrator);
    contentGenerationQueue.grantSendMessages(contentOrchestrator);
    imageGenerationQueue.grantSendMessages(contentOrchestrator);
    contentGenerationQueue.grantConsumeMessages(contentOrchestrator);
    imageGenerationQueue.grantConsumeMessages(contentOrchestrator);
    eventBus.grantPutEventsTo(contentOrchestrator);

    // EventBridge rules to trigger content orchestrator
    const inputProcessorRule = new events.Rule(this, 'InputProcessorRule', {
      eventBus: eventBus,
      eventPattern: {
        source: ['automated-blog-poster.input-processor'],
        detailType: ['Audio Processing Completed', 'Text Processing Completed'],
      },
      targets: [new targets.LambdaFunction(contentOrchestrator)],
    });

    const contentAgentRule = new events.Rule(this, 'ContentAgentRule', {
      eventBus: eventBus,
      eventPattern: {
        source: ['automated-blog-poster.content-agent'],
        detailType: ['Content Generation Completed', 'Content Generation Failed'],
      },
      targets: [new targets.LambdaFunction(contentOrchestrator)],
    });

    const imageAgentRule = new events.Rule(this, 'ImageAgentRule', {
      eventBus: eventBus,
      eventPattern: {
        source: ['automated-blog-poster.image-agent'],
        detailType: ['Image Generation Completed', 'Image Generation Failed'],
      },
      targets: [new targets.LambdaFunction(contentOrchestrator)],
    });

    // Lambda function for content generation agent
    const contentGenerationAgent = new lambda.Function(this, 'ContentGenerationAgent', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'content-generation-agent.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.minutes(10), // Longer timeout for AI processing
      memorySize: 512, // More memory for content processing
      environment: {
        USER_TABLE_NAME: userTable.tableName,
        CONTENT_TABLE_NAME: contentTable.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        ORCHESTRATOR_QUEUE_URL: agentQueue.queueUrl,
        NODE_ENV: 'production',
      },
      deadLetterQueue: new sqs.Queue(this, 'ContentGenerationAgentDLQ', {
        queueName: 'automated-blog-poster-content-generation-agent-dlq',
      }),
    });

    // Grant permissions for Content Generation Agent
    userTable.grantReadData(contentGenerationAgent);
    contentTable.grantReadWriteData(contentGenerationAgent);
    eventBus.grantPutEventsTo(contentGenerationAgent);
    agentQueue.grantSendMessages(contentGenerationAgent);

    // SQS event source mappings for content generation agent
    contentGenerationAgent.addEventSource(new eventsources.SqsEventSource(contentGenerationQueue, {
      batchSize: 1, // Process one message at a time for better error handling
    }));

    // Lambda function for image generation agent
    const imageGenerationAgent = new lambda.Function(this, 'ImageGenerationAgent', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'image-generation-agent.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.minutes(10), // Longer timeout for image generation
      memorySize: 512, // More memory for image processing
      environment: {
        CONTENT_TABLE: contentTable.tableName,
        IMAGE_BUCKET: imageBucket.bucketName,
        ORCHESTRATOR_QUEUE: agentQueue.queueUrl,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
        NODE_ENV: 'production',
      },
      deadLetterQueue: new sqs.Queue(this, 'ImageGenerationAgentDLQ', {
        queueName: 'automated-blog-poster-image-generation-agent-dlq',
      }),
    });

    // Grant permissions for Image Generation Agent
    contentTable.grantReadWriteData(imageGenerationAgent);
    imageBucket.grantReadWrite(imageGenerationAgent);
    agentQueue.grantSendMessages(imageGenerationAgent);

    // SQS event source mappings for image generation agent
    imageGenerationAgent.addEventSource(new eventsources.SqsEventSource(imageGenerationQueue, {
      batchSize: 1, // Process one message at a time for better error handling
    }));

    // Lambda function for revision processing
    const revisionProcessor = new lambda.Function(this, 'RevisionProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'revision-processor.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        CONTENT_TABLE: contentTable.tableName,
        AGENT_MESSAGES_TABLE: agentMessagesTable.tableName,
        CONTENT_GENERATION_QUEUE: contentGenerationQueue.queueUrl,
        IMAGE_GENERATION_QUEUE: imageGenerationQueue.queueUrl,
        NODE_ENV: 'production',
      },
      deadLetterQueue: new sqs.Queue(this, 'RevisionProcessorDLQ', {
        queueName: 'automated-blog-poster-revision-processor-dlq',
      }),
    });

    // Grant permissions for Revision Processor
    contentTable.grantReadWriteData(revisionProcessor);
    agentMessagesTable.grantReadWriteData(revisionProcessor);
    contentGenerationQueue.grantSendMessages(revisionProcessor);
    imageGenerationQueue.grantSendMessages(revisionProcessor);

    // SQS event source mappings for content orchestrator
    contentOrchestrator.addEventSource(new eventsources.SqsEventSource(agentQueue, {
      batchSize: 1, // Process one message at a time for better error handling
    }));

    // API Gateway with GitHub Pages optimized CORS
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'Automated Blog Poster API',
      description: 'API for the automated blog poster system',
      defaultCorsPreflightOptions: {
        allowOrigins: [
          'https://keiranholloway.github.io', // GitHub Pages origin
          'http://localhost:3000', // Local development
          'http://localhost:5173', // Vite dev server
        ],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Requested-With',
        ],
        allowCredentials: true,
      },
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    const apiIntegration = new apigateway.LambdaIntegration(apiHandler);
    const inputProcessorIntegration = new apigateway.LambdaIntegration(inputProcessor);

    // Root and general API routes
    api.root.addMethod('GET', apiIntegration);
    
    // API resource for general endpoints
    const apiResource = api.root.addResource('api');
    apiResource.addMethod('GET', apiIntegration);
    
    // Status endpoint
    const statusResource = apiResource.addResource('status');
    statusResource.addMethod('GET', apiIntegration);
    
    // Content generation endpoints
    const contentResource = apiResource.addResource('content');
    
    // Generate content endpoint
    const generateResource = contentResource.addResource('generate');
    generateResource.addMethod('POST', apiIntegration);
    
    // Revise content endpoint
    const reviseResource = contentResource.addResource('revise');
    reviseResource.addMethod('POST', apiIntegration);
    
    // Content status endpoint
    const contentStatusResource = contentResource.addResource('status');
    const contentStatusIdResource = contentStatusResource.addResource('{id}');
    contentStatusIdResource.addMethod('GET', apiIntegration);
    
    // Get content endpoint
    const contentIdResource = contentResource.addResource('{id}');
    contentIdResource.addMethod('GET', apiIntegration);
    
    // Get content messages endpoint
    const contentMessagesResource = contentIdResource.addResource('messages');
    contentMessagesResource.addMethod('GET', apiIntegration);
    
    // Validate content endpoint
    const validateResource = contentResource.addResource('validate');
    validateResource.addMethod('POST', apiIntegration);
    
    // Image generation endpoints
    const imageResource = apiResource.addResource('image');
    const imageGenerationIntegration = new apigateway.LambdaIntegration(imageGenerationAgent);
    
    // Generate image endpoint
    const imageGenerateResource = imageResource.addResource('generate');
    imageGenerateResource.addMethod('POST', imageGenerationIntegration);
    
    // Image status endpoint
    const imageStatusResource = imageResource.addResource('status');
    const imageStatusIdResource = imageStatusResource.addResource('{id}');
    imageStatusIdResource.addMethod('GET', apiIntegration);
    
    // Revise image endpoint
    const imageReviseResource = imageResource.addResource('revise');
    imageReviseResource.addMethod('POST', imageGenerationIntegration);
    
    // Analyze content for image endpoint
    const imageAnalyzeResource = imageResource.addResource('analyze');
    imageAnalyzeResource.addMethod('POST', apiIntegration);
    
    // Revision processing endpoints
    const revisionResource = apiResource.addResource('revision');
    const revisionProcessorIntegration = new apigateway.LambdaIntegration(revisionProcessor);
    
    // Content revision endpoint
    const revisionContentResource = revisionResource.addResource('content');
    revisionContentResource.addMethod('POST', revisionProcessorIntegration);
    
    // Image revision endpoint
    const revisionImageResource = revisionResource.addResource('image');
    revisionImageResource.addMethod('POST', revisionProcessorIntegration);
    
    // Batch revision endpoint
    const revisionBatchResource = revisionResource.addResource('batch');
    revisionBatchResource.addMethod('POST', revisionProcessorIntegration);
    
    // Revision history endpoint
    const revisionHistoryResource = revisionResource.addResource('history');
    const revisionHistoryIdResource = revisionHistoryResource.addResource('{id}');
    revisionHistoryIdResource.addMethod('GET', revisionProcessorIntegration);
    
    // Input processing endpoints
    const inputResource = apiResource.addResource('input');
    
    // Audio input endpoint
    const audioResource = inputResource.addResource('audio');
    audioResource.addMethod('POST', inputProcessorIntegration);
    
    // Text input endpoint
    const textResource = inputResource.addResource('text');
    textResource.addMethod('POST', inputProcessorIntegration);
    
    // Status checking endpoint
    const inputStatusResource = inputResource.addResource('status');
    const inputStatusIdResource = inputStatusResource.addResource('{id}');
    inputStatusIdResource.addMethod('GET', inputProcessorIntegration);
    
    // Transcription callback endpoint
    const transcriptionCallbackResource = inputResource.addResource('transcription-callback');
    transcriptionCallbackResource.addMethod('POST', inputProcessorIntegration);

    // Catch-all proxy for any other routes (handled by apiHandler)
    api.root.addProxy({
      defaultIntegration: apiIntegration,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'ContentTableName', {
      value: contentTable.tableName,
      description: 'DynamoDB Content Table Name',
    });

    new cdk.CfnOutput(this, 'UserTableName', {
      value: userTable.tableName,
      description: 'DynamoDB User Table Name',
    });

    new cdk.CfnOutput(this, 'AudioBucketName', {
      value: audioBucket.bucketName,
      description: 'S3 Audio Bucket Name',
    });

    new cdk.CfnOutput(this, 'ImageBucketName', {
      value: imageBucket.bucketName,
      description: 'S3 Image Bucket Name',
    });

    new cdk.CfnOutput(this, 'AgentMessagesTableName', {
      value: agentMessagesTable.tableName,
      description: 'DynamoDB Agent Messages Table Name',
    });

    new cdk.CfnOutput(this, 'AgentQueueUrl', {
      value: agentQueue.queueUrl,
      description: 'SQS Agent Queue URL',
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: eventBus.eventBusName,
      description: 'EventBridge Event Bus Name',
    });
  }
}