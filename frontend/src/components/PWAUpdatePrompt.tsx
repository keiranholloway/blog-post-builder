import React, { useState, useEffect } from 'react';
import pwaService from '../services/pwaService';
import './PWAUpdatePrompt.css';

interface PWAUpdatePromptProps {
  onUpdate?: () => void;
  onDismiss?: () => void;
}

const PWAUpdatePrompt: React.FC<PWAUpdatePromptProps> = ({ onUpdate, onDismiss }) => {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const handleUpdateAvailable = () => {
      setShowPrompt(true);
    };

    window.addEventListener('pwa-update-available', handleUpdateAvailable);

    // Check initial state
    if (pwaService.isUpdateAvailable()) {
      setShowPrompt(true);
    }

    return () => {
      window.removeEventListener('pwa-update-available', handleUpdateAvailable);
    };
  }, []);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await pwaService.updateApp();
      onUpdate?.();
    } catch (error) {
      console.error('Update failed:', error);
      setIsUpdating(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    onDismiss?.();
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <div className="pwa-update-prompt">
      <div className="pwa-update-content">
        <div className="pwa-update-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L13.09 8.26L22 9L13.09 9.74L12 16L10.91 9.74L2 9L10.91 8.26L12 2Z" fill="currentColor"/>
          </svg>
        </div>
        <div className="pwa-update-text">
          <h3>Update Available</h3>
          <p>A new version of Blog Poster is ready to install</p>
        </div>
        <div className="pwa-update-actions">
          <button
            className="pwa-update-btn primary"
            onClick={handleUpdate}
            disabled={isUpdating}
          >
            {isUpdating ? 'Updating...' : 'Update Now'}
          </button>
          <button
            className="pwa-update-btn secondary"
            onClick={handleDismiss}
            disabled={isUpdating}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
};

export default PWAUpdatePrompt;