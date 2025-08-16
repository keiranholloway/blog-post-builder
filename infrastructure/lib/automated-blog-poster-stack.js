"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomatedBlogPosterStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const sqs = __importStar(require("aws-cdk-lib/aws-sqs"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const eventsources = __importStar(require("aws-cdk-lib/aws-lambda-event-sources"));
class AutomatedBlogPosterStack extends cdk.Stack {
    constructor(scope, id, props) {
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
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
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
            timeout: cdk.Duration.minutes(10),
            memorySize: 512,
            environment: {
                USER_TABLE_NAME: userTable.tableName,
                CONTENT_TABLE_NAME: contentTable.tableName,
                EVENT_BUS_NAME: eventBus.eventBusName,
                ORCHESTRATOR_QUEUE_URL: agentQueue.queueUrl,
                BEDROCK_AGENT_ID: 'PLACEHOLDER_AGENT_ID',
                BEDROCK_AGENT_ALIAS_ID: 'TSTALIASID',
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
            timeout: cdk.Duration.minutes(10),
            memorySize: 512,
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
                    'https://keiranholloway.github.io',
                    'http://localhost:3000',
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
exports.AutomatedBlogPosterStack = AutomatedBlogPosterStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBRW5DLCtEQUFpRDtBQUNqRCx1RUFBeUQ7QUFDekQsbUVBQXFEO0FBQ3JELHVEQUF5QztBQUN6QywrREFBaUQ7QUFDakQseURBQTJDO0FBQzNDLCtFQUFpRTtBQUNqRSx5REFBMkM7QUFDM0Msd0VBQTBEO0FBQzFELG1GQUFxRTtBQUVyRSxNQUFhLHdCQUF5QixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3JELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsc0NBQXNDO1FBQ3RDLE1BQU0sWUFBWSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQzVELFNBQVMsRUFBRSxpQ0FBaUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFO1lBQ3hELFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQ2pFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsVUFBVSxFQUFFLFFBQVEsQ0FBQyxlQUFlLENBQUMsV0FBVztZQUNoRCxtQkFBbUIsRUFBRSxJQUFJO1lBQ3pCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07U0FDeEMsQ0FBQyxDQUFDO1FBRUgsbUNBQW1DO1FBQ25DLFlBQVksQ0FBQyx1QkFBdUIsQ0FBQztZQUNuQyxTQUFTLEVBQUUsYUFBYTtZQUN4QixZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxF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QUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3ZDLEtBQUssRUFBRSxVQUFVLENBQUMsUUFBUTtZQUMxQixXQUFXLEVBQUUscUJBQXFCO1NBQ25DLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxRQUFRLENBQUMsWUFBWTtZQUM1QixXQUFXLEVBQUUsNEJBQTRCO1NBQzFDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXppQkQsNERBeWlCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcclxuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xyXG5pbXBvcnQgKiBhcyB0YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0cyc7XHJcbmltcG9ydCAqIGFzIGV2ZW50c291cmNlcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXMnO1xyXG5cclxuZXhwb3J0IGNsYXNzIEF1dG9tYXRlZEJsb2dQb3N0ZXJTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gRHluYW1vREIgVGFibGVzIHdpdGggcHJvcGVyIGluZGV4ZXNcclxuICAgIGNvbnN0IGNvbnRlbnRUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQ29udGVudFRhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItY29udGVudC0ke0RhdGUubm93KCl9YCxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5BV1NfTUFOQUdFRCxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBjb250ZW50IGJ5IHVzZXJcclxuICAgIGNvbnRlbnRUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1VzZXJJZEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd1c2VySWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdjcmVhdGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBjb250ZW50IGJ5IHN0YXR1c1xyXG4gICAgY29udGVudFRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnU3RhdHVzSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3VwZGF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB1c2VyVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1VzZXJUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiBgYXV0b21hdGVkLWJsb2ctcG9zdGVyLXVzZXJzLSR7RGF0ZS5ub3coKX1gLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIHVzZXJzIGJ5IGVtYWlsXHJcbiAgICB1c2VyVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdFbWFpbEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdlbWFpbCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZ2VudCBNZXNzYWdlcyBUYWJsZSBmb3IgdHJhY2tpbmcgYWdlbnQgY29tbXVuaWNhdGlvbnNcclxuICAgIGNvbnN0IGFnZW50TWVzc2FnZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQWdlbnRNZXNzYWdlc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYWdlbnQtbWVzc2FnZXMtJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgbWVzc2FnZXMgYnkgY29udGVudCBJRFxyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQ29udGVudElkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NvbnRlbnRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIG1lc3NhZ2VzIGJ5IHN0YXR1c1xyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnU3RhdHVzSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTMyBCdWNrZXRzIHdpdGggY29tcHJlaGVuc2l2ZSBsaWZlY3ljbGUgcG9saWNpZXNcclxuICAgIGNvbnN0IGF1ZGlvQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQXVkaW9CdWNrZXQnLCB7XHJcbiAgICAgIGJ1Y2tldE5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYXVkaW8tJHt0aGlzLmFjY291bnR9LSR7RGF0ZS5ub3coKX1gLFxyXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXHJcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXHJcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgaWQ6ICdEZWxldGVBdWRpb0ZpbGVzJyxcclxuICAgICAgICAgIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDcpLCAvLyBBdXRvLWRlbGV0ZSBhdWRpbyBmaWxlcyBhZnRlciA3IGRheXNcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBpbWFnZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0ltYWdlQnVja2V0Jywge1xyXG4gICAgICBidWNrZXROYW1lOiBgYXV0b21hdGVkLWJsb2ctcG9zdGVyLWltYWdlcy0ke3RoaXMuYWNjb3VudH0tJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBpZDogJ1RyYW5zaXRpb25Ub0lBJyxcclxuICAgICAgICAgIHRyYW5zaXRpb25zOiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTkZSRVFVRU5UX0FDQ0VTUyxcclxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSwgLy8gTW92ZSB0byBJQSBhZnRlciAzMCBkYXlzXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5HTEFDSUVSLFxyXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoOTApLCAvLyBNb3ZlIHRvIEdsYWNpZXIgYWZ0ZXIgOTAgZGF5c1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTUVMgUXVldWVzIGZvciBhZ2VudCBjb21tdW5pY2F0aW9uXHJcbiAgICBjb25zdCBhZ2VudFF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQWdlbnRRdWV1ZScsIHtcclxuICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWFnZW50cycsXHJcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xyXG4gICAgICAgIHF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdBZ2VudERMUScsIHtcclxuICAgICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1hZ2VudHMtZGxxJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBFdmVudEJyaWRnZSBmb3IgZXZlbnQtZHJpdmVuIGFyY2hpdGVjdHVyZVxyXG4gICAgY29uc3QgZXZlbnRCdXMgPSBuZXcgZXZlbnRzLkV2ZW50QnVzKHRoaXMsICdFdmVudEJ1cycsIHtcclxuICAgICAgZXZlbnRCdXNOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWV2ZW50cycsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTZWNyZXRzIE1hbmFnZXIgZm9yIHBsYXRmb3JtIGNyZWRlbnRpYWxzXHJcbiAgICBjb25zdCBwbGF0Zm9ybUNyZWRlbnRpYWxzID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnUGxhdGZvcm1DcmVkZW50aWFscycsIHtcclxuICAgICAgc2VjcmV0TmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci9wbGF0Zm9ybS1jcmVkZW50aWFscycsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0F1dGggY3JlZGVudGlhbHMgZm9yIHB1Ymxpc2hpbmcgcGxhdGZvcm1zJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgQVBJIGhhbmRsaW5nIHdpdGggcHJvcGVyIGVycm9yIGhhbmRsaW5nXHJcbiAgICBjb25zdCBhcGlIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQXBpSGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdhcGktaGFuZGxlci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFVTRVJfVEFCTEVfTkFNRTogdXNlclRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBBR0VOVF9NRVNTQUdFU19UQUJMRV9OQU1FOiBhZ2VudE1lc3NhZ2VzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFVRElPX0JVQ0tFVF9OQU1FOiBhdWRpb0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIElNQUdFX0JVQ0tFVF9OQU1FOiBpbWFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIEFHRU5UX1FVRVVFX1VSTDogYWdlbnRRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICAgIFBMQVRGT1JNX0NSRURFTlRJQUxTX1NFQ1JFVDogcGxhdGZvcm1DcmVkZW50aWFscy5zZWNyZXRBcm4sXHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgfSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdBcGlIYW5kbGVyRExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1hcGktZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIGlucHV0IHByb2Nlc3NpbmcgKGF1ZGlvIGFuZCB0ZXh0KVxyXG4gICAgY29uc3QgaW5wdXRQcm9jZXNzb3IgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdJbnB1dFByb2Nlc3NvcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdpbnB1dC1wcm9jZXNzb3IuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLCAvLyBMb25nZXIgdGltZW91dCBmb3IgYXVkaW8gcHJvY2Vzc2luZ1xyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsIC8vIE1vcmUgbWVtb3J5IGZvciBhdWRpbyBwcm9jZXNzaW5nXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFVRElPX0JVQ0tFVF9OQU1FOiBhdWRpb0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgfSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdJbnB1dFByb2Nlc3NvckRMUScsIHtcclxuICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW5wdXQtcHJvY2Vzc29yLWRscScsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU1FTIFF1ZXVlcyBmb3IgYWdlbnQgY29tbXVuaWNhdGlvblxyXG4gICAgY29uc3QgY29udGVudEdlbmVyYXRpb25RdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ0NvbnRlbnRHZW5lcmF0aW9uUXVldWUnLCB7XHJcbiAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcclxuICAgICAgICBxdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQ29udGVudEdlbmVyYXRpb25ETFEnLCB7XHJcbiAgICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItY29udGVudC1nZW5lcmF0aW9uLWRscScsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgaW1hZ2VHZW5lcmF0aW9uUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdJbWFnZUdlbmVyYXRpb25RdWV1ZScsIHtcclxuICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcclxuICAgICAgICBxdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnSW1hZ2VHZW5lcmF0aW9uRExRJywge1xyXG4gICAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWltYWdlLWdlbmVyYXRpb24tZGxxJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIGNvbnRlbnQgb3JjaGVzdHJhdGlvblxyXG4gICAgY29uc3QgY29udGVudE9yY2hlc3RyYXRvciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0NvbnRlbnRPcmNoZXN0cmF0b3InLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnY29udGVudC1vcmNoZXN0cmF0b3IuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFHRU5UX01FU1NBR0VTX1RBQkxFX05BTUU6IGFnZW50TWVzc2FnZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQ09OVEVOVF9HRU5FUkFUSU9OX1FVRVVFX1VSTDogY29udGVudEdlbmVyYXRpb25RdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICBJTUFHRV9HRU5FUkFUSU9OX1FVRVVFX1VSTDogaW1hZ2VHZW5lcmF0aW9uUXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0NvbnRlbnRPcmNoZXN0cmF0b3JETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWNvbnRlbnQtb3JjaGVzdHJhdG9yLWRscScsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIEFQSSBIYW5kbGVyXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXIpO1xyXG4gICAgdXNlclRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlIYW5kbGVyKTtcclxuICAgIGFnZW50TWVzc2FnZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYXBpSGFuZGxlcik7XHJcbiAgICBhdWRpb0J1Y2tldC5ncmFudFJlYWRXcml0ZShhcGlIYW5kbGVyKTtcclxuICAgIGltYWdlQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwaUhhbmRsZXIpO1xyXG4gICAgYWdlbnRRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhhcGlIYW5kbGVyKTtcclxuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8oYXBpSGFuZGxlcik7XHJcbiAgICBwbGF0Zm9ybUNyZWRlbnRpYWxzLmdyYW50UmVhZChhcGlIYW5kbGVyKTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBmb3IgSW5wdXQgUHJvY2Vzc29yXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGlucHV0UHJvY2Vzc29yKTtcclxuICAgIGF1ZGlvQnVja2V0LmdyYW50UmVhZFdyaXRlKGlucHV0UHJvY2Vzc29yKTtcclxuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8oaW5wdXRQcm9jZXNzb3IpO1xyXG4gICAgXHJcbiAgICAvLyBHcmFudCBUcmFuc2NyaWJlIHBlcm1pc3Npb25zIHRvIElucHV0IFByb2Nlc3NvclxyXG4gICAgaW5wdXRQcm9jZXNzb3IuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgJ3RyYW5zY3JpYmU6U3RhcnRUcmFuc2NyaXB0aW9uSm9iJyxcclxuICAgICAgICAndHJhbnNjcmliZTpHZXRUcmFuc2NyaXB0aW9uSm9iJyxcclxuICAgICAgICAndHJhbnNjcmliZTpMaXN0VHJhbnNjcmlwdGlvbkpvYnMnLFxyXG4gICAgICBdLFxyXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBDb250ZW50IE9yY2hlc3RyYXRvclxyXG4gICAgY29udGVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGFnZW50TWVzc2FnZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBjb250ZW50R2VuZXJhdGlvblF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG4gICAgaW1hZ2VHZW5lcmF0aW9uUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBjb250ZW50R2VuZXJhdGlvblF1ZXVlLmdyYW50Q29uc3VtZU1lc3NhZ2VzKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG4gICAgaW1hZ2VHZW5lcmF0aW9uUXVldWUuZ3JhbnRDb25zdW1lTWVzc2FnZXMoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG5cclxuICAgIC8vIEV2ZW50QnJpZGdlIHJ1bGVzIHRvIHRyaWdnZXIgY29udGVudCBvcmNoZXN0cmF0b3JcclxuICAgIGNvbnN0IGlucHV0UHJvY2Vzc29yUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnSW5wdXRQcm9jZXNzb3JSdWxlJywge1xyXG4gICAgICBldmVudEJ1czogZXZlbnRCdXMsXHJcbiAgICAgIGV2ZW50UGF0dGVybjoge1xyXG4gICAgICAgIHNvdXJjZTogWydhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW5wdXQtcHJvY2Vzc29yJ10sXHJcbiAgICAgICAgZGV0YWlsVHlwZTogWydBdWRpbyBQcm9jZXNzaW5nIENvbXBsZXRlZCcsICdUZXh0IFByb2Nlc3NpbmcgQ29tcGxldGVkJ10sXHJcbiAgICAgIH0sXHJcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihjb250ZW50T3JjaGVzdHJhdG9yKV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjb250ZW50QWdlbnRSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdDb250ZW50QWdlbnRSdWxlJywge1xyXG4gICAgICBldmVudEJ1czogZXZlbnRCdXMsXHJcbiAgICAgIGV2ZW50UGF0dGVybjoge1xyXG4gICAgICAgIHNvdXJjZTogWydhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuY29udGVudC1hZ2VudCddLFxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnQ29udGVudCBHZW5lcmF0aW9uIENvbXBsZXRlZCcsICdDb250ZW50IEdlbmVyYXRpb24gRmFpbGVkJ10sXHJcbiAgICAgIH0sXHJcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihjb250ZW50T3JjaGVzdHJhdG9yKV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBpbWFnZUFnZW50UnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnSW1hZ2VBZ2VudFJ1bGUnLCB7XHJcbiAgICAgIGV2ZW50QnVzOiBldmVudEJ1cyxcclxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XHJcbiAgICAgICAgc291cmNlOiBbJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbWFnZS1hZ2VudCddLFxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnSW1hZ2UgR2VuZXJhdGlvbiBDb21wbGV0ZWQnLCAnSW1hZ2UgR2VuZXJhdGlvbiBGYWlsZWQnXSxcclxuICAgICAgfSxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGNvbnRlbnRPcmNoZXN0cmF0b3IpXSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgY29udGVudCBnZW5lcmF0aW9uIGFnZW50XHJcbiAgICBjb25zdCBjb250ZW50R2VuZXJhdGlvbkFnZW50ID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ29udGVudEdlbmVyYXRpb25BZ2VudCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdjb250ZW50LWdlbmVyYXRpb24tYWdlbnQuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKSwgLy8gTG9uZ2VyIHRpbWVvdXQgZm9yIEFJIHByb2Nlc3NpbmdcclxuICAgICAgbWVtb3J5U2l6ZTogNTEyLCAvLyBNb3JlIG1lbW9yeSBmb3IgY29udGVudCBwcm9jZXNzaW5nXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVVNFUl9UQUJMRV9OQU1FOiB1c2VyVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIENPTlRFTlRfVEFCTEVfTkFNRTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICAgIE9SQ0hFU1RSQVRPUl9RVUVVRV9VUkw6IGFnZW50UXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgQkVEUk9DS19BR0VOVF9JRDogJ1BMQUNFSE9MREVSX0FHRU5UX0lEJywgLy8gV2lsbCBiZSB1cGRhdGVkIGFmdGVyIGFnZW50IGNyZWF0aW9uXHJcbiAgICAgICAgQkVEUk9DS19BR0VOVF9BTElBU19JRDogJ1RTVEFMSUFTSUQnLCAvLyBEZWZhdWx0IHRlc3QgYWxpYXNcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0NvbnRlbnRHZW5lcmF0aW9uQWdlbnRETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWNvbnRlbnQtZ2VuZXJhdGlvbi1hZ2VudC1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBDb250ZW50IEdlbmVyYXRpb24gQWdlbnRcclxuICAgIHVzZXJUYWJsZS5ncmFudFJlYWREYXRhKGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgY29udGVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjb250ZW50R2VuZXJhdGlvbkFnZW50KTtcclxuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8oY29udGVudEdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBhZ2VudFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgXHJcbiAgICAvLyBHcmFudCBCZWRyb2NrIEFnZW50IHBlcm1pc3Npb25zXHJcbiAgICBjb250ZW50R2VuZXJhdGlvbkFnZW50LmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICdiZWRyb2NrOkludm9rZUFnZW50JyxcclxuICAgICAgICAnYmVkcm9jazpHZXRBZ2VudCcsXHJcbiAgICAgICAgJ2JlZHJvY2s6TGlzdEFnZW50cydcclxuICAgICAgXSxcclxuICAgICAgcmVzb3VyY2VzOiBbJyonXSwgLy8gV2lsbCBiZSByZXN0cmljdGVkIHRvIHNwZWNpZmljIGFnZW50IGFmdGVyIGNyZWF0aW9uXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gU1FTIGV2ZW50IHNvdXJjZSBtYXBwaW5ncyBmb3IgY29udGVudCBnZW5lcmF0aW9uIGFnZW50XHJcbiAgICBjb250ZW50R2VuZXJhdGlvbkFnZW50LmFkZEV2ZW50U291cmNlKG5ldyBldmVudHNvdXJjZXMuU3FzRXZlbnRTb3VyY2UoY29udGVudEdlbmVyYXRpb25RdWV1ZSwge1xyXG4gICAgICBiYXRjaFNpemU6IDEsIC8vIFByb2Nlc3Mgb25lIG1lc3NhZ2UgYXQgYSB0aW1lIGZvciBiZXR0ZXIgZXJyb3IgaGFuZGxpbmdcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIGltYWdlIGdlbmVyYXRpb24gYWdlbnRcclxuICAgIGNvbnN0IGltYWdlR2VuZXJhdGlvbkFnZW50ID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnSW1hZ2VHZW5lcmF0aW9uQWdlbnQnLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLCAvLyBMb25nZXIgdGltZW91dCBmb3IgaW1hZ2UgZ2VuZXJhdGlvblxyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsIC8vIE1vcmUgbWVtb3J5IGZvciBpbWFnZSBwcm9jZXNzaW5nXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBJTUFHRV9CVUNLRVQ6IGltYWdlQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgT1JDSEVTVFJBVE9SX1FVRVVFOiBhZ2VudFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIE9QRU5BSV9BUElfS0VZOiBwcm9jZXNzLmVudi5PUEVOQUlfQVBJX0tFWSB8fCAnJyxcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0ltYWdlR2VuZXJhdGlvbkFnZW50RExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1pbWFnZS1nZW5lcmF0aW9uLWFnZW50LWRscScsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIEltYWdlIEdlbmVyYXRpb24gQWdlbnRcclxuICAgIGNvbnRlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoaW1hZ2VHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgaW1hZ2VCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoaW1hZ2VHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgYWdlbnRRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhpbWFnZUdlbmVyYXRpb25BZ2VudCk7XHJcblxyXG4gICAgLy8gU1FTIGV2ZW50IHNvdXJjZSBtYXBwaW5ncyBmb3IgaW1hZ2UgZ2VuZXJhdGlvbiBhZ2VudFxyXG4gICAgaW1hZ2VHZW5lcmF0aW9uQWdlbnQuYWRkRXZlbnRTb3VyY2UobmV3IGV2ZW50c291cmNlcy5TcXNFdmVudFNvdXJjZShpbWFnZUdlbmVyYXRpb25RdWV1ZSwge1xyXG4gICAgICBiYXRjaFNpemU6IDEsIC8vIFByb2Nlc3Mgb25lIG1lc3NhZ2UgYXQgYSB0aW1lIGZvciBiZXR0ZXIgZXJyb3IgaGFuZGxpbmdcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIHJldmlzaW9uIHByb2Nlc3NpbmdcclxuICAgIGNvbnN0IHJldmlzaW9uUHJvY2Vzc29yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUmV2aXNpb25Qcm9jZXNzb3InLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAncmV2aXNpb24tcHJvY2Vzc29yLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIENPTlRFTlRfVEFCTEU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQUdFTlRfTUVTU0FHRVNfVEFCTEU6IGFnZW50TWVzc2FnZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQ09OVEVOVF9HRU5FUkFUSU9OX1FVRVVFOiBjb250ZW50R2VuZXJhdGlvblF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIElNQUdFX0dFTkVSQVRJT05fUVVFVUU6IGltYWdlR2VuZXJhdGlvblF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgIH0sXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnUmV2aXNpb25Qcm9jZXNzb3JETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLXJldmlzaW9uLXByb2Nlc3Nvci1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBSZXZpc2lvbiBQcm9jZXNzb3JcclxuICAgIGNvbnRlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocmV2aXNpb25Qcm9jZXNzb3IpO1xyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyZXZpc2lvblByb2Nlc3Nvcik7XHJcbiAgICBjb250ZW50R2VuZXJhdGlvblF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKHJldmlzaW9uUHJvY2Vzc29yKTtcclxuICAgIGltYWdlR2VuZXJhdGlvblF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKHJldmlzaW9uUHJvY2Vzc29yKTtcclxuXHJcbiAgICAvLyBTUVMgZXZlbnQgc291cmNlIG1hcHBpbmdzIGZvciBjb250ZW50IG9yY2hlc3RyYXRvclxyXG4gICAgY29udGVudE9yY2hlc3RyYXRvci5hZGRFdmVudFNvdXJjZShuZXcgZXZlbnRzb3VyY2VzLlNxc0V2ZW50U291cmNlKGFnZW50UXVldWUsIHtcclxuICAgICAgYmF0Y2hTaXplOiAxLCAvLyBQcm9jZXNzIG9uZSBtZXNzYWdlIGF0IGEgdGltZSBmb3IgYmV0dGVyIGVycm9yIGhhbmRsaW5nXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gQVBJIEdhdGV3YXkgd2l0aCBHaXRIdWIgUGFnZXMgb3B0aW1pemVkIENPUlNcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ0FwaScsIHtcclxuICAgICAgcmVzdEFwaU5hbWU6ICdBdXRvbWF0ZWQgQmxvZyBQb3N0ZXIgQVBJJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgZm9yIHRoZSBhdXRvbWF0ZWQgYmxvZyBwb3N0ZXIgc3lzdGVtJyxcclxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XHJcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBbXHJcbiAgICAgICAgICAnaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nLCAvLyBHaXRIdWIgUGFnZXMgb3JpZ2luXHJcbiAgICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDozMDAwJywgLy8gTG9jYWwgZGV2ZWxvcG1lbnRcclxuICAgICAgICAgICdodHRwOi8vbG9jYWxob3N0OjUxNzMnLCAvLyBWaXRlIGRldiBzZXJ2ZXJcclxuICAgICAgICBdLFxyXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnUE9TVCcsICdQVVQnLCAnREVMRVRFJywgJ09QVElPTlMnXSxcclxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnLFxyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nLFxyXG4gICAgICAgICAgJ1gtQW16LURhdGUnLFxyXG4gICAgICAgICAgJ1gtQXBpLUtleScsXHJcbiAgICAgICAgICAnWC1BbXotU2VjdXJpdHktVG9rZW4nLFxyXG4gICAgICAgICAgJ1gtUmVxdWVzdGVkLVdpdGgnLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgZGVwbG95T3B0aW9uczoge1xyXG4gICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxyXG4gICAgICAgIHRocm90dGxpbmdSYXRlTGltaXQ6IDEwMCxcclxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogMjAwLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYXBpSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhcGlIYW5kbGVyKTtcclxuICAgIGNvbnN0IGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihpbnB1dFByb2Nlc3Nvcik7XHJcblxyXG4gICAgLy8gUm9vdCBhbmQgZ2VuZXJhbCBBUEkgcm91dGVzXHJcbiAgICBhcGkucm9vdC5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gQVBJIHJlc291cmNlIGZvciBnZW5lcmFsIGVuZHBvaW50c1xyXG4gICAgY29uc3QgYXBpUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnYXBpJyk7XHJcbiAgICBhcGlSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gU3RhdHVzIGVuZHBvaW50XHJcbiAgICBjb25zdCBzdGF0dXNSZXNvdXJjZSA9IGFwaVJlc291cmNlLmFkZFJlc291cmNlKCdzdGF0dXMnKTtcclxuICAgIHN0YXR1c1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBDb250ZW50IGdlbmVyYXRpb24gZW5kcG9pbnRzXHJcbiAgICBjb25zdCBjb250ZW50UmVzb3VyY2UgPSBhcGlSZXNvdXJjZS5hZGRSZXNvdXJjZSgnY29udGVudCcpO1xyXG4gICAgXHJcbiAgICAvLyBHZW5lcmF0ZSBjb250ZW50IGVuZHBvaW50XHJcbiAgICBjb25zdCBnZW5lcmF0ZVJlc291cmNlID0gY29udGVudFJlc291cmNlLmFkZFJlc291cmNlKCdnZW5lcmF0ZScpO1xyXG4gICAgZ2VuZXJhdGVSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFJldmlzZSBjb250ZW50IGVuZHBvaW50XHJcbiAgICBjb25zdCByZXZpc2VSZXNvdXJjZSA9IGNvbnRlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZSgncmV2aXNlJyk7XHJcbiAgICByZXZpc2VSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIENvbnRlbnQgc3RhdHVzIGVuZHBvaW50XHJcbiAgICBjb25zdCBjb250ZW50U3RhdHVzUmVzb3VyY2UgPSBjb250ZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3N0YXR1cycpO1xyXG4gICAgY29uc3QgY29udGVudFN0YXR1c0lkUmVzb3VyY2UgPSBjb250ZW50U3RhdHVzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcclxuICAgIGNvbnRlbnRTdGF0dXNJZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBHZXQgY29udGVudCBlbmRwb2ludFxyXG4gICAgY29uc3QgY29udGVudElkUmVzb3VyY2UgPSBjb250ZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcclxuICAgIGNvbnRlbnRJZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBHZXQgY29udGVudCBtZXNzYWdlcyBlbmRwb2ludFxyXG4gICAgY29uc3QgY29udGVudE1lc3NhZ2VzUmVzb3VyY2UgPSBjb250ZW50SWRSZXNvdXJjZS5hZGRSZXNvdXJjZSgnbWVzc2FnZXMnKTtcclxuICAgIGNvbnRlbnRNZXNzYWdlc1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBWYWxpZGF0ZSBjb250ZW50IGVuZHBvaW50XHJcbiAgICBjb25zdCB2YWxpZGF0ZVJlc291cmNlID0gY29udGVudFJlc291cmNlLmFkZFJlc291cmNlKCd2YWxpZGF0ZScpO1xyXG4gICAgdmFsaWRhdGVSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEltYWdlIGdlbmVyYXRpb24gZW5kcG9pbnRzXHJcbiAgICBjb25zdCBpbWFnZVJlc291cmNlID0gYXBpUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2ltYWdlJyk7XHJcbiAgICBjb25zdCBpbWFnZUdlbmVyYXRpb25JbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGltYWdlR2VuZXJhdGlvbkFnZW50KTtcclxuICAgIFxyXG4gICAgLy8gR2VuZXJhdGUgaW1hZ2UgZW5kcG9pbnRcclxuICAgIGNvbnN0IGltYWdlR2VuZXJhdGVSZXNvdXJjZSA9IGltYWdlUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2dlbmVyYXRlJyk7XHJcbiAgICBpbWFnZUdlbmVyYXRlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgaW1hZ2VHZW5lcmF0aW9uSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBJbWFnZSBzdGF0dXMgZW5kcG9pbnRcclxuICAgIGNvbnN0IGltYWdlU3RhdHVzUmVzb3VyY2UgPSBpbWFnZVJlc291cmNlLmFkZFJlc291cmNlKCdzdGF0dXMnKTtcclxuICAgIGNvbnN0IGltYWdlU3RhdHVzSWRSZXNvdXJjZSA9IGltYWdlU3RhdHVzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcclxuICAgIGltYWdlU3RhdHVzSWRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gUmV2aXNlIGltYWdlIGVuZHBvaW50XHJcbiAgICBjb25zdCBpbWFnZVJldmlzZVJlc291cmNlID0gaW1hZ2VSZXNvdXJjZS5hZGRSZXNvdXJjZSgncmV2aXNlJyk7XHJcbiAgICBpbWFnZVJldmlzZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGltYWdlR2VuZXJhdGlvbkludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gQW5hbHl6ZSBjb250ZW50IGZvciBpbWFnZSBlbmRwb2ludFxyXG4gICAgY29uc3QgaW1hZ2VBbmFseXplUmVzb3VyY2UgPSBpbWFnZVJlc291cmNlLmFkZFJlc291cmNlKCdhbmFseXplJyk7XHJcbiAgICBpbWFnZUFuYWx5emVSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFJldmlzaW9uIHByb2Nlc3NpbmcgZW5kcG9pbnRzXHJcbiAgICBjb25zdCByZXZpc2lvblJlc291cmNlID0gYXBpUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3JldmlzaW9uJyk7XHJcbiAgICBjb25zdCByZXZpc2lvblByb2Nlc3NvckludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24ocmV2aXNpb25Qcm9jZXNzb3IpO1xyXG4gICAgXHJcbiAgICAvLyBDb250ZW50IHJldmlzaW9uIGVuZHBvaW50XHJcbiAgICBjb25zdCByZXZpc2lvbkNvbnRlbnRSZXNvdXJjZSA9IHJldmlzaW9uUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2NvbnRlbnQnKTtcclxuICAgIHJldmlzaW9uQ29udGVudFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIHJldmlzaW9uUHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBJbWFnZSByZXZpc2lvbiBlbmRwb2ludFxyXG4gICAgY29uc3QgcmV2aXNpb25JbWFnZVJlc291cmNlID0gcmV2aXNpb25SZXNvdXJjZS5hZGRSZXNvdXJjZSgnaW1hZ2UnKTtcclxuICAgIHJldmlzaW9uSW1hZ2VSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCByZXZpc2lvblByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gQmF0Y2ggcmV2aXNpb24gZW5kcG9pbnRcclxuICAgIGNvbnN0IHJldmlzaW9uQmF0Y2hSZXNvdXJjZSA9IHJldmlzaW9uUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2JhdGNoJyk7XHJcbiAgICByZXZpc2lvbkJhdGNoUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgcmV2aXNpb25Qcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFJldmlzaW9uIGhpc3RvcnkgZW5kcG9pbnRcclxuICAgIGNvbnN0IHJldmlzaW9uSGlzdG9yeVJlc291cmNlID0gcmV2aXNpb25SZXNvdXJjZS5hZGRSZXNvdXJjZSgnaGlzdG9yeScpO1xyXG4gICAgY29uc3QgcmV2aXNpb25IaXN0b3J5SWRSZXNvdXJjZSA9IHJldmlzaW9uSGlzdG9yeVJlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XHJcbiAgICByZXZpc2lvbkhpc3RvcnlJZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgcmV2aXNpb25Qcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIElucHV0IHByb2Nlc3NpbmcgZW5kcG9pbnRzXHJcbiAgICBjb25zdCBpbnB1dFJlc291cmNlID0gYXBpUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2lucHV0Jyk7XHJcbiAgICBcclxuICAgIC8vIEF1ZGlvIGlucHV0IGVuZHBvaW50XHJcbiAgICBjb25zdCBhdWRpb1Jlc291cmNlID0gaW5wdXRSZXNvdXJjZS5hZGRSZXNvdXJjZSgnYXVkaW8nKTtcclxuICAgIGF1ZGlvUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgaW5wdXRQcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFRleHQgaW5wdXQgZW5kcG9pbnRcclxuICAgIGNvbnN0IHRleHRSZXNvdXJjZSA9IGlucHV0UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3RleHQnKTtcclxuICAgIHRleHRSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBpbnB1dFByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gU3RhdHVzIGNoZWNraW5nIGVuZHBvaW50XHJcbiAgICBjb25zdCBpbnB1dFN0YXR1c1Jlc291cmNlID0gaW5wdXRSZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhdHVzJyk7XHJcbiAgICBjb25zdCBpbnB1dFN0YXR1c0lkUmVzb3VyY2UgPSBpbnB1dFN0YXR1c1Jlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XHJcbiAgICBpbnB1dFN0YXR1c0lkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBpbnB1dFByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gVHJhbnNjcmlwdGlvbiBjYWxsYmFjayBlbmRwb2ludFxyXG4gICAgY29uc3QgdHJhbnNjcmlwdGlvbkNhbGxiYWNrUmVzb3VyY2UgPSBpbnB1dFJlc291cmNlLmFkZFJlc291cmNlKCd0cmFuc2NyaXB0aW9uLWNhbGxiYWNrJyk7XHJcbiAgICB0cmFuc2NyaXB0aW9uQ2FsbGJhY2tSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBpbnB1dFByb2Nlc3NvckludGVncmF0aW9uKTtcclxuXHJcbiAgICAvLyBDYXRjaC1hbGwgcHJveHkgZm9yIGFueSBvdGhlciByb3V0ZXMgKGhhbmRsZWQgYnkgYXBpSGFuZGxlcilcclxuICAgIGFwaS5yb290LmFkZFByb3h5KHtcclxuICAgICAgZGVmYXVsdEludGVncmF0aW9uOiBhcGlJbnRlZ3JhdGlvbixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dHNcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBhcGkudXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IFVSTCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29udGVudFRhYmxlTmFtZScsIHtcclxuICAgICAgdmFsdWU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgQ29udGVudCBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdXNlclRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBVc2VyIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0F1ZGlvQnVja2V0TmFtZScsIHtcclxuICAgICAgdmFsdWU6IGF1ZGlvQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgQXVkaW8gQnVja2V0IE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ltYWdlQnVja2V0TmFtZScsIHtcclxuICAgICAgdmFsdWU6IGltYWdlQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgSW1hZ2UgQnVja2V0IE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50TWVzc2FnZXNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBhZ2VudE1lc3NhZ2VzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIEFnZW50IE1lc3NhZ2VzIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50UXVldWVVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBhZ2VudFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1NRUyBBZ2VudCBRdWV1ZSBVUkwnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0V2ZW50QnVzTmFtZScsIHtcclxuICAgICAgdmFsdWU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdFdmVudEJyaWRnZSBFdmVudCBCdXMgTmFtZScsXHJcbiAgICB9KTtcclxuICB9XHJcbn0iXX0=