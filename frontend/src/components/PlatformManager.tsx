import React, { useState, useEffect } from 'react';
import { Platform, PlatformConnection } from '../types/PlatformConnection';
import { authenticationService } from '../services/authenticationService';
import './PlatformManager.css';

interface PlatformManagerProps {
  userId: string;
  onConnectionChange?: () => void;
}

interface PlatformStatus extends PlatformConnection {
  needsRenewal?: boolean;
}

export const PlatformManager: React.FC<PlatformManagerProps> = ({ 
  userId, 
  onConnectionChange 
}) => {
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  const platformLabels: Record<string, string> = {
    medium: 'Medium',
    linkedin: 'LinkedIn',
    'dev.to': 'Dev.to',
    hashnode: 'Hashnode',
    custom: 'Custom'
  };

  const platformDescriptions: Record<string, string> = {
    medium: 'Publish to your Medium profile and publications',
    linkedin: 'Share posts to your LinkedIn professional network',
    'dev.to': 'Share technical content with the developer community',
    hashnode: 'Publish to your Hashnode blog',
    custom: 'Connect to your custom publishing platform'
  };

  useEffect(() => {
    loadPlatforms();
  }, [userId]);

  const loadPlatforms = async () => {
    try {
      setLoading(true);
      setError(null);
      const connectedPlatforms = await authenticationService.getConnectedPlatforms(userId);
      
      // Create a complete list including unconnected platforms
      const supportedPlatforms: Platform[] = ['medium', 'linkedin'];
      const allPlatforms = supportedPlatforms.map(platform => {
        const connected = connectedPlatforms.find(p => p.platform === platform);
        return connected || {
          platform,
          credentials: { accessToken: '' },
          isActive: false,
          connectedAt: new Date(),
          lastUsed: undefined,
          configuration: { autoPublish: false, defaultTags: [], customSettings: {} },
          updatedAt: new Date(),
          needsRenewal: false
        };
      });

      setPlatforms(allPlatforms);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platforms');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (platform: Platform) => {
    try {
      setConnecting(platform);
      setError(null);
      
      const authUrl = await authenticationService.initiateAuth(platform, userId);
      
      // Open OAuth flow in popup window
      const popup = window.open(
        authUrl,
        'oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      // Listen for popup completion
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setConnecting(null);
          // Reload platforms to check if connection was successful
          loadPlatforms();
          onConnectionChange?.();
        }
      }, 1000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate connection');
      setConnecting(null);
    }
  };

  const handleDisconnect = async (platform: Platform) => {
    if (!window.confirm(`Are you sure you want to disconnect ${platformLabels[platform]}?`)) {
      return;
    }

    try {
      setError(null);
      await authenticationService.disconnectPlatform(userId, platform);
      await loadPlatforms();
      onConnectionChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect platform');
    }
  };

  const handleRenewToken = async (platform: Platform) => {
    try {
      setError(null);
      const result = await authenticationService.refreshToken(userId, platform);
      
      if (result.success) {
        await loadPlatforms();
        onConnectionChange?.();
      } else {
        setError(result.error || 'Failed to renew token');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to renew token');
    }
  };

  if (loading) {
    return (
      <div className="platform-manager">
        <div className="loading">Loading platforms...</div>
      </div>
    );
  }

  return (
    <div className="platform-manager">
      <h2>Publishing Platforms</h2>
      <p className="description">
        Connect your social media and blogging platforms to publish your content automatically.
      </p>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="platforms-list">
        {platforms.map((platform) => (
          <div key={platform.platform} className="platform-card">
            <div className="platform-info">
              <div className="platform-header">
                <h3>{platformLabels[platform.platform]}</h3>
                <div className={`status-badge ${platform.isActive ? 'connected' : 'disconnected'}`}>
                  {platform.isActive ? 'Connected' : 'Not Connected'}
                </div>
              </div>
              
              <p className="platform-description">
                {platformDescriptions[platform.platform]}
              </p>

              {platform.isActive && (
                <div className="connection-details">
                  <div className="detail-item">
                    <span className="label">Connected:</span>
                    <span className="value">
                      {platform.connectedAt ? new Date(platform.connectedAt).toLocaleDateString() : 'Unknown'}
                    </span>
                  </div>
                  
                  {platform.lastUsed && (
                    <div className="detail-item">
                      <span className="label">Last used:</span>
                      <span className="value">
                        {new Date(platform.lastUsed).toLocaleDateString()}
                      </span>
                    </div>
                  )}

                  {platform.needsRenewal && (
                    <div className="renewal-warning">
                      ⚠️ Authentication expired - renewal required
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="platform-actions">
              {!platform.isActive ? (
                <button
                  className="connect-button"
                  onClick={() => handleConnect(platform.platform)}
                  disabled={connecting === platform.platform}
                >
                  {connecting === platform.platform ? 'Connecting...' : 'Connect'}
                </button>
              ) : (
                <div className="connected-actions">
                  {platform.needsRenewal && (
                    <button
                      className="renew-button"
                      onClick={() => handleRenewToken(platform.platform)}
                    >
                      Renew Access
                    </button>
                  )}
                  
                  <button
                    className="disconnect-button"
                    onClick={() => handleDisconnect(platform.platform)}
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="platform-help">
        <h4>Need help?</h4>
        <ul>
          <li>Make sure you have accounts on the platforms you want to connect</li>
          <li>Allow popups for this site to complete the connection process</li>
          <li>You can disconnect and reconnect platforms at any time</li>
          <li>Expired connections will be automatically detected before publishing</li>
        </ul>
      </div>
    </div>
  );
};