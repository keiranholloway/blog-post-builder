import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface SecurityConfigProps {
  api: apigateway.RestApi;
  lambdaFunctions: lambda.Function[];
  environment: string;
}

export class SecurityConfig extends Construct {
  public readonly wafAcl: wafv2.CfnWebACL;
  public readonly securityPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: SecurityConfigProps) {
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

  private createWafAcl(environment: string): wafv2.CfnWebACL {
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
              limit: 2000, // 2000 requests per 5 minutes
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

  private createSecurityPolicy(): iam.ManagedPolicy {
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

  private applyLambdaSecurity(functions: lambda.Function[]) {
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

  private createSecurityMonitoring(environment: string) {
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
        WebACL: this.wafAcl.name!,
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

export interface ProductionSecurityProps {
  environment: string;
  alertEmail: string;
}

export class ProductionSecurity extends Construct {
  constructor(scope: Construct, id: string, props: ProductionSecurityProps) {
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
          rateLimitWindow: 900, // 15 minutes
          rateLimitMax: 100,
          sessionTimeout: 3600, // 1 hour
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
          retentionDays: 2555, // 7 years for compliance
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
          crossRegionReplication: false, // Enable for critical production
          lifecycleRules: {
            transitionToIA: 30,
            transitionToGlacier: 90,
            deleteAfter: 2555, // 7 years
          },
        },
        rpo: 3600, // Recovery Point Objective: 1 hour
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