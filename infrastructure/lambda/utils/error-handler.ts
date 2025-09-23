import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

export interface ErrorContext {
  functionName: string;
  requestId: string;
  userId?: string;
  contentId?: string;
  operation?: string;
  metadata?: Record<string, any>;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
  retryableErrors?: string[];
}

export class ErrorHandler {
  private cloudWatchClient: CloudWatchClient;
  private snsClient: SNSClient;
  private alertTopicArn?: string;

  constructor() {
    this.cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION });
    this.snsClient = new SNSClient({ region: process.env.AWS_REGION });
    this.alertTopicArn = process.env.ALERT_TOPIC_ARN;
  }

  /**
   * Handle and log errors with context
   */
  async handleError(error: Error, context: ErrorContext): Promise<void> {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      context,
    };

    // Log structured error
    console.error('Error occurred:', JSON.stringify(errorInfo, null, 2));

    // Send custom metrics to CloudWatch
    await this.sendErrorMetrics(error, context);

    // Send alert for critical errors
    if (this.isCriticalError(error)) {
      await this.sendAlert(error, context);
    }
  }

  /**
   * Create user-friendly error response
   */
  createUserFriendlyResponse(error: Error, context: ErrorContext): {
    error: string;
    message: string;
    requestId: string;
    retryable: boolean;
    suggestedAction?: string;
  } {
    const isRetryable = this.isRetryableError(error);
    
    return {
      error: this.getUserFriendlyErrorType(error),
      message: this.getUserFriendlyMessage(error),
      requestId: context.requestId,
      retryable: isRetryable,
      suggestedAction: this.getSuggestedAction(error),
    };
  }

  /**
   * Retry function with exponential backoff
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    config: RetryConfig,
    context: ErrorContext
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateDelay(attempt, config);
          console.log(`Retry attempt ${attempt}/${config.maxRetries} after ${delay}ms delay`);
          await this.sleep(delay);
        }
        
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Log retry attempt
        console.warn(`Attempt ${attempt + 1} failed:`, {
          error: lastError.message,
          context,
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
        });

        // Check if error is retryable
        if (!this.isRetryableError(lastError, config.retryableErrors)) {
          console.error('Non-retryable error encountered:', lastError.message);
          break;
        }

        // If this was the last attempt, don't wait
        if (attempt === config.maxRetries) {
          break;
        }
      }
    }

    // All retries exhausted
    await this.handleError(lastError!, {
      ...context,
      operation: 'retry_exhausted',
      metadata: {
        ...context.metadata,
        maxRetries: config.maxRetries,
        finalAttempt: config.maxRetries + 1,
      },
    });

    throw lastError!;
  }

  /**
   * Validate input and throw user-friendly errors
   */
  validateInput(input: any, schema: ValidationSchema): void {
    const errors: string[] = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = input[field];

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value !== undefined && value !== null) {
        if (rules.type && typeof value !== rules.type) {
          errors.push(`${field} must be of type ${rules.type}`);
        }

        if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters long`);
        }

        if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
          errors.push(`${field} must be no more than ${rules.maxLength} characters long`);
        }

        if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
          errors.push(`${field} format is invalid`);
        }

        if (rules.custom && !rules.custom(value)) {
          errors.push(`${field} validation failed`);
        }
      }
    }

    if (errors.length > 0) {
      throw new ValidationError(`Input validation failed: ${errors.join(', ')}`);
    }
  }

  private async sendErrorMetrics(error: Error, context: ErrorContext): Promise<void> {
    try {
      const metricData = [
        {
          MetricName: 'ErrorCount',
          Value: 1,
          Unit: StandardUnit.Count,
          Dimensions: [
            { Name: 'FunctionName', Value: context.functionName },
            { Name: 'ErrorType', Value: error.name },
          ],
          Timestamp: new Date(),
        },
      ];

      if (context.operation) {
        metricData[0].Dimensions!.push({ Name: 'Operation', Value: context.operation });
      }

      await this.cloudWatchClient.send(new PutMetricDataCommand({
        Namespace: 'AutomatedBlogPoster/Errors',
        MetricData: metricData,
      }));
    } catch (metricsError) {
      console.error('Failed to send error metrics:', metricsError);
    }
  }

  private async sendAlert(error: Error, context: ErrorContext): Promise<void> {
    if (!this.alertTopicArn) {
      console.warn('Alert topic ARN not configured, skipping alert');
      return;
    }

    try {
      const alertMessage = {
        timestamp: new Date().toISOString(),
        severity: 'CRITICAL',
        service: 'AutomatedBlogPoster',
        function: context.functionName,
        error: {
          type: error.name,
          message: error.message,
        },
        context,
      };

      await this.snsClient.send(new PublishCommand({
        TopicArn: this.alertTopicArn,
        Subject: `CRITICAL: Error in ${context.functionName}`,
        Message: JSON.stringify(alertMessage, null, 2),
      }));
    } catch (alertError) {
      console.error('Failed to send alert:', alertError);
    }
  }

  private isCriticalError(error: Error): boolean {
    const criticalErrors = [
      'DynamoDBServiceException',
      'S3ServiceException',
      'TranscribeServiceException',
      'BedrockServiceException',
      'OutOfMemoryError',
      'TimeoutError',
    ];

    return criticalErrors.some(criticalError => 
      error.name.includes(criticalError) || error.message.includes(criticalError)
    );
  }

  private isRetryableError(error: Error, customRetryableErrors?: string[]): boolean {
    const defaultRetryableErrors = [
      'ThrottlingException',
      'ProvisionedThroughputExceededException',
      'ServiceUnavailable',
      'InternalServerError',
      'RequestTimeout',
      'NetworkingError',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
    ];

    const retryableErrors = customRetryableErrors || defaultRetryableErrors;
    
    return retryableErrors.some(retryableError => 
      error.name.includes(retryableError) || error.message.includes(retryableError)
    );
  }

  private getUserFriendlyErrorType(error: Error): string {
    if (error instanceof ValidationError) return 'VALIDATION_ERROR';
    if (error.name.includes('Throttling') || error.message.includes('Throttling')) return 'RATE_LIMIT_ERROR';
    if (error.name.includes('Timeout') || error.message.includes('Timeout')) return 'TIMEOUT_ERROR';
    if (error.name.includes('NotFound') || error.message.includes('NotFound')) return 'NOT_FOUND_ERROR';
    if (error.name.includes('Unauthorized') || error.message.includes('Unauthorized')) return 'AUTHENTICATION_ERROR';
    if (error.name.includes('Forbidden') || error.message.includes('Forbidden')) return 'AUTHORIZATION_ERROR';
    return 'SYSTEM_ERROR';
  }

  private getUserFriendlyMessage(error: Error): string {
    if (error instanceof ValidationError) {
      return error.message;
    }
    
    if (error.name.includes('Throttling') || error.message.includes('Throttling')) {
      return 'The system is currently experiencing high load. Please try again in a few moments.';
    }
    
    if (error.name.includes('Timeout') || error.message.includes('Timeout')) {
      return 'The operation took longer than expected. Please try again.';
    }
    
    if (error.name.includes('NotFound') || error.message.includes('NotFound')) {
      return 'The requested resource was not found.';
    }
    
    if (error.name.includes('Unauthorized') || error.message.includes('Unauthorized')) {
      return 'Authentication is required. Please log in and try again.';
    }
    
    if (error.name.includes('Forbidden') || error.message.includes('Forbidden')) {
      return 'You do not have permission to perform this action.';
    }
    
    return 'An unexpected error occurred. Our team has been notified and is working to resolve the issue.';
  }

  private getSuggestedAction(error: Error): string | undefined {
    if (error instanceof ValidationError) {
      return 'Please check your input and try again.';
    }
    
    if (error.name.includes('Throttling') || error.message.includes('Throttling')) {
      return 'Wait a few moments and try again.';
    }
    
    if (error.name.includes('Timeout') || error.message.includes('Timeout')) {
      return 'Try again with a smaller request or check your internet connection.';
    }
    
    if (error.name.includes('Unauthorized') || error.message.includes('Unauthorized')) {
      return 'Please log in and try again.';
    }
    
    if (error.name.includes('Forbidden') || error.message.includes('Forbidden')) {
      return 'Contact support if you believe you should have access to this resource.';
    }
    
    return 'If the problem persists, please contact support.';
  }

  private calculateDelay(attempt: number, config: RetryConfig): number {
    const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
    const jitteredDelay = exponentialDelay * (0.5 + Math.random() * 0.5); // Add jitter
    return Math.min(jitteredDelay, config.maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface ValidationSchema {
  [field: string]: {
    required?: boolean;
    type?: 'string' | 'number' | 'boolean' | 'object';
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    custom?: (value: any) => boolean;
  };
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Default retry configurations
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

export const AGGRESSIVE_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelay: 500,
  maxDelay: 60000,
  backoffMultiplier: 2.5,
};

export const CONSERVATIVE_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelay: 2000,
  maxDelay: 15000,
  backoffMultiplier: 1.5,
};