import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { ConfirmationDialog } from '../ConfirmationDialog';

describe('ConfirmationDialog', () => {
  const mockOnConfirm = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    isOpen: true,
    title: 'Test Dialog',
    message: 'Are you sure you want to proceed?',
    onConfirm: mockOnConfirm,
    onCancel: mockOnCancel,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render when open', () => {
    render(<ConfirmationDialog {...defaultProps} />);

    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(<ConfirmationDialog {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Test Dialog')).not.toBeInTheDocument();
  });

  it('should call onConfirm when confirm button is clicked', () => {
    render(<ConfirmationDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('Confirm'));
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when cancel button is clicked', () => {
    render(<ConfirmationDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when close button is clicked', () => {
    render(<ConfirmationDialog {...defaultProps} />);

    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when backdrop is clicked', () => {
    render(<ConfirmationDialog {...defaultProps} />);

    const backdrop = screen.getByText('Test Dialog').closest('.confirmation-dialog__backdrop');
    fireEvent.click(backdrop!);
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('should not call onCancel when dialog content is clicked', () => {
    render(<ConfirmationDialog {...defaultProps} />);

    const dialog = screen.getByText('Test Dialog').closest('.confirmation-dialog');
    fireEvent.click(dialog!);
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('should handle escape key press', () => {
    render(<ConfirmationDialog {...defaultProps} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('should not handle escape key when closed', () => {
    render(<ConfirmationDialog {...defaultProps} isOpen={false} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnCancel).not.toHaveBeenCalled();
  });

  it('should use custom button text', () => {
    render(
      <ConfirmationDialog
        {...defaultProps}
        confirmText="Delete"
        cancelText="Keep"
      />
    );

    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Keep')).toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('should apply danger variant styling', () => {
    render(<ConfirmationDialog {...defaultProps} variant="danger" />);

    const dialog = screen.getByText('Test Dialog').closest('.confirmation-dialog');
    expect(dialog).toHaveClass('confirmation-dialog--danger');
  });

  it('should apply warning variant styling', () => {
    render(<ConfirmationDialog {...defaultProps} variant="warning" />);

    const dialog = screen.getByText('Test Dialog').closest('.confirmation-dialog');
    expect(dialog).toHaveClass('confirmation-dialog--warning');
  });

  it('should apply default variant when no variant specified', () => {
    render(<ConfirmationDialog {...defaultProps} />);

    const dialog = screen.getByText('Test Dialog').closest('.confirmation-dialog');
    expect(dialog).not.toHaveClass('confirmation-dialog--danger');
    expect(dialog).not.toHaveClass('confirmation-dialog--warning');
  });

  it('should prevent body scroll when open', () => {
    const originalOverflow = document.body.style.overflow;

    render(<ConfirmationDialog {...defaultProps} />);
    expect(document.body.style.overflow).toBe('hidden');

    // Cleanup should restore original overflow
    const { unmount } = render(<ConfirmationDialog {...defaultProps} isOpen={false} />);
    unmount();
    expect(document.body.style.overflow).toBe('unset');

    // Restore original value
    document.body.style.overflow = originalOverflow;
  });

  it('should handle multiple dialogs correctly', () => {
    const { rerender } = render(<ConfirmationDialog {...defaultProps} />);

    // First dialog should set overflow to hidden
    expect(document.body.style.overflow).toBe('hidden');

    // Rerender with closed dialog
    rerender(<ConfirmationDialog {...defaultProps} isOpen={false} />);
    expect(document.body.style.overflow).toBe('unset');

    // Rerender with open dialog again
    rerender(<ConfirmationDialog {...defaultProps} isOpen={true} />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('should handle long messages correctly', () => {
    const longMessage = 'This is a very long message that should still be displayed correctly in the dialog. '.repeat(10);
    
    render(
      <ConfirmationDialog
        {...defaultProps}
        message={longMessage}
      />
    );

    expect(screen.getByText(longMessage)).toBeInTheDocument();
  });

  it('should handle special characters in title and message', () => {
    const specialTitle = 'Title with "quotes" & <tags>';
    const specialMessage = 'Message with special chars: @#$%^&*()';

    render(
      <ConfirmationDialog
        {...defaultProps}
        title={specialTitle}
        message={specialMessage}
      />
    );

    expect(screen.getByText(specialTitle)).toBeInTheDocument();
    expect(screen.getByText(specialMessage)).toBeInTheDocument();
  });
});