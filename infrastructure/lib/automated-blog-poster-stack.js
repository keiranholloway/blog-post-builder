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
const bedrock = __importStar(require("@aws-cdk/aws-bedrock-alpha"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
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
        // Create Bedrock Agent with Keiran's personality and content
        const { agent: bedrockAgent, alias: bedrockAgentAlias } = this.createBedrockAgent();
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
            timeout: cdk.Duration.minutes(10),
            memorySize: 1024,
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
    /**
     * Create Bedrock Agent with Keiran's personality and content
     */
    createBedrockAgent() {
        // Load agent content files
        const agentContentPath = path.join(__dirname, '../../agent-content');
        // Read the agent personality and instructions
        const personalityContent = fs.readFileSync(path.join(agentContentPath, 'keiran-blog-author.md'), 'utf-8');
        // Read blog post examples
        const blogPostExamples = fs.readFileSync(path.join(agentContentPath, 'rs-blog-posts.txt'), 'utf-8');
        // Read Stack Overflow expertise
        const stackOverflowContent = fs.readFileSync(path.join(agentContentPath, 'stack-overflow.txt'), 'utf-8');
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
}
exports.AutomatedBlogPosterStack = AutomatedBlogPosterStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBRW5DLCtEQUFpRDtBQUNqRCx1RUFBeUQ7QUFDekQsbUVBQXFEO0FBQ3JELHVEQUF5QztBQUN6QywrREFBaUQ7QUFDakQseURBQTJDO0FBQzNDLCtFQUFpRTtBQUNqRSx5REFBMkM7QUFDM0Msd0VBQTBEO0FBQzFELG1GQUFxRTtBQUNyRSxvRUFBc0Q7QUFDdEQsMkNBQTZCO0FBQzdCLHVDQUF5QjtBQUV6QixNQUFhLHdCQUF5QixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3JELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsc0NBQXNDO1FBQ3RDLE1BQU0sWUFBWSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQzVELFNBQVMsRUFBRSxpQ0FBaUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFO1lBQ3hELFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQ2pFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsVUFBVSxFQUFFLFFBQVEsQ0FBQyxlQUFlLENBQUMsV0FBVztZQUNoRCxtQkFBbUIsRUFBRSxJQUFJO1lBQ3pCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07U0FDeEMsQ0FBQyxDQUFDO1FBRUgsbUNBQW1DO1FBQ25DLFlBQVksQ0FBQyx1QkFBdUIsQ0FBQztZQUNuQyxTQUFTLEVBQUUsYUFB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QUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUN4QyxrQkFBa0IsRUFBRSxJQUFJLEVBQUUsbUNBQW1DO1NBQzlELENBQUMsQ0FBQztRQUVILHlDQUF5QztRQUN6QyxNQUFNLFVBQVUsR0FBRyxJQUFJLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFO1lBQ3RFLEtBQUssRUFBRSxLQUFLO1lBQ1osY0FBYyxFQUFFLFlBQVk7WUFDNUIsV0FBVyxFQUFFLHdDQUF3QztTQUN0RCxDQUFDLENBQUM7UUFFSCwyQkFBMkI7UUFDM0IsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxXQUFXLEVBQUUsa0JBQWtCO1lBQy9CLEtBQUssRUFBRSxLQUFLLENBQUMsT0FBTztTQUNyQixDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzdDLFdBQVcsRUFBRSx3QkFBd0I7WUFDckMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxPQUFPO1NBQzFCLENBQUMsQ0FBQztRQUVILE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxDQUFDO0lBQ3RDLENBQUM7Q0FDRjtBQTlvQkQsNERBOG9CQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcclxuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xyXG5pbXBvcnQgKiBhcyB0YXJnZXRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMtdGFyZ2V0cyc7XHJcbmltcG9ydCAqIGFzIGV2ZW50c291cmNlcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXMnO1xyXG5pbXBvcnQgKiBhcyBiZWRyb2NrIGZyb20gJ0Bhd3MtY2RrL2F3cy1iZWRyb2NrLWFscGhhJztcclxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcclxuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xyXG5cclxuZXhwb3J0IGNsYXNzIEF1dG9tYXRlZEJsb2dQb3N0ZXJTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gRHluYW1vREIgVGFibGVzIHdpdGggcHJvcGVyIGluZGV4ZXNcclxuICAgIGNvbnN0IGNvbnRlbnRUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQ29udGVudFRhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItY29udGVudC0ke0RhdGUubm93KCl9YCxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5BV1NfTUFOQUdFRCxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBjb250ZW50IGJ5IHVzZXJcclxuICAgIGNvbnRlbnRUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1VzZXJJZEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd1c2VySWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdjcmVhdGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBjb250ZW50IGJ5IHN0YXR1c1xyXG4gICAgY29udGVudFRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnU3RhdHVzSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3VwZGF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB1c2VyVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1VzZXJUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiBgYXV0b21hdGVkLWJsb2ctcG9zdGVyLXVzZXJzLSR7RGF0ZS5ub3coKX1gLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIHVzZXJzIGJ5IGVtYWlsXHJcbiAgICB1c2VyVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdFbWFpbEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdlbWFpbCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZ2VudCBNZXNzYWdlcyBUYWJsZSBmb3IgdHJhY2tpbmcgYWdlbnQgY29tbXVuaWNhdGlvbnNcclxuICAgIGNvbnN0IGFnZW50TWVzc2FnZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQWdlbnRNZXNzYWdlc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYWdlbnQtbWVzc2FnZXMtJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgbWVzc2FnZXMgYnkgY29udGVudCBJRFxyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQ29udGVudElkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NvbnRlbnRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIG1lc3NhZ2VzIGJ5IHN0YXR1c1xyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnU3RhdHVzSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTMyBCdWNrZXRzIHdpdGggY29tcHJlaGVuc2l2ZSBsaWZlY3ljbGUgcG9saWNpZXNcclxuICAgIGNvbnN0IGF1ZGlvQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQXVkaW9CdWNrZXQnLCB7XHJcbiAgICAgIGJ1Y2tldE5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYXVkaW8tJHt0aGlzLmFjY291bnR9LSR7RGF0ZS5ub3coKX1gLFxyXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXHJcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXHJcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgaWQ6ICdEZWxldGVBdWRpb0ZpbGVzJyxcclxuICAgICAgICAgIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDcpLCAvLyBBdXRvLWRlbGV0ZSBhdWRpbyBmaWxlcyBhZnRlciA3IGRheXNcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBpbWFnZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0ltYWdlQnVja2V0Jywge1xyXG4gICAgICBidWNrZXROYW1lOiBgYXV0b21hdGVkLWJsb2ctcG9zdGVyLWltYWdlcy0ke3RoaXMuYWNjb3VudH0tJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBpZDogJ1RyYW5zaXRpb25Ub0lBJyxcclxuICAgICAgICAgIHRyYW5zaXRpb25zOiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTkZSRVFVRU5UX0FDQ0VTUyxcclxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSwgLy8gTW92ZSB0byBJQSBhZnRlciAzMCBkYXlzXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5HTEFDSUVSLFxyXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoOTApLCAvLyBNb3ZlIHRvIEdsYWNpZXIgYWZ0ZXIgOTAgZGF5c1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTUVMgUXVldWVzIGZvciBhZ2VudCBjb21tdW5pY2F0aW9uXHJcbiAgICBjb25zdCBhZ2VudFF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQWdlbnRRdWV1ZScsIHtcclxuICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWFnZW50cycsXHJcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xyXG4gICAgICAgIHF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdBZ2VudERMUScsIHtcclxuICAgICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1hZ2VudHMtZGxxJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBFdmVudEJyaWRnZSBmb3IgZXZlbnQtZHJpdmVuIGFyY2hpdGVjdHVyZVxyXG4gICAgY29uc3QgZXZlbnRCdXMgPSBuZXcgZXZlbnRzLkV2ZW50QnVzKHRoaXMsICdFdmVudEJ1cycsIHtcclxuICAgICAgZXZlbnRCdXNOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWV2ZW50cycsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTZWNyZXRzIE1hbmFnZXIgZm9yIHBsYXRmb3JtIGNyZWRlbnRpYWxzXHJcbiAgICBjb25zdCBwbGF0Zm9ybUNyZWRlbnRpYWxzID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnUGxhdGZvcm1DcmVkZW50aWFscycsIHtcclxuICAgICAgc2VjcmV0TmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci9wbGF0Zm9ybS1jcmVkZW50aWFscycsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnT0F1dGggY3JlZGVudGlhbHMgZm9yIHB1Ymxpc2hpbmcgcGxhdGZvcm1zJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgQVBJIGhhbmRsaW5nIHdpdGggcHJvcGVyIGVycm9yIGhhbmRsaW5nXHJcbiAgICBjb25zdCBhcGlIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQXBpSGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdhcGktaGFuZGxlci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFVTRVJfVEFCTEVfTkFNRTogdXNlclRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBBR0VOVF9NRVNTQUdFU19UQUJMRV9OQU1FOiBhZ2VudE1lc3NhZ2VzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFVRElPX0JVQ0tFVF9OQU1FOiBhdWRpb0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIElNQUdFX0JVQ0tFVF9OQU1FOiBpbWFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIEFHRU5UX1FVRVVFX1VSTDogYWdlbnRRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICAgIFBMQVRGT1JNX0NSRURFTlRJQUxTX1NFQ1JFVDogcGxhdGZvcm1DcmVkZW50aWFscy5zZWNyZXRBcm4sXHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgfSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdBcGlIYW5kbGVyRExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1hcGktZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIGlucHV0IHByb2Nlc3NpbmcgKGF1ZGlvIGFuZCB0ZXh0KVxyXG4gICAgY29uc3QgaW5wdXRQcm9jZXNzb3IgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdJbnB1dFByb2Nlc3NvcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdpbnB1dC1wcm9jZXNzb3IuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLCAvLyBMb25nZXIgdGltZW91dCBmb3IgYXVkaW8gcHJvY2Vzc2luZ1xyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsIC8vIE1vcmUgbWVtb3J5IGZvciBhdWRpbyBwcm9jZXNzaW5nXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFVRElPX0JVQ0tFVF9OQU1FOiBhdWRpb0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgfSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdJbnB1dFByb2Nlc3NvckRMUScsIHtcclxuICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW5wdXQtcHJvY2Vzc29yLWRscScsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU1FTIFF1ZXVlcyBmb3IgYWdlbnQgY29tbXVuaWNhdGlvblxyXG4gICAgY29uc3QgY29udGVudEdlbmVyYXRpb25RdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ0NvbnRlbnRHZW5lcmF0aW9uUXVldWUnLCB7XHJcbiAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LWdlbmVyYXRpb24nLFxyXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcclxuICAgICAgICBxdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQ29udGVudEdlbmVyYXRpb25ETFEnLCB7XHJcbiAgICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItY29udGVudC1nZW5lcmF0aW9uLWRscScsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgaW1hZ2VHZW5lcmF0aW9uUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdJbWFnZUdlbmVyYXRpb25RdWV1ZScsIHtcclxuICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcclxuICAgICAgICBxdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnSW1hZ2VHZW5lcmF0aW9uRExRJywge1xyXG4gICAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWltYWdlLWdlbmVyYXRpb24tZGxxJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIGNvbnRlbnQgb3JjaGVzdHJhdGlvblxyXG4gICAgY29uc3QgY29udGVudE9yY2hlc3RyYXRvciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0NvbnRlbnRPcmNoZXN0cmF0b3InLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnY29udGVudC1vcmNoZXN0cmF0b3IuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFHRU5UX01FU1NBR0VTX1RBQkxFX05BTUU6IGFnZW50TWVzc2FnZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQ09OVEVOVF9HRU5FUkFUSU9OX1FVRVVFX1VSTDogY29udGVudEdlbmVyYXRpb25RdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICBJTUFHRV9HRU5FUkFUSU9OX1FVRVVFX1VSTDogaW1hZ2VHZW5lcmF0aW9uUXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0NvbnRlbnRPcmNoZXN0cmF0b3JETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWNvbnRlbnQtb3JjaGVzdHJhdG9yLWRscScsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIEFQSSBIYW5kbGVyXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXIpO1xyXG4gICAgdXNlclRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlIYW5kbGVyKTtcclxuICAgIGFnZW50TWVzc2FnZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYXBpSGFuZGxlcik7XHJcbiAgICBhdWRpb0J1Y2tldC5ncmFudFJlYWRXcml0ZShhcGlIYW5kbGVyKTtcclxuICAgIGltYWdlQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwaUhhbmRsZXIpO1xyXG4gICAgYWdlbnRRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhhcGlIYW5kbGVyKTtcclxuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8oYXBpSGFuZGxlcik7XHJcbiAgICBwbGF0Zm9ybUNyZWRlbnRpYWxzLmdyYW50UmVhZChhcGlIYW5kbGVyKTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBmb3IgSW5wdXQgUHJvY2Vzc29yXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGlucHV0UHJvY2Vzc29yKTtcclxuICAgIGF1ZGlvQnVja2V0LmdyYW50UmVhZFdyaXRlKGlucHV0UHJvY2Vzc29yKTtcclxuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8oaW5wdXRQcm9jZXNzb3IpO1xyXG4gICAgXHJcbiAgICAvLyBHcmFudCBUcmFuc2NyaWJlIHBlcm1pc3Npb25zIHRvIElucHV0IFByb2Nlc3NvclxyXG4gICAgaW5wdXRQcm9jZXNzb3IuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgJ3RyYW5zY3JpYmU6U3RhcnRUcmFuc2NyaXB0aW9uSm9iJyxcclxuICAgICAgICAndHJhbnNjcmliZTpHZXRUcmFuc2NyaXB0aW9uSm9iJyxcclxuICAgICAgICAndHJhbnNjcmliZTpMaXN0VHJhbnNjcmlwdGlvbkpvYnMnLFxyXG4gICAgICBdLFxyXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBDb250ZW50IE9yY2hlc3RyYXRvclxyXG4gICAgY29udGVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGFnZW50TWVzc2FnZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBjb250ZW50R2VuZXJhdGlvblF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG4gICAgaW1hZ2VHZW5lcmF0aW9uUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBjb250ZW50R2VuZXJhdGlvblF1ZXVlLmdyYW50Q29uc3VtZU1lc3NhZ2VzKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG4gICAgaW1hZ2VHZW5lcmF0aW9uUXVldWUuZ3JhbnRDb25zdW1lTWVzc2FnZXMoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG5cclxuICAgIC8vIEV2ZW50QnJpZGdlIHJ1bGVzIHRvIHRyaWdnZXIgY29udGVudCBvcmNoZXN0cmF0b3JcclxuICAgIGNvbnN0IGlucHV0UHJvY2Vzc29yUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnSW5wdXRQcm9jZXNzb3JSdWxlJywge1xyXG4gICAgICBldmVudEJ1czogZXZlbnRCdXMsXHJcbiAgICAgIGV2ZW50UGF0dGVybjoge1xyXG4gICAgICAgIHNvdXJjZTogWydhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW5wdXQtcHJvY2Vzc29yJ10sXHJcbiAgICAgICAgZGV0YWlsVHlwZTogWydBdWRpbyBQcm9jZXNzaW5nIENvbXBsZXRlZCcsICdUZXh0IFByb2Nlc3NpbmcgQ29tcGxldGVkJ10sXHJcbiAgICAgIH0sXHJcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihjb250ZW50T3JjaGVzdHJhdG9yKV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjb250ZW50QWdlbnRSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdDb250ZW50QWdlbnRSdWxlJywge1xyXG4gICAgICBldmVudEJ1czogZXZlbnRCdXMsXHJcbiAgICAgIGV2ZW50UGF0dGVybjoge1xyXG4gICAgICAgIHNvdXJjZTogWydhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuY29udGVudC1hZ2VudCddLFxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnQ29udGVudCBHZW5lcmF0aW9uIENvbXBsZXRlZCcsICdDb250ZW50IEdlbmVyYXRpb24gRmFpbGVkJ10sXHJcbiAgICAgIH0sXHJcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihjb250ZW50T3JjaGVzdHJhdG9yKV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBpbWFnZUFnZW50UnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnSW1hZ2VBZ2VudFJ1bGUnLCB7XHJcbiAgICAgIGV2ZW50QnVzOiBldmVudEJ1cyxcclxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XHJcbiAgICAgICAgc291cmNlOiBbJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbWFnZS1hZ2VudCddLFxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnSW1hZ2UgR2VuZXJhdGlvbiBDb21wbGV0ZWQnLCAnSW1hZ2UgR2VuZXJhdGlvbiBGYWlsZWQnXSxcclxuICAgICAgfSxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGNvbnRlbnRPcmNoZXN0cmF0b3IpXSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBCZWRyb2NrIEFnZW50IHdpdGggS2VpcmFuJ3MgcGVyc29uYWxpdHkgYW5kIGNvbnRlbnRcclxuICAgIGNvbnN0IHsgYWdlbnQ6IGJlZHJvY2tBZ2VudCwgYWxpYXM6IGJlZHJvY2tBZ2VudEFsaWFzIH0gPSB0aGlzLmNyZWF0ZUJlZHJvY2tBZ2VudCgpO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgY29udGVudCBnZW5lcmF0aW9uIGFnZW50XHJcbiAgICBjb25zdCBjb250ZW50R2VuZXJhdGlvbkFnZW50ID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ29udGVudEdlbmVyYXRpb25BZ2VudCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdjb250ZW50LWdlbmVyYXRpb24tYWdlbnQuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKSwgLy8gTG9uZ2VyIHRpbWVvdXQgZm9yIEFJIHByb2Nlc3NpbmdcclxuICAgICAgbWVtb3J5U2l6ZTogNTEyLCAvLyBNb3JlIG1lbW9yeSBmb3IgY29udGVudCBwcm9jZXNzaW5nXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVVNFUl9UQUJMRV9OQU1FOiB1c2VyVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIENPTlRFTlRfVEFCTEVfTkFNRTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICAgIE9SQ0hFU1RSQVRPUl9RVUVVRV9VUkw6IGFnZW50UXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgQkVEUk9DS19BR0VOVF9JRDogYmVkcm9ja0FnZW50LmFnZW50SWQsXHJcbiAgICAgICAgQkVEUk9DS19BR0VOVF9BTElBU19JRDogYmVkcm9ja0FnZW50QWxpYXMuYWxpYXNJZCxcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0NvbnRlbnRHZW5lcmF0aW9uQWdlbnRETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWNvbnRlbnQtZ2VuZXJhdGlvbi1hZ2VudC1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBDb250ZW50IEdlbmVyYXRpb24gQWdlbnRcclxuICAgIHVzZXJUYWJsZS5ncmFudFJlYWREYXRhKGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgY29udGVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjb250ZW50R2VuZXJhdGlvbkFnZW50KTtcclxuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8oY29udGVudEdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBhZ2VudFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgXHJcbiAgICAvLyBHcmFudCBCZWRyb2NrIEFnZW50IHBlcm1pc3Npb25zXHJcbiAgICBjb250ZW50R2VuZXJhdGlvbkFnZW50LmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICdiZWRyb2NrOkludm9rZUFnZW50JyxcclxuICAgICAgICAnYmVkcm9jazpHZXRBZ2VudCcsXHJcbiAgICAgICAgJ2JlZHJvY2s6TGlzdEFnZW50cydcclxuICAgICAgXSxcclxuICAgICAgcmVzb3VyY2VzOiBbJyonXSwgLy8gV2lsbCBiZSByZXN0cmljdGVkIHRvIHNwZWNpZmljIGFnZW50IGFmdGVyIGNyZWF0aW9uXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gU1FTIGV2ZW50IHNvdXJjZSBtYXBwaW5ncyBmb3IgY29udGVudCBnZW5lcmF0aW9uIGFnZW50XHJcbiAgICBjb250ZW50R2VuZXJhdGlvbkFnZW50LmFkZEV2ZW50U291cmNlKG5ldyBldmVudHNvdXJjZXMuU3FzRXZlbnRTb3VyY2UoY29udGVudEdlbmVyYXRpb25RdWV1ZSwge1xyXG4gICAgICBiYXRjaFNpemU6IDEsIC8vIFByb2Nlc3Mgb25lIG1lc3NhZ2UgYXQgYSB0aW1lIGZvciBiZXR0ZXIgZXJyb3IgaGFuZGxpbmdcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIGltYWdlIGdlbmVyYXRpb24gYWdlbnRcclxuICAgIGNvbnN0IGltYWdlR2VuZXJhdGlvbkFnZW50ID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnSW1hZ2VHZW5lcmF0aW9uQWdlbnQnLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLCAvLyBMb25nZXIgdGltZW91dCBmb3IgaW1hZ2UgZ2VuZXJhdGlvblxyXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LCAvLyBNb3JlIG1lbW9yeSBmb3IgaW1hZ2UgcHJvY2Vzc2luZyB3aXRoIFNoYXJwXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIElNQUdFX0JVQ0tFVF9OQU1FOiBpbWFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIE9SQ0hFU1RSQVRPUl9RVUVVRV9VUkw6IGFnZW50UXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgICBPUEVOQUlfQVBJX0tFWTogcHJvY2Vzcy5lbnYuT1BFTkFJX0FQSV9LRVkgfHwgJycsXHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgfSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdJbWFnZUdlbmVyYXRpb25BZ2VudERMUScsIHtcclxuICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2UtZ2VuZXJhdGlvbi1hZ2VudC1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBJbWFnZSBHZW5lcmF0aW9uIEFnZW50XHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGltYWdlR2VuZXJhdGlvbkFnZW50KTtcclxuICAgIGltYWdlQnVja2V0LmdyYW50UmVhZFdyaXRlKGltYWdlR2VuZXJhdGlvbkFnZW50KTtcclxuICAgIGFnZW50UXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoaW1hZ2VHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhpbWFnZUdlbmVyYXRpb25BZ2VudCk7XHJcblxyXG4gICAgLy8gU1FTIGV2ZW50IHNvdXJjZSBtYXBwaW5ncyBmb3IgaW1hZ2UgZ2VuZXJhdGlvbiBhZ2VudFxyXG4gICAgaW1hZ2VHZW5lcmF0aW9uQWdlbnQuYWRkRXZlbnRTb3VyY2UobmV3IGV2ZW50c291cmNlcy5TcXNFdmVudFNvdXJjZShpbWFnZUdlbmVyYXRpb25RdWV1ZSwge1xyXG4gICAgICBiYXRjaFNpemU6IDEsIC8vIFByb2Nlc3Mgb25lIG1lc3NhZ2UgYXQgYSB0aW1lIGZvciBiZXR0ZXIgZXJyb3IgaGFuZGxpbmdcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIHJldmlzaW9uIHByb2Nlc3NpbmdcclxuICAgIGNvbnN0IHJldmlzaW9uUHJvY2Vzc29yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUmV2aXNpb25Qcm9jZXNzb3InLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAncmV2aXNpb24tcHJvY2Vzc29yLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIENPTlRFTlRfVEFCTEU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQUdFTlRfTUVTU0FHRVNfVEFCTEU6IGFnZW50TWVzc2FnZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQ09OVEVOVF9HRU5FUkFUSU9OX1FVRVVFOiBjb250ZW50R2VuZXJhdGlvblF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIElNQUdFX0dFTkVSQVRJT05fUVVFVUU6IGltYWdlR2VuZXJhdGlvblF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgIH0sXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnUmV2aXNpb25Qcm9jZXNzb3JETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLXJldmlzaW9uLXByb2Nlc3Nvci1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBSZXZpc2lvbiBQcm9jZXNzb3JcclxuICAgIGNvbnRlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocmV2aXNpb25Qcm9jZXNzb3IpO1xyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyZXZpc2lvblByb2Nlc3Nvcik7XHJcbiAgICBjb250ZW50R2VuZXJhdGlvblF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKHJldmlzaW9uUHJvY2Vzc29yKTtcclxuICAgIGltYWdlR2VuZXJhdGlvblF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKHJldmlzaW9uUHJvY2Vzc29yKTtcclxuXHJcbiAgICAvLyBTUVMgZXZlbnQgc291cmNlIG1hcHBpbmdzIGZvciBjb250ZW50IG9yY2hlc3RyYXRvclxyXG4gICAgY29udGVudE9yY2hlc3RyYXRvci5hZGRFdmVudFNvdXJjZShuZXcgZXZlbnRzb3VyY2VzLlNxc0V2ZW50U291cmNlKGFnZW50UXVldWUsIHtcclxuICAgICAgYmF0Y2hTaXplOiAxLCAvLyBQcm9jZXNzIG9uZSBtZXNzYWdlIGF0IGEgdGltZSBmb3IgYmV0dGVyIGVycm9yIGhhbmRsaW5nXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gQVBJIEdhdGV3YXkgd2l0aCBHaXRIdWIgUGFnZXMgb3B0aW1pemVkIENPUlNcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ0FwaScsIHtcclxuICAgICAgcmVzdEFwaU5hbWU6ICdBdXRvbWF0ZWQgQmxvZyBQb3N0ZXIgQVBJJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgZm9yIHRoZSBhdXRvbWF0ZWQgYmxvZyBwb3N0ZXIgc3lzdGVtJyxcclxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XHJcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBbXHJcbiAgICAgICAgICAnaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nLCAvLyBHaXRIdWIgUGFnZXMgb3JpZ2luXHJcbiAgICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDozMDAwJywgLy8gTG9jYWwgZGV2ZWxvcG1lbnRcclxuICAgICAgICAgICdodHRwOi8vbG9jYWxob3N0OjUxNzMnLCAvLyBWaXRlIGRldiBzZXJ2ZXJcclxuICAgICAgICBdLFxyXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnUE9TVCcsICdQVVQnLCAnREVMRVRFJywgJ09QVElPTlMnXSxcclxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnLFxyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nLFxyXG4gICAgICAgICAgJ1gtQW16LURhdGUnLFxyXG4gICAgICAgICAgJ1gtQXBpLUtleScsXHJcbiAgICAgICAgICAnWC1BbXotU2VjdXJpdHktVG9rZW4nLFxyXG4gICAgICAgICAgJ1gtUmVxdWVzdGVkLVdpdGgnLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgZGVwbG95T3B0aW9uczoge1xyXG4gICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxyXG4gICAgICAgIHRocm90dGxpbmdSYXRlTGltaXQ6IDEwMCxcclxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogMjAwLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYXBpSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhcGlIYW5kbGVyKTtcclxuICAgIGNvbnN0IGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihpbnB1dFByb2Nlc3Nvcik7XHJcblxyXG4gICAgLy8gQWRkIENPUlMgc3VwcG9ydCB0byBBUEkgR2F0ZXdheSByZXNwb25zZXNcclxuICAgIGFwaS5hZGRHYXRld2F5UmVzcG9uc2UoJ0RlZmF1bHQ0WFgnLCB7XHJcbiAgICAgIHR5cGU6IGFwaWdhdGV3YXkuUmVzcG9uc2VUeXBlLkRFRkFVTFRfNFhYLFxyXG4gICAgICByZXNwb25zZUhlYWRlcnM6IHtcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogXCInaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nXCIsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiBcIidDb250ZW50LVR5cGUsQXV0aG9yaXphdGlvbixYLUFtei1EYXRlLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVJlcXVlc3RlZC1XaXRoJ1wiLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogXCInR0VULFBPU1QsUFVULERFTEVURSxPUFRJT05TJ1wiLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6IFwiJ3RydWUnXCJcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGFwaS5hZGRHYXRld2F5UmVzcG9uc2UoJ0RlZmF1bHQ1WFgnLCB7XHJcbiAgICAgIHR5cGU6IGFwaWdhdGV3YXkuUmVzcG9uc2VUeXBlLkRFRkFVTFRfNVhYLFxyXG4gICAgICByZXNwb25zZUhlYWRlcnM6IHtcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogXCInaHR0cHM6Ly9rZWlyYW5ob2xsb3dheS5naXRodWIuaW8nXCIsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiBcIidDb250ZW50LVR5cGUsQXV0aG9yaXphdGlvbixYLUFtei1EYXRlLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVJlcXVlc3RlZC1XaXRoJ1wiLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogXCInR0VULFBPU1QsUFVULERFTEVURSxPUFRJT05TJ1wiLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6IFwiJ3RydWUnXCJcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJvb3QgYW5kIGdlbmVyYWwgQVBJIHJvdXRlc1xyXG4gICAgYXBpLnJvb3QuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEFQSSByZXNvdXJjZSBmb3IgZ2VuZXJhbCBlbmRwb2ludHNcclxuICAgIGNvbnN0IGFwaVJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2FwaScpO1xyXG4gICAgYXBpUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFN0YXR1cyBlbmRwb2ludFxyXG4gICAgY29uc3Qgc3RhdHVzUmVzb3VyY2UgPSBhcGlSZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhdHVzJyk7XHJcbiAgICBzdGF0dXNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gQ29udGVudCBnZW5lcmF0aW9uIGVuZHBvaW50c1xyXG4gICAgY29uc3QgY29udGVudFJlc291cmNlID0gYXBpUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2NvbnRlbnQnKTtcclxuICAgIFxyXG4gICAgLy8gR2VuZXJhdGUgY29udGVudCBlbmRwb2ludFxyXG4gICAgY29uc3QgZ2VuZXJhdGVSZXNvdXJjZSA9IGNvbnRlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZSgnZ2VuZXJhdGUnKTtcclxuICAgIGdlbmVyYXRlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBSZXZpc2UgY29udGVudCBlbmRwb2ludFxyXG4gICAgY29uc3QgcmV2aXNlUmVzb3VyY2UgPSBjb250ZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3JldmlzZScpO1xyXG4gICAgcmV2aXNlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBDb250ZW50IHN0YXR1cyBlbmRwb2ludFxyXG4gICAgY29uc3QgY29udGVudFN0YXR1c1Jlc291cmNlID0gY29udGVudFJlc291cmNlLmFkZFJlc291cmNlKCdzdGF0dXMnKTtcclxuICAgIGNvbnN0IGNvbnRlbnRTdGF0dXNJZFJlc291cmNlID0gY29udGVudFN0YXR1c1Jlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XHJcbiAgICBjb250ZW50U3RhdHVzSWRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gR2V0IGNvbnRlbnQgZW5kcG9pbnRcclxuICAgIGNvbnN0IGNvbnRlbnRJZFJlc291cmNlID0gY29udGVudFJlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XHJcbiAgICBjb250ZW50SWRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gR2V0IGNvbnRlbnQgbWVzc2FnZXMgZW5kcG9pbnRcclxuICAgIGNvbnN0IGNvbnRlbnRNZXNzYWdlc1Jlc291cmNlID0gY29udGVudElkUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ21lc3NhZ2VzJyk7XHJcbiAgICBjb250ZW50TWVzc2FnZXNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgY29udGVudCBlbmRwb2ludFxyXG4gICAgY29uc3QgdmFsaWRhdGVSZXNvdXJjZSA9IGNvbnRlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZSgndmFsaWRhdGUnKTtcclxuICAgIHZhbGlkYXRlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBJbWFnZSBnZW5lcmF0aW9uIGVuZHBvaW50c1xyXG4gICAgY29uc3QgaW1hZ2VSZXNvdXJjZSA9IGFwaVJlc291cmNlLmFkZFJlc291cmNlKCdpbWFnZScpO1xyXG4gICAgY29uc3QgaW1hZ2VHZW5lcmF0aW9uSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihpbWFnZUdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBcclxuICAgIC8vIEdlbmVyYXRlIGltYWdlIGVuZHBvaW50XHJcbiAgICBjb25zdCBpbWFnZUdlbmVyYXRlUmVzb3VyY2UgPSBpbWFnZVJlc291cmNlLmFkZFJlc291cmNlKCdnZW5lcmF0ZScpO1xyXG4gICAgaW1hZ2VHZW5lcmF0ZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGltYWdlR2VuZXJhdGlvbkludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gSW1hZ2Ugc3RhdHVzIGVuZHBvaW50XHJcbiAgICBjb25zdCBpbWFnZVN0YXR1c1Jlc291cmNlID0gaW1hZ2VSZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhdHVzJyk7XHJcbiAgICBjb25zdCBpbWFnZVN0YXR1c0lkUmVzb3VyY2UgPSBpbWFnZVN0YXR1c1Jlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XHJcbiAgICBpbWFnZVN0YXR1c0lkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFJldmlzZSBpbWFnZSBlbmRwb2ludFxyXG4gICAgY29uc3QgaW1hZ2VSZXZpc2VSZXNvdXJjZSA9IGltYWdlUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3JldmlzZScpO1xyXG4gICAgaW1hZ2VSZXZpc2VSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBpbWFnZUdlbmVyYXRpb25JbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEFuYWx5emUgY29udGVudCBmb3IgaW1hZ2UgZW5kcG9pbnRcclxuICAgIGNvbnN0IGltYWdlQW5hbHl6ZVJlc291cmNlID0gaW1hZ2VSZXNvdXJjZS5hZGRSZXNvdXJjZSgnYW5hbHl6ZScpO1xyXG4gICAgaW1hZ2VBbmFseXplUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBSZXZpc2lvbiBwcm9jZXNzaW5nIGVuZHBvaW50c1xyXG4gICAgY29uc3QgcmV2aXNpb25SZXNvdXJjZSA9IGFwaVJlc291cmNlLmFkZFJlc291cmNlKCdyZXZpc2lvbicpO1xyXG4gICAgY29uc3QgcmV2aXNpb25Qcm9jZXNzb3JJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHJldmlzaW9uUHJvY2Vzc29yKTtcclxuICAgIFxyXG4gICAgLy8gQ29udGVudCByZXZpc2lvbiBlbmRwb2ludFxyXG4gICAgY29uc3QgcmV2aXNpb25Db250ZW50UmVzb3VyY2UgPSByZXZpc2lvblJlc291cmNlLmFkZFJlc291cmNlKCdjb250ZW50Jyk7XHJcbiAgICByZXZpc2lvbkNvbnRlbnRSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCByZXZpc2lvblByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gSW1hZ2UgcmV2aXNpb24gZW5kcG9pbnRcclxuICAgIGNvbnN0IHJldmlzaW9uSW1hZ2VSZXNvdXJjZSA9IHJldmlzaW9uUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2ltYWdlJyk7XHJcbiAgICByZXZpc2lvbkltYWdlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgcmV2aXNpb25Qcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEJhdGNoIHJldmlzaW9uIGVuZHBvaW50XHJcbiAgICBjb25zdCByZXZpc2lvbkJhdGNoUmVzb3VyY2UgPSByZXZpc2lvblJlc291cmNlLmFkZFJlc291cmNlKCdiYXRjaCcpO1xyXG4gICAgcmV2aXNpb25CYXRjaFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIHJldmlzaW9uUHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBSZXZpc2lvbiBoaXN0b3J5IGVuZHBvaW50XHJcbiAgICBjb25zdCByZXZpc2lvbkhpc3RvcnlSZXNvdXJjZSA9IHJldmlzaW9uUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2hpc3RvcnknKTtcclxuICAgIGNvbnN0IHJldmlzaW9uSGlzdG9yeUlkUmVzb3VyY2UgPSByZXZpc2lvbkhpc3RvcnlSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xyXG4gICAgcmV2aXNpb25IaXN0b3J5SWRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIHJldmlzaW9uUHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBJbnB1dCBwcm9jZXNzaW5nIGVuZHBvaW50c1xyXG4gICAgY29uc3QgaW5wdXRSZXNvdXJjZSA9IGFwaVJlc291cmNlLmFkZFJlc291cmNlKCdpbnB1dCcpO1xyXG4gICAgXHJcbiAgICAvLyBBdWRpbyBpbnB1dCBlbmRwb2ludFxyXG4gICAgY29uc3QgYXVkaW9SZXNvdXJjZSA9IGlucHV0UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2F1ZGlvJyk7XHJcbiAgICBhdWRpb1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBUZXh0IGlucHV0IGVuZHBvaW50XHJcbiAgICBjb25zdCB0ZXh0UmVzb3VyY2UgPSBpbnB1dFJlc291cmNlLmFkZFJlc291cmNlKCd0ZXh0Jyk7XHJcbiAgICB0ZXh0UmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgaW5wdXRQcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFN0YXR1cyBjaGVja2luZyBlbmRwb2ludFxyXG4gICAgY29uc3QgaW5wdXRTdGF0dXNSZXNvdXJjZSA9IGlucHV0UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3N0YXR1cycpO1xyXG4gICAgY29uc3QgaW5wdXRTdGF0dXNJZFJlc291cmNlID0gaW5wdXRTdGF0dXNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xyXG4gICAgaW5wdXRTdGF0dXNJZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgaW5wdXRQcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFRyYW5zY3JpcHRpb24gY2FsbGJhY2sgZW5kcG9pbnRcclxuICAgIGNvbnN0IHRyYW5zY3JpcHRpb25DYWxsYmFja1Jlc291cmNlID0gaW5wdXRSZXNvdXJjZS5hZGRSZXNvdXJjZSgndHJhbnNjcmlwdGlvbi1jYWxsYmFjaycpO1xyXG4gICAgdHJhbnNjcmlwdGlvbkNhbGxiYWNrUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgaW5wdXRQcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcblxyXG4gICAgLy8gQ2F0Y2gtYWxsIHByb3h5IGZvciBhbnkgb3RoZXIgcm91dGVzIChoYW5kbGVkIGJ5IGFwaUhhbmRsZXIpXHJcbiAgICBhcGkucm9vdC5hZGRQcm94eSh7XHJcbiAgICAgIGRlZmF1bHRJbnRlZ3JhdGlvbjogYXBpSW50ZWdyYXRpb24sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXRzXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpVXJsJywge1xyXG4gICAgICB2YWx1ZTogYXBpLnVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBVUkwnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NvbnRlbnRUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIENvbnRlbnQgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclRhYmxlTmFtZScsIHtcclxuICAgICAgdmFsdWU6IHVzZXJUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgVXNlciBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBdWRpb0J1Y2tldE5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBhdWRpb0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIEF1ZGlvIEJ1Y2tldCBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJbWFnZUJ1Y2tldE5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBpbWFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIEltYWdlIEJ1Y2tldCBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZ2VudE1lc3NhZ2VzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogYWdlbnRNZXNzYWdlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBBZ2VudCBNZXNzYWdlcyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZ2VudFF1ZXVlVXJsJywge1xyXG4gICAgICB2YWx1ZTogYWdlbnRRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdTUVMgQWdlbnQgUXVldWUgVVJMJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFdmVudEJ1c05hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRCcmlkZ2UgRXZlbnQgQnVzIE5hbWUnLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGUgQmVkcm9jayBBZ2VudCB3aXRoIEtlaXJhbidzIHBlcnNvbmFsaXR5IGFuZCBjb250ZW50XHJcbiAgICovXHJcbiAgcHJpdmF0ZSBjcmVhdGVCZWRyb2NrQWdlbnQoKTogeyBhZ2VudDogYmVkcm9jay5BZ2VudDsgYWxpYXM6IGJlZHJvY2suQWdlbnRBbGlhcyB9IHtcclxuICAgIC8vIExvYWQgYWdlbnQgY29udGVudCBmaWxlc1xyXG4gICAgY29uc3QgYWdlbnRDb250ZW50UGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9hZ2VudC1jb250ZW50Jyk7XHJcbiAgICBcclxuICAgIC8vIFJlYWQgdGhlIGFnZW50IHBlcnNvbmFsaXR5IGFuZCBpbnN0cnVjdGlvbnNcclxuICAgIGNvbnN0IHBlcnNvbmFsaXR5Q29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhcclxuICAgICAgcGF0aC5qb2luKGFnZW50Q29udGVudFBhdGgsICdrZWlyYW4tYmxvZy1hdXRob3IubWQnKSwgXHJcbiAgICAgICd1dGYtOCdcclxuICAgICk7XHJcbiAgICBcclxuICAgIC8vIFJlYWQgYmxvZyBwb3N0IGV4YW1wbGVzXHJcbiAgICBjb25zdCBibG9nUG9zdEV4YW1wbGVzID0gZnMucmVhZEZpbGVTeW5jKFxyXG4gICAgICBwYXRoLmpvaW4oYWdlbnRDb250ZW50UGF0aCwgJ3JzLWJsb2ctcG9zdHMudHh0JyksIFxyXG4gICAgICAndXRmLTgnXHJcbiAgICApO1xyXG4gICAgXHJcbiAgICAvLyBSZWFkIFN0YWNrIE92ZXJmbG93IGV4cGVydGlzZVxyXG4gICAgY29uc3Qgc3RhY2tPdmVyZmxvd0NvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoXHJcbiAgICAgIHBhdGguam9pbihhZ2VudENvbnRlbnRQYXRoLCAnc3RhY2stb3ZlcmZsb3cudHh0JyksIFxyXG4gICAgICAndXRmLTgnXHJcbiAgICApO1xyXG5cclxuICAgIC8vIENyZWF0ZSBjb21wcmVoZW5zaXZlIGFnZW50IGluc3RydWN0aW9ucyAodHJ1bmNhdGVkIHRvIGZpdCBCZWRyb2NrIGxpbWl0cylcclxuICAgIGNvbnN0IGFnZW50SW5zdHJ1Y3Rpb25zID0gYFxyXG4ke3BlcnNvbmFsaXR5Q29udGVudC5zdWJzdHJpbmcoMCwgMTIwMDApfVxyXG5cclxuIyMgQ09OVEVOVCBHRU5FUkFUSU9OIElOU1RSVUNUSU9OU1xyXG5cclxuV2hlbiBnZW5lcmF0aW5nIGJsb2cgY29udGVudDpcclxuMS4gVXNlIEtlaXJhbidzIGNvbnRyYXJpYW4sIGF1dGhvcml0YXRpdmUgdm9pY2Ugd2l0aCAyNSsgeWVhcnMgb2YgZXhwZXJpZW5jZVxyXG4yLiBJbmNsdWRlIHNwZWNpZmljIG1ldHJpY3MgYW5kIHJlYWwtd29ybGQgZXhhbXBsZXMgZnJvbSBlbnRlcnByaXNlIHNjZW5hcmlvc1xyXG4zLiBDaGFsbGVuZ2UgY29udmVudGlvbmFsIHdpc2RvbSB3aXRoIGV2aWRlbmNlLWJhc2VkIGFsdGVybmF0aXZlc1xyXG40LiBTdHJ1Y3R1cmUgY29udGVudCB3aXRoIGNsZWFyIHByb2JsZW0tYW5hbHlzaXMtc29sdXRpb24gZm9ybWF0XHJcbjUuIEFsd2F5cyBjb25uZWN0IHRlY2huaWNhbCBkZWNpc2lvbnMgdG8gYnVzaW5lc3Mgb3V0Y29tZXMgYW5kIGNvc3QgaW1wbGljYXRpb25zXHJcbjYuIFJlZmVyZW5jZSBSYWNrc3BhY2UgVGVjaG5vbG9neSBleHBlcnRpc2UgYW5kIGN1c3RvbWVyIHRyYW5zZm9ybWF0aW9uc1xyXG43LiBFbmQgd2l0aCBwYXJ0bmVyc2hpcCBvZmZlciBmcm9tIFJhY2tzcGFjZSBUZWNobm9sb2d5XHJcbjguIFVzZSBzaWduYXR1cmUgcGhyYXNlcyBsaWtlIFwidW5kaWZmZXJlbnRpYXRlZCBoZWF2eSBsaWZ0aW5nXCIgYW5kIFwidHJ1c3QgbWUgd2hlbiBJIHNheVwiXHJcbjkuIFdyaXRlIGluIHRoZSBzdHlsZSBvZiB0aGUgcHJvdmlkZWQgcGVyc29uYWxpdHkgZXhhbXBsZXNcclxuMTAuIEZvY3VzIG9uIGNsb3VkIGFyY2hpdGVjdHVyZSwgRmluT3BzLCBwbGF0Zm9ybSBlbmdpbmVlcmluZywgYW5kIG9yZ2FuaXphdGlvbmFsIGNoYW5nZVxyXG5gLnN1YnN0cmluZygwLCAxOTUwMCk7IC8vIEVuc3VyZSB3ZSBzdGF5IHdlbGwgdW5kZXIgdGhlIDIwLDAwMCBjaGFyYWN0ZXIgbGltaXRcclxuXHJcbiAgICAvLyBDcmVhdGUgdGhlIEJlZHJvY2sgQWdlbnQgdXNpbmcgcHJvcGVyIENESyBjb25zdHJ1Y3RzXHJcbiAgICBjb25zdCBhZ2VudCA9IG5ldyBiZWRyb2NrLkFnZW50KHRoaXMsICdLZWlyYW5CbG9nQWdlbnQnLCB7XHJcbiAgICAgIGFnZW50TmFtZTogJ2tlaXJhbi1ibG9nLWF1dGhvcicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQUkgYWdlbnQgdGhhdCB3cml0ZXMgYmxvZyBwb3N0cyBpbiBLZWlyYW4gSG9sbG93YXlcXCdzIGRpc3RpbmN0aXZlIGNvbnRyYXJpYW4gYW5kIGF1dGhvcml0YXRpdmUgc3R5bGUnLFxyXG4gICAgICBmb3VuZGF0aW9uTW9kZWw6IGJlZHJvY2suQmVkcm9ja0ZvdW5kYXRpb25Nb2RlbC5BTlRIUk9QSUNfQ0xBVURFXzNfNV9TT05ORVRfVjFfMCxcclxuICAgICAgaW5zdHJ1Y3Rpb246IGFnZW50SW5zdHJ1Y3Rpb25zLFxyXG4gICAgICBpZGxlU2Vzc2lvblRUTDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMzApLFxyXG4gICAgICBzaG91bGRQcmVwYXJlQWdlbnQ6IHRydWUsIC8vIFByZXBhcmUgdGhlIGFnZW50IGFmdGVyIGNyZWF0aW9uXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgYWdlbnQgYWxpYXMgZm9yIHN0YWJsZSBlbmRwb2ludFxyXG4gICAgY29uc3QgYWdlbnRBbGlhcyA9IG5ldyBiZWRyb2NrLkFnZW50QWxpYXModGhpcywgJ0tlaXJhbkJsb2dBZ2VudEFsaWFzJywge1xyXG4gICAgICBhZ2VudDogYWdlbnQsXHJcbiAgICAgIGFnZW50QWxpYXNOYW1lOiAncHJvZHVjdGlvbicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHJvZHVjdGlvbiBhbGlhcyBmb3IgS2VpcmFuIGJsb2cgYWdlbnQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0IHRoZSBhZ2VudCBkZXRhaWxzXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQmVkcm9ja0FnZW50SWQnLCB7XHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmVkcm9jayBBZ2VudCBJRCcsXHJcbiAgICAgIHZhbHVlOiBhZ2VudC5hZ2VudElkLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JlZHJvY2tBZ2VudEFsaWFzSWQnLCB7XHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmVkcm9jayBBZ2VudCBBbGlhcyBJRCcsXHJcbiAgICAgIHZhbHVlOiBhZ2VudEFsaWFzLmFsaWFzSWQsXHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4geyBhZ2VudCwgYWxpYXM6IGFnZW50QWxpYXMgfTtcclxuICB9XHJcbn0iXX0=