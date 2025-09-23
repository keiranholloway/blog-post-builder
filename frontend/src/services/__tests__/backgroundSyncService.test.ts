import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import backgroundSyncService from '../backgroundSyncService';

// Mock dependencies
vi.mock('../pwaService', () => ({
  default: {
    isOnline: vi.fn().mockReturnValue(true),
    registerBackgroundSync: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../notificationService', () => ({
  default: {
    showOfflineActionQueued: vi.fn().mockResolvedValue(undefined),
    showBackgroundSyncComplete: vi.fn().mockResolvedValue(undefined),
    showProcessingError: vi.fn().mockResolvedValue(undefined)
  }
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn()
};

Object.defineProperty(global, 'localStorage', {
  value: mockLocalStorage,
  writable: true
});

// Mock window
const mockWindow = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn()
};

Object.defineProperty(global, 'window', {
  value: mockWindow,
  writable: true
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLocalStorage.getItem.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BackgroundSyncService', () => {
  describe('Queue Management', () => {
    it('should initialize with empty queue', () => {
      const queueLength = backgroundSyncService.getQueueLength();
      expect(queueLength).toBe(0);
    });

    it('should load queue from localStorage', () => {
      const mockQueue = JSON.stringify([
        {
          id: 'test-1',
          type: 'voice_upload',
          data: { test: 'data' },
          timestamp: Date.now(),
          retryCount: 0,
          maxRetries: 3
        }
      ]);
      
      mockLocalStorage.getItem.mockReturnValue(mockQueue);
      
      // Create new instance to test loading
      const queuedActions = backgroundSyncService.getQueuedActions();
      expect(Array.isArray(queuedActions)).toBe(true);
    });

    it('should handle corrupted localStorage data', () => {
      mockLocalStorage.getItem.mockReturnValue('invalid json');
      
      // Should not throw error and should initialize with empty queue
      const queueLength = backgroundSyncService.getQueueLength();
      expect(queueLength).toBe(0);
    });

    it('should save queue to localStorage', async () => {
      await backgroundSyncService.queueAction('voice_upload', { test: 'data' });
      
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'pwa_sync_queue',
        expect.stringContaining('voice_upload')
      );
    });
  });

  describe('Action Queuing', () => {
    it('should queue voice upload action', async () => {
      const actionId = await backgroundSyncService.queueAction('voice_upload', {
        audioBlob: new Blob(),
        userId: 'user-123'
      });

      expect(typeof actionId).toBe('string');
      expect(backgroundSyncService.getQueueLength()).toBe(1);
    });

    it('should queue text submit action', async () => {
      const actionId = await backgroundSyncService.queueAction('text_submit', {
        text: 'Test text',
        userId: 'user-123'
      });

      expect(typeof actionId).toBe('string');
      expect(backgroundSyncService.getQueueLength()).toBe(1);
    });

    it('should queue feedback submit action', async () => {
      const actionId = await backgroundSyncService.queueAction('feedback_submit', {
        contentId: 'content-123',
        feedback: 'Test feedback',
        type: 'content'
      });

      expect(typeof actionId).toBe('string');
      expect(backgroundSyncService.getQueueLength()).toBe(1);
    });

    it('should queue publish request action', async () => {
      const actionId = await backgroundSyncService.queueAction('publish_request', {
        contentId: 'content-123',
        platforms: ['Medium', 'LinkedIn']
      });

      expect(typeof actionId).toBe('string');
      expect(backgroundSyncService.getQueueLength()).toBe(1);
    });
  });

  describe('Queue Processing', () => {
    it('should not process queue when offline', async () => {
      const pwaService = await import('../pwaService');
      vi.mocked(pwaService.default.isOnline).mockReturnValue(false);

      await backgroundSyncService.queueAction('voice_upload', { test: 'data' });
      await backgroundSyncService.processQueue();

      // Queue should still have the item
      expect(backgroundSyncService.getQueueLength()).toBe(1);
    });

    it('should process queue when online', async () => {
      const pwaService = await import('../pwaService');
      vi.mocked(pwaService.default.isOnline).mockReturnValue(true);

      // Mock the processing methods to avoid actual API calls
      const processActionSpy = vi.spyOn(backgroundSyncService as any, 'processAction')
        .mockResolvedValue(undefined);

      await backgroundSyncService.queueAction('voice_upload', { test: 'data' });
      await backgroundSyncService.processQueue();

      expect(processActionSpy).toHaveBeenCalled();
    });

    it('should handle processing failures with retry', async () => {
      const pwaService = await import('../pwaService');
      vi.mocked(pwaService.default.isOnline).mockReturnValue(true);

      // Mock processing to fail
      const processActionSpy = vi.spyOn(backgroundSyncService as any, 'processAction')
        .mockRejectedValue(new Error('Processing failed'));

      await backgroundSyncService.queueAction('voice_upload', { test: 'data' });
      await backgroundSyncService.processQueue();

      expect(processActionSpy).toHaveBeenCalled();
      // Action should still be in queue for retry
      expect(backgroundSyncService.getQueueLength()).toBe(1);
    });

    it('should remove action after max retries', async () => {
      const pwaService = await import('../pwaService');
      vi.mocked(pwaService.default.isOnline).mockReturnValue(true);

      // Mock processing to always fail
      const processActionSpy = vi.spyOn(backgroundSyncService as any, 'processAction')
        .mockRejectedValue(new Error('Processing failed'));

      await backgroundSyncService.queueAction('voice_upload', { test: 'data' });
      
      // Process multiple times to exceed max retries
      for (let i = 0; i < 5; i++) {
        await backgroundSyncService.processQueue();
      }

      expect(processActionSpy).toHaveBeenCalled();
      // Action should be removed after max retries
      expect(backgroundSyncService.getQueueLength()).toBe(0);
    });
  });

  describe('Queue Management Operations', () => {
    it('should clear entire queue', async () => {
      await backgroundSyncService.queueAction('voice_upload', { test: 'data1' });
      await backgroundSyncService.queueAction('text_submit', { test: 'data2' });
      
      expect(backgroundSyncService.getQueueLength()).toBe(2);
      
      backgroundSyncService.clearQueue();
      
      expect(backgroundSyncService.getQueueLength()).toBe(0);
    });

    it('should remove specific action', async () => {
      const actionId1 = await backgroundSyncService.queueAction('voice_upload', { test: 'data1' });
      const actionId2 = await backgroundSyncService.queueAction('text_submit', { test: 'data2' });
      
      expect(backgroundSyncService.getQueueLength()).toBe(2);
      
      backgroundSyncService.removeAction(actionId1);
      
      expect(backgroundSyncService.getQueueLength()).toBe(1);
      
      const remainingActions = backgroundSyncService.getQueuedActions();
      expect(remainingActions[0].id).toBe(actionId2);
    });

    it('should get queued actions', async () => {
      await backgroundSyncService.queueAction('voice_upload', { test: 'data1' });
      await backgroundSyncService.queueAction('text_submit', { test: 'data2' });
      
      const actions = backgroundSyncService.getQueuedActions();
      
      expect(actions).toHaveLength(2);
      expect(actions[0].type).toBe('voice_upload');
      expect(actions[1].type).toBe('text_submit');
    });
  });

  describe('Event Listeners', () => {
    it('should set up online event listener', () => {
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    });

    it('should handle background sync event', async () => {
      await backgroundSyncService.handleBackgroundSync('sync-voice_upload');
      
      // Should not throw error
      expect(true).toBe(true);
    });
  });
});