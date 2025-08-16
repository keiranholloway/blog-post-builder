import React, { useState, useEffect } from 'react';
import { BlogContent } from '../types/BlogContent';
import { contentGenerationService } from '../services/contentGenerationService';
import { imageGenerationService } from '../services/imageGenerationService';
import './BlogPostPreview.css';

interface BlogPostPreviewProps {
  contentId: string;
  onFeedback: (contentId: string, feedback: string, type: 'content' | 'image') => void;
  onApprove: (contentId: string) => void;
  className?: string;
}

export const BlogPostPreview: React.FC<BlogPostPreviewProps> = ({
  contentId,
  onFeedback,
  onApprove,
  className = ''
}) => {
  const [content, setContent] = useState<BlogContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'content' | 'image'>('content');
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  useEffect(() => {
    loadContent();
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

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) return;

    try {
      setIsSubmittingFeedback(true);
      await onFeedback(contentId, feedbackText, feedbackType);
      setFeedbackText('');
      setShowFeedbackForm(false);
      // Reload content to get updated status
      await loadContent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setIsSubmittingFeedback(false);
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

  const openFeedbackForm = (type: 'content' | 'image') => {
    setFeedbackType(type);
    setShowFeedbackForm(true);
    setFeedbackText('');
  };

  if (loading) {
    return (
      <div className={`blog-post-preview loading ${className}`}>
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading blog post...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`blog-post-preview error ${className}`}>
        <div className="error-message">
          <h3>Error Loading Content</h3>
          <p>{error}</p>
          <button onClick={loadContent} className="retry-button">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className={`blog-post-preview empty ${className}`}>
        <p>No content found</p>
      </div>
    );
  }

  return (
    <div className={`blog-post-preview ${className}`}>
      {/* Header with status and actions */}
      <div className="preview-header">
        <div className="status-info">
          <span className={`status-badge ${content.status}`}>
            {content.status.replace('_', ' ').toUpperCase()}
          </span>
          <span className="last-updated">
            Updated: {new Date(content.updatedAt).toLocaleString()}
          </span>
        </div>
        
        <div className="action-buttons">
          <button 
            onClick={() => openFeedbackForm('content')}
            className="feedback-button content-feedback"
            disabled={content.status === 'processing'}
          >
            Content Feedback
          </button>
          
          {content.imageUrl && (
            <button 
              onClick={() => openFeedbackForm('image')}
              className="feedback-button image-feedback"
              disabled={content.status === 'processing'}
            >
              Image Feedback
            </button>
          )}
          
          <button 
            onClick={handleApprove}
            className="approve-button"
            disabled={content.status === 'processing' || content.status === 'approved'}
          >
            {content.status === 'approved' ? 'Approved' : 'Approve & Publish'}
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="preview-content">
        {/* Image section */}
        {content.imageUrl && (
          <div className="image-section">
            <div className="image-container">
              <img 
                src={content.imageUrl} 
                alt={content.title || 'Blog post image'}
                className="blog-image"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
              <div className="image-overlay">
                <button 
                  onClick={() => openFeedbackForm('image')}
                  className="overlay-feedback-button"
                >
                  Provide Image Feedback
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Text content section */}
        <div className="text-content">
          {content.title && (
            <h1 className="blog-title">{content.title}</h1>
          )}
          
          <div className="blog-content">
            {content.currentDraft.split('\n').map((paragraph, index) => (
              paragraph.trim() && (
                <p key={index} className="content-paragraph">
                  {paragraph}
                </p>
              )
            ))}
          </div>

          {/* Content feedback overlay */}
          <div className="content-overlay">
            <button 
              onClick={() => openFeedbackForm('content')}
              className="overlay-feedback-button"
            >
              Provide Content Feedback
            </button>
          </div>
        </div>
      </div>

      {/* Revision history */}
      {content.revisionHistory && content.revisionHistory.length > 0 && (
        <div className="revision-history">
          <h3>Revision History</h3>
          <div className="revisions">
            {content.revisionHistory.map((revision, index) => (
              <div key={index} className="revision-item">
                <div className="revision-header">
                  <span className="revision-number">Revision {index + 1}</span>
                  <span className="revision-date">
                    {new Date(revision.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="revision-feedback">{revision.feedback}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback form modal */}
      {showFeedbackForm && (
        <div className="feedback-modal-overlay">
          <div className="feedback-modal">
            <div className="modal-header">
              <h3>
                Provide {feedbackType === 'content' ? 'Content' : 'Image'} Feedback
              </h3>
              <button 
                onClick={() => setShowFeedbackForm(false)}
                className="close-button"
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <p className="feedback-instructions">
                {feedbackType === 'content' 
                  ? 'Describe what changes you\'d like to see in the content. Be specific about tone, structure, or information that should be added or removed.'
                  : 'Describe what changes you\'d like to see in the image. Mention style, colors, composition, or subject matter adjustments.'
                }
              </p>
              
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder={`Enter your ${feedbackType} feedback here...`}
                className="feedback-textarea"
                rows={6}
                disabled={isSubmittingFeedback}
              />
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowFeedbackForm(false)}
                className="cancel-button"
                disabled={isSubmittingFeedback}
              >
                Cancel
              </button>
              <button 
                onClick={handleFeedbackSubmit}
                className="submit-feedback-button"
                disabled={!feedbackText.trim() || isSubmittingFeedback}
              >
                {isSubmittingFeedback ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};