import { describe, it, expect } from 'vitest';
import {
  validateUser,
  validateUserCreateInput,
  validateUserUpdateInput,
  validateBlogContent,
  validateBlogContentCreateInput,
  validateBlogContentUpdateInput,
  validateAgentMessage,
  validateAgentMessageCreateInput,
  validateAgentMessageUpdateInput,
  validatePlatformConnection,
  validatePlatformConnectionCreateInput,
  validatePlatformConnectionUpdateInput
} from '../validation';
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
  PlatformConnectionUpdateInput
} from '../../types';

// Test data helpers
const createValidUser = (): User => ({
  id: '123e4567-e89b-12d3-a456-426614174000',
  email: 'test@example.com',
  writingStyleContext: 'Professional and informative writing style',
  connectedPlatforms: [],
  preferences: {
    defaultPlatforms: ['medium'],
    autoPublish: false,
    imageGenerationEnabled: true,
    voiceInputEnabled: true,
    theme: 'auto'
  },
  createdAt: new Date(),
  updatedAt: new Date()
});

const createValidBlogContent = (): BlogContent => ({
  id: '123e4567-e89b-12d3-a456-426614174001',
  userId: '123e4567-e89b-12d3-a456-426614174000',
  title: 'Test Blog Post',
  originalTranscription: 'This is a test transcription',
  currentDraft: 'This is the current draft',
  status: 'draft',
  revisionHistory: [],
  publishingResults: [],
  createdAt: new Date(),
  updatedAt: new Date()
});

const createValidAgentMessage = (): AgentMessage => ({
  id: '123e4567-e89b-12d3-a456-426614174002',
  contentId: '123e4567-e89b-12d3-a456-426614174001',
  agentType: 'content',
  messageType: 'generate_content',
  payload: { transcription: 'test', userContext: 'test' },
  status: 'pending',
  createdAt: new Date()
});

const createValidPlatformConnection = (): PlatformConnection => ({
  platform: 'medium',
  credentials: {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token'
  },
  isActive: true,
  configuration: {
    autoPublish: false,
    defaultTags: [],
    customSettings: {}
  },
  connectedAt: new Date(),
  updatedAt: new Date()
});

describe('User Validation', () => {
  describe('validateUser', () => {
    it('should validate a valid user', () => {
      const user = createValidUser();
      const result = validateUser(user);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject user with invalid UUID', () => {
      const user = createValidUser();
      user.id = 'invalid-uuid';
      const result = validateUser(user);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'id',
        message: 'Valid UUID is required',
        code: 'INVALID_UUID'
      });
    });

    it('should reject user with invalid email', () => {
      const user = createValidUser();
      user.email = 'invalid-email';
      const result = validateUser(user);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'email',
        message: 'Valid email address is required',
        code: 'INVALID_EMAIL'
      });
    });

    it('should reject user with empty writing style context', () => {
      const user = createValidUser();
      user.writingStyleContext = '';
      const result = validateUser(user);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'writingStyleContext',
        message: 'Writing style context is required',
        code: 'REQUIRED_FIELD'
      });
    });

    it('should reject user with invalid dates', () => {
      const user = createValidUser();
      user.createdAt = new Date('invalid');
      const result = validateUser(user);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'createdAt')).toBe(true);
    });
  });

  describe('validateUserCreateInput', () => {
    it('should validate valid create input', () => {
      const input: UserCreateInput = {
        email: 'test@example.com',
        writingStyleContext: 'Test style'
      };
      const result = validateUserCreateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid email', () => {
      const input: UserCreateInput = {
        email: 'invalid-email'
      };
      const result = validateUserCreateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'email',
        message: 'Valid email address is required',
        code: 'INVALID_EMAIL'
      });
    });

    it('should reject empty writing style context if provided', () => {
      const input: UserCreateInput = {
        email: 'test@example.com',
        writingStyleContext: ''
      };
      const result = validateUserCreateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'writingStyleContext',
        message: 'Writing style context cannot be empty if provided',
        code: 'INVALID_VALUE'
      });
    });
  });

  describe('validateUserUpdateInput', () => {
    it('should validate valid update input', () => {
      const input: UserUpdateInput = {
        writingStyleContext: 'Updated style'
      };
      const result = validateUserUpdateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate empty update input', () => {
      const input: UserUpdateInput = {};
      const result = validateUserUpdateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty writing style context if provided', () => {
      const input: UserUpdateInput = {
        writingStyleContext: ''
      };
      const result = validateUserUpdateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'writingStyleContext',
        message: 'Writing style context cannot be empty if provided',
        code: 'INVALID_VALUE'
      });
    });
  });
});

describe('BlogContent Validation', () => {
  describe('validateBlogContent', () => {
    it('should validate a valid blog content', () => {
      const content = createValidBlogContent();
      const result = validateBlogContent(content);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject content with invalid UUID', () => {
      const content = createValidBlogContent();
      content.id = 'invalid-uuid';
      const result = validateBlogContent(content);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'id',
        message: 'Valid UUID is required',
        code: 'INVALID_UUID'
      });
    });

    it('should reject content with invalid user UUID', () => {
      const content = createValidBlogContent();
      content.userId = 'invalid-uuid';
      const result = validateBlogContent(content);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'userId',
        message: 'Valid user UUID is required',
        code: 'INVALID_UUID'
      });
    });

    it('should reject content with empty transcription', () => {
      const content = createValidBlogContent();
      content.originalTranscription = '';
      const result = validateBlogContent(content);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'originalTranscription',
        message: 'Original transcription is required',
        code: 'REQUIRED_FIELD'
      });
    });

    it('should reject content with invalid status', () => {
      const content = createValidBlogContent();
      (content as any).status = 'invalid-status';
      const result = validateBlogContent(content);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'status',
        message: 'Valid content status is required',
        code: 'INVALID_STATUS'
      });
    });
  });

  describe('validateBlogContentCreateInput', () => {
    it('should validate valid create input', () => {
      const input: BlogContentCreateInput = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        originalTranscription: 'Test transcription',
        title: 'Test Title'
      };
      const result = validateBlogContentCreateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid user UUID', () => {
      const input: BlogContentCreateInput = {
        userId: 'invalid-uuid',
        originalTranscription: 'Test transcription'
      };
      const result = validateBlogContentCreateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'userId',
        message: 'Valid user UUID is required',
        code: 'INVALID_UUID'
      });
    });

    it('should reject empty transcription', () => {
      const input: BlogContentCreateInput = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        originalTranscription: ''
      };
      const result = validateBlogContentCreateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'originalTranscription',
        message: 'Original transcription is required',
        code: 'REQUIRED_FIELD'
      });
    });
  });

  describe('validateBlogContentUpdateInput', () => {
    it('should validate valid update input', () => {
      const input: BlogContentUpdateInput = {
        title: 'Updated Title',
        currentDraft: 'Updated draft',
        status: 'ready_for_review'
      };
      const result = validateBlogContentUpdateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate empty update input', () => {
      const input: BlogContentUpdateInput = {};
      const result = validateBlogContentUpdateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty title if provided', () => {
      const input: BlogContentUpdateInput = {
        title: ''
      };
      const result = validateBlogContentUpdateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'title',
        message: 'Title cannot be empty if provided',
        code: 'INVALID_VALUE'
      });
    });

    it('should reject invalid status', () => {
      const input: BlogContentUpdateInput = {
        status: 'invalid-status' as any
      };
      const result = validateBlogContentUpdateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'status',
        message: 'Valid content status is required',
        code: 'INVALID_STATUS'
      });
    });
  });
});

describe('AgentMessage Validation', () => {
  describe('validateAgentMessage', () => {
    it('should validate a valid agent message', () => {
      const message = createValidAgentMessage();
      const result = validateAgentMessage(message);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject message with invalid UUID', () => {
      const message = createValidAgentMessage();
      message.id = 'invalid-uuid';
      const result = validateAgentMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'id',
        message: 'Valid UUID is required',
        code: 'INVALID_UUID'
      });
    });

    it('should reject message with invalid content UUID', () => {
      const message = createValidAgentMessage();
      message.contentId = 'invalid-uuid';
      const result = validateAgentMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'contentId',
        message: 'Valid content UUID is required',
        code: 'INVALID_UUID'
      });
    });

    it('should reject message with invalid agent type', () => {
      const message = createValidAgentMessage();
      (message as any).agentType = 'invalid-type';
      const result = validateAgentMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'agentType',
        message: 'Valid agent type is required',
        code: 'INVALID_AGENT_TYPE'
      });
    });

    it('should reject message with invalid message type', () => {
      const message = createValidAgentMessage();
      (message as any).messageType = 'invalid-type';
      const result = validateAgentMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'messageType',
        message: 'Valid message type is required',
        code: 'INVALID_MESSAGE_TYPE'
      });
    });

    it('should reject message with null payload', () => {
      const message = createValidAgentMessage();
      message.payload = null;
      const result = validateAgentMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'payload',
        message: 'Payload is required',
        code: 'REQUIRED_FIELD'
      });
    });
  });

  describe('validateAgentMessageCreateInput', () => {
    it('should validate valid create input', () => {
      const input: AgentMessageCreateInput = {
        contentId: '123e4567-e89b-12d3-a456-426614174001',
        agentType: 'content',
        messageType: 'generate_content',
        payload: { test: 'data' }
      };
      const result = validateAgentMessageCreateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid content UUID', () => {
      const input: AgentMessageCreateInput = {
        contentId: 'invalid-uuid',
        agentType: 'content',
        messageType: 'generate_content',
        payload: { test: 'data' }
      };
      const result = validateAgentMessageCreateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'contentId',
        message: 'Valid content UUID is required',
        code: 'INVALID_UUID'
      });
    });
  });

  describe('validateAgentMessageUpdateInput', () => {
    it('should validate valid update input', () => {
      const input: AgentMessageUpdateInput = {
        status: 'completed',
        processedAt: new Date()
      };
      const result = validateAgentMessageUpdateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate empty update input', () => {
      const input: AgentMessageUpdateInput = {};
      const result = validateAgentMessageUpdateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid status', () => {
      const input: AgentMessageUpdateInput = {
        status: 'invalid-status' as any
      };
      const result = validateAgentMessageUpdateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'status',
        message: 'Valid message status is required',
        code: 'INVALID_STATUS'
      });
    });
  });
});

describe('PlatformConnection Validation', () => {
  describe('validatePlatformConnection', () => {
    it('should validate a valid platform connection', () => {
      const connection = createValidPlatformConnection();
      const result = validatePlatformConnection(connection);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject connection with invalid platform', () => {
      const connection = createValidPlatformConnection();
      (connection as any).platform = 'invalid-platform';
      const result = validatePlatformConnection(connection);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'platform',
        message: 'Valid platform is required',
        code: 'INVALID_PLATFORM'
      });
    });

    it('should reject connection with missing credentials', () => {
      const connection = createValidPlatformConnection();
      (connection as any).credentials = null;
      const result = validatePlatformConnection(connection);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'credentials',
        message: 'Credentials object is required',
        code: 'REQUIRED_FIELD'
      });
    });

    it('should reject connection with missing access token', () => {
      const connection = createValidPlatformConnection();
      connection.credentials.accessToken = '';
      const result = validatePlatformConnection(connection);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'credentials.accessToken',
        message: 'Access token is required',
        code: 'REQUIRED_FIELD'
      });
    });

    it('should reject connection with invalid isActive type', () => {
      const connection = createValidPlatformConnection();
      (connection as any).isActive = 'true';
      const result = validatePlatformConnection(connection);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'isActive',
        message: 'isActive must be a boolean',
        code: 'INVALID_TYPE'
      });
    });

    it('should reject connection with invalid dates', () => {
      const connection = createValidPlatformConnection();
      connection.connectedAt = new Date('invalid');
      const result = validatePlatformConnection(connection);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'connectedAt')).toBe(true);
    });
  });

  describe('validatePlatformConnectionCreateInput', () => {
    it('should validate valid create input', () => {
      const input: PlatformConnectionCreateInput = {
        platform: 'medium',
        credentials: {
          accessToken: 'test-token'
        }
      };
      const result = validatePlatformConnectionCreateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid platform', () => {
      const input: PlatformConnectionCreateInput = {
        platform: 'invalid-platform' as any,
        credentials: {
          accessToken: 'test-token'
        }
      };
      const result = validatePlatformConnectionCreateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'platform',
        message: 'Valid platform is required',
        code: 'INVALID_PLATFORM'
      });
    });

    it('should reject missing access token', () => {
      const input: PlatformConnectionCreateInput = {
        platform: 'medium',
        credentials: {
          accessToken: ''
        }
      };
      const result = validatePlatformConnectionCreateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'credentials.accessToken',
        message: 'Access token is required',
        code: 'REQUIRED_FIELD'
      });
    });
  });

  describe('validatePlatformConnectionUpdateInput', () => {
    it('should validate valid update input', () => {
      const input: PlatformConnectionUpdateInput = {
        isActive: false,
        lastUsed: new Date()
      };
      const result = validatePlatformConnectionUpdateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate empty update input', () => {
      const input: PlatformConnectionUpdateInput = {};
      const result = validatePlatformConnectionUpdateInput(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid isActive type', () => {
      const input: PlatformConnectionUpdateInput = {
        isActive: 'false' as any
      };
      const result = validatePlatformConnectionUpdateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'isActive',
        message: 'isActive must be a boolean if provided',
        code: 'INVALID_TYPE'
      });
    });

    it('should reject invalid credentials if provided', () => {
      const input: PlatformConnectionUpdateInput = {
        credentials: {
          accessToken: ''
        }
      };
      const result = validatePlatformConnectionUpdateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual({
        field: 'credentials.accessToken',
        message: 'Access token is required if credentials provided',
        code: 'REQUIRED_FIELD'
      });
    });
  });
});