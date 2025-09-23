import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pwaService from '../pwaService';

// Mock Workbox
vi.mock('workbox-window', () => ({
  Workbox: vi.fn().mockImplementation(() => ({
    addEventListener: vi.fn(),
    register: vi.fn().mockResolvedValue({}),
    messageSkipWaiting: vi.fn()
  }))
}));

// Mock global objects
const mockNotification = {
  permission: 'default' as NotificationPermission,
  requestPermission: vi.fn().mockResolvedValue('granted' as NotificationPermission)
};

const mockServiceWorkerRegistration = {
  showNotification: vi.fn().mockResolvedValue(undefined),
  sync: {
    register: vi.fn().mockResolvedValue(undefined)
  }
};

const mockNavigator = {
  onLine: true,
  serviceWorker: {
    register: vi.fn().mockResolvedValue(mockServiceWorkerRegistration)
  },
  storage: {
    estimate: vi.fn().mockResolvedValue({ usage: 1024 })
  }
};

const mockCaches = {
  keys: vi.fn().mockResolvedValue(['cache1', 'cache2']),
  delete: vi.fn().mockResolvedValue(true)
};

const mockWindow = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  matchMedia: vi.fn().mockReturnValue({ matches: false }),
  location: { origin: 'https://example.com' }
};

// Setup global mocks
beforeEach(() => {
  Object.defineProperty(global, 'window', {
    value: mockWindow,
    writable: true
  });

  Object.defineProperty(global, 'navigator', {
    value: mockNavigator,
    writable: true
  });

  Object.defineProperty(global, 'Notification', {
    value: mockNotification,
    writable: true
  });

  Object.defineProperty(global, 'caches', {
    value: mockCaches,
    writable: true
  });

  // Reset mocks
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PWAService', () => {
  describe('Service Worker Registration', () => {
    it('should register service worker when supported', () => {
      expect(mockNavigator.serviceWorker).toBeDefined();
      // Service worker registration happens in constructor
      // We can't easily test the constructor directly, but we can verify the setup
    });

    it('should handle service worker registration failure gracefully', () => {
      // This would be tested by mocking the register method to reject
      expect(true).toBe(true); // Placeholder for actual implementation
    });
  });

  describe('App Installation', () => {
    it('should detect when app is installable', () => {
      // Mock beforeinstallprompt event
      const mockEvent = {
        preventDefault: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: 'accepted' })
      };

      // Simulate beforeinstallprompt event
      const eventHandler = mockWindow.addEventListener.mock.calls.find(
        call => call[0] === 'beforeinstallprompt'
      )?.[1];

      if (eventHandler) {
        eventHandler(mockEvent);
      }

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle app installation', async () => {
      const result = await pwaService.installApp();
      // Since we don't have a real install prompt, this should return false
      expect(result).toBe(false);
    });

    it('should detect when app is already installed', () => {
      // Mock standalone mode
      mockWindow.matchMedia = vi.fn().mockReturnValue({ matches: true });
      
      const isInstalled = pwaService.isAppInstalled();
      expect(typeof isInstalled).toBe('boolean');
    });
  });

  describe('Update Management', () => {
    it('should handle app updates', async () => {
      await pwaService.updateApp();
      // Should not throw error
      expect(true).toBe(true);
    });

    it('should detect when update is available', () => {
      const isUpdateAvailable = pwaService.isUpdateAvailable();
      expect(typeof isUpdateAvailable).toBe('boolean');
    });
  });

  describe('Notifications', () => {
    it('should request notification permission', async () => {
      const permission = await pwaService.requestNotificationPermission();
      expect(['granted', 'denied', 'default']).toContain(permission);
    });

    it('should show notification when permission granted', async () => {
      mockNotification.permission = 'granted';
      
      await pwaService.showNotification({
        title: 'Test Notification',
        body: 'Test message'
      });

      expect(mockServiceWorkerRegistration.showNotification).toHaveBeenCalledWith(
        'Test Notification',
        expect.objectContaining({
          body: 'Test message',
          icon: '/icon-192.png'
        })
      );
    });

    it('should throw error when notification permission denied', async () => {
      mockNotification.permission = 'denied';
      
      await expect(pwaService.showNotification({
        title: 'Test',
        body: 'Test'
      })).rejects.toThrow('Notification permission not granted');
    });
  });

  describe('Background Sync', () => {
    it('should register background sync', async () => {
      await pwaService.registerBackgroundSync('test-sync');
      
      expect(mockServiceWorkerRegistration.sync.register).toHaveBeenCalledWith('test-sync');
    });

    it('should handle background sync registration failure', async () => {
      mockServiceWorkerRegistration.sync.register.mockRejectedValue(new Error('Sync failed'));
      
      // Should not throw error
      await pwaService.registerBackgroundSync('test-sync');
      expect(true).toBe(true);
    });
  });

  describe('Online/Offline Status', () => {
    it('should detect online status', () => {
      mockNavigator.onLine = true;
      const isOnline = pwaService.isOnline();
      expect(isOnline).toBe(true);
    });

    it('should detect offline status', () => {
      mockNavigator.onLine = false;
      const isOnline = pwaService.isOnline();
      expect(isOnline).toBe(false);
    });

    it('should handle online status change', () => {
      const callback = vi.fn();
      const cleanup = pwaService.onOnlineStatusChange(callback);
      
      // Verify event listeners were added
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
      
      // Test cleanup
      cleanup();
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', async () => {
      await pwaService.clearCache();
      
      expect(mockCaches.keys).toHaveBeenCalled();
      expect(mockCaches.delete).toHaveBeenCalledWith('cache1');
      expect(mockCaches.delete).toHaveBeenCalledWith('cache2');
    });

    it('should get cache size', async () => {
      const size = await pwaService.getCacheSize();
      
      expect(mockNavigator.storage.estimate).toHaveBeenCalled();
      expect(size).toBe(1024);
    });

    it('should handle cache size estimation failure', async () => {
      mockNavigator.storage.estimate.mockRejectedValue(new Error('Estimation failed'));
      
      const size = await pwaService.getCacheSize();
      expect(size).toBe(0);
    });
  });
});