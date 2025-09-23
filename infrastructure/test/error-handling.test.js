"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const error_handler_1 = require("../lambda/utils/error-handler");
const client_cloudwatch_1 = require("@aws-sdk/client-cloudwatch");
const client_sns_1 = require("@aws-sdk/client-sns");
// Mock AWS SDK clients
jest.mock('@aws-sdk/client-cloudwatch');
jest.mock('@aws-sdk/client-sns');
describe('ErrorHandler', () => {
    let errorHandler;
    let mockCloudWatchSend;
    let mockSNSSend;
    beforeEach(() => {
        jest.clearAllMocks();
        mockCloudWatchSend = jest.fn().mockResolvedValue({});
        mockSNSSend = jest.fn().mockResolvedValue({});
        client_cloudwatch_1.CloudWatchClient.mockImplementation(() => ({
            send: mockCloudWatchSend,
        }));
        client_sns_1.SNSClient.mockImplementation(() => ({
            send: mockSNSSend,
        }));
        errorHandler = new error_handler_1.ErrorHandler();
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
            expect(consoleSpy).toHaveBeenCalledWith('Error occurred:', expect.stringContaining('Test error'));
            expect(mockCloudWatchSend).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
        it('should send alert for critical errors', async () => {
            process.env.ALERT_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';
            // Create a new error handler instance after setting the environment variable
            const testErrorHandler = new error_handler_1.ErrorHandler();
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
            const error = new error_handler_1.ValidationError('Invalid input data');
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
            const result = await errorHandler.retryWithBackoff(operation, error_handler_1.DEFAULT_RETRY_CONFIG, context);
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
            const result = await errorHandler.retryWithBackoff(operation, error_handler_1.DEFAULT_RETRY_CONFIG, context);
            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(3);
            expect(consoleSpy).toHaveBeenCalledTimes(2);
            consoleSpy.mockRestore();
        });
        it('should not retry on non-retryable error', async () => {
            const operation = jest.fn().mockRejectedValue(new error_handler_1.ValidationError('Invalid input'));
            const context = {
                functionName: 'test-function',
                requestId: 'test-request-id',
            };
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            await expect(errorHandler.retryWithBackoff(operation, error_handler_1.DEFAULT_RETRY_CONFIG, context)).rejects.toThrow('Invalid input');
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
            await expect(errorHandler.retryWithBackoff(operation, fastRetryConfig, context)).rejects.toThrow('ThrottlingException');
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
            await expect(errorHandler.retryWithBackoff(operation, customConfig, context)).rejects.toThrow('CustomError');
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
                name: { required: true, type: 'string', minLength: 2 },
                email: { required: true, type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
                age: { required: true, type: 'number' },
            };
            expect(() => errorHandler.validateInput(input, schema)).not.toThrow();
        });
        it('should throw ValidationError for missing required field', () => {
            const input = {
                name: 'John Doe',
            };
            const schema = {
                name: { required: true, type: 'string' },
                email: { required: true, type: 'string' },
            };
            expect(() => errorHandler.validateInput(input, schema))
                .toThrow(error_handler_1.ValidationError);
        });
        it('should throw ValidationError for wrong type', () => {
            const input = {
                name: 123,
            };
            const schema = {
                name: { required: true, type: 'string' },
            };
            expect(() => errorHandler.validateInput(input, schema))
                .toThrow('name must be of type string');
        });
        it('should throw ValidationError for string too short', () => {
            const input = {
                name: 'A',
            };
            const schema = {
                name: { required: true, type: 'string', minLength: 2 },
            };
            expect(() => errorHandler.validateInput(input, schema))
                .toThrow('name must be at least 2 characters long');
        });
        it('should throw ValidationError for string too long', () => {
            const input = {
                name: 'This is a very long name that exceeds the maximum length',
            };
            const schema = {
                name: { required: true, type: 'string', maxLength: 10 },
            };
            expect(() => errorHandler.validateInput(input, schema))
                .toThrow('name must be no more than 10 characters long');
        });
        it('should throw ValidationError for pattern mismatch', () => {
            const input = {
                email: 'invalid-email',
            };
            const schema = {
                email: { required: true, type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
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
                    type: 'number',
                    custom: (value) => value >= 18
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
                name: { required: true, type: 'string' },
                nickname: { required: false, type: 'string' },
            };
            expect(() => errorHandler.validateInput(input, schema)).not.toThrow();
        });
    });
    describe('retry configurations', () => {
        it('should have correct default retry config', () => {
            expect(error_handler_1.DEFAULT_RETRY_CONFIG).toEqual({
                maxRetries: 3,
                baseDelay: 1000,
                maxDelay: 30000,
                backoffMultiplier: 2,
            });
        });
        it('should have correct aggressive retry config', () => {
            expect(error_handler_1.AGGRESSIVE_RETRY_CONFIG).toEqual({
                maxRetries: 5,
                baseDelay: 500,
                maxDelay: 60000,
                backoffMultiplier: 2.5,
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3ItaGFuZGxpbmcudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImVycm9yLWhhbmRsaW5nLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxpRUFBNkg7QUFDN0gsa0VBQThEO0FBQzlELG9EQUFnRDtBQUVoRCx1QkFBdUI7QUFDdkIsSUFBSSxDQUFDLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDO0FBQ3hDLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztBQUVqQyxRQUFRLENBQUMsY0FBYyxFQUFFLEdBQUcsRUFBRTtJQUM1QixJQUFJLFlBQTBCLENBQUM7SUFDL0IsSUFBSSxrQkFBNkIsQ0FBQztJQUNsQyxJQUFJLFdBQXNCLENBQUM7SUFFM0IsVUFBVSxDQUFDLEdBQUcsRUFBRTtRQUNkLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUVyQixrQkFBa0IsR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDckQsV0FBVyxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUU3QyxvQ0FBOEIsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1lBQ3hELElBQUksRUFBRSxrQkFBa0I7U0FDekIsQ0FBQyxDQUFDLENBQUM7UUFFSCxzQkFBdUIsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1lBQ2pELElBQUksRUFBRSxXQUFXO1NBQ2xCLENBQUMsQ0FBQyxDQUFDO1FBRUosWUFBWSxHQUFHLElBQUksNEJBQVksRUFBRSxDQUFDO0lBQ3BDLENBQUMsQ0FBQyxDQUFDO0lBRUgsUUFBUSxDQUFDLGFBQWEsRUFBRSxHQUFHLEVBQUU7UUFDM0IsRUFBRSxDQUFDLG1DQUFtQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ2pELE1BQU0sS0FBSyxHQUFHLElB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Q3RDLFVBQVUsRUFBRSxDQUFDO2dCQUNiLFNBQVMsRUFBRSxHQUFHO2dCQUNkLFFBQVEsRUFBRSxLQUFLO2dCQUNmLGlCQUFpQixFQUFFLEdBQUc7YUFDdkIsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRXJyb3JIYW5kbGVyLCBWYWxpZGF0aW9uRXJyb3IsIERFRkFVTFRfUkVUUllfQ09ORklHLCBBR0dSRVNTSVZFX1JFVFJZX0NPTkZJRyB9IGZyb20gJy4uL2xhbWJkYS91dGlscy9lcnJvci1oYW5kbGVyJztcclxuaW1wb3J0IHsgQ2xvdWRXYXRjaENsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1jbG91ZHdhdGNoJztcclxuaW1wb3J0IHsgU05TQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNucyc7XHJcblxyXG4vLyBNb2NrIEFXUyBTREsgY2xpZW50c1xyXG5qZXN0Lm1vY2soJ0Bhd3Mtc2RrL2NsaWVudC1jbG91ZHdhdGNoJyk7XHJcbmplc3QubW9jaygnQGF3cy1zZGsvY2xpZW50LXNucycpO1xyXG5cclxuZGVzY3JpYmUoJ0Vycm9ySGFuZGxlcicsICgpID0+IHtcclxuICBsZXQgZXJyb3JIYW5kbGVyOiBFcnJvckhhbmRsZXI7XHJcbiAgbGV0IG1vY2tDbG91ZFdhdGNoU2VuZDogamVzdC5Nb2NrO1xyXG4gIGxldCBtb2NrU05TU2VuZDogamVzdC5Nb2NrO1xyXG5cclxuICBiZWZvcmVFYWNoKCgpID0+IHtcclxuICAgIGplc3QuY2xlYXJBbGxNb2NrcygpO1xyXG4gICAgXHJcbiAgICBtb2NrQ2xvdWRXYXRjaFNlbmQgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG4gICAgbW9ja1NOU1NlbmQgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoe30pO1xyXG4gICAgXHJcbiAgICAoQ2xvdWRXYXRjaENsaWVudCBhcyBqZXN0Lk1vY2spLm1vY2tJbXBsZW1lbnRhdGlvbigoKSA9PiAoe1xyXG4gICAgICBzZW5kOiBtb2NrQ2xvdWRXYXRjaFNlbmQsXHJcbiAgICB9KSk7XHJcbiAgICBcclxuICAgIChTTlNDbGllbnQgYXMgamVzdC5Nb2NrKS5tb2NrSW1wbGVtZW50YXRpb24oKCkgPT4gKHtcclxuICAgICAgc2VuZDogbW9ja1NOU1NlbmQsXHJcbiAgICB9KSk7XHJcblxyXG4gICAgZXJyb3JIYW5kbGVyID0gbmV3IEVycm9ySGFuZGxlcigpO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnaGFuZGxlRXJyb3InLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGxvZyBlcnJvciBhbmQgc2VuZCBtZXRyaWNzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignVGVzdCBlcnJvcicpO1xyXG4gICAgICBjb25zdCBjb250ZXh0ID0ge1xyXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogJ3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICAgICAgb3BlcmF0aW9uOiAndGVzdC1vcGVyYXRpb24nLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgY29uc29sZVNweSA9IGplc3Quc3B5T24oY29uc29sZSwgJ2Vycm9yJykubW9ja0ltcGxlbWVudGF0aW9uKCk7XHJcblxyXG4gICAgICBhd2FpdCBlcnJvckhhbmRsZXIuaGFuZGxlRXJyb3IoZXJyb3IsIGNvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KGNvbnNvbGVTcHkpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFxyXG4gICAgICAgICdFcnJvciBvY2N1cnJlZDonLFxyXG4gICAgICAgIGV4cGVjdC5zdHJpbmdDb250YWluaW5nKCdUZXN0IGVycm9yJylcclxuICAgICAgKTtcclxuICAgICAgZXhwZWN0KG1vY2tDbG91ZFdhdGNoU2VuZCkudG9IYXZlQmVlbkNhbGxlZCgpO1xyXG5cclxuICAgICAgY29uc29sZVNweS5tb2NrUmVzdG9yZSgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBzZW5kIGFsZXJ0IGZvciBjcml0aWNhbCBlcnJvcnMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIHByb2Nlc3MuZW52LkFMRVJUX1RPUElDX0FSTiA9ICdhcm46YXdzOnNuczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtdG9waWMnO1xyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIGEgbmV3IGVycm9yIGhhbmRsZXIgaW5zdGFuY2UgYWZ0ZXIgc2V0dGluZyB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGVcclxuICAgICAgY29uc3QgdGVzdEVycm9ySGFuZGxlciA9IG5ldyBFcnJvckhhbmRsZXIoKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdDcml0aWNhbCBlcnJvciB3aXRoIER5bmFtb0RCU2VydmljZUV4Y2VwdGlvbicpO1xyXG4gICAgICBjb25zdCBjb250ZXh0ID0ge1xyXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogJ3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBjb25zb2xlU3B5ID0gamVzdC5zcHlPbihjb25zb2xlLCAnZXJyb3InKS5tb2NrSW1wbGVtZW50YXRpb24oKTtcclxuXHJcbiAgICAgIGF3YWl0IHRlc3RFcnJvckhhbmRsZXIuaGFuZGxlRXJyb3IoZXJyb3IsIGNvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KG1vY2tTTlNTZW5kKS50b0hhdmVCZWVuQ2FsbGVkKCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlU3B5Lm1vY2tSZXN0b3JlKCk7XHJcbiAgICAgIGRlbGV0ZSBwcm9jZXNzLmVudi5BTEVSVF9UT1BJQ19BUk47XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ2NyZWF0ZVVzZXJGcmllbmRseVJlc3BvbnNlJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdXNlci1mcmllbmRseSByZXNwb25zZSBmb3IgdmFsaWRhdGlvbiBlcnJvcicsICgpID0+IHtcclxuICAgICAgY29uc3QgZXJyb3IgPSBuZXcgVmFsaWRhdGlvbkVycm9yKCdJbnZhbGlkIGlucHV0IGRhdGEnKTtcclxuICAgICAgY29uc3QgY29udGV4dCA9IHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcclxuICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBlcnJvckhhbmRsZXIuY3JlYXRlVXNlckZyaWVuZGx5UmVzcG9uc2UoZXJyb3IsIGNvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3BvbnNlKS50b0VxdWFsKHtcclxuICAgICAgICBlcnJvcjogJ1ZBTElEQVRJT05fRVJST1InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdJbnZhbGlkIGlucHV0IGRhdGEnLFxyXG4gICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICAgICAgcmV0cnlhYmxlOiBmYWxzZSxcclxuICAgICAgICBzdWdnZXN0ZWRBY3Rpb246ICdQbGVhc2UgY2hlY2sgeW91ciBpbnB1dCBhbmQgdHJ5IGFnYWluLicsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdXNlci1mcmllbmRseSByZXNwb25zZSBmb3IgdGhyb3R0bGluZyBlcnJvcicsICgpID0+IHtcclxuICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ1Rocm90dGxpbmdFeGNlcHRpb246IFJhdGUgbGltaXQgZXhjZWVkZWQnKTtcclxuICAgICAgY29uc3QgY29udGV4dCA9IHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcclxuICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBlcnJvckhhbmRsZXIuY3JlYXRlVXNlckZyaWVuZGx5UmVzcG9uc2UoZXJyb3IsIGNvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3BvbnNlKS50b0VxdWFsKHtcclxuICAgICAgICBlcnJvcjogJ1JBVEVfTElNSVRfRVJST1InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdUaGUgc3lzdGVtIGlzIGN1cnJlbnRseSBleHBlcmllbmNpbmcgaGlnaCBsb2FkLiBQbGVhc2UgdHJ5IGFnYWluIGluIGEgZmV3IG1vbWVudHMuJyxcclxuICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgICAgIHJldHJ5YWJsZTogdHJ1ZSxcclxuICAgICAgICBzdWdnZXN0ZWRBY3Rpb246ICdXYWl0IGEgZmV3IG1vbWVudHMgYW5kIHRyeSBhZ2Fpbi4nLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgY3JlYXRlIHVzZXItZnJpZW5kbHkgcmVzcG9uc2UgZm9yIHN5c3RlbSBlcnJvcicsICgpID0+IHtcclxuICAgICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ1VuZXhwZWN0ZWQgc3lzdGVtIGVycm9yJyk7XHJcbiAgICAgIGNvbnN0IGNvbnRleHQgPSB7XHJcbiAgICAgICAgZnVuY3Rpb25OYW1lOiAndGVzdC1mdW5jdGlvbicsXHJcbiAgICAgICAgcmVxdWVzdElkOiAndGVzdC1yZXF1ZXN0LWlkJyxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gZXJyb3JIYW5kbGVyLmNyZWF0ZVVzZXJGcmllbmRseVJlc3BvbnNlKGVycm9yLCBjb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXNwb25zZSkudG9FcXVhbCh7XHJcbiAgICAgICAgZXJyb3I6ICdTWVNURU1fRVJST1InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdBbiB1bmV4cGVjdGVkIGVycm9yIG9jY3VycmVkLiBPdXIgdGVhbSBoYXMgYmVlbiBub3RpZmllZCBhbmQgaXMgd29ya2luZyB0byByZXNvbHZlIHRoZSBpc3N1ZS4nLFxyXG4gICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICAgICAgcmV0cnlhYmxlOiBmYWxzZSxcclxuICAgICAgICBzdWdnZXN0ZWRBY3Rpb246ICdJZiB0aGUgcHJvYmxlbSBwZXJzaXN0cywgcGxlYXNlIGNvbnRhY3Qgc3VwcG9ydC4nLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgncmV0cnlXaXRoQmFja29mZicsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgc3VjY2VlZCBvbiBmaXJzdCBhdHRlbXB0JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBvcGVyYXRpb24gPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUoJ3N1Y2Nlc3MnKTtcclxuICAgICAgY29uc3QgY29udGV4dCA9IHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcclxuICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZXJyb3JIYW5kbGVyLnJldHJ5V2l0aEJhY2tvZmYoXHJcbiAgICAgICAgb3BlcmF0aW9uLFxyXG4gICAgICAgIERFRkFVTFRfUkVUUllfQ09ORklHLFxyXG4gICAgICAgIGNvbnRleHRcclxuICAgICAgKTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvQmUoJ3N1Y2Nlc3MnKTtcclxuICAgICAgZXhwZWN0KG9wZXJhdGlvbikudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCByZXRyeSBvbiByZXRyeWFibGUgZXJyb3IgYW5kIGV2ZW50dWFsbHkgc3VjY2VlZCcsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3Qgb3BlcmF0aW9uID0gamVzdC5mbigpXHJcbiAgICAgICAgLm1vY2tSZWplY3RlZFZhbHVlT25jZShuZXcgRXJyb3IoJ1Rocm90dGxpbmdFeGNlcHRpb24nKSlcclxuICAgICAgICAubW9ja1JlamVjdGVkVmFsdWVPbmNlKG5ldyBFcnJvcignVGhyb3R0bGluZ0V4Y2VwdGlvbicpKVxyXG4gICAgICAgIC5tb2NrUmVzb2x2ZWRWYWx1ZSgnc3VjY2VzcycpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgY29udGV4dCA9IHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcclxuICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgY29uc29sZVNweSA9IGplc3Quc3B5T24oY29uc29sZSwgJ3dhcm4nKS5tb2NrSW1wbGVtZW50YXRpb24oKTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGVycm9ySGFuZGxlci5yZXRyeVdpdGhCYWNrb2ZmKFxyXG4gICAgICAgIG9wZXJhdGlvbixcclxuICAgICAgICBERUZBVUxUX1JFVFJZX0NPTkZJRyxcclxuICAgICAgICBjb250ZXh0XHJcbiAgICAgICk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0KS50b0JlKCdzdWNjZXNzJyk7XHJcbiAgICAgIGV4cGVjdChvcGVyYXRpb24pLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygzKTtcclxuICAgICAgZXhwZWN0KGNvbnNvbGVTcHkpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcclxuXHJcbiAgICAgIGNvbnNvbGVTcHkubW9ja1Jlc3RvcmUoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgbm90IHJldHJ5IG9uIG5vbi1yZXRyeWFibGUgZXJyb3InLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IGplc3QuZm4oKS5tb2NrUmVqZWN0ZWRWYWx1ZShuZXcgVmFsaWRhdGlvbkVycm9yKCdJbnZhbGlkIGlucHV0JykpO1xyXG4gICAgICBjb25zdCBjb250ZXh0ID0ge1xyXG4gICAgICAgIGZ1bmN0aW9uTmFtZTogJ3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgICAgIHJlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBjb25zb2xlU3B5ID0gamVzdC5zcHlPbihjb25zb2xlLCAnZXJyb3InKS5tb2NrSW1wbGVtZW50YXRpb24oKTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChcclxuICAgICAgICBlcnJvckhhbmRsZXIucmV0cnlXaXRoQmFja29mZihvcGVyYXRpb24sIERFRkFVTFRfUkVUUllfQ09ORklHLCBjb250ZXh0KVxyXG4gICAgICApLnJlamVjdHMudG9UaHJvdygnSW52YWxpZCBpbnB1dCcpO1xyXG5cclxuICAgICAgZXhwZWN0KG9wZXJhdGlvbikudG9IYXZlQmVlbkNhbGxlZFRpbWVzKDEpO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZVNweS5tb2NrUmVzdG9yZSgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBleGhhdXN0IHJldHJpZXMgYW5kIHRocm93IGxhc3QgZXJyb3InLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGZhc3RSZXRyeUNvbmZpZyA9IHtcclxuICAgICAgICBtYXhSZXRyaWVzOiAyLFxyXG4gICAgICAgIGJhc2VEZWxheTogMTAsXHJcbiAgICAgICAgbWF4RGVsYXk6IDEwMCxcclxuICAgICAgICBiYWNrb2ZmTXVsdGlwbGllcjogMS41LFxyXG4gICAgICB9O1xyXG4gICAgICBcclxuICAgICAgY29uc3Qgb3BlcmF0aW9uID0gamVzdC5mbigpLm1vY2tSZWplY3RlZFZhbHVlKG5ldyBFcnJvcignVGhyb3R0bGluZ0V4Y2VwdGlvbicpKTtcclxuICAgICAgY29uc3QgY29udGV4dCA9IHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcclxuICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgY29uc29sZVNweSA9IGplc3Quc3B5T24oY29uc29sZSwgJ3dhcm4nKS5tb2NrSW1wbGVtZW50YXRpb24oKTtcclxuICAgICAgY29uc3QgY29uc29sZUVycm9yU3B5ID0gamVzdC5zcHlPbihjb25zb2xlLCAnZXJyb3InKS5tb2NrSW1wbGVtZW50YXRpb24oKTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChcclxuICAgICAgICBlcnJvckhhbmRsZXIucmV0cnlXaXRoQmFja29mZihvcGVyYXRpb24sIGZhc3RSZXRyeUNvbmZpZywgY29udGV4dClcclxuICAgICAgKS5yZWplY3RzLnRvVGhyb3coJ1Rocm90dGxpbmdFeGNlcHRpb24nKTtcclxuXHJcbiAgICAgIGV4cGVjdChvcGVyYXRpb24pLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygzKTsgLy8gMSBpbml0aWFsICsgMiByZXRyaWVzXHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlU3B5Lm1vY2tSZXN0b3JlKCk7XHJcbiAgICAgIGNvbnNvbGVFcnJvclNweS5tb2NrUmVzdG9yZSgpO1xyXG4gICAgfSwgMTAwMDApO1xyXG5cclxuICAgIGl0KCdzaG91bGQgdXNlIGN1c3RvbSByZXRyeWFibGUgZXJyb3JzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBjdXN0b21Db25maWcgPSB7XHJcbiAgICAgICAgbWF4UmV0cmllczogMixcclxuICAgICAgICBiYXNlRGVsYXk6IDEwLFxyXG4gICAgICAgIG1heERlbGF5OiAxMDAsXHJcbiAgICAgICAgYmFja29mZk11bHRpcGxpZXI6IDEuNSxcclxuICAgICAgICByZXRyeWFibGVFcnJvcnM6IFsnQ3VzdG9tRXJyb3InXSxcclxuICAgICAgfTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IG9wZXJhdGlvbiA9IGplc3QuZm4oKS5tb2NrUmVqZWN0ZWRWYWx1ZShuZXcgRXJyb3IoJ0N1c3RvbUVycm9yOiBTb21ldGhpbmcgd2VudCB3cm9uZycpKTtcclxuICAgICAgY29uc3QgY29udGV4dCA9IHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcclxuICAgICAgICByZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgY29uc29sZVNweSA9IGplc3Quc3B5T24oY29uc29sZSwgJ3dhcm4nKS5tb2NrSW1wbGVtZW50YXRpb24oKTtcclxuICAgICAgY29uc3QgY29uc29sZUVycm9yU3B5ID0gamVzdC5zcHlPbihjb25zb2xlLCAnZXJyb3InKS5tb2NrSW1wbGVtZW50YXRpb24oKTtcclxuXHJcbiAgICAgIGF3YWl0IGV4cGVjdChcclxuICAgICAgICBlcnJvckhhbmRsZXIucmV0cnlXaXRoQmFja29mZihvcGVyYXRpb24sIGN1c3RvbUNvbmZpZywgY29udGV4dClcclxuICAgICAgKS5yZWplY3RzLnRvVGhyb3coJ0N1c3RvbUVycm9yJyk7XHJcblxyXG4gICAgICBleHBlY3Qob3BlcmF0aW9uKS50b0hhdmVCZWVuQ2FsbGVkVGltZXMoMyk7IC8vIFNob3VsZCByZXRyeSBjdXN0b20gZXJyb3JcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGVTcHkubW9ja1Jlc3RvcmUoKTtcclxuICAgICAgY29uc29sZUVycm9yU3B5Lm1vY2tSZXN0b3JlKCk7XHJcbiAgICB9LCAxMDAwMCk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCd2YWxpZGF0ZUlucHV0JywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBwYXNzIHZhbGlkYXRpb24gZm9yIHZhbGlkIGlucHV0JywgKCkgPT4ge1xyXG4gICAgICBjb25zdCBpbnB1dCA9IHtcclxuICAgICAgICBuYW1lOiAnSm9obiBEb2UnLFxyXG4gICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbScsXHJcbiAgICAgICAgYWdlOiAzMCxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHNjaGVtYSA9IHtcclxuICAgICAgICBuYW1lOiB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiAnc3RyaW5nJyBhcyBjb25zdCwgbWluTGVuZ3RoOiAyIH0sXHJcbiAgICAgICAgZW1haWw6IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0LCBwYXR0ZXJuOiAvXlteXFxzQF0rQFteXFxzQF0rXFwuW15cXHNAXSskLyB9LFxyXG4gICAgICAgIGFnZTogeyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogJ251bWJlcicgYXMgY29uc3QgfSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGV4cGVjdCgoKSA9PiBlcnJvckhhbmRsZXIudmFsaWRhdGVJbnB1dChpbnB1dCwgc2NoZW1hKSkubm90LnRvVGhyb3coKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgdGhyb3cgVmFsaWRhdGlvbkVycm9yIGZvciBtaXNzaW5nIHJlcXVpcmVkIGZpZWxkJywgKCkgPT4ge1xyXG4gICAgICBjb25zdCBpbnB1dCA9IHtcclxuICAgICAgICBuYW1lOiAnSm9obiBEb2UnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3Qgc2NoZW1hID0ge1xyXG4gICAgICAgIG5hbWU6IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0IH0sXHJcbiAgICAgICAgZW1haWw6IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0IH0sXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBleHBlY3QoKCkgPT4gZXJyb3JIYW5kbGVyLnZhbGlkYXRlSW5wdXQoaW5wdXQsIHNjaGVtYSkpXHJcbiAgICAgICAgLnRvVGhyb3coVmFsaWRhdGlvbkVycm9yKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgdGhyb3cgVmFsaWRhdGlvbkVycm9yIGZvciB3cm9uZyB0eXBlJywgKCkgPT4ge1xyXG4gICAgICBjb25zdCBpbnB1dCA9IHtcclxuICAgICAgICBuYW1lOiAxMjMsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBzY2hlbWEgPSB7XHJcbiAgICAgICAgbmFtZTogeyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogJ3N0cmluZycgYXMgY29uc3QgfSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGV4cGVjdCgoKSA9PiBlcnJvckhhbmRsZXIudmFsaWRhdGVJbnB1dChpbnB1dCwgc2NoZW1hKSlcclxuICAgICAgICAudG9UaHJvdygnbmFtZSBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHRocm93IFZhbGlkYXRpb25FcnJvciBmb3Igc3RyaW5nIHRvbyBzaG9ydCcsICgpID0+IHtcclxuICAgICAgY29uc3QgaW5wdXQgPSB7XHJcbiAgICAgICAgbmFtZTogJ0EnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3Qgc2NoZW1hID0ge1xyXG4gICAgICAgIG5hbWU6IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0LCBtaW5MZW5ndGg6IDIgfSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGV4cGVjdCgoKSA9PiBlcnJvckhhbmRsZXIudmFsaWRhdGVJbnB1dChpbnB1dCwgc2NoZW1hKSlcclxuICAgICAgICAudG9UaHJvdygnbmFtZSBtdXN0IGJlIGF0IGxlYXN0IDIgY2hhcmFjdGVycyBsb25nJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHRocm93IFZhbGlkYXRpb25FcnJvciBmb3Igc3RyaW5nIHRvbyBsb25nJywgKCkgPT4ge1xyXG4gICAgICBjb25zdCBpbnB1dCA9IHtcclxuICAgICAgICBuYW1lOiAnVGhpcyBpcyBhIHZlcnkgbG9uZyBuYW1lIHRoYXQgZXhjZWVkcyB0aGUgbWF4aW11bSBsZW5ndGgnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3Qgc2NoZW1hID0ge1xyXG4gICAgICAgIG5hbWU6IHsgcmVxdWlyZWQ6IHRydWUsIHR5cGU6ICdzdHJpbmcnIGFzIGNvbnN0LCBtYXhMZW5ndGg6IDEwIH0sXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBleHBlY3QoKCkgPT4gZXJyb3JIYW5kbGVyLnZhbGlkYXRlSW5wdXQoaW5wdXQsIHNjaGVtYSkpXHJcbiAgICAgICAgLnRvVGhyb3coJ25hbWUgbXVzdCBiZSBubyBtb3JlIHRoYW4gMTAgY2hhcmFjdGVycyBsb25nJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHRocm93IFZhbGlkYXRpb25FcnJvciBmb3IgcGF0dGVybiBtaXNtYXRjaCcsICgpID0+IHtcclxuICAgICAgY29uc3QgaW5wdXQgPSB7XHJcbiAgICAgICAgZW1haWw6ICdpbnZhbGlkLWVtYWlsJyxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHNjaGVtYSA9IHtcclxuICAgICAgICBlbWFpbDogeyByZXF1aXJlZDogdHJ1ZSwgdHlwZTogJ3N0cmluZycgYXMgY29uc3QsIHBhdHRlcm46IC9eW15cXHNAXStAW15cXHNAXStcXC5bXlxcc0BdKyQvIH0sXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBleHBlY3QoKCkgPT4gZXJyb3JIYW5kbGVyLnZhbGlkYXRlSW5wdXQoaW5wdXQsIHNjaGVtYSkpXHJcbiAgICAgICAgLnRvVGhyb3coJ2VtYWlsIGZvcm1hdCBpcyBpbnZhbGlkJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIHRocm93IFZhbGlkYXRpb25FcnJvciBmb3IgY3VzdG9tIHZhbGlkYXRpb24gZmFpbHVyZScsICgpID0+IHtcclxuICAgICAgY29uc3QgaW5wdXQgPSB7XHJcbiAgICAgICAgYWdlOiAxNSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHNjaGVtYSA9IHtcclxuICAgICAgICBhZ2U6IHsgXHJcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSwgXHJcbiAgICAgICAgICB0eXBlOiAnbnVtYmVyJyBhcyBjb25zdCwgXHJcbiAgICAgICAgICBjdXN0b206ICh2YWx1ZTogbnVtYmVyKSA9PiB2YWx1ZSA+PSAxOCBcclxuICAgICAgICB9LFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgZXhwZWN0KCgpID0+IGVycm9ySGFuZGxlci52YWxpZGF0ZUlucHV0KGlucHV0LCBzY2hlbWEpKVxyXG4gICAgICAgIC50b1Rocm93KCdhZ2UgdmFsaWRhdGlvbiBmYWlsZWQnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgYWxsb3cgb3B0aW9uYWwgZmllbGRzIHRvIGJlIHVuZGVmaW5lZCcsICgpID0+IHtcclxuICAgICAgY29uc3QgaW5wdXQgPSB7XHJcbiAgICAgICAgbmFtZTogJ0pvaG4gRG9lJyxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHNjaGVtYSA9IHtcclxuICAgICAgICBuYW1lOiB7IHJlcXVpcmVkOiB0cnVlLCB0eXBlOiAnc3RyaW5nJyBhcyBjb25zdCB9LFxyXG4gICAgICAgIG5pY2tuYW1lOiB7IHJlcXVpcmVkOiBmYWxzZSwgdHlwZTogJ3N0cmluZycgYXMgY29uc3QgfSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGV4cGVjdCgoKSA9PiBlcnJvckhhbmRsZXIudmFsaWRhdGVJbnB1dChpbnB1dCwgc2NoZW1hKSkubm90LnRvVGhyb3coKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgncmV0cnkgY29uZmlndXJhdGlvbnMnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGhhdmUgY29ycmVjdCBkZWZhdWx0IHJldHJ5IGNvbmZpZycsICgpID0+IHtcclxuICAgICAgZXhwZWN0KERFRkFVTFRfUkVUUllfQ09ORklHKS50b0VxdWFsKHtcclxuICAgICAgICBtYXhSZXRyaWVzOiAzLFxyXG4gICAgICAgIGJhc2VEZWxheTogMTAwMCxcclxuICAgICAgICBtYXhEZWxheTogMzAwMDAsXHJcbiAgICAgICAgYmFja29mZk11bHRpcGxpZXI6IDIsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYXZlIGNvcnJlY3QgYWdncmVzc2l2ZSByZXRyeSBjb25maWcnLCAoKSA9PiB7XHJcbiAgICAgIGV4cGVjdChBR0dSRVNTSVZFX1JFVFJZX0NPTkZJRykudG9FcXVhbCh7XHJcbiAgICAgICAgbWF4UmV0cmllczogNSxcclxuICAgICAgICBiYXNlRGVsYXk6IDUwMCxcclxuICAgICAgICBtYXhEZWxheTogNjAwMDAsXHJcbiAgICAgICAgYmFja29mZk11bHRpcGxpZXI6IDIuNSxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19