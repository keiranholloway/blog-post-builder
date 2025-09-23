import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthCallback } from '../AuthCallback';
import { authenticationService } from '../../services/authenticationService';

// Mock the authentication service
vi.mock('../../services/authenticationService');

// Mock window.close
const mockWindowClose = vi.fn();
Object.defineProperty(window, 'close', { value: mockWindowClose, writable: true });

// Mock useSearchParams
const mockSearchParams = new Map();
const mockUseSearchParams = vi.fn(() => [mockSearchParams]);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useSearchParams: () => mockUseSearchParams()
  };
});

describe('AuthCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderAuthCallback = () => {
    return render(
      <BrowserRouter>
        <AuthCallback />
      </BrowserRouter>
    );
  };

  it('should show processing state initially', () => {
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');

    vi.mocked(authenticationService.handleCallback).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep processing state
    );

    renderAuthCallback();

    expect(screen.getByText('Connecting...')).toBeInTheDocument();
    expect(screen.getByText('Processing authentication...')).toBeInTheDocument();
    expect(screen.getByRole('generic', { name: /spinner/i })).toBeInTheDocument();
  });

  it('should show success state and close window on successful authentication', async () => {
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');

    vi.mocked(authenticationService.handleCallback).mockResolvedValue({
      success: true,
      platform: 'medium' as any,
      token: {
        accessToken: 'test-token',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: ['basicProfile']
      }
    });

    renderAuthCallback();

    await waitFor(() => {
      expect(screen.getByText('Connected!')).toBeInTheDocument();
      expect(screen.getByText('Authentication successful! You can close this window.')).toBeInTheDocument();
    });

    // Wait for auto-close timeout
    await waitFor(() => {
      expect(mockWindowClose).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it('should show error state on authentication failure', async () => {
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');

    vi.mocked(authenticationService.handleCallback).mockResolvedValue({
      success: false,
      error: 'Invalid authorization code',
      platform: 'medium' as any
    });

    renderAuthCallback();

    await waitFor(() => {
      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText('Invalid authorization code')).toBeInTheDocument();
      expect(screen.getByText('Close Window')).toBeInTheDocument();
    });

    // Should auto-close after error timeout
    await waitFor(() => {
      expect(mockWindowClose).toHaveBeenCalled();
    }, { timeout: 6000 });
  });

  it('should handle OAuth error parameter', async () => {
    mockSearchParams.set('error', 'access_denied');
    mockSearchParams.set('error_description', 'User denied access');

    renderAuthCallback();

    await waitFor(() => {
      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText('Authentication failed: access_denied')).toBeInTheDocument();
    });
  });

  it('should handle missing code parameter', async () => {
    mockSearchParams.set('state', 'test-state');
    // Missing code parameter

    renderAuthCallback();

    await waitFor(() => {
      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText('Missing required parameters from OAuth callback')).toBeInTheDocument();
    });
  });

  it('should handle missing state parameter', async () => {
    mockSearchParams.set('code', 'test-code');
    // Missing state parameter

    renderAuthCallback();

    await waitFor(() => {
      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText('Missing required parameters from OAuth callback')).toBeInTheDocument();
    });
  });

  it('should handle authentication service errors', async () => {
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');

    vi.mocked(authenticationService.handleCallback).mockRejectedValue(
      new Error('Network error')
    );

    renderAuthCallback();

    await waitFor(() => {
      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should handle unknown errors gracefully', async () => {
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');

    vi.mocked(authenticationService.handleCallback).mockRejectedValue(
      'Unknown error' // Non-Error object
    );

    renderAuthCallback();

    await waitFor(() => {
      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText('Authentication failed')).toBeInTheDocument();
    });
  });

  it('should show close instruction for successful authentication', async () => {
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');

    vi.mocked(authenticationService.handleCallback).mockResolvedValue({
      success: true,
      platform: 'medium' as any,
      token: {
        accessToken: 'test-token',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: ['basicProfile']
      }
    });

    renderAuthCallback();

    await waitFor(() => {
      expect(screen.getByText('This window will close automatically in a few seconds.')).toBeInTheDocument();
    });
  });

  it('should allow manual window close on error', async () => {
    mockSearchParams.set('error', 'access_denied');

    renderAuthCallback();

    await waitFor(() => {
      expect(screen.getByText('Close Window')).toBeInTheDocument();
    });

    const closeButton = screen.getByText('Close Window');
    closeButton.click();

    expect(mockWindowClose).toHaveBeenCalled();
  });

  it('should display correct status icons', async () => {
    // Test processing icon
    mockSearchParams.set('code', 'test-code');
    mockSearchParams.set('state', 'test-state');

    vi.mocked(authenticationService.handleCallback).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { rerender } = renderAuthCallback();

    expect(document.querySelector('.status-icon.processing')).toBeInTheDocument();

    // Test success icon
    vi.mocked(authenticationService.handleCallback).mockResolvedValue({
      success: true,
      platform: 'medium' as any,
      token: {
        accessToken: 'test-token',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: ['basicProfile']
      }
    });

    rerender(
      <BrowserRouter>
        <AuthCallback />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(document.querySelector('.status-icon.success')).toBeInTheDocument();
    });
  });
});