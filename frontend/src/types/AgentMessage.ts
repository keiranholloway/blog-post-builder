export type AgentType = 'content' | 'image' | 'publishing';

export type MessageType = 
  | 'generate_content'
  | 'revise_content'
  | 'generate_image'
  | 'revise_image'
  | 'publish_content'
  | 'status_update';

export type MessageStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AgentMessage {
  id: string;
  contentId: string;
  agentType: AgentType;
  messageType: MessageType;
  payload: any;
  status: MessageStatus;
  error?: string;
  result?: any;
  createdAt: Date;
  processedAt?: Date;
}

export interface AgentMessageCreateInput {
  contentId: string;
  agentType: AgentType;
  messageType: MessageType;
  payload: any;
}

export interface AgentMessageUpdateInput {
  status?: MessageStatus;
  error?: string;
  result?: any;
  processedAt?: Date;
}

// Specific payload types for different message types
export interface ContentGenerationPayload {
  transcription: string;
  userContext: string;
  writingStyle: string;
}

export interface ContentRevisionPayload {
  currentContent: string;
  feedback: string;
  userContext: string;
}

export interface ImageGenerationPayload {
  blogContent: string;
  title?: string;
  style?: string;
}

export interface ImageRevisionPayload {
  currentImageUrl: string;
  feedback: string;
  blogContent: string;
}

export interface PublishingPayload {
  content: string;
  title: string;
  imageUrl?: string;
  platform: string;
  platformConfig: any;
}