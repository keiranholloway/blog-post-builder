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
  
  const MIN_RECORDING_DURATION = 2; // Minimum 2 seconds
  const MAX_RECORDING_DURATION = 180; // Maximum 3 minutes

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const actualDurationRef = useRef<number>(0);

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
    console.log('Cleaning up recording resources...');
    
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
    
    mediaRecorderRef.current = null;
    analyserRef.current = null;
    chunksRef.current = [];
    startTimeRef.current = null;
    actualDurationRef.current = 0;
    setIsRecording(false);
    setAudioLevel(0);
    setDuration(0);
  };

  const startRecording = async () => {
    try {
      // Request microphone access with better constraints
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 1
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

      // Determine the best MIME type for MediaRecorder
      // Start with formats supported by the backend
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/wav';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/mpeg';
          }
        }
      }

      console.log('Using MIME type:', mimeType);

      // Set up MediaRecorder with timeslice for regular data events
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: mimeType
      });

      mediaRecorderRef.current.ondataavailable = (event) => {
        console.log('Data available:', event.data.size, 'bytes');
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        console.log('Recording stopped. Total chunks:', chunksRef.current.length);
        const totalSize = chunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
        console.log('Total audio size:', totalSize, 'bytes');
        
        // Calculate actual duration from start time
        const actualDuration = startTimeRef.current 
          ? Math.floor((Date.now() - startTimeRef.current) / 1000)
          : actualDurationRef.current;
        
        console.log('Actual recording duration:', actualDuration, 'seconds');
        
        // Check minimum duration using actual duration
        if (actualDuration < MIN_RECORDING_DURATION) {
          onError(`Recording too short. Please record for at least ${MIN_RECORDING_DURATION} seconds.`);
          cleanup();
          return;
        }
        
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        console.log('Final blob size:', audioBlob.size, 'bytes');
        
        // Final validation
        if (audioBlob.size < 1024) {
          onError('Recording failed to capture audio data. Please try again.');
          cleanup();
          return;
        }
        
        onRecordingComplete(audioBlob, actualDuration);
        cleanup();
      };

      mediaRecorderRef.current.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        onError('Recording failed due to an error');
        cleanup();
      };

      // Start recording with timeslice to get regular data chunks
      mediaRecorderRef.current.start(1000); // Request data every 1 second
      setIsRecording(true);
      setDuration(0);
      
      // Record start time for accurate duration calculation
      startTimeRef.current = Date.now();
      actualDurationRef.current = 0;

      console.log('Recording started at:', new Date(startTimeRef.current).toISOString());

      // Start duration timer with auto-stop at max duration
      intervalRef.current = setInterval(() => {
        setDuration(prev => {
          const newDuration = prev + 1;
          actualDurationRef.current = newDuration;
          console.log('Timer tick:', newDuration, 'seconds');
          
          if (newDuration >= MAX_RECORDING_DURATION) {
            console.log('Maximum recording duration reached, stopping...');
            stopRecording();
          }
          return newDuration;
        });
      }, 1000);

      // Start audio level monitoring
      monitorAudioLevel();

    } catch (error) {
      console.error('Error starting recording:', error);
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          onError('Microphone access denied. Please allow microphone permissions and try again.');
        } else if (error.name === 'NotFoundError') {
          onError('No microphone found. Please connect a microphone and try again.');
        } else {
          onError(`Failed to start recording: ${error.message}`);
        }
      } else {
        onError('Failed to start recording. Please check microphone permissions.');
      }
      cleanup();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      console.log('stopRecording called - Stack trace:', new Error().stack);
      
      // Calculate final duration before stopping
      if (startTimeRef.current) {
        actualDurationRef.current = Math.floor((Date.now() - startTimeRef.current) / 1000);
        console.log('Final duration calculated:', actualDurationRef.current, 'seconds');
      }
      
      setIsRecording(false);
      setAudioLevel(0);
      
      // Stop the MediaRecorder first - this will trigger onstop
      if (mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      
      // Stop the timer - but don't clear refs yet, onstop needs them
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      
      // Stop audio level monitoring
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
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
          title={isRecording ? `Recording... (minimum ${MIN_RECORDING_DURATION}s)` : 'Start recording'}
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