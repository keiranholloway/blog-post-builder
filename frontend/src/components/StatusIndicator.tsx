import React, { useState, useEffect } from 'react';
import { contentGenerationService } from '../services/contentGenerationService';
import { imageGenerationService } from '../services/imageGenerationService';
import './StatusIndicator.css';

interface StatusIndicatorProps {
  contentId: string;
  onStatusChange?: (status: string) => void;
  showDetails?: boolean;
  className?: string;
}

interface ProcessingStatus {
  overall: string;
  content: string;
  image: string;
  lastUpdated: string;
  progress?: number;
  estimatedTimeRemaining?: number;
  currentStep?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  contentId,
  onStatusChange,
  showDetails = false,
  className = ''
}) => {
  const [status, setStatus] = useState<ProcessingStatus>({
    overall: 'loading',
    content: 'idle',
    image: 'idle',
    lastUpdated: new Date().toISOString()
  });
  const [isPolling, setIsPolling] = useState(true);

  useEffect(() => {
    if (!contentId) return;

    const pollStatus = async () => {
      try {
        const contentStatus = await contentGenerationService.getContentStatus(contentId);
        
        // Try to get image status if there's an image
        let imageStatus = 'idle';
        try {
          const imgStatus = await imageGenerationService.getImageStatus(contentId);
          imageStatus = imgStatus.status;
        } catch (err) {
          // Image status might not be available yet
        }

        const newStatus: ProcessingStatus = {
          overall: contentStatus.status,
          content: contentStatus.status.includes('content') ? 
            (contentStatus.status.includes('processing') ? 'processing' : 'completed') : 'idle',
          image: imageStatus,
          lastUpdated: new Date().toISOString(),
          progress: contentStatus.progress,
          estimatedTimeRemaining: contentStatus.estimatedTimeRemaining,
          currentStep: contentStatus.currentStep
        };

        setStatus(newStatus);
        
        if (onStatusChange) {
          onStatusChange(newStatus.overall);
        }

        // Stop polling if processing is complete
        if (['ready', 'completed', 'approved', 'published'].includes(newStatus.overall)) {
          setIsPolling(false);
        }
      } catch (error) {
        console.error('Error polling status:', error);
        setStatus(prev => ({
          ...prev,
          overall: 'error',
          lastUpdated: new Date().toISOString()
        }));
      }
    };

    // Initial status check
    pollStatus();

    // Set up polling interval
    let interval: NodeJS.Timeout | null = null;
    if (isPolling) {
      interval = setInterval(pollStatus, 3000); // Poll every 3 seconds
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [contentId, isPolling, onStatusChange]);

  const getStatusColor = (statusType: string): string => {
    switch (statusType) {
      case 'idle':
        return 'gray';
      case 'processing':
      case 'generating':
        return 'blue';
      case 'completed':
      case 'ready':
        return 'green';
      case 'error':
      case 'failed':
        return 'red';
      case 'approved':
        return 'purple';
      default:
        return 'gray';
    }
  };

  const getStatusIcon = (statusType: string): string => {
    switch (statusType) {
      case 'idle':
        return '⏸️';
      case 'processing':
      case 'generating':
        return '⚙️';
      case 'completed':
      case 'ready':
        return '✅';
      case 'error':
      case 'failed':
        return '❌';
      case 'approved':
        return '🎉';
      default:
        return '❓';
    }
  };

  const formatTimeRemaining = (seconds?: number): string => {
    if (!seconds) return '';
    
    if (seconds < 60) {
      return `${Math.round(seconds)}s remaining`;
    } else if (seconds < 3600) {
      return `${Math.round(seconds / 60)}m remaining`;
    } else {
      return `${Math.round(seconds / 3600)}h remaining`;
    }
  };

  return (
    <div className={`status-indicator ${className}`}>
      {/* Main status display */}
      <div className="status-main">
        <div className={`status-badge ${getStatusColor(status.overall)}`}>
          <span className="status-icon">{getStatusIcon(status.overall)}</span>
          <span className="status-text">
            {status.overall.replace('_', ' ').toUpperCase()}
          </span>
        </div>
        
        {status.progress !== undefined && (
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${status.progress}%` }}
              ></div>
            </div>
            <span className="progress-text">{status.progress}%</span>
          </div>
        )}
      </div>

      {/* Detailed status (if enabled) */}
      {showDetails && (
        <div className="status-details">
          <div className="status-row">
            <span className="status-label">Content:</span>
            <div className={`status-badge small ${getStatusColor(status.content)}`}>
              <span className="status-icon">{getStatusIcon(status.content)}</span>
              <span className="status-text">{status.content}</span>
            </div>
          </div>
          
          <div className="status-row">
            <span className="status-label">Image:</span>
            <div className={`status-badge small ${getStatusColor(status.image)}`}>
              <span className="status-icon">{getStatusIcon(status.image)}</span>
              <span className="status-text">{status.image}</span>
            </div>
          </div>

          {status.currentStep && (
            <div className="status-row">
              <span className="status-label">Current Step:</span>
              <span className="status-value">{status.currentStep}</span>
            </div>
          )}

          {status.estimatedTimeRemaining && (
            <div className="status-row">
              <span className="status-label">Time Remaining:</span>
              <span className="status-value">
                {formatTimeRemaining(status.estimatedTimeRemaining)}
              </span>
            </div>
          )}

          <div className="status-row">
            <span className="status-label">Last Updated:</span>
            <span className="status-value">
              {new Date(status.lastUpdated).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* Processing animation */}
      {(status.overall === 'processing' || status.content === 'processing' || status.image === 'processing') && (
        <div className="processing-animation">
          <div className="pulse-dot"></div>
          <div className="pulse-dot"></div>
          <div className="pulse-dot"></div>
        </div>
      )}
    </div>
  );
};