import React, { useState, useEffect } from 'react';
import { BlogContent } from '../types/BlogContent';
import { contentGenerationService } from '../services/contentGenerationService';
import { imageGenerationService } from '../services/imageGenerationService';
import './ReviewInterface.css';

interface ReviewInterfaceProps {
  contentId: string;
  onContentRevision: (contentId: string, feedback: string) => void;
  onImageRevision: (contentId: string, feedback: string) => void;
  onApprove: (contentId: string) => void;
  className?: string;
}

interface ProcessingStatus {
  content: 'idle' | 'processing' | 'completed' | 'error';
  image: 'idle' | 'processing' | 'completed' | 'error';
}

export const ReviewInterface: React.FC<ReviewInterfaceProps> = ({
  contentId,
  onContentRevision,
  onImageRevision,
  onApprove,
  className = ''
}) => {
  const [content, setContent] = useState<BlogContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    content: 'idle',
    image: 'idle'
  });

  // Feedback states
  const [contentFeedback, setContentFeedback] = useState('');
  const [imageFeedback, setImageFeedback] = useState('');
  const [showContentFeedback, setShowContentFeedback] = useState(false);
  const [showImageFeedback, setShowImageFeedback] = useState(false);

  useEffect(() => {
    loadContent();
    // Poll for status updates
    const interval = setInterval(checkProcessingStatus, 3000);
    return () => clearInterval(interval);
  }, [contentId]);

  const loadContent = async () => {
    try {
      setLoading(true);
      setError(null);
      const blogContent = await contentGenerationService.getGeneratedContent(contentId);
      setContent(blogContent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content');
    } finally {
      setLoading(false);
    }
  };

  const checkProcessingStatus = async () => {
    if (!content) return;

    try {
      const status = await contentGenerationService.getContentStatus(contentId);
      
      setProcessingStatus(prev => ({
        content: status.status.includes('content') ? 
          (status.status.includes('processing') ? 'processing' : 'completed') : prev.content,
        image: status.status.includes('image') ? 
          (status.status.includes('processing') ? 'processing' : 'completed') : prev.image
      }));

      // Reload content if processing is complete
      if (status.status === 'ready' || status.status === 'completed') {
        await loadContent();
      }
    } catch (err) {
      console.error('Error checking status:', err);
    }
  };

  const handleContentRevision = async () => {
    if (!contentFeedback.trim()) return;

    try {
      setProcessingStatus(prev => ({ ...prev, content: 'processing' }));
      await onContentRevision(contentId, contentFeedback);
      setContentFeedback('');
      setShowContentFeedback(false);
    } catch (err) {
      setProcessingStatus(prev => ({ ...prev, content: 'error' }));
      setError(err instanceof Error ? err.message : 'Failed to submit content feedback');
    }
  };

  const handleImageRevision = async () => {
    if (!imageFeedback.trim()) return;

    try {
      setProcessingStatus(prev => ({ ...prev, image: 'processing' }));
      await onImageRevision(contentId, imageFeedback);
      setImageFeedback('');
      setShowImageFeedback(false);
    } catch (err) {
      setProcessingStatus(prev => ({ ...prev, image: 'error' }));
      setError(err instanceof Error ? err.message : 'Failed to submit image feedback');
    }
  };

  const handleApprove = async () => {
    try {
      await onApprove(contentId);
      await loadContent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve content');
    }
  };

  if (loading) {
    return (
      <div className={`review-interface loading ${className}`}>
        <div className="loading-message">
          <div className="spinner"></div>
          <p>Loading content for review...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`review-interface error ${className}`}>
        <div className="error-message">
          <h3>Error Loading Content</h3>
          <p>{error}</p>
          <button onClick={loadContent} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className={`review-interface empty ${className}`}>
        <p>No content available for review</p>
      </div>
    );
  }

  const isProcessing = processingStatus.content === 'processing' || processingStatus.image === 'processing';
  const canApprove = content.status === 'ready' && !isProcessing;

  return (
    <div className={`review-interface ${className}`}>
      {/* Header with overall status and actions */}
      <div className="review-header">
        <div className="content-info">
          <h2>Review Blog Post</h2>
          <div className="status-indicators">
            <span className={`status-indicator content ${processingStatus.content}`}>
              Content: {processingStatus.content}
            </span>
            {content.imageUrl && (
              <span className={`status-indicator image ${processingStatus.image}`}>
                Image: {processingStatus.image}
              </span>
            )}
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={handleApprove}
            className="approve-button"
            disabled={!canApprove}
          >
            {content.status === 'approved' ? 'Approved' : 'Approve & Publish'}
          </button>
        </div>
      </div>

      {/* Side-by-side content and image review */}
      <div className="review-content">
        {/* Content panel */}
        <div className="content-panel">
          <div className="panel-header">
            <h3>Blog Content</h3>
            <div className="panel-actions">
              <button 
                onClick={() => setShowContentFeedback(!showContentFeedback)}
                className="feedback-toggle-button"
                disabled={processingStatus.content === 'processing'}
              >
                {showContentFeedback ? 'Cancel' : 'Provide Feedback'}
              </button>
            </div>
          </div>

          <div className="content-display">
            {content.title && (
              <h1 className="content-title">{content.title}</h1>
            )}
            
            <div className="content-body">
              {content.currentDraft.split('\n').map((paragraph, index) => (
                paragraph.trim() && (
                  <p key={index} className="content-paragraph">
                    {paragraph}
                  </p>
                )
              ))}
            </div>

            {processingStatus.content === 'processing' && (
              <div className="processing-overlay">
                <div className="processing-message">
                  <div className="spinner small"></div>
                  <p>Revising content...</p>
                </div>
              </div>
            )}
          </div>

          {/* Content feedback form */}
          {showContentFeedback && (
            <div className="feedback-form">
              <textarea
                value={contentFeedback}
                onChange={(e) => setContentFeedback(e.target.value)}
                placeholder="Describe what changes you'd like to see in the content..."
                className="feedback-textarea"
                rows={4}
              />
              <div className="feedback-actions">
                <button 
                  onClick={() => setShowContentFeedback(false)}
                  className="cancel-button"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleContentRevision}
                  className="submit-button"
                  disabled={!contentFeedback.trim()}
                >
                  Submit Content Feedback
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Image panel */}
        {content.imageUrl && (
          <div className="image-panel">
            <div className="panel-header">
              <h3>Blog Image</h3>
              <div className="panel-actions">
                <button 
                  onClick={() => setShowImageFeedback(!showImageFeedback)}
                  className="feedback-toggle-button"
                  disabled={processingStatus.image === 'processing'}
                >
                  {showImageFeedback ? 'Cancel' : 'Provide Feedback'}
                </button>
              </div>
            </div>

            <div className="image-display">
              <img 
                src={content.imageUrl} 
                alt={content.title || 'Blog post image'}
                className="review-image"
              />

              {processingStatus.image === 'processing' && (
                <div className="processing-overlay">
                  <div className="processing-message">
                    <div className="spinner small"></div>
                    <p>Generating new image...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Image feedback form */}
            {showImageFeedback && (
              <div className="feedback-form">
                <textarea
                  value={imageFeedback}
                  onChange={(e) => setImageFeedback(e.target.value)}
                  placeholder="Describe what changes you'd like to see in the image..."
                  className="feedback-textarea"
                  rows={4}
                />
                <div className="feedback-actions">
                  <button 
                    onClick={() => setShowImageFeedback(false)}
                    className="cancel-button"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleImageRevision}
                    className="submit-button"
                    disabled={!imageFeedback.trim()}
                  >
                    Submit Image Feedback
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Revision history */}
      {content.revisionHistory && content.revisionHistory.length > 0 && (
        <div className="revision-history">
          <h3>Revision History</h3>
          <div className="revision-timeline">
            {content.revisionHistory.map((revision, index) => (
              <div key={index} className="revision-entry">
                <div className="revision-marker"></div>
                <div className="revision-content">
                  <div className="revision-header">
                    <span className="revision-type">
                      {revision.type || 'Content'} Revision
                    </span>
                    <span className="revision-timestamp">
                      {new Date(revision.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="revision-feedback">{revision.feedback}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};