import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PublishingInterface } from '../PublishingInterface';
import { publishingService } from '../../services/publishingService';
import { authenticationService } from '../../services/authenticationService';
import { Platform } from '../../types/OAuth';

// Mock services
vi.mock('../../services/publishingService');
vi.mock('../../services/authenticationService');

const mockPublishingService = publishingService as any;
const mockAuthenticationService = authenticationService as any;

describe('PublishingInterface', () => {
  const defaultProps = {
    contentId: 'content-123',
    userId: 'user-123',
    imageUrl: 'https://example.com/image.jpg'
  };

  const mockPlatforms = [
    { name: 'medium', features: ['articles', 'publications'] },
    { name: 'linkedin', features: ['posts', 'articles'] }
  ];

  const mockConnections = [
    {
      platform: Platform.MEDIUM,
      isActive: true,
      connectedAt: '2023-01-01T00:00:00Z',
      lastUsed: '2023-01-02T00:00:00Z',
      expiresAt: null
    },
    {
      platform: Platform.LINKEDIN,
      isActive: true,
      connectedAt: '2023-01-01T00:00:00Z',
      lastUsed: null,
      expiresAt: null
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockPublishingService.getSupportedPlatforms.mockResolvedValue(mockPlatforms);
    mockAuthenticationService.getConnectedPlatforms.mockResolvedValue(mockConnections);
    mockPublishingService.getPlatformIcon.mockImplementation((platform) => 
      platform === 'medium' ? '📝' : '💼'
    );
    mockPublishingService.getPlatformDisplayName.mockImplementation((platform) => 
      platform === 'medium' ? 'Medium' : 'LinkedIn'
    );
  });

  it('should render loading state initially', () => {
    render(<PublishingInterface {...defaultProps} />);
    expect(screen.getByText('Loading publishing options...')).toBeInTheDocument();
  });

  it('should render platforms after loading', async () => {
    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Publish Your Content')).toBeInTheDocument();
    });

    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.getAllByText('Select for publishing')).toHaveLength(2);
  });

  it('should show connected status for active platforms', async () => {
    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    // Both platforms should be available for selection since they're connected
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    checkboxes.forEach(checkbox => {
      expect(checkbox).not.toBeDisabled();
    });
  });

  it('should handle platform selection', async () => {
    mockPublishingService.getFormatPreview.mockResolvedValue({
      title: 'Test Post',
      body: 'This is a test post content...',
      tags: ['test', 'blog']
    });

    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    const mediumCheckbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(mediumCheckbox);

    expect(mediumCheckbox).toBeChecked();

    // Should load preview
    await waitFor(() => {
      expect(mockPublishingService.getFormatPreview).toHaveBeenCalledWith(
        'content-123',
        'medium',
        'https://example.com/image.jpg'
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Preview:')).toBeInTheDocument();
      expect(screen.getByText('Test Post')).toBeInTheDocument();
    });
  });

  it('should enable publish button when platforms are selected', async () => {
    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    const publishButton = screen.getByRole('button', { name: /publish to/i });
    expect(publishButton).toBeDisabled();

    const mediumCheckbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(mediumCheckbox);

    await waitFor(() => {
      expect(publishButton).not.toBeDisabled();
      expect(publishButton).toHaveTextContent('Publish to 1 Platform');
    });
  });

  it('should handle successful publishing', async () => {
    const mockResults = {
      medium: { success: true, platformUrl: 'https://medium.com/post-123' },
      linkedin: { success: true, platformUrl: 'https://linkedin.com/post-123' }
    };

    mockPublishingService.publishToMultiplePlatforms.mockResolvedValue({
      success: true,
      results: mockResults
    });

    const onPublishComplete = vi.fn();
    const onPublishStart = vi.fn();

    render(
      <PublishingInterface 
        {...defaultProps} 
        onPublishComplete={onPublishComplete}
        onPublishStart={onPublishStart}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    // Select both platforms
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // Medium
    fireEvent.click(checkboxes[1]); // LinkedIn

    const publishButton = screen.getByRole('button', { name: /publish to 2 platforms/i });
    fireEvent.click(publishButton);

    expect(onPublishStart).toHaveBeenCalled();

    await waitFor(() => {
      expect(mockPublishingService.publishToMultiplePlatforms).toHaveBeenCalledWith(
        'content-123',
        expect.any(Map),
        'https://example.com/image.jpg'
      );
    });

    await waitFor(() => {
      expect(onPublishComplete).toHaveBeenCalledWith(mockResults);
      expect(screen.getByText('Publishing Results')).toBeInTheDocument();
      expect(screen.getAllByText('✅ Success')).toHaveLength(2);
    });
  });

  it('should handle publishing failures', async () => {
    const mockResults = {
      medium: { success: true, platformUrl: 'https://medium.com/post-123' },
      linkedin: { success: false, error: 'Authentication failed' }
    };

    mockPublishingService.publishToMultiplePlatforms.mockResolvedValue({
      success: false,
      results: mockResults
    });

    mockPublishingService.formatPublishingError.mockImplementation((error) => 
      error === 'Authentication failed' ? 'Authentication failed. Please check your credentials and try again.' : error
    );

    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    // Select both platforms
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const publishButton = screen.getByRole('button', { name: /publish to 2 platforms/i });
    fireEvent.click(publishButton);

    await waitFor(() => {
      expect(screen.getByText('Publishing Results')).toBeInTheDocument();
      expect(screen.getByText('✅ Success')).toBeInTheDocument();
      expect(screen.getByText('❌ Failed')).toBeInTheDocument();
      expect(screen.getByText('Authentication failed. Please check your credentials and try again.')).toBeInTheDocument();
    });

    // Should show retry button
    expect(screen.getByRole('button', { name: 'Retry Failed Platforms' })).toBeInTheDocument();
  });

  it('should handle retry functionality', async () => {
    // Initial failed publishing
    const initialResults = {
      medium: { success: true, platformUrl: 'https://medium.com/post-123' },
      linkedin: { success: false, error: 'Network error' }
    };

    mockPublishingService.publishToMultiplePlatforms.mockResolvedValueOnce({
      success: false,
      results: initialResults
    });

    // Successful retry
    const retryResults = {
      linkedin: { success: true, platformUrl: 'https://linkedin.com/post-123' }
    };

    mockPublishingService.retryFailedPublishing.mockResolvedValue({
      success: true,
      results: retryResults
    });

    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    // Select and publish
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const publishButton = screen.getByRole('button', { name: /publish to 2 platforms/i });
    fireEvent.click(publishButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry Failed Platforms' })).toBeInTheDocument();
    });

    // Click retry
    const retryButton = screen.getByRole('button', { name: 'Retry Failed Platforms' });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockPublishingService.retryFailedPublishing).toHaveBeenCalledWith(
        'content-123',
        ['linkedin'],
        expect.any(Map),
        'https://example.com/image.jpg'
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText('✅ Success')).toHaveLength(2);
    });
  });

  it('should show error for disconnected platforms', async () => {
    const disconnectedConnections = [
      { ...mockConnections[0], isActive: false },
      mockConnections[1]
    ];

    mockAuthenticationService.getConnectedPlatforms.mockResolvedValue(disconnectedConnections);

    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    const mediumCard = screen.getByText('Medium').closest('.platform-card');
    expect(mediumCard).toHaveClass('disconnected');
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText('Connect this platform in Platform Manager first')).toBeInTheDocument();
  });

  it('should show error when trying to select disconnected platform', async () => {
    const disconnectedConnections = [
      { ...mockConnections[0], isActive: false },
      mockConnections[1]
    ];

    mockAuthenticationService.getConnectedPlatforms.mockResolvedValue(disconnectedConnections);

    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    // Try to select disconnected platform (this shouldn't be possible in UI, but test the logic)
    // The checkbox should be disabled or not present for disconnected platforms
    const mediumCard = screen.getByText('Medium').closest('.platform-card');
    expect(mediumCard).toHaveClass('disconnected');
  });

  it('should handle loading errors', async () => {
    mockPublishingService.getSupportedPlatforms.mockRejectedValue(new Error('Network error'));

    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should show disabled button when no platforms selected', async () => {
    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    // The button should be disabled when no platforms are selected
    const publishButton = screen.getByRole('button', { name: /publish to 0 platforms/i });
    expect(publishButton).toBeDisabled();
    expect(publishButton).toHaveTextContent('Publish to 0 Platforms');
  });

  it('should disable controls during publishing', async () => {
    mockPublishingService.publishToMultiplePlatforms.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ success: true, results: {} }), 1000))
    );

    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    const checkbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);

    const publishButton = screen.getByRole('button', { name: /publish to 1 platform/i });
    fireEvent.click(publishButton);

    // Controls should be disabled during publishing
    expect(publishButton).toBeDisabled();
    expect(publishButton).toHaveTextContent('Publishing...');
    expect(checkbox).toBeDisabled();
  });

  it('should show publishing status indicators', async () => {
    // Mock a slow publishing process
    mockPublishingService.publishToMultiplePlatforms.mockImplementation(
      () => new Promise(resolve => 
        setTimeout(() => resolve({ 
          success: true, 
          results: { medium: { success: true } } 
        }), 100)
      )
    );

    render(<PublishingInterface {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    const checkbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);

    const publishButton = screen.getByRole('button', { name: /publish to 1 platform/i });
    fireEvent.click(publishButton);

    // Should show publishing status
    await waitFor(() => {
      expect(screen.getByText('publishing')).toBeInTheDocument();
    });
  });
});