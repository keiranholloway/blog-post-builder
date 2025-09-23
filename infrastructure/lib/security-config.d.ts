import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
export interface SecurityConfigProps {
    api: apigateway.RestApi;
    lambdaFunctions: lambda.Function[];
    environment: string;
}
export declare class SecurityConfig extends Construct {
    readonly wafAcl: wafv2.CfnWebACL;
    readonly securityPolicy: iam.ManagedPolicy;
    constructor(scope: Construct, id: string, props: SecurityConfigProps);
    private createWafAcl;
    private createSecurityPolicy;
    private applyLambdaSecurity;
    private createSecurityMonitoring;
}
export interface ProductionSecurityProps {
    environment: string;
    alertEmail: string;
}
export declare class ProductionSecurity extends Construct {
    constructor(scope: Construct, id: string, props: ProductionSecurityProps);
}
