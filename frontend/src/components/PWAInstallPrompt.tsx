import React, { useState, useEffect } from 'react';
import pwaService from '../services/pwaService';
import './PWAInstallPrompt.css';

interface PWAInstallPromptProps {
  onInstall?: () => void;
  onDismiss?: () => void;
}

const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({ onInstall, onDismiss }) => {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    const handleInstallAvailable = () => {
      if (!pwaService.isAppInstalled()) {
        setShowPrompt(true);
      }
    };

    window.addEventListener('pwa-install-available', handleInstallAvailable);

    // Check initial state
    if (pwaService.isAppInstallable() && !pwaService.isAppInstalled()) {
      setShowPrompt(true);
    }

    return () => {
      window.removeEventListener('pwa-install-available', handleInstallAvailable);
    };
  }, []);

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      const installed = await pwaService.installApp();
      if (installed) {
        setShowPrompt(false);
        onInstall?.();
      }
    } catch (error) {
      console.error('Installation failed:', error);
    } finally {
      setIsInstalling(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    onDismiss?.();
  };

  if (!showPrompt || pwaService.isAppInstalled()) {
    return null;
  }

  return (
    <div className="pwa-install-prompt">
      <div className="pwa-install-content">
        <div className="pwa-install-icon">
          <img src="/icon-192.png" alt="App Icon" />
        </div>
        <div className="pwa-install-text">
          <h3>Install Blog Poster</h3>
          <p>Get quick access to create blog posts from your voice recordings</p>
          <div className="pwa-install-benefits">
            <span>✓ Offline access</span>
            <span>✓ Push notifications</span>
            <span>✓ Faster loading</span>
          </div>
        </div>
        <div className="pwa-install-actions">
          <button
            className="pwa-install-btn primary"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            {isInstalling ? 'Installing...' : 'Install App'}
          </button>
          <button
            className="pwa-install-btn secondary"
            onClick={handleDismiss}
            disabled={isInstalling}
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
};

export default PWAInstallPrompt;