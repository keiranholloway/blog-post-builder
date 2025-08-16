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
class AutomatedBlogPosterStack extends cdk.Stack {
    constructor(scope, id, props) {
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
            runtime: lambda.Runtime.NODEJS_18_X,
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
exports.AutomatedBlogPosterStack = AutomatedBlogPosterStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQyxpREFBaUQ7QUFDakQseURBQXlEO0FBQ3pELHFEQUFxRDtBQUNyRCx5Q0FBeUM7QUFDekMsaURBQWlEO0FBQ2pELDJDQUEyQztBQUMzQyxpRUFBaUU7QUFFakUsTUFBYSx3QkFBeUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNyRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLGtCQUFrQjtRQUNsQixNQUFNLFlBQVksR0FBRyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUM1RCxTQUFTLEVBQUUsK0JBQStCO1lBQzFDLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQ2pFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsVUFBVSxFQUFFLFFBQVEsQ0FBQyxlQUFlLENBQUMsV0FBVztZQUNoRCxtQkFBbUIsRUFBRSxJQUFJO1lBQ3pCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07U0FDeEMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxTQUFTLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDdEQsU0FBUyxFQUFFLDZCQUE2QjtZQUN4QyxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNqRSxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELFVBQVUsRUFBRSxRQUFRLENBQUMsZUFBZSxDQUFDLFdBQVc7WUFDaEQsbUJBQW1CLEVBQUUsSUFBSTtZQUN6QixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNO1NBQ3hDLENBQUMsQ0FBQztRQUVILGFBQWE7UUFDYixNQUFNLFdBQVcsR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUNyRCxVQUFVLEVBQUUsK0JBQStCLElBQUksQ0FBQyxPQUFPLEVBQUU7WUFDekQsVUFBVSxFQUFFLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVO1lBQzFDLGlCQUFpQixFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTO1lBQ2pELGNBQWMsRUFBRSxDQUFDO29CQUNmLEVBQUUsRUFBRSxrQkFBa0I7b0JBQ3RCLFVBQVUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSx1Q0FBdUM7aUJBQzFFLENBQUM7WUFDRixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNO1NBQ3hDLENBQUMsQ0FBQztRQUVILE1BQU0sV0FBVyxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3JELFVBQVUsRUFBRSxnQ0FBZ0MsSUFBSSxDQUFDLE9BQU8sRUFBRTtZQUMxRCxVQUFVLEVBQUUsRUFBRSxDQUFDLGdCQUFnQixDQUFDLFVBQVU7WUFDMUMsaUJBQWlCLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVM7WUFDakQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtTQUN4QyxDQUFDLENBQUM7UUFFSCxxQ0FBcUM7UUFDckMsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDbkQsU0FBUyxFQUFFLDhCQUE4QjtZQUN6QyxpQkFBaUIsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDM0MsZUFBZSxFQUFFO2dCQUNmLEtBQUssRUFBRSxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtvQkFDckMsU0FBUyxFQUFFLGtDQUFrQztpQkFDOUMsQ0FBQztnQkFDRixlQUFlLEVBQUUsQ0FBQzthQUNuQjtTQUNGLENBQUMsQ0FBQztRQUVILDRDQUE0QztRQUM1QyxNQUFNLFFBQVEsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUNyRCxZQUFZLEVBQUUsOEJBQThCO1NBQzdDLENBQUMsQ0FBQztRQUVILDJDQUEyQztRQUMzQyxNQUFNLG1CQUFtQixHQUFHLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDakYsVUFBVSxFQUFFLDRDQUE0QztZQUN4RCxXQUFXLEVBQUUsNENBQTRDO1NBQzFELENBQUMsQ0FBQztRQUVILG1DQUFtQztRQUNuQyxNQUFNLFVBQVUsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUN6RCxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLE9BQU8sRUFBRSxlQUFlO1lBQ3hCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7Ozs7Ozs7O09BZTVCLENBQUM7WUFDRixXQUFXLEVBQUU7Z0JBQ1gsa0JBQWtCLEVBQUUsWUFBWSxDQUFDLFNBQVM7Z0JBQzFDLGVBQWUsRUFBRSxTQUFTLENBQUMsU0FBUztnQkFDcEMsaUJBQWlCLEVBQUUsV0FBVyxDQUFDLFVBQVU7Z0JBQ3pDLGlCQUFpQixFQUFFLFdBQVcsQ0FBQyxVQUFVO2dCQUN6QyxlQUFlLEVBQUUsVUFBVSxDQUFDLFFBQVE7Z0JBQ3BDLGNBQWMsRUFBRSxRQUFRLENBQUMsWUFBWTtnQkFDckMsMkJBQTJCLEVBQUUsbUJBQW1CLENBQUMsU0FBUzthQUMzRDtTQUNGLENBQUMsQ0FBQztRQUVILG9CQUFvQjtRQUNwQixZQUFZLENBQUMsa0JBQWtCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDNUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3pDLFdBQVcsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDdkMsV0FBVyxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN2QyxVQUFVLENBQUMsaUJBQWlCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDekMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3RDLG1CQUFtQixDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUUxQyxjQUFjO1FBQ2QsTUFBTSxHQUFHLEdBQUcsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDOUMsV0FBVyxFQUFFLDJCQUEyQjtZQUN4QyxXQUFXLEVBQUUsMENBQTBDO1lBQ3ZELDJCQUEyQixFQUFFO2dCQUMzQixZQUFZLEVBQUUsVUFBVSxDQUFDLElBQUksQ0FBQyxXQUFXO2dCQUN6QyxZQUFZLEVBQUUsVUFBVSxDQUFDLElBQUksQ0FBQyxXQUFXO2dCQUN6QyxZQUFZLEVBQUUsQ0FBQyxjQUFjLEVBQUUsZUFBZSxDQUFDO2FBQ2hEO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsTUFBTSxjQUFjLEdBQUcsSUFBSSxVQUFVLENBQUMsaUJBQWlCLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDcEUsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQzFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO1lBQ2hCLGtCQUFrQixFQUFFLGNBQWM7U0FDbkMsQ0FBQyxDQUFDO1FBRUgsVUFBVTtRQUNWLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFO1lBQ2hDLEtBQUssRUFBRSxHQUFHLENBQUMsR0FBRztZQUNkLFdBQVcsRUFBRSxpQkFBaUI7U0FDL0IsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsWUFBWSxDQUFDLFNBQVM7WUFDN0IsV0FBVyxFQUFFLDZCQUE2QjtTQUMzQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN2QyxLQUFLLEVBQUUsU0FBUyxDQUFDLFNBQVM7WUFDMUIsV0FBVyxFQUFFLDBCQUEwQjtTQUN4QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ3pDLEtBQUssRUFBRSxXQUFXLENBQUMsVUFBVTtZQUM3QixXQUFXLEVBQUUsc0JBQXNCO1NBQ3BDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDekMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxVQUFVO1lBQzdCLFdBQVcsRUFBRSxzQkFBc0I7U0FDcEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBcEpELDREQW9KQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcclxuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcclxuXHJcbmV4cG9ydCBjbGFzcyBBdXRvbWF0ZWRCbG9nUG9zdGVyU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIER5bmFtb0RCIFRhYmxlc1xyXG4gICAgY29uc3QgY29udGVudFRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdDb250ZW50VGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1jb250ZW50JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5BV1NfTUFOQUdFRCxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgdXNlclRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdVc2VyVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci11c2VycycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFMzIEJ1Y2tldHNcclxuICAgIGNvbnN0IGF1ZGlvQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQXVkaW9CdWNrZXQnLCB7XHJcbiAgICAgIGJ1Y2tldE5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYXVkaW8tJHt0aGlzLmFjY291bnR9YCxcclxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxyXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxyXG4gICAgICBsaWZlY3ljbGVSdWxlczogW3tcclxuICAgICAgICBpZDogJ0RlbGV0ZUF1ZGlvRmlsZXMnLFxyXG4gICAgICAgIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDcpLCAvLyBBdXRvLWRlbGV0ZSBhdWRpbyBmaWxlcyBhZnRlciA3IGRheXNcclxuICAgICAgfV0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGltYWdlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnSW1hZ2VCdWNrZXQnLCB7XHJcbiAgICAgIGJ1Y2tldE5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItaW1hZ2VzLSR7dGhpcy5hY2NvdW50fWAsXHJcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcclxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU1FTIFF1ZXVlcyBmb3IgYWdlbnQgY29tbXVuaWNhdGlvblxyXG4gICAgY29uc3QgYWdlbnRRdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ0FnZW50UXVldWUnLCB7XHJcbiAgICAgIHF1ZXVlTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1hZ2VudHMnLFxyXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxyXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcclxuICAgICAgICBxdWV1ZTogbmV3IHNxcy5RdWV1ZSh0aGlzLCAnQWdlbnRETFEnLCB7XHJcbiAgICAgICAgICBxdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYWdlbnRzLWRscScsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRXZlbnRCcmlkZ2UgZm9yIGV2ZW50LWRyaXZlbiBhcmNoaXRlY3R1cmVcclxuICAgIGNvbnN0IGV2ZW50QnVzID0gbmV3IGV2ZW50cy5FdmVudEJ1cyh0aGlzLCAnRXZlbnRCdXMnLCB7XHJcbiAgICAgIGV2ZW50QnVzTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1ldmVudHMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU2VjcmV0cyBNYW5hZ2VyIGZvciBwbGF0Zm9ybSBjcmVkZW50aWFsc1xyXG4gICAgY29uc3QgcGxhdGZvcm1DcmVkZW50aWFscyA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgJ1BsYXRmb3JtQ3JlZGVudGlhbHMnLCB7XHJcbiAgICAgIHNlY3JldE5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIvcGxhdGZvcm0tY3JlZGVudGlhbHMnLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ09BdXRoIGNyZWRlbnRpYWxzIGZvciBwdWJsaXNoaW5nIHBsYXRmb3JtcycsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIEFQSSBoYW5kbGluZ1xyXG4gICAgY29uc3QgYXBpSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0FwaUhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoYFxyXG4gICAgICAgIGV4cG9ydHMuaGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcclxuICAgICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUnLFxyXG4gICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ09QVElPTlMsUE9TVCxHRVQnLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgICAgbWVzc2FnZTogJ0F1dG9tYXRlZCBCbG9nIFBvc3RlciBBUEknLFxyXG4gICAgICAgICAgICAgIHZlcnNpb246ICcxLjAuMCdcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH07XHJcbiAgICAgIGApLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIENPTlRFTlRfVEFCTEVfTkFNRTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBVU0VSX1RBQkxFX05BTUU6IHVzZXJUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgQVVESU9fQlVDS0VUX05BTUU6IGF1ZGlvQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgSU1BR0VfQlVDS0VUX05BTUU6IGltYWdlQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgQUdFTlRfUVVFVUVfVVJMOiBhZ2VudFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgUExBVEZPUk1fQ1JFREVOVElBTFNfU0VDUkVUOiBwbGF0Zm9ybUNyZWRlbnRpYWxzLnNlY3JldEFybixcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zXHJcbiAgICBjb250ZW50VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFwaUhhbmRsZXIpO1xyXG4gICAgdXNlclRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhcGlIYW5kbGVyKTtcclxuICAgIGF1ZGlvQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwaUhhbmRsZXIpO1xyXG4gICAgaW1hZ2VCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoYXBpSGFuZGxlcik7XHJcbiAgICBhZ2VudFF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGFwaUhhbmRsZXIpO1xyXG4gICAgZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyhhcGlIYW5kbGVyKTtcclxuICAgIHBsYXRmb3JtQ3JlZGVudGlhbHMuZ3JhbnRSZWFkKGFwaUhhbmRsZXIpO1xyXG5cclxuICAgIC8vIEFQSSBHYXRld2F5XHJcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdBcGknLCB7XHJcbiAgICAgIHJlc3RBcGlOYW1lOiAnQXV0b21hdGVkIEJsb2cgUG9zdGVyIEFQSScsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIGZvciB0aGUgYXV0b21hdGVkIGJsb2cgcG9zdGVyIHN5c3RlbScsXHJcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xyXG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxyXG4gICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxyXG4gICAgICAgIGFsbG93SGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnQXV0aG9yaXphdGlvbiddLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYXBpSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihhcGlIYW5kbGVyKTtcclxuICAgIGFwaS5yb290LmFkZE1ldGhvZCgnR0VUJywgYXBpSW50ZWdyYXRpb24pO1xyXG4gICAgYXBpLnJvb3QuYWRkUHJveHkoe1xyXG4gICAgICBkZWZhdWx0SW50ZWdyYXRpb246IGFwaUludGVncmF0aW9uLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0c1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaVVybCcsIHtcclxuICAgICAgdmFsdWU6IGFwaS51cmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIEdhdGV3YXkgVVJMJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDb250ZW50VGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogY29udGVudFRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBDb250ZW50IFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB1c2VyVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFVzZXIgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXVkaW9CdWNrZXROYW1lJywge1xyXG4gICAgICB2YWx1ZTogYXVkaW9CdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdTMyBBdWRpbyBCdWNrZXQgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSW1hZ2VCdWNrZXROYW1lJywge1xyXG4gICAgICB2YWx1ZTogaW1hZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdTMyBJbWFnZSBCdWNrZXQgTmFtZScsXHJcbiAgICB9KTtcclxuICB9XHJcbn0iXX0=