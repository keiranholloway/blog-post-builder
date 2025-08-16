import React, { useState, useEffect } from 'react';
import { revisionService, RevisionHistory } from '../services/revisionService';
import './VersionHistory.css';

interface VersionHistoryProps {
  contentId: string;
  onRetryRevision?: (revisionId: string) => void;
  className?: string;
}

export const VersionHistory: React.FC<VersionHistoryProps> = ({
  contentId,
  onRetryRevision,
  className = ''
}) => {
  const [revisions, setRevisions] = useState<RevisionHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    contentRevisions: 0,
    imageRevisions: 0,
  });

  useEffect(() => {
    loadRevisionHistory();
    loadRevisionStats();
  }, [contentId]);

  const loadRevisionHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const history = await revisionService.getRevisionHistory(contentId);
      setRevisions(history.revisions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load revision history');
    } finally {
      setLoading(false);
    }
  };

  const loadRevisionStats = async () => {
    try {
      const revisionStats = await revisionService.getRevisionStats(contentId);
      setStats(revisionStats);
    } catch (err) {
      console.error('Error loading revision stats:', err);
    }
  };

  const handleRetryRevision = async (revisionId: string) => {
    try {
      await revisionService.retryRevision(contentId, revisionId);
      await loadRevisionHistory();
      await loadRevisionStats();
      
      if (onRetryRevision) {
        onRetryRevision(revisionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry revision');
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'processing':
        return '⚙️';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      default:
        return '❓';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending':
        return 'orange';
      case 'processing':
        return 'blue';
      case 'completed':
        return 'green';
      case 'failed':
        return 'red';
      default:
        return 'gray';
    }
  };

  const getRevisionTypeIcon = (type: string): string => {
    return type === 'content' ? '📝' : '🖼️';
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getTimeAgo = (timestamp: string): string => {
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  if (loading) {
    return (
      <div className={`version-history loading ${className}`}>
        <div className="loading-message">
          <div className="spinner"></div>
          <p>Loading revision history...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`version-history error ${className}`}>
        <div className="error-message">
          <h3>Error Loading History</h3>
          <p>{error}</p>
          <button onClick={loadRevisionHistory} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`version-history ${className}`}>
      {/* Statistics header */}
      <div className="history-header">
        <h3>Revision History</h3>
        <div className="stats-summary">
          <div className="stat-item">
            <span className="stat-number">{stats.total}</span>
            <span className="stat-label">Total</span>
          </div>
          <div className="stat-item">
            <span className="stat-number">{stats.completed}</span>
            <span className="stat-label">Completed</span>
          </div>
          <div className="stat-item">
            <span className="stat-number">{stats.pending}</span>
            <span className="stat-label">Pending</span>
          </div>
          {stats.failed > 0 && (
            <div className="stat-item failed">
              <span className="stat-number">{stats.failed}</span>
              <span className="stat-label">Failed</span>
            </div>
          )}
        </div>
      </div>

      {/* Revision timeline */}
      {revisions.length === 0 ? (
        <div className="empty-history">
          <p>No revisions yet</p>
          <small>Revisions will appear here when you request changes to content or images</small>
        </div>
      ) : (
        <div className="revision-timeline">
          {revisions.map((revision, index) => (
            <div key={revision.id} className="revision-entry">
              <div className="revision-marker">
                <div className={`marker-dot ${getStatusColor(revision.status)}`}>
                  {getStatusIcon(revision.status)}
                </div>
                {index < revisions.length - 1 && <div className="marker-line"></div>}
              </div>

              <div className="revision-content">
                <div className="revision-header">
                  <div className="revision-meta">
                    <span className="revision-type">
                      {getRevisionTypeIcon(revision.revisionType)}
                      {revision.revisionType === 'content' ? 'Content' : 'Image'} Revision
                    </span>
                    <span className="revision-time">
                      {getTimeAgo(revision.timestamp)}
                    </span>
                  </div>
                  
                  <div className="revision-status">
                    <span className={`status-badge ${getStatusColor(revision.status)}`}>
                      {getStatusIcon(revision.status)}
                      {revision.status}
                    </span>
                  </div>
                </div>

                <div className="revision-feedback">
                  <p>{revision.feedback}</p>
                </div>

                {revision.error && (
                  <div className="revision-error">
                    <strong>Error:</strong> {revision.error}
                  </div>
                )}

                {revision.result && (
                  <div className="revision-result">
                    <strong>Result:</strong>
                    <pre>{JSON.stringify(revision.result, null, 2)}</pre>
                  </div>
                )}

                <div className="revision-footer">
                  <span className="revision-timestamp">
                    {formatTimestamp(revision.timestamp)}
                  </span>
                  
                  {revision.status === 'failed' && (
                    <button
                      onClick={() => handleRetryRevision(revision.id)}
                      className="retry-revision-button"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary footer */}
      {revisions.length > 0 && (
        <div className="history-footer">
          <div className="revision-breakdown">
            <span className="breakdown-item">
              📝 {stats.contentRevisions} content revisions
            </span>
            <span className="breakdown-item">
              🖼️ {stats.imageRevisions} image revisions
            </span>
          </div>
        </div>
      )}
    </div>
  );
};