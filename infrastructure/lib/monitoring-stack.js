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
exports.MonitoringStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const cloudwatchActions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const subscriptions = __importStar(require("aws-cdk-lib/aws-sns-subscriptions"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
class MonitoringStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // SNS Topic for alerts
        this.alertTopic = new sns.Topic(this, 'AlertTopic', {
            topicName: 'automated-blog-poster-alerts',
            displayName: 'Automated Blog Poster System Alerts',
        });
        // Add email subscription if provided
        if (props.alertEmail) {
            this.alertTopic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
        }
        // Create CloudWatch Dashboard
        this.dashboard = new cloudwatch.Dashboard(this, 'SystemDashboard', {
            dashboardName: 'AutomatedBlogPoster-SystemHealth',
        });
        // Add Lambda function monitoring
        this.addLambdaMonitoring(props.lambdaFunctions);
        // Add API Gateway monitoring
        this.addApiGatewayMonitoring(props.api);
        // Add DynamoDB monitoring
        this.addDynamoDBMonitoring(props.tables);
        // Add SQS monitoring
        this.addSQSMonitoring(props.queues);
        // Add system-wide health checks
        this.addSystemHealthChecks();
    }
    addLambdaMonitoring(functions) {
        const lambdaWidgets = [];
        functions.forEach((func) => {
            // Error rate alarm
            const errorRateAlarm = new cloudwatch.Alarm(this, `${func.functionName}ErrorRate`, {
                alarmName: `${func.functionName}-ErrorRate`,
                alarmDescription: `High error rate for ${func.functionName}`,
                metric: func.metricErrors({
                    period: cdk.Duration.minutes(5),
                    statistic: 'Sum',
                }),
                threshold: 5,
                evaluationPeriods: 2,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            errorRateAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
            // Duration alarm
            const durationAlarm = new cloudwatch.Alarm(this, `${func.functionName}Duration`, {
                alarmName: `${func.functionName}-Duration`,
                alarmDescription: `High duration for ${func.functionName}`,
                metric: func.metricDuration({
                    period: cdk.Duration.minutes(5),
                    statistic: 'Average',
                }),
                threshold: func.timeout?.toMilliseconds() ? func.timeout.toMilliseconds() * 0.8 : 24000,
                evaluationPeriods: 3,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            durationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
            // Throttle alarm
            const throttleAlarm = new cloudwatch.Alarm(this, `${func.functionName}Throttles`, {
                alarmName: `${func.functionName}-Throttles`,
                alarmDescription: `Throttling detected for ${func.functionName}`,
                metric: func.metricThrottles({
                    period: cdk.Duration.minutes(5),
                    statistic: 'Sum',
                }),
                threshold: 1,
                evaluationPeriods: 1,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            throttleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
            // Add widgets to dashboard
            lambdaWidgets.push(new cloudwatch.GraphWidget({
                title: `${func.functionName} - Invocations & Errors`,
                left: [func.metricInvocations()],
                right: [func.metricErrors()],
                width: 12,
                height: 6,
            }), new cloudwatch.GraphWidget({
                title: `${func.functionName} - Duration & Throttles`,
                left: [func.metricDuration()],
                right: [func.metricThrottles()],
                width: 12,
                height: 6,
            }));
        });
        // Add Lambda widgets to dashboard
        this.dashboard.addWidgets(...lambdaWidgets);
    }
    addApiGatewayMonitoring(api) {
        // API Gateway error rate alarm
        const apiErrorAlarm = new cloudwatch.Alarm(this, 'ApiGatewayErrorRate', {
            alarmName: 'ApiGateway-ErrorRate',
            alarmDescription: 'High error rate for API Gateway',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/ApiGateway',
                metricName: '4XXError',
                dimensionsMap: {
                    ApiName: api.restApiName,
                },
                period: cdk.Duration.minutes(5),
                statistic: 'Sum',
            }),
            threshold: 10,
            evaluationPeriods: 2,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        apiErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
        // API Gateway latency alarm
        const apiLatencyAlarm = new cloudwatch.Alarm(this, 'ApiGatewayLatency', {
            alarmName: 'ApiGateway-Latency',
            alarmDescription: 'High latency for API Gateway',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/ApiGateway',
                metricName: 'Latency',
                dimensionsMap: {
                    ApiName: api.restApiName,
                },
                period: cdk.Duration.minutes(5),
                statistic: 'Average',
            }),
            threshold: 5000,
            evaluationPeriods: 3,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        apiLatencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
        // Add API Gateway widgets
        this.dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'API Gateway - Requests & Errors',
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/ApiGateway',
                    metricName: 'Count',
                    dimensionsMap: { ApiName: api.restApiName },
                }),
            ],
            right: [
                new cloudwatch.Metric({
                    namespace: 'AWS/ApiGateway',
                    metricName: '4XXError',
                    dimensionsMap: { ApiName: api.restApiName },
                }),
                new cloudwatch.Metric({
                    namespace: 'AWS/ApiGateway',
                    metricName: '5XXError',
                    dimensionsMap: { ApiName: api.restApiName },
                }),
            ],
            width: 24,
            height: 6,
        }), new cloudwatch.GraphWidget({
            title: 'API Gateway - Latency',
            left: [
                new cloudwatch.Metric({
                    namespace: 'AWS/ApiGateway',
                    metricName: 'Latency',
                    dimensionsMap: { ApiName: api.restApiName },
                }),
            ],
            width: 24,
            height: 6,
        }));
    }
    addDynamoDBMonitoring(tables) {
        const dynamoWidgets = [];
        tables.forEach((table) => {
            // DynamoDB throttle alarm
            const throttleAlarm = new cloudwatch.Alarm(this, `${table.tableName}Throttles`, {
                alarmName: `${table.tableName}-Throttles`,
                alarmDescription: `Throttling detected for ${table.tableName}`,
                metric: table.metricThrottledRequestsForOperations({
                    operations: [dynamodb.Operation.PUT_ITEM, dynamodb.Operation.GET_ITEM, dynamodb.Operation.QUERY],
                    period: cdk.Duration.minutes(5),
                    statistic: 'Sum',
                }),
                threshold: 1,
                evaluationPeriods: 1,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            throttleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
            // Add DynamoDB widgets
            dynamoWidgets.push(new cloudwatch.GraphWidget({
                title: `${table.tableName} - Operations`,
                left: [
                    table.metricSuccessfulRequestLatency({ operations: [dynamodb.Operation.GET_ITEM] }),
                    table.metricSuccessfulRequestLatency({ operations: [dynamodb.Operation.PUT_ITEM] }),
                ],
                right: [
                    table.metricThrottledRequestsForOperations({
                        operations: [dynamodb.Operation.PUT_ITEM, dynamodb.Operation.GET_ITEM],
                    }),
                ],
                width: 12,
                height: 6,
            }));
        });
        this.dashboard.addWidgets(...dynamoWidgets);
    }
    addSQSMonitoring(queues) {
        const sqsWidgets = [];
        queues.forEach((queue) => {
            // SQS message age alarm
            const messageAgeAlarm = new cloudwatch.Alarm(this, `${queue.queueName}MessageAge`, {
                alarmName: `${queue.queueName}-MessageAge`,
                alarmDescription: `Old messages in ${queue.queueName}`,
                metric: queue.metricApproximateAgeOfOldestMessage({
                    period: cdk.Duration.minutes(5),
                    statistic: 'Maximum',
                }),
                threshold: 300,
                evaluationPeriods: 2,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            messageAgeAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
            // Add SQS widgets
            sqsWidgets.push(new cloudwatch.GraphWidget({
                title: `${queue.queueName} - Messages`,
                left: [
                    queue.metricApproximateNumberOfMessagesVisible(),
                    queue.metricApproximateNumberOfMessagesNotVisible(),
                ],
                right: [
                    queue.metricApproximateAgeOfOldestMessage(),
                ],
                width: 12,
                height: 6,
            }));
        });
        this.dashboard.addWidgets(...sqsWidgets);
    }
    addSystemHealthChecks() {
        // Create a health check Lambda function
        const healthCheckFunction = new lambda.Function(this, 'HealthCheckFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'health-check.handler',
            code: lambda.Code.fromAsset('lambda'),
            timeout: cdk.Duration.seconds(30),
            memorySize: 128,
            environment: {
                ALERT_TOPIC_ARN: this.alertTopic.topicArn,
            },
        });
        // Grant permissions to publish to SNS
        this.alertTopic.grantPublish(healthCheckFunction);
        // Schedule health checks every 5 minutes
        new events.Rule(this, 'HealthCheckRule', {
            schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
            targets: [new targets.LambdaFunction(healthCheckFunction)],
        });
        // Add custom metrics widget
        this.dashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'System Health Checks',
            left: [
                new cloudwatch.Metric({
                    namespace: 'AutomatedBlogPoster/HealthCheck',
                    metricName: 'HealthCheckSuccess',
                    statistic: 'Sum',
                }),
            ],
            right: [
                new cloudwatch.Metric({
                    namespace: 'AutomatedBlogPoster/HealthCheck',
                    metricName: 'HealthCheckFailure',
                    statistic: 'Sum',
                }),
            ],
            width: 24,
            height: 6,
        }));
    }
}
exports.MonitoringStack = MonitoringStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9uaXRvcmluZy1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1vbml0b3Jpbmctc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFFbkMsdUVBQXlEO0FBQ3pELHNGQUF3RTtBQUN4RSwrREFBaUQ7QUFDakQsd0VBQTBEO0FBQzFELHlEQUEyQztBQUMzQyxpRkFBbUU7QUFDbkUsK0RBQWlEO0FBRWpELG1FQUFxRDtBQVdyRCxNQUFhLGVBQWdCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFJNUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEyQjtRQUNuRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix1QkFBdUI7UUFDdkIsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNsRCxTQUFTLEVBQUUsOEJBQThCO1lBQ3pDLFdBQVcsRUFBRSxxQ0FBcUM7U0FDbkQsQ0FBQyxDQUFDO1FBRUgscUNBQXFDO1FBQ3JDLElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRTtZQUNwQixJQUFJLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FDN0IsSUFBSSxhQUFhLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUN0RCxDQUFDO1NBQ0g7UUFFRCw4QkFBOEI7UUFDOUIsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ2pFLGFBQWEsRUFBRSxrQ0FBa0M7U0FDbEQsQ0FBQyxDQUFDO1FBRUgsaUNBQWlDO1FBQ2pDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7UUFFaEQsNkJBQTZCO1FBQzdCLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFFeEMsMEJBQTBCO1FBQzFCLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFekMscUJBQXFCO1FBQ3JCLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFcEMsZ0NBQWdDO1FBQ2hDLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO0lBQy9CLENBQUM7SUFFTyxtQkFBbUIsQ0FBQyxTQUE0QjtRQUN0RCxNQUFNLGFBQWEsR0FBeUIsRUFBRSxDQUFDO1FBRS9DLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRTtZQUN6QixtQkFBbUI7WUFDbkIsTUFBTSxjQUFjLEdBQUcsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxZQUFZLFdBQVcsRUFBRTtnQkFDakYsU0FBUyxFQUFFLEdBQUcsSUFBSSxDQUFDLFlBQVksWUFBWTtnQkFDM0MsZ0JBQWdCLEVBQUUsdUJBQXVCLElBQUksQ0FBQyxZQUFZLEVBQUU7Z0JBQzVELE1BQU0sRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDO29CQUN4QixNQUFNLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO29CQUMvQixTQUFTLEVBQUUsS0FBSztpQkFDakIsQ0FBQztnQkFDRixTQUFTLEVBQUUsQ0FBQztnQkFDWixpQkFBaUIsRUFBRSxDQUFDO2dCQUNwQixnQkFBZ0IsRUFBRSxVQUFVLENBQUMsZ0JBQWdCLENBQUMsYUFBYTthQUM1RCxDQUFDLENBQUM7WUFFSCxjQUFjLENBQUMsY0FBYyxDQUMzQixJQUFJLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQ2pELENBQUM7WUFFRixpQkFBaUI7WUFDakIsTUFBTSxhQUFhLEdBQUcsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxZQUFZLFVBQVUsRUFBRTtnQkFDL0UsU0FBUyxFQUFFLEdBQUcsSUFBSSxDQUFDLFlBQVksV0FBVztnQkFDMUMsZ0JBQWdCLEVBQUUscUJBQXFCLElBQUksQ0FBQyxZQUFZLEVBQUU7Z0JBQzFELE1BQU0sRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDO29CQUMxQixNQUFNLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO29CQUMvQixTQUFTLEVBQUUsU0FBUztpQkFDckIsQ0FBQztnQkFDRixTQUFTLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxjQUFjLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLEVBQUUsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLEtBQUs7Z0JBQ3ZGLGlCQUFpQixFQUFFLENBQUM7Z0JBQ3BCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO2FBQzVELENBQUMsQ0FBQztZQUVILGFBQWEsQ0FBQyxjQUFjLENBQzFCLElBQUksaUJBQWlCLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FDakQsQ0FBQztZQUVGLGlCQUFpQjtZQUNqQixNQUFNLGFBQWEsR0FBRyxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLEdBQUcsSUFBSSxDQUFDLFlBQVksV0FBVyxFQUFFO2dCQUNoRixTQUFTLEVBQUUsR0FBRyxJQUFJLENBQUMsWUFBWSxZQUFZO2dCQUMzQyxnQkFBZ0IsRUFBRSwyQkFBMkIsSUFBSSxDQUFDLFlBQVksRUFBRTtnQkFDaEUsTUFBTSxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUM7b0JBQzNCLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7b0JBQy9CLFNBQVMsRUFBRSxLQUFLO2lCQUNqQixDQUFDO2dCQUNGLFNBQVMsRUFBRSxDQUFDO2dCQUNaLGlCQUFpQixFQUFFLENBQUM7Z0JBQ3BCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO2FBQzVELENBQUMsQ0FBQztZQUVILGFBQWEsQ0FBQyxjQUFjLENBQzFCLElBQUksaUJBQWlCLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FDakQsQ0FBQztZQUVGLDJCQUEyQjtZQUMzQixhQUFhLENBQUMsSUFBSSxDQUNoQixJQUFJLFVBQVUsQ0FBQyxXQUFXLENBQUM7Z0JBQ3pCLEtBQUssRUFBRSxHQUFHLElBQUksQ0FBQyxZQUFZLHlCQUF5QjtnQkFDcEQsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7Z0JBQ2hDLEtBQUssRUFBRSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDNUIsS0FBSyxFQUFFLEVBQUU7Z0JBQ1QsTUFBTSxFQUFFLENBQUM7YUFDVixDQUFDLEVBQ0YsSUFBSSxVQUFVLENBQUMsV0FBVyxDQUFDO2dCQUN6QixLQUFLLEVBQUUsR0FBRyxJQUFJLENBQUMsWUFBWSx5QkFBeUI7Z0JBQ3BELElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztnQkFDN0IsS0FBSyxFQUFFLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO2dCQUMvQixLQUFLLEVBQUUsRUFBRTtnQkFDVCxNQUFNLEVBQUUsQ0FBQzthQUNWLENBQUMsQ0FDSCxDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7UUFFSCxrQ0FBa0M7UUFDbEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsR0FBRyxhQUFhLENBQUMsQ0FBQztJQUM5QyxDQUFDO0lBRU8sdUJBQXVCLENBQUMsR0FBdUI7UUFDckQsK0JBQStCO1FBQy9CLE1BQU0sYUFBYSxHQUFHLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDdEUsU0FBUyxFQUFFLHNCQUFzQjtZQUNqQyxnQkFBZ0IsRUFBRSxpQ0FBaUM7WUFDbkQsTUFBTSxFQUFFLElBQUksVUFBVSxDQUFDLE1BQU0sQ0FBQztnQkFDNUIsU0FBUyxFQUFFLGdCQUFnQjtnQkFDM0IsVUFBVSxFQUFFLFVBQVU7Z0JBQ3RCLGFBQWEsRUFBRTtvQkFDYixPQUFPLEVBQUUsR0FBRyxDQUFDLFdBQVc7aUJBQ3pCO2dCQUNELE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQy9CLFNBQVMsRUFBRSxLQUFLO2FBQ2pCLENBQUM7WUFDRixTQUFTLEVBQUUsRUFBRTtZQUNiLGlCQUFpQixFQUFFLENBQUM7WUFDcEIsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLGdCQUFnQixDQUFDLGFBQWE7U0FDNUQsQ0FBQyxDQUFDO1FBRUgsYUFBYSxDQUFDLGNBQWMsQ0FDMUIsSUFBSSxpQkFBaUIsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUNqRCxDQUFDO1FBRUYsNEJBQTRCO1FBQzVCLE1BQU0sZUFBZSxHQUFHLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDdEUsU0FBUyxFQUFFLG9CQUFvQjtZQUMvQixnQkFBZ0IsRUFBRSw4QkFBOEI7WUFDaEQsTUFBTSxFQUFFLElBQUksVUFBVSxDQUFDLE1BQU0sQ0FBQztnQkFDNUIsU0FBUyxFQUFFLGdCQUFnQjtnQkFDM0IsVUFBVSxFQUFFLFNBQVM7Z0JBQ3JCLGFBQWEsRUFBRTtvQkFDYixPQUFPLEVBQUUsR0FBRyxDQUFDLFdBQVc7aUJBQ3pCO2dCQUNELE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQy9CLFNBQVMsRUFBRSxTQUFTO2FBQ3JCLENBQUM7WUFDRixTQUFTLEVBQUUsSUFBSTtZQUNmLGlCQUFpQixFQUFFLENBQUM7WUFDcEIsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLGdCQUFnQixDQUFDLGFBQWE7U0FDNUQsQ0FBQyxDQUFDO1FBRUgsZUFBZSxDQUFDLGNBQWMsQ0FDNUIsSUFBSSxpQkFBaUIsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUNqRCxDQUFDO1FBRUYsMEJBQTBCO1FBQzFCLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUN2QixJQUFJLFVBQVUsQ0FBQyxXQUFXLENBQUM7WUFDekIsS0FBSyxFQUFFLGlDQUFpQztZQUN4QyxJQUFJLEVBQUU7Z0JBQ0osSUFBSSxVQUFVLENBQUMsTUFBTSxDQUFDO29CQUNwQixTQUFTLEVBQUUsZ0JBQWdCO29CQUMzQixVQUFVLEVBQUUsT0FBTztvQkFDbkIsYUFBYSxFQUFFLEVBQUUsT0FBTyxFQUFFLEdBQUcsQ0FBQyxXQUFXLEVBQUU7aUJBQzVDLENBQUM7YUFDSDtZQUNELEtBQUssRUFBRTtnQkFDTCxJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUM7b0JBQ3BCLFNBQVMsRUFBRSxnQkFBZ0I7b0JBQzNCLFVBQVUsRUFBRSxVQUFVO29CQUN0QixhQUFhLEVBQUUsRUFBRSxPQUFPLEVBQUUsR0FBRyxDQUFDLFdBQVcsRUFBRTtpQkFDNUMsQ0FBQztnQkFDRixJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUM7b0JBQ3BCLFNBQVMsRUFBRSxnQkFBZ0I7b0JBQzNCLFVBQVUsRUFBRSxVQUFVO29CQUN0QixhQUFhLEVBQUUsRUFBRSxPQUFPLEVBQUUsR0FBRyxDQUFDLFdBQVcsRUFBRTtpQkFDNUMsQ0FBQzthQUNIO1lBQ0QsS0FBSyxFQUFFLEVBQUU7WUFDVCxNQUFNLEVBQUUsQ0FBQztTQUNWLENBQUMsRUFDRixJQUFJLFVBQVUsQ0FBQyxXQUFXLENBQUM7WUFDekIsS0FBSyxFQUFFLHVCQUF1QjtZQUM5QixJQUFJLEVBQUU7Z0JBQ0osSUFBSSxVQUFVLENBQUMsTUFBTSxDQUFDO29CQUNwQixTQUFTLEVBQUUsZ0JBQWdCO29CQUMzQixVQUFVLEVBQUUsU0FBUztvQkFDckIsYUFBYSxFQUFFLEVBQUUsT0FBTyxFQUFFLEdBQUcsQ0FBQyxXQUFXLEVBQUU7aUJBQzVDLENBQUM7YUFDSDtZQUNELEtBQUssRUFBRSxFQUFFO1lBQ1QsTUFBTSxFQUFFLENBQUM7U0FDVixDQUFDLENBQ0gsQ0FBQztJQUNKLENBQUM7SUFFTyxxQkFBcUIsQ0FBQyxNQUF3QjtRQUNwRCxNQUFNLGFBQWEsR0FBeUIsRUFBRSxDQUFDO1FBRS9DLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtZQUN2QiwwQkFBMEI7WUFDMUIsTUFBTSxhQUFhLEdBQUcsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxHQUFHLEtBQUssQ0FBQyxTQUFTLFdBQVcsRUFBRTtnQkFDOUUsU0FBUyxFQUFFLEdBQUcsS0FBSyxDQUFDLFNBQVMsWUFBWTtnQkFDekMsZ0JBQWdCLEVBQUUsMkJBQTJCLEtBQUssQ0FBQyxTQUFTLEVBQUU7Z0JBQzlELE1BQU0sRUFBRSxLQUFLLENBQUMsb0NBQW9DLENBQUM7b0JBQ2pELFVBQVUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxTQUFTLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO29CQUNoRyxNQUFNLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO29CQUMvQixTQUFTLEVBQUUsS0FBSztpQkFDakIsQ0FBQztnQkFDRixTQUFTLEVBQUUsQ0FBQztnQkFDWixpQkFBaUIsRUFBRSxDQUFDO2dCQUNwQixnQkFBZ0IsRUFBRSxVQUFVLENBQUMsZ0JBQWdCLENBQUMsYUFBYTthQUM1RCxDQUFDLENBQUM7WUFFSCxhQUFhLENBQUMsY0FBYyxDQUMxQixJQUFJLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQ2pELENBQUM7WUFFRix1QkFBdUI7WUFDdkIsYUFBYSxDQUFDLElBQUksQ0FDaEIsSUFBSSxVQUFVLENBQUMsV0FBVyxDQUFDO2dCQUN6QixLQUFLLEVBQUUsR0FBRyxLQUFLLENBQUMsU0FBUyxlQUFlO2dCQUN4QyxJQUFJLEVBQUU7b0JBQ0osS0FBSyxDQUFDLDhCQUE4QixDQUFDLEVBQUUsVUFBVSxFQUFFLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO29CQUNuRixLQUFLLENBQUMsOEJBQThCLENBQUMsRUFBRSxVQUFVLEVBQUUsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7aUJBQ3BGO2dCQUNELEtBQUssRUFBRTtvQkFDTCxLQUFLLENBQUMsb0NBQW9DLENBQUM7d0JBQ3pDLFVBQVUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDO3FCQUN2RSxDQUFDO2lCQUNIO2dCQUNELEtBQUssRUFBRSxFQUFFO2dCQUNULE1BQU0sRUFBRSxDQUFDO2FBQ1YsQ0FBQyxDQUNILENBQUM7UUFDSixDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsYUFBYSxDQUFDLENBQUM7SUFDOUMsQ0FBQztJQUVPLGdCQUFnQixDQUFDLE1BQW1CO1FBQzFDLE1BQU0sVUFBVSxHQUF5QixFQUFFLENBQUM7UUFFNUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQ3ZCLHdCQUF3QjtZQUN4QixNQUFNLGVBQWUsR0FBRyxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLEdBQUcsS0FBSyxDQUFDLFNBQVMsWUFBWSxFQUFFO2dCQUNqRixTQUFTLEVBQUUsR0FBRyxLQUFLLENBQUMsU0FBUyxhQUFhO2dCQUMxQyxnQkFBZ0IsRUFBRSxtQkFBbUIsS0FBSyxDQUFDLFNBQVMsRUFBRTtnQkFDdEQsTUFBTSxFQUFFLEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQztvQkFDaEQsTUFBTSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztvQkFDL0IsU0FBUyxFQUFFLFNBQVM7aUJBQ3JCLENBQUM7Z0JBQ0YsU0FBUyxFQUFFLEdBQUc7Z0JBQ2QsaUJBQWlCLEVBQUUsQ0FBQztnQkFDcEIsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLGdCQUFnQixDQUFDLGFBQWE7YUFDNUQsQ0FBQyxDQUFDO1lBRUgsZUFBZSxDQUFDLGNBQWMsQ0FDNUIsSUFBSSxpQkFBaUIsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUNqRCxDQUFDO1lBRUYsa0JBQWtCO1lBQ2xCLFVBQVUsQ0FBQyxJQUFJLENBQ2IsSUFBSSxVQUFVLENBQUMsV0FBVyxDQUFDO2dCQUN6QixLQUFLLEVBQUUsR0FBRyxLQUFLLENBQUMsU0FBUyxhQUFhO2dCQUN0QyxJQUFJLEVBQUU7b0JBQ0osS0FBSyxDQUFDLHdDQUF3QyxFQUFFO29CQUNoRCxLQUFLLENBQUMsMkNBQTJDLEVBQUU7aUJBQ3BEO2dCQUNELEtBQUssRUFBRTtvQkFDTCxLQUFLLENBQUMsbUNBQW1DLEVBQUU7aUJBQzVDO2dCQUNELEtBQUssRUFBRSxFQUFFO2dCQUNULE1BQU0sRUFBRSxDQUFDO2FBQ1YsQ0FBQyxDQUNILENBQUM7UUFDSixDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLEdBQUcsVUFBVSxDQUFDLENBQUM7SUFDM0MsQ0FBQztJQUVPLHFCQUFxQjtRQUMzQix3Q0FBd0M7UUFDeEMsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzNFLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsT0FBTyxFQUFFLHNCQUFzQjtZQUMvQixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDO1lBQ3JDLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDakMsVUFBVSxFQUFFLEdBQUc7WUFDZixXQUFXLEVBQUU7Z0JBQ1gsZUFBZSxFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsUUFBUTthQUMxQztTQUNGLENBQUMsQ0FBQztRQUVILHNDQUFzQztRQUN0QyxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO1FBRWxELHlDQUF5QztRQUN6QyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ3ZDLFFBQVEsRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN2RCxPQUFPLEVBQUUsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxjQUFjLENBQUMsbUJBQW1CLENBQUMsQ0FBQztTQUMzRCxDQUFDLENBQUM7UUFFSCw0QkFBNEI7UUFDNUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQ3ZCLElBQUksVUFBVSxDQUFDLFdBQVcsQ0FBQztZQUN6QixLQUFLLEVBQUUsc0JBQXNCO1lBQzdCLElBQUksRUFBRTtnQkFDSixJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUM7b0JBQ3BCLFNBQVMsRUFBRSxpQ0FBaUM7b0JBQzVDLFVBQVUsRUFBRSxvQkFBb0I7b0JBQ2hDLFNBQVMsRUFBRSxLQUFLO2lCQUNqQixDQUFDO2FBQ0g7WUFDRCxLQUFLLEVBQUU7Z0JBQ0wsSUFBSSxVQUFVLENBQUMsTUFBTSxDQUFDO29CQUNwQixTQUFTLEVBQUUsaUNBQWlDO29CQUM1QyxVQUFVLEVBQUUsb0JBQW9CO29CQUNoQyxTQUFTLEVBQUUsS0FBSztpQkFDakIsQ0FBQzthQUNIO1lBQ0QsS0FBSyxFQUFFLEVBQUU7WUFDVCxNQUFNLEVBQUUsQ0FBQztTQUNWLENBQUMsQ0FDSCxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBL1VELDBDQStVQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJztcclxuaW1wb3J0ICogYXMgY2xvdWR3YXRjaEFjdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gtYWN0aW9ucyc7XHJcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcclxuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xyXG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XHJcbmltcG9ydCAqIGFzIHN1YnNjcmlwdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucy1zdWJzY3JpcHRpb25zJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgc3FzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBNb25pdG9yaW5nU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcclxuICBsYW1iZGFGdW5jdGlvbnM6IGxhbWJkYS5GdW5jdGlvbltdO1xyXG4gIGFwaTogYXBpZ2F0ZXdheS5SZXN0QXBpO1xyXG4gIHRhYmxlczogZHluYW1vZGIuVGFibGVbXTtcclxuICBxdWV1ZXM6IHNxcy5RdWV1ZVtdO1xyXG4gIGFsZXJ0RW1haWw/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBNb25pdG9yaW5nU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIHB1YmxpYyByZWFkb25seSBhbGVydFRvcGljOiBzbnMuVG9waWM7XHJcbiAgcHVibGljIHJlYWRvbmx5IGRhc2hib2FyZDogY2xvdWR3YXRjaC5EYXNoYm9hcmQ7XHJcblxyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBNb25pdG9yaW5nU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gU05TIFRvcGljIGZvciBhbGVydHNcclxuICAgIHRoaXMuYWxlcnRUb3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ0FsZXJ0VG9waWMnLCB7XHJcbiAgICAgIHRvcGljTmFtZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1hbGVydHMnLFxyXG4gICAgICBkaXNwbGF5TmFtZTogJ0F1dG9tYXRlZCBCbG9nIFBvc3RlciBTeXN0ZW0gQWxlcnRzJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBlbWFpbCBzdWJzY3JpcHRpb24gaWYgcHJvdmlkZWRcclxuICAgIGlmIChwcm9wcy5hbGVydEVtYWlsKSB7XHJcbiAgICAgIHRoaXMuYWxlcnRUb3BpYy5hZGRTdWJzY3JpcHRpb24oXHJcbiAgICAgICAgbmV3IHN1YnNjcmlwdGlvbnMuRW1haWxTdWJzY3JpcHRpb24ocHJvcHMuYWxlcnRFbWFpbClcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgQ2xvdWRXYXRjaCBEYXNoYm9hcmRcclxuICAgIHRoaXMuZGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdTeXN0ZW1EYXNoYm9hcmQnLCB7XHJcbiAgICAgIGRhc2hib2FyZE5hbWU6ICdBdXRvbWF0ZWRCbG9nUG9zdGVyLVN5c3RlbUhlYWx0aCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgTGFtYmRhIGZ1bmN0aW9uIG1vbml0b3JpbmdcclxuICAgIHRoaXMuYWRkTGFtYmRhTW9uaXRvcmluZyhwcm9wcy5sYW1iZGFGdW5jdGlvbnMpO1xyXG5cclxuICAgIC8vIEFkZCBBUEkgR2F0ZXdheSBtb25pdG9yaW5nXHJcbiAgICB0aGlzLmFkZEFwaUdhdGV3YXlNb25pdG9yaW5nKHByb3BzLmFwaSk7XHJcblxyXG4gICAgLy8gQWRkIER5bmFtb0RCIG1vbml0b3JpbmdcclxuICAgIHRoaXMuYWRkRHluYW1vREJNb25pdG9yaW5nKHByb3BzLnRhYmxlcyk7XHJcblxyXG4gICAgLy8gQWRkIFNRUyBtb25pdG9yaW5nXHJcbiAgICB0aGlzLmFkZFNRU01vbml0b3JpbmcocHJvcHMucXVldWVzKTtcclxuXHJcbiAgICAvLyBBZGQgc3lzdGVtLXdpZGUgaGVhbHRoIGNoZWNrc1xyXG4gICAgdGhpcy5hZGRTeXN0ZW1IZWFsdGhDaGVja3MoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYWRkTGFtYmRhTW9uaXRvcmluZyhmdW5jdGlvbnM6IGxhbWJkYS5GdW5jdGlvbltdKSB7XHJcbiAgICBjb25zdCBsYW1iZGFXaWRnZXRzOiBjbG91ZHdhdGNoLklXaWRnZXRbXSA9IFtdO1xyXG5cclxuICAgIGZ1bmN0aW9ucy5mb3JFYWNoKChmdW5jKSA9PiB7XHJcbiAgICAgIC8vIEVycm9yIHJhdGUgYWxhcm1cclxuICAgICAgY29uc3QgZXJyb3JSYXRlQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCBgJHtmdW5jLmZ1bmN0aW9uTmFtZX1FcnJvclJhdGVgLCB7XHJcbiAgICAgICAgYWxhcm1OYW1lOiBgJHtmdW5jLmZ1bmN0aW9uTmFtZX0tRXJyb3JSYXRlYCxcclxuICAgICAgICBhbGFybURlc2NyaXB0aW9uOiBgSGlnaCBlcnJvciByYXRlIGZvciAke2Z1bmMuZnVuY3Rpb25OYW1lfWAsXHJcbiAgICAgICAgbWV0cmljOiBmdW5jLm1ldHJpY0Vycm9ycyh7XHJcbiAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICB0aHJlc2hvbGQ6IDUsXHJcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXHJcbiAgICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgZXJyb3JSYXRlQWxhcm0uYWRkQWxhcm1BY3Rpb24oXHJcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBEdXJhdGlvbiBhbGFybVxyXG4gICAgICBjb25zdCBkdXJhdGlvbkFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgYCR7ZnVuYy5mdW5jdGlvbk5hbWV9RHVyYXRpb25gLCB7XHJcbiAgICAgICAgYWxhcm1OYW1lOiBgJHtmdW5jLmZ1bmN0aW9uTmFtZX0tRHVyYXRpb25gLFxyXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246IGBIaWdoIGR1cmF0aW9uIGZvciAke2Z1bmMuZnVuY3Rpb25OYW1lfWAsXHJcbiAgICAgICAgbWV0cmljOiBmdW5jLm1ldHJpY0R1cmF0aW9uKHtcclxuICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICB0aHJlc2hvbGQ6IGZ1bmMudGltZW91dD8udG9NaWxsaXNlY29uZHMoKSA/IGZ1bmMudGltZW91dC50b01pbGxpc2Vjb25kcygpICogMC44IDogMjQwMDAsIC8vIDgwJSBvZiB0aW1lb3V0XHJcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDMsXHJcbiAgICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgZHVyYXRpb25BbGFybS5hZGRBbGFybUFjdGlvbihcclxuICAgICAgICBuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKHRoaXMuYWxlcnRUb3BpYylcclxuICAgICAgKTtcclxuXHJcbiAgICAgIC8vIFRocm90dGxlIGFsYXJtXHJcbiAgICAgIGNvbnN0IHRocm90dGxlQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCBgJHtmdW5jLmZ1bmN0aW9uTmFtZX1UaHJvdHRsZXNgLCB7XHJcbiAgICAgICAgYWxhcm1OYW1lOiBgJHtmdW5jLmZ1bmN0aW9uTmFtZX0tVGhyb3R0bGVzYCxcclxuICAgICAgICBhbGFybURlc2NyaXB0aW9uOiBgVGhyb3R0bGluZyBkZXRlY3RlZCBmb3IgJHtmdW5jLmZ1bmN0aW9uTmFtZX1gLFxyXG4gICAgICAgIG1ldHJpYzogZnVuYy5tZXRyaWNUaHJvdHRsZXMoe1xyXG4gICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgdGhyZXNob2xkOiAxLFxyXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxyXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIHRocm90dGxlQWxhcm0uYWRkQWxhcm1BY3Rpb24oXHJcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBBZGQgd2lkZ2V0cyB0byBkYXNoYm9hcmRcclxuICAgICAgbGFtYmRhV2lkZ2V0cy5wdXNoKFxyXG4gICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcclxuICAgICAgICAgIHRpdGxlOiBgJHtmdW5jLmZ1bmN0aW9uTmFtZX0gLSBJbnZvY2F0aW9ucyAmIEVycm9yc2AsXHJcbiAgICAgICAgICBsZWZ0OiBbZnVuYy5tZXRyaWNJbnZvY2F0aW9ucygpXSxcclxuICAgICAgICAgIHJpZ2h0OiBbZnVuYy5tZXRyaWNFcnJvcnMoKV0sXHJcbiAgICAgICAgICB3aWR0aDogMTIsXHJcbiAgICAgICAgICBoZWlnaHQ6IDYsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xyXG4gICAgICAgICAgdGl0bGU6IGAke2Z1bmMuZnVuY3Rpb25OYW1lfSAtIER1cmF0aW9uICYgVGhyb3R0bGVzYCxcclxuICAgICAgICAgIGxlZnQ6IFtmdW5jLm1ldHJpY0R1cmF0aW9uKCldLFxyXG4gICAgICAgICAgcmlnaHQ6IFtmdW5jLm1ldHJpY1Rocm90dGxlcygpXSxcclxuICAgICAgICAgIHdpZHRoOiAxMixcclxuICAgICAgICAgIGhlaWdodDogNixcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkIExhbWJkYSB3aWRnZXRzIHRvIGRhc2hib2FyZFxyXG4gICAgdGhpcy5kYXNoYm9hcmQuYWRkV2lkZ2V0cyguLi5sYW1iZGFXaWRnZXRzKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYWRkQXBpR2F0ZXdheU1vbml0b3JpbmcoYXBpOiBhcGlnYXRld2F5LlJlc3RBcGkpIHtcclxuICAgIC8vIEFQSSBHYXRld2F5IGVycm9yIHJhdGUgYWxhcm1cclxuICAgIGNvbnN0IGFwaUVycm9yQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnQXBpR2F0ZXdheUVycm9yUmF0ZScsIHtcclxuICAgICAgYWxhcm1OYW1lOiAnQXBpR2F0ZXdheS1FcnJvclJhdGUnLFxyXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnSGlnaCBlcnJvciByYXRlIGZvciBBUEkgR2F0ZXdheScsXHJcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcclxuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQXBpR2F0ZXdheScsXHJcbiAgICAgICAgbWV0cmljTmFtZTogJzRYWEVycm9yJyxcclxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XHJcbiAgICAgICAgICBBcGlOYW1lOiBhcGkucmVzdEFwaU5hbWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxyXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXHJcbiAgICAgIH0pLFxyXG4gICAgICB0aHJlc2hvbGQ6IDEwLFxyXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcclxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBhcGlFcnJvckFsYXJtLmFkZEFsYXJtQWN0aW9uKFxyXG4gICAgICBuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKHRoaXMuYWxlcnRUb3BpYylcclxuICAgICk7XHJcblxyXG4gICAgLy8gQVBJIEdhdGV3YXkgbGF0ZW5jeSBhbGFybVxyXG4gICAgY29uc3QgYXBpTGF0ZW5jeUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FwaUdhdGV3YXlMYXRlbmN5Jywge1xyXG4gICAgICBhbGFybU5hbWU6ICdBcGlHYXRld2F5LUxhdGVuY3knLFxyXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnSGlnaCBsYXRlbmN5IGZvciBBUEkgR2F0ZXdheScsXHJcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcclxuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQXBpR2F0ZXdheScsXHJcbiAgICAgICAgbWV0cmljTmFtZTogJ0xhdGVuY3knLFxyXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcclxuICAgICAgICAgIEFwaU5hbWU6IGFwaS5yZXN0QXBpTmFtZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXHJcbiAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXHJcbiAgICAgIH0pLFxyXG4gICAgICB0aHJlc2hvbGQ6IDUwMDAsIC8vIDUgc2Vjb25kc1xyXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMyxcclxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBhcGlMYXRlbmN5QWxhcm0uYWRkQWxhcm1BY3Rpb24oXHJcbiAgICAgIG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24odGhpcy5hbGVydFRvcGljKVxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBBZGQgQVBJIEdhdGV3YXkgd2lkZ2V0c1xyXG4gICAgdGhpcy5kYXNoYm9hcmQuYWRkV2lkZ2V0cyhcclxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xyXG4gICAgICAgIHRpdGxlOiAnQVBJIEdhdGV3YXkgLSBSZXF1ZXN0cyAmIEVycm9ycycsXHJcbiAgICAgICAgbGVmdDogW1xyXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcclxuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0FwaUdhdGV3YXknLFxyXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ291bnQnLFxyXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEFwaU5hbWU6IGFwaS5yZXN0QXBpTmFtZSB9LFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgXSxcclxuICAgICAgICByaWdodDogW1xyXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcclxuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0FwaUdhdGV3YXknLFxyXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnNFhYRXJyb3InLFxyXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEFwaU5hbWU6IGFwaS5yZXN0QXBpTmFtZSB9LFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xyXG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBV1MvQXBpR2F0ZXdheScsXHJcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICc1WFhFcnJvcicsXHJcbiAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgQXBpTmFtZTogYXBpLnJlc3RBcGlOYW1lIH0sXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICBdLFxyXG4gICAgICAgIHdpZHRoOiAyNCxcclxuICAgICAgICBoZWlnaHQ6IDYsXHJcbiAgICAgIH0pLFxyXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XHJcbiAgICAgICAgdGl0bGU6ICdBUEkgR2F0ZXdheSAtIExhdGVuY3knLFxyXG4gICAgICAgIGxlZnQ6IFtcclxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XHJcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0FXUy9BcGlHYXRld2F5JyxcclxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0xhdGVuY3knLFxyXG4gICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEFwaU5hbWU6IGFwaS5yZXN0QXBpTmFtZSB9LFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgXSxcclxuICAgICAgICB3aWR0aDogMjQsXHJcbiAgICAgICAgaGVpZ2h0OiA2LFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYWRkRHluYW1vREJNb25pdG9yaW5nKHRhYmxlczogZHluYW1vZGIuVGFibGVbXSkge1xyXG4gICAgY29uc3QgZHluYW1vV2lkZ2V0czogY2xvdWR3YXRjaC5JV2lkZ2V0W10gPSBbXTtcclxuXHJcbiAgICB0YWJsZXMuZm9yRWFjaCgodGFibGUpID0+IHtcclxuICAgICAgLy8gRHluYW1vREIgdGhyb3R0bGUgYWxhcm1cclxuICAgICAgY29uc3QgdGhyb3R0bGVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsIGAke3RhYmxlLnRhYmxlTmFtZX1UaHJvdHRsZXNgLCB7XHJcbiAgICAgICAgYWxhcm1OYW1lOiBgJHt0YWJsZS50YWJsZU5hbWV9LVRocm90dGxlc2AsXHJcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogYFRocm90dGxpbmcgZGV0ZWN0ZWQgZm9yICR7dGFibGUudGFibGVOYW1lfWAsXHJcbiAgICAgICAgbWV0cmljOiB0YWJsZS5tZXRyaWNUaHJvdHRsZWRSZXF1ZXN0c0Zvck9wZXJhdGlvbnMoe1xyXG4gICAgICAgICAgb3BlcmF0aW9uczogW2R5bmFtb2RiLk9wZXJhdGlvbi5QVVRfSVRFTSwgZHluYW1vZGIuT3BlcmF0aW9uLkdFVF9JVEVNLCBkeW5hbW9kYi5PcGVyYXRpb24uUVVFUlldLFxyXG4gICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgdGhyZXNob2xkOiAxLFxyXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxyXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIHRocm90dGxlQWxhcm0uYWRkQWxhcm1BY3Rpb24oXHJcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBBZGQgRHluYW1vREIgd2lkZ2V0c1xyXG4gICAgICBkeW5hbW9XaWRnZXRzLnB1c2goXHJcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xyXG4gICAgICAgICAgdGl0bGU6IGAke3RhYmxlLnRhYmxlTmFtZX0gLSBPcGVyYXRpb25zYCxcclxuICAgICAgICAgIGxlZnQ6IFtcclxuICAgICAgICAgICAgdGFibGUubWV0cmljU3VjY2Vzc2Z1bFJlcXVlc3RMYXRlbmN5KHsgb3BlcmF0aW9uczogW2R5bmFtb2RiLk9wZXJhdGlvbi5HRVRfSVRFTV0gfSksXHJcbiAgICAgICAgICAgIHRhYmxlLm1ldHJpY1N1Y2Nlc3NmdWxSZXF1ZXN0TGF0ZW5jeSh7IG9wZXJhdGlvbnM6IFtkeW5hbW9kYi5PcGVyYXRpb24uUFVUX0lURU1dIH0pLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICAgIHJpZ2h0OiBbXHJcbiAgICAgICAgICAgIHRhYmxlLm1ldHJpY1Rocm90dGxlZFJlcXVlc3RzRm9yT3BlcmF0aW9ucyh7XHJcbiAgICAgICAgICAgICAgb3BlcmF0aW9uczogW2R5bmFtb2RiLk9wZXJhdGlvbi5QVVRfSVRFTSwgZHluYW1vZGIuT3BlcmF0aW9uLkdFVF9JVEVNXSxcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgICAgd2lkdGg6IDEyLFxyXG4gICAgICAgICAgaGVpZ2h0OiA2LFxyXG4gICAgICAgIH0pXHJcbiAgICAgICk7XHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmRhc2hib2FyZC5hZGRXaWRnZXRzKC4uLmR5bmFtb1dpZGdldHMpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhZGRTUVNNb25pdG9yaW5nKHF1ZXVlczogc3FzLlF1ZXVlW10pIHtcclxuICAgIGNvbnN0IHNxc1dpZGdldHM6IGNsb3Vkd2F0Y2guSVdpZGdldFtdID0gW107XHJcblxyXG4gICAgcXVldWVzLmZvckVhY2goKHF1ZXVlKSA9PiB7XHJcbiAgICAgIC8vIFNRUyBtZXNzYWdlIGFnZSBhbGFybVxyXG4gICAgICBjb25zdCBtZXNzYWdlQWdlQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCBgJHtxdWV1ZS5xdWV1ZU5hbWV9TWVzc2FnZUFnZWAsIHtcclxuICAgICAgICBhbGFybU5hbWU6IGAke3F1ZXVlLnF1ZXVlTmFtZX0tTWVzc2FnZUFnZWAsXHJcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogYE9sZCBtZXNzYWdlcyBpbiAke3F1ZXVlLnF1ZXVlTmFtZX1gLFxyXG4gICAgICAgIG1ldHJpYzogcXVldWUubWV0cmljQXBwcm94aW1hdGVBZ2VPZk9sZGVzdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcclxuICAgICAgICAgIHN0YXRpc3RpYzogJ01heGltdW0nLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIHRocmVzaG9sZDogMzAwLCAvLyA1IG1pbnV0ZXNcclxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcclxuICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBtZXNzYWdlQWdlQWxhcm0uYWRkQWxhcm1BY3Rpb24oXHJcbiAgICAgICAgbmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsZXJ0VG9waWMpXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBBZGQgU1FTIHdpZGdldHNcclxuICAgICAgc3FzV2lkZ2V0cy5wdXNoKFxyXG4gICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcclxuICAgICAgICAgIHRpdGxlOiBgJHtxdWV1ZS5xdWV1ZU5hbWV9IC0gTWVzc2FnZXNgLFxyXG4gICAgICAgICAgbGVmdDogW1xyXG4gICAgICAgICAgICBxdWV1ZS5tZXRyaWNBcHByb3hpbWF0ZU51bWJlck9mTWVzc2FnZXNWaXNpYmxlKCksXHJcbiAgICAgICAgICAgIHF1ZXVlLm1ldHJpY0FwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc05vdFZpc2libGUoKSxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgICByaWdodDogW1xyXG4gICAgICAgICAgICBxdWV1ZS5tZXRyaWNBcHByb3hpbWF0ZUFnZU9mT2xkZXN0TWVzc2FnZSgpLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICAgIHdpZHRoOiAxMixcclxuICAgICAgICAgIGhlaWdodDogNixcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5kYXNoYm9hcmQuYWRkV2lkZ2V0cyguLi5zcXNXaWRnZXRzKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYWRkU3lzdGVtSGVhbHRoQ2hlY2tzKCkge1xyXG4gICAgLy8gQ3JlYXRlIGEgaGVhbHRoIGNoZWNrIExhbWJkYSBmdW5jdGlvblxyXG4gICAgY29uc3QgaGVhbHRoQ2hlY2tGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0hlYWx0aENoZWNrRnVuY3Rpb24nLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaGVhbHRoLWNoZWNrLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICAgIG1lbW9yeVNpemU6IDEyOCxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBBTEVSVF9UT1BJQ19BUk46IHRoaXMuYWxlcnRUb3BpYy50b3BpY0FybixcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIHB1Ymxpc2ggdG8gU05TXHJcbiAgICB0aGlzLmFsZXJ0VG9waWMuZ3JhbnRQdWJsaXNoKGhlYWx0aENoZWNrRnVuY3Rpb24pO1xyXG5cclxuICAgIC8vIFNjaGVkdWxlIGhlYWx0aCBjaGVja3MgZXZlcnkgNSBtaW51dGVzXHJcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0hlYWx0aENoZWNrUnVsZScsIHtcclxuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKGNkay5EdXJhdGlvbi5taW51dGVzKDUpKSxcclxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGhlYWx0aENoZWNrRnVuY3Rpb24pXSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBjdXN0b20gbWV0cmljcyB3aWRnZXRcclxuICAgIHRoaXMuZGFzaGJvYXJkLmFkZFdpZGdldHMoXHJcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcclxuICAgICAgICB0aXRsZTogJ1N5c3RlbSBIZWFsdGggQ2hlY2tzJyxcclxuICAgICAgICBsZWZ0OiBbXHJcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xyXG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBdXRvbWF0ZWRCbG9nUG9zdGVyL0hlYWx0aENoZWNrJyxcclxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0hlYWx0aENoZWNrU3VjY2VzcycsXHJcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICBdLFxyXG4gICAgICAgIHJpZ2h0OiBbXHJcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xyXG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdBdXRvbWF0ZWRCbG9nUG9zdGVyL0hlYWx0aENoZWNrJyxcclxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0hlYWx0aENoZWNrRmFpbHVyZScsXHJcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXHJcbiAgICAgICAgICB9KSxcclxuICAgICAgICBdLFxyXG4gICAgICAgIHdpZHRoOiAyNCxcclxuICAgICAgICBoZWlnaHQ6IDYsXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG4gIH1cclxufSJdfQ==