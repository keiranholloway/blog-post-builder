import { renderHook, act } from '@testing-library/react';
import { useErrorHandler } from '../useErrorHandler';
import { errorService, ErrorType } from '../../services/errorService';

// Mock the error service
jest.mock('../../services/errorService', () => ({
  errorService: {
    handleError: jest.fn(),
    retryWithBackoff: jest.fn(),
    getRecoveryActions: jest.fn(),
  },
  ErrorType: {
    VALIDATION: 'VALIDATION',
    NETWORK: 'NETWORK',
    AUTHENTICATION: 'AUTHENTICATION',
    AUTHORIZATION: 'AUTHORIZATION',
    RATE_LIMIT: 'RATE_LIMIT',
    SERVER_ERROR: 'SERVER_ERROR',
    TIMEOUT: 'TIMEOUT',
    OFFLINE: 'OFFLINE',
    UNKNOWN: 'UNKNOWN',
  },
  DEFAULT_RETRY_CONFIG: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
  },
}));

const mockErrorService = errorService as jest.Mocked<typeof errorService>;

describe('useErrorHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with no error and not loading', () => {
    const { result } = renderHook(() => useErrorHandler());

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle errors correctly', () => {
    const mockError = {
      type: ErrorType.VALIDATION,
      title: 'Validation Error',
      message: 'Invalid input',
      retryable: false,
    };

    mockErrorService.handleError.mockReturnValue(mockError);

    const { result } = renderHook(() => useErrorHandler());

    act(() => {
      const error = new Error('Test error');
      result.current.handleError(error, { component: 'TestComponent' });
    });

    expect(mockErrorService.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      { component: 'TestComponent' }
    );
    expect(result.current.error).toEqual(mockError);
  });

  it('should clear errors', () => {
    const mockError = {
      type: ErrorType.VALIDATION,
      title: 'Validation Error',
      message: 'Invalid input',
      retryable: false,
    };

    mockErrorService.handleError.mockReturnValue(mockError);

    const { result } = renderHook(() => useErrorHandler());

    // Set an error first
    act(() => {
      result.current.handleError(new Error('Test error'));
    });

    expect(result.current.error).toEqual(mockError);

    // Clear the error
    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('should execute operations with error handling', async () => {
    const { result } = renderHook(() => useErrorHandler());

    const mockOperation = jest.fn().mockResolvedValue('success');

    let operationResult: any;
    await act(async () => {
      operationResult = await result.current.executeWithErrorHandling(
        mockOperation,
        { component: 'TestComponent' }
      );
    });

    expect(mockOperation).toHaveBeenCalled();
    expect(operationResult).toBe('success');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle operation failures', async () => {
    const mockError = {
      type: ErrorType.NETWORK,
      title: 'Network Error',
      message: 'Connection failed',
      retryable: true,
    };

    mockErrorService.handleError.mockReturnValue(mockError);

    const { result } = renderHook(() => useErrorHandler());

    const mockOperation = jest.fn().mockRejectedValue(new Error('Network error'));

    let operationResult: any;
    await act(async () => {
      operationResult = await result.current.executeWithErrorHandling(
        mockOperation,
        { component: 'TestComponent' }
      );
    });

    expect(mockOperation).toHaveBeenCalled();
    expect(operationResult).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toEqual(mockError);
  });

  it('should execute operations with retry', async () => {
    const { result } = renderHook(() => useErrorHandler());

    const mockOperation = jest.fn().mockResolvedValue('success');
    mockErrorService.retryWithBackoff.mockResolvedValue('success');

    let operationResult: any;
    await act(async () => {
      operationResult = await result.current.executeWithRetry(
        mockOperation,
        undefined,
        { component: 'TestComponent' }
      );
    });

    expect(mockErrorService.retryWithBackoff).toHaveBeenCalledWith(
      mockOperation,
      expect.any(Object), // DEFAULT_RETRY_CONFIG
      { component: 'TestComponent' }
    );
    expect(operationResult).toBe('success');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle retry failures', async () => {
    const mockError = {
      type: ErrorType.NETWORK,
      title: 'Network Error',
      message: 'Connection failed',
      retryable: true,
    };

    mockErrorService.retryWithBackoff.mockRejectedValue(new Error('Network error'));
    mockErrorService.handleError.mockReturnValue(mockError);

    const { result } = renderHook(() => useErrorHandler());

    const mockOperation = jest.fn();

    let operationResult: any;
    await act(async () => {
      operationResult = await result.current.executeWithRetry(
        mockOperation,
        undefined,
        { component: 'TestComponent' }
      );
    });

    expect(operationResult).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toEqual(mockError);
  });

  it('should get recovery actions', () => {
    const mockError = {
      type: ErrorType.NETWORK,
      title: 'Network Error',
      message: 'Connection failed',
      retryable: true,
    };

    const mockActions = ['Try again', 'Check your connection'];
    mockErrorService.handleError.mockReturnValue(mockError);
    mockErrorService.getRecoveryActions.mockReturnValue(mockActions);

    const { result } = renderHook(() => useErrorHandler());

    // Set an error first
    act(() => {
      result.current.handleError(new Error('Network error'));
    });

    const actions = result.current.getRecoveryActions();

    expect(mockErrorService.getRecoveryActions).toHaveBeenCalledWith(mockError);
    expect(actions).toEqual(mockActions);
  });

  it('should retry last operation', async () => {
    const { result } = renderHook(() => useErrorHandler());

    const mockOperation = jest.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce('success');

    const mockError = {
      type: ErrorType.NETWORK,
      title: 'Network Error',
      message: 'Connection failed',
      retryable: true,
    };

    mockErrorService.handleError.mockReturnValue(mockError);

    // First execution fails
    await act(async () => {
      await result.current.executeWithErrorHandling(
        mockOperation,
        { component: 'TestComponent' }
      );
    });

    expect(result.current.error).toEqual(mockError);

    // Retry should succeed
    await act(async () => {
      await result.current.retry();
    });

    expect(mockOperation).toHaveBeenCalledTimes(2);
  });

  it('should handle retry when no operation exists', async () => {
    const { result } = renderHook(() => useErrorHandler());

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    await act(async () => {
      await result.current.retry();
    });

    expect(consoleSpy).toHaveBeenCalledWith('No operation to retry');
    
    consoleSpy.mockRestore();
  });

  it('should return empty recovery actions when no error', () => {
    const { result } = renderHook(() => useErrorHandler());

    const actions = result.current.getRecoveryActions();

    expect(actions).toEqual([]);
    expect(mockErrorService.getRecoveryActions).not.toHaveBeenCalled();
  });
});