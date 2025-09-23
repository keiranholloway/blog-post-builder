// ValidationError type definition
interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ErrorContext {
  component?: string;
  operation?: string;
  userId?: string;
  contentId?: string;
  metadata?: Record<string, any>;
}

export interface UserFriendlyError {
  type: ErrorType;
  title: string;
  message: string;
  retryable: boolean;
  suggestedAction?: string;
  technicalDetails?: string;
}

export enum ErrorType {
  VALIDATION = 'VALIDATION',
  NETWORK = 'NETWORK',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  RATE_LIMIT = 'RATE_LIMIT',
  SERVER_ERROR = 'SERVER_ERROR',
  TIMEOUT = 'TIMEOUT',
  OFFLINE = 'OFFLINE',
  UNKNOWN = 'UNKNOWN',
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export class ErrorService {
  private static instance: ErrorService;
  private errorLog: Array<{ timestamp: Date; error: Error; context: ErrorContext }> = [];

  private constructor() {}

  static getInstance(): ErrorService {
    if (!ErrorService.instance) {
      ErrorService.instance = new ErrorService();
    }
    return ErrorService.instance;
  }

  /**
   * Handle and transform errors into user-friendly format
   */
  handleError(error: Error, context: ErrorContext = {}): UserFriendlyError {
    // Log error for debugging
    this.logError(error, context);

    // Transform to user-friendly error
    const userFriendlyError = this.transformError(error);

    // Send to monitoring if in production
    if (process.env.NODE_ENV === 'production') {
      this.sendErrorMetrics(error, context);
    }

    return userFriendlyError;
  }

  /**
   * Retry operation with exponential backoff
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    config: RetryConfig = this.getDefaultRetryConfig(),
    context: ErrorContext = {}
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

        console.warn(`Attempt ${attempt + 1} failed:`, {
          error: lastError.message,
          context,
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
        });

        // Check if error is retryable
        if (!this.isRetryableError(lastError)) {
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
    throw this.handleError(lastError!, {
      ...context,
      operation: 'retry_exhausted',
      metadata: {
        ...context.metadata,
        maxRetries: config.maxRetries,
        finalAttempt: config.maxRetries + 1,
      },
    });
  }

  /**
   * Check if user is online
   */
  isOnline(): boolean {
    return navigator.onLine;
  }

  /**
   * Get user-friendly error messages for display
   */
  getDisplayMessage(error: UserFriendlyError): string {
    return error.message;
  }

  /**
   * Get suggested recovery actions
   */
  getRecoveryActions(error: UserFriendlyError): string[] {
    const actions: string[] = [];

    if (error.retryable) {
      actions.push('Try again');
    }

    switch (error.type) {
      case ErrorType.NETWORK:
        actions.push('Check your internet connection');
        break;
      case ErrorType.AUTHENTICATION:
        actions.push('Log in again');
        break;
      case ErrorType.RATE_LIMIT:
        actions.push('Wait a few moments before trying again');
        break;
      case ErrorType.OFFLINE:
        actions.push('Check your internet connection and try again');
        break;
      case ErrorType.VALIDATION:
        actions.push('Check your input and correct any errors');
        break;
      default:
        if (error.suggestedAction) {
          actions.push(error.suggestedAction);
        }
    }

    return actions;
  }

  /**
   * Clear error log (for memory management)
   */
  clearErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * Get recent errors for debugging
   */
  getRecentErrors(limit: number = 10): Array<{ timestamp: Date; error: Error; context: ErrorContext }> {
    return this.errorLog.slice(-limit);
  }

  private logError(error: Error, context: ErrorContext): void {
    this.errorLog.push({
      timestamp: new Date(),
      error,
      context,
    });

    // Keep only last 100 errors to prevent memory leaks
    if (this.errorLog.length > 100) {
      this.errorLog = this.errorLog.slice(-100);
    }

    // Console log for development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error handled by ErrorService:', {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        context,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private transformError(error: Error): UserFriendlyError {
    // Handle validation errors
    if (error.name === 'ValidationError' || error.message.includes('validation')) {
      return {
        type: ErrorType.VALIDATION,
        title: 'Input Error',
        message: error.message,
        retryable: false,
        suggestedAction: 'Please check your input and try again.',
        technicalDetails: error.stack,
      };
    }

    // Handle network errors
    if (error.name === 'NetworkError' || error.message.includes('fetch') || error.message.includes('network')) {
      return {
        type: ErrorType.NETWORK,
        title: 'Connection Error',
        message: 'Unable to connect to the server. Please check your internet connection.',
        retryable: true,
        suggestedAction: 'Check your internet connection and try again.',
        technicalDetails: error.message,
      };
    }

    // Handle authentication errors
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      return {
        type: ErrorType.AUTHENTICATION,
        title: 'Authentication Required',
        message: 'You need to log in to perform this action.',
        retryable: false,
        suggestedAction: 'Please log in and try again.',
        technicalDetails: error.message,
      };
    }

    // Handle authorization errors
    if (error.message.includes('403') || error.message.includes('Forbidden')) {
      return {
        type: ErrorType.AUTHORIZATION,
        title: 'Access Denied',
        message: 'You do not have permission to perform this action.',
        retryable: false,
        suggestedAction: 'Contact support if you believe you should have access.',
        technicalDetails: error.message,
      };
    }

    // Handle rate limiting
    if (error.message.includes('429') || error.message.includes('rate limit') || error.message.includes('throttl')) {
      return {
        type: ErrorType.RATE_LIMIT,
        title: 'Too Many Requests',
        message: 'You are making requests too quickly. Please slow down.',
        retryable: true,
        suggestedAction: 'Wait a few moments and try again.',
        technicalDetails: error.message,
      };
    }

    // Handle timeout errors
    if (error.message.includes('timeout') || error.message.includes('408')) {
      return {
        type: ErrorType.TIMEOUT,
        title: 'Request Timeout',
        message: 'The request took too long to complete.',
        retryable: true,
        suggestedAction: 'Try again with a smaller request or check your connection.',
        technicalDetails: error.message,
      };
    }

    // Handle offline errors
    if (!navigator.onLine) {
      return {
        type: ErrorType.OFFLINE,
        title: 'Offline',
        message: 'You appear to be offline. Please check your internet connection.',
        retryable: true,
        suggestedAction: 'Check your internet connection and try again.',
        technicalDetails: 'Navigator reports offline status',
      };
    }

    // Handle server errors
    if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
      return {
        type: ErrorType.SERVER_ERROR,
        title: 'Server Error',
        message: 'The server encountered an error. Our team has been notified.',
        retryable: true,
        suggestedAction: 'Try again in a few moments. If the problem persists, contact support.',
        technicalDetails: error.message,
      };
    }

    // Default unknown error
    return {
      type: ErrorType.UNKNOWN,
      title: 'Unexpected Error',
      message: 'An unexpected error occurred. Our team has been notified.',
      retryable: false,
      suggestedAction: 'If the problem persists, please contact support.',
      technicalDetails: error.message,
    };
  }

  private isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      'network',
      'timeout',
      'rate limit',
      'throttl',
      '429',
      '500',
      '502',
      '503',
      '504',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
    ];

    const errorString = (error.message + error.name).toLowerCase();
    return retryablePatterns.some(pattern => errorString.includes(pattern));
  }

  private calculateDelay(attempt: number, config: RetryConfig): number {
    const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
    const jitteredDelay = exponentialDelay * (0.5 + Math.random() * 0.5); // Add jitter
    return Math.min(jitteredDelay, config.maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getDefaultRetryConfig(): RetryConfig {
    return {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
    };
  }

  private async sendErrorMetrics(error: Error, context: ErrorContext): Promise<void> {
    try {
      // In a real implementation, this would send metrics to a monitoring service
      // For now, we'll just log it
      console.log('Error metrics would be sent:', {
        error: error.name,
        context,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      });
    } catch (metricsError) {
      console.warn('Failed to send error metrics:', metricsError);
    }
  }
}

// Export singleton instance
export const errorService = ErrorService.getInstance();

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