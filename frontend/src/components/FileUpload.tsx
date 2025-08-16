import React, { useRef, useState } from 'react';
import './FileUpload.css';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  onError: (error: string) => void;
  acceptedTypes?: string[];
  maxSizeBytes?: number;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelect,
  onError,
  acceptedTypes = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg'],
  maxSizeBytes = 50 * 1024 * 1024 // 50MB
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    // Check file type
    if (!acceptedTypes.some(type => file.type.includes(type.split('/')[1]))) {
      return `File type not supported. Please upload: ${acceptedTypes.map(t => t.split('/')[1]).join(', ')}`;
    }

    // Check file size
    if (file.size > maxSizeBytes) {
      const maxSizeMB = Math.round(maxSizeBytes / (1024 * 1024));
      return `File too large. Maximum size is ${maxSizeMB}MB`;
    }

    return null;
  };

  const handleFileSelect = async (file: File) => {
    const error = validateFile(file);
    if (error) {
      onError(error);
      return;
    }

    setIsProcessing(true);
    
    try {
      await onFileSelect(file);
    } catch (error) {
      onError('Failed to process file. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="file-upload">
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedTypes.join(',')}
        onChange={handleFileInputChange}
        className="file-upload__input"
        disabled={isProcessing}
      />
      
      <div
        className={`file-upload__dropzone ${isDragOver ? 'file-upload__dropzone--drag-over' : ''} ${isProcessing ? 'file-upload__dropzone--processing' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        {isProcessing ? (
          <div className="file-upload__processing">
            <div className="file-upload__spinner" />
            <p>Processing audio file...</p>
          </div>
        ) : (
          <>
            <div className="file-upload__icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                <path d="M12,12L16,16H13V19H11V16H8L12,12Z" />
              </svg>
            </div>
            
            <div className="file-upload__content">
              <h3>Upload Audio File</h3>
              <p>Drag and drop an audio file here, or click to browse</p>
              
              <div className="file-upload__info">
                <div className="file-upload__supported-formats">
                  <strong>Supported formats:</strong> MP3, WAV, WebM, OGG, MP4
                </div>
                <div className="file-upload__max-size">
                  <strong>Max size:</strong> {formatFileSize(maxSizeBytes)}
                </div>
              </div>
            </div>
            
            <button className="file-upload__browse-button" type="button">
              Browse Files
            </button>
          </>
        )}
      </div>
    </div>
  );
};