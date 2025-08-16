// Core data models
export * from './User';
export * from './BlogContent';
export * from './AgentMessage';
export * from './PlatformConnection';

// Common utility types
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
  timestamp: Date;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}