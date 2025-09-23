import React from 'react';
import { BlogContent, ContentStatus } from '../types/BlogContent';
import StatusIndicator from './StatusIndicator';
import './ContentCard.css';

interface ContentCardProps {
  content: BlogContent;
  onEdit?: (contentId: string) => void;
  onView?: (contentId: string) => void;
  onDelete?: (contentId: string, title: string) => void;
}

export const ContentCard: React.FC<ContentCardProps> = ({
  content,
  onEdit,
  onView,
  onDelete,
}) => {
  const getStatusColor = (status: ContentStatus): string => {
    switch (status) {
      case 'published':
      case 'completed':
        return 'success';
      case 'draft':
      case 'ready_for_review':
        return 'warning';
      case 'processing':
      case 'publishing':
        return 'info';
      case 'failed':
        return 'error';
      case 'revision_requested':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusText = (status: ContentStatus): string => {
    switch (status) {
      case 'processing':
        return 'Processing';
      case 'draft':
        return 'Draft';
      case 'ready_for_review':
        return 'Ready for Review';
      case 'ready':
        return 'Ready';
      case 'revision_requested':
        return 'Revision Requested';
      case 'approved':
        return 'Approved';
      case 'publishing':
        return 'Publishing';
      case 'published':
        return 'Published';
      case 'failed':
        return 'Failed';
      case 'completed':
        return 'Completed';
      default:
        return status;
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getPreviewText = (text: string, maxLength: number = 150): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  };

  const getPublishedPlatforms = (): string[] => {
    return content.publishingResults
      .filter(result => result.status === 'success')
      .map(result => result.platform);
  };

  const getFailedPlatforms = (): string[] => {
    return content.publishingResults
      .filter(result => result.status === 'failed')
      .map(result => result.platform);
  };

  const publishedPlatforms = getPublishedPlatforms();
  const failedPlatforms = getFailedPlatforms();

  return (
    <div className="content-card">
      <div className="content-card__header">
        <div className="content-card__title-section">
          <h3 className="content-card__title">
            {content.title || 'Untitled Post'}
          </h3>
          <StatusIndicator 
            status={getStatusText(content.status)}
            variant={getStatusColor(content.status)}
          />
        </div>
        <div className="content-card__date">
          {formatDate(content.updatedAt)}
        </div>
      </div>

      <div className="content-card__content">
        <p className="content-card__preview">
          {getPreviewText(content.currentDraft || content.originalTranscription)}
        </p>

        {content.associatedImage && (
          <div className="content-card__image">
            <img 
              src={content.imageUrl || content.associatedImage} 
              alt="Blog post preview"
              className="content-card__image-preview"
            />
          </div>
        )}
      </div>

      <div className="content-card__meta">
        <div className="content-card__stats">
          {content.revisionHistory.length > 0 && (
            <span className="content-card__stat">
              {content.revisionHistory.length} revision{content.revisionHistory.length !== 1 ? 's' : ''}
            </span>
          )}
          
          {publishedPlatforms.length > 0 && (
            <span className="content-card__stat content-card__stat--success">
              Published to: {publishedPlatforms.join(', ')}
            </span>
          )}
          
          {failedPlatforms.length > 0 && (
            <span className="content-card__stat content-card__stat--error">
              Failed on: {failedPlatforms.join(', ')}
            </span>
          )}
        </div>

        <div className="content-card__created">
          Created {formatDate(content.createdAt)}
        </div>
      </div>

      <div className="content-card__actions">
        {onView && (
          <button
            className="content-card__action content-card__action--view"
            onClick={() => onView(content.id)}
          >
            View
          </button>
        )}
        
        {onEdit && (content.status === 'draft' || content.status === 'ready_for_review' || content.status === 'revision_requested') && (
          <button
            className="content-card__action content-card__action--edit"
            onClick={() => onEdit(content.id)}
          >
            Edit
          </button>
        )}
        
        {onDelete && (
          <button
            className="content-card__action content-card__action--delete"
            onClick={() => onDelete(content.id, content.title || 'Untitled Post')}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};