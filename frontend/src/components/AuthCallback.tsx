import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { authenticationService } from '../services/authenticationService';
import './AuthCallback.css';

export const AuthCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Processing authentication...');

  useEffect(() => {
    handleCallback();
  }, []);

  const handleCallback = async () => {
    try {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        throw new Error(`Authentication failed: ${error}`);
      }

      if (!code || !state) {
        throw new Error('Missing required parameters from OAuth callback');
      }

      const result = await authenticationService.handleCallback(code, state);

      if (result.success) {
        setStatus('success');
        setMessage('Authentication successful! You can close this window.');
        
        // Close the popup window after a short delay
        setTimeout(() => {
          window.close();
        }, 2000);
      } else {
        throw new Error(result.error || 'Authentication failed');
      }
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Authentication failed');
      
      // Close the popup window after showing error
      setTimeout(() => {
        window.close();
      }, 5000);
    }
  };

  return (
    <div className="auth-callback">
      <div className="auth-callback-content">
        <div className={`status-icon ${status}`}>
          {status === 'processing' && <div className="spinner"></div>}
          {status === 'success' && '✓'}
          {status === 'error' && '✗'}
        </div>
        
        <h2>
          {status === 'processing' && 'Connecting...'}
          {status === 'success' && 'Connected!'}
          {status === 'error' && 'Connection Failed'}
        </h2>
        
        <p>{message}</p>
        
        {status === 'success' && (
          <p className="close-instruction">
            This window will close automatically in a few seconds.
          </p>
        )}
        
        {status === 'error' && (
          <button onClick={() => window.close()} className="close-button">
            Close Window
          </button>
        )}
      </div>
    </div>
  );
};