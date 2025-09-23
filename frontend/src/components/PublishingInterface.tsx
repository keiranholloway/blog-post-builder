import React, { useState, useEffect } from 'react';
import { publishingService, Platform, PublishingConfig, PublishResult } from '../services/publishingService';
import { authenticationService } from '../services/authenticationService';
import { PlatformConnection } from '../types/PlatformConnection';
import './PublishingInterface.css';

interface PublishingInterfaceProps {
  contentId: string;
  userId: string;
  imageUrl?: string;
  onPublishComplete?: (results: Record<string, PublishResult>) => void;
  onPublishStart?: () => void;
}

interface PlatformSelectionState {
  platform: string;
  selected: boolean;
  connected: boolean;
  config?: PublishingConfig;
  preview?: any;
}

export const PublishingInterface: React.FC<PublishingInterfaceProps> = ({
  contentId,
  userId,
  imageUrl,
  onPublishComplete,
  onPublishStart
}) => {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [platformStates, setPlatformStates] = useState<Map<string, PlatformSelectionState>>(new Map());
  const [publishing, setPublishing] = useState(false);
  const [publishingStatus, setPublishingStatus] = useState<Record<string, 'pending' | 'publishing' | 'success' | 'error'>>({});
  const [publishResults, setPublishResults] = useState<Record<string, PublishResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPlatformsAndConnections();
  }, [userId]);

  const loadPlatformsAndConnections = async () => {
    try {
      setLoading(true);
      setError(null);

      const [platformsData, connectionsData] = await Promise.all([
        publishingService.getSupportedPlatforms(),
        authenticationService.getConnectedPlatforms(userId)
      ]);

      setPlatforms(platformsData);
      setConnections(connectionsData);

      // Initialize platform states
      const states = new Map<string, PlatformSelectionState>();
      platformsData.forEach(platform => {
        const connection = connectionsData.find(c => c.platform === platform.name);
        states.set(platform.name, {
          platform: platform.name,
          selected: false,
          connected: connection?.isActive || false,
          config: connection?.isActive ? {
            platform: platform.name,
            credentials: {} // Will be populated from secure storage
          } : undefined
        });
      });

      setPlatformStates(states);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platforms');
    } finally {
      setLoading(false);
    }
  };

  const handlePlatformToggle = async (platformName: string) => {
    const currentState = platformStates.get(platformName);
    if (!currentState) return;

    if (!currentState.connected) {
      setError(`Please connect to ${platformName} first in the Platform Manager`);
      return;
    }

    const newStates = new Map(platformStates);
    newStates.set(platformName, {
      ...currentState,
      selected: !currentState.selected
    });
    setPlatformStates(newStates);

    // Load preview if selecting platform
    if (!currentState.selected && currentState.connected) {
      try {
        const preview = await publishingService.getFormatPreview(contentId, platformName, imageUrl);
        newStates.set(platformName, {
          ...newStates.get(platformName)!,
          preview
        });
        setPlatformStates(new Map(newStates));
      } catch (err) {
        console.error(`Failed to load preview for ${platformName}:`, err);
      }
    }
  };

  const getSelectedPlatforms = (): string[] => {
    return Array.from(platformStates.entries())
      .filter(([_, state]) => state.selected && state.connected)
      .map(([platform, _]) => platform);
  };

  const handlePublish = async () => {
    const selectedPlatforms = getSelectedPlatforms();
    
    if (selectedPlatforms.length === 0) {
      setError('Please select at least one platform to publish to');
      return;
    }

    try {
      setPublishing(true);
      setError(null);
      onPublishStart?.();

      // Initialize publishing status
      const initialStatus: Record<string, 'pending' | 'publishing' | 'success' | 'error'> = {};
      selectedPlatforms.forEach(platform => {
        initialStatus[platform] = 'pending';
      });
      setPublishingStatus(initialStatus);

      // Prepare configs
      const configs: Record<string, PublishingConfig> = {};
      selectedPlatforms.forEach(platform => {
        const state = platformStates.get(platform);
        if (state?.config) {
          configs[platform] = state.config;
        }
      });

      // Start publishing with status updates
      const updateStatus = (platform: string, status: 'pending' | 'publishing' | 'success' | 'error') => {
        setPublishingStatus(prev => ({ ...prev, [platform]: status }));
      };

      // Update status to publishing for all platforms
      selectedPlatforms.forEach(platform => updateStatus(platform, 'publishing'));

      // Publish to multiple platforms
      const response = await publishingService.publishToMultiplePlatforms(
        contentId,
        new Map(Object.entries(configs)),
        imageUrl
      );

      // Update final status and results
      const finalResults: Record<string, PublishResult> = {};
      Object.entries(response.results).forEach(([platform, result]) => {
        finalResults[platform] = result;
        updateStatus(platform, result.success ? 'success' : 'error');
      });

      setPublishResults(finalResults);
      onPublishComplete?.(finalResults);

      // Show success message if any platforms succeeded
      const successCount = Object.values(finalResults).filter(r => r.success).length;
      if (successCount > 0) {
        setError(null);
      } else {
        setError('Publishing failed on all selected platforms');
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publishing failed');
      // Update all platforms to error status
      const errorStatus: Record<string, 'pending' | 'publishing' | 'success' | 'error'> = {};
      selectedPlatforms.forEach(platform => {
        errorStatus[platform] = 'error';
      });
      setPublishingStatus(errorStatus);
    } finally {
      setPublishing(false);
    }
  };

  const handleRetryFailed = async () => {
    const failedPlatforms = Object.entries(publishResults)
      .filter(([_, result]) => !result.success)
      .map(([platform, _]) => platform);

    if (failedPlatforms.length === 0) return;

    try {
      setPublishing(true);
      setError(null);

      // Prepare configs for failed platforms
      const configs: Record<string, PublishingConfig> = {};
      failedPlatforms.forEach(platform => {
        const state = platformStates.get(platform);
        if (state?.config) {
          configs[platform] = state.config;
        }
      });

      // Update status to publishing for failed platforms
      failedPlatforms.forEach(platform => {
        setPublishingStatus(prev => ({ ...prev, [platform]: 'publishing' }));
      });

      const response = await publishingService.retryFailedPublishing(
        contentId,
        failedPlatforms,
        new Map(Object.entries(configs)),
        imageUrl
      );

      // Update results
      const updatedResults = { ...publishResults };
      Object.entries(response.results).forEach(([platform, result]) => {
        updatedResults[platform] = result;
        setPublishingStatus(prev => ({ 
          ...prev, 
          [platform]: result.success ? 'success' : 'error' 
        }));
      });

      setPublishResults(updatedResults);
      onPublishComplete?.(updatedResults);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setPublishing(false);
    }
  };

  const getPlatformIcon = (platformName: string): string => {
    return publishingService.getPlatformIcon(platformName);
  };

  const getPlatformDisplayName = (platformName: string): string => {
    return publishingService.getPlatformDisplayName(platformName);
  };

  const getStatusIcon = (status: 'pending' | 'publishing' | 'success' | 'error'): string => {
    switch (status) {
      case 'pending': return '⏳';
      case 'publishing': return '🔄';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return '⏳';
    }
  };

  if (loading) {
    return (
      <div className="publishing-interface">
        <div className="loading">Loading publishing options...</div>
      </div>
    );
  }

  const selectedPlatforms = getSelectedPlatforms();
  const hasFailedPublishing = Object.values(publishResults).some(r => !r.success);

  return (
    <div className="publishing-interface">
      <h2>Publish Your Content</h2>
      <p className="description">
        Select the platforms where you'd like to publish your blog post.
      </p>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="platforms-grid">
        {platforms.map(platform => {
          const state = platformStates.get(platform.name);
          const status = publishingStatus[platform.name];
          const result = publishResults[platform.name];

          if (!state) return null;

          return (
            <div 
              key={platform.name} 
              className={`platform-card ${state.selected ? 'selected' : ''} ${!state.connected ? 'disconnected' : ''}`}
            >
              <div className="platform-header">
                <div className="platform-info">
                  <span className="platform-icon">{getPlatformIcon(platform.name)}</span>
                  <span className="platform-name">{getPlatformDisplayName(platform.name)}</span>
                </div>
                
                {status && (
                  <div className="publishing-status">
                    <span className="status-icon">{getStatusIcon(status)}</span>
                    <span className="status-text">{status}</span>
                  </div>
                )}
              </div>

              {!state.connected ? (
                <div className="connection-required">
                  <p>Not connected</p>
                  <small>Connect this platform in Platform Manager first</small>
                </div>
              ) : (
                <div className="platform-controls">
                  <label className="platform-checkbox">
                    <input
                      type="checkbox"
                      checked={state.selected}
                      onChange={() => handlePlatformToggle(platform.name)}
                      disabled={publishing}
                    />
                    <span className="checkmark"></span>
                    Select for publishing
                  </label>

                  {state.selected && state.preview && (
                    <div className="platform-preview">
                      <h4>Preview:</h4>
                      <div className="preview-content">
                        <h5>{state.preview.title}</h5>
                        <p>{state.preview.body.substring(0, 100)}...</p>
                        {state.preview.tags && (
                          <div className="preview-tags">
                            {state.preview.tags.map((tag: string, index: number) => (
                              <span key={index} className="tag">#{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {result && (
                    <div className={`publish-result ${result.success ? 'success' : 'error'}`}>
                      {result.success ? (
                        <div>
                          <p>✅ Published successfully!</p>
                          {result.platformUrl && (
                            <a href={result.platformUrl} target="_blank" rel="noopener noreferrer">
                              View on {getPlatformDisplayName(platform.name)}
                            </a>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p>❌ Publishing failed</p>
                          <small>{publishingService.formatPublishingError(result.error || 'Unknown error')}</small>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="publishing-actions">
        <button
          className="publish-button"
          onClick={handlePublish}
          disabled={publishing || selectedPlatforms.length === 0}
        >
          {publishing ? 'Publishing...' : `Publish to ${selectedPlatforms.length} Platform${selectedPlatforms.length !== 1 ? 's' : ''}`}
        </button>

        {hasFailedPublishing && !publishing && (
          <button
            className="retry-button"
            onClick={handleRetryFailed}
          >
            Retry Failed Platforms
          </button>
        )}
      </div>

      {Object.keys(publishResults).length > 0 && (
        <div className="publishing-summary">
          <h3>Publishing Results</h3>
          <div className="results-grid">
            {Object.entries(publishResults).map(([platform, result]) => (
              <div key={platform} className={`result-item ${result.success ? 'success' : 'error'}`}>
                <span className="platform-name">
                  {getPlatformIcon(platform)} {getPlatformDisplayName(platform)}
                </span>
                <span className="result-status">
                  {result.success ? '✅ Success' : '❌ Failed'}
                </span>
                {result.success && result.platformUrl && (
                  <a href={result.platformUrl} target="_blank" rel="noopener noreferrer" className="view-link">
                    View Post
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};