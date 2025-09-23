import { vi } from 'vitest';
import { errorService, ErrorService, ErrorType, DEFAULT_RETRY_CONFIG } from '../errorService';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { afterEach } from 'node:test';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
});

describe('ErrorService', () => {
  let service: ErrorService;

  beforeEach(() => {
    service = ErrorService.getInstance();
    service.clearErrorLog();
    
    // Reset navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    });
  });

  describe('handleError', () => {
    it('should handle validation errors correctly', () => {
      const error = new Error('validation failed');
      error.name = 'ValidationError';
      
      const result = service.handleError(error, { component: 'TestComponent' });
      
      expect(result.type).toBe(ErrorType.VALIDATION);
      expect(result.title).toBe('Input Error');
      expect(result.retryable).toBe(false);
      expect(result.suggestedAction).toBe('Please check your input and try again.');
    });

    it('should handle network errors correctly', () => {
      const error = new Error('fetch failed');
      
      const result = service.handleError(error);
      
      expect(result.type).toBe(ErrorType.NETWORK);
      expect(result.title).toBe('Connection Error');
      expect(result.retryable).toBe(true);
      expect(result.message).toContain('Unable to connect to the server');
    });

    it('should handle authentication errors correctly', () => {
      const error = new Error('401 Unauthorized');
      
      const result = service.handleError(error);
      
      expect(result.type).toBe(ErrorType.AUTHENTICATION);
      expect(result.title).toBe('Authentication Required');
      expect(result.retryable).toBe(false);
    });

    it('should handle rate limit errors correctly', () => {
      const error = new Error('429 Too Many Requests');
      
      const result = service.handleError(error);
      
      expect(result.type).toBe(ErrorType.RATE_LIMIT);
      expect(result.title).toBe('Too Many Requests');
      expect(result.retryable).toBe(true);
    });

    it('should handle offline status correctly', () => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });
      
      const error = new Error('Some error');
      
      const result = service.handleError(error);
      
      expect(result.type).toBe(ErrorType.OFFLINE);
      expect(result.title).toBe('Offline');
      expect(result.retryable).toBe(true);
    });

    it('should handle server errors correctly', () => {
      const error = new Error('500 Internal Server Error');
      
      const result = service.handleError(error);
      
      expect(result.type).toBe(ErrorType.SERVER_ERROR);
      expect(result.title).toBe('Server Error');
      expect(result.retryable).toBe(true);
    });

    it('should handle unknown errors correctly', () => {
      const error = new Error('Some unknown error');
      
      const result = service.handleError(error);
      
      expect(result.type).toBe(ErrorType.UNKNOWN);
      expect(result.title).toBe('Unexpected Error');
      expect(result.retryable).toBe(false);
    });
  });

  describe('retryWithBackoff', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const promise = service.retryWithBackoff(operation, DEFAULT_RETRY_CONFIG);
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error and eventually succeed', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');
      
      const fastConfig = {
        maxRetries: 3,
        baseDelay: 100,
        maxDelay: 1000,
        backoffMultiplier: 1.5,
      };
      
      const promise = service.retryWithBackoff(operation, fastConfig);
      
      // Fast-forward through delays
      vi.advanceTimersByTime(5000);
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable error', async () => {
      const error = new Error('validation failed');
      error.name = 'ValidationError';
      const operation = jest.fn().mockRejectedValue(error);
      
      await expect(
        service.retryWithBackoff(operation, DEFAULT_RETRY_CONFIG)
      ).rejects.toThrow();
      
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries and throw last error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('network error'));
      
      const fastConfig = {
        maxRetries: 2,
        baseDelay: 10,
        maxDelay: 100,
        backoffMultiplier: 1.5,
      };
      
      const promise = service.retryWithBackoff(operation, fastConfig);
      
      // Fast-forward through delays
      vi.advanceTimersByTime(1000);
      
      await expect(promise).rejects.toThrow('network error');
      expect(operation).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });

  describe('getRecoveryActions', () => {
    it('should return appropriate actions for validation errors', () => {
      const error = {
        type: ErrorType.VALIDATION,
        title: 'Input Error',
        message: 'Invalid input',
        retryable: false,
      };
      
      const actions = service.getRecoveryActions(error);
      
      expect(actions).toContain('Check your input and correct any errors');
    });

    it('should return appropriate actions for network errors', () => {
      const error = {
        type: ErrorType.NETWORK,
        title: 'Network Error',
        message: 'Connection failed',
        retryable: true,
      };
      
      const actions = service.getRecoveryActions(error);
      
      expect(actions).toContain('Try again');
      expect(actions).toContain('Check your internet connection');
    });

    it('should return appropriate actions for authentication errors', () => {
      const error = {
        type: ErrorType.AUTHENTICATION,
        title: 'Auth Error',
        message: 'Not authenticated',
        retryable: false,
      };
      
      const actions = service.getRecoveryActions(error);
      
      expect(actions).toContain('Log in again');
    });

    it('should return appropriate actions for rate limit errors', () => {
      const error = {
        type: ErrorType.RATE_LIMIT,
        title: 'Rate Limit',
        message: 'Too many requests',
        retryable: true,
      };
      
      const actions = service.getRecoveryActions(error);
      
      expect(actions).toContain('Try again');
      expect(actions).toContain('Wait a few moments before trying again');
    });
  });

  describe('error logging', () => {
    it('should log errors to internal log', () => {
      const error = new Error('Test error');
      const context = { component: 'TestComponent' };
      
      service.handleError(error, context);
      
      const recentErrors = service.getRecentErrors(1);
      expect(recentErrors).toHaveLength(1);
      expect(recentErrors[0].error.message).toBe('Test error');
      expect(recentErrors[0].context).toEqual(context);
    });

    it('should limit error log size', () => {
      // Add more than 100 errors
      for (let i = 0; i < 105; i++) {
        service.handleError(new Error(`Error ${i}`));
      }
      
      const recentErrors = service.getRecentErrors(200);
      expect(recentErrors.length).toBeLessThanOrEqual(100);
    });

    it('should clear error log', () => {
      service.handleError(new Error('Test error'));
      expect(service.getRecentErrors()).toHaveLength(1);
      
      service.clearErrorLog();
      expect(service.getRecentErrors()).toHaveLength(0);
    });
  });

  describe('isOnline', () => {
    it('should return true when online', () => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true,
      });
      
      expect(service.isOnline()).toBe(true);
    });

    it('should return false when offline', () => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });
      
      expect(service.isOnline()).toBe(false);
    });
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ErrorService.getInstance();
      const instance2 = ErrorService.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });
});