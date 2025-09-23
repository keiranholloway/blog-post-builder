import React from 'react';
import { UserFriendlyError, ErrorType } from '../services/errorService';
import './ErrorDisplay.css';

interface ErrorDisplayProps {
  error: UserFriendlyError;
  onRetry?: () => void;
  onDismiss?: () => void;
  showTechnicalDetails?: boolean;
  className?: string;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  onRetry,
  onDismiss,
  showTechnicalDetails = false,
  className = '',
}) => {
  const getErrorIcon = (type: ErrorType) => {
    switch (type) {
      case ErrorType.NETWORK:
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v6m0 6v6"/>
          </svg>
        );
      case ErrorType.AUTHENTICATION:
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <circle cx="12" cy="16" r="1"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        );
      case ErrorType.AUTHORIZATION:
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        );
      case ErrorType.RATE_LIMIT:
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12,6 12,12 16,14"/>
          </svg>
        );
      case ErrorType.TIMEOUT:
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12,6 12,12 16,14"/>
          </svg>
        );
      case ErrorType.OFFLINE:
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
        );
      case ErrorType.VALIDATION:
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        );
      default:
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        );
    }
  };

  const getErrorSeverity = (type: ErrorType): 'error' | 'warning' | 'info' => {
    switch (type) {
      case ErrorType.SERVER_ERROR:
      case ErrorType.UNKNOWN:
        return 'error';
      case ErrorType.NETWORK:
      case ErrorType.TIMEOUT:
      case ErrorType.OFFLINE:
      case ErrorType.RATE_LIMIT:
        return 'warning';
      case ErrorType.VALIDATION:
      case ErrorType.AUTHENTICATION:
      case ErrorType.AUTHORIZATION:
        return 'info';
      default:
        return 'error';
    }
  };

  const severity = getErrorSeverity(error.type);

  return (
    <div className={`error-display error-display--${severity} ${className}`}>
      <div className="error-display__content">
        <div className="error-display__header">
          <div className="error-display__icon">
            {getErrorIcon(error.type)}
          </div>
          <div className="error-display__title-section">
            <h3 className="error-display__title">{error.title}</h3>
            <span className="error-display__type">{error.type}</span>
          </div>
          {onDismiss && (
            <button 
              className="error-display__dismiss"
              onClick={onDismiss}
              aria-label="Dismiss error"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        <p className="error-display__message">{error.message}</p>

        {error.suggestedAction && (
          <div className="error-display__suggestion">
            <strong>Suggested action:</strong> {error.suggestedAction}
          </div>
        )}

        {showTechnicalDetails && error.technicalDetails && (
          <details className="error-display__technical">
            <summary>Technical Details</summary>
            <pre className="error-display__technical-content">
              {error.technicalDetails}
            </pre>
          </details>
        )}

        {(onRetry && error.retryable) && (
          <div className="error-display__actions">
            <button 
              className="error-display__retry-button"
              onClick={onRetry}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};