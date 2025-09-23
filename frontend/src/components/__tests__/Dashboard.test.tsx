import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Dashboard } from '../Dashboard';
import { dashboardService } from '../../services/dashboardService';
import { BlogContent, ContentStatus } from '../../types/BlogContent';

// Mock the dashboard service
vi.mock('../../services/dashboardService');
const mockDashboardService = dashboardService as any;

// Mock child components to simplify testing
vi.mock('../ContentCard', () => ({
  ContentCard: ({ content, onEdit, onView, onDelete }: any) => (
    <div data-testid={`content-card-${content.id}`}>
      <h3>{content.title}</h3>
      <p>{content.status}</p>
      {onEdit && <button onClick={() => onEdit(content.id)}>Edit</button>}
      {onView && <button onClick={() => onView(content.id)}>View</button>}
      {onDelete && <button onClick={() => onDelete(content.id, content.title)}>Delete</button>}
    </div>
  ),
}));

vi.mock('../SearchAndFilter', () => ({
  SearchAndFilter: ({ onFiltersChange }: any) => (
    <div data-testid="search-filter">
      <button onClick={() => onFiltersChange({ searchQuery: 'test' })}>
        Apply Filter
      </button>
    </div>
  ),
}));

vi.mock('../DashboardStats', () => ({
  DashboardStats: ({ stats }: any) => (
    <div data-testid="dashboard-stats">
      <span>Total: {stats.totalPosts}</span>
    </div>
  ),
}));

vi.mock('../ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, onConfirm, onCancel }: any) =>
    isOpen ? (
      <div data-testid="confirmation-dialog">
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

vi.mock('../LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
}));

describe('Dashboard', () => {
  const mockContent: BlogContent[] = [
    {
      id: 'content-1',
      userId: 'user-123',
      title: 'First Post',
      originalTranscription: 'Original text',
      currentDraft: 'Draft content',
      status: 'draft' as ContentStatus,
      revisionHistory: [],
      publishingResults: [],
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-02'),
    },
    {
      id: 'content-2',
      userId: 'user-123',
      title: 'Second Post',
      originalTranscription: 'Original text 2',
      currentDraft: 'Draft content 2',
      status: 'published' as ContentStatus,
      revisionHistory: [],
      publishingResults: [],
      createdAt: new Date('2023-01-03'),
      updatedAt: new Date('2023-01-04'),
    },
  ];

  const mockStats = {
    totalPosts: 10,
    publishedPosts: 7,
    draftPosts: 2,
    failedPosts: 1,
    recentActivity: 5,
  };

  const mockPaginatedResponse = {
    items: mockContent,
    totalCount: 2,
    page: 1,
    pageSize: 10,
    hasMore: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardService.getRecentContent.mockResolvedValue(mockPaginatedResponse);
    mockDashboardService.getDashboardStats.mockResolvedValue(mockStats);
    mockDashboardService.getDrafts.mockResolvedValue(mockPaginatedResponse);
    mockDashboardService.getPublishedPosts.mockResolvedValue(mockPaginatedResponse);
    mockDashboardService.deleteContent.mockResolvedValue();
  });

  const defaultProps = {
    userId: 'user-123',
  };

  it('should render dashboard with content and stats', async () => {
    render(<Dashboard {...defaultProps} />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Check that dashboard elements are rendered
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-stats')).toBeInTheDocument();
    expect(screen.getByText('Total: 10')).toBeInTheDocument();

    // Check that content cards are rendered
    expect(screen.getByTestId('content-card-content-1')).toBeInTheDocument();
    expect(screen.getByTestId('content-card-content-2')).toBeInTheDocument();
    expect(screen.getByText('First Post')).toBeInTheDocument();
    expect(screen.getByText('Second Post')).toBeInTheDocument();
  });

  it('should show loading spinner initially', () => {
    render(<Dashboard {...defaultProps} />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('should handle tab switching', async () => {
    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Click on drafts tab
    const draftsTab = screen.getByText('Drafts');
    fireEvent.click(draftsTab);

    await waitFor(() => {
      expect(mockDashboardService.getDrafts).toHaveBeenCalledWith('user-123', 1, 10);
    });

    // Click on published tab
    const publishedTab = screen.getByText('Published');
    fireEvent.click(publishedTab);

    await waitFor(() => {
      expect(mockDashboardService.getPublishedPosts).toHaveBeenCalledWith('user-123', 1, 10);
    });

    // Click back to all content tab
    const allTab = screen.getByText('All Content');
    fireEvent.click(allTab);

    await waitFor(() => {
      expect(mockDashboardService.getRecentContent).toHaveBeenCalledWith('user-123', 1, 10, {});
    });
  });

  it('should handle filter changes', async () => {
    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Apply a filter
    const applyFilterButton = screen.getByText('Apply Filter');
    fireEvent.click(applyFilterButton);

    await waitFor(() => {
      expect(mockDashboardService.getRecentContent).toHaveBeenCalledWith(
        'user-123',
        1,
        10,
        { searchQuery: 'test' }
      );
    });
  });

  it('should handle refresh button', async () => {
    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Clear previous calls
    vi.clearAllMocks();
    mockDashboardService.getRecentContent.mockResolvedValue(mockPaginatedResponse);
    mockDashboardService.getDashboardStats.mockResolvedValue(mockStats);

    // Click refresh
    const refreshButton = screen.getByText('Refresh');
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(mockDashboardService.getRecentContent).toHaveBeenCalledWith('user-123', 1, 10);
      expect(mockDashboardService.getDashboardStats).toHaveBeenCalledWith('user-123');
    });
  });

  it('should handle load more functionality', async () => {
    const mockResponseWithMore = {
      ...mockPaginatedResponse,
      hasMore: true,
    };

    mockDashboardService.getRecentContent.mockResolvedValueOnce(mockResponseWithMore);

    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Should show load more button
    expect(screen.getByText('Load More')).toBeInTheDocument();

    // Mock second page response
    mockDashboardService.getRecentContent.mockResolvedValueOnce({
      items: [mockContent[0]],
      totalCount: 3,
      page: 2,
      pageSize: 10,
      hasMore: false,
    });

    // Click load more
    fireEvent.click(screen.getByText('Load More'));

    await waitFor(() => {
      expect(mockDashboardService.getRecentContent).toHaveBeenCalledWith('user-123', 2, 10, {});
    });
  });

  it('should handle content deletion', async () => {
    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Click delete on first content
    const deleteButton = screen.getAllByText('Delete')[0];
    fireEvent.click(deleteButton);

    // Confirmation dialog should appear
    expect(screen.getByTestId('confirmation-dialog')).toBeInTheDocument();

    // Confirm deletion
    fireEvent.click(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(mockDashboardService.deleteContent).toHaveBeenCalledWith('content-1');
    });
  });

  it('should handle content deletion cancellation', async () => {
    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Click delete on first content
    const deleteButton = screen.getAllByText('Delete')[0];
    fireEvent.click(deleteButton);

    // Confirmation dialog should appear
    expect(screen.getByTestId('confirmation-dialog')).toBeInTheDocument();

    // Cancel deletion
    fireEvent.click(screen.getByText('Cancel'));

    // Dialog should disappear
    await waitFor(() => {
      expect(screen.queryByTestId('confirmation-dialog')).not.toBeInTheDocument();
    });

    // Delete should not have been called
    expect(mockDashboardService.deleteContent).not.toHaveBeenCalled();
  });

  it('should call onEditContent when edit is clicked', async () => {
    const mockOnEdit = vi.fn();
    render(<Dashboard {...defaultProps} onEditContent={mockOnEdit} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Click edit on first content
    const editButton = screen.getAllByText('Edit')[0];
    fireEvent.click(editButton);

    expect(mockOnEdit).toHaveBeenCalledWith('content-1');
  });

  it('should call onViewContent when view is clicked', async () => {
    const mockOnView = vi.fn();
    render(<Dashboard {...defaultProps} onViewContent={mockOnView} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Click view on first content
    const viewButton = screen.getAllByText('View')[0];
    fireEvent.click(viewButton);

    expect(mockOnView).toHaveBeenCalledWith('content-1');
  });

  it('should show empty state when no content', async () => {
    mockDashboardService.getRecentContent.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 10,
      hasMore: false,
    });

    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    expect(screen.getByText('No content found')).toBeInTheDocument();
    expect(screen.getByText(/You don't have any content yet/)).toBeInTheDocument();
  });

  it('should show different empty messages for different tabs', async () => {
    mockDashboardService.getDrafts.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 10,
      hasMore: false,
    });

    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
    });

    // Switch to drafts tab
    fireEvent.click(screen.getByText('Drafts'));

    await waitFor(() => {
      expect(screen.getByText(/You don't have any drafts yet/)).toBeInTheDocument();
    });
  });

  it('should handle API errors gracefully', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDashboardService.getRecentContent.mockRejectedValue(new Error('API Error'));

    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('API Error')).toBeInTheDocument();
    });

    consoleError.mockRestore();
  });

  it('should dismiss error messages', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDashboardService.getRecentContent.mockRejectedValue(new Error('API Error'));

    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('API Error')).toBeInTheDocument();
    });

    // Dismiss error
    fireEvent.click(screen.getByText('Dismiss'));

    expect(screen.queryByText('API Error')).not.toBeInTheDocument();

    consoleError.mockRestore();
  });
});