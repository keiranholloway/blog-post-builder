import { useState, useCallback } from 'react';
import { errorService, ErrorContext, UserFriendlyError, RetryConfig, DEFAULT_RETRY_CONFIG } from '../services/errorService';

export interface UseErrorHandlerReturn {
  error: UserFriendlyError | null;
  isLoading: boolean;
  clearError: () => void;
  handleError: (error: Error, context?: ErrorContext) => UserFriendlyError;
  executeWithErrorHandling: <T>(
    operation: () => Promise<T>,
    context?: ErrorContext
  ) => Promise<T | null>;
  executeWithRetry: <T>(
    operation: () => Promise<T>,
    config?: RetryConfig,
    context?: ErrorContext
  ) => Promise<T | null>;
  getRecoveryActions: () => string[];
  retry: () => Promise<void>;
}

export const useErrorHandler = (): UseErrorHandlerReturn => {
  const [error, setError] = useState<UserFriendlyError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastOperation, setLastOperation] = useState<{
    operation: () => Promise<any>;
    context?: ErrorContext;
  } | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleError = useCallback((error: Error, context?: ErrorContext): UserFriendlyError => {
    const userFriendlyError = errorService.handleError(error, context);
    setError(userFriendlyError);
    return userFriendlyError;
  }, []);

  const executeWithErrorHandling = useCallback(async <T>(
    operation: () => Promise<T>,
    context?: ErrorContext
  ): Promise<T | null> => {
    setIsLoading(true);
    setError(null);
    setLastOperation({ operation, context });

    try {
      const result = await operation();
      setIsLoading(false);
      return result;
    } catch (err) {
      setIsLoading(false);
      handleError(err as Error, context);
      return null;
    }
  }, [handleError]);

  const executeWithRetry = useCallback(async <T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG,
    context?: ErrorContext
  ): Promise<T | null> => {
    setIsLoading(true);
    setError(null);
    setLastOperation({ operation, context });

    try {
      const result = await errorService.retryWithBackoff(operation, config, context);
      setIsLoading(false);
      return result;
    } catch (err) {
      setIsLoading(false);
      handleError(err as Error, context);
      return null;
    }
  }, [handleError]);

  const getRecoveryActions = useCallback((): string[] => {
    if (!error) return [];
    return errorService.getRecoveryActions(error);
  }, [error]);

  const retry = useCallback(async (): Promise<void> => {
    if (!lastOperation) {
      console.warn('No operation to retry');
      return;
    }

    await executeWithErrorHandling(lastOperation.operation, lastOperation.context);
  }, [lastOperation, executeWithErrorHandling]);

  return {
    error,
    isLoading,
    clearError,
    handleError,
    executeWithErrorHandling,
    executeWithRetry,
    getRecoveryActions,
    retry,
  };
};