import { Workbox } from 'workbox-window';

export interface PWAInstallPrompt {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: any;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

class PWAService {
  private wb: Workbox | null = null;
  private installPrompt: PWAInstallPrompt | null = null;
  private isInstallable = false;
  private isInstalled = false;
  private updateAvailable = false;
  private registration: ServiceWorkerRegistration | null = null;

  constructor() {
    this.initializeServiceWorker();
    this.setupInstallPrompt();
    this.checkIfInstalled();
  }

  private initializeServiceWorker() {
    if ('serviceWorker' in navigator) {
      this.wb = new Workbox('/sw.js');
      
      this.wb.addEventListener('waiting', () => {
        this.updateAvailable = true;
        this.notifyUpdateAvailable();
      });

      this.wb.addEventListener('controlling', () => {
        window.location.reload();
      });

      this.wb.register().then((registration) => {
        this.registration = registration || null;
        console.log('Service Worker registered successfully');
      }).catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
    }
  }

  private setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e as any;
      this.isInstallable = true;
      this.notifyInstallAvailable();
    });

    window.addEventListener('appinstalled', () => {
      this.isInstalled = true;
      this.installPrompt = null;
      this.isInstallable = false;
      console.log('PWA was installed');
    });
  }

  private checkIfInstalled() {
    // Check if app is running in standalone mode
    this.isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
                      (window.navigator as any).standalone === true;
  }

  private notifyInstallAvailable() {
    // Dispatch custom event for components to listen to
    window.dispatchEvent(new CustomEvent('pwa-install-available'));
  }

  private notifyUpdateAvailable() {
    // Dispatch custom event for components to listen to
    window.dispatchEvent(new CustomEvent('pwa-update-available'));
  }

  // Public methods
  async installApp(): Promise<boolean> {
    if (!this.installPrompt) {
      return false;
    }

    try {
      await this.installPrompt.prompt();
      const choiceResult = await this.installPrompt.userChoice;
      
      if (choiceResult.outcome === 'accepted') {
        console.log('User accepted the install prompt');
        return true;
      } else {
        console.log('User dismissed the install prompt');
        return false;
      }
    } catch (error) {
      console.error('Error during app installation:', error);
      return false;
    }
  }

  async updateApp(): Promise<void> {
    if (this.wb && this.updateAvailable) {
      this.wb.messageSkipWaiting();
    }
  }

  isAppInstallable(): boolean {
    return this.isInstallable;
  }

  isAppInstalled(): boolean {
    return this.isInstalled;
  }

  isUpdateAvailable(): boolean {
    return this.updateAvailable;
  }

  // Push notifications
  async requestNotificationPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      throw new Error('This browser does not support notifications');
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission;
    }

    return Notification.permission;
  }

  async showNotification(options: NotificationOptions): Promise<void> {
    const permission = await this.requestNotificationPermission();
    
    if (permission !== 'granted') {
      throw new Error('Notification permission not granted');
    }

    if (this.registration) {
      await this.registration.showNotification(options.title, {
        body: options.body,
        icon: options.icon || '/icon-192.png',
        badge: options.badge || '/icon-192.png',
        tag: options.tag,
        data: options.data,
        // actions: options.actions, // Not supported in all browsers
        requireInteraction: true,
        silent: false
      });
    } else {
      // Fallback to regular notification
      new Notification(options.title, {
        body: options.body,
        icon: options.icon || '/icon-192.png',
        tag: options.tag,
        data: options.data
      });
    }
  }

  // Background sync
  async registerBackgroundSync(tag: string): Promise<void> {
    if (this.registration && 'sync' in this.registration) {
      try {
        await (this.registration as any).sync.register(tag);
        console.log(`Background sync registered for tag: ${tag}`);
      } catch (error) {
        console.error('Background sync registration failed:', error);
      }
    }
  }

  // Offline status
  isOnline(): boolean {
    return navigator.onLine;
  }

  onOnlineStatusChange(callback: (isOnline: boolean) => void): () => void {
    const handleOnline = () => callback(true);
    const handleOffline = () => callback(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Return cleanup function
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }

  // Cache management
  async clearCache(): Promise<void> {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
    }
  }

  async getCacheSize(): Promise<number> {
    if ('caches' in window && 'storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return estimate.usage || 0;
    }
    return 0;
  }
}

export const pwaService = new PWAService();
export default pwaService;