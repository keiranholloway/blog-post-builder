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
        // CORS headers for manual configuration
        const corsHeaders = {
            'Access-Control-Allow-Origin': 'https://keiranholloway.github.io',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Credentials': 'true',
            'Vary': 'Origin'
        };
        // Add CORS support to API Gateway responses
        api.addGatewayResponse('Default4XX', {
            type: apigateway.ResponseType.DEFAULT_4XX,
            responseHeaders: corsHeaders,
        });
        api.addGatewayResponse('Default5XX', {
            type: apigateway.ResponseType.DEFAULT_5XX,
            responseHeaders: corsHeaders,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBRW5DLCtEQUFpRDtBQUNqRCx1RUFBeUQ7QUFDekQsbUVBQXFEO0FBQ3JELHVEQUF5QztBQUN6QywrREFBaUQ7QUFDakQseURBQTJDO0FBQzNDLCtFQUFpRTtBQUNqRSx5REFBMkM7QUFDM0Msd0VBQTBEO0FBQzFELG1GQUFxRTtBQUNyRSxvRUFBc0Q7QUFDdEQsMkNBQTZCO0FBQzdCLHVDQUF5QjtBQUV6QixNQUFhLHdCQUF5QixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3JELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsc0NBQXNDO1FBQ3RDLE1BQU0sWUFBWSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQzVELFNBQVMsRUFBRSxpQ0FBaUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFO1lBQ3hELFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQ2pFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsVUFBVSxFQUFFLFFBQVEsQ0FBQyxlQUFlLENBQUMsV0FBVztZQUNoRCxtQkFBbUIsRUFBRSxJQUFJO1lBQ3pCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07U0FDeEMsQ0FBQyxDQUFDO1FBRUgsbUNBQW1DO1FBQ25DLFlBQVksQ0FBQyx1QkFBdUIsQ0FBQztZQUNuQyxTQUFTLEVBQUUsYUFB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LFVBQVUsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDdEUsS0FBSyxFQUFFLEtBQUs7WUFDWixjQUFjLEVBQUUsWUFBWTtZQUM1QixXQUFXLEVBQUUsd0NBQXdDO1NBQ3RELENBQUMsQ0FBQztRQUVILDJCQUEyQjtRQUMzQixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLFdBQVcsRUFBRSxrQkFBa0I7WUFDL0IsS0FBSyxFQUFFLEtBQUssQ0FBQyxPQUFPO1NBQ3JCLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDN0MsV0FBVyxFQUFFLHdCQUF3QjtZQUNyQyxLQUFLLEVBQUUsVUFBVSxDQUFDLE9BQU87U0FDMUIsQ0FBQyxDQUFDO1FBRUgsT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLENBQUM7SUFDdEMsQ0FBQztDQUNGO0FBM29CRCw0REEyb0JDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XHJcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XHJcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcclxuaW1wb3J0ICogYXMgc3FzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnO1xyXG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcclxuaW1wb3J0ICogYXMgZXZlbnRzb3VyY2VzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlcyc7XHJcbmltcG9ydCAqIGFzIGJlZHJvY2sgZnJvbSAnQGF3cy1jZGsvYXdzLWJlZHJvY2stYWxwaGEnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcblxyXG5leHBvcnQgY2xhc3MgQXV0b21hdGVkQmxvZ1Bvc3RlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBEeW5hbW9EQiBUYWJsZXMgd2l0aCBwcm9wZXIgaW5kZXhlc1xyXG4gICAgY29uc3QgY29udGVudFRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDb250ZW50VGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LSR7RGF0ZS5ub3coKX1gLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIGNvbnRlbnQgYnkgdXNlclxyXG4gICAgY29udGVudFRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnVXNlcklkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIGNvbnRlbnQgYnkgc3RhdHVzXHJcbiAgICBjb250ZW50VGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdTdGF0dXNJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAndXBkYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHVzZXJUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVXNlclRhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItdXNlcnMtJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgdXNlcnMgYnkgZW1haWxcclxuICAgIHVzZXJUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0VtYWlsSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2VtYWlsJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFnZW50IE1lc3NhZ2VzIFRhYmxlIGZvciB0cmFja2luZyBhZ2VudCBjb21tdW5pY2F0aW9uc1xyXG4gICAgY29uc3QgYWdlbnRNZXNzYWdlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdBZ2VudE1lc3NhZ2VzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1hZ2VudC1tZXNzYWdlcy0ke0RhdGUubm93KCl9YCxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5BV1NfTUFOQUdFRCxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBtZXNzYWdlcyBieSBjb250ZW50IElEXHJcbiAgICBhZ2VudE1lc3NhZ2VzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdDb250ZW50SWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY29udGVudElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgbWVzc2FnZXMgYnkgc3RhdHVzXHJcbiAgICBhZ2VudE1lc3NhZ2VzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdTdGF0dXNJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFMzIEJ1Y2tldHMgd2l0aCBjb21wcmVoZW5zaXZlIGxpZmVjeWNsZSBwb2xpY2llc1xyXG4gICAgY29uc3QgYXVkaW9CdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdBdWRpb0J1Y2tldCcsIHtcclxuICAgICAgYnVja2V0TmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1hdWRpby0ke3RoaXMuYWNjb3VudH0tJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBpZDogJ0RlbGV0ZUF1ZGlvRmlsZXMnLFxyXG4gICAgICAgICAgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksIC8vIEF1dG8tZGVsZXRlIGF1ZGlvIGZpbGVzIGFmdGVyIDcgZGF5c1xyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGltYWdlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnSW1hZ2VCdWNrZXQnLCB7XHJcbiAgICAgIGJ1Y2tldE5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2VzLSR7dGhpcy5hY2NvdW50fS0ke0RhdGUubm93KCl9YCxcclxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxyXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGlkOiAnVHJhbnNpdGlvblRvSUEnLFxyXG4gICAgICAgICAgdHJhbnNpdGlvbnM6IFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLklORlJFUVVFTlRfQUNDRVNTLFxyXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoMzApLCAvLyBNb3ZlIHRvIElBIGFmdGVyIDMwIGRheXNcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXHJcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksIC8vIE1vdmUgdG8gR2xhY2llciBhZnRlciA5MCBkYXlzXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNRUyBRdWV1ZXMgZm9yIGFnZW50IGNvbW11bmljYXRpb25cclxuICAgIGNvbnN0IGFnZW50UXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdBZ2VudFF1ZXVlJywge1xyXG4gICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYWdlbnRzJyxcclxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiB7XHJcbiAgICAgICAgcXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0FnZW50RExRJywge1xyXG4gICAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWFnZW50cy1kbHEnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogMyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV2ZW50QnJpZGdlIGZvciBldmVudC1kcml2ZW4gYXJjaGl0ZWN0dXJlXHJcbiAgICBjb25zdCBldmVudEJ1cyA9IG5ldyBldmVudHMuRXZlbnRCdXModGhpcywgJ0V2ZW50QnVzJywge1xyXG4gICAgICBldmVudEJ1c05hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItZXZlbnRzJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNlY3JldHMgTWFuYWdlciBmb3IgcGxhdGZvcm0gY3JlZGVudGlhbHNcclxuICAgIGNvbnN0IHBsYXRmb3JtQ3JlZGVudGlhbHMgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdQbGF0Zm9ybUNyZWRlbnRpYWxzJywge1xyXG4gICAgICBzZWNyZXROYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyL3BsYXRmb3JtLWNyZWRlbnRpYWxzJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBjcmVkZW50aWFscyBmb3IgcHVibGlzaGluZyBwbGF0Zm9ybXMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGZvciBBUEkgaGFuZGxpbmcgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmdcclxuICAgIGNvbnN0IGFwaUhhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBcGlIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2FwaS1oYW5kbGVyLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFX05BTUU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgVVNFUl9UQUJMRV9OQU1FOiB1c2VyVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFHRU5UX01FU1NBR0VTX1RBQkxFX05BTUU6IGFnZW50TWVzc2FnZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQVVESU9fQlVDS0VUX05BTUU6IGF1ZGlvQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgSU1BR0VfQlVDS0VUX05BTUU6IGltYWdlQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgQUdFTlRfUVVFVUVfVVJMOiBhZ2VudFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgUExBVEZPUk1fQ1JFREVOVElBTFNfU0VDUkVUOiBwbGF0Zm9ybUNyZWRlbnRpYWxzLnNlY3JldEFybixcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0FwaUhhbmRsZXJETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWFwaS1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgaW5wdXQgcHJvY2Vzc2luZyAoYXVkaW8gYW5kIHRleHQpXHJcbiAgICBjb25zdCBpbnB1dFByb2Nlc3NvciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0lucHV0UHJvY2Vzc29yJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2lucHV0LXByb2Nlc3Nvci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksIC8vIExvbmdlciB0aW1lb3V0IGZvciBhdWRpbyBwcm9jZXNzaW5nXHJcbiAgICAgIG1lbW9yeVNpemU6IDUxMiwgLy8gTW9yZSBtZW1vcnkgZm9yIGF1ZGlvIHByb2Nlc3NpbmdcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFX05BTUU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQVVESU9fQlVDS0VUX05BTUU6IGF1ZGlvQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0lucHV0UHJvY2Vzc29yRExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1pbnB1dC1wcm9jZXNzb3ItZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTUVMgUXVldWVzIGZvciBhZ2VudCBjb21tdW5pY2F0aW9uXHJcbiAgICBjb25zdCBjb250ZW50R2VuZXJhdGlvblF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQ29udGVudEdlbmVyYXRpb25RdWV1ZScsIHtcclxuICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWNvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xyXG4gICAgICAgIHF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdDb250ZW50R2VuZXJhdGlvbkRMUScsIHtcclxuICAgICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LWdlbmVyYXRpb24tZGxxJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBpbWFnZUdlbmVyYXRpb25RdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ0ltYWdlR2VuZXJhdGlvblF1ZXVlJywge1xyXG4gICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2UtZ2VuZXJhdGlvbicsXHJcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxMCksXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xyXG4gICAgICAgIHF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdJbWFnZUdlbmVyYXRpb25ETFEnLCB7XHJcbiAgICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2UtZ2VuZXJhdGlvbi1kbHEnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogMyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgY29udGVudCBvcmNoZXN0cmF0aW9uXHJcbiAgICBjb25zdCBjb250ZW50T3JjaGVzdHJhdG9yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ29udGVudE9yY2hlc3RyYXRvcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdjb250ZW50LW9yY2hlc3RyYXRvci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFX05BTUU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQUdFTlRfTUVTU0FHRVNfVEFCTEVfTkFNRTogYWdlbnRNZXNzYWdlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBDT05URU5UX0dFTkVSQVRJT05fUVVFVUVfVVJMOiBjb250ZW50R2VuZXJhdGlvblF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIElNQUdFX0dFTkVSQVRJT05fUVVFVUVfVVJMOiBpbWFnZUdlbmVyYXRpb25RdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgIH0sXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQ29udGVudE9yY2hlc3RyYXRvckRMUScsIHtcclxuICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItY29udGVudC1vcmNoZXN0cmF0b3ItZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBmb3IgQVBJIEhhbmRsZXJcclxuICAgIGNvbnRlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYXBpSGFuZGxlcik7XHJcbiAgICB1c2VyVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXIpO1xyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlIYW5kbGVyKTtcclxuICAgIGF1ZGlvQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwaUhhbmRsZXIpO1xyXG4gICAgaW1hZ2VCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoYXBpSGFuZGxlcik7XHJcbiAgICBhZ2VudFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGFwaUhhbmRsZXIpO1xyXG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhhcGlIYW5kbGVyKTtcclxuICAgIHBsYXRmb3JtQ3JlZGVudGlhbHMuZ3JhbnRSZWFkKGFwaUhhbmRsZXIpO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBJbnB1dCBQcm9jZXNzb3JcclxuICAgIGNvbnRlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoaW5wdXRQcm9jZXNzb3IpO1xyXG4gICAgYXVkaW9CdWNrZXQuZ3JhbnRSZWFkV3JpdGUoaW5wdXRQcm9jZXNzb3IpO1xyXG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhpbnB1dFByb2Nlc3Nvcik7XHJcbiAgICBcclxuICAgIC8vIEdyYW50IFRyYW5zY3JpYmUgcGVybWlzc2lvbnMgdG8gSW5wdXQgUHJvY2Vzc29yXHJcbiAgICBpbnB1dFByb2Nlc3Nvci5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAndHJhbnNjcmliZTpTdGFydFRyYW5zY3JpcHRpb25Kb2InLFxyXG4gICAgICAgICd0cmFuc2NyaWJlOkdldFRyYW5zY3JpcHRpb25Kb2InLFxyXG4gICAgICAgICd0cmFuc2NyaWJlOkxpc3RUcmFuc2NyaXB0aW9uSm9icycsXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlc291cmNlczogWycqJ10sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIENvbnRlbnQgT3JjaGVzdHJhdG9yXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGNvbnRlbnRHZW5lcmF0aW9uUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBpbWFnZUdlbmVyYXRpb25RdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGNvbnRlbnRHZW5lcmF0aW9uUXVldWUuZ3JhbnRDb25zdW1lTWVzc2FnZXMoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBpbWFnZUdlbmVyYXRpb25RdWV1ZS5ncmFudENvbnN1bWVNZXNzYWdlcyhjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8oY29udGVudE9yY2hlc3RyYXRvcik7XHJcblxyXG4gICAgLy8gRXZlbnRCcmlkZ2UgcnVsZXMgdG8gdHJpZ2dlciBjb250ZW50IG9yY2hlc3RyYXRvclxyXG4gICAgY29uc3QgaW5wdXRQcm9jZXNzb3JSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdJbnB1dFByb2Nlc3NvclJ1bGUnLCB7XHJcbiAgICAgIGV2ZW50QnVzOiBldmVudEJ1cyxcclxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XHJcbiAgICAgICAgc291cmNlOiBbJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbnB1dC1wcm9jZXNzb3InXSxcclxuICAgICAgICBkZXRhaWxUeXBlOiBbJ0F1ZGlvIFByb2Nlc3NpbmcgQ29tcGxldGVkJywgJ1RleHQgUHJvY2Vzc2luZyBDb21wbGV0ZWQnXSxcclxuICAgICAgfSxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGNvbnRlbnRPcmNoZXN0cmF0b3IpXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbnRlbnRBZ2VudFJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0NvbnRlbnRBZ2VudFJ1bGUnLCB7XHJcbiAgICAgIGV2ZW50QnVzOiBldmVudEJ1cyxcclxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XHJcbiAgICAgICAgc291cmNlOiBbJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5jb250ZW50LWFnZW50J10sXHJcbiAgICAgICAgZGV0YWlsVHlwZTogWydDb250ZW50IEdlbmVyYXRpb24gQ29tcGxldGVkJywgJ0NvbnRlbnQgR2VuZXJhdGlvbiBGYWlsZWQnXSxcclxuICAgICAgfSxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGNvbnRlbnRPcmNoZXN0cmF0b3IpXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGltYWdlQWdlbnRSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdJbWFnZUFnZW50UnVsZScsIHtcclxuICAgICAgZXZlbnRCdXM6IGV2ZW50QnVzLFxyXG4gICAgICBldmVudFBhdHRlcm46IHtcclxuICAgICAgICBzb3VyY2U6IFsnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmltYWdlLWFnZW50J10sXHJcbiAgICAgICAgZGV0YWlsVHlwZTogWydJbWFnZSBHZW5lcmF0aW9uIENvbXBsZXRlZCcsICdJbWFnZSBHZW5lcmF0aW9uIEZhaWxlZCddLFxyXG4gICAgICB9LFxyXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24oY29udGVudE9yY2hlc3RyYXRvcildLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIEJlZHJvY2sgQWdlbnQgd2l0aCBLZWlyYW4ncyBwZXJzb25hbGl0eSBhbmQgY29udGVudFxyXG4gICAgY29uc3QgeyBhZ2VudDogYmVkcm9ja0FnZW50LCBhbGlhczogYmVkcm9ja0FnZW50QWxpYXMgfSA9IHRoaXMuY3JlYXRlQmVkcm9ja0FnZW50KCk7XHJcblxyXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGZvciBjb250ZW50IGdlbmVyYXRpb24gYWdlbnRcclxuICAgIGNvbnN0IGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdDb250ZW50R2VuZXJhdGlvbkFnZW50Jywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2NvbnRlbnQtZ2VuZXJhdGlvbi1hZ2VudC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLCAvLyBMb25nZXIgdGltZW91dCBmb3IgQUkgcHJvY2Vzc2luZ1xyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsIC8vIE1vcmUgbWVtb3J5IGZvciBjb250ZW50IHByb2Nlc3NpbmdcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBVU0VSX1RBQkxFX05BTUU6IHVzZXJUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgT1JDSEVTVFJBVE9SX1FVRVVFX1VSTDogYWdlbnRRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICBCRURST0NLX0FHRU5UX0lEOiBiZWRyb2NrQWdlbnQuYWdlbnRJZCxcclxuICAgICAgICBCRURST0NLX0FHRU5UX0FMSUFTX0lEOiBiZWRyb2NrQWdlbnRBbGlhcy5hbGlhc0lkLFxyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgIH0sXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQ29udGVudEdlbmVyYXRpb25BZ2VudERMUScsIHtcclxuICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItY29udGVudC1nZW5lcmF0aW9uLWFnZW50LWRscScsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIENvbnRlbnQgR2VuZXJhdGlvbiBBZ2VudFxyXG4gICAgdXNlclRhYmxlLmdyYW50UmVhZERhdGEoY29udGVudEdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhjb250ZW50R2VuZXJhdGlvbkFnZW50KTtcclxuICAgIGFnZW50UXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoY29udGVudEdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBcclxuICAgIC8vIEdyYW50IEJlZHJvY2sgQWdlbnQgcGVybWlzc2lvbnNcclxuICAgIGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlQWdlbnQnLFxyXG4gICAgICAgICdiZWRyb2NrOkdldEFnZW50JyxcclxuICAgICAgICAnYmVkcm9jazpMaXN0QWdlbnRzJ1xyXG4gICAgICBdLFxyXG4gICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBXaWxsIGJlIHJlc3RyaWN0ZWQgdG8gc3BlY2lmaWMgYWdlbnQgYWZ0ZXIgY3JlYXRpb25cclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBTUVMgZXZlbnQgc291cmNlIG1hcHBpbmdzIGZvciBjb250ZW50IGdlbmVyYXRpb24gYWdlbnRcclxuICAgIGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQuYWRkRXZlbnRTb3VyY2UobmV3IGV2ZW50c291cmNlcy5TcXNFdmVudFNvdXJjZShjb250ZW50R2VuZXJhdGlvblF1ZXVlLCB7XHJcbiAgICAgIGJhdGNoU2l6ZTogMSwgLy8gUHJvY2VzcyBvbmUgbWVzc2FnZSBhdCBhIHRpbWUgZm9yIGJldHRlciBlcnJvciBoYW5kbGluZ1xyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgaW1hZ2UgZ2VuZXJhdGlvbiBhZ2VudFxyXG4gICAgY29uc3QgaW1hZ2VHZW5lcmF0aW9uQWdlbnQgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdJbWFnZUdlbmVyYXRpb25BZ2VudCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdpbWFnZS1nZW5lcmF0aW9uLWFnZW50LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxMCksIC8vIExvbmdlciB0aW1lb3V0IGZvciBpbWFnZSBnZW5lcmF0aW9uXHJcbiAgICAgIG1lbW9yeVNpemU6IDUxMiwgLy8gTW9yZSBtZW1vcnkgZm9yIGltYWdlIHByb2Nlc3NpbmdcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIElNQUdFX0JVQ0tFVDogaW1hZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgICBPUkNIRVNUUkFUT1JfUVVFVUU6IGFnZW50UXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgT1BFTkFJX0FQSV9LRVk6IHByb2Nlc3MuZW52Lk9QRU5BSV9BUElfS0VZIHx8ICcnLFxyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgIH0sXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnSW1hZ2VHZW5lcmF0aW9uQWdlbnRETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWltYWdlLWdlbmVyYXRpb24tYWdlbnQtZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBmb3IgSW1hZ2UgR2VuZXJhdGlvbiBBZ2VudFxyXG4gICAgY29udGVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbWFnZUdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBpbWFnZUJ1Y2tldC5ncmFudFJlYWRXcml0ZShpbWFnZUdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBhZ2VudFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGltYWdlR2VuZXJhdGlvbkFnZW50KTtcclxuXHJcbiAgICAvLyBTUVMgZXZlbnQgc291cmNlIG1hcHBpbmdzIGZvciBpbWFnZSBnZW5lcmF0aW9uIGFnZW50XHJcbiAgICBpbWFnZUdlbmVyYXRpb25BZ2VudC5hZGRFdmVudFNvdXJjZShuZXcgZXZlbnRzb3VyY2VzLlNxc0V2ZW50U291cmNlKGltYWdlR2VuZXJhdGlvblF1ZXVlLCB7XHJcbiAgICAgIGJhdGNoU2l6ZTogMSwgLy8gUHJvY2VzcyBvbmUgbWVzc2FnZSBhdCBhIHRpbWUgZm9yIGJldHRlciBlcnJvciBoYW5kbGluZ1xyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgcmV2aXNpb24gcHJvY2Vzc2luZ1xyXG4gICAgY29uc3QgcmV2aXNpb25Qcm9jZXNzb3IgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdSZXZpc2lvblByb2Nlc3NvcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdyZXZpc2lvbi1wcm9jZXNzb3IuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBBR0VOVF9NRVNTQUdFU19UQUJMRTogYWdlbnRNZXNzYWdlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBDT05URU5UX0dFTkVSQVRJT05fUVVFVUU6IGNvbnRlbnRHZW5lcmF0aW9uUXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgSU1BR0VfR0VORVJBVElPTl9RVUVVRTogaW1hZ2VHZW5lcmF0aW9uUXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgfSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdSZXZpc2lvblByb2Nlc3NvckRMUScsIHtcclxuICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItcmV2aXNpb24tcHJvY2Vzc29yLWRscScsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIFJldmlzaW9uIFByb2Nlc3NvclxyXG4gICAgY29udGVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyZXZpc2lvblByb2Nlc3Nvcik7XHJcbiAgICBhZ2VudE1lc3NhZ2VzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJldmlzaW9uUHJvY2Vzc29yKTtcclxuICAgIGNvbnRlbnRHZW5lcmF0aW9uUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMocmV2aXNpb25Qcm9jZXNzb3IpO1xyXG4gICAgaW1hZ2VHZW5lcmF0aW9uUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMocmV2aXNpb25Qcm9jZXNzb3IpO1xyXG5cclxuICAgIC8vIFNRUyBldmVudCBzb3VyY2UgbWFwcGluZ3MgZm9yIGNvbnRlbnQgb3JjaGVzdHJhdG9yXHJcbiAgICBjb250ZW50T3JjaGVzdHJhdG9yLmFkZEV2ZW50U291cmNlKG5ldyBldmVudHNvdXJjZXMuU3FzRXZlbnRTb3VyY2UoYWdlbnRRdWV1ZSwge1xyXG4gICAgICBiYXRjaFNpemU6IDEsIC8vIFByb2Nlc3Mgb25lIG1lc3NhZ2UgYXQgYSB0aW1lIGZvciBiZXR0ZXIgZXJyb3IgaGFuZGxpbmdcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBBUEkgR2F0ZXdheSB3aXRoIEdpdEh1YiBQYWdlcyBvcHRpbWl6ZWQgQ09SU1xyXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQXBpJywge1xyXG4gICAgICByZXN0QXBpTmFtZTogJ0F1dG9tYXRlZCBCbG9nIFBvc3RlciBBUEknLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBmb3IgdGhlIGF1dG9tYXRlZCBibG9nIHBvc3RlciBzeXN0ZW0nLFxyXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcclxuICAgICAgICBhbGxvd09yaWdpbnM6IFtcclxuICAgICAgICAgICdodHRwczovL2tlaXJhbmhvbGxvd2F5LmdpdGh1Yi5pbycsIC8vIEdpdEh1YiBQYWdlcyBvcmlnaW5cclxuICAgICAgICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLCAvLyBMb2NhbCBkZXZlbG9wbWVudFxyXG4gICAgICAgICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycsIC8vIFZpdGUgZGV2IHNlcnZlclxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgYWxsb3dNZXRob2RzOiBbJ0dFVCcsICdQT1NUJywgJ1BVVCcsICdERUxFVEUnLCAnT1BUSU9OUyddLFxyXG4gICAgICAgIGFsbG93SGVhZGVyczogW1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZScsXHJcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbicsXHJcbiAgICAgICAgICAnWC1BbXotRGF0ZScsXHJcbiAgICAgICAgICAnWC1BcGktS2V5JyxcclxuICAgICAgICAgICdYLUFtei1TZWN1cml0eS1Ub2tlbicsXHJcbiAgICAgICAgICAnWC1SZXF1ZXN0ZWQtV2l0aCcsXHJcbiAgICAgICAgXSxcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XHJcbiAgICAgICAgc3RhZ2VOYW1lOiAncHJvZCcsXHJcbiAgICAgICAgdGhyb3R0bGluZ1JhdGVMaW1pdDogMTAwLFxyXG4gICAgICAgIHRocm90dGxpbmdCdXJzdExpbWl0OiAyMDAsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBhcGlJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGFwaUhhbmRsZXIpO1xyXG4gICAgY29uc3QgaW5wdXRQcm9jZXNzb3JJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGlucHV0UHJvY2Vzc29yKTtcclxuXHJcbiAgICAvLyBDT1JTIGhlYWRlcnMgZm9yIG1hbnVhbCBjb25maWd1cmF0aW9uXHJcbiAgICBjb25zdCBjb3JzSGVhZGVycyA9IHtcclxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICdodHRwczovL2tlaXJhbmhvbGxvd2F5LmdpdGh1Yi5pbycsXHJcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxBdXRob3JpemF0aW9uLFgtQW16LURhdGUsWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtUmVxdWVzdGVkLVdpdGgnLFxyXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsUE9TVCxQVVQsREVMRVRFLE9QVElPTlMnLFxyXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiAndHJ1ZScsXHJcbiAgICAgICdWYXJ5JzogJ09yaWdpbidcclxuICAgIH07XHJcblxyXG4gICAgLy8gQWRkIENPUlMgc3VwcG9ydCB0byBBUEkgR2F0ZXdheSByZXNwb25zZXNcclxuICAgIGFwaS5hZGRHYXRld2F5UmVzcG9uc2UoJ0RlZmF1bHQ0WFgnLCB7XHJcbiAgICAgIHR5cGU6IGFwaWdhdGV3YXkuUmVzcG9uc2VUeXBlLkRFRkFVTFRfNFhYLFxyXG4gICAgICByZXNwb25zZUhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgfSk7XHJcblxyXG4gICAgYXBpLmFkZEdhdGV3YXlSZXNwb25zZSgnRGVmYXVsdDVYWCcsIHtcclxuICAgICAgdHlwZTogYXBpZ2F0ZXdheS5SZXNwb25zZVR5cGUuREVGQVVMVF81WFgsXHJcbiAgICAgIHJlc3BvbnNlSGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSb290IGFuZCBnZW5lcmFsIEFQSSByb3V0ZXNcclxuICAgIGFwaS5yb290LmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBBUEkgcmVzb3VyY2UgZm9yIGdlbmVyYWwgZW5kcG9pbnRzXHJcbiAgICBjb25zdCBhcGlSZXNvdXJjZSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdhcGknKTtcclxuICAgIGFwaVJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBTdGF0dXMgZW5kcG9pbnRcclxuICAgIGNvbnN0IHN0YXR1c1Jlc291cmNlID0gYXBpUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3N0YXR1cycpO1xyXG4gICAgc3RhdHVzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIENvbnRlbnQgZ2VuZXJhdGlvbiBlbmRwb2ludHNcclxuICAgIGNvbnN0IGNvbnRlbnRSZXNvdXJjZSA9IGFwaVJlc291cmNlLmFkZFJlc291cmNlKCdjb250ZW50Jyk7XHJcbiAgICBcclxuICAgIC8vIEdlbmVyYXRlIGNvbnRlbnQgZW5kcG9pbnRcclxuICAgIGNvbnN0IGdlbmVyYXRlUmVzb3VyY2UgPSBjb250ZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2dlbmVyYXRlJyk7XHJcbiAgICBnZW5lcmF0ZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gUmV2aXNlIGNvbnRlbnQgZW5kcG9pbnRcclxuICAgIGNvbnN0IHJldmlzZVJlc291cmNlID0gY29udGVudFJlc291cmNlLmFkZFJlc291cmNlKCdyZXZpc2UnKTtcclxuICAgIHJldmlzZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gQ29udGVudCBzdGF0dXMgZW5kcG9pbnRcclxuICAgIGNvbnN0IGNvbnRlbnRTdGF0dXNSZXNvdXJjZSA9IGNvbnRlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhdHVzJyk7XHJcbiAgICBjb25zdCBjb250ZW50U3RhdHVzSWRSZXNvdXJjZSA9IGNvbnRlbnRTdGF0dXNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xyXG4gICAgY29udGVudFN0YXR1c0lkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEdldCBjb250ZW50IGVuZHBvaW50XHJcbiAgICBjb25zdCBjb250ZW50SWRSZXNvdXJjZSA9IGNvbnRlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xyXG4gICAgY29udGVudElkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEdldCBjb250ZW50IG1lc3NhZ2VzIGVuZHBvaW50XHJcbiAgICBjb25zdCBjb250ZW50TWVzc2FnZXNSZXNvdXJjZSA9IGNvbnRlbnRJZFJlc291cmNlLmFkZFJlc291cmNlKCdtZXNzYWdlcycpO1xyXG4gICAgY29udGVudE1lc3NhZ2VzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFZhbGlkYXRlIGNvbnRlbnQgZW5kcG9pbnRcclxuICAgIGNvbnN0IHZhbGlkYXRlUmVzb3VyY2UgPSBjb250ZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3ZhbGlkYXRlJyk7XHJcbiAgICB2YWxpZGF0ZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gSW1hZ2UgZ2VuZXJhdGlvbiBlbmRwb2ludHNcclxuICAgIGNvbnN0IGltYWdlUmVzb3VyY2UgPSBhcGlSZXNvdXJjZS5hZGRSZXNvdXJjZSgnaW1hZ2UnKTtcclxuICAgIGNvbnN0IGltYWdlR2VuZXJhdGlvbkludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oaW1hZ2VHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgXHJcbiAgICAvLyBHZW5lcmF0ZSBpbWFnZSBlbmRwb2ludFxyXG4gICAgY29uc3QgaW1hZ2VHZW5lcmF0ZVJlc291cmNlID0gaW1hZ2VSZXNvdXJjZS5hZGRSZXNvdXJjZSgnZ2VuZXJhdGUnKTtcclxuICAgIGltYWdlR2VuZXJhdGVSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBpbWFnZUdlbmVyYXRpb25JbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEltYWdlIHN0YXR1cyBlbmRwb2ludFxyXG4gICAgY29uc3QgaW1hZ2VTdGF0dXNSZXNvdXJjZSA9IGltYWdlUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3N0YXR1cycpO1xyXG4gICAgY29uc3QgaW1hZ2VTdGF0dXNJZFJlc291cmNlID0gaW1hZ2VTdGF0dXNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xyXG4gICAgaW1hZ2VTdGF0dXNJZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBSZXZpc2UgaW1hZ2UgZW5kcG9pbnRcclxuICAgIGNvbnN0IGltYWdlUmV2aXNlUmVzb3VyY2UgPSBpbWFnZVJlc291cmNlLmFkZFJlc291cmNlKCdyZXZpc2UnKTtcclxuICAgIGltYWdlUmV2aXNlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgaW1hZ2VHZW5lcmF0aW9uSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBBbmFseXplIGNvbnRlbnQgZm9yIGltYWdlIGVuZHBvaW50XHJcbiAgICBjb25zdCBpbWFnZUFuYWx5emVSZXNvdXJjZSA9IGltYWdlUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2FuYWx5emUnKTtcclxuICAgIGltYWdlQW5hbHl6ZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gUmV2aXNpb24gcHJvY2Vzc2luZyBlbmRwb2ludHNcclxuICAgIGNvbnN0IHJldmlzaW9uUmVzb3VyY2UgPSBhcGlSZXNvdXJjZS5hZGRSZXNvdXJjZSgncmV2aXNpb24nKTtcclxuICAgIGNvbnN0IHJldmlzaW9uUHJvY2Vzc29ySW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihyZXZpc2lvblByb2Nlc3Nvcik7XHJcbiAgICBcclxuICAgIC8vIENvbnRlbnQgcmV2aXNpb24gZW5kcG9pbnRcclxuICAgIGNvbnN0IHJldmlzaW9uQ29udGVudFJlc291cmNlID0gcmV2aXNpb25SZXNvdXJjZS5hZGRSZXNvdXJjZSgnY29udGVudCcpO1xyXG4gICAgcmV2aXNpb25Db250ZW50UmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgcmV2aXNpb25Qcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEltYWdlIHJldmlzaW9uIGVuZHBvaW50XHJcbiAgICBjb25zdCByZXZpc2lvbkltYWdlUmVzb3VyY2UgPSByZXZpc2lvblJlc291cmNlLmFkZFJlc291cmNlKCdpbWFnZScpO1xyXG4gICAgcmV2aXNpb25JbWFnZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIHJldmlzaW9uUHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBCYXRjaCByZXZpc2lvbiBlbmRwb2ludFxyXG4gICAgY29uc3QgcmV2aXNpb25CYXRjaFJlc291cmNlID0gcmV2aXNpb25SZXNvdXJjZS5hZGRSZXNvdXJjZSgnYmF0Y2gnKTtcclxuICAgIHJldmlzaW9uQmF0Y2hSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCByZXZpc2lvblByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gUmV2aXNpb24gaGlzdG9yeSBlbmRwb2ludFxyXG4gICAgY29uc3QgcmV2aXNpb25IaXN0b3J5UmVzb3VyY2UgPSByZXZpc2lvblJlc291cmNlLmFkZFJlc291cmNlKCdoaXN0b3J5Jyk7XHJcbiAgICBjb25zdCByZXZpc2lvbkhpc3RvcnlJZFJlc291cmNlID0gcmV2aXNpb25IaXN0b3J5UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcclxuICAgIHJldmlzaW9uSGlzdG9yeUlkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCByZXZpc2lvblByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gSW5wdXQgcHJvY2Vzc2luZyBlbmRwb2ludHNcclxuICAgIGNvbnN0IGlucHV0UmVzb3VyY2UgPSBhcGlSZXNvdXJjZS5hZGRSZXNvdXJjZSgnaW5wdXQnKTtcclxuICAgIFxyXG4gICAgLy8gQXVkaW8gaW5wdXQgZW5kcG9pbnRcclxuICAgIGNvbnN0IGF1ZGlvUmVzb3VyY2UgPSBpbnB1dFJlc291cmNlLmFkZFJlc291cmNlKCdhdWRpbycpO1xyXG4gICAgYXVkaW9SZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBpbnB1dFByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gVGV4dCBpbnB1dCBlbmRwb2ludFxyXG4gICAgY29uc3QgdGV4dFJlc291cmNlID0gaW5wdXRSZXNvdXJjZS5hZGRSZXNvdXJjZSgndGV4dCcpO1xyXG4gICAgdGV4dFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBTdGF0dXMgY2hlY2tpbmcgZW5kcG9pbnRcclxuICAgIGNvbnN0IGlucHV0U3RhdHVzUmVzb3VyY2UgPSBpbnB1dFJlc291cmNlLmFkZFJlc291cmNlKCdzdGF0dXMnKTtcclxuICAgIGNvbnN0IGlucHV0U3RhdHVzSWRSZXNvdXJjZSA9IGlucHV0U3RhdHVzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcclxuICAgIGlucHV0U3RhdHVzSWRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBUcmFuc2NyaXB0aW9uIGNhbGxiYWNrIGVuZHBvaW50XHJcbiAgICBjb25zdCB0cmFuc2NyaXB0aW9uQ2FsbGJhY2tSZXNvdXJjZSA9IGlucHV0UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3RyYW5zY3JpcHRpb24tY2FsbGJhY2snKTtcclxuICAgIHRyYW5zY3JpcHRpb25DYWxsYmFja1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG5cclxuICAgIC8vIENhdGNoLWFsbCBwcm94eSBmb3IgYW55IG90aGVyIHJvdXRlcyAoaGFuZGxlZCBieSBhcGlIYW5kbGVyKVxyXG4gICAgYXBpLnJvb3QuYWRkUHJveHkoe1xyXG4gICAgICBkZWZhdWx0SW50ZWdyYXRpb246IGFwaUludGVncmF0aW9uLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0c1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaVVybCcsIHtcclxuICAgICAgdmFsdWU6IGFwaS51cmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIEdhdGV3YXkgVVJMJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDb250ZW50VGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBDb250ZW50IFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB1c2VyVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFVzZXIgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXVkaW9CdWNrZXROYW1lJywge1xyXG4gICAgICB2YWx1ZTogYXVkaW9CdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdTMyBBdWRpbyBCdWNrZXQgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSW1hZ2VCdWNrZXROYW1lJywge1xyXG4gICAgICB2YWx1ZTogaW1hZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdTMyBJbWFnZSBCdWNrZXQgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWdlbnRNZXNzYWdlc1RhYmxlTmFtZScsIHtcclxuICAgICAgdmFsdWU6IGFnZW50TWVzc2FnZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgQWdlbnQgTWVzc2FnZXMgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWdlbnRRdWV1ZVVybCcsIHtcclxuICAgICAgdmFsdWU6IGFnZW50UXVldWUucXVldWVVcmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU1FTIEFnZW50IFF1ZXVlIFVSTCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRXZlbnRCdXNOYW1lJywge1xyXG4gICAgICB2YWx1ZTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0V2ZW50QnJpZGdlIEV2ZW50IEJ1cyBOYW1lJyxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlIEJlZHJvY2sgQWdlbnQgd2l0aCBLZWlyYW4ncyBwZXJzb25hbGl0eSBhbmQgY29udGVudFxyXG4gICAqL1xyXG4gIHByaXZhdGUgY3JlYXRlQmVkcm9ja0FnZW50KCk6IHsgYWdlbnQ6IGJlZHJvY2suQWdlbnQ7IGFsaWFzOiBiZWRyb2NrLkFnZW50QWxpYXMgfSB7XHJcbiAgICAvLyBMb2FkIGFnZW50IGNvbnRlbnQgZmlsZXNcclxuICAgIGNvbnN0IGFnZW50Q29udGVudFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYWdlbnQtY29udGVudCcpO1xyXG4gICAgXHJcbiAgICAvLyBSZWFkIHRoZSBhZ2VudCBwZXJzb25hbGl0eSBhbmQgaW5zdHJ1Y3Rpb25zXHJcbiAgICBjb25zdCBwZXJzb25hbGl0eUNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoXHJcbiAgICAgIHBhdGguam9pbihhZ2VudENvbnRlbnRQYXRoLCAna2VpcmFuLWJsb2ctYXV0aG9yLm1kJyksIFxyXG4gICAgICAndXRmLTgnXHJcbiAgICApO1xyXG4gICAgXHJcbiAgICAvLyBSZWFkIGJsb2cgcG9zdCBleGFtcGxlc1xyXG4gICAgY29uc3QgYmxvZ1Bvc3RFeGFtcGxlcyA9IGZzLnJlYWRGaWxlU3luYyhcclxuICAgICAgcGF0aC5qb2luKGFnZW50Q29udGVudFBhdGgsICdycy1ibG9nLXBvc3RzLnR4dCcpLCBcclxuICAgICAgJ3V0Zi04J1xyXG4gICAgKTtcclxuICAgIFxyXG4gICAgLy8gUmVhZCBTdGFjayBPdmVyZmxvdyBleHBlcnRpc2VcclxuICAgIGNvbnN0IHN0YWNrT3ZlcmZsb3dDb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKFxyXG4gICAgICBwYXRoLmpvaW4oYWdlbnRDb250ZW50UGF0aCwgJ3N0YWNrLW92ZXJmbG93LnR4dCcpLCBcclxuICAgICAgJ3V0Zi04J1xyXG4gICAgKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgY29tcHJlaGVuc2l2ZSBhZ2VudCBpbnN0cnVjdGlvbnMgKHRydW5jYXRlZCB0byBmaXQgQmVkcm9jayBsaW1pdHMpXHJcbiAgICBjb25zdCBhZ2VudEluc3RydWN0aW9ucyA9IGBcclxuJHtwZXJzb25hbGl0eUNvbnRlbnQuc3Vic3RyaW5nKDAsIDEyMDAwKX1cclxuXHJcbiMjIENPTlRFTlQgR0VORVJBVElPTiBJTlNUUlVDVElPTlNcclxuXHJcbldoZW4gZ2VuZXJhdGluZyBibG9nIGNvbnRlbnQ6XHJcbjEuIFVzZSBLZWlyYW4ncyBjb250cmFyaWFuLCBhdXRob3JpdGF0aXZlIHZvaWNlIHdpdGggMjUrIHllYXJzIG9mIGV4cGVyaWVuY2VcclxuMi4gSW5jbHVkZSBzcGVjaWZpYyBtZXRyaWNzIGFuZCByZWFsLXdvcmxkIGV4YW1wbGVzIGZyb20gZW50ZXJwcmlzZSBzY2VuYXJpb3NcclxuMy4gQ2hhbGxlbmdlIGNvbnZlbnRpb25hbCB3aXNkb20gd2l0aCBldmlkZW5jZS1iYXNlZCBhbHRlcm5hdGl2ZXNcclxuNC4gU3RydWN0dXJlIGNvbnRlbnQgd2l0aCBjbGVhciBwcm9ibGVtLWFuYWx5c2lzLXNvbHV0aW9uIGZvcm1hdFxyXG41LiBBbHdheXMgY29ubmVjdCB0ZWNobmljYWwgZGVjaXNpb25zIHRvIGJ1c2luZXNzIG91dGNvbWVzIGFuZCBjb3N0IGltcGxpY2F0aW9uc1xyXG42LiBSZWZlcmVuY2UgUmFja3NwYWNlIFRlY2hub2xvZ3kgZXhwZXJ0aXNlIGFuZCBjdXN0b21lciB0cmFuc2Zvcm1hdGlvbnNcclxuNy4gRW5kIHdpdGggcGFydG5lcnNoaXAgb2ZmZXIgZnJvbSBSYWNrc3BhY2UgVGVjaG5vbG9neVxyXG44LiBVc2Ugc2lnbmF0dXJlIHBocmFzZXMgbGlrZSBcInVuZGlmZmVyZW50aWF0ZWQgaGVhdnkgbGlmdGluZ1wiIGFuZCBcInRydXN0IG1lIHdoZW4gSSBzYXlcIlxyXG45LiBXcml0ZSBpbiB0aGUgc3R5bGUgb2YgdGhlIHByb3ZpZGVkIHBlcnNvbmFsaXR5IGV4YW1wbGVzXHJcbjEwLiBGb2N1cyBvbiBjbG91ZCBhcmNoaXRlY3R1cmUsIEZpbk9wcywgcGxhdGZvcm0gZW5naW5lZXJpbmcsIGFuZCBvcmdhbml6YXRpb25hbCBjaGFuZ2VcclxuYC5zdWJzdHJpbmcoMCwgMTk1MDApOyAvLyBFbnN1cmUgd2Ugc3RheSB3ZWxsIHVuZGVyIHRoZSAyMCwwMDAgY2hhcmFjdGVyIGxpbWl0XHJcblxyXG4gICAgLy8gQ3JlYXRlIHRoZSBCZWRyb2NrIEFnZW50IHVzaW5nIHByb3BlciBDREsgY29uc3RydWN0c1xyXG4gICAgY29uc3QgYWdlbnQgPSBuZXcgYmVkcm9jay5BZ2VudCh0aGlzLCAnS2VpcmFuQmxvZ0FnZW50Jywge1xyXG4gICAgICBhZ2VudE5hbWU6ICdrZWlyYW4tYmxvZy1hdXRob3InLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FJIGFnZW50IHRoYXQgd3JpdGVzIGJsb2cgcG9zdHMgaW4gS2VpcmFuIEhvbGxvd2F5XFwncyBkaXN0aW5jdGl2ZSBjb250cmFyaWFuIGFuZCBhdXRob3JpdGF0aXZlIHN0eWxlJyxcclxuICAgICAgZm91bmRhdGlvbk1vZGVsOiBiZWRyb2NrLkJlZHJvY2tGb3VuZGF0aW9uTW9kZWwuQU5USFJPUElDX0NMQVVERV8zXzVfU09OTkVUX1YxXzAsXHJcbiAgICAgIGluc3RydWN0aW9uOiBhZ2VudEluc3RydWN0aW9ucyxcclxuICAgICAgaWRsZVNlc3Npb25UVEw6IGNkay5EdXJhdGlvbi5taW51dGVzKDMwKSxcclxuICAgICAgc2hvdWxkUHJlcGFyZUFnZW50OiB0cnVlLCAvLyBQcmVwYXJlIHRoZSBhZ2VudCBhZnRlciBjcmVhdGlvblxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIGFnZW50IGFsaWFzIGZvciBzdGFibGUgZW5kcG9pbnRcclxuICAgIGNvbnN0IGFnZW50QWxpYXMgPSBuZXcgYmVkcm9jay5BZ2VudEFsaWFzKHRoaXMsICdLZWlyYW5CbG9nQWdlbnRBbGlhcycsIHtcclxuICAgICAgYWdlbnQ6IGFnZW50LFxyXG4gICAgICBhZ2VudEFsaWFzTmFtZTogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1Byb2R1Y3Rpb24gYWxpYXMgZm9yIEtlaXJhbiBibG9nIGFnZW50JyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dCB0aGUgYWdlbnQgZGV0YWlsc1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JlZHJvY2tBZ2VudElkJywge1xyXG4gICAgICBkZXNjcmlwdGlvbjogJ0JlZHJvY2sgQWdlbnQgSUQnLFxyXG4gICAgICB2YWx1ZTogYWdlbnQuYWdlbnRJZCxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCZWRyb2NrQWdlbnRBbGlhc0lkJywge1xyXG4gICAgICBkZXNjcmlwdGlvbjogJ0JlZHJvY2sgQWdlbnQgQWxpYXMgSUQnLFxyXG4gICAgICB2YWx1ZTogYWdlbnRBbGlhcy5hbGlhc0lkLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIHsgYWdlbnQsIGFsaWFzOiBhZ2VudEFsaWFzIH07XHJcbiAgfVxyXG59Il19