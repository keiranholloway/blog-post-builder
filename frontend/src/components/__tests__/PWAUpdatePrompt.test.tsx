import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PWAUpdatePrompt from '../PWAUpdatePrompt';

// Mock PWA service
const mockPWAService = {
  isUpdateAvailable: vi.fn().mockReturnValue(false),
  updateApp: vi.fn().mockResolvedValue(undefined)
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
  mockPWAService.isUpdateAvailable.mockReturnValue(false);
});

describe('PWAUpdatePrompt', () => {
  it('should not render when no update is available', () => {
    render(<PWAUpdatePrompt />);
    
    expect(screen.queryByText('Update Available')).not.toBeInTheDocument();
  });

  it('should render when update is available', () => {
    mockPWAService.isUpdateAvailable.mockReturnValue(true);
    
    render(<PWAUpdatePrompt />);
    
    expect(screen.getByText('Update Available')).toBeInTheDocument();
    expect(screen.getByText('A new version of Blog Poster is ready to install')).toBeInTheDocument();
  });

  it('should show update and later buttons', () => {
    mockPWAService.isUpdateAvailable.mockReturnValue(true);
    
    render(<PWAUpdatePrompt />);
    
    expect(screen.getByText('Update Now')).toBeInTheDocument();
    expect(screen.getByText('Later')).toBeInTheDocument();
  });

  it('should handle update button click', async () => {
    mockPWAService.isUpdateAvailable.mockReturnValue(true);
    const onUpdate = vi.fn();
    
    render(<PWAUpdatePrompt onUpdate={onUpdate} />);
    
    const updateButton = screen.getByText('Update Now');
    fireEvent.click(updateButton);
    
    expect(screen.getByText('Updating...')).toBeInTheDocument();
    
    await waitFor(() => {
      expect(mockPWAService.updateApp).toHaveBeenCalled();
      expect(onUpdate).toHaveBeenCalled();
    });
  });

  it('should handle update failure', async () => {
    mockPWAService.isUpdateAvailable.mockReturnValue(true);
    mockPWAService.updateApp.mockRejectedValue(new Error('Update failed'));
    
    render(<PWAUpdatePrompt />);
    
    const updateButton = screen.getByText('Update Now');
    fireEvent.click(updateButton);
    
    await waitFor(() => {
      expect(mockPWAService.updateApp).toHaveBeenCalled();
      expect(screen.getByText('Update Now')).toBeInTheDocument(); // Should show normal text again
    });
  });

  it('should handle dismiss button click', () => {
    mockPWAService.isUpdateAvailable.mockReturnValue(true);
    const onDismiss = vi.fn();
    
    render(<PWAUpdatePrompt onDismiss={onDismiss} />);
    
    const laterButton = screen.getByText('Later');
    fireEvent.click(laterButton);
    
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByText('Update Available')).not.toBeInTheDocument();
  });

  it('should listen for pwa-update-available event', () => {
    render(<PWAUpdatePrompt />);
    
    expect(mockWindow.addEventListener).toHaveBeenCalledWith(
      'pwa-update-available',
      expect.any(Function)
    );
  });

  it('should cleanup event listeners on unmount', () => {
    const { unmount } = render(<PWAUpdatePrompt />);
    
    unmount();
    
    expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
      'pwa-update-available',
      expect.any(Function)
    );
  });

  it('should disable buttons during update', async () => {
    mockPWAService.isUpdateAvailable.mockReturnValue(true);
    mockPWAService.updateApp.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
    
    render(<PWAUpdatePrompt />);
    
    const updateButton = screen.getByText('Update Now');
    const laterButton = screen.getByText('Later');
    
    fireEvent.click(updateButton);
    
    expect(updateButton).toBeDisabled();
    expect(laterButton).toBeDisabled();
    
    await waitFor(() => {
      expect(updateButton).not.toBeDisabled();
      expect(laterButton).not.toBeDisabled();
    });
  });

  it('should show update icon', () => {
    mockPWAService.isUpdateAvailable.mockReturnValue(true);
    
    render(<PWAUpdatePrompt />);
    
    const icon = screen.getByRole('img', { hidden: true }); // SVG elements have hidden role by default
    expect(icon).toBeInTheDocument();
  });

  it('should respond to pwa-update-available event', () => {
    render(<PWAUpdatePrompt />);
    
    // Simulate the event
    const eventHandler = mockWindow.addEventListener.mock.calls.find(
      call => call[0] === 'pwa-update-available'
    )?.[1];
    
    if (eventHandler) {
      eventHandler();
    }
    
    expect(screen.getByText('Update Available')).toBeInTheDocument();
  });
});