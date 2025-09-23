import React, { useState } from 'react';
import { InputInterface } from './components/InputInterface';
import { inputProcessingService } from './services/inputProcessingService';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import OfflineStatus from './components/OfflineStatus';
import usePWA from './hooks/usePWA';
import './App.css';

// API URL from your deployed infrastructure
const API_URL = 'https://fqz86w2yp5.execute-api.eu-west-1.amazonaws.com/prod';

function App() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  // PWA functionality
  const pwa = usePWA();

  // Mock user ID - in a real app, this would come from authentication
  const userId = 'demo-user-123';

  const handleContentSubmit = async (content: string, type: 'text') => {
    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setProcessingStatus('Validating text...');

    try {
      // Validate text input
      const validation = inputProcessingService.validateTextInput(content);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      setProcessingStatus('Processing text...');
      
      // Process text
      const response = await inputProcessingService.processText(content, userId);
      const { transcription } = response.data!;
      
      setSuccess(`Text processed successfully! Processed text: "${transcription}"`);
      setProcessingStatus('');
    } catch (err) {
      console.error('Text processing error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process text. Please try again.');
      setProcessingStatus('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAudioSubmit = async (audioBlob: Blob, duration: number, type: 'voice' | 'file') => {
    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setProcessingStatus('Validating audio...');

    try {
      // Validate audio file
      const validation = inputProcessingService.validateAudioFile(audioBlob);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      setProcessingStatus('Uploading audio...');
      
      // Process audio
      const response = await inputProcessingService.processAudio(audioBlob, userId);
      const { inputId } = response.data!;

      setProcessingStatus('Processing audio (this may take a moment)...');

      // Wait for completion
      const completedResult = await inputProcessingService.waitForCompletion(inputId);
      
      setSuccess(`Audio processed successfully! Transcription: "${completedResult.transcription}"`);
      setProcessingStatus('');
    } catch (err) {
      console.error('Audio processing error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process audio. Please try again.');
      setProcessingStatus('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleError = (errorMessage: string) => {
    setError(errorMessage);
    // Clear error after 5 seconds
    setTimeout(() => setError(null), 5000);
  };

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="App">
      {/* PWA Components */}
      <PWAInstallPrompt />
      <PWAUpdatePrompt />
      <OfflineStatus />

      {error && (
        <div className="App__notification App__notification--error">
          <span>{error}</span>
          <button onClick={clearMessages} className="App__notification-close">×</button>
        </div>
      )}
      
      {success && (
        <div className="App__notification App__notification--success">
          <span>{success}</span>
          <button onClick={clearMessages} className="App__notification-close">×</button>
        </div>
      )}

      {processingStatus && (
        <div className="App__notification App__notification--info">
          <span>{processingStatus}</span>
        </div>
      )}

      {/* Show sync queue status when offline */}
      {!pwa.isOnline && pwa.queueLength > 0 && (
        <div className="App__notification App__notification--warning">
          <span>{pwa.queueLength} action(s) queued for when you're back online</span>
        </div>
      )}

      <main className="App__main">
        <InputInterface
          onContentSubmit={handleContentSubmit}
          onAudioSubmit={handleAudioSubmit}
          onError={handleError}
          apiUrl={API_URL}
          isProcessing={isProcessing}
        />
      </main>
    </div>
  );
}

export default App;