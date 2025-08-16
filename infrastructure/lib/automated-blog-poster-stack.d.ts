import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export declare class AutomatedBlogPosterStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
    /**
     * Create Bedrock Agent with Keiran's personality and content
     */
    private createBedrockAgent;
}
