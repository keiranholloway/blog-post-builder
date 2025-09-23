"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSERVATIVE_RETRY_CONFIG = exports.AGGRESSIVE_RETRY_CONFIG = exports.DEFAULT_RETRY_CONFIG = exports.ValidationError = exports.ErrorHandler = void 0;
const client_cloudwatch_1 = require("@aws-sdk/client-cloudwatch");
const client_sns_1 = require("@aws-sdk/client-sns");
class ErrorHandler {
    constructor() {
        this.cloudWatchClient = new client_cloudwatch_1.CloudWatchClient({ region: process.env.AWS_REGION });
        this.snsClient = new client_sns_1.SNSClient({ region: process.env.AWS_REGION });
        this.alertTopicArn = process.env.ALERT_TOPIC_ARN;
    }
    /**
     * Handle and log errors with context
     */
    async handleError(error, context) {
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
    createUserFriendlyResponse(error, context) {
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
    async retryWithBackoff(operation, config, context) {
        let lastError;
        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = this.calculateDelay(attempt, config);
                    console.log(`Retry attempt ${attempt}/${config.maxRetries} after ${delay}ms delay`);
                    await this.sleep(delay);
                }
                return await operation();
            }
            catch (error) {
                lastError = error;
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
        await this.handleError(lastError, {
            ...context,
            operation: 'retry_exhausted',
            metadata: {
                ...context.metadata,
                maxRetries: config.maxRetries,
                finalAttempt: config.maxRetries + 1,
            },
        });
        throw lastError;
    }
    /**
     * Validate input and throw user-friendly errors
     */
    validateInput(input, schema) {
        const errors = [];
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
    async sendErrorMetrics(error, context) {
        try {
            const metricData = [
                {
                    MetricName: 'ErrorCount',
                    Value: 1,
                    Unit: client_cloudwatch_1.StandardUnit.Count,
                    Dimensions: [
                        { Name: 'FunctionName', Value: context.functionName },
                        { Name: 'ErrorType', Value: error.name },
                    ],
                    Timestamp: new Date(),
                },
            ];
            if (context.operation) {
                metricData[0].Dimensions.push({ Name: 'Operation', Value: context.operation });
            }
            await this.cloudWatchClient.send(new client_cloudwatch_1.PutMetricDataCommand({
                Namespace: 'AutomatedBlogPoster/Errors',
                MetricData: metricData,
            }));
        }
        catch (metricsError) {
            console.error('Failed to send error metrics:', metricsError);
        }
    }
    async sendAlert(error, context) {
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
            await this.snsClient.send(new client_sns_1.PublishCommand({
                TopicArn: this.alertTopicArn,
                Subject: `CRITICAL: Error in ${context.functionName}`,
                Message: JSON.stringify(alertMessage, null, 2),
            }));
        }
        catch (alertError) {
            console.error('Failed to send alert:', alertError);
        }
    }
    isCriticalError(error) {
        const criticalErrors = [
            'DynamoDBServiceException',
            'S3ServiceException',
            'TranscribeServiceException',
            'BedrockServiceException',
            'OutOfMemoryError',
            'TimeoutError',
        ];
        return criticalErrors.some(criticalError => error.name.includes(criticalError) || error.message.includes(criticalError));
    }
    isRetryableError(error, customRetryableErrors) {
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
        return retryableErrors.some(retryableError => error.name.includes(retryableError) || error.message.includes(retryableError));
    }
    getUserFriendlyErrorType(error) {
        if (error instanceof ValidationError)
            return 'VALIDATION_ERROR';
        if (error.name.includes('Throttling') || error.message.includes('Throttling'))
            return 'RATE_LIMIT_ERROR';
        if (error.name.includes('Timeout') || error.message.includes('Timeout'))
            return 'TIMEOUT_ERROR';
        if (error.name.includes('NotFound') || error.message.includes('NotFound'))
            return 'NOT_FOUND_ERROR';
        if (error.name.includes('Unauthorized') || error.message.includes('Unauthorized'))
            return 'AUTHENTICATION_ERROR';
        if (error.name.includes('Forbidden') || error.message.includes('Forbidden'))
            return 'AUTHORIZATION_ERROR';
        return 'SYSTEM_ERROR';
    }
    getUserFriendlyMessage(error) {
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
    getSuggestedAction(error) {
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
    calculateDelay(attempt, config) {
        const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
        const jitteredDelay = exponentialDelay * (0.5 + Math.random() * 0.5); // Add jitter
        return Math.min(jitteredDelay, config.maxDelay);
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.ErrorHandler = ErrorHandler;
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
// Default retry configurations
exports.DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
};
exports.AGGRESSIVE_RETRY_CONFIG = {
    maxRetries: 5,
    baseDelay: 500,
    maxDelay: 60000,
    backoffMultiplier: 2.5,
};
exports.CONSERVATIVE_RETRY_CONFIG = {
    maxRetries: 2,
    baseDelay: 2000,
    maxDelay: 15000,
    backoffMultiplier: 1.5,
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXJyb3ItaGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImVycm9yLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsa0VBQWtHO0FBQ2xHLG9EQUFnRTtBQW1CaEUsTUFBYSxZQUFZO0lBS3ZCO1FBQ0UsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksb0NBQWdCLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQ2pGLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUNuRSxJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDO0lBQ25ELENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxXQUFXLENBQUMsS0FBWSxFQUFFLE9BQXFCO1FBQ25ELE1BQU0sU0FBUyxHQUFHO1lBQ2hCLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtZQUNuQyxLQUFLLEVBQUU7Z0JBQ0wsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO2dCQUNoQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87Z0JBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSzthQUNuQjtZQUNELE9BQU87U0FDUixDQUFDO1FBRUYsdUJBQXVCO1FBQ3ZCLE9BQU8sQ0FBQyxLQUFLLENBQUMsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFckUsb0NBQW9DO1FBQ3BDLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztRQUU1QyxpQ0FBaUM7UUFDakMsSUFBSSxJQUFJLENBQUMsZUFBZSxD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QUs7SUFDZixpQkFBaUIsRUFBRSxHQUFHO0NBQ3ZCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDbG91ZFdhdGNoQ2xpZW50LCBQdXRNZXRyaWNEYXRhQ29tbWFuZCwgU3RhbmRhcmRVbml0IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3Vkd2F0Y2gnO1xyXG5pbXBvcnQgeyBTTlNDbGllbnQsIFB1Ymxpc2hDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNucyc7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEVycm9yQ29udGV4dCB7XHJcbiAgZnVuY3Rpb25OYW1lOiBzdHJpbmc7XHJcbiAgcmVxdWVzdElkOiBzdHJpbmc7XHJcbiAgdXNlcklkPzogc3RyaW5nO1xyXG4gIGNvbnRlbnRJZD86IHN0cmluZztcclxuICBvcGVyYXRpb24/OiBzdHJpbmc7XHJcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFJldHJ5Q29uZmlnIHtcclxuICBtYXhSZXRyaWVzOiBudW1iZXI7XHJcbiAgYmFzZURlbGF5OiBudW1iZXI7IC8vIG1pbGxpc2Vjb25kc1xyXG4gIG1heERlbGF5OiBudW1iZXI7IC8vIG1pbGxpc2Vjb25kc1xyXG4gIGJhY2tvZmZNdWx0aXBsaWVyOiBudW1iZXI7XHJcbiAgcmV0cnlhYmxlRXJyb3JzPzogc3RyaW5nW107XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBFcnJvckhhbmRsZXIge1xyXG4gIHByaXZhdGUgY2xvdWRXYXRjaENsaWVudDogQ2xvdWRXYXRjaENsaWVudDtcclxuICBwcml2YXRlIHNuc0NsaWVudDogU05TQ2xpZW50O1xyXG4gIHByaXZhdGUgYWxlcnRUb3BpY0Fybj86IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmNsb3VkV2F0Y2hDbGllbnQgPSBuZXcgQ2xvdWRXYXRjaENsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuICAgIHRoaXMuc25zQ2xpZW50ID0gbmV3IFNOU0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuICAgIHRoaXMuYWxlcnRUb3BpY0FybiA9IHByb2Nlc3MuZW52LkFMRVJUX1RPUElDX0FSTjtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEhhbmRsZSBhbmQgbG9nIGVycm9ycyB3aXRoIGNvbnRleHRcclxuICAgKi9cclxuICBhc3luYyBoYW5kbGVFcnJvcihlcnJvcjogRXJyb3IsIGNvbnRleHQ6IEVycm9yQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgZXJyb3JJbmZvID0ge1xyXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgZXJyb3I6IHtcclxuICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxyXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxyXG4gICAgICB9LFxyXG4gICAgICBjb250ZXh0LFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBMb2cgc3RydWN0dXJlZCBlcnJvclxyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3Igb2NjdXJyZWQ6JywgSlNPTi5zdHJpbmdpZnkoZXJyb3JJbmZvLCBudWxsLCAyKSk7XHJcblxyXG4gICAgLy8gU2VuZCBjdXN0b20gbWV0cmljcyB0byBDbG91ZFdhdGNoXHJcbiAgICBhd2FpdCB0aGlzLnNlbmRFcnJvck1ldHJpY3MoZXJyb3IsIGNvbnRleHQpO1xyXG5cclxuICAgIC8vIFNlbmQgYWxlcnQgZm9yIGNyaXRpY2FsIGVycm9yc1xyXG4gICAgaWYgKHRoaXMuaXNDcml0aWNhbEVycm9yKGVycm9yKSkge1xyXG4gICAgICBhd2FpdCB0aGlzLnNlbmRBbGVydChlcnJvciwgY29udGV4dCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGUgdXNlci1mcmllbmRseSBlcnJvciByZXNwb25zZVxyXG4gICAqL1xyXG4gIGNyZWF0ZVVzZXJGcmllbmRseVJlc3BvbnNlKGVycm9yOiBFcnJvciwgY29udGV4dDogRXJyb3JDb250ZXh0KToge1xyXG4gICAgZXJyb3I6IHN0cmluZztcclxuICAgIG1lc3NhZ2U6IHN0cmluZztcclxuICAgIHJlcXVlc3RJZDogc3RyaW5nO1xyXG4gICAgcmV0cnlhYmxlOiBib29sZWFuO1xyXG4gICAgc3VnZ2VzdGVkQWN0aW9uPzogc3RyaW5nO1xyXG4gIH0ge1xyXG4gICAgY29uc3QgaXNSZXRyeWFibGUgPSB0aGlzLmlzUmV0cnlhYmxlRXJyb3IoZXJyb3IpO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBlcnJvcjogdGhpcy5nZXRVc2VyRnJpZW5kbHlFcnJvclR5cGUoZXJyb3IpLFxyXG4gICAgICBtZXNzYWdlOiB0aGlzLmdldFVzZXJGcmllbmRseU1lc3NhZ2UoZXJyb3IpLFxyXG4gICAgICByZXF1ZXN0SWQ6IGNvbnRleHQucmVxdWVzdElkLFxyXG4gICAgICByZXRyeWFibGU6IGlzUmV0cnlhYmxlLFxyXG4gICAgICBzdWdnZXN0ZWRBY3Rpb246IHRoaXMuZ2V0U3VnZ2VzdGVkQWN0aW9uKGVycm9yKSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZXRyeSBmdW5jdGlvbiB3aXRoIGV4cG9uZW50aWFsIGJhY2tvZmZcclxuICAgKi9cclxuICBhc3luYyByZXRyeVdpdGhCYWNrb2ZmPFQ+KFxyXG4gICAgb3BlcmF0aW9uOiAoKSA9PiBQcm9taXNlPFQ+LFxyXG4gICAgY29uZmlnOiBSZXRyeUNvbmZpZyxcclxuICAgIGNvbnRleHQ6IEVycm9yQ29udGV4dFxyXG4gICk6IFByb21pc2U8VD4ge1xyXG4gICAgbGV0IGxhc3RFcnJvcjogRXJyb3I7XHJcbiAgICBcclxuICAgIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDw9IGNvbmZpZy5tYXhSZXRyaWVzOyBhdHRlbXB0KyspIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBpZiAoYXR0ZW1wdCA+IDApIHtcclxuICAgICAgICAgIGNvbnN0IGRlbGF5ID0gdGhpcy5jYWxjdWxhdGVEZWxheShhdHRlbXB0LCBjb25maWcpO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYFJldHJ5IGF0dGVtcHQgJHthdHRlbXB0fS8ke2NvbmZpZy5tYXhSZXRyaWVzfSBhZnRlciAke2RlbGF5fW1zIGRlbGF5YCk7XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLnNsZWVwKGRlbGF5KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IG9wZXJhdGlvbigpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGxhc3RFcnJvciA9IGVycm9yIGFzIEVycm9yO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIExvZyByZXRyeSBhdHRlbXB0XHJcbiAgICAgICAgY29uc29sZS53YXJuKGBBdHRlbXB0ICR7YXR0ZW1wdCArIDF9IGZhaWxlZDpgLCB7XHJcbiAgICAgICAgICBlcnJvcjogbGFzdEVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgICBjb250ZXh0LFxyXG4gICAgICAgICAgYXR0ZW1wdDogYXR0ZW1wdCArIDEsXHJcbiAgICAgICAgICBtYXhSZXRyaWVzOiBjb25maWcubWF4UmV0cmllcyxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgZXJyb3IgaXMgcmV0cnlhYmxlXHJcbiAgICAgICAgaWYgKCF0aGlzLmlzUmV0cnlhYmxlRXJyb3IobGFzdEVycm9yLCBjb25maWcucmV0cnlhYmxlRXJyb3JzKSkge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcignTm9uLXJldHJ5YWJsZSBlcnJvciBlbmNvdW50ZXJlZDonLCBsYXN0RXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIElmIHRoaXMgd2FzIHRoZSBsYXN0IGF0dGVtcHQsIGRvbid0IHdhaXRcclxuICAgICAgICBpZiAoYXR0ZW1wdCA9PT0gY29uZmlnLm1heFJldHJpZXMpIHtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIEFsbCByZXRyaWVzIGV4aGF1c3RlZFxyXG4gICAgYXdhaXQgdGhpcy5oYW5kbGVFcnJvcihsYXN0RXJyb3IhLCB7XHJcbiAgICAgIC4uLmNvbnRleHQsXHJcbiAgICAgIG9wZXJhdGlvbjogJ3JldHJ5X2V4aGF1c3RlZCcsXHJcbiAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgLi4uY29udGV4dC5tZXRhZGF0YSxcclxuICAgICAgICBtYXhSZXRyaWVzOiBjb25maWcubWF4UmV0cmllcyxcclxuICAgICAgICBmaW5hbEF0dGVtcHQ6IGNvbmZpZy5tYXhSZXRyaWVzICsgMSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIHRocm93IGxhc3RFcnJvciE7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBWYWxpZGF0ZSBpbnB1dCBhbmQgdGhyb3cgdXNlci1mcmllbmRseSBlcnJvcnNcclxuICAgKi9cclxuICB2YWxpZGF0ZUlucHV0KGlucHV0OiBhbnksIHNjaGVtYTogVmFsaWRhdGlvblNjaGVtYSk6IHZvaWQge1xyXG4gICAgY29uc3QgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xyXG5cclxuICAgIGZvciAoY29uc3QgW2ZpZWxkLCBydWxlc10gb2YgT2JqZWN0LmVudHJpZXMoc2NoZW1hKSkge1xyXG4gICAgICBjb25zdCB2YWx1ZSA9IGlucHV0W2ZpZWxkXTtcclxuXHJcbiAgICAgIGlmIChydWxlcy5yZXF1aXJlZCAmJiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gJycpKSB7XHJcbiAgICAgICAgZXJyb3JzLnB1c2goYCR7ZmllbGR9IGlzIHJlcXVpcmVkYCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsKSB7XHJcbiAgICAgICAgaWYgKHJ1bGVzLnR5cGUgJiYgdHlwZW9mIHZhbHVlICE9PSBydWxlcy50eXBlKSB7XHJcbiAgICAgICAgICBlcnJvcnMucHVzaChgJHtmaWVsZH0gbXVzdCBiZSBvZiB0eXBlICR7cnVsZXMudHlwZX1gKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChydWxlcy5taW5MZW5ndGggJiYgdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyAmJiB2YWx1ZS5sZW5ndGggPCBydWxlcy5taW5MZW5ndGgpIHtcclxuICAgICAgICAgIGVycm9ycy5wdXNoKGAke2ZpZWxkfSBtdXN0IGJlIGF0IGxlYXN0ICR7cnVsZXMubWluTGVuZ3RofSBjaGFyYWN0ZXJzIGxvbmdgKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChydWxlcy5tYXhMZW5ndGggJiYgdHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJyAmJiB2YWx1ZS5sZW5ndGggPiBydWxlcy5tYXhMZW5ndGgpIHtcclxuICAgICAgICAgIGVycm9ycy5wdXNoKGAke2ZpZWxkfSBtdXN0IGJlIG5vIG1vcmUgdGhhbiAke3J1bGVzLm1heExlbmd0aH0gY2hhcmFjdGVycyBsb25nYCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAocnVsZXMucGF0dGVybiAmJiB0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnICYmICFydWxlcy5wYXR0ZXJuLnRlc3QodmFsdWUpKSB7XHJcbiAgICAgICAgICBlcnJvcnMucHVzaChgJHtmaWVsZH0gZm9ybWF0IGlzIGludmFsaWRgKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChydWxlcy5jdXN0b20gJiYgIXJ1bGVzLmN1c3RvbSh2YWx1ZSkpIHtcclxuICAgICAgICAgIGVycm9ycy5wdXNoKGAke2ZpZWxkfSB2YWxpZGF0aW9uIGZhaWxlZGApO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xyXG4gICAgICB0aHJvdyBuZXcgVmFsaWRhdGlvbkVycm9yKGBJbnB1dCB2YWxpZGF0aW9uIGZhaWxlZDogJHtlcnJvcnMuam9pbignLCAnKX1gKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2VuZEVycm9yTWV0cmljcyhlcnJvcjogRXJyb3IsIGNvbnRleHQ6IEVycm9yQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgbWV0cmljRGF0YSA9IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBNZXRyaWNOYW1lOiAnRXJyb3JDb3VudCcsXHJcbiAgICAgICAgICBWYWx1ZTogMSxcclxuICAgICAgICAgIFVuaXQ6IFN0YW5kYXJkVW5pdC5Db3VudCxcclxuICAgICAgICAgIERpbWVuc2lvbnM6IFtcclxuICAgICAgICAgICAgeyBOYW1lOiAnRnVuY3Rpb25OYW1lJywgVmFsdWU6IGNvbnRleHQuZnVuY3Rpb25OYW1lIH0sXHJcbiAgICAgICAgICAgIHsgTmFtZTogJ0Vycm9yVHlwZScsIFZhbHVlOiBlcnJvci5uYW1lIH0sXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF07XHJcblxyXG4gICAgICBpZiAoY29udGV4dC5vcGVyYXRpb24pIHtcclxuICAgICAgICBtZXRyaWNEYXRhWzBdLkRpbWVuc2lvbnMhLnB1c2goeyBOYW1lOiAnT3BlcmF0aW9uJywgVmFsdWU6IGNvbnRleHQub3BlcmF0aW9uIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBhd2FpdCB0aGlzLmNsb3VkV2F0Y2hDbGllbnQuc2VuZChuZXcgUHV0TWV0cmljRGF0YUNvbW1hbmQoe1xyXG4gICAgICAgIE5hbWVzcGFjZTogJ0F1dG9tYXRlZEJsb2dQb3N0ZXIvRXJyb3JzJyxcclxuICAgICAgICBNZXRyaWNEYXRhOiBtZXRyaWNEYXRhLFxyXG4gICAgICB9KSk7XHJcbiAgICB9IGNhdGNoIChtZXRyaWNzRXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHNlbmQgZXJyb3IgbWV0cmljczonLCBtZXRyaWNzRXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzZW5kQWxlcnQoZXJyb3I6IEVycm9yLCBjb250ZXh0OiBFcnJvckNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghdGhpcy5hbGVydFRvcGljQXJuKSB7XHJcbiAgICAgIGNvbnNvbGUud2FybignQWxlcnQgdG9waWMgQVJOIG5vdCBjb25maWd1cmVkLCBza2lwcGluZyBhbGVydCcpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgYWxlcnRNZXNzYWdlID0ge1xyXG4gICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIHNldmVyaXR5OiAnQ1JJVElDQUwnLFxyXG4gICAgICAgIHNlcnZpY2U6ICdBdXRvbWF0ZWRCbG9nUG9zdGVyJyxcclxuICAgICAgICBmdW5jdGlvbjogY29udGV4dC5mdW5jdGlvbk5hbWUsXHJcbiAgICAgICAgZXJyb3I6IHtcclxuICAgICAgICAgIHR5cGU6IGVycm9yLm5hbWUsXHJcbiAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgY29udGV4dCxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IHRoaXMuc25zQ2xpZW50LnNlbmQobmV3IFB1Ymxpc2hDb21tYW5kKHtcclxuICAgICAgICBUb3BpY0FybjogdGhpcy5hbGVydFRvcGljQXJuLFxyXG4gICAgICAgIFN1YmplY3Q6IGBDUklUSUNBTDogRXJyb3IgaW4gJHtjb250ZXh0LmZ1bmN0aW9uTmFtZX1gLFxyXG4gICAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KGFsZXJ0TWVzc2FnZSwgbnVsbCwgMiksXHJcbiAgICAgIH0pKTtcclxuICAgIH0gY2F0Y2ggKGFsZXJ0RXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHNlbmQgYWxlcnQ6JywgYWxlcnRFcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGlzQ3JpdGljYWxFcnJvcihlcnJvcjogRXJyb3IpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IGNyaXRpY2FsRXJyb3JzID0gW1xyXG4gICAgICAnRHluYW1vREJTZXJ2aWNlRXhjZXB0aW9uJyxcclxuICAgICAgJ1MzU2VydmljZUV4Y2VwdGlvbicsXHJcbiAgICAgICdUcmFuc2NyaWJlU2VydmljZUV4Y2VwdGlvbicsXHJcbiAgICAgICdCZWRyb2NrU2VydmljZUV4Y2VwdGlvbicsXHJcbiAgICAgICdPdXRPZk1lbW9yeUVycm9yJyxcclxuICAgICAgJ1RpbWVvdXRFcnJvcicsXHJcbiAgICBdO1xyXG5cclxuICAgIHJldHVybiBjcml0aWNhbEVycm9ycy5zb21lKGNyaXRpY2FsRXJyb3IgPT4gXHJcbiAgICAgIGVycm9yLm5hbWUuaW5jbHVkZXMoY3JpdGljYWxFcnJvcikgfHwgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhjcml0aWNhbEVycm9yKVxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaXNSZXRyeWFibGVFcnJvcihlcnJvcjogRXJyb3IsIGN1c3RvbVJldHJ5YWJsZUVycm9ycz86IHN0cmluZ1tdKTogYm9vbGVhbiB7XHJcbiAgICBjb25zdCBkZWZhdWx0UmV0cnlhYmxlRXJyb3JzID0gW1xyXG4gICAgICAnVGhyb3R0bGluZ0V4Y2VwdGlvbicsXHJcbiAgICAgICdQcm92aXNpb25lZFRocm91Z2hwdXRFeGNlZWRlZEV4Y2VwdGlvbicsXHJcbiAgICAgICdTZXJ2aWNlVW5hdmFpbGFibGUnLFxyXG4gICAgICAnSW50ZXJuYWxTZXJ2ZXJFcnJvcicsXHJcbiAgICAgICdSZXF1ZXN0VGltZW91dCcsXHJcbiAgICAgICdOZXR3b3JraW5nRXJyb3InLFxyXG4gICAgICAnRUNPTk5SRVNFVCcsXHJcbiAgICAgICdFVElNRURPVVQnLFxyXG4gICAgICAnRU5PVEZPVU5EJyxcclxuICAgIF07XHJcblxyXG4gICAgY29uc3QgcmV0cnlhYmxlRXJyb3JzID0gY3VzdG9tUmV0cnlhYmxlRXJyb3JzIHx8IGRlZmF1bHRSZXRyeWFibGVFcnJvcnM7XHJcbiAgICBcclxuICAgIHJldHVybiByZXRyeWFibGVFcnJvcnMuc29tZShyZXRyeWFibGVFcnJvciA9PiBcclxuICAgICAgZXJyb3IubmFtZS5pbmNsdWRlcyhyZXRyeWFibGVFcnJvcikgfHwgZXJyb3IubWVzc2FnZS5pbmNsdWRlcyhyZXRyeWFibGVFcnJvcilcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldFVzZXJGcmllbmRseUVycm9yVHlwZShlcnJvcjogRXJyb3IpOiBzdHJpbmcge1xyXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSByZXR1cm4gJ1ZBTElEQVRJT05fRVJST1InO1xyXG4gICAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ1Rocm90dGxpbmcnKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdUaHJvdHRsaW5nJykpIHJldHVybiAnUkFURV9MSU1JVF9FUlJPUic7XHJcbiAgICBpZiAoZXJyb3IubmFtZS5pbmNsdWRlcygnVGltZW91dCcpIHx8IGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoJ1RpbWVvdXQnKSkgcmV0dXJuICdUSU1FT1VUX0VSUk9SJztcclxuICAgIGlmIChlcnJvci5uYW1lLmluY2x1ZGVzKCdOb3RGb3VuZCcpIHx8IGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoJ05vdEZvdW5kJykpIHJldHVybiAnTk9UX0ZPVU5EX0VSUk9SJztcclxuICAgIGlmIChlcnJvci5uYW1lLmluY2x1ZGVzKCdVbmF1dGhvcml6ZWQnKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdVbmF1dGhvcml6ZWQnKSkgcmV0dXJuICdBVVRIRU5USUNBVElPTl9FUlJPUic7XHJcbiAgICBpZiAoZXJyb3IubmFtZS5pbmNsdWRlcygnRm9yYmlkZGVuJykgfHwgZXJyb3IubWVzc2FnZS5pbmNsdWRlcygnRm9yYmlkZGVuJykpIHJldHVybiAnQVVUSE9SSVpBVElPTl9FUlJPUic7XHJcbiAgICByZXR1cm4gJ1NZU1RFTV9FUlJPUic7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldFVzZXJGcmllbmRseU1lc3NhZ2UoZXJyb3I6IEVycm9yKTogc3RyaW5nIHtcclxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZhbGlkYXRpb25FcnJvcikge1xyXG4gICAgICByZXR1cm4gZXJyb3IubWVzc2FnZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ1Rocm90dGxpbmcnKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdUaHJvdHRsaW5nJykpIHtcclxuICAgICAgcmV0dXJuICdUaGUgc3lzdGVtIGlzIGN1cnJlbnRseSBleHBlcmllbmNpbmcgaGlnaCBsb2FkLiBQbGVhc2UgdHJ5IGFnYWluIGluIGEgZmV3IG1vbWVudHMuJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ1RpbWVvdXQnKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdUaW1lb3V0JykpIHtcclxuICAgICAgcmV0dXJuICdUaGUgb3BlcmF0aW9uIHRvb2sgbG9uZ2VyIHRoYW4gZXhwZWN0ZWQuIFBsZWFzZSB0cnkgYWdhaW4uJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ05vdEZvdW5kJykgfHwgZXJyb3IubWVzc2FnZS5pbmNsdWRlcygnTm90Rm91bmQnKSkge1xyXG4gICAgICByZXR1cm4gJ1RoZSByZXF1ZXN0ZWQgcmVzb3VyY2Ugd2FzIG5vdCBmb3VuZC4nO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoZXJyb3IubmFtZS5pbmNsdWRlcygnVW5hdXRob3JpemVkJykgfHwgZXJyb3IubWVzc2FnZS5pbmNsdWRlcygnVW5hdXRob3JpemVkJykpIHtcclxuICAgICAgcmV0dXJuICdBdXRoZW50aWNhdGlvbiBpcyByZXF1aXJlZC4gUGxlYXNlIGxvZyBpbiBhbmQgdHJ5IGFnYWluLic7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmIChlcnJvci5uYW1lLmluY2x1ZGVzKCdGb3JiaWRkZW4nKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdGb3JiaWRkZW4nKSkge1xyXG4gICAgICByZXR1cm4gJ1lvdSBkbyBub3QgaGF2ZSBwZXJtaXNzaW9uIHRvIHBlcmZvcm0gdGhpcyBhY3Rpb24uJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuICdBbiB1bmV4cGVjdGVkIGVycm9yIG9jY3VycmVkLiBPdXIgdGVhbSBoYXMgYmVlbiBub3RpZmllZCBhbmQgaXMgd29ya2luZyB0byByZXNvbHZlIHRoZSBpc3N1ZS4nO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBnZXRTdWdnZXN0ZWRBY3Rpb24oZXJyb3I6IEVycm9yKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcclxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZhbGlkYXRpb25FcnJvcikge1xyXG4gICAgICByZXR1cm4gJ1BsZWFzZSBjaGVjayB5b3VyIGlucHV0IGFuZCB0cnkgYWdhaW4uJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ1Rocm90dGxpbmcnKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdUaHJvdHRsaW5nJykpIHtcclxuICAgICAgcmV0dXJuICdXYWl0IGEgZmV3IG1vbWVudHMgYW5kIHRyeSBhZ2Fpbi4nO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoZXJyb3IubmFtZS5pbmNsdWRlcygnVGltZW91dCcpIHx8IGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoJ1RpbWVvdXQnKSkge1xyXG4gICAgICByZXR1cm4gJ1RyeSBhZ2FpbiB3aXRoIGEgc21hbGxlciByZXF1ZXN0IG9yIGNoZWNrIHlvdXIgaW50ZXJuZXQgY29ubmVjdGlvbi4nO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoZXJyb3IubmFtZS5pbmNsdWRlcygnVW5hdXRob3JpemVkJykgfHwgZXJyb3IubWVzc2FnZS5pbmNsdWRlcygnVW5hdXRob3JpemVkJykpIHtcclxuICAgICAgcmV0dXJuICdQbGVhc2UgbG9nIGluIGFuZCB0cnkgYWdhaW4uJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKGVycm9yLm5hbWUuaW5jbHVkZXMoJ0ZvcmJpZGRlbicpIHx8IGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoJ0ZvcmJpZGRlbicpKSB7XHJcbiAgICAgIHJldHVybiAnQ29udGFjdCBzdXBwb3J0IGlmIHlvdSBiZWxpZXZlIHlvdSBzaG91bGQgaGF2ZSBhY2Nlc3MgdG8gdGhpcyByZXNvdXJjZS4nO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICByZXR1cm4gJ0lmIHRoZSBwcm9ibGVtIHBlcnNpc3RzLCBwbGVhc2UgY29udGFjdCBzdXBwb3J0Lic7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNhbGN1bGF0ZURlbGF5KGF0dGVtcHQ6IG51bWJlciwgY29uZmlnOiBSZXRyeUNvbmZpZyk6IG51bWJlciB7XHJcbiAgICBjb25zdCBleHBvbmVudGlhbERlbGF5ID0gY29uZmlnLmJhc2VEZWxheSAqIE1hdGgucG93KGNvbmZpZy5iYWNrb2ZmTXVsdGlwbGllciwgYXR0ZW1wdCAtIDEpO1xyXG4gICAgY29uc3Qgaml0dGVyZWREZWxheSA9IGV4cG9uZW50aWFsRGVsYXkgKiAoMC41ICsgTWF0aC5yYW5kb20oKSAqIDAuNSk7IC8vIEFkZCBqaXR0ZXJcclxuICAgIHJldHVybiBNYXRoLm1pbihqaXR0ZXJlZERlbGF5LCBjb25maWcubWF4RGVsYXkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzbGVlcChtczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFZhbGlkYXRpb25TY2hlbWEge1xyXG4gIFtmaWVsZDogc3RyaW5nXToge1xyXG4gICAgcmVxdWlyZWQ/OiBib29sZWFuO1xyXG4gICAgdHlwZT86ICdzdHJpbmcnIHwgJ251bWJlcicgfCAnYm9vbGVhbicgfCAnb2JqZWN0JztcclxuICAgIG1pbkxlbmd0aD86IG51bWJlcjtcclxuICAgIG1heExlbmd0aD86IG51bWJlcjtcclxuICAgIHBhdHRlcm4/OiBSZWdFeHA7XHJcbiAgICBjdXN0b20/OiAodmFsdWU6IGFueSkgPT4gYm9vbGVhbjtcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgVmFsaWRhdGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xyXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xyXG4gICAgc3VwZXIobWVzc2FnZSk7XHJcbiAgICB0aGlzLm5hbWUgPSAnVmFsaWRhdGlvbkVycm9yJztcclxuICB9XHJcbn1cclxuXHJcbi8vIERlZmF1bHQgcmV0cnkgY29uZmlndXJhdGlvbnNcclxuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVUUllfQ09ORklHOiBSZXRyeUNvbmZpZyA9IHtcclxuICBtYXhSZXRyaWVzOiAzLFxyXG4gIGJhc2VEZWxheTogMTAwMCxcclxuICBtYXhEZWxheTogMzAwMDAsXHJcbiAgYmFja29mZk11bHRpcGxpZXI6IDIsXHJcbn07XHJcblxyXG5leHBvcnQgY29uc3QgQUdHUkVTU0lWRV9SRVRSWV9DT05GSUc6IFJldHJ5Q29uZmlnID0ge1xyXG4gIG1heFJldHJpZXM6IDUsXHJcbiAgYmFzZURlbGF5OiA1MDAsXHJcbiAgbWF4RGVsYXk6IDYwMDAwLFxyXG4gIGJhY2tvZmZNdWx0aXBsaWVyOiAyLjUsXHJcbn07XHJcblxyXG5leHBvcnQgY29uc3QgQ09OU0VSVkFUSVZFX1JFVFJZX0NPTkZJRzogUmV0cnlDb25maWcgPSB7XHJcbiAgbWF4UmV0cmllczogMixcclxuICBiYXNlRGVsYXk6IDIwMDAsXHJcbiAgbWF4RGVsYXk6IDE1MDAwLFxyXG4gIGJhY2tvZmZNdWx0aXBsaWVyOiAxLjUsXHJcbn07Il19