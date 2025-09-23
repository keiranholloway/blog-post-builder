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
exports.ProductionSecurity = exports.SecurityConfig = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const constructs_1 = require("constructs");
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const wafv2 = __importStar(require("aws-cdk-lib/aws-wafv2"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
class SecurityConfig extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        // Create WAF Web ACL for API Gateway protection
        this.wafAcl = this.createWafAcl(props.environment);
        // Associate WAF with API Gateway
        new wafv2.CfnWebACLAssociation(this, 'WafApiAssociation', {
            resourceArn: props.api.deploymentStage.stageArn,
            webAclArn: this.wafAcl.attrArn,
        });
        // Create security policy for Lambda functions
        this.securityPolicy = this.createSecurityPolicy();
        // Apply security configurations to Lambda functions
        this.applyLambdaSecurity(props.lambdaFunctions);
        // Create security monitoring
        this.createSecurityMonitoring(props.environment);
    }
    createWafAcl(environment) {
        return new wafv2.CfnWebACL(this, 'WebAcl', {
            name: `automated-blog-poster-${environment}-waf`,
            scope: 'REGIONAL',
            defaultAction: { allow: {} },
            description: `WAF ACL for Automated Blog Poster ${environment} environment`,
            rules: [
                // Rate limiting rule
                {
                    name: 'RateLimitRule',
                    priority: 1,
                    statement: {
                        rateBasedStatement: {
                            limit: 2000,
                            aggregateKeyType: 'IP',
                        },
                    },
                    action: { block: {} },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'RateLimitRule',
                    },
                },
                // AWS Managed Rules - Core Rule Set
                {
                    name: 'AWSManagedRulesCommonRuleSet',
                    priority: 2,
                    overrideAction: { none: {} },
                    statement: {
                        managedRuleGroupStatement: {
                            vendorName: 'AWS',
                            name: 'AWSManagedRulesCommonRuleSet',
                            excludedRules: [],
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'CommonRuleSetMetric',
                    },
                },
                // AWS Managed Rules - Known Bad Inputs
                {
                    name: 'AWSManagedRulesKnownBadInputsRuleSet',
                    priority: 3,
                    overrideAction: { none: {} },
                    statement: {
                        managedRuleGroupStatement: {
                            vendorName: 'AWS',
                            name: 'AWSManagedRulesKnownBadInputsRuleSet',
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'KnownBadInputsRuleSetMetric',
                    },
                },
                // AWS Managed Rules - SQL Injection
                {
                    name: 'AWSManagedRulesSQLiRuleSet',
                    priority: 4,
                    overrideAction: { none: {} },
                    statement: {
                        managedRuleGroupStatement: {
                            vendorName: 'AWS',
                            name: 'AWSManagedRulesSQLiRuleSet',
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'SQLiRuleSetMetric',
                    },
                },
                // Geographic restriction (optional - can be customized)
                {
                    name: 'GeoRestrictionRule',
                    priority: 5,
                    statement: {
                        geoMatchStatement: {
                            // Block requests from high-risk countries
                            countryCodes: ['CN', 'RU', 'KP', 'IR'],
                        },
                    },
                    action: { block: {} },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'GeoRestrictionRule',
                    },
                },
                // IP reputation rule
                {
                    name: 'AWSManagedRulesAmazonIpReputationList',
                    priority: 6,
                    overrideAction: { none: {} },
                    statement: {
                        managedRuleGroupStatement: {
                            vendorName: 'AWS',
                            name: 'AWSManagedRulesAmazonIpReputationList',
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: 'IpReputationListMetric',
                    },
                },
            ],
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: 'AutomatedBlogPosterWAF',
            },
        });
    }
    createSecurityPolicy() {
        return new iam.ManagedPolicy(this, 'SecurityPolicy', {
            managedPolicyName: 'AutomatedBlogPosterSecurityPolicy',
            description: 'Security policy for Automated Blog Poster Lambda functions',
            statements: [
                // Deny dangerous actions
                new iam.PolicyStatement({
                    effect: iam.Effect.DENY,
                    actions: [
                        'iam:CreateUser',
                        'iam:CreateRole',
                        'iam:AttachUserPolicy',
                        'iam:AttachRolePolicy',
                        'iam:PutUserPolicy',
                        'iam:PutRolePolicy',
                        'ec2:TerminateInstances',
                        'ec2:StopInstances',
                        'rds:DeleteDBInstance',
                        'rds:DeleteDBCluster',
                        's3:DeleteBucket',
                        'dynamodb:DeleteTable',
                    ],
                    resources: ['*'],
                }),
                // Restrict network access
                new iam.PolicyStatement({
                    effect: iam.Effect.DENY,
                    actions: [
                        'ec2:CreateVpc',
                        'ec2:CreateSubnet',
                        'ec2:CreateInternetGateway',
                        'ec2:CreateNatGateway',
                        'ec2:CreateSecurityGroup',
                    ],
                    resources: ['*'],
                }),
                // Allow only necessary CloudWatch actions
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'logs:CreateLogGroup',
                        'logs:CreateLogStream',
                        'logs:PutLogEvents',
                        'cloudwatch:PutMetricData',
                    ],
                    resources: ['*'],
                }),
            ],
        });
    }
    applyLambdaSecurity(functions) {
        functions.forEach((func) => {
            // Apply security policy
            func.role?.addManagedPolicy(this.securityPolicy);
            // Add environment variables for security
            func.addEnvironment('NODE_OPTIONS', '--enable-source-maps');
            func.addEnvironment('AWS_NODEJS_CONNECTION_REUSE_ENABLED', '1');
            // Add security headers
            func.addEnvironment('SECURITY_HEADERS', JSON.stringify({
                'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
                'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
            }));
        });
    }
    createSecurityMonitoring(environment) {
        // Create CloudWatch log group for security events
        new cdk.aws_logs.LogGroup(this, 'SecurityLogGroup', {
            logGroupName: `/aws/security/automated-blog-poster-${environment}`,
            retention: cdk.aws_logs.RetentionDays.ONE_YEAR,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // Create custom metrics for security monitoring
        const securityMetricNamespace = 'AutomatedBlogPoster/Security';
        // WAF blocked requests metric
        new cdk.aws_cloudwatch.Metric({
            namespace: 'AWS/WAFV2',
            metricName: 'BlockedRequests',
            dimensionsMap: {
                WebACL: this.wafAcl.name,
                Region: cdk.Stack.of(this).region,
            },
        });
        // Failed authentication attempts metric
        new cdk.aws_cloudwatch.Metric({
            namespace: securityMetricNamespace,
            metricName: 'FailedAuthAttempts',
        });
        // Suspicious activity metric
        new cdk.aws_cloudwatch.Metric({
            namespace: securityMetricNamespace,
            metricName: 'SuspiciousActivity',
        });
    }
}
exports.SecurityConfig = SecurityConfig;
class ProductionSecurity extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        // Create security configuration secret
        const securityConfig = new secretsmanager.Secret(this, 'SecurityConfig', {
            secretName: `automated-blog-poster/${props.environment}/security-config`,
            description: 'Security configuration for production environment',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    jwtSecret: '',
                    encryptionKey: '',
                    corsOrigin: props.environment === 'production' ? 'https://keiranholloway.github.io' : '*',
                    rateLimitWindow: 900,
                    rateLimitMax: 100,
                    sessionTimeout: 3600,
                    maxLoginAttempts: 5,
                    lockoutDuration: 1800, // 30 minutes
                }),
                generateStringKey: 'jwtSecret',
                excludeCharacters: '"@/\\',
                passwordLength: 64,
            },
        });
        // Create data retention policy
        const dataRetentionConfig = new secretsmanager.Secret(this, 'DataRetentionConfig', {
            secretName: `automated-blog-poster/${props.environment}/data-retention`,
            description: 'Data retention policies for production environment',
            secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
                audioFiles: {
                    retentionDays: 7,
                    deleteAfterProcessing: true,
                },
                contentDrafts: {
                    retentionDays: 90,
                    archiveAfterDays: 30,
                },
                auditLogs: {
                    retentionDays: 2555,
                    compressionEnabled: true,
                },
                userSessions: {
                    retentionDays: 30,
                    cleanupFrequency: 'daily',
                },
                publishingHistory: {
                    retentionDays: 365,
                    archiveAfterDays: 90,
                },
            })),
        });
        // Create backup configuration
        const backupConfig = new secretsmanager.Secret(this, 'BackupConfig', {
            secretName: `automated-blog-poster/${props.environment}/backup-config`,
            description: 'Backup and disaster recovery configuration',
            secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
                dynamodb: {
                    pointInTimeRecovery: true,
                    continuousBackups: true,
                    backupRetentionDays: 35,
                },
                s3: {
                    versioning: true,
                    crossRegionReplication: false,
                    lifecycleRules: {
                        transitionToIA: 30,
                        transitionToGlacier: 90,
                        deleteAfter: 2555, // 7 years
                    },
                },
                rpo: 3600,
                rto: 7200, // Recovery Time Objective: 2 hours
            })),
        });
        // Output important ARNs
        new cdk.CfnOutput(this, 'SecurityConfigArn', {
            value: securityConfig.secretArn,
            description: 'ARN of the security configuration secret',
        });
        new cdk.CfnOutput(this, 'DataRetentionConfigArn', {
            value: dataRetentionConfig.secretArn,
            description: 'ARN of the data retention configuration secret',
        });
        new cdk.CfnOutput(this, 'BackupConfigArn', {
            value: backupConfig.secretArn,
            description: 'ARN of the backup configuration secret',
        });
    }
}
exports.ProductionSecurity = ProductionSecurity;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjdXJpdHktY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic2VjdXJpdHktY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLDJDQUF1QztBQUN2Qyx5REFBMkM7QUFDM0MsNkRBQStDO0FBRy9DLCtFQUFpRTtBQVFqRSxNQUFhLGNBQWUsU0FBUSxzQkFBUztJQUkzQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTBCO1FBQ2xFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsZ0RBQWdEO1FBQ2hELElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUM7UUFFbkQsaUNBQWlDO1FBQ2pDLElBQUksS0FBSyxDQUFDLG9CQUFvQixDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUN4RCxXQUFXLEVBQUUsS0FBSyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsUUFBUTtZQUMvQyxTQUFTLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPO1NBQy9CLENBQUMsQ0FBQztRQUVILDhDQUE4QztRQUM5QyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO1FBRWxELG9EQUFvRDtRQUNwRCxJQUFJLENBQUMsbUJBQW1CLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBRWhELDZCQUE2QjtRQUM3QixJQUFJLENBQUMsd0JBQXdCLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFTyxZQUFZLENBQUMsV0FBbUI7UUFDdEMsT0FBTyxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUN6QyxJQUFJLEVBQUUseUJBQXlCLFdBQVcsTUFBTTtZQUNoRCxLQUFLLEVB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QUFTLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO1lBQ2hELEtBQUssRUFBRSxtQkFBbUIsQ0FBQyxTQUFTO1lBQ3BDLFdBQVcsRUFBRSxnREFBZ0Q7U0FDOUQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN6QyxLQUFLLEVBQUUsWUFBWSxDQUFDLFNBQVM7WUFDN0IsV0FBVyxFQUFFLHdDQUF3QztTQUN0RCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE3RkQsZ0RBNkZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0ICogYXMgd2FmdjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXdhZnYyJztcclxuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgU2VjdXJpdHlDb25maWdQcm9wcyB7XHJcbiAgYXBpOiBhcGlnYXRld2F5LlJlc3RBcGk7XHJcbiAgbGFtYmRhRnVuY3Rpb25zOiBsYW1iZGEuRnVuY3Rpb25bXTtcclxuICBlbnZpcm9ubWVudDogc3RyaW5nO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgU2VjdXJpdHlDb25maWcgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xyXG4gIHB1YmxpYyByZWFkb25seSB3YWZBY2w6IHdhZnYyLkNmbldlYkFDTDtcclxuICBwdWJsaWMgcmVhZG9ubHkgc2VjdXJpdHlQb2xpY3k6IGlhbS5NYW5hZ2VkUG9saWN5O1xyXG5cclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU2VjdXJpdHlDb25maWdQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgV0FGIFdlYiBBQ0wgZm9yIEFQSSBHYXRld2F5IHByb3RlY3Rpb25cclxuICAgIHRoaXMud2FmQWNsID0gdGhpcy5jcmVhdGVXYWZBY2wocHJvcHMuZW52aXJvbm1lbnQpO1xyXG5cclxuICAgIC8vIEFzc29jaWF0ZSBXQUYgd2l0aCBBUEkgR2F0ZXdheVxyXG4gICAgbmV3IHdhZnYyLkNmbldlYkFDTEFzc29jaWF0aW9uKHRoaXMsICdXYWZBcGlBc3NvY2lhdGlvbicsIHtcclxuICAgICAgcmVzb3VyY2VBcm46IHByb3BzLmFwaS5kZXBsb3ltZW50U3RhZ2Uuc3RhZ2VBcm4sXHJcbiAgICAgIHdlYkFjbEFybjogdGhpcy53YWZBY2wuYXR0ckFybixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBzZWN1cml0eSBwb2xpY3kgZm9yIExhbWJkYSBmdW5jdGlvbnNcclxuICAgIHRoaXMuc2VjdXJpdHlQb2xpY3kgPSB0aGlzLmNyZWF0ZVNlY3VyaXR5UG9saWN5KCk7XHJcblxyXG4gICAgLy8gQXBwbHkgc2VjdXJpdHkgY29uZmlndXJhdGlvbnMgdG8gTGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgdGhpcy5hcHBseUxhbWJkYVNlY3VyaXR5KHByb3BzLmxhbWJkYUZ1bmN0aW9ucyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIHNlY3VyaXR5IG1vbml0b3JpbmdcclxuICAgIHRoaXMuY3JlYXRlU2VjdXJpdHlNb25pdG9yaW5nKHByb3BzLmVudmlyb25tZW50KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlV2FmQWNsKGVudmlyb25tZW50OiBzdHJpbmcpOiB3YWZ2Mi5DZm5XZWJBQ0wge1xyXG4gICAgcmV0dXJuIG5ldyB3YWZ2Mi5DZm5XZWJBQ0wodGhpcywgJ1dlYkFjbCcsIHtcclxuICAgICAgbmFtZTogYGF1dG9tYXRlZC1ibG9nLXBvc3Rlci0ke2Vudmlyb25tZW50fS13YWZgLFxyXG4gICAgICBzY29wZTogJ1JFR0lPTkFMJyxcclxuICAgICAgZGVmYXVsdEFjdGlvbjogeyBhbGxvdzoge30gfSxcclxuICAgICAgZGVzY3JpcHRpb246IGBXQUYgQUNMIGZvciBBdXRvbWF0ZWQgQmxvZyBQb3N0ZXIgJHtlbnZpcm9ubWVudH0gZW52aXJvbm1lbnRgLFxyXG4gICAgICBydWxlczogW1xyXG4gICAgICAgIC8vIFJhdGUgbGltaXRpbmcgcnVsZVxyXG4gICAgICAgIHtcclxuICAgICAgICAgIG5hbWU6ICdSYXRlTGltaXRSdWxlJyxcclxuICAgICAgICAgIHByaW9yaXR5OiAxLFxyXG4gICAgICAgICAgc3RhdGVtZW50OiB7XHJcbiAgICAgICAgICAgIHJhdGVCYXNlZFN0YXRlbWVudDoge1xyXG4gICAgICAgICAgICAgIGxpbWl0OiAyMDAwLCAvLyAyMDAwIHJlcXVlc3RzIHBlciA1IG1pbnV0ZXNcclxuICAgICAgICAgICAgICBhZ2dyZWdhdGVLZXlUeXBlOiAnSVAnLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIGFjdGlvbjogeyBibG9jazoge30gfSxcclxuICAgICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcclxuICAgICAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnUmF0ZUxpbWl0UnVsZScsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gQVdTIE1hbmFnZWQgUnVsZXMgLSBDb3JlIFJ1bGUgU2V0XHJcbiAgICAgICAge1xyXG4gICAgICAgICAgbmFtZTogJ0FXU01hbmFnZWRSdWxlc0NvbW1vblJ1bGVTZXQnLFxyXG4gICAgICAgICAgcHJpb3JpdHk6IDIsXHJcbiAgICAgICAgICBvdmVycmlkZUFjdGlvbjogeyBub25lOiB7fSB9LFxyXG4gICAgICAgICAgc3RhdGVtZW50OiB7XHJcbiAgICAgICAgICAgIG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcclxuICAgICAgICAgICAgICB2ZW5kb3JOYW1lOiAnQVdTJyxcclxuICAgICAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzQ29tbW9uUnVsZVNldCcsXHJcbiAgICAgICAgICAgICAgZXhjbHVkZWRSdWxlczogW10sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xyXG4gICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDb21tb25SdWxlU2V0TWV0cmljJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICAvLyBBV1MgTWFuYWdlZCBSdWxlcyAtIEtub3duIEJhZCBJbnB1dHNcclxuICAgICAgICB7XHJcbiAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzS25vd25CYWRJbnB1dHNSdWxlU2V0JyxcclxuICAgICAgICAgIHByaW9yaXR5OiAzLFxyXG4gICAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHsgbm9uZToge30gfSxcclxuICAgICAgICAgIHN0YXRlbWVudDoge1xyXG4gICAgICAgICAgICBtYW5hZ2VkUnVsZUdyb3VwU3RhdGVtZW50OiB7XHJcbiAgICAgICAgICAgICAgdmVuZG9yTmFtZTogJ0FXUycsXHJcbiAgICAgICAgICAgICAgbmFtZTogJ0FXU01hbmFnZWRSdWxlc0tub3duQmFkSW5wdXRzUnVsZVNldCcsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xyXG4gICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdLbm93bkJhZElucHV0c1J1bGVTZXRNZXRyaWMnLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIEFXUyBNYW5hZ2VkIFJ1bGVzIC0gU1FMIEluamVjdGlvblxyXG4gICAgICAgIHtcclxuICAgICAgICAgIG5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNTUUxpUnVsZVNldCcsXHJcbiAgICAgICAgICBwcmlvcml0eTogNCxcclxuICAgICAgICAgIG92ZXJyaWRlQWN0aW9uOiB7IG5vbmU6IHt9IH0sXHJcbiAgICAgICAgICBzdGF0ZW1lbnQ6IHtcclxuICAgICAgICAgICAgbWFuYWdlZFJ1bGVHcm91cFN0YXRlbWVudDoge1xyXG4gICAgICAgICAgICAgIHZlbmRvck5hbWU6ICdBV1MnLFxyXG4gICAgICAgICAgICAgIG5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNTUUxpUnVsZVNldCcsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xyXG4gICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdTUUxpUnVsZVNldE1ldHJpYycsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gR2VvZ3JhcGhpYyByZXN0cmljdGlvbiAob3B0aW9uYWwgLSBjYW4gYmUgY3VzdG9taXplZClcclxuICAgICAgICB7XHJcbiAgICAgICAgICBuYW1lOiAnR2VvUmVzdHJpY3Rpb25SdWxlJyxcclxuICAgICAgICAgIHByaW9yaXR5OiA1LFxyXG4gICAgICAgICAgc3RhdGVtZW50OiB7XHJcbiAgICAgICAgICAgIGdlb01hdGNoU3RhdGVtZW50OiB7XHJcbiAgICAgICAgICAgICAgLy8gQmxvY2sgcmVxdWVzdHMgZnJvbSBoaWdoLXJpc2sgY291bnRyaWVzXHJcbiAgICAgICAgICAgICAgY291bnRyeUNvZGVzOiBbJ0NOJywgJ1JVJywgJ0tQJywgJ0lSJ10sXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgYWN0aW9uOiB7IGJsb2NrOiB7fSB9LFxyXG4gICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xyXG4gICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdHZW9SZXN0cmljdGlvblJ1bGUnLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIElQIHJlcHV0YXRpb24gcnVsZVxyXG4gICAgICAgIHtcclxuICAgICAgICAgIG5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNBbWF6b25JcFJlcHV0YXRpb25MaXN0JyxcclxuICAgICAgICAgIHByaW9yaXR5OiA2LFxyXG4gICAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHsgbm9uZToge30gfSxcclxuICAgICAgICAgIHN0YXRlbWVudDoge1xyXG4gICAgICAgICAgICBtYW5hZ2VkUnVsZUdyb3VwU3RhdGVtZW50OiB7XHJcbiAgICAgICAgICAgICAgdmVuZG9yTmFtZTogJ0FXUycsXHJcbiAgICAgICAgICAgICAgbmFtZTogJ0FXU01hbmFnZWRSdWxlc0FtYXpvbklwUmVwdXRhdGlvbkxpc3QnLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcclxuICAgICAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnSXBSZXB1dGF0aW9uTGlzdE1ldHJpYycsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcclxuICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxyXG4gICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgICBtZXRyaWNOYW1lOiAnQXV0b21hdGVkQmxvZ1Bvc3RlcldBRicsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY3JlYXRlU2VjdXJpdHlQb2xpY3koKTogaWFtLk1hbmFnZWRQb2xpY3kge1xyXG4gICAgcmV0dXJuIG5ldyBpYW0uTWFuYWdlZFBvbGljeSh0aGlzLCAnU2VjdXJpdHlQb2xpY3knLCB7XHJcbiAgICAgIG1hbmFnZWRQb2xpY3lOYW1lOiAnQXV0b21hdGVkQmxvZ1Bvc3RlclNlY3VyaXR5UG9saWN5JyxcclxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBwb2xpY3kgZm9yIEF1dG9tYXRlZCBCbG9nIFBvc3RlciBMYW1iZGEgZnVuY3Rpb25zJyxcclxuICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgIC8vIERlbnkgZGFuZ2Vyb3VzIGFjdGlvbnNcclxuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuREVOWSxcclxuICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgJ2lhbTpDcmVhdGVVc2VyJyxcclxuICAgICAgICAgICAgJ2lhbTpDcmVhdGVSb2xlJyxcclxuICAgICAgICAgICAgJ2lhbTpBdHRhY2hVc2VyUG9saWN5JyxcclxuICAgICAgICAgICAgJ2lhbTpBdHRhY2hSb2xlUG9saWN5JyxcclxuICAgICAgICAgICAgJ2lhbTpQdXRVc2VyUG9saWN5JyxcclxuICAgICAgICAgICAgJ2lhbTpQdXRSb2xlUG9saWN5JyxcclxuICAgICAgICAgICAgJ2VjMjpUZXJtaW5hdGVJbnN0YW5jZXMnLFxyXG4gICAgICAgICAgICAnZWMyOlN0b3BJbnN0YW5jZXMnLFxyXG4gICAgICAgICAgICAncmRzOkRlbGV0ZURCSW5zdGFuY2UnLFxyXG4gICAgICAgICAgICAncmRzOkRlbGV0ZURCQ2x1c3RlcicsXHJcbiAgICAgICAgICAgICdzMzpEZWxldGVCdWNrZXQnLFxyXG4gICAgICAgICAgICAnZHluYW1vZGI6RGVsZXRlVGFibGUnLFxyXG4gICAgICAgICAgXSxcclxuICAgICAgICAgIHJlc291cmNlczogWycqJ10sXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgLy8gUmVzdHJpY3QgbmV0d29yayBhY2Nlc3NcclxuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuREVOWSxcclxuICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgJ2VjMjpDcmVhdGVWcGMnLFxyXG4gICAgICAgICAgICAnZWMyOkNyZWF0ZVN1Ym5ldCcsXHJcbiAgICAgICAgICAgICdlYzI6Q3JlYXRlSW50ZXJuZXRHYXRld2F5JyxcclxuICAgICAgICAgICAgJ2VjMjpDcmVhdGVOYXRHYXRld2F5JyxcclxuICAgICAgICAgICAgJ2VjMjpDcmVhdGVTZWN1cml0eUdyb3VwJyxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIC8vIEFsbG93IG9ubHkgbmVjZXNzYXJ5IENsb3VkV2F0Y2ggYWN0aW9uc1xyXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxyXG4gICAgICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxyXG4gICAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxyXG4gICAgICAgICAgICAnY2xvdWR3YXRjaDpQdXRNZXRyaWNEYXRhJyxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGx5TGFtYmRhU2VjdXJpdHkoZnVuY3Rpb25zOiBsYW1iZGEuRnVuY3Rpb25bXSkge1xyXG4gICAgZnVuY3Rpb25zLmZvckVhY2goKGZ1bmMpID0+IHtcclxuICAgICAgLy8gQXBwbHkgc2VjdXJpdHkgcG9saWN5XHJcbiAgICAgIGZ1bmMucm9sZT8uYWRkTWFuYWdlZFBvbGljeSh0aGlzLnNlY3VyaXR5UG9saWN5KTtcclxuXHJcbiAgICAgIC8vIEFkZCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHNlY3VyaXR5XHJcbiAgICAgIGZ1bmMuYWRkRW52aXJvbm1lbnQoJ05PREVfT1BUSU9OUycsICctLWVuYWJsZS1zb3VyY2UtbWFwcycpO1xyXG4gICAgICBmdW5jLmFkZEVudmlyb25tZW50KCdBV1NfTk9ERUpTX0NPTk5FQ1RJT05fUkVVU0VfRU5BQkxFRCcsICcxJyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBBZGQgc2VjdXJpdHkgaGVhZGVyc1xyXG4gICAgICBmdW5jLmFkZEVudmlyb25tZW50KCdTRUNVUklUWV9IRUFERVJTJywgSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICdTdHJpY3QtVHJhbnNwb3J0LVNlY3VyaXR5JzogJ21heC1hZ2U9MzE1MzYwMDA7IGluY2x1ZGVTdWJEb21haW5zJyxcclxuICAgICAgICAnWC1Db250ZW50LVR5cGUtT3B0aW9ucyc6ICdub3NuaWZmJyxcclxuICAgICAgICAnWC1GcmFtZS1PcHRpb25zJzogJ0RFTlknLFxyXG4gICAgICAgICdYLVhTUy1Qcm90ZWN0aW9uJzogJzE7IG1vZGU9YmxvY2snLFxyXG4gICAgICAgICdSZWZlcnJlci1Qb2xpY3knOiAnc3RyaWN0LW9yaWdpbi13aGVuLWNyb3NzLW9yaWdpbicsXHJcbiAgICAgICAgJ0NvbnRlbnQtU2VjdXJpdHktUG9saWN5JzogXCJkZWZhdWx0LXNyYyAnc2VsZic7IHNjcmlwdC1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJzsgc3R5bGUtc3JjICdzZWxmJyAndW5zYWZlLWlubGluZSdcIixcclxuICAgICAgfSkpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZVNlY3VyaXR5TW9uaXRvcmluZyhlbnZpcm9ubWVudDogc3RyaW5nKSB7XHJcbiAgICAvLyBDcmVhdGUgQ2xvdWRXYXRjaCBsb2cgZ3JvdXAgZm9yIHNlY3VyaXR5IGV2ZW50c1xyXG4gICAgbmV3IGNkay5hd3NfbG9ncy5Mb2dHcm91cCh0aGlzLCAnU2VjdXJpdHlMb2dHcm91cCcsIHtcclxuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9zZWN1cml0eS9hdXRvbWF0ZWQtYmxvZy1wb3N0ZXItJHtlbnZpcm9ubWVudH1gLFxyXG4gICAgICByZXRlbnRpb246IGNkay5hd3NfbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9ZRUFSLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgY3VzdG9tIG1ldHJpY3MgZm9yIHNlY3VyaXR5IG1vbml0b3JpbmdcclxuICAgIGNvbnN0IHNlY3VyaXR5TWV0cmljTmFtZXNwYWNlID0gJ0F1dG9tYXRlZEJsb2dQb3N0ZXIvU2VjdXJpdHknO1xyXG4gICAgXHJcbiAgICAvLyBXQUYgYmxvY2tlZCByZXF1ZXN0cyBtZXRyaWNcclxuICAgIG5ldyBjZGsuYXdzX2Nsb3Vkd2F0Y2guTWV0cmljKHtcclxuICAgICAgbmFtZXNwYWNlOiAnQVdTL1dBRlYyJyxcclxuICAgICAgbWV0cmljTmFtZTogJ0Jsb2NrZWRSZXF1ZXN0cycsXHJcbiAgICAgIGRpbWVuc2lvbnNNYXA6IHtcclxuICAgICAgICBXZWJBQ0w6IHRoaXMud2FmQWNsLm5hbWUhLFxyXG4gICAgICAgIFJlZ2lvbjogY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEZhaWxlZCBhdXRoZW50aWNhdGlvbiBhdHRlbXB0cyBtZXRyaWNcclxuICAgIG5ldyBjZGsuYXdzX2Nsb3Vkd2F0Y2guTWV0cmljKHtcclxuICAgICAgbmFtZXNwYWNlOiBzZWN1cml0eU1ldHJpY05hbWVzcGFjZSxcclxuICAgICAgbWV0cmljTmFtZTogJ0ZhaWxlZEF1dGhBdHRlbXB0cycsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTdXNwaWNpb3VzIGFjdGl2aXR5IG1ldHJpY1xyXG4gICAgbmV3IGNkay5hd3NfY2xvdWR3YXRjaC5NZXRyaWMoe1xyXG4gICAgICBuYW1lc3BhY2U6IHNlY3VyaXR5TWV0cmljTmFtZXNwYWNlLFxyXG4gICAgICBtZXRyaWNOYW1lOiAnU3VzcGljaW91c0FjdGl2aXR5JyxcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBQcm9kdWN0aW9uU2VjdXJpdHlQcm9wcyB7XHJcbiAgZW52aXJvbm1lbnQ6IHN0cmluZztcclxuICBhbGVydEVtYWlsOiBzdHJpbmc7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBQcm9kdWN0aW9uU2VjdXJpdHkgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBQcm9kdWN0aW9uU2VjdXJpdHlQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgc2VjdXJpdHkgY29uZmlndXJhdGlvbiBzZWNyZXRcclxuICAgIGNvbnN0IHNlY3VyaXR5Q29uZmlnID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnU2VjdXJpdHlDb25maWcnLCB7XHJcbiAgICAgIHNlY3JldE5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIvJHtwcm9wcy5lbnZpcm9ubWVudH0vc2VjdXJpdHktY29uZmlnYCxcclxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBjb25maWd1cmF0aW9uIGZvciBwcm9kdWN0aW9uIGVudmlyb25tZW50JyxcclxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcclxuICAgICAgICBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgand0U2VjcmV0OiAnJyxcclxuICAgICAgICAgIGVuY3J5cHRpb25LZXk6ICcnLFxyXG4gICAgICAgICAgY29yc09yaWdpbjogcHJvcHMuZW52aXJvbm1lbnQgPT09ICdwcm9kdWN0aW9uJyA/ICdodHRwczovL2tlaXJhbmhvbGxvd2F5LmdpdGh1Yi5pbycgOiAnKicsXHJcbiAgICAgICAgICByYXRlTGltaXRXaW5kb3c6IDkwMCwgLy8gMTUgbWludXRlc1xyXG4gICAgICAgICAgcmF0ZUxpbWl0TWF4OiAxMDAsXHJcbiAgICAgICAgICBzZXNzaW9uVGltZW91dDogMzYwMCwgLy8gMSBob3VyXHJcbiAgICAgICAgICBtYXhMb2dpbkF0dGVtcHRzOiA1LFxyXG4gICAgICAgICAgbG9ja291dER1cmF0aW9uOiAxODAwLCAvLyAzMCBtaW51dGVzXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgZ2VuZXJhdGVTdHJpbmdLZXk6ICdqd3RTZWNyZXQnLFxyXG4gICAgICAgIGV4Y2x1ZGVDaGFyYWN0ZXJzOiAnXCJAL1xcXFwnLFxyXG4gICAgICAgIHBhc3N3b3JkTGVuZ3RoOiA2NCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENyZWF0ZSBkYXRhIHJldGVudGlvbiBwb2xpY3lcclxuICAgIGNvbnN0IGRhdGFSZXRlbnRpb25Db25maWcgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdEYXRhUmV0ZW50aW9uQ29uZmlnJywge1xyXG4gICAgICBzZWNyZXROYW1lOiBgYXV0b21hdGVkLWJsb2ctcG9zdGVyLyR7cHJvcHMuZW52aXJvbm1lbnR9L2RhdGEtcmV0ZW50aW9uYCxcclxuICAgICAgZGVzY3JpcHRpb246ICdEYXRhIHJldGVudGlvbiBwb2xpY2llcyBmb3IgcHJvZHVjdGlvbiBlbnZpcm9ubWVudCcsXHJcbiAgICAgIHNlY3JldFN0cmluZ1ZhbHVlOiBjZGsuU2VjcmV0VmFsdWUudW5zYWZlUGxhaW5UZXh0KEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBhdWRpb0ZpbGVzOiB7XHJcbiAgICAgICAgICByZXRlbnRpb25EYXlzOiA3LFxyXG4gICAgICAgICAgZGVsZXRlQWZ0ZXJQcm9jZXNzaW5nOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgY29udGVudERyYWZ0czoge1xyXG4gICAgICAgICAgcmV0ZW50aW9uRGF5czogOTAsXHJcbiAgICAgICAgICBhcmNoaXZlQWZ0ZXJEYXlzOiAzMCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIGF1ZGl0TG9nczoge1xyXG4gICAgICAgICAgcmV0ZW50aW9uRGF5czogMjU1NSwgLy8gNyB5ZWFycyBmb3IgY29tcGxpYW5jZVxyXG4gICAgICAgICAgY29tcHJlc3Npb25FbmFibGVkOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgdXNlclNlc3Npb25zOiB7XHJcbiAgICAgICAgICByZXRlbnRpb25EYXlzOiAzMCxcclxuICAgICAgICAgIGNsZWFudXBGcmVxdWVuY3k6ICdkYWlseScsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBwdWJsaXNoaW5nSGlzdG9yeToge1xyXG4gICAgICAgICAgcmV0ZW50aW9uRGF5czogMzY1LFxyXG4gICAgICAgICAgYXJjaGl2ZUFmdGVyRGF5czogOTAsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIGJhY2t1cCBjb25maWd1cmF0aW9uXHJcbiAgICBjb25zdCBiYWNrdXBDb25maWcgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdCYWNrdXBDb25maWcnLCB7XHJcbiAgICAgIHNlY3JldE5hbWU6IGBhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIvJHtwcm9wcy5lbnZpcm9ubWVudH0vYmFja3VwLWNvbmZpZ2AsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmFja3VwIGFuZCBkaXNhc3RlciByZWNvdmVyeSBjb25maWd1cmF0aW9uJyxcclxuICAgICAgc2VjcmV0U3RyaW5nVmFsdWU6IGNkay5TZWNyZXRWYWx1ZS51bnNhZmVQbGFpblRleHQoSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgIGR5bmFtb2RiOiB7XHJcbiAgICAgICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICAgICAgY29udGludW91c0JhY2t1cHM6IHRydWUsXHJcbiAgICAgICAgICBiYWNrdXBSZXRlbnRpb25EYXlzOiAzNSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHMzOiB7XHJcbiAgICAgICAgICB2ZXJzaW9uaW5nOiB0cnVlLFxyXG4gICAgICAgICAgY3Jvc3NSZWdpb25SZXBsaWNhdGlvbjogZmFsc2UsIC8vIEVuYWJsZSBmb3IgY3JpdGljYWwgcHJvZHVjdGlvblxyXG4gICAgICAgICAgbGlmZWN5Y2xlUnVsZXM6IHtcclxuICAgICAgICAgICAgdHJhbnNpdGlvblRvSUE6IDMwLFxyXG4gICAgICAgICAgICB0cmFuc2l0aW9uVG9HbGFjaWVyOiA5MCxcclxuICAgICAgICAgICAgZGVsZXRlQWZ0ZXI6IDI1NTUsIC8vIDcgeWVhcnNcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBycG86IDM2MDAsIC8vIFJlY292ZXJ5IFBvaW50IE9iamVjdGl2ZTogMSBob3VyXHJcbiAgICAgICAgcnRvOiA3MjAwLCAvLyBSZWNvdmVyeSBUaW1lIE9iamVjdGl2ZTogMiBob3Vyc1xyXG4gICAgICB9KSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXQgaW1wb3J0YW50IEFSTnNcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTZWN1cml0eUNvbmZpZ0FybicsIHtcclxuICAgICAgdmFsdWU6IHNlY3VyaXR5Q29uZmlnLnNlY3JldEFybixcclxuICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIHNlY3VyaXR5IGNvbmZpZ3VyYXRpb24gc2VjcmV0JyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhUmV0ZW50aW9uQ29uZmlnQXJuJywge1xyXG4gICAgICB2YWx1ZTogZGF0YVJldGVudGlvbkNvbmZpZy5zZWNyZXRBcm4sXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBkYXRhIHJldGVudGlvbiBjb25maWd1cmF0aW9uIHNlY3JldCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQmFja3VwQ29uZmlnQXJuJywge1xyXG4gICAgICB2YWx1ZTogYmFja3VwQ29uZmlnLnNlY3JldEFybixcclxuICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIGJhY2t1cCBjb25maWd1cmF0aW9uIHNlY3JldCcsXHJcbiAgICB9KTtcclxuICB9XHJcbn0iXX0=