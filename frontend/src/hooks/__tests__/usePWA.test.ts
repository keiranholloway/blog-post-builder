import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import usePWA from '../usePWA';

// Mock services
const mockPWAService = {
  isAppInstallable: vi.fn().mockReturnValue(false),
  isAppInstalled: vi.fn().mockReturnValue(false),
  isUpdateAvailable: vi.fn().mockReturnValue(false),
  isOnline: vi.fn().mockReturnValue(true),
  installApp: vi.fn().mockResolvedValue(true),
  updateApp: vi.fn().mockResolvedValue(undefined),
  onOnlineStatusChange: vi.fn().mockReturnValue(() => {}),
  clearCache: vi.fn().mockResolvedValue(undefined),
  getCacheSize: vi.fn().mockResolvedValue(1024)
};

const mockNotificationService = {
  hasPermission: vi.fn().mockReturnValue(false),
  requestPermission: vi.fn().mockResolvedValue(true)
};

const mockBackgroundSyncService = {
  getQueueLength: vi.fn().mockReturnValue(0),
  clearQueue: vi.fn()
};

vi.mock('../../services/pwaService', () => ({
  default: mockPWAService
}));

vi.mock('../../services/notificationService', () => ({
  default: mockNotificationService
}));

vi.mock('../../services/backgroundSyncService', () => ({
  default: mockBackgroundSyncService
}));

// Mock window events
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
  
  // Reset default mock values
  mockPWAService.isAppInstallable.mockReturnValue(false);
  mockPWAService.isAppInstalled.mockReturnValue(false);
  mockPWAService.isUpdateAvailable.mockReturnValue(false);
  mockPWAService.isOnline.mockReturnValue(true);
  mockNotificationService.hasPermission.mockReturnValue(false);
  mockBackgroundSyncService.getQueueLength.mockReturnValue(0);
});

describe('usePWA', () => {
  describe('Initial State', () => {
    it('should initialize with correct default state', () => {
      const { result } = renderHook(() => usePWA());
      
      expect(result.current.isInstallable).toBe(false);
      expect(result.current.isInstalled).toBe(false);
      expect(result.current.isUpdateAvailable).toBe(false);
      expect(result.current.isOnline).toBe(true);
      expect(result.current.hasNotificationPermission).toBe(false);
      expect(result.current.queueLength).toBe(0);
    });

    it('should initialize with service values', () => {
      mockPWAService.isAppInstallable.mockReturnValue(true);
      mockPWAService.isAppInstalled.mockReturnValue(true);
      mockPWAService.isUpdateAvailable.mockReturnValue(true);
      mockPWAService.isOnline.mockReturnValue(false);
      mockNotificationService.hasPermission.mockReturnValue(true);
      mockBackgroundSyncService.getQueueLength.mockReturnValue(3);
      
      const { result } = renderHook(() => usePWA());
      
      expect(result.current.isInstallable).toBe(true);
      expect(result.current.isInstalled).toBe(true);
      expect(result.current.isUpdateAvailable).toBe(true);
      expect(result.current.isOnline).toBe(false);
      expect(result.current.hasNotificationPermission).toBe(true);
      expect(result.current.queueLength).toBe(3);
    });
  });

  describe('Event Listeners', () => {
    it('should set up PWA event listeners', () => {
      renderHook(() => usePWA());
      
      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        'pwa-install-available',
        expect.any(Function)
      );
      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        'pwa-update-available',
        expect.any(Function)
      );
    });

    it('should set up online status change listener', () => {
      renderHook(() => usePWA());
      
      expect(mockPWAService.onOnlineStatusChange).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it('should cleanup event listeners on unmount', () => {
      const cleanup = vi.fn();
      mockPWAService.onOnlineStatusChange.mockReturnValue(cleanup);
      
      const { unmount } = renderHook(() => usePWA());
      
      unmount();
      
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
        'pwa-install-available',
        expect.any(Function)
      );
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
        'pwa-update-available',
        expect.any(Function)
      );
      expect(cleanup).toHaveBeenCalled();
    });
  });

  describe('PWA Actions', () => {
    it('should handle app installation', async () => {
      const { result } = renderHook(() => usePWA());
      
      await act(async () => {
        const success = await result.current.installApp();
        expect(success).toBe(true);
      });
      
      expect(mockPWAService.installApp).toHaveBeenCalled();
      expect(result.current.isInstallable).toBe(false);
      expect(result.current.isInstalled).toBe(true);
    });

    it('should handle app installation failure', async () => {
      mockPWAService.installApp.mockResolvedValue(false);
      
      const { result } = renderHook(() => usePWA());
      
      await act(async () => {
        const success = await result.current.installApp();
        expect(success).toBe(false);
      });
      
      expect(mockPWAService.installApp).toHaveBeenCalled();
      // State should not change on failure
      expect(result.current.isInstallable).toBe(false);
      expect(result.current.isInstalled).toBe(false);
    });

    it('should handle app update', async () => {
      const { result } = renderHook(() => usePWA());
      
      await act(async () => {
        await result.current.updateApp();
      });
      
      expect(mockPWAService.updateApp).toHaveBeenCalled();
      expect(result.current.isUpdateAvailable).toBe(false);
    });

    it('should handle notification permission request', async () => {
      const { result } = renderHook(() => usePWA());
      
      await act(async () => {
        const granted = await result.current.requestNotificationPermission();
        expect(granted).toBe(true);
      });
      
      expect(mockNotificationService.requestPermission).toHaveBeenCalled();
      expect(result.current.hasNotificationPermission).toBe(true);
    });

    it('should handle cache clearing', async () => {
      const { result } = renderHook(() => usePWA());
      
      await act(async () => {
        await result.current.clearCache();
      });
      
      expect(mockPWAService.clearCache).toHaveBeenCalled();
    });

    it('should get cache size', async () => {
      const { result } = renderHook(() => usePWA());
      
      await act(async () => {
        const size = await result.current.getCacheSize();
        expect(size).toBe(1024);
      });
      
      expect(mockPWAService.getCacheSize).toHaveBeenCalled();
    });

    it('should clear sync queue', () => {
      const { result } = renderHook(() => usePWA());
      
      act(() => {
        result.current.clearSyncQueue();
      });
      
      expect(mockBackgroundSyncService.clearQueue).toHaveBeenCalled();
      expect(result.current.queueLength).toBe(0);
    });
  });

  describe('State Updates', () => {
    it('should update state on install available event', () => {
      const { result } = renderHook(() => usePWA());
      
      // Simulate install available event
      const eventHandler = mockWindow.addEventListener.mock.calls.find(
        call => call[0] === 'pwa-install-available'
      )?.[1];
      
      act(() => {
        if (eventHandler) {
          eventHandler();
        }
      });
      
      expect(result.current.isInstallable).toBe(true);
    });

    it('should update state on update available event', () => {
      const { result } = renderHook(() => usePWA());
      
      // Simulate update available event
      const eventHandler = mockWindow.addEventListener.mock.calls.find(
        call => call[0] === 'pwa-update-available'
      )?.[1];
      
      act(() => {
        if (eventHandler) {
          eventHandler();
        }
      });
      
      expect(result.current.isUpdateAvailable).toBe(true);
    });

    it('should update state on online status change', () => {
      let statusCallback: ((isOnline: boolean) => void) | null = null;
      
      mockPWAService.onOnlineStatusChange.mockImplementation((callback) => {
        statusCallback = callback;
        return () => {};
      });
      
      const { result } = renderHook(() => usePWA());
      
      act(() => {
        if (statusCallback) {
          statusCallback(false);
        }
      });
      
      expect(result.current.isOnline).toBe(false);
      
      act(() => {
        if (statusCallback) {
          statusCallback(true);
        }
      });
      
      expect(result.current.isOnline).toBe(true);
    });
  });

  describe('Queue Length Monitoring', () => {
    it('should periodically check queue length', async () => {
      vi.useFakeTimers();
      
      renderHook(() => usePWA());
      
      // Fast-forward time to trigger interval
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      
      expect(mockBackgroundSyncService.getQueueLength).toHaveBeenCalled();
      
      vi.useRealTimers();
    });

    it('should update queue length when it changes', () => {
      vi.useFakeTimers();
      
      const { result } = renderHook(() => usePWA());
      
      // Change queue length
      mockBackgroundSyncService.getQueueLength.mockReturnValue(2);
      
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      
      expect(result.current.queueLength).toBe(2);
      
      vi.useRealTimers();
    });
  });
});