import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PWAInstallPrompt from '../PWAInstallPrompt';

// Mock PWA service
const mockPWAService = {
  isAppInstallable: vi.fn().mockReturnValue(false),
  isAppInstalled: vi.fn().mockReturnValue(false),
  installApp: vi.fn().mockResolvedValue(true)
};

vi.mock('../../services/pwaService', () => ({
  default: mockPWAService
}));

// Mock window events
const mockWindow = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
};

Object.defineProperty(global, 'window', {
  value: mockWindow,
  writable: true
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPWAService.isAppInstallable.mockReturnValue(false);
  mockPWAService.isAppInstalled.mockReturnValue(false);
});

describe('PWAInstallPrompt', () => {
  it('should not render when app is not installable', () => {
    render(<PWAInstallPrompt />);
    
    expect(screen.queryByText('Install Blog Poster')).not.toBeInTheDocument();
  });

  it('should not render when app is already installed', () => {
    mockPWAService.isAppInstalled.mockReturnValue(true);
    
    render(<PWAInstallPrompt />);
    
    expect(screen.queryByText('Install Blog Poster')).not.toBeInTheDocument();
  });

  it('should render when app is installable and not installed', () => {
    mockPWAService.isAppInstallable.mockReturnValue(true);
    mockPWAService.isAppInstalled.mockReturnValue(false);
    
    render(<PWAInstallPrompt />);
    
    expect(screen.getByText('Install Blog Poster')).toBeInTheDocument();
    expect(screen.getByText('Get quick access to create blog posts from your voice recordings')).toBeInTheDocument();
    expect(screen.getByText('✓ Offline access')).toBeInTheDocument();
    expect(screen.getByText('✓ Push notifications')).toBeInTheDocument();
    expect(screen.getByText('✓ Faster loading')).toBeInTheDocument();
  });

  it('should show install and dismiss buttons', () => {
    mockPWAService.isAppInstallable.mockReturnValue(true);
    
    render(<PWAInstallPrompt />);
    
    expect(screen.getByText('Install App')).toBeInTheDocument();
    expect(screen.getByText('Not Now')).toBeInTheDocument();
  });

  it('should handle install button click', async () => {
    mockPWAService.isAppInstallable.mockReturnValue(true);
    const onInstall = vi.fn();
    
    render(<PWAInstallPrompt onInstall={onInstall} />);
    
    const installButton = screen.getByText('Install App');
    fireEvent.click(installButton);
    
    expect(screen.getByText('Installing...')).toBeInTheDocument();
    
    await waitFor(() => {
      expect(mockPWAService.installApp).toHaveBeenCalled();
      expect(onInstall).toHaveBeenCalled();
    });
  });

  it('should handle install failure', async () => {
    mockPWAService.isAppInstallable.mockReturnValue(true);
    mockPWAService.installApp.mockResolvedValue(false);
    
    render(<PWAInstallPrompt />);
    
    const installButton = screen.getByText('Install App');
    fireEvent.click(installButton);
    
    await waitFor(() => {
      expect(mockPWAService.installApp).toHaveBeenCalled();
      expect(screen.getByText('Install App')).toBeInTheDocument(); // Should show normal text again
    });
  });

  it('should handle dismiss button click', () => {
    mockPWAService.isAppInstallable.mockReturnValue(true);
    const onDismiss = vi.fn();
    
    render(<PWAInstallPrompt onDismiss={onDismiss} />);
    
    const dismissButton = screen.getByText('Not Now');
    fireEvent.click(dismissButton);
    
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByText('Install Blog Poster')).not.toBeInTheDocument();
  });

  it('should listen for pwa-install-available event', () => {
    render(<PWAInstallPrompt />);
    
    expect(mockWindow.addEventListener).toHaveBeenCalledWith(
      'pwa-install-available',
      expect.any(Function)
    );
  });

  it('should cleanup event listeners on unmount', () => {
    const { unmount } = render(<PWAInstallPrompt />);
    
    unmount();
    
    expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
      'pwa-install-available',
      expect.any(Function)
    );
  });

  it('should disable buttons during installation', async () => {
    mockPWAService.isAppInstallable.mockReturnValue(true);
    mockPWAService.installApp.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(true), 100)));
    
    render(<PWAInstallPrompt />);
    
    const installButton = screen.getByText('Install App');
    const dismissButton = screen.getByText('Not Now');
    
    fireEvent.click(installButton);
    
    expect(installButton).toBeDisabled();
    expect(dismissButton).toBeDisabled();
    
    await waitFor(() => {
      expect(installButton).not.toBeDisabled();
      expect(dismissButton).not.toBeDisabled();
    });
  });

  it('should show app icon', () => {
    mockPWAService.isAppInstallable.mockReturnValue(true);
    
    render(<PWAInstallPrompt />);
    
    const icon = screen.getByAltText('App Icon');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('src', '/icon-192.png');
  });
});