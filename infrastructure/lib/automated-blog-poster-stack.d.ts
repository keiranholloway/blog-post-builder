import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
export interface AutomatedBlogPosterStackProps extends cdk.StackProps {
    corsOrigin?: string;
    domainName?: string;
    environment?: string;
}
export declare class AutomatedBlogPosterStack extends cdk.Stack {
    readonly lambdaFunctions: lambda.Function[];
    readonly api: apigateway.RestApi;
    readonly tables: dynamodb.Table[];
    readonly queues: sqs.Queue[];
    constructor(scope: Construct, id: string, props?: AutomatedBlogPosterStackProps);
    /**
     * Create Bedrock Agent with Keiran's personality and content
     */
    private createBedrockAgent;
    private setupProductionFeatures;
}
