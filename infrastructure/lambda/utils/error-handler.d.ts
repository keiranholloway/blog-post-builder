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
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    retryableErrors?: string[];
}
export declare class ErrorHandler {
    private cloudWatchClient;
    private snsClient;
    private alertTopicArn?;
    constructor();
    /**
     * Handle and log errors with context
     */
    handleError(error: Error, context: ErrorContext): Promise<void>;
    /**
     * Create user-friendly error response
     */
    createUserFriendlyResponse(error: Error, context: ErrorContext): {
        error: string;
        message: string;
        requestId: string;
        retryable: boolean;
        suggestedAction?: string;
    };
    /**
     * Retry function with exponential backoff
     */
    retryWithBackoff<T>(operation: () => Promise<T>, config: RetryConfig, context: ErrorContext): Promise<T>;
    /**
     * Validate input and throw user-friendly errors
     */
    validateInput(input: any, schema: ValidationSchema): void;
    private sendErrorMetrics;
    private sendAlert;
    private isCriticalError;
    private isRetryableError;
    private getUserFriendlyErrorType;
    private getUserFriendlyMessage;
    private getSuggestedAction;
    private calculateDelay;
    private sleep;
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
export declare class ValidationError extends Error {
    constructor(message: string);
}
export declare const DEFAULT_RETRY_CONFIG: RetryConfig;
export declare const AGGRESSIVE_RETRY_CONFIG: RetryConfig;
export declare const CONSERVATIVE_RETRY_CONFIG: RetryConfig;
