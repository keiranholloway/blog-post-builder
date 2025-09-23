import { ErrorHandler, ValidationError, DEFAULT_RETRY_CONFIG, AGGRESSIVE_RETRY_CONFIG } from '../lambda/utils/error-handler';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { SNSClient } from '@aws-sdk/client-sns';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-cloudwatch');
jest.mock('@aws-sdk/client-sns');

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;
  let mockCloudWatchSend: jest.Mock;
  let mockSNSSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockCloudWatchSend = jest.fn().mockResolvedValue({});
    mockSNSSend = jest.fn().mockResolvedValue({});
    
    (CloudWatchClient as jest.Mock).mockImplementation(() => ({
      send: mockCloudWatchSend,
    }));
    
    (SNSClient as jest.Mock).mockImplementation(() => ({
      send: mockSNSSend,
    }));

    errorHandler = new ErrorHandler();
  });

  describe('handleError', () => {
    it('should log error and send metrics', async () => {
      const error = new Error('Test error');
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
        operation: 'test-operation',
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await errorHandler.handleError(error, context);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error occurred:',
        expect.stringContaining('Test error')
      );
      expect(mockCloudWatchSend).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should send alert for critical errors', async () => {
      process.env.ALERT_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';
      
      // Create a new error handler instance after setting the environment variable
      const testErrorHandler = new ErrorHandler();
      
      const error = new Error('Critical error with DynamoDBServiceException');
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await testErrorHandler.handleError(error, context);

      expect(mockSNSSend).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
      delete process.env.ALERT_TOPIC_ARN;
    });
  });

  describe('createUserFriendlyResponse', () => {
    it('should create user-friendly response for validation error', () => {
      const error = new ValidationError('Invalid input data');
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
      };

      const response = errorHandler.createUserFriendlyResponse(error, context);

      expect(response).toEqual({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        requestId: 'test-request-id',
        retryable: false,
        suggestedAction: 'Please check your input and try again.',
      });
    });

    it('should create user-friendly response for throttling error', () => {
      const error = new Error('ThrottlingException: Rate limit exceeded');
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
      };

      const response = errorHandler.createUserFriendlyResponse(error, context);

      expect(response).toEqual({
        error: 'RATE_LIMIT_ERROR',
        message: 'The system is currently experiencing high load. Please try again in a few moments.',
        requestId: 'test-request-id',
        retryable: true,
        suggestedAction: 'Wait a few moments and try again.',
      });
    });

    it('should create user-friendly response for system error', () => {
      const error = new Error('Unexpected system error');
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
      };

      const response = errorHandler.createUserFriendlyResponse(error, context);

      expect(response).toEqual({
        error: 'SYSTEM_ERROR',
        message: 'An unexpected error occurred. Our team has been notified and is working to resolve the issue.',
        requestId: 'test-request-id',
        retryable: false,
        suggestedAction: 'If the problem persists, please contact support.',
      });
    });
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
      };

      const result = await errorHandler.retryWithBackoff(
        operation,
        DEFAULT_RETRY_CONFIG,
        context
      );

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error and eventually succeed', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('ThrottlingException'))
        .mockRejectedValueOnce(new Error('ThrottlingException'))
        .mockResolvedValue('success');
      
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
      };

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await errorHandler.retryWithBackoff(
        operation,
        DEFAULT_RETRY_CONFIG,
        context
      );

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
      expect(consoleSpy).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });

    it('should not retry on non-retryable error', async () => {
      const operation = jest.fn().mockRejectedValue(new ValidationError('Invalid input'));
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(
        errorHandler.retryWithBackoff(operation, DEFAULT_RETRY_CONFIG, context)
      ).rejects.toThrow('Invalid input');

      expect(operation).toHaveBeenCalledTimes(1);
      
      consoleSpy.mockRestore();
    });

    it('should exhaust retries and throw last error', async () => {
      const fastRetryConfig = {
        maxRetries: 2,
        baseDelay: 10,
        maxDelay: 100,
        backoffMultiplier: 1.5,
      };
      
      const operation = jest.fn().mockRejectedValue(new Error('ThrottlingException'));
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
      };

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(
        errorHandler.retryWithBackoff(operation, fastRetryConfig, context)
      ).rejects.toThrow('ThrottlingException');

      expect(operation).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
      
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }, 10000);

    it('should use custom retryable errors', async () => {
      const customConfig = {
        maxRetries: 2,
        baseDelay: 10,
        maxDelay: 100,
        backoffMultiplier: 1.5,
        retryableErrors: ['CustomError'],
      };
      
      const operation = jest.fn().mockRejectedValue(new Error('CustomError: Something went wrong'));
      const context = {
        functionName: 'test-function',
        requestId: 'test-request-id',
      };

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(
        errorHandler.retryWithBackoff(operation, customConfig, context)
      ).rejects.toThrow('CustomError');

      expect(operation).toHaveBeenCalledTimes(3); // Should retry custom error
      
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }, 10000);
  });

  describe('validateInput', () => {
    it('should pass validation for valid input', () => {
      const input = {
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
      };

      const schema = {
        name: { required: true, type: 'string' as const, minLength: 2 },
        email: { required: true, type: 'string' as const, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        age: { required: true, type: 'number' as const },
      };

      expect(() => errorHandler.validateInput(input, schema)).not.toThrow();
    });

    it('should throw ValidationError for missing required field', () => {
      const input = {
        name: 'John Doe',
      };

      const schema = {
        name: { required: true, type: 'string' as const },
        email: { required: true, type: 'string' as const },
      };

      expect(() => errorHandler.validateInput(input, schema))
        .toThrow(ValidationError);
    });

    it('should throw ValidationError for wrong type', () => {
      const input = {
        name: 123,
      };

      const schema = {
        name: { required: true, type: 'string' as const },
      };

      expect(() => errorHandler.validateInput(input, schema))
        .toThrow('name must be of type string');
    });

    it('should throw ValidationError for string too short', () => {
      const input = {
        name: 'A',
      };

      const schema = {
        name: { required: true, type: 'string' as const, minLength: 2 },
      };

      expect(() => errorHandler.validateInput(input, schema))
        .toThrow('name must be at least 2 characters long');
    });

    it('should throw ValidationError for string too long', () => {
      const input = {
        name: 'This is a very long name that exceeds the maximum length',
      };

      const schema = {
        name: { required: true, type: 'string' as const, maxLength: 10 },
      };

      expect(() => errorHandler.validateInput(input, schema))
        .toThrow('name must be no more than 10 characters long');
    });

    it('should throw ValidationError for pattern mismatch', () => {
      const input = {
        email: 'invalid-email',
      };

      const schema = {
        email: { required: true, type: 'string' as const, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      };

      expect(() => errorHandler.validateInput(input, schema))
        .toThrow('email format is invalid');
    });

    it('should throw ValidationError for custom validation failure', () => {
      const input = {
        age: 15,
      };

      const schema = {
        age: { 
          required: true, 
          type: 'number' as const, 
          custom: (value: number) => value >= 18 
        },
      };

      expect(() => errorHandler.validateInput(input, schema))
        .toThrow('age validation failed');
    });

    it('should allow optional fields to be undefined', () => {
      const input = {
        name: 'John Doe',
      };

      const schema = {
        name: { required: true, type: 'string' as const },
        nickname: { required: false, type: 'string' as const },
      };

      expect(() => errorHandler.validateInput(input, schema)).not.toThrow();
    });
  });

  describe('retry configurations', () => {
    it('should have correct default retry config', () => {
      expect(DEFAULT_RETRY_CONFIG).toEqual({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
      });
    });

    it('should have correct aggressive retry config', () => {
      expect(AGGRESSIVE_RETRY_CONFIG).toEqual({
        maxRetries: 5,
        baseDelay: 500,
        maxDelay: 60000,
        backoffMultiplier: 2.5,
      });
    });
  });
});