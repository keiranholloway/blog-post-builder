import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OfflineStatus from '../OfflineStatus';

// Mock PWA service
const mockPWAService = {
  isOnline: vi.fn().mockReturnValue(true),
  onOnlineStatusChange: vi.fn().mockReturnValue(() => {}) // Return cleanup function
};

vi.mock('../../services/pwaService', () => ({
  default: mockPWAService
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPWAService.isOnline.mockReturnValue(true);
});

describe('OfflineStatus', () => {
  it('should not render when online and no offline message shown', () => {
    render(<OfflineStatus />);
    
    expect(screen.queryByText("You're Offline")).not.toBeInTheDocument();
    expect(screen.queryByText('Back Online')).not.toBeInTheDocument();
  });

  it('should render offline status when offline', () => {
    mockPWAService.isOnline.mockReturnValue(false);
    
    // Mock the status change callback to simulate going offline
    mockPWAService.onOnlineStatusChange.mockImplementation((callback) => {
      callback(false); // Simulate offline
      return () => {}; // Return cleanup function
    });
    
    render(<OfflineStatus />);
    
    expect(screen.getByText("You're Offline")).toBeInTheDocument();
    expect(screen.getByText('Some features may be limited')).toBeInTheDocument();
  });

  it('should show back online message when coming back online', async () => {
    let statusCallback: ((isOnline: boolean) => void) | null = null;
    
    mockPWAService.onOnlineStatusChange.mockImplementation((callback) => {
      statusCallback = callback;
      return () => {}; // Return cleanup function
    });
    
    render(<OfflineStatus />);
    
    // Simulate going offline first
    if (statusCallback) {
      statusCallback(false);
    }
    
    expect(screen.getByText("You're Offline")).toBeInTheDocument();
    
    // Simulate coming back online
    if (statusCallback) {
      statusCallback(true);
    }
    
    expect(screen.getByText('Back Online')).toBeInTheDocument();
    expect(screen.getByText('Connection restored')).toBeInTheDocument();
    
    // Should hide after delay
    await waitFor(() => {
      expect(screen.queryByText('Back Online')).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should call onOnlineStatusChange callback when provided', () => {
    const onOnlineStatusChange = vi.fn();
    let statusCallback: ((isOnline: boolean) => void) | null = null;
    
    mockPWAService.onOnlineStatusChange.mockImplementation((callback) => {
      statusCallback = callback;
      return () => {}; // Return cleanup function
    });
    
    render(<OfflineStatus onOnlineStatusChange={onOnlineStatusChange} />);
    
    // Simulate status change
    if (statusCallback) {
      statusCallback(false);
    }
    
    expect(onOnlineStatusChange).toHaveBeenCalledWith(false);
    
    if (statusCallback) {
      statusCallback(true);
    }
    
    expect(onOnlineStatusChange).toHaveBeenCalledWith(true);
  });

  it('should setup and cleanup online status listener', () => {
    const cleanup = vi.fn();
    mockPWAService.onOnlineStatusChange.mockReturnValue(cleanup);
    
    const { unmount } = render(<OfflineStatus />);
    
    expect(mockPWAService.onOnlineStatusChange).toHaveBeenCalled();
    
    unmount();
    
    expect(cleanup).toHaveBeenCalled();
  });

  it('should show offline icon when offline', () => {
    mockPWAService.onOnlineStatusChange.mockImplementation((callback) => {
      callback(false); // Simulate offline
      return () => {}; // Return cleanup function
    });
    
    render(<OfflineStatus />);
    
    const offlineIcon = screen.getByRole('img', { hidden: true }); // SVG elements have hidden role by default
    expect(offlineIcon).toBeInTheDocument();
  });

  it('should show online icon when back online', () => {
    let statusCallback: ((isOnline: boolean) => void) | null = null;
    
    mockPWAService.onOnlineStatusChange.mockImplementation((callback) => {
      statusCallback = callback;
      return () => {}; // Return cleanup function
    });
    
    render(<OfflineStatus />);
    
    // Simulate going offline first, then online
    if (statusCallback) {
      statusCallback(false);
      statusCallback(true);
    }
    
    const onlineIcon = screen.getByRole('img', { hidden: true }); // SVG elements have hidden role by default
    expect(onlineIcon).toBeInTheDocument();
  });

  it('should have correct CSS classes for offline state', () => {
    mockPWAService.onOnlineStatusChange.mockImplementation((callback) => {
      callback(false); // Simulate offline
      return () => {}; // Return cleanup function
    });
    
    render(<OfflineStatus />);
    
    const statusElement = screen.getByText("You're Offline").closest('.offline-status');
    expect(statusElement).toHaveClass('offline');
  });

  it('should have correct CSS classes for online state', () => {
    let statusCallback: ((isOnline: boolean) => void) | null = null;
    
    mockPWAService.onOnlineStatusChange.mockImplementation((callback) => {
      statusCallback = callback;
      return () => {}; // Return cleanup function
    });
    
    render(<OfflineStatus />);
    
    // Simulate going offline first, then online
    if (statusCallback) {
      statusCallback(false);
      statusCallback(true);
    }
    
    const statusElement = screen.getByText('Back Online').closest('.offline-status');
    expect(statusElement).toHaveClass('online');
  });
});