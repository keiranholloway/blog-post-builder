import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlatformManager } from '../PlatformManager';
import { authenticationService } from '../../services/authenticationService';
import { Platform } from '../../types/OAuth';

// Mock the authentication service
vi.mock('../../services/authenticationService');

// Mock window.open and window.confirm
const mockWindowOpen = vi.fn();
const mockWindowConfirm = vi.fn();
Object.defineProperty(window, 'open', { value: mockWindowOpen, writable: true });
Object.defineProperty(window, 'confirm', { value: mockWindowConfirm, writable: true });

describe('PlatformManager', () => {
  const mockUserId = 'test-user-123';
  const mockOnConnectionChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockWindowConfirm.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockConnectedPlatforms = [
    {
      platform: Platform.MEDIUM,
      isActive: true,
      connectedAt: '2024-01-01T00:00:00.000Z',
      lastUsed: '2024-01-01T12:00:00.000Z',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      needsRenewal: false
    },
    {
      platform: Platform.LINKEDIN,
      isActive: false,
      connectedAt: null,
      lastUsed: null,
      expiresAt: null,
      needsRenewal: false
    }
  ];

  it('should render platform manager with loading state', () => {
    vi.mocked(authenticationService.getConnectedPlatforms).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep loading state
    );

    render(<PlatformManager userId={mockUserId} />);

    expect(screen.getByText('Loading platforms...')).toBeInTheDocument();
  });

  it('should render connected and disconnected platforms', async () => {
    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(mockConnectedPlatforms);

    render(<PlatformManager userId={mockUserId} onConnectionChange={mockOnConnectionChange} />);

    await waitFor(() => {
      expect(screen.getByText('Publishing Platforms')).toBeInTheDocument();
    });

    // Check Medium platform (connected)
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Disconnect')).toBeInTheDocument();

    // Check LinkedIn platform (not connected)
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.getByText('Not Connected')).toBeInTheDocument();
    expect(screen.getByText('Connect')).toBeInTheDocument();
  });

  it('should show renewal warning for expired platforms', async () => {
    const expiredPlatforms = [
      {
        ...mockConnectedPlatforms[0],
        needsRenewal: true
      }
    ];

    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(expiredPlatforms);

    render(<PlatformManager userId={mockUserId} />);

    await waitFor(() => {
      expect(screen.getByText('⚠️ Authentication expired - renewal required')).toBeInTheDocument();
      expect(screen.getByText('Renew Access')).toBeInTheDocument();
    });
  });

  it('should handle platform connection', async () => {
    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(mockConnectedPlatforms);
    vi.mocked(authenticationService.initiateAuth).mockResolvedValue('https://example.com/oauth');

    const mockPopup = { closed: false };
    mockWindowOpen.mockReturnValue(mockPopup);

    render(<PlatformManager userId={mockUserId} onConnectionChange={mockOnConnectionChange} />);

    await waitFor(() => {
      expect(screen.getByText('Connect')).toBeInTheDocument();
    });

    const connectButton = screen.getByText('Connect');
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(authenticationService.initiateAuth).toHaveBeenCalledWith(Platform.LINKEDIN, mockUserId);
      expect(mockWindowOpen).toHaveBeenCalledWith(
        'https://example.com/oauth',
        'oauth',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );
    });

    // Simulate popup closing
    mockPopup.closed = true;
    
    // Wait for the interval to detect popup closure
    await new Promise(resolve => setTimeout(resolve, 1100));

    await waitFor(() => {
      expect(authenticationService.getConnectedPlatforms).toHaveBeenCalledTimes(2); // Initial load + after connection
      expect(mockOnConnectionChange).toHaveBeenCalled();
    });
  });

  it('should handle platform disconnection', async () => {
    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(mockConnectedPlatforms);
    vi.mocked(authenticationService.disconnectPlatform).mockResolvedValue();

    render(<PlatformManager userId={mockUserId} onConnectionChange={mockOnConnectionChange} />);

    await waitFor(() => {
      expect(screen.getByText('Disconnect')).toBeInTheDocument();
    });

    const disconnectButton = screen.getByText('Disconnect');
    fireEvent.click(disconnectButton);

    await waitFor(() => {
      expect(mockWindowConfirm).toHaveBeenCalledWith('Are you sure you want to disconnect Medium?');
      expect(authenticationService.disconnectPlatform).toHaveBeenCalledWith(mockUserId, Platform.MEDIUM);
      expect(mockOnConnectionChange).toHaveBeenCalled();
    });
  });

  it('should handle token renewal', async () => {
    const expiredPlatforms = [
      {
        ...mockConnectedPlatforms[0],
        needsRenewal: true
      }
    ];

    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(expiredPlatforms);
    vi.mocked(authenticationService.refreshToken).mockResolvedValue({
      success: true,
      platform: Platform.MEDIUM,
      token: {
        accessToken: 'new-token',
        expiresAt: new Date(Date.now() + 3600000),
        tokenType: 'Bearer',
        scope: ['basicProfile', 'publishPost']
      }
    });

    render(<PlatformManager userId={mockUserId} onConnectionChange={mockOnConnectionChange} />);

    await waitFor(() => {
      expect(screen.getByText('Renew Access')).toBeInTheDocument();
    });

    const renewButton = screen.getByText('Renew Access');
    fireEvent.click(renewButton);

    await waitFor(() => {
      expect(authenticationService.refreshToken).toHaveBeenCalledWith(mockUserId, Platform.MEDIUM);
      expect(mockOnConnectionChange).toHaveBeenCalled();
    });
  });

  it('should handle connection errors', async () => {
    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(mockConnectedPlatforms);
    vi.mocked(authenticationService.initiateAuth).mockRejectedValue(new Error('Connection failed'));

    render(<PlatformManager userId={mockUserId} />);

    await waitFor(() => {
      expect(screen.getByText('Connect')).toBeInTheDocument();
    });

    const connectButton = screen.getByText('Connect');
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });
  });

  it('should handle disconnection cancellation', async () => {
    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(mockConnectedPlatforms);
    mockWindowConfirm.mockReturnValue(false); // User cancels

    render(<PlatformManager userId={mockUserId} />);

    await waitFor(() => {
      expect(screen.getByText('Disconnect')).toBeInTheDocument();
    });

    const disconnectButton = screen.getByText('Disconnect');
    fireEvent.click(disconnectButton);

    await waitFor(() => {
      expect(mockWindowConfirm).toHaveBeenCalled();
      expect(authenticationService.disconnectPlatform).not.toHaveBeenCalled();
    });
  });

  it('should handle token renewal failure', async () => {
    const expiredPlatforms = [
      {
        ...mockConnectedPlatforms[0],
        needsRenewal: true
      }
    ];

    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(expiredPlatforms);
    vi.mocked(authenticationService.refreshToken).mockResolvedValue({
      success: false,
      error: 'Refresh failed',
      platform: Platform.MEDIUM
    });

    render(<PlatformManager userId={mockUserId} />);

    await waitFor(() => {
      expect(screen.getByText('Renew Access')).toBeInTheDocument();
    });

    const renewButton = screen.getByText('Renew Access');
    fireEvent.click(renewButton);

    await waitFor(() => {
      expect(screen.getByText('Refresh failed')).toBeInTheDocument();
    });
  });

  it('should display platform descriptions and help text', async () => {
    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(mockConnectedPlatforms);

    render(<PlatformManager userId={mockUserId} />);

    await waitFor(() => {
      expect(screen.getByText('Publish to your Medium profile and publications')).toBeInTheDocument();
      expect(screen.getByText('Share posts to your LinkedIn professional network')).toBeInTheDocument();
      expect(screen.getByText('Need help?')).toBeInTheDocument();
      expect(screen.getByText(/Make sure you have accounts on the platforms/)).toBeInTheDocument();
    });
  });

  it('should show connection details for connected platforms', async () => {
    vi.mocked(authenticationService.getConnectedPlatforms).mockResolvedValue(mockConnectedPlatforms);

    render(<PlatformManager userId={mockUserId} />);

    await waitFor(() => {
      expect(screen.getByText('Connected:')).toBeInTheDocument();
      expect(screen.getByText('Last used:')).toBeInTheDocument();
      expect(screen.getByText('1/1/2024')).toBeInTheDocument(); // Connected date
      expect(screen.getByText('1/1/2024')).toBeInTheDocument(); // Last used date
    });
  });
});