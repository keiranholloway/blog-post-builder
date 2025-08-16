#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AutomatedBlogPosterStack } from '../lib/automated-blog-poster-stack';

const app = new cdk.App();
new AutomatedBlogPosterStack(app, 'AutomatedBlogPosterStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});