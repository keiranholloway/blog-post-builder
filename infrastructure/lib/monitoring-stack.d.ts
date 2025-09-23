import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
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
export declare class MonitoringStack extends cdk.Stack {
    readonly alertTopic: sns.Topic;
    readonly dashboard: cloudwatch.Dashboard;
    constructor(scope: Construct, id: string, props: MonitoringStackProps);
    private addLambdaMonitoring;
    private addApiGatewayMonitoring;
    private addDynamoDBMonitoring;
    private addSQSMonitoring;
    private addSystemHealthChecks;
}
