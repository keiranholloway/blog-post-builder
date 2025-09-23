import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface MonitoringStackProps extends cdk.StackProps {
  lambdaFunctions: lambda.Function[];
  api: apigateway.RestApi;
  tables: dynamodb.Table[];
  queues: sqs.Queue[];
  alertEmail?: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly alertTopic: sns.Topic;
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // SNS Topic for alerts
    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'automated-blog-poster-alerts',
      displayName: 'Automated Blog Poster System Alerts',
    });

    // Add email subscription if provided
    if (props.alertEmail) {
      this.alertTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alertEmail)
      );
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

  private addLambdaMonitoring(functions: lambda.Function[]) {
    const lambdaWidgets: cloudwatch.IWidget[] = [];

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

      errorRateAlarm.addAlarmAction(
        new cloudwatchActions.SnsAction(this.alertTopic)
      );

      // Duration alarm
      const durationAlarm = new cloudwatch.Alarm(this, `${func.functionName}Duration`, {
        alarmName: `${func.functionName}-Duration`,
        alarmDescription: `High duration for ${func.functionName}`,
        metric: func.metricDuration({
          period: cdk.Duration.minutes(5),
          statistic: 'Average',
        }),
        threshold: func.timeout?.toMilliseconds() ? func.timeout.toMilliseconds() * 0.8 : 24000, // 80% of timeout
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      durationAlarm.addAlarmAction(
        new cloudwatchActions.SnsAction(this.alertTopic)
      );

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

      throttleAlarm.addAlarmAction(
        new cloudwatchActions.SnsAction(this.alertTopic)
      );

      // Add widgets to dashboard
      lambdaWidgets.push(
        new cloudwatch.GraphWidget({
          title: `${func.functionName} - Invocations & Errors`,
          left: [func.metricInvocations()],
          right: [func.metricErrors()],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: `${func.functionName} - Duration & Throttles`,
          left: [func.metricDuration()],
          right: [func.metricThrottles()],
          width: 12,
          height: 6,
        })
      );
    });

    // Add Lambda widgets to dashboard
    this.dashboard.addWidgets(...lambdaWidgets);
  }

  private addApiGatewayMonitoring(api: apigateway.RestApi) {
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

    apiErrorAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(this.alertTopic)
    );

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
      threshold: 5000, // 5 seconds
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    apiLatencyAlarm.addAlarmAction(
      new cloudwatchActions.SnsAction(this.alertTopic)
    );

    // Add API Gateway widgets
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      }),
      new cloudwatch.GraphWidget({
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
      })
    );
  }

  private addDynamoDBMonitoring(tables: dynamodb.Table[]) {
    const dynamoWidgets: cloudwatch.IWidget[] = [];

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

      throttleAlarm.addAlarmAction(
        new cloudwatchActions.SnsAction(this.alertTopic)
      );

      // Add DynamoDB widgets
      dynamoWidgets.push(
        new cloudwatch.GraphWidget({
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
        })
      );
    });

    this.dashboard.addWidgets(...dynamoWidgets);
  }

  private addSQSMonitoring(queues: sqs.Queue[]) {
    const sqsWidgets: cloudwatch.IWidget[] = [];

    queues.forEach((queue) => {
      // SQS message age alarm
      const messageAgeAlarm = new cloudwatch.Alarm(this, `${queue.queueName}MessageAge`, {
        alarmName: `${queue.queueName}-MessageAge`,
        alarmDescription: `Old messages in ${queue.queueName}`,
        metric: queue.metricApproximateAgeOfOldestMessage({
          period: cdk.Duration.minutes(5),
          statistic: 'Maximum',
        }),
        threshold: 300, // 5 minutes
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      messageAgeAlarm.addAlarmAction(
        new cloudwatchActions.SnsAction(this.alertTopic)
      );

      // Add SQS widgets
      sqsWidgets.push(
        new cloudwatch.GraphWidget({
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
        })
      );
    });

    this.dashboard.addWidgets(...sqsWidgets);
  }

  private addSystemHealthChecks() {
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
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );
  }
}