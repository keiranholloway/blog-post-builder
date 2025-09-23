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
const monitoring_stack_1 = require("./monitoring-stack");
const security_config_1 = require("./security-config");
class AutomatedBlogPosterStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        this.lambdaFunctions = [];
        this.tables = [];
        this.queues = [];
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
            timeToLiveAttribute: 'ttl',
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
            timeToLiveAttribute: 'ttl',
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
            timeout: cdk.Duration.minutes(15),
            memorySize: 512,
            environment: {
                CONTENT_TABLE_NAME: contentTable.tableName,
                AUDIT_TABLE_NAME: auditTable.tableName,
                TOKENS_TABLE_NAME: tokensTable.tableName,
                AUDIO_BUCKET_NAME: audioBucket.bucketName,
                IMAGE_BUCKET_NAME: imageBucket.bucketName,
                ALERT_TOPIC_ARN: '',
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
                hour: '2',
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
        const monitoringStack = new monitoring_stack_1.MonitoringStack(this, 'Monitoring', {
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
    setupProductionFeatures(environment, corsOrigin, lambdaFunctions) {
        // Store Lambda functions for monitoring
        this.lambdaFunctions = lambdaFunctions;
        // Apply production security if in production environment
        if (environment === 'production') {
            const securityConfig = new security_config_1.SecurityConfig(this, 'SecurityConfig', {
                api: this.api,
                lambdaFunctions: this.lambdaFunctions,
                environment,
            });
            const productionSecurity = new security_config_1.ProductionSecurity(this, 'ProductionSecurity', {
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
exports.AutomatedBlogPosterStack = AutomatedBlogPosterStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBRW5DLCtEQUFpRDtBQUNqRCx1RUFBeUQ7QUFDekQsbUVBQXFEO0FBQ3JELHVEQUF5QztBQUN6QywrREFBaUQ7QUFDakQseURBQTJDO0FBQzNDLCtFQUFpRTtBQUNqRSx5REFBMkM7QUFDM0Msd0VBQTBEO0FBQzFELG1GQUFxRTtBQUNyRSxvRUFBc0Q7QUFDdEQsMkNBQTZCO0FBQzdCLHVDQUF5QjtBQUN6Qix5REFBcUQ7QUFDckQsdURBQXVFO0FBUXZFLE1BQWEsd0JBQXlCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFNckQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFxQztRQUM3RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQU5WLG9CQUFlLEdBQXNCLEVBQUUsQ0FBQztRQUV4QyxXQUFNLEdBQXFCLEVBQUUsQ0FBQztRQUM5QixXQUFNLEdBQWdCLEVBQUUsQ0FBQztRQUt2QyxNQUFNLFdBQVcsR0FBRyxLQUFLLEVBQUUsV0FBVyxJQUFJLGFBQWEsQ0FBQztRQUV4RCxzQ0FBc0M7UUFDdEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDNUQsU0FBUyxFQUFFLGlDQUFpQyxJQUFJLENBQUMsR0FBRyxFQUFFLEVBQUU7WUFDeEQsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDakUsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZQUNqRCxVQUFVLEVBQUUsUUFBUSxD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LEdBQUcsQ0FBQyxHQUFHO1NBQ3BCLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3JDLFdBQVcsRUFBRSx3QkFBd0I7WUFDckMsS0FBSyxFQUFFLFdBQVc7U0FDbkIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxXQUFXLEtBQUssWUFBWSxFQUFFO1lBQ2hDLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO2dCQUNyQyxXQUFXLEVBQUUsY0FBYztnQkFDM0IsS0FBSyxFQUFFLFVBQVUsSUFBSSx3REFBd0Q7YUFDOUUsQ0FBQyxDQUFDO1NBQ0o7SUFDSCxDQUFDO0NBQ0Y7QUFuckNELDREQW1yQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcclxuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xyXG5pbXBvcnQgKiBhcyBzcXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNxcyc7XHJcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xyXG5pbXBvcnQgKiBhcyBldmVudHNvdXJjZXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzJztcclxuaW1wb3J0ICogYXMgYmVkcm9jayBmcm9tICdAYXdzLWNkay9hd3MtYmVkcm9jay1hbHBoYSc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0IHsgTW9uaXRvcmluZ1N0YWNrIH0gZnJvbSAnLi9tb25pdG9yaW5nLXN0YWNrJztcclxuaW1wb3J0IHsgU2VjdXJpdHlDb25maWcsIFByb2R1Y3Rpb25TZWN1cml0eSB9IGZyb20gJy4vc2VjdXJpdHktY29uZmlnJztcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgQXV0b21hdGVkQmxvZ1Bvc3RlclN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XHJcbiAgY29yc09yaWdpbj86IHN0cmluZztcclxuICBkb21haW5OYW1lPzogc3RyaW5nO1xyXG4gIGVudmlyb25tZW50Pzogc3RyaW5nO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgQXV0b21hdGVkQmxvZ1Bvc3RlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBwdWJsaWMgcmVhZG9ubHkgbGFtYmRhRnVuY3Rpb25zOiBsYW1iZGEuRnVuY3Rpb25bXSA9IFtdO1xyXG4gIHB1YmxpYyByZWFkb25seSBhcGk6IGFwaWdhdGV3YXkuUmVzdEFwaTtcclxuICBwdWJsaWMgcmVhZG9ubHkgdGFibGVzOiBkeW5hbW9kYi5UYWJsZVtdID0gW107XHJcbiAgcHVibGljIHJlYWRvbmx5IHF1ZXVlczogc3FzLlF1ZXVlW10gPSBbXTtcclxuXHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBBdXRvbWF0ZWRCbG9nUG9zdGVyU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgY29uc3QgZW52aXJvbm1lbnQgPSBwcm9wcz8uZW52aXJvbm1lbnQgfHwgJ2RldmVsb3BtZW50JztcclxuXHJcbiAgICAvLyBEeW5hbW9EQiBUYWJsZXMgd2l0aCBwcm9wZXIgaW5kZXhlc1xyXG4gICAgY29uc3QgY29udGVudFRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDb250ZW50VGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LSR7RGF0ZS5ub3coKX1gLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIGNvbnRlbnQgYnkgdXNlclxyXG4gICAgY29udGVudFRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnVXNlcklkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIGNvbnRlbnQgYnkgc3RhdHVzXHJcbiAgICBjb250ZW50VGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdTdGF0dXNJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAndXBkYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHVzZXJUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVXNlclRhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItdXNlcnMtJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgdXNlcnMgYnkgZW1haWxcclxuICAgIHVzZXJUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0VtYWlsSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2VtYWlsJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFnZW50IE1lc3NhZ2VzIFRhYmxlIGZvciB0cmFja2luZyBhZ2VudCBjb21tdW5pY2F0aW9uc1xyXG4gICAgY29uc3QgYWdlbnRNZXNzYWdlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdBZ2VudE1lc3NhZ2VzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1hZ2VudC1tZXNzYWdlcy0ke0RhdGUubm93KCl9YCxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5BV1NfTUFOQUdFRCxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUGxhdGZvcm0gQ29ubmVjdGlvbnMgVGFibGUgZm9yIE9BdXRoIGF1dGhlbnRpY2F0aW9uXHJcbiAgICBjb25zdCBwbGF0Zm9ybXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnUGxhdGZvcm1zVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1wbGF0Zm9ybXMtJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXNlcklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAncGxhdGZvcm0nLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE9BdXRoIFN0YXRlcyBUYWJsZSBmb3IgdGVtcG9yYXJ5IHN0YXRlIHN0b3JhZ2VcclxuICAgIGNvbnN0IG9hdXRoU3RhdGVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ09BdXRoU3RhdGVzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1vYXV0aC1zdGF0ZXMtJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdGUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6ICd0dGwnLCAvLyBBdXRvLWV4cGlyZSBPQXV0aCBzdGF0ZXMgYWZ0ZXIgMSBob3VyXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFB1Ymxpc2hpbmcgSm9icyBUYWJsZSBmb3IgdHJhY2tpbmcgaW5kaXZpZHVhbCBwbGF0Zm9ybSBwdWJsaXNoaW5nIGpvYnNcclxuICAgIGNvbnN0IHB1Ymxpc2hpbmdKb2JzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1B1Ymxpc2hpbmdKb2JzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1wdWJsaXNoaW5nLWpvYnMtJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgam9icyBieSBjb250ZW50IElEXHJcbiAgICBwdWJsaXNoaW5nSm9ic1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnQ29udGVudElkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NvbnRlbnRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIGpvYnMgYnkgc3RhdHVzXHJcbiAgICBwdWJsaXNoaW5nSm9ic1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnU3RhdHVzSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3VwZGF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBQdWJsaXNoaW5nIE9yY2hlc3RyYXRpb24gVGFibGUgZm9yIHRyYWNraW5nIG11bHRpLXBsYXRmb3JtIHB1Ymxpc2hpbmcgd29ya2Zsb3dzXHJcbiAgICBjb25zdCBwdWJsaXNoaW5nT3JjaGVzdHJhdGlvblRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdQdWJsaXNoaW5nT3JjaGVzdHJhdGlvblRhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItcHVibGlzaGluZy1vcmNoZXN0cmF0aW9uLSR7RGF0ZS5ub3coKX1gLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2pvYklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIG9yY2hlc3RyYXRpb24gYnkgY29udGVudCBJRFxyXG4gICAgcHVibGlzaGluZ09yY2hlc3RyYXRpb25UYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0NvbnRlbnRJZEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdjb250ZW50SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdjcmVhdGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBvcmNoZXN0cmF0aW9uIGJ5IHN0YXR1c1xyXG4gICAgcHVibGlzaGluZ09yY2hlc3RyYXRpb25UYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ1N0YXR1c0luZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzdGF0dXMnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICd1cGRhdGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBtZXNzYWdlcyBieSBjb250ZW50IElEXHJcbiAgICBhZ2VudE1lc3NhZ2VzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdDb250ZW50SWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY29udGVudElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgbWVzc2FnZXMgYnkgc3RhdHVzXHJcbiAgICBhZ2VudE1lc3NhZ2VzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdTdGF0dXNJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFMzIEJ1Y2tldHMgd2l0aCBjb21wcmVoZW5zaXZlIGxpZmVjeWNsZSBwb2xpY2llc1xyXG4gICAgY29uc3QgYXVkaW9CdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdBdWRpb0J1Y2tldCcsIHtcclxuICAgICAgYnVja2V0TmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1hdWRpby0ke3RoaXMuYWNjb3VudH0tJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBpZDogJ0RlbGV0ZUF1ZGlvRmlsZXMnLFxyXG4gICAgICAgICAgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksIC8vIEF1dG8tZGVsZXRlIGF1ZGlvIGZpbGVzIGFmdGVyIDcgZGF5c1xyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGltYWdlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnSW1hZ2VCdWNrZXQnLCB7XHJcbiAgICAgIGJ1Y2tldE5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2VzLSR7dGhpcy5hY2NvdW50fS0ke0RhdGUubm93KCl9YCxcclxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxyXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGlkOiAnVHJhbnNpdGlvblRvSUEnLFxyXG4gICAgICAgICAgdHJhbnNpdGlvbnM6IFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLklORlJFUVVFTlRfQUNDRVNTLFxyXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoMzApLCAvLyBNb3ZlIHRvIElBIGFmdGVyIDMwIGRheXNcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXHJcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksIC8vIE1vdmUgdG8gR2xhY2llciBhZnRlciA5MCBkYXlzXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNRUyBRdWV1ZXMgZm9yIGFnZW50IGNvbW11bmljYXRpb25cclxuICAgIGNvbnN0IGFnZW50UXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdBZ2VudFF1ZXVlJywge1xyXG4gICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYWdlbnRzJyxcclxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiB7XHJcbiAgICAgICAgcXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0FnZW50RExRJywge1xyXG4gICAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWFnZW50cy1kbHEnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogMyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV2ZW50QnJpZGdlIGZvciBldmVudC1kcml2ZW4gYXJjaGl0ZWN0dXJlXHJcbiAgICBjb25zdCBldmVudEJ1cyA9IG5ldyBldmVudHMuRXZlbnRCdXModGhpcywgJ0V2ZW50QnVzJywge1xyXG4gICAgICBldmVudEJ1c05hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItZXZlbnRzJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNlY3JldHMgTWFuYWdlciBmb3IgcGxhdGZvcm0gY3JlZGVudGlhbHNcclxuICAgIGNvbnN0IHBsYXRmb3JtQ3JlZGVudGlhbHMgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdQbGF0Zm9ybUNyZWRlbnRpYWxzJywge1xyXG4gICAgICBzZWNyZXROYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyL3BsYXRmb3JtLWNyZWRlbnRpYWxzJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBjcmVkZW50aWFscyBmb3IgcHVibGlzaGluZyBwbGF0Zm9ybXMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU2VjcmV0cyBNYW5hZ2VyIGZvciBzZWN1cml0eSBjb25maWd1cmF0aW9uXHJcbiAgICBjb25zdCBzZWN1cml0eUNvbmZpZyA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ1NlY3VyaXR5Q29uZmlnJywge1xyXG4gICAgICBzZWNyZXROYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyL3NlY3VyaXR5LWNvbmZpZycsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgY29uZmlndXJhdGlvbiBpbmNsdWRpbmcgSldUIHNlY3JldHMgYW5kIHBvbGljaWVzJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIER5bmFtb0RCIHRhYmxlIGZvciBKV1QgdG9rZW5zIChmb3IgcmV2b2NhdGlvbilcclxuICAgIGNvbnN0IHRva2Vuc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUb2tlbnNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiBgYXV0b21hdGVkLWJsb2ctcG9zdGVyLXRva2Vucy0ke0RhdGUubm93KCl9YCxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd0b2tlbklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxyXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAnZXhwaXJlc0F0JyxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyB0b2tlbnMgYnkgdXNlciBJRFxyXG4gICAgdG9rZW5zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdVc2VySWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXNlcklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIER5bmFtb0RCIHRhYmxlIGZvciBhdWRpdCBsb2dzXHJcbiAgICBjb25zdCBhdWRpdFRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdBdWRpdFRhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYXVkaXQtJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6ICd0dGwnLCAvLyBBdXRvLWV4cGlyZSBhdWRpdCBsb2dzIGFmdGVyIHJldGVudGlvbiBwZXJpb2RcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBhdWRpdCBsb2dzIGJ5IHVzZXIgSURcclxuICAgIGF1ZGl0VGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdVc2VySWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXNlcklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAndGltZXN0YW1wJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgYXVkaXQgbG9ncyBieSBldmVudCB0eXBlXHJcbiAgICBhdWRpdFRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnRXZlbnRUeXBlSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2V2ZW50VHlwZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3RpbWVzdGFtcCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIGF1ZGl0IGxvZ3MgYnkgc2V2ZXJpdHlcclxuICAgIGF1ZGl0VGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdTZXZlcml0eUluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzZXZlcml0eScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3RpbWVzdGFtcCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIGF1dGhlbnRpY2F0aW9uIGhhbmRsaW5nXHJcbiAgICBjb25zdCBhdXRoSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0F1dGhIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2F1dGgtaGFuZGxlci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgUExBVEZPUk1TX1RBQkxFOiBwbGF0Zm9ybXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgT0FVVEhfU1RBVEVTX1RBQkxFOiBvYXV0aFN0YXRlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBNRURJVU1fQ0xJRU5UX0lEOiBwcm9jZXNzLmVudi5NRURJVU1fQ0xJRU5UX0lEIHx8ICcnLFxyXG4gICAgICAgIE1FRElVTV9DTElFTlRfU0VDUkVUOiBwcm9jZXNzLmVudi5NRURJVU1fQ0xJRU5UX1NFQ1JFVCB8fCAnJyxcclxuICAgICAgICBNRURJVU1fUkVESVJFQ1RfVVJJOiBwcm9jZXNzLmVudi5NRURJVU1fUkVESVJFQ1RfVVJJIHx8ICcnLFxyXG4gICAgICAgIExJTktFRElOX0NMSUVOVF9JRDogcHJvY2Vzcy5lbnYuTElOS0VESU5fQ0xJRU5UX0lEIHx8ICcnLFxyXG4gICAgICAgIExJTktFRElOX0NMSUVOVF9TRUNSRVQ6IHByb2Nlc3MuZW52LkxJTktFRElOX0NMSUVOVF9TRUNSRVQgfHwgJycsXHJcbiAgICAgICAgTElOS0VESU5fUkVESVJFQ1RfVVJJOiBwcm9jZXNzLmVudi5MSU5LRURJTl9SRURJUkVDVF9VUkkgfHwgJycsXHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgfSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdBdXRoSGFuZGxlckRMUScsIHtcclxuICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYXV0aC1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgQVBJIGhhbmRsaW5nIHdpdGggcHJvcGVyIGVycm9yIGhhbmRsaW5nXHJcbiAgICBjb25zdCBhcGlIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQXBpSGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdhcGktaGFuZGxlci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OVEVOVF9UQUJMRV9OQU1FOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFVTRVJfVEFCTEVfTkFNRTogdXNlclRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBBR0VOVF9NRVNTQUdFU19UQUJMRV9OQU1FOiBhZ2VudE1lc3NhZ2VzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFBMQVRGT1JNU19UQUJMRV9OQU1FOiBwbGF0Zm9ybXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQVVESU9fQlVDS0VUX05BTUU6IGF1ZGlvQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgSU1BR0VfQlVDS0VUX05BTUU6IGltYWdlQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgQUdFTlRfUVVFVUVfVVJMOiBhZ2VudFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgUExBVEZPUk1fQ1JFREVOVElBTFNfU0VDUkVUOiBwbGF0Zm9ybUNyZWRlbnRpYWxzLnNlY3JldEFybixcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0FwaUhhbmRsZXJETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWFwaS1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgaW5wdXQgcHJvY2Vzc2luZyAoYXVkaW8gYW5kIHRleHQpXHJcbiAgICBjb25zdCBpbnB1dFByb2Nlc3NvciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0lucHV0UHJvY2Vzc29yJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2lucHV0LXByb2Nlc3Nvci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksIC8vIExvbmdlciB0aW1lb3V0IGZvciBhdWRpbyBwcm9jZXNzaW5nXHJcbiAgICAgIG1lbW9yeVNpemU6IDUxMiwgLy8gTW9yZSBtZW1vcnkgZm9yIGF1ZGlvIHByb2Nlc3NpbmdcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFX05BTUU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQVVESU9fQlVDS0VUX05BTUU6IGF1ZGlvQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0lucHV0UHJvY2Vzc29yRExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1pbnB1dC1wcm9jZXNzb3ItZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTUVMgUXVldWVzIGZvciBhZ2VudCBjb21tdW5pY2F0aW9uXHJcbiAgICBjb25zdCBjb250ZW50R2VuZXJhdGlvblF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQ29udGVudEdlbmVyYXRpb25RdWV1ZScsIHtcclxuICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWNvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xyXG4gICAgICAgIHF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdDb250ZW50R2VuZXJhdGlvbkRMUScsIHtcclxuICAgICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LWdlbmVyYXRpb24tZGxxJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBpbWFnZUdlbmVyYXRpb25RdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ0ltYWdlR2VuZXJhdGlvblF1ZXVlJywge1xyXG4gICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2UtZ2VuZXJhdGlvbicsXHJcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxMCksXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xyXG4gICAgICAgIHF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdJbWFnZUdlbmVyYXRpb25ETFEnLCB7XHJcbiAgICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2UtZ2VuZXJhdGlvbi1kbHEnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogMyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHB1Ymxpc2hpbmdRdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ1B1Ymxpc2hpbmdRdWV1ZScsIHtcclxuICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLXB1Ymxpc2hpbmcnLFxyXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcclxuICAgICAgICBxdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnUHVibGlzaGluZ0RMUScsIHtcclxuICAgICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1wdWJsaXNoaW5nLWRscScsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGZvciBjb250ZW50IG9yY2hlc3RyYXRpb25cclxuICAgIGNvbnN0IGNvbnRlbnRPcmNoZXN0cmF0b3IgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdDb250ZW50T3JjaGVzdHJhdG9yJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2NvbnRlbnQtb3JjaGVzdHJhdG9yLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIENPTlRFTlRfVEFCTEVfTkFNRTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBBR0VOVF9NRVNTQUdFU19UQUJMRV9OQU1FOiBhZ2VudE1lc3NhZ2VzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIENPTlRFTlRfR0VORVJBVElPTl9RVUVVRV9VUkw6IGNvbnRlbnRHZW5lcmF0aW9uUXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgSU1BR0VfR0VORVJBVElPTl9RVUVVRV9VUkw6IGltYWdlR2VuZXJhdGlvblF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgfSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdDb250ZW50T3JjaGVzdHJhdG9yRExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LW9yY2hlc3RyYXRvci1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgZGF0YSByZXRlbnRpb24gY2xlYW51cFxyXG4gICAgY29uc3QgZGF0YVJldGVudGlvbkNsZWFudXAgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdEYXRhUmV0ZW50aW9uQ2xlYW51cCcsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdkYXRhLXJldGVudGlvbi1jbGVhbnVwLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksIC8vIExvbmdlciB0aW1lb3V0IGZvciBjbGVhbnVwIG9wZXJhdGlvbnNcclxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIENPTlRFTlRfVEFCTEVfTkFNRTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBBVURJVF9UQUJMRV9OQU1FOiBhdWRpdFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBUT0tFTlNfVEFCTEVfTkFNRTogdG9rZW5zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFVRElPX0JVQ0tFVF9OQU1FOiBhdWRpb0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIElNQUdFX0JVQ0tFVF9OQU1FOiBpbWFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIEFMRVJUX1RPUElDX0FSTjogJycsIC8vIFdpbGwgYmUgc2V0IGFmdGVyIG1vbml0b3Jpbmcgc3RhY2sgY3JlYXRpb25cclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0RhdGFSZXRlbnRpb25DbGVhbnVwRExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1kYXRhLXJldGVudGlvbi1jbGVhbnVwLWRscScsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU2NoZWR1bGUgZGF0YSByZXRlbnRpb24gY2xlYW51cCB0byBydW4gZGFpbHlcclxuICAgIGNvbnN0IGNsZWFudXBSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdEYXRhUmV0ZW50aW9uQ2xlYW51cFJ1bGUnLCB7XHJcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7XHJcbiAgICAgICAgbWludXRlOiAnMCcsXHJcbiAgICAgICAgaG91cjogJzInLCAvLyBSdW4gYXQgMiBBTSBVVEMgZGFpbHlcclxuICAgICAgICBkYXk6ICcqJyxcclxuICAgICAgICBtb250aDogJyonLFxyXG4gICAgICAgIHllYXI6ICcqJyxcclxuICAgICAgfSksXHJcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihkYXRhUmV0ZW50aW9uQ2xlYW51cCldLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIEF1dGggSGFuZGxlclxyXG4gICAgcGxhdGZvcm1zVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGF1dGhIYW5kbGVyKTtcclxuICAgIG9hdXRoU3RhdGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGF1dGhIYW5kbGVyKTtcclxuICAgIHRva2Vuc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhdXRoSGFuZGxlcik7XHJcbiAgICBhdWRpdFRhYmxlLmdyYW50V3JpdGVEYXRhKGF1dGhIYW5kbGVyKTtcclxuICAgIFxyXG4gICAgLy8gR3JhbnQgU2VjcmV0cyBNYW5hZ2VyIHBlcm1pc3Npb25zIHRvIEF1dGggSGFuZGxlclxyXG4gICAgYXV0aEhhbmRsZXIuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkNyZWF0ZVNlY3JldCcsXHJcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOlVwZGF0ZVNlY3JldCcsXHJcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJyxcclxuICAgICAgICAnc2VjcmV0c21hbmFnZXI6RGVsZXRlU2VjcmV0JyxcclxuICAgICAgICAnc2VjcmV0c21hbmFnZXI6RGVzY3JpYmVTZWNyZXQnLFxyXG4gICAgICBdLFxyXG4gICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAnYXJuOmF3czpzZWNyZXRzbWFuYWdlcjoqOio6c2VjcmV0Om9hdXRoLWNyZWRlbnRpYWxzLyonLFxyXG4gICAgICAgICdhcm46YXdzOnNlY3JldHNtYW5hZ2VyOio6KjpzZWNyZXQ6YXV0b21hdGVkLWJsb2ctcG9zdGVyL3NlY3VyaXR5LWNvbmZpZyonLFxyXG4gICAgICBdLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBEYXRhIFJldGVudGlvbiBDbGVhbnVwXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGRhdGFSZXRlbnRpb25DbGVhbnVwKTtcclxuICAgIGF1ZGl0VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGRhdGFSZXRlbnRpb25DbGVhbnVwKTtcclxuICAgIHRva2Vuc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShkYXRhUmV0ZW50aW9uQ2xlYW51cCk7XHJcbiAgICBhdWRpb0J1Y2tldC5ncmFudFJlYWRXcml0ZShkYXRhUmV0ZW50aW9uQ2xlYW51cCk7XHJcbiAgICBpbWFnZUJ1Y2tldC5ncmFudFJlYWRXcml0ZShkYXRhUmV0ZW50aW9uQ2xlYW51cCk7XHJcblxyXG4gICAgLy8gQWRkIHNlY3VyaXR5LXJlbGF0ZWQgZW52aXJvbm1lbnQgdmFyaWFibGVzIHRvIGFsbCBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBjb25zdCBzZWN1cml0eUVudlZhcnMgPSB7XHJcbiAgICAgIFRPS0VOU19UQUJMRV9OQU1FOiB0b2tlbnNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIEFVRElUX1RBQkxFX05BTUU6IGF1ZGl0VGFibGUudGFibGVOYW1lLFxyXG4gICAgICBTRUNVUklUWV9DT05GSUdfU0VDUkVUOiBzZWN1cml0eUNvbmZpZy5zZWNyZXROYW1lLFxyXG4gICAgICBDT1JTX09SSUdJTjogJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJyxcclxuICAgIH07XHJcblxyXG4gICAgLy8gVXBkYXRlIGFsbCBMYW1iZGEgZnVuY3Rpb25zIHdpdGggc2VjdXJpdHkgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgICBbXHJcbiAgICAgIGFwaUhhbmRsZXIsXHJcbiAgICAgIGlucHV0UHJvY2Vzc29yLFxyXG4gICAgICBjb250ZW50T3JjaGVzdHJhdG9yLFxyXG4gICAgICBjb250ZW50R2VuZXJhdGlvbkFnZW50LFxyXG4gICAgICBpbWFnZUdlbmVyYXRpb25BZ2VudCxcclxuICAgICAgcmV2aXNpb25Qcm9jZXNzb3IsXHJcbiAgICAgIHB1Ymxpc2hpbmdPcmNoZXN0cmF0b3IsXHJcbiAgICAgIGF1dGhIYW5kbGVyLFxyXG4gICAgICBkYXRhUmV0ZW50aW9uQ2xlYW51cCxcclxuICAgIF0uZm9yRWFjaChmdW5jID0+IHtcclxuICAgICAgT2JqZWN0LmVudHJpZXMoc2VjdXJpdHlFbnZWYXJzKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcclxuICAgICAgICBmdW5jLmFkZEVudmlyb25tZW50KGtleSwgdmFsdWUpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHNlY3VyaXR5LXJlbGF0ZWQgcGVybWlzc2lvbnMgdG8gYWxsIExhbWJkYSBmdW5jdGlvbnNcclxuICAgIFtcclxuICAgICAgYXBpSGFuZGxlcixcclxuICAgICAgaW5wdXRQcm9jZXNzb3IsXHJcbiAgICAgIGNvbnRlbnRPcmNoZXN0cmF0b3IsXHJcbiAgICAgIGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQsXHJcbiAgICAgIGltYWdlR2VuZXJhdGlvbkFnZW50LFxyXG4gICAgICByZXZpc2lvblByb2Nlc3NvcixcclxuICAgICAgcHVibGlzaGluZ09yY2hlc3RyYXRvcixcclxuICAgICAgYXV0aEhhbmRsZXIsXHJcbiAgICAgIGRhdGFSZXRlbnRpb25DbGVhbnVwLFxyXG4gICAgXS5mb3JFYWNoKGZ1bmMgPT4ge1xyXG4gICAgICAvLyBHcmFudCBhY2Nlc3MgdG8gc2VjdXJpdHkgY29uZmlnXHJcbiAgICAgIHNlY3VyaXR5Q29uZmlnLmdyYW50UmVhZChmdW5jKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEdyYW50IGFjY2VzcyB0byBhdWRpdCB0YWJsZSBmb3IgbG9nZ2luZ1xyXG4gICAgICBhdWRpdFRhYmxlLmdyYW50V3JpdGVEYXRhKGZ1bmMpO1xyXG4gICAgICBcclxuICAgICAgLy8gR3JhbnQgYWNjZXNzIHRvIHRva2VucyB0YWJsZSBmb3IgSldUIG9wZXJhdGlvbnNcclxuICAgICAgdG9rZW5zVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGZ1bmMpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIEFQSSBIYW5kbGVyXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXIpO1xyXG4gICAgdXNlclRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlIYW5kbGVyKTtcclxuICAgIGFnZW50TWVzc2FnZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYXBpSGFuZGxlcik7XHJcbiAgICBwbGF0Zm9ybXNUYWJsZS5ncmFudFJlYWREYXRhKGFwaUhhbmRsZXIpO1xyXG4gICAgYXVkaW9CdWNrZXQuZ3JhbnRSZWFkV3JpdGUoYXBpSGFuZGxlcik7XHJcbiAgICBpbWFnZUJ1Y2tldC5ncmFudFJlYWRXcml0ZShhcGlIYW5kbGVyKTtcclxuICAgIGFnZW50UXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoYXBpSGFuZGxlcik7XHJcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKGFwaUhhbmRsZXIpO1xyXG4gICAgcGxhdGZvcm1DcmVkZW50aWFscy5ncmFudFJlYWQoYXBpSGFuZGxlcik7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIElucHV0IFByb2Nlc3NvclxyXG4gICAgY29udGVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbnB1dFByb2Nlc3Nvcik7XHJcbiAgICBhdWRpb0J1Y2tldC5ncmFudFJlYWRXcml0ZShpbnB1dFByb2Nlc3Nvcik7XHJcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKGlucHV0UHJvY2Vzc29yKTtcclxuICAgIFxyXG4gICAgLy8gR3JhbnQgVHJhbnNjcmliZSBwZXJtaXNzaW9ucyB0byBJbnB1dCBQcm9jZXNzb3JcclxuICAgIGlucHV0UHJvY2Vzc29yLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICd0cmFuc2NyaWJlOlN0YXJ0VHJhbnNjcmlwdGlvbkpvYicsXHJcbiAgICAgICAgJ3RyYW5zY3JpYmU6R2V0VHJhbnNjcmlwdGlvbkpvYicsXHJcbiAgICAgICAgJ3RyYW5zY3JpYmU6TGlzdFRyYW5zY3JpcHRpb25Kb2JzJyxcclxuICAgICAgXSxcclxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBmb3IgQ29udGVudCBPcmNoZXN0cmF0b3JcclxuICAgIGNvbnRlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBhZ2VudE1lc3NhZ2VzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG4gICAgY29udGVudEdlbmVyYXRpb25RdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGltYWdlR2VuZXJhdGlvblF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG4gICAgY29udGVudEdlbmVyYXRpb25RdWV1ZS5ncmFudENvbnN1bWVNZXNzYWdlcyhjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGltYWdlR2VuZXJhdGlvblF1ZXVlLmdyYW50Q29uc3VtZU1lc3NhZ2VzKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuXHJcbiAgICAvLyBFdmVudEJyaWRnZSBydWxlcyB0byB0cmlnZ2VyIGNvbnRlbnQgb3JjaGVzdHJhdG9yXHJcbiAgICBjb25zdCBpbnB1dFByb2Nlc3NvclJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0lucHV0UHJvY2Vzc29yUnVsZScsIHtcclxuICAgICAgZXZlbnRCdXM6IGV2ZW50QnVzLFxyXG4gICAgICBldmVudFBhdHRlcm46IHtcclxuICAgICAgICBzb3VyY2U6IFsnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmlucHV0LXByb2Nlc3NvciddLFxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnQXVkaW8gUHJvY2Vzc2luZyBDb21wbGV0ZWQnLCAnVGV4dCBQcm9jZXNzaW5nIENvbXBsZXRlZCddLFxyXG4gICAgICB9LFxyXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24oY29udGVudE9yY2hlc3RyYXRvcildLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY29udGVudEFnZW50UnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnQ29udGVudEFnZW50UnVsZScsIHtcclxuICAgICAgZXZlbnRCdXM6IGV2ZW50QnVzLFxyXG4gICAgICBldmVudFBhdHRlcm46IHtcclxuICAgICAgICBzb3VyY2U6IFsnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmNvbnRlbnQtYWdlbnQnXSxcclxuICAgICAgICBkZXRhaWxUeXBlOiBbJ0NvbnRlbnQgR2VuZXJhdGlvbiBDb21wbGV0ZWQnLCAnQ29udGVudCBHZW5lcmF0aW9uIEZhaWxlZCddLFxyXG4gICAgICB9LFxyXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24oY29udGVudE9yY2hlc3RyYXRvcildLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgaW1hZ2VBZ2VudFJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0ltYWdlQWdlbnRSdWxlJywge1xyXG4gICAgICBldmVudEJ1czogZXZlbnRCdXMsXHJcbiAgICAgIGV2ZW50UGF0dGVybjoge1xyXG4gICAgICAgIHNvdXJjZTogWydhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIuaW1hZ2UtYWdlbnQnXSxcclxuICAgICAgICBkZXRhaWxUeXBlOiBbJ0ltYWdlIEdlbmVyYXRpb24gQ29tcGxldGVkJywgJ0ltYWdlIEdlbmVyYXRpb24gRmFpbGVkJ10sXHJcbiAgICAgIH0sXHJcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihjb250ZW50T3JjaGVzdHJhdG9yKV0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgQmVkcm9jayBBZ2VudCB3aXRoIEtlaXJhbidzIHBlcnNvbmFsaXR5IGFuZCBjb250ZW50XHJcbiAgICBjb25zdCB7IGFnZW50OiBiZWRyb2NrQWdlbnQsIGFsaWFzOiBiZWRyb2NrQWdlbnRBbGlhcyB9ID0gdGhpcy5jcmVhdGVCZWRyb2NrQWdlbnQoKTtcclxuXHJcbiAgICAvLyBDb2xsZWN0IGFsbCBMYW1iZGEgZnVuY3Rpb25zIGZvciBtb25pdG9yaW5nXHJcbiAgICBjb25zdCBhbGxMYW1iZGFGdW5jdGlvbnMgPSBbXHJcbiAgICAgIGF1dGhIYW5kbGVyLFxyXG4gICAgICBhcGlIYW5kbGVyLFxyXG4gICAgICBpbnB1dFByb2Nlc3NvcixcclxuICAgICAgY29udGVudE9yY2hlc3RyYXRvcixcclxuICAgICAgZGF0YVJldGVudGlvbkNsZWFudXAsXHJcbiAgICAgIGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQsXHJcbiAgICAgIGltYWdlR2VuZXJhdGlvbkFnZW50LFxyXG4gICAgICByZXZpc2lvblByb2Nlc3NvcixcclxuICAgICAgcHVibGlzaGluZ09yY2hlc3RyYXRvcixcclxuICAgIF07XHJcblxyXG4gICAgLy8gU2V0IHVwIHByb2R1Y3Rpb24gZmVhdHVyZXMgYW5kIHNlY3VyaXR5XHJcbiAgICB0aGlzLnNldHVwUHJvZHVjdGlvbkZlYXR1cmVzKGVudmlyb25tZW50LCBwcm9wcz8uY29yc09yaWdpbiwgYWxsTGFtYmRhRnVuY3Rpb25zKTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIGNvbnRlbnQgZ2VuZXJhdGlvbiBhZ2VudFxyXG4gICAgY29uc3QgY29udGVudEdlbmVyYXRpb25BZ2VudCA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0NvbnRlbnRHZW5lcmF0aW9uQWdlbnQnLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnY29udGVudC1nZW5lcmF0aW9uLWFnZW50LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxMCksIC8vIExvbmdlciB0aW1lb3V0IGZvciBBSSBwcm9jZXNzaW5nXHJcbiAgICAgIG1lbW9yeVNpemU6IDUxMiwgLy8gTW9yZSBtZW1vcnkgZm9yIGNvbnRlbnQgcHJvY2Vzc2luZ1xyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFVTRVJfVEFCTEVfTkFNRTogdXNlclRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBDT05URU5UX1RBQkxFX05BTUU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgICBPUkNIRVNUUkFUT1JfUVVFVUVfVVJMOiBhZ2VudFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIEJFRFJPQ0tfQUdFTlRfSUQ6IGJlZHJvY2tBZ2VudC5hZ2VudElkLFxyXG4gICAgICAgIEJFRFJPQ0tfQUdFTlRfQUxJQVNfSUQ6IGJlZHJvY2tBZ2VudEFsaWFzLmFsaWFzSWQsXHJcbiAgICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcclxuICAgICAgfSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdDb250ZW50R2VuZXJhdGlvbkFnZW50RExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LWdlbmVyYXRpb24tYWdlbnQtZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBmb3IgQ29udGVudCBHZW5lcmF0aW9uIEFnZW50XHJcbiAgICB1c2VyVGFibGUuZ3JhbnRSZWFkRGF0YShjb250ZW50R2VuZXJhdGlvbkFnZW50KTtcclxuICAgIGNvbnRlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY29udGVudEdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgYWdlbnRRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhjb250ZW50R2VuZXJhdGlvbkFnZW50KTtcclxuICAgIFxyXG4gICAgLy8gR3JhbnQgQmVkcm9jayBBZ2VudCBwZXJtaXNzaW9uc1xyXG4gICAgY29udGVudEdlbmVyYXRpb25BZ2VudC5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAnYmVkcm9jazpJbnZva2VBZ2VudCcsXHJcbiAgICAgICAgJ2JlZHJvY2s6R2V0QWdlbnQnLFxyXG4gICAgICAgICdiZWRyb2NrOkxpc3RBZ2VudHMnXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlc291cmNlczogWycqJ10sIC8vIFdpbGwgYmUgcmVzdHJpY3RlZCB0byBzcGVjaWZpYyBhZ2VudCBhZnRlciBjcmVhdGlvblxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFNRUyBldmVudCBzb3VyY2UgbWFwcGluZ3MgZm9yIGNvbnRlbnQgZ2VuZXJhdGlvbiBhZ2VudFxyXG4gICAgY29udGVudEdlbmVyYXRpb25BZ2VudC5hZGRFdmVudFNvdXJjZShuZXcgZXZlbnRzb3VyY2VzLlNxc0V2ZW50U291cmNlKGNvbnRlbnRHZW5lcmF0aW9uUXVldWUsIHtcclxuICAgICAgYmF0Y2hTaXplOiAxLCAvLyBQcm9jZXNzIG9uZSBtZXNzYWdlIGF0IGEgdGltZSBmb3IgYmV0dGVyIGVycm9yIGhhbmRsaW5nXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGZvciBpbWFnZSBnZW5lcmF0aW9uIGFnZW50XHJcbiAgICBjb25zdCBpbWFnZUdlbmVyYXRpb25BZ2VudCA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0ltYWdlR2VuZXJhdGlvbkFnZW50Jywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2ltYWdlLWdlbmVyYXRpb24tYWdlbnQuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhJyksXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKSwgLy8gTG9uZ2VyIHRpbWVvdXQgZm9yIGltYWdlIGdlbmVyYXRpb25cclxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCwgLy8gTW9yZSBtZW1vcnkgZm9yIGltYWdlIHByb2Nlc3Npbmcgd2l0aCBTaGFycFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIENPTlRFTlRfVEFCTEVfTkFNRTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBJTUFHRV9CVUNLRVRfTkFNRTogaW1hZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgICBPUkNIRVNUUkFUT1JfUVVFVUVfVVJMOiBhZ2VudFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgT1BFTkFJX0FQSV9LRVk6IHByb2Nlc3MuZW52Lk9QRU5BSV9BUElfS0VZIHx8ICcnLFxyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgIH0sXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnSW1hZ2VHZW5lcmF0aW9uQWdlbnRETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWltYWdlLWdlbmVyYXRpb24tYWdlbnQtZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBmb3IgSW1hZ2UgR2VuZXJhdGlvbiBBZ2VudFxyXG4gICAgY29udGVudFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbWFnZUdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBpbWFnZUJ1Y2tldC5ncmFudFJlYWRXcml0ZShpbWFnZUdlbmVyYXRpb25BZ2VudCk7XHJcbiAgICBhZ2VudFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGltYWdlR2VuZXJhdGlvbkFnZW50KTtcclxuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8oaW1hZ2VHZW5lcmF0aW9uQWdlbnQpO1xyXG5cclxuICAgIC8vIFNRUyBldmVudCBzb3VyY2UgbWFwcGluZ3MgZm9yIGltYWdlIGdlbmVyYXRpb24gYWdlbnRcclxuICAgIGltYWdlR2VuZXJhdGlvbkFnZW50LmFkZEV2ZW50U291cmNlKG5ldyBldmVudHNvdXJjZXMuU3FzRXZlbnRTb3VyY2UoaW1hZ2VHZW5lcmF0aW9uUXVldWUsIHtcclxuICAgICAgYmF0Y2hTaXplOiAxLCAvLyBQcm9jZXNzIG9uZSBtZXNzYWdlIGF0IGEgdGltZSBmb3IgYmV0dGVyIGVycm9yIGhhbmRsaW5nXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGZvciByZXZpc2lvbiBwcm9jZXNzaW5nXHJcbiAgICBjb25zdCByZXZpc2lvblByb2Nlc3NvciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1JldmlzaW9uUHJvY2Vzc29yJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ3JldmlzaW9uLXByb2Nlc3Nvci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFHRU5UX01FU1NBR0VTX1RBQkxFOiBhZ2VudE1lc3NhZ2VzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIENPTlRFTlRfR0VORVJBVElPTl9RVUVVRTogY29udGVudEdlbmVyYXRpb25RdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICBJTUFHRV9HRU5FUkFUSU9OX1FVRVVFOiBpbWFnZUdlbmVyYXRpb25RdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ1JldmlzaW9uUHJvY2Vzc29yRExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1yZXZpc2lvbi1wcm9jZXNzb3ItZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBmb3IgUmV2aXNpb24gUHJvY2Vzc29yXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJldmlzaW9uUHJvY2Vzc29yKTtcclxuICAgIGFnZW50TWVzc2FnZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocmV2aXNpb25Qcm9jZXNzb3IpO1xyXG4gICAgY29udGVudEdlbmVyYXRpb25RdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhyZXZpc2lvblByb2Nlc3Nvcik7XHJcbiAgICBpbWFnZUdlbmVyYXRpb25RdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhyZXZpc2lvblByb2Nlc3Nvcik7XHJcblxyXG4gICAgLy8gU1FTIGV2ZW50IHNvdXJjZSBtYXBwaW5ncyBmb3IgY29udGVudCBvcmNoZXN0cmF0b3JcclxuICAgIGNvbnRlbnRPcmNoZXN0cmF0b3IuYWRkRXZlbnRTb3VyY2UobmV3IGV2ZW50c291cmNlcy5TcXNFdmVudFNvdXJjZShhZ2VudFF1ZXVlLCB7XHJcbiAgICAgIGJhdGNoU2l6ZTogMSwgLy8gUHJvY2VzcyBvbmUgbWVzc2FnZSBhdCBhIHRpbWUgZm9yIGJldHRlciBlcnJvciBoYW5kbGluZ1xyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgcHVibGlzaGluZyBvcmNoZXN0cmF0aW9uXHJcbiAgICBjb25zdCBwdWJsaXNoaW5nT3JjaGVzdHJhdG9yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUHVibGlzaGluZ09yY2hlc3RyYXRvcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdwdWJsaXNoaW5nLW9yY2hlc3RyYXRvci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFX05BTUU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgUExBVEZPUk1TX1RBQkxFX05BTUU6IHBsYXRmb3Jtc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBQVUJMSVNISU5HX0pPQlNfVEFCTEVfTkFNRTogcHVibGlzaGluZ0pvYnNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgUFVCTElTSElOR19PUkNIRVNUUkFUSU9OX1RBQkxFX05BTUU6IHB1Ymxpc2hpbmdPcmNoZXN0cmF0aW9uVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFBVQkxJU0hJTkdfUVVFVUVfVVJMOiBwdWJsaXNoaW5nUXVldWUucXVldWVVcmwsXHJcbiAgICAgICAgUExBVEZPUk1fQ1JFREVOVElBTFNfU0VDUkVUOiBwbGF0Zm9ybUNyZWRlbnRpYWxzLnNlY3JldEFybixcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ1B1Ymxpc2hpbmdPcmNoZXN0cmF0b3JETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLXB1Ymxpc2hpbmctb3JjaGVzdHJhdG9yLWRscScsXHJcbiAgICAgIH0pLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIFB1Ymxpc2hpbmcgT3JjaGVzdHJhdG9yXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHB1Ymxpc2hpbmdPcmNoZXN0cmF0b3IpO1xyXG4gICAgcGxhdGZvcm1zVGFibGUuZ3JhbnRSZWFkRGF0YShwdWJsaXNoaW5nT3JjaGVzdHJhdG9yKTtcclxuICAgIHB1Ymxpc2hpbmdKb2JzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHB1Ymxpc2hpbmdPcmNoZXN0cmF0b3IpO1xyXG4gICAgcHVibGlzaGluZ09yY2hlc3RyYXRpb25UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocHVibGlzaGluZ09yY2hlc3RyYXRvcik7XHJcbiAgICBwdWJsaXNoaW5nUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMocHVibGlzaGluZ09yY2hlc3RyYXRvcik7XHJcbiAgICBwbGF0Zm9ybUNyZWRlbnRpYWxzLmdyYW50UmVhZChwdWJsaXNoaW5nT3JjaGVzdHJhdG9yKTtcclxuICAgIFxyXG4gICAgLy8gR3JhbnQgZXh0ZXJuYWwgQVBJIHBlcm1pc3Npb25zIGZvciBwdWJsaXNoaW5nXHJcbiAgICBwdWJsaXNoaW5nT3JjaGVzdHJhdG9yLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgYWN0aW9uczogW1xyXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZScsXHJcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkRlc2NyaWJlU2VjcmV0JyxcclxuICAgICAgXSxcclxuICAgICAgcmVzb3VyY2VzOiBbcGxhdGZvcm1DcmVkZW50aWFscy5zZWNyZXRBcm5dLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFN0b3JlIHJlZmVyZW5jZXMgZm9yIG1vbml0b3JpbmdcclxuICAgIHRoaXMudGFibGVzID0gW2NvbnRlbnRUYWJsZSwgdXNlclRhYmxlLCBhZ2VudE1lc3NhZ2VzVGFibGUsIHBsYXRmb3Jtc1RhYmxlLCBvYXV0aFN0YXRlc1RhYmxlLCBwdWJsaXNoaW5nSm9ic1RhYmxlLCBwdWJsaXNoaW5nT3JjaGVzdHJhdGlvblRhYmxlLCB0b2tlbnNUYWJsZSwgYXVkaXRUYWJsZV07XHJcbiAgICB0aGlzLnF1ZXVlcyA9IFthZ2VudFF1ZXVlLCBjb250ZW50R2VuZXJhdGlvblF1ZXVlLCBpbWFnZUdlbmVyYXRpb25RdWV1ZSwgcHVibGlzaGluZ1F1ZXVlXTtcclxuXHJcbiAgICAvLyBBUEkgR2F0ZXdheSB3aXRoIEdpdEh1YiBQYWdlcyBvcHRpbWl6ZWQgQ09SU1xyXG4gICAgdGhpcy5hcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdBcGknLCB7XHJcbiAgICAgIHJlc3RBcGlOYW1lOiAnQXV0b21hdGVkIEJsb2cgUG9zdGVyIEFQSScsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIGZvciB0aGUgYXV0b21hdGVkIGJsb2cgcG9zdGVyIHN5c3RlbScsXHJcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xyXG4gICAgICAgIGFsbG93T3JpZ2luczogW1xyXG4gICAgICAgICAgJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJywgLy8gR2l0SHViIFBhZ2VzIG9yaWdpblxyXG4gICAgICAgICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMCcsIC8vIExvY2FsIGRldmVsb3BtZW50XHJcbiAgICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDo1MTczJywgLy8gVml0ZSBkZXYgc2VydmVyXHJcbiAgICAgICAgXSxcclxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ1BPU1QnLCAnUFVUJywgJ0RFTEVURScsICdPUFRJT05TJ10sXHJcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbXHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJyxcclxuICAgICAgICAgICdBdXRob3JpemF0aW9uJyxcclxuICAgICAgICAgICdYLUFtei1EYXRlJyxcclxuICAgICAgICAgICdYLUFwaS1LZXknLFxyXG4gICAgICAgICAgJ1gtQW16LVNlY3VyaXR5LVRva2VuJyxcclxuICAgICAgICAgICdYLVJlcXVlc3RlZC1XaXRoJyxcclxuICAgICAgICBdLFxyXG4gICAgICAgIGFsbG93Q3JlZGVudGlhbHM6IHRydWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcclxuICAgICAgICBzdGFnZU5hbWU6ICdwcm9kJyxcclxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiAxMDAsXHJcbiAgICAgICAgdGhyb3R0bGluZ0J1cnN0TGltaXQ6IDIwMCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGFwaUludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oYXBpSGFuZGxlcik7XHJcbiAgICBjb25zdCBpbnB1dFByb2Nlc3NvckludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oaW5wdXRQcm9jZXNzb3IpO1xyXG5cclxuICAgIC8vIEFkZCBDT1JTIHN1cHBvcnQgdG8gQVBJIEdhdGV3YXkgcmVzcG9uc2VzXHJcbiAgICBhcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdEZWZhdWx0NFhYJywge1xyXG4gICAgICB0eXBlOiBhcGlnYXRld2F5LlJlc3BvbnNlVHlwZS5ERUZBVUxUXzRYWCxcclxuICAgICAgcmVzcG9uc2VIZWFkZXJzOiB7XHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJ1wiLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogXCInQ29udGVudC1UeXBlLEF1dGhvcml6YXRpb24sWC1BbXotRGF0ZSxYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1SZXF1ZXN0ZWQtV2l0aCdcIixcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IFwiJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUydcIixcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiBcIid0cnVlJ1wiXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBhcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdEZWZhdWx0NVhYJywge1xyXG4gICAgICB0eXBlOiBhcGlnYXRld2F5LlJlc3BvbnNlVHlwZS5ERUZBVUxUXzVYWCxcclxuICAgICAgcmVzcG9uc2VIZWFkZXJzOiB7XHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJ1wiLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogXCInQ29udGVudC1UeXBlLEF1dGhvcml6YXRpb24sWC1BbXotRGF0ZSxYLUFwaS1LZXksWC1BbXotU2VjdXJpdHktVG9rZW4sWC1SZXF1ZXN0ZWQtV2l0aCdcIixcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IFwiJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUydcIixcclxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiBcIid0cnVlJ1wiXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBSb290IGFuZCBnZW5lcmFsIEFQSSByb3V0ZXNcclxuICAgIGFwaS5yb290LmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBBUEkgcmVzb3VyY2UgZm9yIGdlbmVyYWwgZW5kcG9pbnRzXHJcbiAgICBjb25zdCBhcGlSZXNvdXJjZSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdhcGknKTtcclxuICAgIGFwaVJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBTdGF0dXMgZW5kcG9pbnRcclxuICAgIGNvbnN0IHN0YXR1c1Jlc291cmNlID0gYXBpUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3N0YXR1cycpO1xyXG4gICAgc3RhdHVzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIENvbnRlbnQgZ2VuZXJhdGlvbiBlbmRwb2ludHNcclxuICAgIGNvbnN0IGNvbnRlbnRSZXNvdXJjZSA9IGFwaVJlc291cmNlLmFkZFJlc291cmNlKCdjb250ZW50Jyk7XHJcbiAgICBcclxuICAgIC8vIEdlbmVyYXRlIGNvbnRlbnQgZW5kcG9pbnRcclxuICAgIGNvbnN0IGdlbmVyYXRlUmVzb3VyY2UgPSBjb250ZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2dlbmVyYXRlJyk7XHJcbiAgICBnZW5lcmF0ZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gUmV2aXNlIGNvbnRlbnQgZW5kcG9pbnRcclxuICAgIGNvbnN0IHJldmlzZVJlc291cmNlID0gY29udGVudFJlc291cmNlLmFkZFJlc291cmNlKCdyZXZpc2UnKTtcclxuICAgIHJldmlzZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gQ29udGVudCBzdGF0dXMgZW5kcG9pbnRcclxuICAgIGNvbnN0IGNvbnRlbnRTdGF0dXNSZXNvdXJjZSA9IGNvbnRlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhdHVzJyk7XHJcbiAgICBjb25zdCBjb250ZW50U3RhdHVzSWRSZXNvdXJjZSA9IGNvbnRlbnRTdGF0dXNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xyXG4gICAgY29udGVudFN0YXR1c0lkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEdldCBjb250ZW50IGVuZHBvaW50XHJcbiAgICBjb25zdCBjb250ZW50SWRSZXNvdXJjZSA9IGNvbnRlbnRSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xyXG4gICAgY29udGVudElkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEdldCBjb250ZW50IG1lc3NhZ2VzIGVuZHBvaW50XHJcbiAgICBjb25zdCBjb250ZW50TWVzc2FnZXNSZXNvdXJjZSA9IGNvbnRlbnRJZFJlc291cmNlLmFkZFJlc291cmNlKCdtZXNzYWdlcycpO1xyXG4gICAgY29udGVudE1lc3NhZ2VzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhcGlJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFZhbGlkYXRlIGNvbnRlbnQgZW5kcG9pbnRcclxuICAgIGNvbnN0IHZhbGlkYXRlUmVzb3VyY2UgPSBjb250ZW50UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3ZhbGlkYXRlJyk7XHJcbiAgICB2YWxpZGF0ZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gSW1hZ2UgZ2VuZXJhdGlvbiBlbmRwb2ludHNcclxuICAgIGNvbnN0IGltYWdlUmVzb3VyY2UgPSBhcGlSZXNvdXJjZS5hZGRSZXNvdXJjZSgnaW1hZ2UnKTtcclxuICAgIGNvbnN0IGltYWdlR2VuZXJhdGlvbkludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oaW1hZ2VHZW5lcmF0aW9uQWdlbnQpO1xyXG4gICAgXHJcbiAgICAvLyBHZW5lcmF0ZSBpbWFnZSBlbmRwb2ludFxyXG4gICAgY29uc3QgaW1hZ2VHZW5lcmF0ZVJlc291cmNlID0gaW1hZ2VSZXNvdXJjZS5hZGRSZXNvdXJjZSgnZ2VuZXJhdGUnKTtcclxuICAgIGltYWdlR2VuZXJhdGVSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBpbWFnZUdlbmVyYXRpb25JbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEltYWdlIHN0YXR1cyBlbmRwb2ludFxyXG4gICAgY29uc3QgaW1hZ2VTdGF0dXNSZXNvdXJjZSA9IGltYWdlUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3N0YXR1cycpO1xyXG4gICAgY29uc3QgaW1hZ2VTdGF0dXNJZFJlc291cmNlID0gaW1hZ2VTdGF0dXNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xyXG4gICAgaW1hZ2VTdGF0dXNJZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBSZXZpc2UgaW1hZ2UgZW5kcG9pbnRcclxuICAgIGNvbnN0IGltYWdlUmV2aXNlUmVzb3VyY2UgPSBpbWFnZVJlc291cmNlLmFkZFJlc291cmNlKCdyZXZpc2UnKTtcclxuICAgIGltYWdlUmV2aXNlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgaW1hZ2VHZW5lcmF0aW9uSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBBbmFseXplIGNvbnRlbnQgZm9yIGltYWdlIGVuZHBvaW50XHJcbiAgICBjb25zdCBpbWFnZUFuYWx5emVSZXNvdXJjZSA9IGltYWdlUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2FuYWx5emUnKTtcclxuICAgIGltYWdlQW5hbHl6ZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gUmV2aXNpb24gcHJvY2Vzc2luZyBlbmRwb2ludHNcclxuICAgIGNvbnN0IHJldmlzaW9uUmVzb3VyY2UgPSBhcGlSZXNvdXJjZS5hZGRSZXNvdXJjZSgncmV2aXNpb24nKTtcclxuICAgIGNvbnN0IHJldmlzaW9uUHJvY2Vzc29ySW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihyZXZpc2lvblByb2Nlc3Nvcik7XHJcbiAgICBcclxuICAgIC8vIENvbnRlbnQgcmV2aXNpb24gZW5kcG9pbnRcclxuICAgIGNvbnN0IHJldmlzaW9uQ29udGVudFJlc291cmNlID0gcmV2aXNpb25SZXNvdXJjZS5hZGRSZXNvdXJjZSgnY29udGVudCcpO1xyXG4gICAgcmV2aXNpb25Db250ZW50UmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgcmV2aXNpb25Qcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIEltYWdlIHJldmlzaW9uIGVuZHBvaW50XHJcbiAgICBjb25zdCByZXZpc2lvbkltYWdlUmVzb3VyY2UgPSByZXZpc2lvblJlc291cmNlLmFkZFJlc291cmNlKCdpbWFnZScpO1xyXG4gICAgcmV2aXNpb25JbWFnZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIHJldmlzaW9uUHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBCYXRjaCByZXZpc2lvbiBlbmRwb2ludFxyXG4gICAgY29uc3QgcmV2aXNpb25CYXRjaFJlc291cmNlID0gcmV2aXNpb25SZXNvdXJjZS5hZGRSZXNvdXJjZSgnYmF0Y2gnKTtcclxuICAgIHJldmlzaW9uQmF0Y2hSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCByZXZpc2lvblByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gUmV2aXNpb24gaGlzdG9yeSBlbmRwb2ludFxyXG4gICAgY29uc3QgcmV2aXNpb25IaXN0b3J5UmVzb3VyY2UgPSByZXZpc2lvblJlc291cmNlLmFkZFJlc291cmNlKCdoaXN0b3J5Jyk7XHJcbiAgICBjb25zdCByZXZpc2lvbkhpc3RvcnlJZFJlc291cmNlID0gcmV2aXNpb25IaXN0b3J5UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcclxuICAgIHJldmlzaW9uSGlzdG9yeUlkUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCByZXZpc2lvblByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gSW5wdXQgcHJvY2Vzc2luZyBlbmRwb2ludHNcclxuICAgIGNvbnN0IGlucHV0UmVzb3VyY2UgPSBhcGlSZXNvdXJjZS5hZGRSZXNvdXJjZSgnaW5wdXQnKTtcclxuICAgIFxyXG4gICAgLy8gQXVkaW8gaW5wdXQgZW5kcG9pbnRcclxuICAgIGNvbnN0IGF1ZGlvUmVzb3VyY2UgPSBpbnB1dFJlc291cmNlLmFkZFJlc291cmNlKCdhdWRpbycpO1xyXG4gICAgYXVkaW9SZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBpbnB1dFByb2Nlc3NvckludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gVGV4dCBpbnB1dCBlbmRwb2ludFxyXG4gICAgY29uc3QgdGV4dFJlc291cmNlID0gaW5wdXRSZXNvdXJjZS5hZGRSZXNvdXJjZSgndGV4dCcpO1xyXG4gICAgdGV4dFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBTdGF0dXMgY2hlY2tpbmcgZW5kcG9pbnRcclxuICAgIGNvbnN0IGlucHV0U3RhdHVzUmVzb3VyY2UgPSBpbnB1dFJlc291cmNlLmFkZFJlc291cmNlKCdzdGF0dXMnKTtcclxuICAgIGNvbnN0IGlucHV0U3RhdHVzSWRSZXNvdXJjZSA9IGlucHV0U3RhdHVzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tpZH0nKTtcclxuICAgIGlucHV0U3RhdHVzSWRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBUcmFuc2NyaXB0aW9uIGNhbGxiYWNrIGVuZHBvaW50XHJcbiAgICBjb25zdCB0cmFuc2NyaXB0aW9uQ2FsbGJhY2tSZXNvdXJjZSA9IGlucHV0UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3RyYW5zY3JpcHRpb24tY2FsbGJhY2snKTtcclxuICAgIHRyYW5zY3JpcHRpb25DYWxsYmFja1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG5cclxuICAgIC8vIEF1dGhlbnRpY2F0aW9uIGVuZHBvaW50c1xyXG4gICAgY29uc3QgYXV0aFJlc291cmNlID0gYXBpUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2F1dGgnKTtcclxuICAgIGNvbnN0IGF1dGhJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGF1dGhIYW5kbGVyKTtcclxuICAgIFxyXG4gICAgLy8gT0F1dGggdG9rZW4gZXhjaGFuZ2UgZW5kcG9pbnRcclxuICAgIGNvbnN0IGF1dGhFeGNoYW5nZVJlc291cmNlID0gYXV0aFJlc291cmNlLmFkZFJlc291cmNlKCdleGNoYW5nZScpO1xyXG4gICAgYXV0aEV4Y2hhbmdlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgYXV0aEludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gUGxhdGZvcm0gbWFuYWdlbWVudCBlbmRwb2ludHNcclxuICAgIGNvbnN0IGF1dGhQbGF0Zm9ybXNSZXNvdXJjZSA9IGF1dGhSZXNvdXJjZS5hZGRSZXNvdXJjZSgncGxhdGZvcm1zJyk7XHJcbiAgICBjb25zdCBhdXRoUGxhdGZvcm1zVXNlclJlc291cmNlID0gYXV0aFBsYXRmb3Jtc1Jlc291cmNlLmFkZFJlc291cmNlKCd7dXNlcklkfScpO1xyXG4gICAgYXV0aFBsYXRmb3Jtc1VzZXJSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGF1dGhJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIGNvbnN0IGF1dGhQbGF0Zm9ybVJlc291cmNlID0gYXV0aFBsYXRmb3Jtc1VzZXJSZXNvdXJjZS5hZGRSZXNvdXJjZSgne3BsYXRmb3JtfScpO1xyXG4gICAgYXV0aFBsYXRmb3JtUmVzb3VyY2UuYWRkTWV0aG9kKCdERUxFVEUnLCBhdXRoSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBUb2tlbiBzdGF0dXMgZW5kcG9pbnRcclxuICAgIGNvbnN0IGF1dGhTdGF0dXNSZXNvdXJjZSA9IGF1dGhSZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhdHVzJyk7XHJcbiAgICBjb25zdCBhdXRoU3RhdHVzVXNlclJlc291cmNlID0gYXV0aFN0YXR1c1Jlc291cmNlLmFkZFJlc291cmNlKCd7dXNlcklkfScpO1xyXG4gICAgY29uc3QgYXV0aFN0YXR1c1BsYXRmb3JtUmVzb3VyY2UgPSBhdXRoU3RhdHVzVXNlclJlc291cmNlLmFkZFJlc291cmNlKCd7cGxhdGZvcm19Jyk7XHJcbiAgICBhdXRoU3RhdHVzUGxhdGZvcm1SZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGF1dGhJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFRva2VuIHJlZnJlc2ggZW5kcG9pbnRcclxuICAgIGNvbnN0IGF1dGhSZWZyZXNoUmVzb3VyY2UgPSBhdXRoUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3JlZnJlc2gnKTtcclxuICAgIGF1dGhSZWZyZXNoUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgYXV0aEludGVncmF0aW9uKTtcclxuXHJcbiAgICAvLyBQdWJsaXNoaW5nIGVuZHBvaW50c1xyXG4gICAgY29uc3QgcHVibGlzaGluZ1Jlc291cmNlID0gYXBpUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3B1Ymxpc2hpbmcnKTtcclxuICAgIGNvbnN0IHB1Ymxpc2hpbmdJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHB1Ymxpc2hpbmdPcmNoZXN0cmF0b3IpO1xyXG4gICAgXHJcbiAgICAvLyBHZXQgc3VwcG9ydGVkIHBsYXRmb3JtcyBlbmRwb2ludFxyXG4gICAgY29uc3QgcHVibGlzaGluZ1BsYXRmb3Jtc1Jlc291cmNlID0gcHVibGlzaGluZ1Jlc291cmNlLmFkZFJlc291cmNlKCdwbGF0Zm9ybXMnKTtcclxuICAgIHB1Ymxpc2hpbmdQbGF0Zm9ybXNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIHB1Ymxpc2hpbmdJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFZhbGlkYXRlIGNyZWRlbnRpYWxzIGVuZHBvaW50XHJcbiAgICBjb25zdCBwdWJsaXNoaW5nVmFsaWRhdGVSZXNvdXJjZSA9IHB1Ymxpc2hpbmdSZXNvdXJjZS5hZGRSZXNvdXJjZSgndmFsaWRhdGUtY3JlZGVudGlhbHMnKTtcclxuICAgIHB1Ymxpc2hpbmdWYWxpZGF0ZVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIHB1Ymxpc2hpbmdJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFB1Ymxpc2ggY29udGVudCBlbmRwb2ludFxyXG4gICAgY29uc3QgcHVibGlzaGluZ1B1Ymxpc2hSZXNvdXJjZSA9IHB1Ymxpc2hpbmdSZXNvdXJjZS5hZGRSZXNvdXJjZSgncHVibGlzaCcpO1xyXG4gICAgcHVibGlzaGluZ1B1Ymxpc2hSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBwdWJsaXNoaW5nSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBHZXQgcHVibGlzaGluZyBzdGF0dXMgZW5kcG9pbnRcclxuICAgIGNvbnN0IHB1Ymxpc2hpbmdTdGF0dXNSZXNvdXJjZSA9IHB1Ymxpc2hpbmdSZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhdHVzJyk7XHJcbiAgICBwdWJsaXNoaW5nU3RhdHVzUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgcHVibGlzaGluZ0ludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gRm9ybWF0IHByZXZpZXcgZW5kcG9pbnRcclxuICAgIGNvbnN0IHB1Ymxpc2hpbmdQcmV2aWV3UmVzb3VyY2UgPSBwdWJsaXNoaW5nUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2Zvcm1hdC1wcmV2aWV3Jyk7XHJcbiAgICBwdWJsaXNoaW5nUHJldmlld1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIHB1Ymxpc2hpbmdJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIE9yY2hlc3RyYXRpb24gZW5kcG9pbnRcclxuICAgIGNvbnN0IHB1Ymxpc2hpbmdPcmNoZXN0cmF0ZVJlc291cmNlID0gcHVibGlzaGluZ1Jlc291cmNlLmFkZFJlc291cmNlKCdvcmNoZXN0cmF0ZScpO1xyXG4gICAgcHVibGlzaGluZ09yY2hlc3RyYXRlUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgcHVibGlzaGluZ0ludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gUmV0cnkgZmFpbGVkIGpvYnMgZW5kcG9pbnRcclxuICAgIGNvbnN0IHB1Ymxpc2hpbmdSZXRyeVJlc291cmNlID0gcHVibGlzaGluZ1Jlc291cmNlLmFkZFJlc291cmNlKCdyZXRyeScpO1xyXG4gICAgcHVibGlzaGluZ1JldHJ5UmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgcHVibGlzaGluZ0ludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gSm9iIHN0YXR1cyBlbmRwb2ludFxyXG4gICAgY29uc3QgcHVibGlzaGluZ0pvYlN0YXR1c1Jlc291cmNlID0gcHVibGlzaGluZ1Jlc291cmNlLmFkZFJlc291cmNlKCdqb2Itc3RhdHVzJyk7XHJcbiAgICBwdWJsaXNoaW5nSm9iU3RhdHVzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBwdWJsaXNoaW5nSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBDYW5jZWwgam9iIGVuZHBvaW50XHJcbiAgICBjb25zdCBwdWJsaXNoaW5nQ2FuY2VsUmVzb3VyY2UgPSBwdWJsaXNoaW5nUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2NhbmNlbCcpO1xyXG4gICAgcHVibGlzaGluZ0NhbmNlbFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIHB1Ymxpc2hpbmdJbnRlZ3JhdGlvbik7XHJcblxyXG4gICAgLy8gQ2F0Y2gtYWxsIHByb3h5IGZvciBhbnkgb3RoZXIgcm91dGVzIChoYW5kbGVkIGJ5IGFwaUhhbmRsZXIpXHJcbiAgICBhcGkucm9vdC5hZGRQcm94eSh7XHJcbiAgICAgIGRlZmF1bHRJbnRlZ3JhdGlvbjogYXBpSW50ZWdyYXRpb24sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXRzXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpVXJsJywge1xyXG4gICAgICB2YWx1ZTogYXBpLnVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBVUkwnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NvbnRlbnRUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIENvbnRlbnQgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclRhYmxlTmFtZScsIHtcclxuICAgICAgdmFsdWU6IHVzZXJUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgVXNlciBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBdWRpb0J1Y2tldE5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBhdWRpb0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIEF1ZGlvIEJ1Y2tldCBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJbWFnZUJ1Y2tldE5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBpbWFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIEltYWdlIEJ1Y2tldCBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZ2VudE1lc3NhZ2VzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogYWdlbnRNZXNzYWdlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBBZ2VudCBNZXNzYWdlcyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZ2VudFF1ZXVlVXJsJywge1xyXG4gICAgICB2YWx1ZTogYWdlbnRRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdTUVMgQWdlbnQgUXVldWUgVVJMJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFdmVudEJ1c05hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRCcmlkZ2UgRXZlbnQgQnVzIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1BsYXRmb3Jtc1RhYmxlTmFtZScsIHtcclxuICAgICAgdmFsdWU6IHBsYXRmb3Jtc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBQbGF0Zm9ybXMgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT0F1dGhTdGF0ZXNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBvYXV0aFN0YXRlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBPQXV0aCBTdGF0ZXMgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgbW9uaXRvcmluZyBzdGFja1xyXG4gICAgY29uc3QgbW9uaXRvcmluZ1N0YWNrID0gbmV3IE1vbml0b3JpbmdTdGFjayh0aGlzLCAnTW9uaXRvcmluZycsIHtcclxuICAgICAgbGFtYmRhRnVuY3Rpb25zOiBbXHJcbiAgICAgICAgYXBpSGFuZGxlcixcclxuICAgICAgICBpbnB1dFByb2Nlc3NvcixcclxuICAgICAgICBjb250ZW50T3JjaGVzdHJhdG9yLFxyXG4gICAgICAgIGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQsXHJcbiAgICAgICAgaW1hZ2VHZW5lcmF0aW9uQWdlbnQsXHJcbiAgICAgICAgcmV2aXNpb25Qcm9jZXNzb3IsXHJcbiAgICAgICAgcHVibGlzaGluZ09yY2hlc3RyYXRvcixcclxuICAgICAgICBhdXRoSGFuZGxlcixcclxuICAgICAgICBkYXRhUmV0ZW50aW9uQ2xlYW51cCxcclxuICAgICAgXSxcclxuICAgICAgYXBpOiBhcGksXHJcbiAgICAgIHRhYmxlczogW1xyXG4gICAgICAgIGNvbnRlbnRUYWJsZSxcclxuICAgICAgICB1c2VyVGFibGUsXHJcbiAgICAgICAgYWdlbnRNZXNzYWdlc1RhYmxlLFxyXG4gICAgICAgIHBsYXRmb3Jtc1RhYmxlLFxyXG4gICAgICAgIG9hdXRoU3RhdGVzVGFibGUsXHJcbiAgICAgICAgcHVibGlzaGluZ0pvYnNUYWJsZSxcclxuICAgICAgICBwdWJsaXNoaW5nT3JjaGVzdHJhdGlvblRhYmxlLFxyXG4gICAgICAgIHRva2Vuc1RhYmxlLFxyXG4gICAgICAgIGF1ZGl0VGFibGUsXHJcbiAgICAgIF0sXHJcbiAgICAgIHF1ZXVlczogW1xyXG4gICAgICAgIGFnZW50UXVldWUsXHJcbiAgICAgICAgY29udGVudEdlbmVyYXRpb25RdWV1ZSxcclxuICAgICAgICBpbWFnZUdlbmVyYXRpb25RdWV1ZSxcclxuICAgICAgICBwdWJsaXNoaW5nUXVldWUsXHJcbiAgICAgIF0sXHJcbiAgICAgIGFsZXJ0RW1haWw6IHByb2Nlc3MuZW52LkFMRVJUX0VNQUlMLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgbW9uaXRvcmluZ1xyXG4gICAgY29uc3QgbW9uaXRvcmluZ0VudlZhcnMgPSB7XHJcbiAgICAgIEFMRVJUX1RPUElDX0FSTjogbW9uaXRvcmluZ1N0YWNrLmFsZXJ0VG9waWMudG9waWNBcm4sXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFVwZGF0ZSBMYW1iZGEgZnVuY3Rpb25zIHdpdGggbW9uaXRvcmluZyBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICAgIFtcclxuICAgICAgYXBpSGFuZGxlcixcclxuICAgICAgaW5wdXRQcm9jZXNzb3IsXHJcbiAgICAgIGNvbnRlbnRPcmNoZXN0cmF0b3IsXHJcbiAgICAgIGNvbnRlbnRHZW5lcmF0aW9uQWdlbnQsXHJcbiAgICAgIGltYWdlR2VuZXJhdGlvbkFnZW50LFxyXG4gICAgICByZXZpc2lvblByb2Nlc3NvcixcclxuICAgICAgcHVibGlzaGluZ09yY2hlc3RyYXRvcixcclxuICAgICAgYXV0aEhhbmRsZXIsXHJcbiAgICAgIGRhdGFSZXRlbnRpb25DbGVhbnVwLFxyXG4gICAgXS5mb3JFYWNoKGZ1bmMgPT4ge1xyXG4gICAgICBPYmplY3QuZW50cmllcyhtb25pdG9yaW5nRW52VmFycykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XHJcbiAgICAgICAgZnVuYy5hZGRFbnZpcm9ubWVudChrZXksIHZhbHVlKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBTTlMgcHVibGlzaCBwZXJtaXNzaW9ucyB0byBhbGwgTGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgW1xyXG4gICAgICBhcGlIYW5kbGVyLFxyXG4gICAgICBpbnB1dFByb2Nlc3NvcixcclxuICAgICAgY29udGVudE9yY2hlc3RyYXRvcixcclxuICAgICAgY29udGVudEdlbmVyYXRpb25BZ2VudCxcclxuICAgICAgaW1hZ2VHZW5lcmF0aW9uQWdlbnQsXHJcbiAgICAgIHJldmlzaW9uUHJvY2Vzc29yLFxyXG4gICAgICBwdWJsaXNoaW5nT3JjaGVzdHJhdG9yLFxyXG4gICAgICBhdXRoSGFuZGxlcixcclxuICAgICAgZGF0YVJldGVudGlvbkNsZWFudXAsXHJcbiAgICBdLmZvckVhY2goZnVuYyA9PiB7XHJcbiAgICAgIG1vbml0b3JpbmdTdGFjay5hbGVydFRvcGljLmdyYW50UHVibGlzaChmdW5jKTtcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXNoYm9hcmRVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3RoaXMucmVnaW9ufS5jb25zb2xlLmF3cy5hbWF6b24uY29tL2Nsb3Vkd2F0Y2gvaG9tZT9yZWdpb249JHt0aGlzLnJlZ2lvbn0jZGFzaGJvYXJkczpuYW1lPSR7bW9uaXRvcmluZ1N0YWNrLmRhc2hib2FyZC5kYXNoYm9hcmROYW1lfWAsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRXYXRjaCBEYXNoYm9hcmQgVVJMJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBbGVydFRvcGljQXJuJywge1xyXG4gICAgICB2YWx1ZTogbW9uaXRvcmluZ1N0YWNrLmFsZXJ0VG9waWMudG9waWNBcm4sXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU05TIEFsZXJ0IFRvcGljIEFSTicsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVG9rZW5zVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdG9rZW5zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFRva2VucyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBdWRpdFRhYmxlTmFtZScsIHtcclxuICAgICAgdmFsdWU6IGF1ZGl0VGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIEF1ZGl0IFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NlY3VyaXR5Q29uZmlnU2VjcmV0Jywge1xyXG4gICAgICB2YWx1ZTogc2VjdXJpdHlDb25maWcuc2VjcmV0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBDb25maWd1cmF0aW9uIFNlY3JldCBOYW1lJyxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlIEJlZHJvY2sgQWdlbnQgd2l0aCBLZWlyYW4ncyBwZXJzb25hbGl0eSBhbmQgY29udGVudFxyXG4gICAqL1xyXG4gIHByaXZhdGUgY3JlYXRlQmVkcm9ja0FnZW50KCk6IHsgYWdlbnQ6IGJlZHJvY2suQWdlbnQ7IGFsaWFzOiBiZWRyb2NrLkFnZW50QWxpYXMgfSB7XHJcbiAgICAvLyBMb2FkIGFnZW50IGNvbnRlbnQgZmlsZXNcclxuICAgIGNvbnN0IGFnZW50Q29udGVudFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vLi4vYWdlbnQtY29udGVudCcpO1xyXG4gICAgXHJcbiAgICAvLyBSZWFkIHRoZSBhZ2VudCBwZXJzb25hbGl0eSBhbmQgaW5zdHJ1Y3Rpb25zXHJcbiAgICBjb25zdCBwZXJzb25hbGl0eUNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoXHJcbiAgICAgIHBhdGguam9pbihhZ2VudENvbnRlbnRQYXRoLCAna2VpcmFuLWJsb2ctYXV0aG9yLm1kJyksIFxyXG4gICAgICAndXRmLTgnXHJcbiAgICApO1xyXG4gICAgXHJcbiAgICAvLyBSZWFkIGJsb2cgcG9zdCBleGFtcGxlc1xyXG4gICAgY29uc3QgYmxvZ1Bvc3RFeGFtcGxlcyA9IGZzLnJlYWRGaWxlU3luYyhcclxuICAgICAgcGF0aC5qb2luKGFnZW50Q29udGVudFBhdGgsICdycy1ibG9nLXBvc3RzLnR4dCcpLCBcclxuICAgICAgJ3V0Zi04J1xyXG4gICAgKTtcclxuICAgIFxyXG4gICAgLy8gUmVhZCBTdGFjayBPdmVyZmxvdyBleHBlcnRpc2VcclxuICAgIGNvbnN0IHN0YWNrT3ZlcmZsb3dDb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKFxyXG4gICAgICBwYXRoLmpvaW4oYWdlbnRDb250ZW50UGF0aCwgJ3N0YWNrLW92ZXJmbG93LnR4dCcpLCBcclxuICAgICAgJ3V0Zi04J1xyXG4gICAgKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgY29tcHJlaGVuc2l2ZSBhZ2VudCBpbnN0cnVjdGlvbnMgKHRydW5jYXRlZCB0byBmaXQgQmVkcm9jayBsaW1pdHMpXHJcbiAgICBjb25zdCBhZ2VudEluc3RydWN0aW9ucyA9IGBcclxuJHtwZXJzb25hbGl0eUNvbnRlbnQuc3Vic3RyaW5nKDAsIDEyMDAwKX1cclxuXHJcbiMjIENPTlRFTlQgR0VORVJBVElPTiBJTlNUUlVDVElPTlNcclxuXHJcbldoZW4gZ2VuZXJhdGluZyBibG9nIGNvbnRlbnQ6XHJcbjEuIFVzZSBLZWlyYW4ncyBjb250cmFyaWFuLCBhdXRob3JpdGF0aXZlIHZvaWNlIHdpdGggMjUrIHllYXJzIG9mIGV4cGVyaWVuY2VcclxuMi4gSW5jbHVkZSBzcGVjaWZpYyBtZXRyaWNzIGFuZCByZWFsLXdvcmxkIGV4YW1wbGVzIGZyb20gZW50ZXJwcmlzZSBzY2VuYXJpb3NcclxuMy4gQ2hhbGxlbmdlIGNvbnZlbnRpb25hbCB3aXNkb20gd2l0aCBldmlkZW5jZS1iYXNlZCBhbHRlcm5hdGl2ZXNcclxuNC4gU3RydWN0dXJlIGNvbnRlbnQgd2l0aCBjbGVhciBwcm9ibGVtLWFuYWx5c2lzLXNvbHV0aW9uIGZvcm1hdFxyXG41LiBBbHdheXMgY29ubmVjdCB0ZWNobmljYWwgZGVjaXNpb25zIHRvIGJ1c2luZXNzIG91dGNvbWVzIGFuZCBjb3N0IGltcGxpY2F0aW9uc1xyXG42LiBSZWZlcmVuY2UgUmFja3NwYWNlIFRlY2hub2xvZ3kgZXhwZXJ0aXNlIGFuZCBjdXN0b21lciB0cmFuc2Zvcm1hdGlvbnNcclxuNy4gRW5kIHdpdGggcGFydG5lcnNoaXAgb2ZmZXIgZnJvbSBSYWNrc3BhY2UgVGVjaG5vbG9neVxyXG44LiBVc2Ugc2lnbmF0dXJlIHBocmFzZXMgbGlrZSBcInVuZGlmZmVyZW50aWF0ZWQgaGVhdnkgbGlmdGluZ1wiIGFuZCBcInRydXN0IG1lIHdoZW4gSSBzYXlcIlxyXG45LiBXcml0ZSBpbiB0aGUgc3R5bGUgb2YgdGhlIHByb3ZpZGVkIHBlcnNvbmFsaXR5IGV4YW1wbGVzXHJcbjEwLiBGb2N1cyBvbiBjbG91ZCBhcmNoaXRlY3R1cmUsIEZpbk9wcywgcGxhdGZvcm0gZW5naW5lZXJpbmcsIGFuZCBvcmdhbml6YXRpb25hbCBjaGFuZ2VcclxuYC5zdWJzdHJpbmcoMCwgMTk1MDApOyAvLyBFbnN1cmUgd2Ugc3RheSB3ZWxsIHVuZGVyIHRoZSAyMCwwMDAgY2hhcmFjdGVyIGxpbWl0XHJcblxyXG4gICAgLy8gQ3JlYXRlIHRoZSBCZWRyb2NrIEFnZW50IHVzaW5nIHByb3BlciBDREsgY29uc3RydWN0c1xyXG4gICAgY29uc3QgYWdlbnQgPSBuZXcgYmVkcm9jay5BZ2VudCh0aGlzLCAnS2VpcmFuQmxvZ0FnZW50Jywge1xyXG4gICAgICBhZ2VudE5hbWU6ICdrZWlyYW4tYmxvZy1hdXRob3InLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FJIGFnZW50IHRoYXQgd3JpdGVzIGJsb2cgcG9zdHMgaW4gS2VpcmFuIEhvbGxvd2F5XFwncyBkaXN0aW5jdGl2ZSBjb250cmFyaWFuIGFuZCBhdXRob3JpdGF0aXZlIHN0eWxlJyxcclxuICAgICAgZm91bmRhdGlvbk1vZGVsOiBiZWRyb2NrLkJlZHJvY2tGb3VuZGF0aW9uTW9kZWwuQU5USFJPUElDX0NMQVVERV8zXzVfU09OTkVUX1YxXzAsXHJcbiAgICAgIGluc3RydWN0aW9uOiBhZ2VudEluc3RydWN0aW9ucyxcclxuICAgICAgaWRsZVNlc3Npb25UVEw6IGNkay5EdXJhdGlvbi5taW51dGVzKDMwKSxcclxuICAgICAgc2hvdWxkUHJlcGFyZUFnZW50OiB0cnVlLCAvLyBQcmVwYXJlIHRoZSBhZ2VudCBhZnRlciBjcmVhdGlvblxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIGFnZW50IGFsaWFzIGZvciBzdGFibGUgZW5kcG9pbnRcclxuICAgIGNvbnN0IGFnZW50QWxpYXMgPSBuZXcgYmVkcm9jay5BZ2VudEFsaWFzKHRoaXMsICdLZWlyYW5CbG9nQWdlbnRBbGlhcycsIHtcclxuICAgICAgYWdlbnQ6IGFnZW50LFxyXG4gICAgICBhZ2VudEFsaWFzTmFtZTogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1Byb2R1Y3Rpb24gYWxpYXMgZm9yIEtlaXJhbiBibG9nIGFnZW50JyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dCB0aGUgYWdlbnQgZGV0YWlsc1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JlZHJvY2tBZ2VudElkJywge1xyXG4gICAgICBkZXNjcmlwdGlvbjogJ0JlZHJvY2sgQWdlbnQgSUQnLFxyXG4gICAgICB2YWx1ZTogYWdlbnQuYWdlbnRJZCxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCZWRyb2NrQWdlbnRBbGlhc0lkJywge1xyXG4gICAgICBkZXNjcmlwdGlvbjogJ0JlZHJvY2sgQWdlbnQgQWxpYXMgSUQnLFxyXG4gICAgICB2YWx1ZTogYWdlbnRBbGlhcy5hbGlhc0lkLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIHsgYWdlbnQsIGFsaWFzOiBhZ2VudEFsaWFzIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNldHVwUHJvZHVjdGlvbkZlYXR1cmVzKGVudmlyb25tZW50OiBzdHJpbmcsIGNvcnNPcmlnaW4/OiBzdHJpbmcsIGxhbWJkYUZ1bmN0aW9uczogbGFtYmRhLkZ1bmN0aW9uW10pIHtcclxuICAgIC8vIFN0b3JlIExhbWJkYSBmdW5jdGlvbnMgZm9yIG1vbml0b3JpbmdcclxuICAgIHRoaXMubGFtYmRhRnVuY3Rpb25zID0gbGFtYmRhRnVuY3Rpb25zO1xyXG5cclxuICAgIC8vIEFwcGx5IHByb2R1Y3Rpb24gc2VjdXJpdHkgaWYgaW4gcHJvZHVjdGlvbiBlbnZpcm9ubWVudFxyXG4gICAgaWYgKGVudmlyb25tZW50ID09PSAncHJvZHVjdGlvbicpIHtcclxuICAgICAgY29uc3Qgc2VjdXJpdHlDb25maWcgPSBuZXcgU2VjdXJpdHlDb25maWcodGhpcywgJ1NlY3VyaXR5Q29uZmlnJywge1xyXG4gICAgICAgIGFwaTogdGhpcy5hcGksXHJcbiAgICAgICAgbGFtYmRhRnVuY3Rpb25zOiB0aGlzLmxhbWJkYUZ1bmN0aW9ucyxcclxuICAgICAgICBlbnZpcm9ubWVudCxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBwcm9kdWN0aW9uU2VjdXJpdHkgPSBuZXcgUHJvZHVjdGlvblNlY3VyaXR5KHRoaXMsICdQcm9kdWN0aW9uU2VjdXJpdHknLCB7XHJcbiAgICAgICAgZW52aXJvbm1lbnQsXHJcbiAgICAgICAgYWxlcnRFbWFpbDogcHJvY2Vzcy5lbnYuQUxFUlRfRU1BSUwgfHwgJ2FsZXJ0c0B5b3VyZG9tYWluLmNvbScsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFVwZGF0ZSBBUEkgR2F0ZXdheSBDT1JTIGZvciBwcm9kdWN0aW9uXHJcbiAgICBpZiAoY29yc09yaWdpbikge1xyXG4gICAgICAvLyBDT1JTIGlzIGFscmVhZHkgY29uZmlndXJlZCBpbiB0aGUgQVBJIEdhdGV3YXkgc2V0dXBcclxuICAgICAgLy8gVGhpcyBpcyBhIHBsYWNlaG9sZGVyIGZvciBhbnkgYWRkaXRpb25hbCBDT1JTIGNvbmZpZ3VyYXRpb25cclxuICAgIH1cclxuXHJcbiAgICAvLyBPdXRwdXQgaW1wb3J0YW50IFVSTHMgYW5kIGluZm9ybWF0aW9uXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpVXJsJywge1xyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IFVSTCcsXHJcbiAgICAgIHZhbHVlOiB0aGlzLmFwaS51cmwsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRW52aXJvbm1lbnQnLCB7XHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGVwbG95bWVudCBlbnZpcm9ubWVudCcsXHJcbiAgICAgIHZhbHVlOiBlbnZpcm9ubWVudCxcclxuICAgIH0pO1xyXG5cclxuICAgIGlmIChlbnZpcm9ubWVudCA9PT0gJ3Byb2R1Y3Rpb24nKSB7XHJcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdGcm9udGVuZFVybCcsIHtcclxuICAgICAgICBkZXNjcmlwdGlvbjogJ0Zyb250ZW5kIFVSTCcsXHJcbiAgICAgICAgdmFsdWU6IGNvcnNPcmlnaW4gfHwgJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvL2F1dG9tYXRlZC1ibG9nLXBvc3RlcicsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxufSJdfQ==