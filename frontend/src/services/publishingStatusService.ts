import { API_BASE_URL } from '../config/api';

export interface PublishingJob {
  id: string;
  contentId: string;
  platform: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'retrying' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  result?: any;
  createdAt: string;
  updatedAt: string;
  nextRetryAt?: string;
}

export interface PublishingOrchestrationResult {
  jobId: string;
  contentId: string;
  totalPlatforms: number;
  successfulPlatforms: number;
  failedPlatforms: number;
  status: 'completed' | 'partial' | 'failed' | 'in_progress' | 'cancelled';
  results: Record<string, any>;
  jobs: Record<string, PublishingJob>;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationRequest {
  contentId: string;
  platforms: string[];
  configs: Record<string, any>;
  imageUrl?: string;
}

class PublishingStatusService {
  private baseUrl: string;
  private statusPollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.baseUrl = `${API_BASE_URL}/publishing`;
  }

  async startOrchestration(request: OrchestrationRequest): Promise<PublishingOrchestrationResult> {
    try {
      const response = await fetch(`${this.baseUrl}/orchestrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Failed to start orchestration: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error starting orchestration:', error);
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<PublishingOrchestrationResult | null> {
    try {
      const response = await fetch(`${this.baseUrl}/job-status?jobId=${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get job status: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error getting job status:', error);
      throw error;
    }
  }

  async retryFailedJobs(jobId: string): Promise<PublishingOrchestrationResult> {
    try {
      const response = await fetch(`${this.baseUrl}/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to retry jobs: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error retrying jobs:', error);
      throw error;
    }
  }

  async cancelJob(jobId: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel job: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error cancelling job:', error);
      throw error;
    }
  }

  startStatusPolling(
    jobId: string,
    onStatusUpdate: (status: PublishingOrchestrationResult) => void,
    onComplete: (finalStatus: PublishingOrchestrationResult) => void,
    onError: (error: Error) => void,
    intervalMs: number = 2000
  ): void {
    // Clear any existing polling for this job
    this.stopStatusPolling(jobId);

    const poll = async () => {
      try {
        const status = await this.getJobStatus(jobId);
        
        if (!status) {
          onError(new Error('Job not found'));
          this.stopStatusPolling(jobId);
          return;
        }

        onStatusUpdate(status);

        // Check if job is complete
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          onComplete(status);
          this.stopStatusPolling(jobId);
          return;
        }

        // Check if all individual jobs are complete
        const allJobsComplete = Object.values(status.jobs).every(job => 
          job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
        );

        if (allJobsComplete) {
          // Update final status
          const successfulJobs = Object.values(status.jobs).filter(job => job.status === 'completed').length;
          const failedJobs = Object.values(status.jobs).filter(job => job.status === 'failed').length;
          
          status.successfulPlatforms = successfulJobs;
          status.failedPlatforms = failedJobs;
          
          if (successfulJobs > 0 && failedJobs === 0) {
            status.status = 'completed';
          } else if (successfulJobs > 0 && failedJobs > 0) {
            status.status = 'partial';
          } else {
            status.status = 'failed';
          }

          onComplete(status);
          this.stopStatusPolling(jobId);
        }
      } catch (error) {
        onError(error instanceof Error ? error : new Error('Unknown polling error'));
        this.stopStatusPolling(jobId);
      }
    };

    // Start polling
    const interval = setInterval(poll, intervalMs);
    this.statusPollingIntervals.set(jobId, interval);

    // Initial poll
    poll();
  }

  stopStatusPolling(jobId: string): void {
    const interval = this.statusPollingIntervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.statusPollingIntervals.delete(jobId);
    }
  }

  stopAllPolling(): void {
    this.statusPollingIntervals.forEach((interval, jobId) => {
      clearInterval(interval);
    });
    this.statusPollingIntervals.clear();
  }

  getJobSummary(result: PublishingOrchestrationResult): {
    total: number;
    successful: number;
    failed: number;
    pending: number;
    inProgress: number;
  } {
    const jobs = Object.values(result.jobs);
    
    return {
      total: jobs.length,
      successful: jobs.filter(job => job.status === 'completed').length,
      failed: jobs.filter(job => job.status === 'failed').length,
      pending: jobs.filter(job => job.status === 'pending').length,
      inProgress: jobs.filter(job => job.status === 'in_progress' || job.status === 'retrying').length,
    };
  }

  formatJobDuration(job: PublishingJob): string {
    const start = new Date(job.createdAt);
    const end = new Date(job.updatedAt);
    const durationMs = end.getTime() - start.getTime();
    
    if (durationMs < 1000) {
      return '< 1s';
    } else if (durationMs < 60000) {
      return `${Math.round(durationMs / 1000)}s`;
    } else {
      return `${Math.round(durationMs / 60000)}m`;
    }
  }

  getJobStatusIcon(status: PublishingJob['status']): string {
    switch (status) {
      case 'pending': return '⏳';
      case 'in_progress': return '🔄';
      case 'retrying': return '🔁';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'cancelled': return '⏹️';
      default: return '❓';
    }
  }

  getOverallStatusIcon(status: PublishingOrchestrationResult['status']): string {
    switch (status) {
      case 'in_progress': return '🔄';
      case 'completed': return '✅';
      case 'partial': return '⚠️';
      case 'failed': return '❌';
      case 'cancelled': return '⏹️';
      default: return '❓';
    }
  }

  formatError(error: string): string {
    // Format common API errors into user-friendly messages
    if (error.includes('401') || error.includes('unauthorized')) {
      return 'Authentication failed. Please reconnect your account.';
    }
    if (error.includes('403') || error.includes('forbidden')) {
      return 'Permission denied. Please check your account permissions.';
    }
    if (error.includes('429') || error.includes('rate limit')) {
      return 'Rate limit exceeded. Will retry automatically.';
    }
    if (error.includes('500') || error.includes('internal server')) {
      return 'Server error occurred. Will retry automatically.';
    }
    if (error.includes('network') || error.includes('fetch')) {
      return 'Network error. Please check your connection.';
    }

    return error;
  }

  // Cleanup method to be called when component unmounts
  cleanup(): void {
    this.stopAllPolling();
  }
}

export const publishingStatusService = new PublishingStatusService();