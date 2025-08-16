import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as Infrastructure from '../lib/automated-blog-poster-stack';

test('Stack creates required resources', () => {
  const app = new cdk.App();
  const stack = new Infrastructure.AutomatedBlogPosterStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  // Test DynamoDB tables
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'automated-blog-poster-content'
  });

  template.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'automated-blog-poster-users'
  });

  // Test S3 buckets
  template.resourceCountIs('AWS::S3::Bucket', 2);

  // Test Lambda function
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs18.x'
  });

  // Test API Gateway
  template.hasResourceProperties('AWS::ApiGateway::RestApi', {
    Name: 'Automated Blog Poster API'
  });

  // Test SQS queue
  template.hasResourceProperties('AWS::SQS::Queue', {
    QueueName: 'automated-blog-poster-agents'
  });

  // Test EventBridge
  template.hasResourceProperties('AWS::Events::EventBus', {
    Name: 'automated-blog-poster-events'
  });

  // Test Secrets Manager
  template.hasResourceProperties('AWS::SecretsManager::Secret', {
    Name: 'automated-blog-poster/platform-credentials'
  });
});