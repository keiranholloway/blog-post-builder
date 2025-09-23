import { useState, useEffect, useCallback } from 'react';
import pwaService from '../services/pwaService';
import notificationService from '../services/notificationService';
import backgroundSyncService from '../services/backgroundSyncService';

export interface PWAState {
  isInstallable: boolean;
  isInstalled: boolean;
  isUpdateAvailable: boolean;
  isOnline: boolean;
  hasNotificationPermission: boolean;
  queueLength: number;
}

export interface PWAActions {
  installApp: () => Promise<boolean>;
  updateApp: () => Promise<void>;
  requestNotificationPermission: () => Promise<boolean>;
  clearCache: () => Promise<void>;
  getCacheSize: () => Promise<number>;
  clearSyncQueue: () => void;
}

export const usePWA = () => {
  const [state, setState] = useState<PWAState>({
    isInstallable: false,
    isInstalled: false,
    isUpdateAvailable: false,
    isOnline: true,
    hasNotificationPermission: false,
    queueLength: 0
  });

  // Update state helper
  const updateState = useCallback((updates: Partial<PWAState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // Initialize PWA state
  useEffect(() => {
    const initializePWAState = () => {
      updateState({
        isInstallable: pwaService.isAppInstallable(),
        isInstalled: pwaService.isAppInstalled(),
        isUpdateAvailable: pwaService.isUpdateAvailable(),
        isOnline: pwaService.isOnline(),
        hasNotificationPermission: notificationService.hasPermission(),
        queueLength: backgroundSyncService.getQueueLength()
      });
    };

    initializePWAState();
  }, [updateState]);

  // Listen for PWA events
  useEffect(() => {
    const handleInstallAvailable = () => {
      updateState({ isInstallable: true });
    };

    const handleUpdateAvailable = () => {
      updateState({ isUpdateAvailable: true });
    };

    window.addEventListener('pwa-install-available', handleInstallAvailable);
    window.addEventListener('pwa-update-available', handleUpdateAvailable);

    return () => {
      window.removeEventListener('pwa-install-available', handleInstallAvailable);
      window.removeEventListener('pwa-update-available', handleUpdateAvailable);
    };
  }, [updateState]);

  // Listen for online/offline status
  useEffect(() => {
    const cleanup = pwaService.onOnlineStatusChange((isOnline) => {
      updateState({ isOnline });
    });

    return cleanup;
  }, [updateState]);

  // Monitor sync queue changes
  useEffect(() => {
    const checkQueueLength = () => {
      updateState({ queueLength: backgroundSyncService.getQueueLength() });
    };

    // Check initially
    checkQueueLength();

    // Set up periodic checks (since we don't have events for queue changes)
    const interval = setInterval(checkQueueLength, 5000);

    return () => clearInterval(interval);
  }, [updateState]);

  // PWA Actions
  const installApp = useCallback(async (): Promise<boolean> => {
    const success = await pwaService.installApp();
    if (success) {
      updateState({ isInstallable: false, isInstalled: true });
    }
    return success;
  }, [updateState]);

  const updateApp = useCallback(async (): Promise<void> => {
    await pwaService.updateApp();
    updateState({ isUpdateAvailable: false });
  }, [updateState]);

  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    const granted = await notificationService.requestPermission();
    updateState({ hasNotificationPermission: granted });
    return granted;
  }, [updateState]);

  const clearCache = useCallback(async (): Promise<void> => {
    await pwaService.clearCache();
  }, []);

  const getCacheSize = useCallback(async (): Promise<number> => {
    return await pwaService.getCacheSize();
  }, []);

  const clearSyncQueue = useCallback((): void => {
    backgroundSyncService.clearQueue();
    updateState({ queueLength: 0 });
  }, [updateState]);

  const actions: PWAActions = {
    installApp,
    updateApp,
    requestNotificationPermission,
    clearCache,
    getCacheSize,
    clearSyncQueue
  };

  return {
    ...state,
    ...actions
  };
};

export default usePWA;