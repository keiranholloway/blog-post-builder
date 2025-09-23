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
import * as bedrock from '@aws-cdk/aws-bedrock-alpha';
import * as path from 'path';
import * as fs from 'fs';
import { MonitoringStack } from './monitoring-stack';
import { SecurityConfig, ProductionSecurity } from './security-config';

export interface AutomatedBlogPosterStackProps extends cdk.StackProps {
  corsOrigin?: string;
  domainName?: string;
  environment?: string;
}

export class AutomatedBlogPosterStack extends cdk.Stack {
  public readonly lambdaFunctions: lambda.Function[] = [];
  public readonly api: apigateway.RestApi;
  public readonly tables: dynamodb.Table[] = [];
  public readonly queues: sqs.Queue[] = [];

  constructor(scope: Construct, id: string, props?: AutomatedBlogPosterStackProps) {
    super(scope, id, props);

    const environment = props?.environment || 'development';

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

    // Platform Connections Table for OAuth authentication
    const platformsTable = new dynamodb.Table(this, 'PlatformsTable', {
      tableName: `automated-blog-poster-platforms-${Date.now()}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'platform', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // OAuth States Table for temporary state storage
    const oauthStatesTable = new dynamodb.Table(this, 'OAuthStatesTable', {
      tableName: `automated-blog-poster-oauth-states-${Date.now()}`,
      partitionKey: { name: 'state', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl', // Auto-expire OAuth states after 1 hour
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Publishing Jobs Table for tracking individual platform publishing jobs
    const publishingJobsTable = new dynamodb.Table(this, 'PublishingJobsTable', {
      tableName: `automated-blog-poster-publishing-jobs-${Date.now()}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying jobs by content ID
    publishingJobsTable.addGlobalSecondaryIndex({
      indexName: 'ContentIdIndex',
      partitionKey: { name: 'contentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying jobs by status
    publishingJobsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
    });

    // Publishing Orchestration Table for tracking multi-platform publishing workflows
    const publishingOrchestrationTable = new dynamodb.Table(this, 'PublishingOrchestrationTable', {
      tableName: `automated-blog-poster-publishing-orchestration-${Date.now()}`,
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying orchestration by content ID
    publishingOrchestrationTable.addGlobalSecondaryIndex({
      indexName: 'ContentIdIndex',
      partitionKey: { name: 'contentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying orchestration by status
    publishingOrchestrationTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
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

    // Secrets Manager for security configuration
    const securityConfig = new secretsmanager.Secret(this, 'SecurityConfig', {
      secretName: 'automated-blog-poster/security-config',
      description: 'Security configuration including JWT secrets and policies',
    });

    // DynamoDB table for JWT tokens (for revocation)
    const tokensTable = new dynamodb.Table(this, 'TokensTable', {
      tableName: `automated-blog-poster-tokens-${Date.now()}`,
      partitionKey: { name: 'tokenId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying tokens by user ID
    tokensTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // DynamoDB table for audit logs
    const auditTable = new dynamodb.Table(this, 'AuditTable', {
      tableName: `automated-blog-poster-audit-${Date.now()}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl', // Auto-expire audit logs after retention period
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying audit logs by user ID
    auditTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying audit logs by event type
    auditTable.addGlobalSecondaryIndex({
      indexName: 'EventTypeIndex',
      partitionKey: { name: 'eventType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying audit logs by severity
    auditTable.addGlobalSecondaryIndex({
      indexName: 'SeverityIndex',
      partitionKey: { name: 'severity', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    // Lambda function for authentication handling
    const authHandler = new lambda.Function(this, 'AuthHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'auth-handler.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        PLATFORMS_TABLE: platformsTable.tableName,
        OAUTH_STATES_TABLE: oauthStatesTable.tableName,
        MEDIUM_CLIENT_ID: process.env.MEDIUM_CLIENT_ID || '',
        MEDIUM_CLIENT_SECRET: process.env.MEDIUM_CLIENT_SECRET || '',
        MEDIUM_REDIRECT_URI: process.env.MEDIUM_REDIRECT_URI || '',
        LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID || '',
        LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET || '',
        LINKEDIN_REDIRECT_URI: process.env.LINKEDIN_REDIRECT_URI || '',
        NODE_ENV: 'production',
      },
      deadLetterQueue: new sqs.Queue(this, 'AuthHandlerDLQ', {
        queueName: 'automated-blog-poster-auth-dlq',
      }),
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
        PLATFORMS_TABLE_NAME: platformsTable.tableName,
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

    const publishingQueue = new sqs.Queue(this, 'PublishingQueue', {
      queueName: 'automated-blog-poster-publishing',
      visibilityTimeout: cdk.Duration.minutes(10),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'PublishingDLQ', {
          queueName: 'automated-blog-poster-publishing-dlq',
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

    // Lambda function for data retention cleanup
    const dataRetentionCleanup = new lambda.Function(this, 'DataRetentionCleanup', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'data-retention-cleanup.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.minutes(15), // Longer timeout for cleanup operations
      memorySize: 512,
      environment: {
        CONTENT_TABLE_NAME: contentTable.tableName,
        AUDIT_TABLE_NAME: auditTable.tableName,
        TOKENS_TABLE_NAME: tokensTable.tableName,
        AUDIO_BUCKET_NAME: audioBucket.bucketName,
        IMAGE_BUCKET_NAME: imageBucket.bucketName,
        ALERT_TOPIC_ARN: '', // Will be set after monitoring stack creation
        NODE_ENV: 'production',
      },
      deadLetterQueue: new sqs.Queue(this, 'DataRetentionCleanupDLQ', {
        queueName: 'automated-blog-poster-data-retention-cleanup-dlq',
      }),
    });

    // Schedule data retention cleanup to run daily
    const cleanupRule = new events.Rule(this, 'DataRetentionCleanupRule', {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2', // Run at 2 AM UTC daily
        day: '*',
        month: '*',
        year: '*',
      }),
      targets: [new targets.LambdaFunction(dataRetentionCleanup)],
    });

    // Grant permissions for Auth Handler
    platformsTable.grantReadWriteData(authHandler);
    oauthStatesTable.grantReadWriteData(authHandler);
    tokensTable.grantReadWriteData(authHandler);
    auditTable.grantWriteData(authHandler);
    
    // Grant Secrets Manager permissions to Auth Handler
    authHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:UpdateSecret',
        'secretsmanager:GetSecretValue',
        'secretsmanager:DeleteSecret',
        'secretsmanager:DescribeSecret',
      ],
      resources: [
        'arn:aws:secretsmanager:*:*:secret:oauth-credentials/*',
        'arn:aws:secretsmanager:*:*:secret:automated-blog-poster/security-config*',
      ],
    }));

    // Grant permissions for Data Retention Cleanup
    contentTable.grantReadWriteData(dataRetentionCleanup);
    auditTable.grantReadWriteData(dataRetentionCleanup);
    tokensTable.grantReadWriteData(dataRetentionCleanup);
    audioBucket.grantReadWrite(dataRetentionCleanup);
    imageBucket.grantReadWrite(dataRetentionCleanup);

    // Add security-related environment variables to all Lambda functions
    const securityEnvVars = {
      TOKENS_TABLE_NAME: tokensTable.tableName,
      AUDIT_TABLE_NAME: auditTable.tableName,
      SECURITY_CONFIG_SECRET: securityConfig.secretName,
      CORS_ORIGIN: 'https://keiranholloway.github.io',
    };

    // Update all Lambda functions with security environment variables
    [
      apiHandler,
      inputProcessor,
      contentOrchestrator,
      contentGenerationAgent,
      imageGenerationAgent,
      revisionProcessor,
      publishingOrchestrator,
      authHandler,
      dataRetentionCleanup,
    ].forEach(func => {
      Object.entries(securityEnvVars).forEach(([key, value]) => {
        func.addEnvironment(key, value);
      });
    });

    // Grant security-related permissions to all Lambda functions
    [
      apiHandler,
      inputProcessor,
      contentOrchestrator,
      contentGenerationAgent,
      imageGenerationAgent,
      revisionProcessor,
      publishingOrchestrator,
      authHandler,
      dataRetentionCleanup,
    ].forEach(func => {
      // Grant access to security config
      securityConfig.grantRead(func);
      
      // Grant access to audit table for logging
      auditTable.grantWriteData(func);
      
      // Grant access to tokens table for JWT operations
      tokensTable.grantReadWriteData(func);
    });

    // Grant permissions for API Handler
    contentTable.grantReadWriteData(apiHandler);
    userTable.grantReadWriteData(apiHandler);
    agentMessagesTable.grantReadWriteData(apiHandler);
    platformsTable.grantReadData(apiHandler);
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

    // Create Bedrock Agent with Keiran's personality and content
    const { agent: bedrockAgent, alias: bedrockAgentAlias } = this.createBedrockAgent();

    // Collect all Lambda functions for monitoring
    const allLambdaFunctions = [
      authHandler,
      apiHandler,
      inputProcessor,
      contentOrchestrator,
      dataRetentionCleanup,
      contentGenerationAgent,
      imageGenerationAgent,
      revisionProcessor,
      publishingOrchestrator,
    ];

    // Set up production features and security
    this.setupProductionFeatures(environment, props?.corsOrigin, allLambdaFunctions);

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
        BEDROCK_AGENT_ID: bedrockAgent.agentId,
        BEDROCK_AGENT_ALIAS_ID: bedrockAgentAlias.aliasId,
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
    
    // Grant Bedrock Agent permissions
    contentGenerationAgent.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:GetAgent',
        'bedrock:ListAgents'
      ],
      resources: ['*'], // Will be restricted to specific agent after creation
    }));

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
      memorySize: 1024, // More memory for image processing with Sharp
      environment: {
        CONTENT_TABLE_NAME: contentTable.tableName,
        IMAGE_BUCKET_NAME: imageBucket.bucketName,
        ORCHESTRATOR_QUEUE_URL: agentQueue.queueUrl,
        EVENT_BUS_NAME: eventBus.eventBusName,
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
    eventBus.grantPutEventsTo(imageGenerationAgent);

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

    // Lambda function for publishing orchestration
    const publishingOrchestrator = new lambda.Function(this, 'PublishingOrchestrator', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'publishing-orchestrator.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        CONTENT_TABLE_NAME: contentTable.tableName,
        PLATFORMS_TABLE_NAME: platformsTable.tableName,
        PUBLISHING_JOBS_TABLE_NAME: publishingJobsTable.tableName,
        PUBLISHING_ORCHESTRATION_TABLE_NAME: publishingOrchestrationTable.tableName,
        PUBLISHING_QUEUE_URL: publishingQueue.queueUrl,
        PLATFORM_CREDENTIALS_SECRET: platformCredentials.secretArn,
        NODE_ENV: 'production',
      },
      deadLetterQueue: new sqs.Queue(this, 'PublishingOrchestratorDLQ', {
        queueName: 'automated-blog-poster-publishing-orchestrator-dlq',
      }),
    });

    // Grant permissions for Publishing Orchestrator
    contentTable.grantReadWriteData(publishingOrchestrator);
    platformsTable.grantReadData(publishingOrchestrator);
    publishingJobsTable.grantReadWriteData(publishingOrchestrator);
    publishingOrchestrationTable.grantReadWriteData(publishingOrchestrator);
    publishingQueue.grantSendMessages(publishingOrchestrator);
    platformCredentials.grantRead(publishingOrchestrator);
    
    // Grant external API permissions for publishing
    publishingOrchestrator.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: [platformCredentials.secretArn],
    }));

    // Store references for monitoring
    this.tables = [contentTable, userTable, agentMessagesTable, platformsTable, oauthStatesTable, publishingJobsTable, publishingOrchestrationTable, tokensTable, auditTable];
    this.queues = [agentQueue, contentGenerationQueue, imageGenerationQueue, publishingQueue];

    // API Gateway with GitHub Pages optimized CORS
    this.api = new apigateway.RestApi(this, 'Api', {
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

    // Add CORS support to API Gateway responses
    api.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'https://keiranholloway.github.io'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Requested-With'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
        'Access-Control-Allow-Credentials': "'true'"
      },
    });

    api.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'https://keiranholloway.github.io'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Requested-With'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
        'Access-Control-Allow-Credentials': "'true'"
      },
    });

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

    // Authentication endpoints
    const authResource = apiResource.addResource('auth');
    const authIntegration = new apigateway.LambdaIntegration(authHandler);
    
    // OAuth token exchange endpoint
    const authExchangeResource = authResource.addResource('exchange');
    authExchangeResource.addMethod('POST', authIntegration);
    
    // Platform management endpoints
    const authPlatformsResource = authResource.addResource('platforms');
    const authPlatformsUserResource = authPlatformsResource.addResource('{userId}');
    authPlatformsUserResource.addMethod('GET', authIntegration);
    
    const authPlatformResource = authPlatformsUserResource.addResource('{platform}');
    authPlatformResource.addMethod('DELETE', authIntegration);
    
    // Token status endpoint
    const authStatusResource = authResource.addResource('status');
    const authStatusUserResource = authStatusResource.addResource('{userId}');
    const authStatusPlatformResource = authStatusUserResource.addResource('{platform}');
    authStatusPlatformResource.addMethod('GET', authIntegration);
    
    // Token refresh endpoint
    const authRefreshResource = authResource.addResource('refresh');
    authRefreshResource.addMethod('POST', authIntegration);

    // Publishing endpoints
    const publishingResource = apiResource.addResource('publishing');
    const publishingIntegration = new apigateway.LambdaIntegration(publishingOrchestrator);
    
    // Get supported platforms endpoint
    const publishingPlatformsResource = publishingResource.addResource('platforms');
    publishingPlatformsResource.addMethod('GET', publishingIntegration);
    
    // Validate credentials endpoint
    const publishingValidateResource = publishingResource.addResource('validate-credentials');
    publishingValidateResource.addMethod('POST', publishingIntegration);
    
    // Publish content endpoint
    const publishingPublishResource = publishingResource.addResource('publish');
    publishingPublishResource.addMethod('POST', publishingIntegration);
    
    // Get publishing status endpoint
    const publishingStatusResource = publishingResource.addResource('status');
    publishingStatusResource.addMethod('POST', publishingIntegration);
    
    // Format preview endpoint
    const publishingPreviewResource = publishingResource.addResource('format-preview');
    publishingPreviewResource.addMethod('POST', publishingIntegration);
    
    // Orchestration endpoint
    const publishingOrchestrateResource = publishingResource.addResource('orchestrate');
    publishingOrchestrateResource.addMethod('POST', publishingIntegration);
    
    // Retry failed jobs endpoint
    const publishingRetryResource = publishingResource.addResource('retry');
    publishingRetryResource.addMethod('POST', publishingIntegration);
    
    // Job status endpoint
    const publishingJobStatusResource = publishingResource.addResource('job-status');
    publishingJobStatusResource.addMethod('GET', publishingIntegration);
    
    // Cancel job endpoint
    const publishingCancelResource = publishingResource.addResource('cancel');
    publishingCancelResource.addMethod('POST', publishingIntegration);

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

    new cdk.CfnOutput(this, 'PlatformsTableName', {
      value: platformsTable.tableName,
      description: 'DynamoDB Platforms Table Name',
    });

    new cdk.CfnOutput(this, 'OAuthStatesTableName', {
      value: oauthStatesTable.tableName,
      description: 'DynamoDB OAuth States Table Name',
    });

    // Create monitoring stack
    const monitoringStack = new MonitoringStack(this, 'Monitoring', {
      lambdaFunctions: [
        apiHandler,
        inputProcessor,
        contentOrchestrator,
        contentGenerationAgent,
        imageGenerationAgent,
        revisionProcessor,
        publishingOrchestrator,
        authHandler,
        dataRetentionCleanup,
      ],
      api: api,
      tables: [
        contentTable,
        userTable,
        agentMessagesTable,
        platformsTable,
        oauthStatesTable,
        publishingJobsTable,
        publishingOrchestrationTable,
        tokensTable,
        auditTable,
      ],
      queues: [
        agentQueue,
        contentGenerationQueue,
        imageGenerationQueue,
        publishingQueue,
      ],
      alertEmail: process.env.ALERT_EMAIL,
    });

    // Add environment variables for monitoring
    const monitoringEnvVars = {
      ALERT_TOPIC_ARN: monitoringStack.alertTopic.topicArn,
    };

    // Update Lambda functions with monitoring environment variables
    [
      apiHandler,
      inputProcessor,
      contentOrchestrator,
      contentGenerationAgent,
      imageGenerationAgent,
      revisionProcessor,
      publishingOrchestrator,
      authHandler,
      dataRetentionCleanup,
    ].forEach(func => {
      Object.entries(monitoringEnvVars).forEach(([key, value]) => {
        func.addEnvironment(key, value);
      });
    });

    // Grant SNS publish permissions to all Lambda functions
    [
      apiHandler,
      inputProcessor,
      contentOrchestrator,
      contentGenerationAgent,
      imageGenerationAgent,
      revisionProcessor,
      publishingOrchestrator,
      authHandler,
      dataRetentionCleanup,
    ].forEach(func => {
      monitoringStack.alertTopic.grantPublish(func);
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${monitoringStack.dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: monitoringStack.alertTopic.topicArn,
      description: 'SNS Alert Topic ARN',
    });

    new cdk.CfnOutput(this, 'TokensTableName', {
      value: tokensTable.tableName,
      description: 'DynamoDB Tokens Table Name',
    });

    new cdk.CfnOutput(this, 'AuditTableName', {
      value: auditTable.tableName,
      description: 'DynamoDB Audit Table Name',
    });

    new cdk.CfnOutput(this, 'SecurityConfigSecret', {
      value: securityConfig.secretName,
      description: 'Security Configuration Secret Name',
    });
  }

  /**
   * Create Bedrock Agent with Keiran's personality and content
   */
  private createBedrockAgent(): { agent: bedrock.Agent; alias: bedrock.AgentAlias } {
    // Load agent content files
    const agentContentPath = path.join(__dirname, '../../agent-content');
    
    // Read the agent personality and instructions
    const personalityContent = fs.readFileSync(
      path.join(agentContentPath, 'keiran-blog-author.md'), 
      'utf-8'
    );
    
    // Read blog post examples
    const blogPostExamples = fs.readFileSync(
      path.join(agentContentPath, 'rs-blog-posts.txt'), 
      'utf-8'
    );
    
    // Read Stack Overflow expertise
    const stackOverflowContent = fs.readFileSync(
      path.join(agentContentPath, 'stack-overflow.txt'), 
      'utf-8'
    );

    // Create comprehensive agent instructions (truncated to fit Bedrock limits)
    const agentInstructions = `
${personalityContent.substring(0, 12000)}

## CONTENT GENERATION INSTRUCTIONS

When generating blog content:
1. Use Keiran's contrarian, authoritative voice with 25+ years of experience
2. Include specific metrics and real-world examples from enterprise scenarios
3. Challenge conventional wisdom with evidence-based alternatives
4. Structure content with clear problem-analysis-solution format
5. Always connect technical decisions to business outcomes and cost implications
6. Reference Rackspace Technology expertise and customer transformations
7. End with partnership offer from Rackspace Technology
8. Use signature phrases like "undifferentiated heavy lifting" and "trust me when I say"
9. Write in the style of the provided personality examples
10. Focus on cloud architecture, FinOps, platform engineering, and organizational change
`.substring(0, 19500); // Ensure we stay well under the 20,000 character limit

    // Create the Bedrock Agent using proper CDK constructs
    const agent = new bedrock.Agent(this, 'KeiranBlogAgent', {
      agentName: 'keiran-blog-author',
      description: 'AI agent that writes blog posts in Keiran Holloway\'s distinctive contrarian and authoritative style',
      foundationModel: bedrock.BedrockFoundationModel.ANTHROPIC_CLAUDE_3_5_SONNET_V1_0,
      instruction: agentInstructions,
      idleSessionTTL: cdk.Duration.minutes(30),
      shouldPrepareAgent: true, // Prepare the agent after creation
    });

    // Create agent alias for stable endpoint
    const agentAlias = new bedrock.AgentAlias(this, 'KeiranBlogAgentAlias', {
      agent: agent,
      agentAliasName: 'production',
      description: 'Production alias for Keiran blog agent',
    });

    // Output the agent details
    new cdk.CfnOutput(this, 'BedrockAgentId', {
      description: 'Bedrock Agent ID',
      value: agent.agentId,
    });

    new cdk.CfnOutput(this, 'BedrockAgentAliasId', {
      description: 'Bedrock Agent Alias ID',
      value: agentAlias.aliasId,
    });

    return { agent, alias: agentAlias };
  }

  private setupProductionFeatures(environment: string, corsOrigin?: string, lambdaFunctions: lambda.Function[]) {
    // Store Lambda functions for monitoring
    this.lambdaFunctions = lambdaFunctions;

    // Apply production security if in production environment
    if (environment === 'production') {
      const securityConfig = new SecurityConfig(this, 'SecurityConfig', {
        api: this.api,
        lambdaFunctions: this.lambdaFunctions,
        environment,
      });

      const productionSecurity = new ProductionSecurity(this, 'ProductionSecurity', {
        environment,
        alertEmail: process.env.ALERT_EMAIL || 'alerts@yourdomain.com',
      });
    }

    // Update API Gateway CORS for production
    if (corsOrigin) {
      // CORS is already configured in the API Gateway setup
      // This is a placeholder for any additional CORS configuration
    }

    // Output important URLs and information
    new cdk.CfnOutput(this, 'ApiUrl', {
      description: 'API Gateway URL',
      value: this.api.url,
    });

    new cdk.CfnOutput(this, 'Environment', {
      description: 'Deployment environment',
      value: environment,
    });

    if (environment === 'production') {
      new cdk.CfnOutput(this, 'FrontendUrl', {
        description: 'Frontend URL',
        value: corsOrigin || 'https://keiranholloway.github.io/automated-blog-poster',
      });
    }
  }
}