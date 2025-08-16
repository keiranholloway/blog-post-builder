import { 
  User, 
  BlogContent, 
  AgentMessage, 
  PlatformConnection,
  UserCreateInput,
  BlogContentCreateInput,
  AgentMessageCreateInput,
  PlatformConnectionCreateInput
} from '../types';

// Date serialization helpers
export const serializeDate = (date: Date): string => {
  return date.toISOString();
};

export const deserializeDate = (dateString: string): Date => {
  return new Date(dateString);
};

// User serialization
export const serializeUser = (user: User): Record<string, any> => {
  return {
    ...user,
    createdAt: serializeDate(user.createdAt),
    updatedAt: serializeDate(user.updatedAt),
    connectedPlatforms: user.connectedPlatforms.map(serializePlatformConnection)
  };
};

export const deserializeUser = (data: Record<string, any>): User => {
  return {
    ...data,
    createdAt: deserializeDate(data.createdAt),
    updatedAt: deserializeDate(data.updatedAt),
    connectedPlatforms: data.connectedPlatforms?.map(deserializePlatformConnection) || []
  } as User;
};

// BlogContent serialization
export const serializeBlogContent = (content: BlogContent): Record<string, any> => {
  return {
    ...content,
    createdAt: serializeDate(content.createdAt),
    updatedAt: serializeDate(content.updatedAt),
    revisionHistory: content.revisionHistory.map(revision => ({
      ...revision,
      createdAt: serializeDate(revision.createdAt)
    })),
    publishingResults: content.publishingResults.map(result => ({
      ...result,
      publishedAt: result.publishedAt ? serializeDate(result.publishedAt) : undefined
    }))
  };
};

export const deserializeBlogContent = (data: Record<string, any>): BlogContent => {
  return {
    ...data,
    createdAt: deserializeDate(data.createdAt),
    updatedAt: deserializeDate(data.updatedAt),
    revisionHistory: data.revisionHistory?.map((revision: any) => ({
      ...revision,
      createdAt: deserializeDate(revision.createdAt)
    })) || [],
    publishingResults: data.publishingResults?.map((result: any) => ({
      ...result,
      publishedAt: result.publishedAt ? deserializeDate(result.publishedAt) : undefined
    })) || []
  } as BlogContent;
};

// AgentMessage serialization
export const serializeAgentMessage = (message: AgentMessage): Record<string, any> => {
  return {
    ...message,
    createdAt: serializeDate(message.createdAt),
    processedAt: message.processedAt ? serializeDate(message.processedAt) : undefined
  };
};

export const deserializeAgentMessage = (data: Record<string, any>): AgentMessage => {
  return {
    ...data,
    createdAt: deserializeDate(data.createdAt),
    processedAt: data.processedAt ? deserializeDate(data.processedAt) : undefined
  } as AgentMessage;
};

// PlatformConnection serialization
export const serializePlatformConnection = (connection: PlatformConnection): Record<string, any> => {
  return {
    ...connection,
    connectedAt: serializeDate(connection.connectedAt),
    updatedAt: serializeDate(connection.updatedAt),
    lastUsed: connection.lastUsed ? serializeDate(connection.lastUsed) : undefined,
    credentials: {
      ...connection.credentials,
      expiresAt: connection.credentials.expiresAt ? serializeDate(connection.credentials.expiresAt) : undefined
    }
  };
};

export const deserializePlatformConnection = (data: Record<string, any>): PlatformConnection => {
  return {
    ...data,
    connectedAt: deserializeDate(data.connectedAt),
    updatedAt: deserializeDate(data.updatedAt),
    lastUsed: data.lastUsed ? deserializeDate(data.lastUsed) : undefined,
    credentials: {
      ...data.credentials,
      expiresAt: data.credentials?.expiresAt ? deserializeDate(data.credentials.expiresAt) : undefined
    }
  } as PlatformConnection;
};

// Data transformation utilities
export const transformUserCreateInput = (input: UserCreateInput): Record<string, any> => {
  return {
    ...input,
    preferences: input.preferences || {
      defaultPlatforms: [],
      autoPublish: false,
      imageGenerationEnabled: true,
      voiceInputEnabled: true,
      theme: 'auto'
    }
  };
};

export const transformBlogContentCreateInput = (input: BlogContentCreateInput): Record<string, any> => {
  return {
    ...input,
    status: 'processing',
    currentDraft: input.originalTranscription, // Initially set draft to transcription
    revisionHistory: [],
    publishingResults: []
  };
};

export const transformAgentMessageCreateInput = (input: AgentMessageCreateInput): Record<string, any> => {
  return {
    ...input,
    status: 'pending'
  };
};

export const transformPlatformConnectionCreateInput = (input: PlatformConnectionCreateInput): Record<string, any> => {
  return {
    ...input,
    isActive: true,
    configuration: {
      autoPublish: false,
      defaultTags: [],
      customSettings: {},
      ...input.configuration
    }
  };
};

// Utility functions for common transformations
export const sanitizeForApi = (data: Record<string, any>): Record<string, any> => {
  const sanitized = { ...data };
  
  // Remove undefined values
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] === undefined) {
      delete sanitized[key];
    }
  });
  
  return sanitized;
};

export const deepClone = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

export const omitFields = <T extends Record<string, any>>(obj: T, fields: string[]): Partial<T> => {
  const result = { ...obj };
  fields.forEach(field => {
    delete result[field];
  });
  return result;
};

export const pickFields = <T extends Record<string, any>>(obj: T, fields: string[]): Partial<T> => {
  const result: Partial<T> = {};
  fields.forEach(field => {
    if (field in obj) {
      result[field as keyof T] = obj[field];
    }
  });
  return result;
};

// Content status transformation helpers
export const getNextContentStatus = (currentStatus: string): string => {
  const statusFlow: Record<string, string> = {
    'processing': 'draft',
    'draft': 'ready_for_review',
    'ready_for_review': 'approved',
    'revision_requested': 'ready_for_review',
    'approved': 'publishing',
    'publishing': 'published'
  };
  
  return statusFlow[currentStatus] || currentStatus;
};

export const canTransitionStatus = (from: string, to: string): boolean => {
  const allowedTransitions: Record<string, string[]> = {
    'processing': ['draft', 'failed'],
    'draft': ['ready_for_review', 'processing'],
    'ready_for_review': ['approved', 'revision_requested'],
    'revision_requested': ['ready_for_review', 'processing'],
    'approved': ['publishing', 'revision_requested'],
    'publishing': ['published', 'failed'],
    'published': [],
    'failed': ['processing']
  };
  
  return allowedTransitions[from]?.includes(to) || false;
};