import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BlogPostPreview } from '../BlogPostPreview';
import { contentGenerationService } from '../../services/contentGenerationService';

// Mock the content generation service
vi.mock('../../services/contentGenerationService');

const mockContentGenerationService = vi.mocked(contentGenerationService);

describe('BlogPostPreview', () => {
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
    onFeedback: vi.fn(),
    onApprove: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should show loading spinner while fetching content', () => {
      mockContentGenerationService.getGeneratedContent.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<BlogPostPreview {...defaultProps} />);

      expect(screen.getByText('Loading blog post...')).toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show error message when content fails to load', async () => {
      mockContentGenerationService.getGeneratedContent.mockRejectedValue(
        new Error('Failed to load content')
      );

      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Error Loading Content')).toBeInTheDocument();
        expect(screen.getByText('Failed to load content')).toBeInTheDocument();
      });
    });

    it('should allow retry when content fails to load', async () => {
      mockContentGenerationService.getGeneratedContent
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockContent);

      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Try Again')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Try Again'));

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
      });

      expect(mockContentGenerationService.getGeneratedContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('Content Display', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should display blog post content correctly', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Test Blog Post')).toBeInTheDocument();
        expect(screen.getByText('This is a test blog post content.')).toBeInTheDocument();
        expect(screen.getByText('It has multiple paragraphs.')).toBeInTheDocument();
      });
    });

    it('should display blog post image when available', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        const image = screen.getByAltText('Test Blog Post');
        expect(image).toBeInTheDocument();
        expect(image).toHaveAttribute('src', 'https://example.com/test-image.jpg');
      });
    });

    it('should show status badge with correct status', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('READY')).toBeInTheDocument();
      });
    });

    it('should show last updated timestamp', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Updated:/)).toBeInTheDocument();
      });
    });
  });

  describe('Action Buttons', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should show content and image feedback buttons', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Content Feedback')).toBeInTheDocument();
        expect(screen.getByText('Image Feedback')).toBeInTheDocument();
      });
    });

    it('should show approve button when content is ready', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Approve & Publish')).toBeInTheDocument();
      });
    });

    it('should disable buttons when content is processing', async () => {
      const processingContent = { ...mockContent, status: 'processing' };
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(processingContent);

      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Content Feedback')).toBeDisabled();
        expect(screen.getByText('Image Feedback')).toBeDisabled();
      });
    });
  });

  describe('Feedback Modal', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should open content feedback modal when button is clicked', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        fireEvent.click(screen.getByText('Content Feedback'));
      });

      expect(screen.getByText('Provide Content Feedback')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter your content feedback here...')).toBeInTheDocument();
    });

    it('should open image feedback modal when button is clicked', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        fireEvent.click(screen.getByText('Image Feedback'));
      });

      expect(screen.getByText('Provide Image Feedback')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter your image feedback here...')).toBeInTheDocument();
    });

    it('should close modal when cancel button is clicked', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        fireEvent.click(screen.getByText('Content Feedback'));
      });

      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.queryByText('Provide Content Feedback')).not.toBeInTheDocument();
    });

    it('should submit feedback when form is submitted', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        fireEvent.click(screen.getByText('Content Feedback'));
      });

      const textarea = screen.getByPlaceholderText('Enter your content feedback here...');
      fireEvent.change(textarea, { target: { value: 'Please make it more engaging' } });

      fireEvent.click(screen.getByText('Submit Feedback'));

      expect(defaultProps.onFeedback).toHaveBeenCalledWith(
        'test-content-id',
        'Please make it more engaging',
        'content'
      );
    });

    it('should disable submit button when feedback is empty', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        fireEvent.click(screen.getByText('Content Feedback'));
      });

      expect(screen.getByText('Submit Feedback')).toBeDisabled();
    });
  });

  describe('Revision History', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should display revision history when available', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Revision History')).toBeInTheDocument();
        expect(screen.getByText('Revision 1')).toBeInTheDocument();
        expect(screen.getByText('Please make it more engaging')).toBeInTheDocument();
      });
    });

    it('should not display revision history when empty', async () => {
      const contentWithoutHistory = { ...mockContent, revisionHistory: [] };
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(contentWithoutHistory);

      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.queryByText('Revision History')).not.toBeInTheDocument();
      });
    });
  });

  describe('Approve Functionality', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should call onApprove when approve button is clicked', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        fireEvent.click(screen.getByText('Approve & Publish'));
      });

      expect(defaultProps.onApprove).toHaveBeenCalledWith('test-content-id');
    });

    it('should show approved status when content is approved', async () => {
      const approvedContent = { ...mockContent, status: 'approved' };
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(approvedContent);

      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Approved')).toBeInTheDocument();
        expect(screen.getByText('APPROVED')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      mockContentGenerationService.getGeneratedContent.mockResolvedValue(mockContent);
    });

    it('should have proper ARIA labels and roles', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        const image = screen.getByAltText('Test Blog Post');
        expect(image).toBeInTheDocument();
        
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      });
    });

    it('should support keyboard navigation', async () => {
      render(<BlogPostPreview {...defaultProps} />);

      await waitFor(() => {
        const feedbackButton = screen.getByText('Content Feedback');
        feedbackButton.focus();
        expect(feedbackButton).toHaveFocus();
      });
    });
  });
});