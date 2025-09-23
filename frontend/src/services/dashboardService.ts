import { BlogContent, ContentStatus } from '../types/BlogContent';
import { API_BASE_URL } from '../config/api';

export interface DashboardFilters {
  status?: ContentStatus[];
  platform?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  searchQuery?: string;
}

export interface DashboardStats {
  totalPosts: number;
  publishedPosts: number;
  draftPosts: number;
  failedPosts: number;
  recentActivity: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export class DashboardService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Get recent posts and drafts for dashboard
   */
  async getRecentContent(
    userId: string,
    page: number = 1,
    pageSize: number = 10,
    filters?: DashboardFilters
  ): Promise<PaginatedResponse<BlogContent>> {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });

      if (filters?.status?.length) {
        params.append('status', filters.status.join(','));
      }

      if (filters?.platform?.length) {
        params.append('platform', filters.platform.join(','));
      }

      if (filters?.searchQuery) {
        params.append('search', filters.searchQuery);
      }

      if (filters?.dateRange) {
        params.append('startDate', filters.dateRange.start.toISOString());
        params.append('endDate', filters.dateRange.end.toISOString());
      }

      const response = await fetch(`${this.baseUrl}/api/dashboard/content/${userId}?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch content: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Transform dates from strings to Date objects
      const transformedItems = data.items.map((item: any) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        revisionHistory: item.revisionHistory?.map((revision: any) => ({
          ...revision,
          createdAt: new Date(revision.createdAt),
          timestamp: new Date(revision.timestamp),
        })) || [],
        publishingResults: item.publishingResults?.map((result: any) => ({
          ...result,
          publishedAt: result.publishedAt ? new Date(result.publishedAt) : undefined,
        })) || [],
      }));

      return {
        ...data,
        items: transformedItems,
      };
    } catch (error) {
      console.error('Error fetching recent content:', error);
      throw error;
    }
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(userId: string): Promise<DashboardStats> {
    try {
      const response = await fetch(`${this.baseUrl}/api/dashboard/stats/${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch dashboard stats: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      throw error;
    }
  }

  /**
   * Get a specific blog content item
   */
  async getContent(contentId: string): Promise<BlogContent> {
    try {
      const response = await fetch(`${this.baseUrl}/api/content/${contentId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch content: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Transform dates from strings to Date objects
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        revisionHistory: data.revisionHistory?.map((revision: any) => ({
          ...revision,
          createdAt: new Date(revision.createdAt),
          timestamp: new Date(revision.timestamp),
        })) || [],
        publishingResults: data.publishingResults?.map((result: any) => ({
          ...result,
          publishedAt: result.publishedAt ? new Date(result.publishedAt) : undefined,
        })) || [],
      };
    } catch (error) {
      console.error('Error fetching content:', error);
      throw error;
    }
  }

  /**
   * Update blog content
   */
  async updateContent(contentId: string, updates: Partial<BlogContent>): Promise<BlogContent> {
    try {
      const response = await fetch(`${this.baseUrl}/api/content/${contentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`Failed to update content: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Transform dates from strings to Date objects
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        revisionHistory: data.revisionHistory?.map((revision: any) => ({
          ...revision,
          createdAt: new Date(revision.createdAt),
          timestamp: new Date(revision.timestamp),
        })) || [],
        publishingResults: data.publishingResults?.map((result: any) => ({
          ...result,
          publishedAt: result.publishedAt ? new Date(result.publishedAt) : undefined,
        })) || [],
      };
    } catch (error) {
      console.error('Error updating content:', error);
      throw error;
    }
  }

  /**
   * Delete blog content with confirmation
   */
  async deleteContent(contentId: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/content/${contentId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to delete content: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error deleting content:', error);
      throw error;
    }
  }

  /**
   * Search content by query
   */
  async searchContent(
    userId: string,
    query: string,
    page: number = 1,
    pageSize: number = 10
  ): Promise<PaginatedResponse<BlogContent>> {
    return this.getRecentContent(userId, page, pageSize, { searchQuery: query });
  }

  /**
   * Get drafts only
   */
  async getDrafts(
    userId: string,
    page: number = 1,
    pageSize: number = 10
  ): Promise<PaginatedResponse<BlogContent>> {
    return this.getRecentContent(userId, page, pageSize, { 
      status: ['draft', 'ready_for_review', 'revision_requested'] 
    });
  }

  /**
   * Get published posts only
   */
  async getPublishedPosts(
    userId: string,
    page: number = 1,
    pageSize: number = 10
  ): Promise<PaginatedResponse<BlogContent>> {
    return this.getRecentContent(userId, page, pageSize, { 
      status: ['published', 'completed'] 
    });
  }
}

// Export singleton instance
export const dashboardService = new DashboardService();