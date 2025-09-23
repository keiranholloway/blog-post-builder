import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { ContentCard } from '../ContentCard';
import { BlogContent, ContentStatus } from '../../types/BlogContent';

// Mock StatusIndicator component
vi.mock('../StatusIndicator', () => ({
  StatusIndicator: ({ status, variant }: any) => (
    <span data-testid="status-indicator" data-status={status} data-variant={variant}>
      {status}
    </span>
  ),
}));

describe('ContentCard', () => {
  const mockContent: BlogContent = {
    id: 'content-123',
    userId: 'user-123',
    title: 'Test Blog Post',
    originalTranscription: 'This is the original transcription of the blog post',
    currentDraft: 'This is the current draft content of the blog post with more details',
    associatedImage: 'image-123',
    imageUrl: 'https://example.com/image.jpg',
    status: 'draft' as ContentStatus,
    revisionHistory: [
      {
        id: 'rev-1',
        contentId: 'content-123',
        version: 1,
        content: 'revision content',
        feedback: 'feedback',
        createdAt: new Date('2023-01-01T12:00:00Z'),
        timestamp: new Date('2023-01-01T12:00:00Z'),
        agentType: 'content',
        type: 'content',
      },
    ],
    publishingResults: [
      {
        platform: 'Medium',
        status: 'success',
        publishedUrl: 'https://medium.com/post',
        publishedAt: new Date('2023-01-02T10:00:00Z'),
      },
      {
        platform: 'LinkedIn',
        status: 'failed',
        error: 'Authentication failed',
      },
    ],
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-02T00:00:00Z'),
  };

  const defaultProps = {
    content: mockContent,
  };

  it('should render content card with basic information', () => {
    render(<ContentCard {...defaultProps} />);

    expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
    expect(screen.getByText(/This is the current draft content/)).toBeInTheDocument();
    expect(screen.getByTestId('status-indicator')).toBeInTheDocument();
  });

  it('should render untitled post when no title', () => {
    const contentWithoutTitle = { ...mockContent, title: undefined };
    render(<ContentCard content={contentWithoutTitle} />);

    expect(screen.getByText('Untitled Post')).toBeInTheDocument();
  });

  it('should truncate long preview text', () => {
    const longContent = 'A'.repeat(200);
    const contentWithLongText = { ...mockContent, currentDraft: longContent };
    render(<ContentCard content={contentWithLongText} />);

    const previewText = screen.getByText(/A+\.\.\./);
    expect(previewText.textContent?.length).toBeLessThan(200);
    expect(previewText.textContent).toMatch(/\.\.\.$/);
  });

  it('should display associated image when available', () => {
    render(<ContentCard {...defaultProps} />);

    const image = screen.getByAltText('Blog post preview');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', 'https://example.com/image.jpg');
  });

  it('should not display image section when no image', () => {
    const contentWithoutImage = { 
      ...mockContent, 
      associatedImage: undefined, 
      imageUrl: undefined 
    };
    render(<ContentCard content={contentWithoutImage} />);

    expect(screen.queryByAltText('Blog post preview')).not.toBeInTheDocument();
  });

  it('should display revision count', () => {
    render(<ContentCard {...defaultProps} />);

    expect(screen.getByText('1 revision')).toBeInTheDocument();
  });

  it('should display plural revisions correctly', () => {
    const contentWithMultipleRevisions = {
      ...mockContent,
      revisionHistory: [
        mockContent.revisionHistory[0],
        { ...mockContent.revisionHistory[0], id: 'rev-2', version: 2 },
      ],
    };
    render(<ContentCard content={contentWithMultipleRevisions} />);

    expect(screen.getByText('2 revisions')).toBeInTheDocument();
  });

  it('should display published platforms', () => {
    render(<ContentCard {...defaultProps} />);

    expect(screen.getByText('Published to: Medium')).toBeInTheDocument();
  });

  it('should display failed platforms', () => {
    render(<ContentCard {...defaultProps} />);

    expect(screen.getByText('Failed on: LinkedIn')).toBeInTheDocument();
  });

  it('should format dates correctly', () => {
    render(<ContentCard {...defaultProps} />);

    // Check for formatted dates (exact format may vary by locale)
    expect(screen.getByText(/Jan 1, 2023/)).toBeInTheDocument();
    expect(screen.getByText(/Jan 2, 2023/)).toBeInTheDocument();
  });

  it('should call onView when view button is clicked', () => {
    const mockOnView = jest.fn();
    render(<ContentCard {...defaultProps} onView={mockOnView} />);

    fireEvent.click(screen.getByText('View'));
    expect(mockOnView).toHaveBeenCalledWith('content-123');
  });

  it('should call onEdit when edit button is clicked for editable content', () => {
    const mockOnEdit = jest.fn();
    render(<ContentCard {...defaultProps} onEdit={mockOnEdit} />);

    fireEvent.click(screen.getByText('Edit'));
    expect(mockOnEdit).toHaveBeenCalledWith('content-123');
  });

  it('should not show edit button for published content', () => {
    const publishedContent = { ...mockContent, status: 'published' as ContentStatus };
    const mockOnEdit = jest.fn();
    render(<ContentCard content={publishedContent} onEdit={mockOnEdit} />);

    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('should show edit button for draft content', () => {
    const draftContent = { ...mockContent, status: 'draft' as ContentStatus };
    const mockOnEdit = jest.fn();
    render(<ContentCard content={draftContent} onEdit={mockOnEdit} />);

    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('should show edit button for ready_for_review content', () => {
    const reviewContent = { ...mockContent, status: 'ready_for_review' as ContentStatus };
    const mockOnEdit = jest.fn();
    render(<ContentCard content={reviewContent} onEdit={mockOnEdit} />);

    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('should show edit button for revision_requested content', () => {
    const revisionContent = { ...mockContent, status: 'revision_requested' as ContentStatus };
    const mockOnEdit = jest.fn();
    render(<ContentCard content={revisionContent} onEdit={mockOnEdit} />);

    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('should call onDelete when delete button is clicked', () => {
    const mockOnDelete = jest.fn();
    render(<ContentCard {...defaultProps} onDelete={mockOnDelete} />);

    fireEvent.click(screen.getByText('Delete'));
    expect(mockOnDelete).toHaveBeenCalledWith('content-123', 'Test Blog Post');
  });

  it('should call onDelete with "Untitled Post" when no title', () => {
    const contentWithoutTitle = { ...mockContent, title: undefined };
    const mockOnDelete = jest.fn();
    render(<ContentCard content={contentWithoutTitle} onDelete={mockOnDelete} />);

    fireEvent.click(screen.getByText('Delete'));
    expect(mockOnDelete).toHaveBeenCalledWith('content-123', 'Untitled Post');
  });

  it('should not render action buttons when callbacks not provided', () => {
    render(<ContentCard {...defaultProps} />);

    expect(screen.queryByText('View')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('should display correct status colors and text', () => {
    const statuses: Array<{ status: ContentStatus; expectedText: string; expectedColor: string }> = [
      { status: 'processing', expectedText: 'Processing', expectedColor: 'info' },
      { status: 'draft', expectedText: 'Draft', expectedColor: 'warning' },
      { status: 'ready_for_review', expectedText: 'Ready for Review', expectedColor: 'warning' },
      { status: 'published', expectedText: 'Published', expectedColor: 'success' },
      { status: 'failed', expectedText: 'Failed', expectedColor: 'error' },
      { status: 'completed', expectedText: 'Completed', expectedColor: 'success' },
    ];

    statuses.forEach(({ status, expectedText, expectedColor }) => {
      const { unmount } = render(
        <ContentCard content={{ ...mockContent, status }} />
      );

      const statusIndicator = screen.getByTestId('status-indicator');
      expect(statusIndicator).toHaveAttribute('data-status', expectedText);
      expect(statusIndicator).toHaveAttribute('data-variant', expectedColor);

      unmount();
    });
  });

  it('should handle content with no revision history', () => {
    const contentWithoutRevisions = { ...mockContent, revisionHistory: [] };
    render(<ContentCard content={contentWithoutRevisions} />);

    expect(screen.queryByText(/revision/)).not.toBeInTheDocument();
  });

  it('should handle content with no publishing results', () => {
    const contentWithoutPublishing = { ...mockContent, publishingResults: [] };
    render(<ContentCard content={contentWithoutPublishing} />);

    expect(screen.queryByText(/Published to:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed on:/)).not.toBeInTheDocument();
  });

  it('should use original transcription as preview when no current draft', () => {
    const contentWithoutDraft = { ...mockContent, currentDraft: '' };
    render(<ContentCard content={contentWithoutDraft} />);

    expect(screen.getByText(/This is the original transcription/)).toBeInTheDocument();
  });
});