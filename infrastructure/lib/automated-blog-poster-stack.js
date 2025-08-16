"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomatedBlogPosterStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const s3 = require("aws-cdk-lib/aws-s3");
const events = require("aws-cdk-lib/aws-events");
const sqs = require("aws-cdk-lib/aws-sqs");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const iam = require("aws-cdk-lib/aws-iam");
const targets = require("aws-cdk-lib/aws-events-targets");
const eventsources = require("aws-cdk-lib/aws-lambda-event-sources");
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
        // SQS event source mappings for content orchestrator
        contentOrchestrator.addEventSource(new eventsources.SqsEventSource(contentGenerationQueue, {
            batchSize: 1, // Process one message at a time for better error handling
        }));
        contentOrchestrator.addEventSource(new eventsources.SqsEventSource(imageGenerationQueue, {
            batchSize: 1, // Process one message at a time for better error handling
        }));
        // API Gateway with GitHub Pages optimized CORS
        const api = new apigateway.RestApi(this, 'Api', {
            restApiName: 'Automated Blog Poster API',
            description: 'API for the automated blog poster system',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
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
exports.AutomatedBlogPosterStack = AutomatedBlogPosterStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQseURBQXlEO0FBQ3pELHFEQUFxRDtBQUNyRCx5Q0FBeUM7QUFDekMsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQyxpRUFBaUU7QUFDakUsMkNBQTJDO0FBQzNDLDBEQUEwRDtBQUMxRCxxRUFBcUU7QUFFckUsTUFBYSx3QkFBeUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNyRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLHNDQUFzQztRQUN0QyxNQUFNLFlBQVksR0FBRyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUM1RCxTQUFTLEVBQUUsaUNBQWlDLElBQUksQ0FBQyxHQUFHLEVBQUUsRUFBRTtZQUN4RCxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNqRSxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELFVBQVUsRUFBRSxRQUFRLENBQUMsZUFBZSxDQUFDLFdBQVc7WUFDaEQsbUJBQW1CLEVBQUUsSUFBSTtZQUN6QixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNO1NBQ3hDLENBQUMsQ0FBQztRQUVILG1DQUFtQztRQUNuQyxZQUFZLENBQUMsdUJBQXVCLENBQUM7WUFDbkMsU0FBUyxFQUFFLGFBQWE7WUFDeEIsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFD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RSwwQkFBMEI7U0FDeEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN6QyxLQUFLLEVBQUUsV0FBVyxDQUFDLFVBQVU7WUFDN0IsV0FBVyxFQUFFLHNCQUFzQjtTQUNwQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ3pDLEtBQUssRUFBRSxXQUFXLENBQUMsVUFBVTtZQUM3QixXQUFXLEVBQUUsc0JBQXNCO1NBQ3BDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDaEQsS0FBSyxFQUFFLGtCQUFrQixDQUFDLFNBQVM7WUFDbkMsV0FBVyxFQUFFLG9DQUFvQztTQUNsRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN2QyxLQUFLLEVBQUUsVUFBVSxDQUFDLFFBQVE7WUFDMUIsV0FBVyxFQUFFLHFCQUFxQjtTQUNuQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUN0QyxLQUFLLEVBQUUsUUFBUSxDQUFDLFlBQVk7WUFDNUIsV0FBVyxFQUFFLDRCQUE0QjtTQUMxQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFsWUQsNERBa1lDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XHJcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XHJcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcclxuaW1wb3J0ICogYXMgc3FzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnO1xyXG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcclxuaW1wb3J0ICogYXMgZXZlbnRzb3VyY2VzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlcyc7XHJcblxyXG5leHBvcnQgY2xhc3MgQXV0b21hdGVkQmxvZ1Bvc3RlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBEeW5hbW9EQiBUYWJsZXMgd2l0aCBwcm9wZXIgaW5kZXhlc1xyXG4gICAgY29uc3QgY29udGVudFRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDb250ZW50VGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LSR7RGF0ZS5ub3coKX1gLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIGNvbnRlbnQgYnkgdXNlclxyXG4gICAgY29udGVudFRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnVXNlcklkSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIGNvbnRlbnQgYnkgc3RhdHVzXHJcbiAgICBjb250ZW50VGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdTdGF0dXNJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAndXBkYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHVzZXJUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVXNlclRhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItdXNlcnMtJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgdXNlcnMgYnkgZW1haWxcclxuICAgIHVzZXJUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0VtYWlsSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2VtYWlsJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFnZW50IE1lc3NhZ2VzIFRhYmxlIGZvciB0cmFja2luZyBhZ2VudCBjb21tdW5pY2F0aW9uc1xyXG4gICAgY29uc3QgYWdlbnRNZXNzYWdlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdBZ2VudE1lc3NhZ2VzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1hZ2VudC1tZXNzYWdlcy0ke0RhdGUubm93KCl9YCxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5BV1NfTUFOQUdFRCxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBtZXNzYWdlcyBieSBjb250ZW50IElEXHJcbiAgICBhZ2VudE1lc3NhZ2VzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdDb250ZW50SWRJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY29udGVudElkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdTSSBmb3IgcXVlcnlpbmcgbWVzc2FnZXMgYnkgc3RhdHVzXHJcbiAgICBhZ2VudE1lc3NhZ2VzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xyXG4gICAgICBpbmRleE5hbWU6ICdTdGF0dXNJbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFMzIEJ1Y2tldHMgd2l0aCBjb21wcmVoZW5zaXZlIGxpZmVjeWNsZSBwb2xpY2llc1xyXG4gICAgY29uc3QgYXVkaW9CdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdBdWRpb0J1Y2tldCcsIHtcclxuICAgICAgYnVja2V0TmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci1hdWRpby0ke3RoaXMuYWNjb3VudH0tJHtEYXRlLm5vdygpfWAsXHJcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBpZDogJ0RlbGV0ZUF1ZGlvRmlsZXMnLFxyXG4gICAgICAgICAgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksIC8vIEF1dG8tZGVsZXRlIGF1ZGlvIGZpbGVzIGFmdGVyIDcgZGF5c1xyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGltYWdlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnSW1hZ2VCdWNrZXQnLCB7XHJcbiAgICAgIGJ1Y2tldE5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2VzLSR7dGhpcy5hY2NvdW50fS0ke0RhdGUubm93KCl9YCxcclxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxyXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGlkOiAnVHJhbnNpdGlvblRvSUEnLFxyXG4gICAgICAgICAgdHJhbnNpdGlvbnM6IFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLklORlJFUVVFTlRfQUNDRVNTLFxyXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoMzApLCAvLyBNb3ZlIHRvIElBIGFmdGVyIDMwIGRheXNcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXHJcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksIC8vIE1vdmUgdG8gR2xhY2llciBhZnRlciA5MCBkYXlzXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNRUyBRdWV1ZXMgZm9yIGFnZW50IGNvbW11bmljYXRpb25cclxuICAgIGNvbnN0IGFnZW50UXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdBZ2VudFF1ZXVlJywge1xyXG4gICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYWdlbnRzJyxcclxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcclxuICAgICAgZGVhZExldHRlclF1ZXVlOiB7XHJcbiAgICAgICAgcXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0FnZW50RExRJywge1xyXG4gICAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWFnZW50cy1kbHEnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogMyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV2ZW50QnJpZGdlIGZvciBldmVudC1kcml2ZW4gYXJjaGl0ZWN0dXJlXHJcbiAgICBjb25zdCBldmVudEJ1cyA9IG5ldyBldmVudHMuRXZlbnRCdXModGhpcywgJ0V2ZW50QnVzJywge1xyXG4gICAgICBldmVudEJ1c05hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItZXZlbnRzJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNlY3JldHMgTWFuYWdlciBmb3IgcGxhdGZvcm0gY3JlZGVudGlhbHNcclxuICAgIGNvbnN0IHBsYXRmb3JtQ3JlZGVudGlhbHMgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdQbGF0Zm9ybUNyZWRlbnRpYWxzJywge1xyXG4gICAgICBzZWNyZXROYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyL3BsYXRmb3JtLWNyZWRlbnRpYWxzJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdPQXV0aCBjcmVkZW50aWFscyBmb3IgcHVibGlzaGluZyBwbGF0Zm9ybXMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGZvciBBUEkgaGFuZGxpbmcgd2l0aCBwcm9wZXIgZXJyb3IgaGFuZGxpbmdcclxuICAgIGNvbnN0IGFwaUhhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBcGlIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2FwaS1oYW5kbGVyLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFX05BTUU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgVVNFUl9UQUJMRV9OQU1FOiB1c2VyVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEFHRU5UX01FU1NBR0VTX1RBQkxFX05BTUU6IGFnZW50TWVzc2FnZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQVVESU9fQlVDS0VUX05BTUU6IGF1ZGlvQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgSU1BR0VfQlVDS0VUX05BTUU6IGltYWdlQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgQUdFTlRfUVVFVUVfVVJMOiBhZ2VudFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgUExBVEZPUk1fQ1JFREVOVElBTFNfU0VDUkVUOiBwbGF0Zm9ybUNyZWRlbnRpYWxzLnNlY3JldEFybixcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0FwaUhhbmRsZXJETFEnLCB7XHJcbiAgICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWFwaS1kbHEnLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgaW5wdXQgcHJvY2Vzc2luZyAoYXVkaW8gYW5kIHRleHQpXHJcbiAgICBjb25zdCBpbnB1dFByb2Nlc3NvciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0lucHV0UHJvY2Vzc29yJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2lucHV0LXByb2Nlc3Nvci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksIC8vIExvbmdlciB0aW1lb3V0IGZvciBhdWRpbyBwcm9jZXNzaW5nXHJcbiAgICAgIG1lbW9yeVNpemU6IDUxMiwgLy8gTW9yZSBtZW1vcnkgZm9yIGF1ZGlvIHByb2Nlc3NpbmdcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFX05BTUU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQVVESU9fQlVDS0VUX05BTUU6IGF1ZGlvQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgRVZFTlRfQlVTX05BTUU6IGV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcclxuICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IG5ldyBzcXMuUXVldWUodGhpcywgJ0lucHV0UHJvY2Vzc29yRExRJywge1xyXG4gICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1pbnB1dC1wcm9jZXNzb3ItZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTUVMgUXVldWVzIGZvciBhZ2VudCBjb21tdW5pY2F0aW9uXHJcbiAgICBjb25zdCBjb250ZW50R2VuZXJhdGlvblF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQ29udGVudEdlbmVyYXRpb25RdWV1ZScsIHtcclxuICAgICAgcXVldWVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWNvbnRlbnQtZ2VuZXJhdGlvbicsXHJcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xyXG4gICAgICAgIHF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdDb250ZW50R2VuZXJhdGlvbkRMUScsIHtcclxuICAgICAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50LWdlbmVyYXRpb24tZGxxJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBpbWFnZUdlbmVyYXRpb25RdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ0ltYWdlR2VuZXJhdGlvblF1ZXVlJywge1xyXG4gICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2UtZ2VuZXJhdGlvbicsXHJcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxMCksXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xyXG4gICAgICAgIHF1ZXVlOiBuZXcgc3FzLlF1ZXVlKHRoaXMsICdJbWFnZUdlbmVyYXRpb25ETFEnLCB7XHJcbiAgICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2UtZ2VuZXJhdGlvbi1kbHEnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogMyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgY29udGVudCBvcmNoZXN0cmF0aW9uXHJcbiAgICBjb25zdCBjb250ZW50T3JjaGVzdHJhdG9yID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ29udGVudE9yY2hlc3RyYXRvcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdjb250ZW50LW9yY2hlc3RyYXRvci5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEnKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05URU5UX1RBQkxFX05BTUU6IGNvbnRlbnRUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQUdFTlRfTUVTU0FHRVNfVEFCTEVfTkFNRTogYWdlbnRNZXNzYWdlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBDT05URU5UX0dFTkVSQVRJT05fUVVFVUVfVVJMOiBjb250ZW50R2VuZXJhdGlvblF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIElNQUdFX0dFTkVSQVRJT05fUVVFVUVfVVJMOiBpbWFnZUdlbmVyYXRpb25RdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxyXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXHJcbiAgICAgIH0sXHJcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQ29udGVudE9yY2hlc3RyYXRvckRMUScsIHtcclxuICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItY29udGVudC1vcmNoZXN0cmF0b3ItZGxxJyxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyBmb3IgQVBJIEhhbmRsZXJcclxuICAgIGNvbnRlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYXBpSGFuZGxlcik7XHJcbiAgICB1c2VyVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXIpO1xyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlIYW5kbGVyKTtcclxuICAgIGF1ZGlvQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwaUhhbmRsZXIpO1xyXG4gICAgaW1hZ2VCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoYXBpSGFuZGxlcik7XHJcbiAgICBhZ2VudFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGFwaUhhbmRsZXIpO1xyXG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhhcGlIYW5kbGVyKTtcclxuICAgIHBsYXRmb3JtQ3JlZGVudGlhbHMuZ3JhbnRSZWFkKGFwaUhhbmRsZXIpO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBJbnB1dCBQcm9jZXNzb3JcclxuICAgIGNvbnRlbnRUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoaW5wdXRQcm9jZXNzb3IpO1xyXG4gICAgYXVkaW9CdWNrZXQuZ3JhbnRSZWFkV3JpdGUoaW5wdXRQcm9jZXNzb3IpO1xyXG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhpbnB1dFByb2Nlc3Nvcik7XHJcbiAgICBcclxuICAgIC8vIEdyYW50IFRyYW5zY3JpYmUgcGVybWlzc2lvbnMgdG8gSW5wdXQgUHJvY2Vzc29yXHJcbiAgICBpbnB1dFByb2Nlc3Nvci5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXHJcbiAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAndHJhbnNjcmliZTpTdGFydFRyYW5zY3JpcHRpb25Kb2InLFxyXG4gICAgICAgICd0cmFuc2NyaWJlOkdldFRyYW5zY3JpcHRpb25Kb2InLFxyXG4gICAgICAgICd0cmFuc2NyaWJlOkxpc3RUcmFuc2NyaXB0aW9uSm9icycsXHJcbiAgICAgIF0sXHJcbiAgICAgIHJlc291cmNlczogWycqJ10sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIENvbnRlbnQgT3JjaGVzdHJhdG9yXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGNvbnRlbnRPcmNoZXN0cmF0b3IpO1xyXG4gICAgYWdlbnRNZXNzYWdlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGNvbnRlbnRHZW5lcmF0aW9uUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBpbWFnZUdlbmVyYXRpb25RdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGNvbnRlbnRHZW5lcmF0aW9uUXVldWUuZ3JhbnRDb25zdW1lTWVzc2FnZXMoY29udGVudE9yY2hlc3RyYXRvcik7XHJcbiAgICBpbWFnZUdlbmVyYXRpb25RdWV1ZS5ncmFudENvbnN1bWVNZXNzYWdlcyhjb250ZW50T3JjaGVzdHJhdG9yKTtcclxuICAgIGV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8oY29udGVudE9yY2hlc3RyYXRvcik7XHJcblxyXG4gICAgLy8gRXZlbnRCcmlkZ2UgcnVsZXMgdG8gdHJpZ2dlciBjb250ZW50IG9yY2hlc3RyYXRvclxyXG4gICAgY29uc3QgaW5wdXRQcm9jZXNzb3JSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdJbnB1dFByb2Nlc3NvclJ1bGUnLCB7XHJcbiAgICAgIGV2ZW50QnVzOiBldmVudEJ1cyxcclxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XHJcbiAgICAgICAgc291cmNlOiBbJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5pbnB1dC1wcm9jZXNzb3InXSxcclxuICAgICAgICBkZXRhaWxUeXBlOiBbJ0F1ZGlvIFByb2Nlc3NpbmcgQ29tcGxldGVkJywgJ1RleHQgUHJvY2Vzc2luZyBDb21wbGV0ZWQnXSxcclxuICAgICAgfSxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGNvbnRlbnRPcmNoZXN0cmF0b3IpXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbnRlbnRBZ2VudFJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0NvbnRlbnRBZ2VudFJ1bGUnLCB7XHJcbiAgICAgIGV2ZW50QnVzOiBldmVudEJ1cyxcclxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XHJcbiAgICAgICAgc291cmNlOiBbJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5jb250ZW50LWFnZW50J10sXHJcbiAgICAgICAgZGV0YWlsVHlwZTogWydDb250ZW50IEdlbmVyYXRpb24gQ29tcGxldGVkJywgJ0NvbnRlbnQgR2VuZXJhdGlvbiBGYWlsZWQnXSxcclxuICAgICAgfSxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGNvbnRlbnRPcmNoZXN0cmF0b3IpXSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGltYWdlQWdlbnRSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdJbWFnZUFnZW50UnVsZScsIHtcclxuICAgICAgZXZlbnRCdXM6IGV2ZW50QnVzLFxyXG4gICAgICBldmVudFBhdHRlcm46IHtcclxuICAgICAgICBzb3VyY2U6IFsnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmltYWdlLWFnZW50J10sXHJcbiAgICAgICAgZGV0YWlsVHlwZTogWydJbWFnZSBHZW5lcmF0aW9uIENvbXBsZXRlZCcsICdJbWFnZSBHZW5lcmF0aW9uIEZhaWxlZCddLFxyXG4gICAgICB9LFxyXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24oY29udGVudE9yY2hlc3RyYXRvcildLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU1FTIGV2ZW50IHNvdXJjZSBtYXBwaW5ncyBmb3IgY29udGVudCBvcmNoZXN0cmF0b3JcclxuICAgIGNvbnRlbnRPcmNoZXN0cmF0b3IuYWRkRXZlbnRTb3VyY2UobmV3IGV2ZW50c291cmNlcy5TcXNFdmVudFNvdXJjZShjb250ZW50R2VuZXJhdGlvblF1ZXVlLCB7XHJcbiAgICAgIGJhdGNoU2l6ZTogMSwgLy8gUHJvY2VzcyBvbmUgbWVzc2FnZSBhdCBhIHRpbWUgZm9yIGJldHRlciBlcnJvciBoYW5kbGluZ1xyXG4gICAgfSkpO1xyXG5cclxuICAgIGNvbnRlbnRPcmNoZXN0cmF0b3IuYWRkRXZlbnRTb3VyY2UobmV3IGV2ZW50c291cmNlcy5TcXNFdmVudFNvdXJjZShpbWFnZUdlbmVyYXRpb25RdWV1ZSwge1xyXG4gICAgICBiYXRjaFNpemU6IDEsIC8vIFByb2Nlc3Mgb25lIG1lc3NhZ2UgYXQgYSB0aW1lIGZvciBiZXR0ZXIgZXJyb3IgaGFuZGxpbmdcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBBUEkgR2F0ZXdheSB3aXRoIEdpdEh1YiBQYWdlcyBvcHRpbWl6ZWQgQ09SU1xyXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQXBpJywge1xyXG4gICAgICByZXN0QXBpTmFtZTogJ0F1dG9tYXRlZCBCbG9nIFBvc3RlciBBUEknLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBmb3IgdGhlIGF1dG9tYXRlZCBibG9nIHBvc3RlciBzeXN0ZW0nLFxyXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcclxuICAgICAgICBhbGxvd09yaWdpbnM6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUywgLy8gQWxsb3cgYWxsIG9yaWdpbnMgZm9yIG5vd1xyXG4gICAgICAgIGFsbG93TWV0aG9kczogWydHRVQnLCAnUE9TVCcsICdQVVQnLCAnREVMRVRFJywgJ09QVElPTlMnXSxcclxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnLFxyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nLFxyXG4gICAgICAgICAgJ1gtQW16LURhdGUnLFxyXG4gICAgICAgICAgJ1gtQXBpLUtleScsXHJcbiAgICAgICAgICAnWC1BbXotU2VjdXJpdHktVG9rZW4nLFxyXG4gICAgICAgICAgJ1gtUmVxdWVzdGVkLVdpdGgnLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgZGVwbG95T3B0aW9uczoge1xyXG4gICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxyXG4gICAgICAgIHRocm90dGxpbmdSYXRlTGltaXQ6IDEwMCxcclxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogMjAwLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYXBpSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhcGlIYW5kbGVyKTtcclxuICAgIGNvbnN0IGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihpbnB1dFByb2Nlc3Nvcik7XHJcblxyXG4gICAgLy8gUm9vdCBhbmQgZ2VuZXJhbCBBUEkgcm91dGVzXHJcbiAgICBhcGkucm9vdC5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gQVBJIHJlc291cmNlIGZvciBnZW5lcmFsIGVuZHBvaW50c1xyXG4gICAgY29uc3QgYXBpUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnYXBpJyk7XHJcbiAgICBhcGlSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGFwaUludGVncmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gU3RhdHVzIGVuZHBvaW50XHJcbiAgICBjb25zdCBzdGF0dXNSZXNvdXJjZSA9IGFwaVJlc291cmNlLmFkZFJlc291cmNlKCdzdGF0dXMnKTtcclxuICAgIHN0YXR1c1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBJbnB1dCBwcm9jZXNzaW5nIGVuZHBvaW50c1xyXG4gICAgY29uc3QgaW5wdXRSZXNvdXJjZSA9IGFwaVJlc291cmNlLmFkZFJlc291cmNlKCdpbnB1dCcpO1xyXG4gICAgXHJcbiAgICAvLyBBdWRpbyBpbnB1dCBlbmRwb2ludFxyXG4gICAgY29uc3QgYXVkaW9SZXNvdXJjZSA9IGlucHV0UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2F1ZGlvJyk7XHJcbiAgICBhdWRpb1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGlucHV0UHJvY2Vzc29ySW50ZWdyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBUZXh0IGlucHV0IGVuZHBvaW50XHJcbiAgICBjb25zdCB0ZXh0UmVzb3VyY2UgPSBpbnB1dFJlc291cmNlLmFkZFJlc291cmNlKCd0ZXh0Jyk7XHJcbiAgICB0ZXh0UmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgaW5wdXRQcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFN0YXR1cyBjaGVja2luZyBlbmRwb2ludFxyXG4gICAgY29uc3QgaW5wdXRTdGF0dXNSZXNvdXJjZSA9IGlucHV0UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3N0YXR1cycpO1xyXG4gICAgY29uc3QgaW5wdXRTdGF0dXNJZFJlc291cmNlID0gaW5wdXRTdGF0dXNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xyXG4gICAgaW5wdXRTdGF0dXNJZFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgaW5wdXRQcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFRyYW5zY3JpcHRpb24gY2FsbGJhY2sgZW5kcG9pbnRcclxuICAgIGNvbnN0IHRyYW5zY3JpcHRpb25DYWxsYmFja1Jlc291cmNlID0gaW5wdXRSZXNvdXJjZS5hZGRSZXNvdXJjZSgndHJhbnNjcmlwdGlvbi1jYWxsYmFjaycpO1xyXG4gICAgdHJhbnNjcmlwdGlvbkNhbGxiYWNrUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgaW5wdXRQcm9jZXNzb3JJbnRlZ3JhdGlvbik7XHJcblxyXG4gICAgLy8gQ2F0Y2gtYWxsIHByb3h5IGZvciBhbnkgb3RoZXIgcm91dGVzIChoYW5kbGVkIGJ5IGFwaUhhbmRsZXIpXHJcbiAgICBhcGkucm9vdC5hZGRQcm94eSh7XHJcbiAgICAgIGRlZmF1bHRJbnRlZ3JhdGlvbjogYXBpSW50ZWdyYXRpb24sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXRzXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpVXJsJywge1xyXG4gICAgICB2YWx1ZTogYXBpLnVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBVUkwnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NvbnRlbnRUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBjb250ZW50VGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIENvbnRlbnQgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclRhYmxlTmFtZScsIHtcclxuICAgICAgdmFsdWU6IHVzZXJUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgVXNlciBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBdWRpb0J1Y2tldE5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBhdWRpb0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIEF1ZGlvIEJ1Y2tldCBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJbWFnZUJ1Y2tldE5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBpbWFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIEltYWdlIEJ1Y2tldCBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZ2VudE1lc3NhZ2VzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogYWdlbnRNZXNzYWdlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBBZ2VudCBNZXNzYWdlcyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBZ2VudFF1ZXVlVXJsJywge1xyXG4gICAgICB2YWx1ZTogYWdlbnRRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdTUVMgQWdlbnQgUXVldWUgVVJMJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFdmVudEJ1c05hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRCcmlkZ2UgRXZlbnQgQnVzIE5hbWUnLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19