import { API_BASE_URL } from '../config/api';

export interface RevisionRequest {
  contentId: string;
  feedback: string;
  revisionType: 'content' | 'image';
  userId?: string;
  priority?: 'low' | 'medium' | 'high';
  specificChanges?: string[];
}

export interface BatchRevisionRequest {
  contentId: string;
  contentFeedback?: string;
  imageFeedback?: string;
  userId?: string;
}

export interface RevisionResponse {
  success: boolean;
  revisionId: string;
  message: string;
  estimatedTime?: number;
  newPrompt?: string;
  error?: string;
}

export interface RevisionHistory {
  id: string;
  timestamp: string;
  feedback: string;
  revisionType: 'content' | 'image';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  userId?: string;
  result?: any;
  error?: string;
}

export interface RevisionHistoryResponse {
  contentId: string;
  revisions: RevisionHistory[];
  totalRevisions: number;
}

export interface BatchRevisionResponse {
  success: boolean;
  message: string;
  results: Array<{
    type: 'content' | 'image';
    success: boolean;
    revisionId?: string;
    error?: string;
  }>;
}

class RevisionService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  /**
   * Submit a content revision request
   */
  async requestContentRevision(
    contentId: string,
    feedback: string,
    options?: {
      userId?: string;
      priority?: 'low' | 'medium' | 'high';
      specificChanges?: string[];
    }
  ): Promise<RevisionResponse> {
    try {
      const request: RevisionRequest = {
        contentId,
        feedback,
        revisionType: 'content',
        ...options,
      };

      const response = await fetch(`${this.baseUrl}/api/revision/content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error requesting content revision:', error);
      throw error;
    }
  }

  /**
   * Submit an image revision request
   */
  async requestImageRevision(
    contentId: string,
    feedback: string,
    options?: {
      userId?: string;
      priority?: 'low' | 'medium' | 'high';
    }
  ): Promise<RevisionResponse> {
    try {
      const request: RevisionRequest = {
        contentId,
        feedback,
        revisionType: 'image',
        ...options,
      };

      const response = await fetch(`${this.baseUrl}/api/revision/image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error requesting image revision:', error);
      throw error;
    }
  }

  /**
   * Submit both content and image revisions in a single request
   */
  async requestBatchRevision(request: BatchRevisionRequest): Promise<BatchRevisionResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/revision/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error requesting batch revision:', error);
      throw error;
    }
  }

  /**
   * Get revision history for a content item
   */
  async getRevisionHistory(contentId: string): Promise<RevisionHistoryResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/revision/history/${contentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting revision history:', error);
      throw error;
    }
  }

  /**
   * Get pending revisions for a content item
   */
  async getPendingRevisions(contentId: string): Promise<RevisionHistory[]> {
    try {
      const history = await this.getRevisionHistory(contentId);
      return history.revisions.filter(revision => 
        revision.status === 'pending' || revision.status === 'processing'
      );
    } catch (error) {
      console.error('Error getting pending revisions:', error);
      throw error;
    }
  }

  /**
   * Check if content has any pending revisions
   */
  async hasPendingRevisions(contentId: string): Promise<boolean> {
    try {
      const pendingRevisions = await this.getPendingRevisions(contentId);
      return pendingRevisions.length > 0;
    } catch (error) {
      console.error('Error checking pending revisions:', error);
      return false;
    }
  }

  /**
   * Get revision statistics for a content item
   */
  async getRevisionStats(contentId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
    contentRevisions: number;
    imageRevisions: number;
  }> {
    try {
      const history = await this.getRevisionHistory(contentId);
      const revisions = history.revisions;

      return {
        total: revisions.length,
        completed: revisions.filter(r => r.status === 'completed').length,
        failed: revisions.filter(r => r.status === 'failed').length,
        pending: revisions.filter(r => r.status === 'pending' || r.status === 'processing').length,
        contentRevisions: revisions.filter(r => r.revisionType === 'content').length,
        imageRevisions: revisions.filter(r => r.revisionType === 'image').length,
      };
    } catch (error) {
      console.error('Error getting revision stats:', error);
      return {
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        contentRevisions: 0,
        imageRevisions: 0,
      };
    }
  }

  /**
   * Cancel a pending revision (if supported by backend)
   */
  async cancelRevision(contentId: string, revisionId: string): Promise<boolean> {
    try {
      // This would need to be implemented in the backend
      const response = await fetch(`${this.baseUrl}/api/revision/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contentId, revisionId }),
      });

      return response.ok;
    } catch (error) {
      console.error('Error canceling revision:', error);
      return false;
    }
  }

  /**
   * Retry a failed revision
   */
  async retryRevision(contentId: string, revisionId: string): Promise<RevisionResponse> {
    try {
      const history = await this.getRevisionHistory(contentId);
      const revision = history.revisions.find(r => r.id === revisionId);
      
      if (!revision) {
        throw new Error('Revision not found');
      }

      if (revision.status !== 'failed') {
        throw new Error('Can only retry failed revisions');
      }

      // Resubmit the revision with the same feedback
      if (revision.revisionType === 'content') {
        return await this.requestContentRevision(contentId, revision.feedback, {
          userId: revision.userId,
        });
      } else {
        return await this.requestImageRevision(contentId, revision.feedback, {
          userId: revision.userId,
        });
      }
    } catch (error) {
      console.error('Error retrying revision:', error);
      throw error;
    }
  }

  /**
   * Get estimated completion time for pending revisions
   */
  async getEstimatedCompletionTime(contentId: string): Promise<number> {
    try {
      const pendingRevisions = await this.getPendingRevisions(contentId);
      
      // Simple estimation: 60 seconds per content revision, 45 seconds per image revision
      let totalTime = 0;
      for (const revision of pendingRevisions) {
        if (revision.revisionType === 'content') {
          totalTime += 60;
        } else {
          totalTime += 45;
        }
      }

      return totalTime;
    } catch (error) {
      console.error('Error getting estimated completion time:', error);
      return 0;
    }
  }

  /**
   * Validate feedback before submission
   */
  validateFeedback(feedback: string, type: 'content' | 'image'): {
    isValid: boolean;
    errors: string[];
    suggestions: string[];
  } {
    const errors: string[] = [];
    const suggestions: string[] = [];

    // Basic validation
    if (!feedback || feedback.trim().length === 0) {
      errors.push('Feedback cannot be empty');
    }

    if (feedback.length < 10) {
      errors.push('Feedback should be at least 10 characters long');
    }

    if (feedback.length > 1000) {
      errors.push('Feedback should be less than 1000 characters');
    }

    // Type-specific suggestions
    if (type === 'content') {
      if (!feedback.toLowerCase().includes('tone') && 
          !feedback.toLowerCase().includes('structure') && 
          !feedback.toLowerCase().includes('information') &&
          !feedback.toLowerCase().includes('length')) {
        suggestions.push('Consider specifying what aspect to change: tone, structure, information, or length');
      }
    } else {
      if (!feedback.toLowerCase().includes('color') && 
          !feedback.toLowerCase().includes('style') && 
          !feedback.toLowerCase().includes('composition') &&
          !feedback.toLowerCase().includes('mood')) {
        suggestions.push('Consider specifying what to change: colors, style, composition, or mood');
      }
    }

    // Positive suggestions
    if (feedback.toLowerCase().includes('bad') || feedback.toLowerCase().includes('wrong')) {
      suggestions.push('Try to provide constructive feedback about what you\'d like to see instead');
    }

    return {
      isValid: errors.length === 0,
      errors,
      suggestions,
    };
  }
}

export const revisionService = new RevisionService();