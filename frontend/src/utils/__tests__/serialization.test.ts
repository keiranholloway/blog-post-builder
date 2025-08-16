import { describe, it, expect } from 'vitest';
import {
  serializeUser,
  deserializeUser,
  serializeBlogContent,
  deserializeBlogContent,
  serializeAgentMessage,
  deserializeAgentMessage,
  serializePlatformConnection,
  deserializePlatformConnection,
  transformUserCreateInput,
  transformBlogContentCreateInput,
  transformAgentMessageCreateInput,
  transformPlatformConnectionCreateInput,
  sanitizeForApi,
  deepClone,
  omitFields,
  pickFields,
  getNextContentStatus,
  canTransitionStatus
} from '../serialization';
import {
  User,
  BlogContent,
  AgentMessage,
  PlatformConnection,
  UserCreateInput,
  BlogContentCreateInput,
  AgentMessageCreateInput,
  PlatformConnectionCreateInput
} from '../../types';

// Test data helpers
const createTestUser = (): User => ({
  id: '123e4567-e89b-12d3-a456-426614174000',
  email: 'test@example.com',
  writingStyleContext: 'Professional writing style',
  connectedPlatforms: [],
  preferences: {
    defaultPlatforms: ['medium'],
    autoPublish: false,
    imageGenerationEnabled: true,
    voiceInputEnabled: true,
    theme: 'auto'
  },
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z')
});

const createTestBlogContent = (): BlogContent => ({
  id: '123e4567-e89b-12d3-a456-426614174001',
  userId: '123e4567-e89b-12d3-a456-426614174000',
  title: 'Test Blog Post',
  originalTranscription: 'Test transcription',
  currentDraft: 'Test draft',
  status: 'draft',
  revisionHistory: [{
    id: 'rev-1',
    contentId: '123e4567-e89b-12d3-a456-426614174001',
    version: 1,
    content: 'Previous version',
    feedback: 'Test feedback',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    agentType: 'content'
  }],
  publishingResults: [{
    platform: 'medium',
    status: 'success',
    publishedUrl: 'https://medium.com/test',
    publishedAt: new Date('2024-01-01T00:00:00.000Z')
  }],
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z')
});

const createTestAgentMessage = (): AgentMessage => ({
  id: '123e4567-e89b-12d3-a456-426614174002',
  contentId: '123e4567-e89b-12d3-a456-426614174001',
  agentType: 'content',
  messageType: 'generate_content',
  payload: { transcription: 'test', userContext: 'test' },
  status: 'pending',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  processedAt: new Date('2024-01-01T01:00:00.000Z')
});

const createTestPlatformConnection = (): PlatformConnection => ({
  platform: 'medium',
  credentials: {
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    expiresAt: new Date('2024-12-31T23:59:59.000Z')
  },
  isActive: true,
  configuration: {
    autoPublish: false,
    defaultTags: ['test'],
    customSettings: {}
  },
  connectedAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
  lastUsed: new Date('2024-01-03T00:00:00.000Z')
});

describe('Serialization', () => {
  describe('User serialization', () => {
    it('should serialize and deserialize user correctly', () => {
      const user = createTestUser();
      const serialized = serializeUser(user);
      const deserialized = deserializeUser(serialized);

      expect(deserialized).toEqual(user);
      expect(deserialized.createdAt).toBeInstanceOf(Date);
      expect(deserialized.updatedAt).toBeInstanceOf(Date);
    });

    it('should serialize dates as ISO strings', () => {
      const user = createTestUser();
      const serialized = serializeUser(user);

      expect(serialized.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(serialized.updatedAt).toBe('2024-01-02T00:00:00.000Z');
    });
  });

  describe('BlogContent serialization', () => {
    it('should serialize and deserialize blog content correctly', () => {
      const content = createTestBlogContent();
      const serialized = serializeBlogContent(content);
      const deserialized = deserializeBlogContent(serialized);

      expect(deserialized).toEqual(content);
      expect(deserialized.createdAt).toBeInstanceOf(Date);
      expect(deserialized.updatedAt).toBeInstanceOf(Date);
      expect(deserialized.revisionHistory[0].createdAt).toBeInstanceOf(Date);
      expect(deserialized.publishingResults[0].publishedAt).toBeInstanceOf(Date);
    });

    it('should handle empty arrays correctly', () => {
      const content = createTestBlogContent();
      content.revisionHistory = [];
      content.publishingResults = [];
      
      const serialized = serializeBlogContent(content);
      const deserialized = deserializeBlogContent(serialized);

      expect(deserialized.revisionHistory).toEqual([]);
      expect(deserialized.publishingResults).toEqual([]);
    });
  });

  describe('AgentMessage serialization', () => {
    it('should serialize and deserialize agent message correctly', () => {
      const message = createTestAgentMessage();
      const serialized = serializeAgentMessage(message);
      const deserialized = deserializeAgentMessage(serialized);

      expect(deserialized).toEqual(message);
      expect(deserialized.createdAt).toBeInstanceOf(Date);
      expect(deserialized.processedAt).toBeInstanceOf(Date);
    });

    it('should handle undefined processedAt', () => {
      const message = createTestAgentMessage();
      message.processedAt = undefined;
      
      const serialized = serializeAgentMessage(message);
      const deserialized = deserializeAgentMessage(serialized);

      expect(deserialized.processedAt).toBeUndefined();
    });
  });

  describe('PlatformConnection serialization', () => {
    it('should serialize and deserialize platform connection correctly', () => {
      const connection = createTestPlatformConnection();
      const serialized = serializePlatformConnection(connection);
      const deserialized = deserializePlatformConnection(serialized);

      expect(deserialized).toEqual(connection);
      expect(deserialized.connectedAt).toBeInstanceOf(Date);
      expect(deserialized.updatedAt).toBeInstanceOf(Date);
      expect(deserialized.lastUsed).toBeInstanceOf(Date);
      expect(deserialized.credentials.expiresAt).toBeInstanceOf(Date);
    });

    it('should handle undefined optional dates', () => {
      const connection = createTestPlatformConnection();
      connection.lastUsed = undefined;
      connection.credentials.expiresAt = undefined;
      
      const serialized = serializePlatformConnection(connection);
      const deserialized = deserializePlatformConnection(serialized);

      expect(deserialized.lastUsed).toBeUndefined();
      expect(deserialized.credentials.expiresAt).toBeUndefined();
    });
  });
});

describe('Data Transformation', () => {
  describe('transformUserCreateInput', () => {
    it('should add default preferences when not provided', () => {
      const input: UserCreateInput = {
        email: 'test@example.com'
      };
      const transformed = transformUserCreateInput(input);

      expect(transformed.preferences).toEqual({
        defaultPlatforms: [],
        autoPublish: false,
        imageGenerationEnabled: true,
        voiceInputEnabled: true,
        theme: 'auto'
      });
    });

    it('should preserve provided preferences', () => {
      const input: UserCreateInput = {
        email: 'test@example.com',
        preferences: {
          autoPublish: true,
          theme: 'dark'
        }
      };
      const transformed = transformUserCreateInput(input);

      expect(transformed.preferences.autoPublish).toBe(true);
      expect(transformed.preferences.theme).toBe('dark');
    });
  });

  describe('transformBlogContentCreateInput', () => {
    it('should set initial values correctly', () => {
      const input: BlogContentCreateInput = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        originalTranscription: 'Test transcription'
      };
      const transformed = transformBlogContentCreateInput(input);

      expect(transformed.status).toBe('processing');
      expect(transformed.currentDraft).toBe('Test transcription');
      expect(transformed.revisionHistory).toEqual([]);
      expect(transformed.publishingResults).toEqual([]);
    });
  });

  describe('transformAgentMessageCreateInput', () => {
    it('should set initial status to pending', () => {
      const input: AgentMessageCreateInput = {
        contentId: '123e4567-e89b-12d3-a456-426614174001',
        agentType: 'content',
        messageType: 'generate_content',
        payload: { test: 'data' }
      };
      const transformed = transformAgentMessageCreateInput(input);

      expect(transformed.status).toBe('pending');
    });
  });

  describe('transformPlatformConnectionCreateInput', () => {
    it('should set default configuration values', () => {
      const input: PlatformConnectionCreateInput = {
        platform: 'medium',
        credentials: {
          accessToken: 'test-token'
        }
      };
      const transformed = transformPlatformConnectionCreateInput(input);

      expect(transformed.isActive).toBe(true);
      expect(transformed.configuration).toEqual({
        autoPublish: false,
        defaultTags: [],
        customSettings: {}
      });
    });

    it('should preserve provided configuration', () => {
      const input: PlatformConnectionCreateInput = {
        platform: 'medium',
        credentials: {
          accessToken: 'test-token'
        },
        configuration: {
          autoPublish: true,
          defaultTags: ['test']
        }
      };
      const transformed = transformPlatformConnectionCreateInput(input);

      expect(transformed.configuration.autoPublish).toBe(true);
      expect(transformed.configuration.defaultTags).toEqual(['test']);
    });
  });
});

describe('Utility Functions', () => {
  describe('sanitizeForApi', () => {
    it('should remove undefined values', () => {
      const data = {
        name: 'test',
        value: undefined,
        count: 0,
        active: false
      };
      const sanitized = sanitizeForApi(data);

      expect(sanitized).toEqual({
        name: 'test',
        count: 0,
        active: false
      });
      expect('value' in sanitized).toBe(false);
    });
  });

  describe('deepClone', () => {
    it('should create a deep copy of an object', () => {
      const original = {
        name: 'test',
        nested: {
          value: 42,
          array: [1, 2, 3]
        }
      };
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.nested).not.toBe(original.nested);
      expect(cloned.nested.array).not.toBe(original.nested.array);
    });
  });

  describe('omitFields', () => {
    it('should remove specified fields', () => {
      const obj = {
        name: 'test',
        email: 'test@example.com',
        password: 'secret',
        age: 25
      };
      const result = omitFields(obj, ['password', 'age']);

      expect(result).toEqual({
        name: 'test',
        email: 'test@example.com'
      });
    });
  });

  describe('pickFields', () => {
    it('should keep only specified fields', () => {
      const obj = {
        name: 'test',
        email: 'test@example.com',
        password: 'secret',
        age: 25
      };
      const result = pickFields(obj, ['name', 'email']);

      expect(result).toEqual({
        name: 'test',
        email: 'test@example.com'
      });
    });

    it('should handle non-existent fields', () => {
      const obj = {
        name: 'test',
        email: 'test@example.com'
      };
      const result = pickFields(obj, ['name', 'nonexistent']);

      expect(result).toEqual({
        name: 'test'
      });
    });
  });

  describe('getNextContentStatus', () => {
    it('should return correct next status', () => {
      expect(getNextContentStatus('processing')).toBe('draft');
      expect(getNextContentStatus('draft')).toBe('ready_for_review');
      expect(getNextContentStatus('ready_for_review')).toBe('approved');
      expect(getNextContentStatus('revision_requested')).toBe('ready_for_review');
      expect(getNextContentStatus('approved')).toBe('publishing');
      expect(getNextContentStatus('publishing')).toBe('published');
    });

    it('should return same status for unknown status', () => {
      expect(getNextContentStatus('unknown')).toBe('unknown');
    });
  });

  describe('canTransitionStatus', () => {
    it('should allow valid transitions', () => {
      expect(canTransitionStatus('processing', 'draft')).toBe(true);
      expect(canTransitionStatus('processing', 'failed')).toBe(true);
      expect(canTransitionStatus('draft', 'ready_for_review')).toBe(true);
      expect(canTransitionStatus('ready_for_review', 'approved')).toBe(true);
      expect(canTransitionStatus('ready_for_review', 'revision_requested')).toBe(true);
      expect(canTransitionStatus('approved', 'publishing')).toBe(true);
      expect(canTransitionStatus('publishing', 'published')).toBe(true);
      expect(canTransitionStatus('failed', 'processing')).toBe(true);
    });

    it('should reject invalid transitions', () => {
      expect(canTransitionStatus('published', 'draft')).toBe(false);
      expect(canTransitionStatus('processing', 'published')).toBe(false);
      expect(canTransitionStatus('draft', 'published')).toBe(false);
      expect(canTransitionStatus('unknown', 'draft')).toBe(false);
    });
  });
});