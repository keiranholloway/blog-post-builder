import { 
  User, 
  UserCreateInput, 
  UserUpdateInput,
  BlogContent, 
  BlogContentCreateInput, 
  BlogContentUpdateInput,
  AgentMessage, 
  AgentMessageCreateInput, 
  AgentMessageUpdateInput,
  PlatformConnection, 
  PlatformConnectionCreateInput, 
  PlatformConnectionUpdateInput,
  ValidationError,
  Platform,
  AgentType,
  MessageType,
  MessageStatus,
  ContentStatus
} from '../types';

// Validation result type
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

// Helper functions
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidUUID = (id: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

const isValidDate = (date: any): boolean => {
  return date instanceof Date && !isNaN(date.getTime());
};

const isValidPlatform = (platform: string): platform is Platform => {
  return ['medium', 'linkedin', 'dev.to', 'hashnode', 'custom'].includes(platform);
};

const isValidAgentType = (type: string): type is AgentType => {
  return ['content', 'image', 'publishing'].includes(type);
};

const isValidMessageType = (type: string): type is MessageType => {
  return [
    'generate_content',
    'revise_content', 
    'generate_image',
    'revise_image',
    'publish_content',
    'status_update'
  ].includes(type);
};

const isValidMessageStatus = (status: string): status is MessageStatus => {
  return ['pending', 'processing', 'completed', 'failed'].includes(status);
};

const isValidContentStatus = (status: string): status is ContentStatus => {
  return [
    'processing',
    'draft',
    'ready_for_review',
    'revision_requested',
    'approved',
    'publishing',
    'published',
    'failed'
  ].includes(status);
};

// User validation functions
export const validateUser = (user: User): ValidationResult => {
  const errors: ValidationError[] = [];

  if (!user.id || !isValidUUID(user.id)) {
    errors.push({ field: 'id', message: 'Valid UUID is required', code: 'INVALID_UUID' });
  }

  if (!user.email || !isValidEmail(user.email)) {
    errors.push({ field: 'email', message: 'Valid email address is required', code: 'INVALID_EMAIL' });
  }

  if (!user.writingStyleContext || user.writingStyleContext.trim().length === 0) {
    errors.push({ field: 'writingStyleContext', message: 'Writing style context is required', code: 'REQUIRED_FIELD' });
  }

  if (!Array.isArray(user.connectedPlatforms)) {
    errors.push({ field: 'connectedPlatforms', message: 'Connected platforms must be an array', code: 'INVALID_TYPE' });
  }

  if (!isValidDate(user.createdAt)) {
    errors.push({ field: 'createdAt', message: 'Valid creation date is required', code: 'INVALID_DATE' });
  }

  if (!isValidDate(user.updatedAt)) {
    errors.push({ field: 'updatedAt', message: 'Valid update date is required', code: 'INVALID_DATE' });
  }

  return { isValid: errors.length === 0, errors };
};

export const validateUserCreateInput = (input: UserCreateInput): ValidationResult => {
  const errors: ValidationError[] = [];

  if (!input.email || !isValidEmail(input.email)) {
    errors.push({ field: 'email', message: 'Valid email address is required', code: 'INVALID_EMAIL' });
  }

  if (input.writingStyleContext !== undefined && input.writingStyleContext.trim().length === 0) {
    errors.push({ field: 'writingStyleContext', message: 'Writing style context cannot be empty if provided', code: 'INVALID_VALUE' });
  }

  return { isValid: errors.length === 0, errors };
};

export const validateUserUpdateInput = (input: UserUpdateInput): ValidationResult => {
  const errors: ValidationError[] = [];

  if (input.writingStyleContext !== undefined && input.writingStyleContext.trim().length === 0) {
    errors.push({ field: 'writingStyleContext', message: 'Writing style context cannot be empty if provided', code: 'INVALID_VALUE' });
  }

  return { isValid: errors.length === 0, errors };
};

// BlogContent validation functions
export const validateBlogContent = (content: BlogContent): ValidationResult => {
  const errors: ValidationError[] = [];

  if (!content.id || !isValidUUID(content.id)) {
    errors.push({ field: 'id', message: 'Valid UUID is required', code: 'INVALID_UUID' });
  }

  if (!content.userId || !isValidUUID(content.userId)) {
    errors.push({ field: 'userId', message: 'Valid user UUID is required', code: 'INVALID_UUID' });
  }

  if (!content.originalTranscription || content.originalTranscription.trim().length === 0) {
    errors.push({ field: 'originalTranscription', message: 'Original transcription is required', code: 'REQUIRED_FIELD' });
  }

  if (!content.currentDraft || content.currentDraft.trim().length === 0) {
    errors.push({ field: 'currentDraft', message: 'Current draft is required', code: 'REQUIRED_FIELD' });
  }

  if (!isValidContentStatus(content.status)) {
    errors.push({ field: 'status', message: 'Valid content status is required', code: 'INVALID_STATUS' });
  }

  if (!Array.isArray(content.revisionHistory)) {
    errors.push({ field: 'revisionHistory', message: 'Revision history must be an array', code: 'INVALID_TYPE' });
  }

  if (!Array.isArray(content.publishingResults)) {
    errors.push({ field: 'publishingResults', message: 'Publishing results must be an array', code: 'INVALID_TYPE' });
  }

  if (!isValidDate(content.createdAt)) {
    errors.push({ field: 'createdAt', message: 'Valid creation date is required', code: 'INVALID_DATE' });
  }

  if (!isValidDate(content.updatedAt)) {
    errors.push({ field: 'updatedAt', message: 'Valid update date is required', code: 'INVALID_DATE' });
  }

  return { isValid: errors.length === 0, errors };
};

export const validateBlogContentCreateInput = (input: BlogContentCreateInput): ValidationResult => {
  const errors: ValidationError[] = [];

  if (!input.userId || !isValidUUID(input.userId)) {
    errors.push({ field: 'userId', message: 'Valid user UUID is required', code: 'INVALID_UUID' });
  }

  if (!input.originalTranscription || input.originalTranscription.trim().length === 0) {
    errors.push({ field: 'originalTranscription', message: 'Original transcription is required', code: 'REQUIRED_FIELD' });
  }

  if (input.title !== undefined && input.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title cannot be empty if provided', code: 'INVALID_VALUE' });
  }

  return { isValid: errors.length === 0, errors };
};

export const validateBlogContentUpdateInput = (input: BlogContentUpdateInput): ValidationResult => {
  const errors: ValidationError[] = [];

  if (input.title !== undefined && input.title.trim().length === 0) {
    errors.push({ field: 'title', message: 'Title cannot be empty if provided', code: 'INVALID_VALUE' });
  }

  if (input.currentDraft !== undefined && input.currentDraft.trim().length === 0) {
    errors.push({ field: 'currentDraft', message: 'Current draft cannot be empty if provided', code: 'INVALID_VALUE' });
  }

  if (input.status !== undefined && !isValidContentStatus(input.status)) {
    errors.push({ field: 'status', message: 'Valid content status is required', code: 'INVALID_STATUS' });
  }

  return { isValid: errors.length === 0, errors };
};

// AgentMessage validation functions
export const validateAgentMessage = (message: AgentMessage): ValidationResult => {
  const errors: ValidationError[] = [];

  if (!message.id || !isValidUUID(message.id)) {
    errors.push({ field: 'id', message: 'Valid UUID is required', code: 'INVALID_UUID' });
  }

  if (!message.contentId || !isValidUUID(message.contentId)) {
    errors.push({ field: 'contentId', message: 'Valid content UUID is required', code: 'INVALID_UUID' });
  }

  if (!isValidAgentType(message.agentType)) {
    errors.push({ field: 'agentType', message: 'Valid agent type is required', code: 'INVALID_AGENT_TYPE' });
  }

  if (!isValidMessageType(message.messageType)) {
    errors.push({ field: 'messageType', message: 'Valid message type is required', code: 'INVALID_MESSAGE_TYPE' });
  }

  if (!isValidMessageStatus(message.status)) {
    errors.push({ field: 'status', message: 'Valid message status is required', code: 'INVALID_STATUS' });
  }

  if (message.payload === undefined || message.payload === null) {
    errors.push({ field: 'payload', message: 'Payload is required', code: 'REQUIRED_FIELD' });
  }

  if (!isValidDate(message.createdAt)) {
    errors.push({ field: 'createdAt', message: 'Valid creation date is required', code: 'INVALID_DATE' });
  }

  if (message.processedAt && !isValidDate(message.processedAt)) {
    errors.push({ field: 'processedAt', message: 'Valid processed date is required if provided', code: 'INVALID_DATE' });
  }

  return { isValid: errors.length === 0, errors };
};

export const validateAgentMessageCreateInput = (input: AgentMessageCreateInput): ValidationResult => {
  const errors: ValidationError[] = [];

  if (!input.contentId || !isValidUUID(input.contentId)) {
    errors.push({ field: 'contentId', message: 'Valid content UUID is required', code: 'INVALID_UUID' });
  }

  if (!isValidAgentType(input.agentType)) {
    errors.push({ field: 'agentType', message: 'Valid agent type is required', code: 'INVALID_AGENT_TYPE' });
  }

  if (!isValidMessageType(input.messageType)) {
    errors.push({ field: 'messageType', message: 'Valid message type is required', code: 'INVALID_MESSAGE_TYPE' });
  }

  if (input.payload === undefined || input.payload === null) {
    errors.push({ field: 'payload', message: 'Payload is required', code: 'REQUIRED_FIELD' });
  }

  return { isValid: errors.length === 0, errors };
};

export const validateAgentMessageUpdateInput = (input: AgentMessageUpdateInput): ValidationResult => {
  const errors: ValidationError[] = [];

  if (input.status !== undefined && !isValidMessageStatus(input.status)) {
    errors.push({ field: 'status', message: 'Valid message status is required', code: 'INVALID_STATUS' });
  }

  if (input.processedAt !== undefined && !isValidDate(input.processedAt)) {
    errors.push({ field: 'processedAt', message: 'Valid processed date is required if provided', code: 'INVALID_DATE' });
  }

  return { isValid: errors.length === 0, errors };
};

// PlatformConnection validation functions
export const validatePlatformConnection = (connection: PlatformConnection): ValidationResult => {
  const errors: ValidationError[] = [];

  if (!isValidPlatform(connection.platform)) {
    errors.push({ field: 'platform', message: 'Valid platform is required', code: 'INVALID_PLATFORM' });
  }

  if (!connection.credentials || typeof connection.credentials !== 'object') {
    errors.push({ field: 'credentials', message: 'Credentials object is required', code: 'REQUIRED_FIELD' });
  } else {
    if (!connection.credentials.accessToken || connection.credentials.accessToken.trim().length === 0) {
      errors.push({ field: 'credentials.accessToken', message: 'Access token is required', code: 'REQUIRED_FIELD' });
    }
  }

  if (typeof connection.isActive !== 'boolean') {
    errors.push({ field: 'isActive', message: 'isActive must be a boolean', code: 'INVALID_TYPE' });
  }

  if (!connection.configuration || typeof connection.configuration !== 'object') {
    errors.push({ field: 'configuration', message: 'Configuration object is required', code: 'REQUIRED_FIELD' });
  }

  if (!isValidDate(connection.connectedAt)) {
    errors.push({ field: 'connectedAt', message: 'Valid connection date is required', code: 'INVALID_DATE' });
  }

  if (!isValidDate(connection.updatedAt)) {
    errors.push({ field: 'updatedAt', message: 'Valid update date is required', code: 'INVALID_DATE' });
  }

  if (connection.lastUsed && !isValidDate(connection.lastUsed)) {
    errors.push({ field: 'lastUsed', message: 'Valid last used date is required if provided', code: 'INVALID_DATE' });
  }

  return { isValid: errors.length === 0, errors };
};

export const validatePlatformConnectionCreateInput = (input: PlatformConnectionCreateInput): ValidationResult => {
  const errors: ValidationError[] = [];

  if (!isValidPlatform(input.platform)) {
    errors.push({ field: 'platform', message: 'Valid platform is required', code: 'INVALID_PLATFORM' });
  }

  if (!input.credentials || typeof input.credentials !== 'object') {
    errors.push({ field: 'credentials', message: 'Credentials object is required', code: 'REQUIRED_FIELD' });
  } else {
    if (!input.credentials.accessToken || input.credentials.accessToken.trim().length === 0) {
      errors.push({ field: 'credentials.accessToken', message: 'Access token is required', code: 'REQUIRED_FIELD' });
    }
  }

  return { isValid: errors.length === 0, errors };
};

export const validatePlatformConnectionUpdateInput = (input: PlatformConnectionUpdateInput): ValidationResult => {
  const errors: ValidationError[] = [];

  if (input.credentials !== undefined) {
    if (!input.credentials || typeof input.credentials !== 'object') {
      errors.push({ field: 'credentials', message: 'Credentials must be an object if provided', code: 'INVALID_TYPE' });
    } else if (!input.credentials.accessToken || input.credentials.accessToken.trim().length === 0) {
      errors.push({ field: 'credentials.accessToken', message: 'Access token is required if credentials provided', code: 'REQUIRED_FIELD' });
    }
  }

  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
    errors.push({ field: 'isActive', message: 'isActive must be a boolean if provided', code: 'INVALID_TYPE' });
  }

  if (input.lastUsed !== undefined && !isValidDate(input.lastUsed)) {
    errors.push({ field: 'lastUsed', message: 'Valid last used date is required if provided', code: 'INVALID_DATE' });
  }

  return { isValid: errors.length === 0, errors };
};