import React, { useState } from 'react';
import { VoiceRecorder } from './VoiceRecorder';
import { TextInput } from './TextInput';
import { FileUpload } from './FileUpload';
import './InputInterface.css';

type InputMode = 'voice' | 'text' | 'file';

interface InputInterfaceProps {
  onContentSubmit: (content: string, type: 'text') => void;
  onAudioSubmit: (audioBlob: Blob, duration: number, type: 'voice' | 'file') => void;
  onError: (error: string) => void;
  apiUrl: string;
}

export const InputInterface: React.FC<InputInterfaceProps> = ({
  onContentSubmit,
  onAudioSubmit,
  onError,
  apiUrl
}) => {
  const [activeMode, setActiveMode] = useState<InputMode>('voice');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleVoiceRecordingComplete = async (audioBlob: Blob, duration: number) => {
    setIsProcessing(true);
    try {
      await onAudioSubmit(audioBlob, duration, 'voice');
    } catch (error) {
      onError('Failed to process voice recording');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTextSubmit = async (text: string) => {
    setIsProcessing(true);
    try {
      await onContentSubmit(text, 'text');
    } catch (error) {
      onError('Failed to process text input');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    setIsProcessing(true);
    try {
      // Convert File to Blob for consistency
      const audioBlob = new Blob([file], { type: file.type });
      await onAudioSubmit(audioBlob, 0, 'file'); // Duration unknown for uploaded files
    } catch (error) {
      onError('Failed to process uploaded file');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleError = (error: string) => {
    onError(error);
  };

  return (
    <div className="input-interface">
      <div className="input-interface__header">
        <h1>Create Your Blog Post</h1>
        <p>Choose how you'd like to share your ideas</p>
      </div>

      <div className="input-interface__mode-selector">
        <button
          className={`input-interface__mode-button ${activeMode === 'voice' ? 'input-interface__mode-button--active' : ''}`}
          onClick={() => setActiveMode('voice')}
          disabled={isProcessing}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            <line x1="12" x2="12" y1="19" y2="23" />
            <line x1="8" x2="16" y1="23" y2="23" />
          </svg>
          Voice
        </button>

        <button
          className={`input-interface__mode-button ${activeMode === 'text' ? 'input-interface__mode-button--active' : ''}`}
          onClick={() => setActiveMode('text')}
          disabled={isProcessing}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
          Text
        </button>

        <button
          className={`input-interface__mode-button ${activeMode === 'file' ? 'input-interface__mode-button--active' : ''}`}
          onClick={() => setActiveMode('file')}
          disabled={isProcessing}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
            <path d="M12,12L16,16H13V19H11V16H8L12,12Z" />
          </svg>
          Upload
        </button>
      </div>

      <div className="input-interface__content">
        {isProcessing && (
          <div className="input-interface__processing-overlay">
            <div className="input-interface__processing-content">
              <div className="input-interface__spinner" />
              <p>Processing your input...</p>
            </div>
          </div>
        )}

        {activeMode === 'voice' && (
          <div className="input-interface__mode-content">
            <VoiceRecorder
              onRecordingComplete={handleVoiceRecordingComplete}
              onError={handleError}
            />
            <div className="input-interface__mode-description">
              <h3>🎤 Voice Recording</h3>
              <p>Speak naturally for 1-3 minutes about your blog post ideas. The AI will transform your thoughts into a polished article.</p>
            </div>
          </div>
        )}

        {activeMode === 'text' && (
          <div className="input-interface__mode-content">
            <TextInput
              onSubmit={handleTextSubmit}
              onError={handleError}
            />
          </div>
        )}

        {activeMode === 'file' && (
          <div className="input-interface__mode-content">
            <FileUpload
              onFileSelect={handleFileSelect}
              onError={handleError}
            />
            <div className="input-interface__mode-description">
              <h3>📁 File Upload</h3>
              <p>Upload an existing audio recording of your ideas. Supported formats: MP3, WAV, WebM, OGG, MP4.</p>
            </div>
          </div>
        )}
      </div>

      <div className="input-interface__footer">
        <div className="input-interface__api-status">
          <div className="input-interface__api-indicator" />
          <span>Connected to API</span>
        </div>
      </div>
    </div>
  );
};