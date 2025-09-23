import pwaService from './pwaService';
import notificationService from './notificationService';

export interface QueuedAction {
  id: string;
  type: 'voice_upload' | 'text_submit' | 'feedback_submit' | 'publish_request';
  data: any;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

class BackgroundSyncService {
  private readonly QUEUE_KEY = 'pwa_sync_queue';
  private readonly MAX_RETRIES = 3;
  private queue: QueuedAction[] = [];

  constructor() {
    this.loadQueue();
    this.setupEventListeners();
  }

  private loadQueue(): void {
    try {
      const stored = localStorage.getItem(this.QUEUE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load sync queue:', error);
      this.queue = [];
    }
  }

  private saveQueue(): void {
    try {
      localStorage.setItem(this.QUEUE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.error('Failed to save sync queue:', error);
    }
  }

  private setupEventListeners(): void {
    // Listen for online events to process queue
    window.addEventListener('online', () => {
      this.processQueue();
    });
  }

  async queueAction(type: QueuedAction['type'], data: any): Promise<string> {
    const action: QueuedAction = {
      id: this.generateId(),
      type,
      data,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: this.MAX_RETRIES
    };

    this.queue.push(action);
    this.saveQueue();

    // Register background sync if supported
    await this.registerBackgroundSync(action.type);

    // Show notification that action was queued
    await notificationService.showOfflineActionQueued(this.getActionDisplayName(type));

    // Try to process immediately if online
    if (pwaService.isOnline()) {
      this.processQueue();
    }

    return action.id;
  }

  private async registerBackgroundSync(type: string): Promise<void> {
    try {
      await pwaService.registerBackgroundSync(`sync-${type}`);
    } catch (error) {
      console.error('Failed to register background sync:', error);
    }
  }

  async processQueue(): Promise<void> {
    if (!pwaService.isOnline() || this.queue.length === 0) {
      return;
    }

    const actionsToProcess = [...this.queue];
    
    for (const action of actionsToProcess) {
      try {
        await this.processAction(action);
        this.removeFromQueue(action.id);
        
        // Show success notification
        await notificationService.showBackgroundSyncComplete(
          this.getActionDisplayName(action.type)
        );
      } catch (error) {
        console.error(`Failed to process action ${action.id}:`, error);
        await this.handleActionFailure(action, error);
      }
    }

    this.saveQueue();
  }

  private async processAction(action: QueuedAction): Promise<void> {
    switch (action.type) {
      case 'voice_upload':
        await this.processVoiceUpload(action.data);
        break;
      case 'text_submit':
        await this.processTextSubmit(action.data);
        break;
      case 'feedback_submit':
        await this.processFeedbackSubmit(action.data);
        break;
      case 'publish_request':
        await this.processPublishRequest(action.data);
        break;
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private async processVoiceUpload(data: any): Promise<void> {
    // Import the service dynamically to avoid circular dependencies
    const { inputProcessingService } = await import('./inputProcessingService');
    
    await inputProcessingService.processAudio(data.audioBlob, data.userId);
  }

  private async processTextSubmit(data: any): Promise<void> {
    const { inputProcessingService } = await import('./inputProcessingService');
    
    await inputProcessingService.processText(data.text, data.userId);
  }

  private async processFeedbackSubmit(data: any): Promise<void> {
    const { revisionService } = await import('./revisionService');
    
    if (data.type === 'content') {
      await revisionService.requestContentRevision(data.contentId, data.feedback);
    } else {
      await revisionService.requestImageRevision(data.contentId, data.feedback);
    }
  }

  private async processPublishRequest(data: any): Promise<void> {
    const { publishingStatusService } = await import('./publishingStatusService');
    
    await publishingStatusService.startOrchestration({
      contentId: data.contentId,
      platforms: data.platforms,
      configs: data.configs || {}
    });
  }

  private async handleActionFailure(action: QueuedAction, error: any): Promise<void> {
    action.retryCount++;
    
    if (action.retryCount >= action.maxRetries) {
      // Remove from queue after max retries
      this.removeFromQueue(action.id);
      
      // Show error notification
      await notificationService.showProcessingError(
        action.data.contentId || 'unknown',
        this.getActionDisplayName(action.type)
      );
    } else {
      // Keep in queue for retry
      console.log(`Action ${action.id} will be retried (${action.retryCount}/${action.maxRetries})`);
    }
  }

  private removeFromQueue(actionId: string): void {
    this.queue = this.queue.filter(action => action.id !== actionId);
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private getActionDisplayName(type: QueuedAction['type']): string {
    switch (type) {
      case 'voice_upload':
        return 'voice recording';
      case 'text_submit':
        return 'text submission';
      case 'feedback_submit':
        return 'feedback';
      case 'publish_request':
        return 'publishing';
      default:
        return 'action';
    }
  }

  // Public methods for managing queue
  getQueueLength(): number {
    return this.queue.length;
  }

  getQueuedActions(): QueuedAction[] {
    return [...this.queue];
  }

  clearQueue(): void {
    this.queue = [];
    this.saveQueue();
  }

  removeAction(actionId: string): void {
    this.removeFromQueue(actionId);
    this.saveQueue();
  }

  // Method to be called from service worker
  async handleBackgroundSync(tag: string): Promise<void> {
    console.log(`Background sync triggered for tag: ${tag}`);
    await this.processQueue();
  }
}

export const backgroundSyncService = new BackgroundSyncService();
export default backgroundSyncService;