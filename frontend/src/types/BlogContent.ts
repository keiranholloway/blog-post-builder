export type ContentStatus = 
  | 'processing' 
  | 'draft' 
  | 'ready_for_review' 
  | 'revision_requested' 
  | 'approved' 
  | 'publishing' 
  | 'published' 
  | 'failed';

export interface Revision {
  id: string;
  contentId: string;
  version: number;
  content: string;
  feedback: string;
  createdAt: Date;
  agentType: 'content' | 'image';
}

export interface PublishResult {
  platform: string;
  status: 'success' | 'failed' | 'pending';
  publishedUrl?: string;
  error?: string;
  publishedAt?: Date;
}

export interface BlogContent {
  id: string;
  userId: string;
  title?: string;
  originalTranscription: string;
  currentDraft: string;
  associatedImage?: string;
  imageUrl?: string;
  status: ContentStatus;
  revisionHistory: Revision[];
  publishingResults: PublishResult[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BlogContentCreateInput {
  userId: string;
  originalTranscription: string;
  title?: string;
}

export interface BlogContentUpdateInput {
  title?: string;
  currentDraft?: string;
  associatedImage?: string;
  imageUrl?: string;
  status?: ContentStatus;
}