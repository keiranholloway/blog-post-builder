import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReviewInterface } from '../ReviewInterface';
import { contentGenerationService } from '../../services/contentGenerationService';

// Mock the StatusIndicator component
vi.mock('../StatusIndicator', () => ({
  StatusIndicator: ({ contentId, showDetails, className }: any) => (
    <div data-testid="status-indicator" className={className}>
      Status for {contentId} (details: {showDetails ? 'true' : 'false'})
    </div>
  )
}));

// Mock the InlineEditor component
vi.mock('../InlineEditor', () => ({
  InlineEditor: ({ value, onSave, placeholder, className, disabled }: any) => (
    <div 
      data-testid="inline-editor" 
      className={`${className} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && onSave && onSave('edited-' + value)}
    >
      {value || placeholder}
    </div>
  )
}));

// Mock the content generation service
vi.mock('../../services/contentGenerationService');

const mockContentGenerationService = vi.mocked(contentGenerationService);

describe('ReviewInterface', () => {
  const mockContent = {
    id: 'test-content-id',
    userId: 'test-user-id',
    title: 'Test Blog Post',
    currentDraft: 'This is a test blog post content.\n\nIt has multiple paragraphs.',
    imageUrl: 'https://example.com/test-image.jpg',
    status: 'ready',
    revisionHistory: [
      {
        timestamp: '2024-01-01T10:00:00Z',
        feedback: 'Please make it more engaging',
        type: 'content'
      }
    ],
    createdAt: '2024-01-01T09:00:00Z',
    updatedAt: '2024-01-01T10:30:00Z'
  };

  const defaultProps = {
    contentId: 'test-content-id',
    onContentRevision: vi.fn(),
    onImageRevision: vi.fn(),
    onApprove: vi.fn(),
    onInlineEdit: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock the status polling
    mockContentGenerationService.getContentStatus.mockResolvedValue({
      status: 'ready',
      progress: 100,
      estimatedTimeRemaining: 0
    });
  });

  describe('Loading State', () => {
    it('should show loading message while fetching content', () => {
      mockContentGenerationService.getGeneratedContent.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<ReviewInterface {...defaultProps} />);

      expect(screen.getByText('Loading content for review...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show error message when content fails to load', async () => {
      mockContentGenerationService.getGeneratedContent.mockRejectedValue(
        new Error('Failed to load content')
      );

      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Error Loading Content')).toBeInTheDocument();
        expect(screen.getByText('Failed to load content')).toBeInTheDocument();
      });
    });
  });

  describe('Content Display', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should display review interface with content and image panels', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Review Blog Post')).toBeInTheDocument();
        expect(screen.getByText('Blog Content')).toBeInTheDocument();
        expect(screen.getByText('Blog Image')).toBeInTheDocument();
      });
    });

    it('should display blog post title and content in inline editors', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const inlineEditors = screen.getAllByTestId('inline-editor');
        expect(inlineEditors).toHaveLength(2); // Title and content editors
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
        expect(screen.getByText('This is a test blog post content.\n\nIt has multiple paragraphs.')).toBeInTheDocument();
      });
    });

    it('should display blog post image when available', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const image = screen.getByAltText('Test Blog Post');
        expect(image).toBeInTheDocument();
        expect(image).toHaveAttribute('src', 'https://example.com/test-image.jpg');
      });
    });

    it('should not show image panel when no image is available', async () => {
      const contentWithoutImage = { ...mockContent, imageUrl: undefined };
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(contentWithoutImage);

      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Blog Content')).toBeInTheDocument();
        expect(screen.queryByText('Blog Image')).not.toBeInTheDocument();
      });
    });
  });

  describe('Status Indicators', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should show status indicator component', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('status-indicator')).toBeInTheDocument();
        expect(screen.getByText(/Status for test-content-id/)).toBeInTheDocument();
      });
    });

    it('should show detailed status', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/details: true/)).toBeInTheDocument();
      });
    });
  });

  describe('Feedback Forms', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should show content feedback form when provide feedback is clicked', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const contentFeedbackButton = screen.getAllByText('Provide Feedback')[0];
        fireEvent.click(contentFeedbackButton);
      });

      expect(screen.getByPlaceholderText(/content feedback/)).toBeInTheDocument();
    });

    it('should show image feedback form when provide feedback is clicked', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const imageFeedbackButton = screen.getAllByText('Provide Feedback')[1];
        fireEvent.click(imageFeedbackButton);
      });

      expect(screen.getByPlaceholderText(/image feedback/)).toBeInTheDocument();
    });

    it('should submit content feedback when form is submitted', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const contentFeedbackButton = screen.getAllByText('Provide Feedback')[0];
        fireEvent.click(contentFeedbackButton);
      });

      const textarea = screen.getByPlaceholderText(/content feedback/);
      fireEvent.change(textarea, { target: { value: 'Please make it more engaging' } });

      fireEvent.click(screen.getByText('Submit Content Feedback'));

      expect(defaultProps.onContentRevision).toHaveBeenCalledWith(
        'test-content-id',
        'Please make it more engaging'
      );
    });

    it('should submit image feedback when form is submitted', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const imageFeedbackButton = screen.getAllByText('Provide Feedback')[1];
        fireEvent.click(imageFeedbackButton);
      });

      const textarea = screen.getByPlaceholderText(/image feedback/);
      fireEvent.change(textarea, { target: { value: 'Please make it more colorful' } });

      fireEvent.click(screen.getByText('Submit Image Feedback'));

      expect(defaultProps.onImageRevision).toHaveBeenCalledWith(
        'test-content-id',
        'Please make it more colorful'
      );
    });

    it('should cancel feedback form when cancel is clicked', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const contentFeedbackButton = screen.getAllByText('Provide Feedback')[0];
        fireEvent.click(contentFeedbackButton);
      });

      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.queryByPlaceholderText(/content feedback/)).not.toBeInTheDocument();
    });
  });

  describe('Approve Functionality', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should show approve button when content is ready', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Approve & Publish')).toBeInTheDocument();
      });
    });

    it('should call onApprove when approve button is clicked', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        fireEvent.click(screen.getByText('Approve & Publish'));
      });

      expect(defaultProps.onApprove).toHaveBeenCalledWith('test-content-id');
    });

    it('should disable approve button when content is processing', async () => {
      mockContentGenerationService.getContentStatus.mockResolvedValue({
        status: 'processing',
        progress: 50,
        estimatedTimeRemaining: 30
      });

      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Approve & Publish')).toBeDisabled();
      });
    });
  });

  describe('Processing States', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should show processing overlay when content is being revised', async () => {
      render(<ReviewInterface {...defaultProps} />);

      // Simulate content revision
      await waitFor(() => {
        const contentFeedbackButton = screen.getAllByText('Provide Feedback')[0];
        fireEvent.click(contentFeedbackButton);
      });

      const textarea = screen.getByPlaceholderText(/content feedback/);
      fireEvent.change(textarea, { target: { value: 'Test feedback' } });
      fireEvent.click(screen.getByText('Submit Content Feedback'));

      await waitFor(() => {
        expect(screen.getByText('Revising content...')).toBeInTheDocument();
      });
    });

    it('should show processing overlay when image is being generated', async () => {
      render(<ReviewInterface {...defaultProps} />);

      // Simulate image revision
      await waitFor(() => {
        const imageFeedbackButton = screen.getAllByText('Provide Feedback')[1];
        fireEvent.click(imageFeedbackButton);
      });

      const textarea = screen.getByPlaceholderText(/image feedback/);
      fireEvent.change(textarea, { target: { value: 'Test feedback' } });
      fireEvent.click(screen.getByText('Submit Image Feedback'));

      await waitFor(() => {
        expect(screen.getByText('Generating new image...')).toBeInTheDocument();
      });
    });

    it('should disable feedback buttons when processing', async () => {
      render(<ReviewInterface {...defaultProps} />);

      // Simulate content revision to trigger processing state
      await waitFor(() => {
        const contentFeedbackButton = screen.getAllByText('Provide Feedback')[0];
        fireEvent.click(contentFeedbackButton);
      });

      const textarea = screen.getByPlaceholderText(/content feedback/);
      fireEvent.change(textarea, { target: { value: 'Test feedback' } });
      fireEvent.click(screen.getByText('Submit Content Feedback'));

      await waitFor(() => {
        const feedbackButtons = screen.getAllByText('Provide Feedback');
        feedbackButtons.forEach(button => {
          expect(button).toBeDisabled();
        });
      });
    });
  });

  describe('Revision History', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should display revision history when available', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Revision History')).toBeInTheDocument();
        expect(screen.getByText('content Revision')).toBeInTheDocument();
        expect(screen.getByText('Please make it more engaging')).toBeInTheDocument();
      });
    });

    it('should not display revision history when empty', async () => {
      const contentWithoutHistory = { ...mockContent, revisionHistory: [] };
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(contentWithoutHistory);

      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByText('Revision History')).not.toBeInTheDocument();
      });
    });
  });

  describe('Inline Editing', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should call onInlineEdit when title is edited', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const titleEditor = screen.getAllByTestId('inline-editor')[0];
        fireEvent.click(titleEditor);
      });

      expect(defaultProps.onInlineEdit).toHaveBeenCalledWith(
        'test-content-id',
        'title',
        'edited-Test Blog Post'
      );
    });

    it('should call onInlineEdit when content is edited', async () => {
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const contentEditor = screen.getAllByTestId('inline-editor')[1];
        fireEvent.click(contentEditor);
      });

      expect(defaultProps.onInlineEdit).toHaveBeenCalledWith(
        'test-content-id',
        'content',
        'edited-This is a test blog post content.\n\nIt has multiple paragraphs.'
      );
    });

    it('should reload content after successful inline edit', async () => {
      defaultProps.onInlineEdit.mockResolvedValue(undefined);
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const titleEditor = screen.getAllByTestId('inline-editor')[0];
        fireEvent.click(titleEditor);
      });

      await waitFor(() => {
        expect(mockContentGenerationService.getGeneratedContent).toHaveBeenCalledTimes(2);
      });
    });

    it('should handle inline edit errors', async () => {
      defaultProps.onInlineEdit.mockRejectedValue(new Error('Edit failed'));
      render(<ReviewInterface {...defaultProps} />);

      await waitFor(() => {
        const titleEditor = screen.getAllByTestId('inline-editor')[0];
        fireEvent.click(titleEditor);
      });

      // Should not reload content on error
      await waitFor(() => {
        expect(mockContentGenerationService.getGeneratedContent).toHaveBeenCalledTimes(1);
      });
    });

    it('should disable inline editing when not provided', async () => {
      const propsWithoutInlineEdit = {
        ...defaultProps,
        onInlineEdit: undefined
      };
      render(<ReviewInterface {...propsWithoutInlineEdit} />);

      await waitFor(() => {
        const inlineEditors = screen.getAllByTestId('inline-editor');
        inlineEditors.forEach(editor => {
          expect(editor.className).toContain('disabled');
        });
      });
    });
  });


});