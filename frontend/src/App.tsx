import React, { useState } from 'react';
import { VoiceRecorder } from './components/VoiceRecorder';
import './App.css';

function App() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleRecordingComplete = (audioBlob: Blob, duration: number) => {
    console.log('Recording completed:', audioBlob.size, 'bytes,', duration, 'seconds');
    setSuccess(`Recording completed! ${duration} seconds, ${audioBlob.size} bytes`);
    setError(null);
  };

  const handleError = (errorMessage: string) => {
    console.error('Recording error:', errorMessage);
    setError(errorMessage);
    setSuccess(null);
  };

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Voice Recorder Test</h1>
        
        {error && (
          <div style={{ color: 'red', margin: '10px', padding: '10px', border: '1px solid red' }}>
            <span>{error}</span>
            <button onClick={clearMessages} style={{ marginLeft: '10px' }}>×</button>
          </div>
        )}
        
        {success && (
          <div style={{ color: 'green', margin: '10px', padding: '10px', border: '1px solid green' }}>
            <span>{success}</span>
            <button onClick={clearMessages} style={{ marginLeft: '10px' }}>×</button>
          </div>
        )}

        <VoiceRecorder
          onRecordingComplete={handleRecordingComplete}
          onError={handleError}
        />
      </header>
    </div>
  );
}

export default App;