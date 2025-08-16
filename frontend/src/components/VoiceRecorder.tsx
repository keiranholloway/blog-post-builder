import React, { useState, useRef, useEffect } from 'react';
import './VoiceRecorder.css';

interface VoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onError: (error: string) => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onRecordingComplete,
  onError
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSupported, setIsSupported] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    // Check if MediaRecorder is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      setIsSupported(false);
      onError('Voice recording is not supported in this browser');
    }

    return () => {
      cleanup();
    };
  }, [onError]);

  const cleanup = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });
      
      streamRef.current = stream;
      chunksRef.current = [];

      // Set up audio analysis for visualization
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;

      // Set up MediaRecorder
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        onRecordingComplete(audioBlob, duration);
        cleanup();
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setDuration(0);

      // Start duration timer
      intervalRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

      // Start audio level monitoring
      monitorAudioLevel();

    } catch (error) {
      console.error('Error starting recording:', error);
      onError('Failed to start recording. Please check microphone permissions.');
      cleanup();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setAudioLevel(0);
    }
  };

  const monitorAudioLevel = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    
    const updateLevel = () => {
      if (!analyserRef.current || !isRecording) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
      setAudioLevel(average / 255); // Normalize to 0-1
      
      animationRef.current = requestAnimationFrame(updateLevel);
    };
    
    updateLevel();
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isSupported) {
    return (
      <div className="voice-recorder voice-recorder--unsupported">
        <p>Voice recording is not supported in this browser.</p>
        <p>Please try using Chrome, Firefox, or Safari.</p>
      </div>
    );
  }

  return (
    <div className="voice-recorder">
      <div className="voice-recorder__container">
        <div className="voice-recorder__visualizer">
          <div 
            className="voice-recorder__level-indicator"
            style={{ 
              transform: `scale(${1 + audioLevel * 0.5})`,
              opacity: isRecording ? 1 : 0.3
            }}
          />
          <div className="voice-recorder__pulse-ring" />
        </div>
        
        <button
          className={`voice-recorder__button ${isRecording ? 'voice-recorder__button--recording' : ''}`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!isSupported}
        >
          {isRecording ? (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
              <line x1="12" x2="12" y1="19" y2="23" />
              <line x1="8" x2="16" y1="23" y2="23" />
            </svg>
          )}
        </button>

        <div className="voice-recorder__status">
          {isRecording ? (
            <div className="voice-recorder__recording-status">
              <span className="voice-recorder__recording-dot" />
              <span>Recording: {formatDuration(duration)}</span>
            </div>
          ) : (
            <span>Tap to start recording</span>
          )}
        </div>
      </div>
    </div>
  );
};