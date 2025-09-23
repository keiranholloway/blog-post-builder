#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AutomatedBlogPosterStack } from '../lib/automated-blog-poster-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

// Get environment from context
const environment = app.node.tryGetContext('environment') || 'development';
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

// Environment-specific configuration
const envConfig = {
  development: {
    stackName: 'AutomatedBlogPoster-Dev',
    monitoringStackName: 'AutomatedBlogPoster-Monitoring-Dev',
    alertEmail: undefined,
    corsOrigin: 'http://localhost:5173',
    domainName: undefined,
  },
  staging: {
    stackName: 'AutomatedBlogPoster-Staging',
    monitoringStackName: 'AutomatedBlogPoster-Monitoring-Staging',
    alertEmail: process.env.ALERT_EMAIL,
    corsOrigin: 'https://staging.yourdomain.com',
    domainName: 'staging.yourdomain.com',
  },
  production: {
    stackName: 'AutomatedBlogPoster-Prod',
    monitoringStackName: 'AutomatedBlogPoster-Monitoring-Prod',
    alertEmail: process.env.ALERT_EMAIL || 'alerts@yourdomain.com',
    corsOrigin: 'https://keiranholloway.github.io',
    domainName: 'blog-poster.yourdomain.com',
  },
};

const config = envConfig[environment as keyof typeof envConfig];

if (!config) {
  throw new Error(`Unknown environment: ${environment}`);
}

// Main application stack
const mainStack = new AutomatedBlogPosterStack(app, config.stackName, {
  env: { account, region },
  description: `Automated Blog Poster - ${environment} environment`,
  tags: {
    Environment: environment,
    Project: 'AutomatedBlogPoster',
    ManagedBy: 'CDK',
  },
  corsOrigin: config.corsOrigin,
  domainName: config.domainName,
});

// Monitoring stack (only for staging and production)
if (environment !== 'development') {
  new MonitoringStack(app, config.monitoringStackName, {
    env: { account, region },
    description: `Automated Blog Poster Monitoring - ${environment} environment`,
    tags: {
      Environment: environment,
      Project: 'AutomatedBlogPoster',
      ManagedBy: 'CDK',
    },
    lambdaFunctions: mainStack.lambdaFunctions,
    api: mainStack.api,
    tables: mainStack.tables,
    queues: mainStack.queues,
    alertEmail: config.alertEmail,
  });
}

app.synth();