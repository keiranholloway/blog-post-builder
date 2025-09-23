import { vi } from 'vitest';
import { publishingStatusService, PublishingOrchestrationResult, PublishingJob } from '../publishingStatusService';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { afterEach } from 'node:test';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { afterEach } from 'node:test';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';

// Mock fetch
global.fetch = vi.fn();

// Mock API_BASE_URL
vi.mock('../config/api', () => ({
  API_BASE_URL: ''
}));

describe('PublishingStatusService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishingStatusService.stopAllPolling();
  });

  afterEach(() => {
    publishingStatusService.cleanup();
  });

  describe('startOrchestration', () => {
    it('should start orchestration successfully', async () => {
      const mockResponse = {
        jobId: 'job-123',
        contentId: 'content-123',
        totalPlatforms: 2,
        status: 'in_progress'
      };

      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const request = {
        contentId: 'content-123',
        platforms: ['medium', 'linkedin'],
        configs: {
          medium: { platform: 'medium', credentials: {} },
          linkedin: { platform: 'linkedin', credentials: {} }
        },
        imageUrl: 'https://example.com/image.jpg'
      };

      const result = await publishingStatusService.startOrchestration(request);

      expect(fetch).toHaveBeenCalledWith(
        '/publishing/orchestrate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        }
      );

      expect(result).toEqual(mockResponse);
    });

    it('should handle orchestration errors', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error'
      });

      const request = {
        contentId: 'content-123',
        platforms: ['medium'],
        configs: { medium: {} }
      };

      await expect(publishingStatusService.startOrchestration(request))
        .rejects.toThrow('Failed to start orchestration: Internal Server Error');
    });
  });

  describe('getJobStatus', () => {
    it('should get job status successfully', async () => {
      const mockStatus: PublishingOrchestrationResult = {
        jobId: 'job-123',
        contentId: 'content-123',
        totalPlatforms: 2,
        successfulPlatforms: 1,
        failedPlatforms: 0,
        status: 'in_progress',
        results: {},
        jobs: {
          medium: {
            id: 'job-123_medium',
            contentId: 'content-123',
            platform: 'medium',
            status: 'completed',
            attempts: 1,
            maxAttempts: 3,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:01:00Z'
          },
          linkedin: {
            id: 'job-123_linkedin',
            contentId: 'content-123',
            platform: 'linkedin',
            status: 'in_progress',
            attempts: 1,
            maxAttempts: 3,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:30Z'
          }
        },
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:30Z'
      };

      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStatus)
      });

      const result = await publishingStatusService.getJobStatus('job-123');

      expect(fetch).toHaveBeenCalledWith(
        '/publishing/job-status?jobId=job-123',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      expect(result).toEqual(mockStatus);
    });

    it('should return null for 404 responses', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 404
      });

      const result = await publishingStatusService.getJobStatus('nonexistent-job');
      expect(result).toBeNull();
    });

    it('should handle other errors', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      await expect(publishingStatusService.getJobStatus('job-123'))
        .rejects.toThrow('Failed to get job status: Internal Server Error');
    });
  });

  describe('retryFailedJobs', () => {
    it('should retry failed jobs successfully', async () => {
      const mockResponse: PublishingOrchestrationResult = {
        jobId: 'job-123',
        contentId: 'content-123',
        totalPlatforms: 2,
        successfulPlatforms: 1,
        failedPlatforms: 1,
        status: 'partial',
        results: {},
        jobs: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:01:00Z'
      };

      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await publishingStatusService.retryFailedJobs('job-123');

      expect(fetch).toHaveBeenCalledWith(
        '/publishing/retry',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: 'job-123' })
        }
      );

      expect(result).toEqual(mockResponse);
    });
  });

  describe('cancelJob', () => {
    it('should cancel job successfully', async () => {
      (fetch as any).mockResolvedValue({
        ok: true
      });

      await publishingStatusService.cancelJob('job-123');

      expect(fetch).toHaveBeenCalledWith(
        '/publishing/cancel',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: 'job-123' })
        }
      );
    });
  });

  describe('status polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should poll status and call callbacks', async () => {
      const mockStatus: PublishingOrchestrationResult = {
        jobId: 'job-123',
        contentId: 'content-123',
        totalPlatforms: 1,
        successfulPlatforms: 0,
        failedPlatforms: 0,
        status: 'in_progress',
        results: {},
        jobs: {
          medium: {
            id: 'job-123_medium',
            contentId: 'content-123',
            platform: 'medium',
            status: 'in_progress',
            attempts: 1,
            maxAttempts: 3,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:30Z'
          }
        },
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:30Z'
      };

      const completedStatus: PublishingOrchestrationResult = {
        ...mockStatus,
        status: 'completed',
        successfulPlatforms: 1,
        jobs: {
          medium: {
            ...mockStatus.jobs.medium,
            status: 'completed'
          }
        }
      };

      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockStatus)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(completedStatus)
        });

      const onStatusUpdate = vi.fn();
      const onComplete = vi.fn();
      const onError = vi.fn();

      publishingStatusService.startStatusPolling(
        'job-123',
        onStatusUpdate,
        onComplete,
        onError,
        1000
      );

      // Wait for initial poll to complete
      await vi.waitFor(() => {
        expect(onStatusUpdate).toHaveBeenCalledWith(mockStatus);
      });

      // Advance timer for next poll
      vi.advanceTimersByTime(1000);
      
      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledWith(completedStatus);
      });
      expect(onError).not.toHaveBeenCalled();
    });

    it('should handle polling errors', async () => {
      (fetch as any).mockRejectedValue(new Error('Network error'));

      const onStatusUpdate = vi.fn();
      const onComplete = vi.fn();
      const onError = vi.fn();

      publishingStatusService.startStatusPolling(
        'job-123',
        onStatusUpdate,
        onComplete,
        onError
      );

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
      });
      expect(onStatusUpdate).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('should stop polling when job is complete', async () => {
      const completedStatus: PublishingOrchestrationResult = {
        jobId: 'job-123',
        contentId: 'content-123',
        totalPlatforms: 1,
        successfulPlatforms: 1,
        failedPlatforms: 0,
        status: 'completed',
        results: {},
        jobs: {
          medium: {
            id: 'job-123_medium',
            contentId: 'content-123',
            platform: 'medium',
            status: 'completed',
            attempts: 1,
            maxAttempts: 3,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:01:00Z'
          }
        },
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:01:00Z'
      };

      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(completedStatus)
      });

      const onStatusUpdate = vi.fn();
      const onComplete = vi.fn();
      const onError = vi.fn();

      publishingStatusService.startStatusPolling(
        'job-123',
        onStatusUpdate,
        onComplete,
        onError
      );

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledWith(completedStatus);
      });

      // Clear mocks and advance timer
      vi.clearAllMocks();
      vi.advanceTimersByTime(2000);

      // Should not poll again
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('utility methods', () => {
    it('should get job summary correctly', () => {
      const result: PublishingOrchestrationResult = {
        jobId: 'job-123',
        contentId: 'content-123',
        totalPlatforms: 4,
        successfulPlatforms: 0,
        failedPlatforms: 0,
        status: 'in_progress',
        results: {},
        jobs: {
          medium: {
            id: 'job-123_medium',
            contentId: 'content-123',
            platform: 'medium',
            status: 'completed',
            attempts: 1,
            maxAttempts: 3,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:01:00Z'
          },
          linkedin: {
            id: 'job-123_linkedin',
            contentId: 'content-123',
            platform: 'linkedin',
            status: 'failed',
            attempts: 3,
            maxAttempts: 3,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:02:00Z'
          },
          twitter: {
            id: 'job-123_twitter',
            contentId: 'content-123',
            platform: 'twitter',
            status: 'pending',
            attempts: 0,
            maxAttempts: 3,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:00Z'
          },
          dev: {
            id: 'job-123_dev',
            contentId: 'content-123',
            platform: 'dev',
            status: 'in_progress',
            attempts: 1,
            maxAttempts: 3,
            createdAt: '2023-01-01T00:00:00Z',
            updatedAt: '2023-01-01T00:00:30Z'
          }
        },
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:02:00Z'
      };

      const summary = publishingStatusService.getJobSummary(result);

      expect(summary).toEqual({
        total: 4,
        successful: 1,
        failed: 1,
        pending: 1,
        inProgress: 1
      });
    });

    it('should format job duration correctly', () => {
      const job: PublishingJob = {
        id: 'job-123',
        contentId: 'content-123',
        platform: 'medium',
        status: 'completed',
        attempts: 1,
        maxAttempts: 3,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:01:30.000Z'
      };

      const duration = publishingStatusService.formatJobDuration(job);
      expect(duration).toBe('2m'); // 90 seconds = 2 minutes (rounded)
    });

    it('should format short durations correctly', () => {
      const job: PublishingJob = {
        id: 'job-123',
        contentId: 'content-123',
        platform: 'medium',
        status: 'completed',
        attempts: 1,
        maxAttempts: 3,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:05.500Z'
      };

      const duration = publishingStatusService.formatJobDuration(job);
      expect(duration).toBe('6s');
    });

    it('should get correct status icons', () => {
      expect(publishingStatusService.getJobStatusIcon('pending')).toBe('⏳');
      expect(publishingStatusService.getJobStatusIcon('in_progress')).toBe('🔄');
      expect(publishingStatusService.getJobStatusIcon('retrying')).toBe('🔁');
      expect(publishingStatusService.getJobStatusIcon('completed')).toBe('✅');
      expect(publishingStatusService.getJobStatusIcon('failed')).toBe('❌');
      expect(publishingStatusService.getJobStatusIcon('cancelled')).toBe('⏹️');
    });

    it('should get correct overall status icons', () => {
      expect(publishingStatusService.getOverallStatusIcon('in_progress')).toBe('🔄');
      expect(publishingStatusService.getOverallStatusIcon('completed')).toBe('✅');
      expect(publishingStatusService.getOverallStatusIcon('partial')).toBe('⚠️');
      expect(publishingStatusService.getOverallStatusIcon('failed')).toBe('❌');
      expect(publishingStatusService.getOverallStatusIcon('cancelled')).toBe('⏹️');
    });

    it('should format errors correctly', () => {
      expect(publishingStatusService.formatError('401 Unauthorized'))
        .toBe('Authentication failed. Please reconnect your account.');
      
      expect(publishingStatusService.formatError('403 Forbidden'))
        .toBe('Permission denied. Please check your account permissions.');
      
      expect(publishingStatusService.formatError('429 Rate limit exceeded'))
        .toBe('Rate limit exceeded. Will retry automatically.');
      
      expect(publishingStatusService.formatError('500 Internal server error'))
        .toBe('Server error occurred. Will retry automatically.');
      
      expect(publishingStatusService.formatError('Network fetch failed'))
        .toBe('Network error. Please check your connection.');
      
      expect(publishingStatusService.formatError('Custom error message'))
        .toBe('Custom error message');
    });
  });

  describe('cleanup', () => {
    it('should stop all polling on cleanup', () => {
      const stopAllPollingSpy = vi.spyOn(publishingStatusService, 'stopAllPolling');
      
      publishingStatusService.cleanup();
      
      expect(stopAllPollingSpy).toHaveBeenCalled();
    });
  });
});
