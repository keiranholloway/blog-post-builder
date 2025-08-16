import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class AutomatedBlogPosterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Tables
    const contentTable = new dynamodb.Table(this, 'ContentTable', {
      tableName: 'automated-blog-poster-content',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userTable = new dynamodb.Table(this, 'UserTable', {
      tableName: 'automated-blog-poster-users',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // S3 Buckets
    const audioBucket = new s3.Bucket(this, 'AudioBucket', {
      bucketName: `automated-blog-poster-audio-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{
        id: 'DeleteAudioFiles',
        expiration: cdk.Duration.days(7), // Auto-delete audio files after 7 days
      }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const imageBucket = new s3.Bucket(this, 'ImageBucket', {
      bucketName: `automated-blog-poster-images-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
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

    // Lambda function for API handling
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type',
              'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
            },
            body: JSON.stringify({
              message: 'Automated Blog Poster API',
              version: '1.0.0'
            }),
          };
        };
      `),
      environment: {
        CONTENT_TABLE_NAME: contentTable.tableName,
        USER_TABLE_NAME: userTable.tableName,
        AUDIO_BUCKET_NAME: audioBucket.bucketName,
        IMAGE_BUCKET_NAME: imageBucket.bucketName,
        AGENT_QUEUE_URL: agentQueue.queueUrl,
        EVENT_BUS_NAME: eventBus.eventBusName,
        PLATFORM_CREDENTIALS_SECRET: platformCredentials.secretArn,
      },
    });

    // Grant permissions
    contentTable.grantReadWriteData(apiHandler);
    userTable.grantReadWriteData(apiHandler);
    audioBucket.grantReadWrite(apiHandler);
    imageBucket.grantReadWrite(apiHandler);
    agentQueue.grantSendMessages(apiHandler);
    eventBus.grantPutEventsTo(apiHandler);
    platformCredentials.grantRead(apiHandler);

    // API Gateway
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'Automated Blog Poster API',
      description: 'API for the automated blog poster system',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const apiIntegration = new apigateway.LambdaIntegration(apiHandler);
    api.root.addMethod('GET', apiIntegration);
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
  }
}