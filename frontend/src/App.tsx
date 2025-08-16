import React, { useState } from 'react';
import { InputInterface } from './components/InputInterface';
import './App.css';

// API URL from your deployed infrastructure
const API_URL = 'https://fqz86w2yp5.execute-api.eu-west-1.amazonaws.com/prod';

function App() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleContentSubmit = async (content: string, type: 'text') => {
    console.log('Text content submitted:', content);
    // TODO: Send to API for processing
    setSuccess('Text content received! Processing will be implemented in the next task.');
  };

  const handleAudioSubmit = async (audioBlob: Blob, duration: number, type: 'voice' | 'file') => {
    console.log('Audio submitted:', { size: audioBlob.size, duration, type });
    // TODO: Send to API for processing
    setSuccess(`Audio ${type} received! Processing will be implemented in the next task.`);
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

      <main className="App__main">
        <InputInterface
          onContentSubmit={handleContentSubmit}
          onAudioSubmit={handleAudioSubmit}
          onError={handleError}
          apiUrl={API_URL}
        />
      </main>
    </div>
  );
}

export default App;