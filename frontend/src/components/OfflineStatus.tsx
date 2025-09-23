import React, { useState, useEffect } from 'react';
import pwaService from '../services/pwaService';
import './OfflineStatus.css';

interface OfflineStatusProps {
  onOnlineStatusChange?: (isOnline: boolean) => void;
}

const OfflineStatus: React.FC<OfflineStatusProps> = ({ onOnlineStatusChange }) => {
  const [isOnline, setIsOnline] = useState(pwaService.isOnline());
  const [showOfflineMessage, setShowOfflineMessage] = useState(false);

  useEffect(() => {
    const cleanup = pwaService.onOnlineStatusChange((online) => {
      setIsOnline(online);
      onOnlineStatusChange?.(online);

      if (!online) {
        setShowOfflineMessage(true);
      } else {
        // Hide offline message after a brief delay when coming back online
        setTimeout(() => setShowOfflineMessage(false), 2000);
      }
    });

    return cleanup;
  }, [onOnlineStatusChange]);

  if (isOnline && !showOfflineMessage) {
    return null;
  }

  return (
    <div className={`offline-status ${isOnline ? 'online' : 'offline'}`}>
      <div className="offline-status-content">
        <div className="offline-status-icon">
          {isOnline ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M23.64 7c-.45-.34-4.93-4-11.64-4-1.5 0-2.89.19-4.15.48L18.18 13.8 23.64 7zm-6.6 8.22L3.27 1.44 2 2.72l2.05 2.06C1.91 5.76.59 6.82.36 7l11.63 14.49.01.01.01-.01 3.9-4.86 3.32 3.32 1.27-1.27-3.46-3.46z" fill="currentColor"/>
            </svg>
          )}
        </div>
        <div className="offline-status-text">
          {isOnline ? (
            <>
              <span className="offline-status-title">Back Online</span>
              <span className="offline-status-message">Connection restored</span>
            </>
          ) : (
            <>
              <span className="offline-status-title">You're Offline</span>
              <span className="offline-status-message">Some features may be limited</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default OfflineStatus;