import React, { useState, useEffect, useCallback } from 'react';
import { BlogContent, ContentStatus } from '../types/BlogContent';
import { dashboardService, DashboardStats, DashboardFilters, PaginatedResponse } from '../services/dashboardService';
import { ContentCard } from './ContentCard';
import { SearchAndFilter } from './SearchAndFilter';
import { DashboardStats as StatsComponent } from './DashboardStats';
import { ConfirmationDialog } from './ConfirmationDialog';
import { LoadingSpinner } from './LoadingSpinner';
import './Dashboard.css';

interface DashboardProps {
  userId: string;
  onEditContent?: (contentId: string) => void;
  onViewContent?: (contentId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  userId,
  onEditContent,
  onViewContent,
}) => {
  const [content, setContent] = useState<BlogContent[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    contentId: string;
    title: string;
  }>({ isOpen: false, contentId: '', title: '' });
  const [activeTab, setActiveTab] = useState<'all' | 'drafts' | 'published'>('all');

  const pageSize = 10;

  const loadContent = useCallback(async (page: number = 1, newFilters?: DashboardFilters) => {
    try {
      setLoading(true);
      setError(null);

      let response: PaginatedResponse<BlogContent>;
      const filtersToUse = newFilters || filters;

      switch (activeTab) {
        case 'drafts':
          response = await dashboardService.getDrafts(userId, page, pageSize);
          break;
        case 'published':
          response = await dashboardService.getPublishedPosts(userId, page, pageSize);
          break;
        default:
          response = await dashboardService.getRecentContent(userId, page, pageSize, filtersToUse);
      }

      if (page === 1) {
        setContent(response.items);
      } else {
        setContent(prev => [...prev, ...response.items]);
      }

      setCurrentPage(page);
      setTotalPages(Math.ceil(response.totalCount / pageSize));
      setHasMore(response.hasMore);
    } catch (err) {
      console.error('Error loading content:', err);
      setError(err instanceof Error ? err.message : 'Failed to load content');
    } finally {
      setLoading(false);
    }
  }, [userId, filters, activeTab]);

  const loadStats = useCallback(async () => {
    try {
      const statsData = await dashboardService.getDashboardStats(userId);
      setStats(statsData);
    } catch (err) {
      console.error('Error loading stats:', err);
      // Don't set error for stats failure, just log it
    }
  }, [userId]);

  useEffect(() => {
    loadContent(1);
    loadStats();
  }, [loadContent, loadStats]);

  const handleFilterChange = (newFilters: DashboardFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);
    loadContent(1, newFilters);
  };

  const handleTabChange = (tab: 'all' | 'drafts' | 'published') => {
    setActiveTab(tab);
    setCurrentPage(1);
    setFilters({}); // Clear filters when changing tabs
  };

  const handleLoadMore = () => {
    if (hasMore && !loading) {
      loadContent(currentPage + 1);
    }
  };

  const handleDeleteClick = (contentId: string, title: string) => {
    setDeleteConfirmation({
      isOpen: true,
      contentId,
      title: title || 'Untitled Post',
    });
  };

  const handleDeleteConfirm = async () => {
    try {
      await dashboardService.deleteContent(deleteConfirmation.contentId);
      
      // Remove from local state
      setContent(prev => prev.filter(item => item.id !== deleteConfirmation.contentId));
      
      // Reload stats
      loadStats();
      
      setDeleteConfirmation({ isOpen: false, contentId: '', title: '' });
    } catch (err) {
      console.error('Error deleting content:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete content');
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmation({ isOpen: false, contentId: '', title: '' });
  };

  const handleRefresh = () => {
    setCurrentPage(1);
    loadContent(1);
    loadStats();
  };

  if (loading && content.length === 0) {
    return (
      <div className="dashboard">
        <div className="dashboard__loading">
          <LoadingSpinner />
          <p>Loading your content...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard__header">
        <h1 className="dashboard__title">Dashboard</h1>
        <button 
          className="dashboard__refresh-btn"
          onClick={handleRefresh}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="dashboard__error">
          <p>{error}</p>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {stats && <StatsComponent stats={stats} />}

      <div className="dashboard__tabs">
        <button
          className={`dashboard__tab ${activeTab === 'all' ? 'dashboard__tab--active' : ''}`}
          onClick={() => handleTabChange('all')}
        >
          All Content
        </button>
        <button
          className={`dashboard__tab ${activeTab === 'drafts' ? 'dashboard__tab--active' : ''}`}
          onClick={() => handleTabChange('drafts')}
        >
          Drafts
        </button>
        <button
          className={`dashboard__tab ${activeTab === 'published' ? 'dashboard__tab--active' : ''}`}
          onClick={() => handleTabChange('published')}
        >
          Published
        </button>
      </div>

      {activeTab === 'all' && (
        <SearchAndFilter
          filters={filters}
          onFiltersChange={handleFilterChange}
          loading={loading}
        />
      )}

      <div className="dashboard__content">
        {content.length === 0 && !loading ? (
          <div className="dashboard__empty">
            <h3>No content found</h3>
            <p>
              {activeTab === 'drafts' 
                ? "You don't have any drafts yet. Start by creating your first blog post!"
                : activeTab === 'published'
                ? "You haven't published any posts yet. Complete a draft and publish it!"
                : "You don't have any content yet. Start by creating your first blog post!"
              }
            </p>
          </div>
        ) : (
          <>
            <div className="dashboard__grid">
              {content.map((item) => (
                <ContentCard
                  key={item.id}
                  content={item}
                  onEdit={onEditContent}
                  onView={onViewContent}
                  onDelete={handleDeleteClick}
                />
              ))}
            </div>

            {hasMore && (
              <div className="dashboard__load-more">
                <button
                  className="dashboard__load-more-btn"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmationDialog
        isOpen={deleteConfirmation.isOpen}
        title="Delete Content"
        message={`Are you sure you want to delete "${deleteConfirmation.title}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        variant="danger"
      />
    </div>
  );
};