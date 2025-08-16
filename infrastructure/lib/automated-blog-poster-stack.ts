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

    // API Gateway with GitHub Pages optimized CORS
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'Automated Blog Poster API',
      description: 'API for the automated blog poster system',
      defaultCorsPreflightOptions: {
        allowOrigins: [
          'https://*.github.io', // GitHub Pages domains
          'http://localhost:*', // Local development
          'https://localhost:*', // Local development with HTTPS
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