import pwaService, { NotificationOptions } from './pwaService';

export interface ProcessingStatusNotification {
  contentId: string;
  status: 'processing' | 'completed' | 'failed' | 'revision_ready';
  title: string;
  message: string;
  data?: any;
}

class NotificationService {
  private isPermissionGranted = false;

  constructor() {
    this.checkPermissionStatus();
  }

  private async checkPermissionStatus() {
    if ('Notification' in window) {
      this.isPermissionGranted = Notification.permission === 'granted';
    }
  }

  async requestPermission(): Promise<boolean> {
    try {
      const permission = await pwaService.requestNotificationPermission();
      this.isPermissionGranted = permission === 'granted';
      return this.isPermissionGranted;
    } catch (error) {
      console.error('Failed to request notification permission:', error);
      return false;
    }
  }

  async showProcessingStatusNotification(notification: ProcessingStatusNotification): Promise<void> {
    if (!this.isPermissionGranted) {
      console.warn('Notification permission not granted');
      return;
    }

    const options: NotificationOptions = {
      title: notification.title,
      body: notification.message,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `processing-${notification.contentId}`,
      data: {
        contentId: notification.contentId,
        status: notification.status,
        timestamp: Date.now(),
        ...notification.data
      }
    };

    // Add action buttons based on status
    switch (notification.status) {
      case 'completed':
        options.actions = [
          {
            action: 'review',
            title: 'Review Content',
            icon: '/icon-192.png'
          },
          {
            action: 'publish',
            title: 'Publish Now',
            icon: '/icon-192.png'
          }
        ];
        break;
      case 'revision_ready':
        options.actions = [
          {
            action: 'review',
            title: 'Review Changes',
            icon: '/icon-192.png'
          }
        ];
        break;
      case 'failed':
        options.actions = [
          {
            action: 'retry',
            title: 'Try Again',
            icon: '/icon-192.png'
          }
        ];
        break;
    }

    try {
      await pwaService.showNotification(options);
    } catch (error) {
      console.error('Failed to show notification:', error);
    }
  }

  async showContentGenerationComplete(contentId: string, title: string): Promise<void> {
    await this.showProcessingStatusNotification({
      contentId,
      status: 'completed',
      title: 'Blog Post Ready! 🎉',
      message: `"${title}" has been generated and is ready for review.`
    });
  }

  async showImageGenerationComplete(contentId: string): Promise<void> {
    await this.showProcessingStatusNotification({
      contentId,
      status: 'completed',
      title: 'Image Generated! 🖼️',
      message: 'Your blog post image has been created and is ready for review.'
    });
  }

  async showRevisionReady(contentId: string, revisionType: 'content' | 'image'): Promise<void> {
    const typeText = revisionType === 'content' ? 'content' : 'image';
    await this.showProcessingStatusNotification({
      contentId,
      status: 'revision_ready',
      title: 'Revision Complete! ✨',
      message: `Your ${typeText} revision is ready for review.`,
      data: { revisionType }
    });
  }

  async showPublishingComplete(contentId: string, platforms: string[]): Promise<void> {
    const platformText = platforms.length === 1 
      ? platforms[0] 
      : `${platforms.length} platforms`;
    
    await this.showProcessingStatusNotification({
      contentId,
      status: 'completed',
      title: 'Published Successfully! 🚀',
      message: `Your blog post has been published to ${platformText}.`,
      data: { platforms }
    });
  }

  async showProcessingError(contentId: string, errorType: string): Promise<void> {
    await this.showProcessingStatusNotification({
      contentId,
      status: 'failed',
      title: 'Processing Failed ❌',
      message: `There was an issue with ${errorType}. Tap to try again.`,
      data: { errorType }
    });
  }

  // Background sync notifications
  async showOfflineActionQueued(action: string): Promise<void> {
    if (!this.isPermissionGranted) return;

    await pwaService.showNotification({
      title: 'Action Queued 📱',
      body: `Your ${action} will be processed when you're back online.`,
      tag: 'offline-queue'
    });
  }

  async showBackgroundSyncComplete(action: string): Promise<void> {
    if (!this.isPermissionGranted) return;

    await pwaService.showNotification({
      title: 'Sync Complete ✅',
      body: `Your ${action} has been processed successfully.`,
      tag: 'background-sync'
    });
  }

  // Utility methods
  isNotificationSupported(): boolean {
    return 'Notification' in window;
  }

  hasPermission(): boolean {
    return this.isPermissionGranted;
  }

  getPermissionStatus(): NotificationPermission {
    return Notification.permission;
  }

  // Handle notification clicks (to be called from service worker)
  handleNotificationClick(event: any): void {
    const { action, data } = event;
    const { contentId, status } = data || {};

    // Close the notification
    event.notification.close();

    // Handle different actions
    switch (action) {
      case 'review':
        // Navigate to review page
        this.navigateToContent(contentId, 'review');
        break;
      case 'publish':
        // Navigate to publishing interface
        this.navigateToContent(contentId, 'publish');
        break;
      case 'retry':
        // Navigate to content with retry option
        this.navigateToContent(contentId, 'retry');
        break;
      default:
        // Default action - just open the app
        this.navigateToContent(contentId);
        break;
    }
  }

  private navigateToContent(contentId: string, action?: string): void {
    const baseUrl = window.location.origin;
    let url = `${baseUrl}/#/content/${contentId}`;
    
    if (action) {
      url += `?action=${action}`;
    }

    // Focus existing window or open new one
    if ('clients' in self) {
      // This would be called from service worker context
      (self as any).clients.openWindow(url);
    } else {
      // This would be called from main thread
      window.open(url, '_blank');
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;