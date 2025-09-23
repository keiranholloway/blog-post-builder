import { handler } from '../lambda/health-check';
import { ScheduledEvent, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { SNSClient } from '@aws-sdk/client-sns';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-sqs');
jest.mock('@aws-sdk/client-cloudwatch');
jest.mock('@aws-sdk/client-sns');

describe('Health Check Handler', () => {
  let mockDynamoSend: jest.Mock;
  let mockS3Send: jest.Mock;
  let mockSQSSend: jest.Mock;
  let mockCloudWatchSend: jest.Mock;
  let mockSNSSend: jest.Mock;

  const mockEvent: ScheduledEvent = {
    id: 'test-event-id',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: '123456789012',
    time: '2023-01-01T00:00:00Z',
    region: 'us-east-1',
    detail: {},
    version: '0',
    resources: ['arn:aws:events:us-east-1:123456789012:rule/test-rule'],
  };

  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'health-check',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:health-check',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/health-check',
    logStreamName: '2023/01/01/[$LATEST]test',
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDynamoSend = jest.fn();
    mockS3Send = jest.fn();
    mockSQSSend = jest.fn();
    mockCloudWatchSend = jest.fn();
    mockSNSSend = jest.fn();
    
    (DynamoDBClient as jest.Mock).mockImplementation(() => ({
      send: mockDynamoSend,
    }));
    
    (S3Client as jest.Mock).mockImplementation(() => ({
      send: mockS3Send,
    }));
    
    (SQSClient as jest.Mock).mockImplementation(() => ({
      send: mockSQSSend,
    }));
    
    (CloudWatchClient as jest.Mock).mockImplementation(() => ({
      send: mockCloudWatchSend,
    }));
    
    (SNSClient as jest.Mock).mockImplementation(() => ({
      send: mockSNSSend,
    }));

    // Set up environment variables
    process.env.CONTENT_TABLE_NAME = 'test-content-table';
    process.env.USER_TABLE_NAME = 'test-user-table';
    process.env.AGENT_MESSAGES_TABLE_NAME = 'test-agent-messages-table';
    process.env.AUDIO_BUCKET_NAME = 'test-audio-bucket';
    process.env.IMAGE_BUCKET_NAME = 'test-image-bucket';
    process.env.AGENT_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-agent-queue';
    process.env.EVENT_BUS_NAME = 'test-event-bus';
    process.env.API_GATEWAY_URL = 'https://api.example.com';
    process.env.AWS_REGION = 'us-east-1';
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.CONTENT_TABLE_NAME;
    delete process.env.USER_TABLE_NAME;
    delete process.env.AGENT_MESSAGES_TABLE_NAME;
    delete process.env.AUDIO_BUCKET_NAME;
    delete process.env.IMAGE_BUCKET_NAME;
    delete process.env.AGENT_QUEUE_URL;
    delete process.env.EVENT_BUS_NAME;
    delete process.env.API_GATEWAY_URL;
    delete process.env.ALERT_TOPIC_ARN;
  });

  it('should complete health check successfully when all services are healthy', async () => {
    // Mock successful responses
    mockDynamoSend.mockResolvedValue({
      Table: {
        TableStatus: 'ACTIVE',
        ItemCount: 100,
      },
    });

    mockS3Send.mockResolvedValue({});

    mockSQSSend.mockResolvedValue({
      Attributes: {
        ApproximateNumberOfMessages: '5',
        ApproximateNumberOfMessagesNotVisible: '2',
      },
    });

    mockCloudWatchSend.mockResolvedValue({});

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await handler(mockEvent, mockContext);

    expect(mockDynamoSend).toHaveBeenCalled();
    expect(mockS3Send).toHaveBeenCalled();
    expect(mockSQSSend).toHaveBeenCalled();
    expect(mockCloudWatchSend).toHaveBeenCalled();
    expect(mockSNSSend).not.toHaveBeenCalled(); // No alerts for healthy system

    expect(consoleSpy).toHaveBeenCalledWith('Starting system health check...');
    expect(consoleSpy).toHaveBeenCalledWith(
      'Health check completed:',
      expect.stringContaining('"overallStatus":"healthy"')
    );

    consoleSpy.mockRestore();
  });

  it('should detect unhealthy DynamoDB and send alert', async () => {
    process.env.ALERT_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-alerts';

    // Mock DynamoDB failure
    mockDynamoSend.mockRejectedValue(new Error('DynamoDB connection failed'));

    // Mock other services as healthy
    mockS3Send.mockResolvedValue({});
    mockSQSSend.mockResolvedValue({
      Attributes: {
        ApproximateNumberOfMessages: '0',
        ApproximateNumberOfMessagesNotVisible: '0',
      },
    });

    mockCloudWatchSend.mockResolvedValue({});
    mockSNSSend.mockResolvedValue({});

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await handler(mockEvent, mockContext);

    expect(mockSNSSend).toHaveBeenCalled(); // Alert should be sent
    expect(consoleSpy).toHaveBeenCalledWith(
      'Health check completed:',
      expect.stringContaining('"overallStatus":"unhealthy"')
    );

    consoleSpy.mockRestore();
  });

  it('should detect degraded SQS with message backlog', async () => {
    // Mock successful responses but with high message count
    mockDynamoSend.mockResolvedValue({
      Table: {
        TableStatus: 'ACTIVE',
        ItemCount: 100,
      },
    });

    mockS3Send.mockResolvedValue({});

    mockSQSSend.mockResolvedValue({
      Attributes: {
        ApproximateNumberOfMessages: '150', // High message count
        ApproximateNumberOfMessagesNotVisible: '50',
      },
    });

    mockCloudWatchSend.mockResolvedValue({});

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await handler(mockEvent, mockContext);

    expect(mockCloudWatchSend).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Health check completed:',
      expect.stringContaining('"overallStatus":"degraded"')
    );

    consoleSpy.mockRestore();
  });

  it('should handle S3 access errors', async () => {
    // Mock DynamoDB as healthy
    mockDynamoSend.mockResolvedValue({
      Table: {
        TableStatus: 'ACTIVE',
        ItemCount: 100,
      },
    });

    // Mock S3 failure
    mockS3Send.mockRejectedValue(new Error('Access Denied'));

    // Mock other services as healthy
    mockSQSSend.mockResolvedValue({
      Attributes: {
        ApproximateNumberOfMessages: '0',
        ApproximateNumberOfMessagesNotVisible: '0',
      },
    });

    mockCloudWatchSend.mockResolvedValue({});

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await handler(mockEvent, mockContext);

    expect(consoleSpy).toHaveBeenCalledWith(
      'Health check completed:',
      expect.stringContaining('"overallStatus":"unhealthy"')
    );

    consoleSpy.mockRestore();
  });

  it('should send critical alert when health check system fails', async () => {
    process.env.ALERT_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-alerts';

    // Mock all services to throw errors
    mockDynamoSend.mockRejectedValue(new Error('System failure'));
    mockS3Send.mockRejectedValue(new Error('System failure'));
    mockSQSSend.mockRejectedValue(new Error('System failure'));
    mockCloudWatchSend.mockRejectedValue(new Error('CloudWatch failure'));
    mockSNSSend.mockResolvedValue({});

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    await handler(mockEvent, mockContext);

    expect(mockSNSSend).toHaveBeenCalledWith(
      expect.objectContaining({
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-alerts',
        Subject: 'CRITICAL: Health Check System Failure',
      })
    );

    consoleErrorSpy.mockRestore();
  });

  it('should handle missing environment variables gracefully', async () => {
    // Remove some environment variables
    delete process.env.CONTENT_TABLE_NAME;
    delete process.env.AUDIO_BUCKET_NAME;

    mockCloudWatchSend.mockResolvedValue({});

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await handler(mockEvent, mockContext);

    // Should still complete but with fewer checks
    expect(consoleSpy).toHaveBeenCalledWith('Starting system health check...');

    consoleSpy.mockRestore();
  });

  it('should not send alerts when alert topic is not configured', async () => {
    // Don't set ALERT_TOPIC_ARN

    // Mock DynamoDB failure
    mockDynamoSend.mockRejectedValue(new Error('DynamoDB connection failed'));
    mockS3Send.mockResolvedValue({});
    mockSQSSend.mockResolvedValue({
      Attributes: {
        ApproximateNumberOfMessages: '0',
        ApproximateNumberOfMessagesNotVisible: '0',
      },
    });
    mockCloudWatchSend.mockResolvedValue({});

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await handler(mockEvent, mockContext);

    expect(mockSNSSend).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Alert topic ARN not configured, skipping health alert'
    );

    consoleWarnSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('should include service response times in metrics', async () => {
    // Mock successful responses with some delay
    mockDynamoSend.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({
        Table: { TableStatus: 'ACTIVE', ItemCount: 100 }
      }), 100))
    );

    mockS3Send.mockResolvedValue({});
    mockSQSSend.mockResolvedValue({
      Attributes: {
        ApproximateNumberOfMessages: '0',
        ApproximateNumberOfMessagesNotVisible: '0',
      },
    });

    mockCloudWatchSend.mockResolvedValue({});

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await handler(mockEvent, mockContext);

    // Verify that CloudWatch metrics include response times
    expect(mockCloudWatchSend).toHaveBeenCalledWith(
      expect.objectContaining({
        Namespace: 'AutomatedBlogPoster/HealthCheck',
        MetricData: expect.arrayContaining([
          expect.objectContaining({
            MetricName: 'ServiceResponseTime',
            Dimensions: expect.arrayContaining([
              expect.objectContaining({
                Name: 'Service',
                Value: expect.any(String),
              }),
            ]),
          }),
        ]),
      })
    );

    consoleSpy.mockRestore();
  });
});