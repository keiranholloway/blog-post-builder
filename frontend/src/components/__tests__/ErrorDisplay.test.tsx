import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorDisplay } from '../ErrorDisplay';
import { ErrorType } from '../../services/errorService';

describe('ErrorDisplay', () => {
  const mockError = {
    type: ErrorType.NETWORK,
    title: 'Network Error',
    message: 'Unable to connect to the server',
    retryable: true,
    suggestedAction: 'Check your internet connection',
    technicalDetails: 'Error: fetch failed',
  };

  it('should render error information correctly', () => {
    render(<ErrorDisplay error={mockError} />);

    expect(screen.getByText('Network Error')).toBeInTheDocument();
    expect(screen.getByText('Unable to connect to the server')).toBeInTheDocument();
    expect(screen.getByText('NETWORK')).toBeInTheDocument();
    expect(screen.getByText(/Suggested action:/)).toBeInTheDocument();
    expect(screen.getByText('Check your internet connection')).toBeInTheDocument();
  });

  it('should show retry button for retryable errors', () => {
    const onRetry = jest.fn();
    
    render(<ErrorDisplay error={mockError} onRetry={onRetry} />);

    const retryButton = screen.getByRole('button', { name: 'Try Again' });
    expect(retryButton).toBeInTheDocument();

    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalled();
  });

  it('should not show retry button for non-retryable errors', () => {
    const nonRetryableError = {
      ...mockError,
      retryable: false,
    };

    render(<ErrorDisplay error={nonRetryableError} onRetry={jest.fn()} />);

    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
  });

  it('should show dismiss button when onDismiss is provided', () => {
    const onDismiss = jest.fn();
    
    render(<ErrorDisplay error={mockError} onDismiss={onDismiss} />);

    const dismissButton = screen.getByRole('button', { name: 'Dismiss error' });
    expect(dismissButton).toBeInTheDocument();

    fireEvent.click(dismissButton);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('should not show dismiss button when onDismiss is not provided', () => {
    render(<ErrorDisplay error={mockError} />);

    expect(screen.queryByRole('button', { name: 'Dismiss error' })).not.toBeInTheDocument();
  });

  it('should show technical details when enabled', () => {
    render(<ErrorDisplay error={mockError} showTechnicalDetails={true} />);

    expect(screen.getByText('Technical Details')).toBeInTheDocument();
    
    // Click to expand details
    fireEvent.click(screen.getByText('Technical Details'));
    
    expect(screen.getByText('Error: fetch failed')).toBeInTheDocument();
  });

  it('should not show technical details when disabled', () => {
    render(<ErrorDisplay error={mockError} showTechnicalDetails={false} />);

    expect(screen.queryByText('Technical Details')).not.toBeInTheDocument();
  });

  it('should not show suggested action when not provided', () => {
    const errorWithoutSuggestion = {
      ...mockError,
      suggestedAction: undefined,
    };

    render(<ErrorDisplay error={errorWithoutSuggestion} />);

    expect(screen.queryByText(/Suggested action:/)).not.toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <ErrorDisplay error={mockError} className="custom-error" />
    );

    expect(container.firstChild).toHaveClass('custom-error');
  });

  it('should render different error types with appropriate styling', () => {
    const errorTypes = [
      ErrorType.VALIDATION,
      ErrorType.AUTHENTICATION,
      ErrorType.AUTHORIZATION,
      ErrorType.RATE_LIMIT,
      ErrorType.SERVER_ERROR,
      ErrorType.TIMEOUT,
      ErrorType.OFFLINE,
      ErrorType.UNKNOWN,
    ];

    errorTypes.forEach(type => {
      const error = { ...mockError, type };
      const { container, unmount } = render(<ErrorDisplay error={error} />);
      
      expect(container.firstChild).toHaveClass('error-display');
      
      unmount();
    });
  });

  it('should render appropriate icons for different error types', () => {
    const testCases = [
      { type: ErrorType.NETWORK, expectedIcon: true },
      { type: ErrorType.AUTHENTICATION, expectedIcon: true },
      { type: ErrorType.AUTHORIZATION, expectedIcon: true },
      { type: ErrorType.RATE_LIMIT, expectedIcon: true },
      { type: ErrorType.TIMEOUT, expectedIcon: true },
      { type: ErrorType.OFFLINE, expectedIcon: true },
      { type: ErrorType.VALIDATION, expectedIcon: true },
      { type: ErrorType.SERVER_ERROR, expectedIcon: true },
    ];

    testCases.forEach(({ type, expectedIcon }) => {
      const error = { ...mockError, type };
      const { container, unmount } = render(<ErrorDisplay error={error} />);
      
      const icon = container.querySelector('.error-display__icon svg');
      if (expectedIcon) {
        expect(icon).toBeInTheDocument();
      }
      
      unmount();
    });
  });

  it('should handle missing technical details gracefully', () => {
    const errorWithoutTechnicalDetails = {
      ...mockError,
      technicalDetails: undefined,
    };

    render(
      <ErrorDisplay 
        error={errorWithoutTechnicalDetails} 
        showTechnicalDetails={true} 
      />
    );

    expect(screen.queryByText('Technical Details')).not.toBeInTheDocument();
  });

  it('should render with minimal error object', () => {
    const minimalError = {
      type: ErrorType.UNKNOWN,
      title: 'Error',
      message: 'Something went wrong',
      retryable: false,
    };

    render(<ErrorDisplay error={minimalError} />);

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument();
  });

  it('should handle long error messages properly', () => {
    const longMessageError = {
      ...mockError,
      message: 'This is a very long error message that should wrap properly and not break the layout. '.repeat(5),
    };

    render(<ErrorDisplay error={longMessageError} />);

    expect(screen.getByText(longMessageError.message)).toBeInTheDocument();
  });

  it('should handle special characters in error messages', () => {
    const specialCharError = {
      ...mockError,
      message: 'Error with special chars: <>&"\'',
      title: 'Special & Chars',
    };

    render(<ErrorDisplay error={specialCharError} />);

    expect(screen.getByText('Error with special chars: <>&"\'')).toBeInTheDocument();
    expect(screen.getByText('Special & Chars')).toBeInTheDocument();
  });
});