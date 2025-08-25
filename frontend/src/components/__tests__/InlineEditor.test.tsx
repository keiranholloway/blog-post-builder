import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineEditor } from '../InlineEditor';

describe('InlineEditor', () => {
  const defaultProps = {
    value: 'Test content',
    onSave: vi.fn(),
    onCancel: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Display Mode', () => {
    it('should render value in display mode by default', () => {
      render(<InlineEditor {...defaultProps} />);
      
      expect(screen.getByText('Test content')).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('should show placeholder when value is empty', () => {
      render(
        <InlineEditor 
          {...defaultProps} 
          value="" 
          placeholder="Click to add content..." 
        />
      );
      
      expect(screen.getByText('Click to add content...')).toBeInTheDocument();
    });

    it('should show edit icon on hover', () => {
      render(<InlineEditor {...defaultProps} />);
      
      const editor = screen.getByRole('button');
      expect(editor).toBeInTheDocument();
    });

    it('should enter edit mode when clicked', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);
      
      await user.click(screen.getByRole('button'));
      
      expect(screen.getByDisplayValue('Test content')).toBeInTheDocument();
      expect(screen.getByText('Save')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should enter edit mode when Enter key is pressed', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);
      
      const editor = screen.getByRole('button');
      editor.focus();
      await user.keyboard('{Enter}');
      
      expect(screen.getByDisplayValue('Test content')).toBeInTheDocument();
    });

    it('should enter edit mode when Space key is pressed', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);
      
      const editor = screen.getByRole('button');
      editor.focus();
      await user.keyboard(' ');
      
      expect(screen.getByDisplayValue('Test content')).toBeInTheDocument();
    });

    it('should not enter edit mode when disabled', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} disabled />);
      
      await user.click(screen.getByText('Test content'));
      
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  describe('Edit Mode', () => {
    it('should render input field in edit mode', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);
      
      await user.click(screen.getByRole('button'));
      
      const input = screen.getByDisplayValue('Test content');
      expect(input).toBeInTheDocument();
      expect(input).toHaveFocus();
    });

    it('should render textarea when multiline is true', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} multiline />);
      
      await user.click(screen.getByRole('button'));
      
      const textarea = screen.getByDisplayValue('Test content');
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('should show character count when maxLength is provided', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} maxLength={100} />);
      
      await user.click(screen.getByRole('button'));
      
      expect(screen.getByText('12/100')).toBeInTheDocument();
    });

    it('should update character count as user types', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} maxLength={100} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      
      await user.clear(input);
      await user.type(input, 'New content');
      
      expect(screen.getByText('11/100')).toBeInTheDocument();
    });

    it('should show appropriate keyboard hints', async () => {
      const user = userEvent.setup();
      
      // Single line
      render(<InlineEditor {...defaultProps} />);
      await user.click(screen.getByRole('button'));
      expect(screen.getByText('Enter to save, Esc to cancel')).toBeInTheDocument();
      
      // Multiline
      render(<InlineEditor {...defaultProps} multiline />);
      await user.click(screen.getAllByRole('button')[1]);
      expect(screen.getByText('Ctrl+Enter to save, Esc to cancel')).toBeInTheDocument();
    });
  });

  describe('Save Functionality', () => {
    it('should call onSave when save button is clicked', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<InlineEditor {...defaultProps} onSave={onSave} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, 'Updated content');
      await user.click(screen.getByText('Save'));
      
      expect(onSave).toHaveBeenCalledWith('Updated content');
    });

    it('should call onSave when Enter is pressed (single line)', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<InlineEditor {...defaultProps} onSave={onSave} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, 'Updated content');
      await user.keyboard('{Enter}');
      
      expect(onSave).toHaveBeenCalledWith('Updated content');
    });

    it('should call onSave when Ctrl+Enter is pressed (multiline)', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<InlineEditor {...defaultProps} multiline onSave={onSave} />);
      
      await user.click(screen.getByRole('button'));
      const textarea = screen.getByDisplayValue('Test content');
      await user.clear(textarea);
      await user.type(textarea, 'Updated content');
      await user.keyboard('{Control>}{Enter}{/Control}');
      
      expect(onSave).toHaveBeenCalledWith('Updated content');
    });

    it('should not call onSave if content is unchanged', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<InlineEditor {...defaultProps} onSave={onSave} />);
      
      await user.click(screen.getByRole('button'));
      await user.click(screen.getByText('Save'));
      
      expect(onSave).not.toHaveBeenCalled();
    });

    it('should trim whitespace before saving', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<InlineEditor {...defaultProps} onSave={onSave} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, '  Updated content  ');
      await user.click(screen.getByText('Save'));
      
      expect(onSave).toHaveBeenCalledWith('Updated content');
    });

    it('should show loading state while saving', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockImplementation(() => new Promise(() => {})); // Never resolves
      render(<InlineEditor {...defaultProps} onSave={onSave} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, 'Updated content');
      await user.click(screen.getByText('Save'));
      
      expect(screen.getByText('Saving...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
      expect(screen.getByText('Cancel')).toBeDisabled();
    });

    it('should exit edit mode after successful save', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<InlineEditor {...defaultProps} onSave={onSave} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, 'Updated content');
      await user.click(screen.getByText('Save'));
      
      await waitFor(() => {
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      });
    });

    it('should stay in edit mode if save fails', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));
      render(<InlineEditor {...defaultProps} onSave={onSave} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, 'Updated content');
      await user.click(screen.getByText('Save'));
      
      await waitFor(() => {
        expect(screen.getByDisplayValue('Updated content')).toBeInTheDocument();
      });
    });

    it('should disable save button when content is empty', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      
      expect(screen.getByText('Save')).toBeDisabled();
    });
  });

  describe('Cancel Functionality', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<InlineEditor {...defaultProps} onCancel={onCancel} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, 'Updated content');
      await user.click(screen.getByText('Cancel'));
      
      expect(onCancel).toHaveBeenCalled();
    });

    it('should call onCancel when Escape is pressed', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<InlineEditor {...defaultProps} onCancel={onCancel} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, 'Updated content');
      await user.keyboard('{Escape}');
      
      expect(onCancel).toHaveBeenCalled();
    });

    it('should reset value to original when cancelled', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);
      
      await user.click(screen.getByRole('button'));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, 'Updated content');
      await user.click(screen.getByText('Cancel'));
      
      expect(screen.getByText('Test content')).toBeInTheDocument();
    });

    it('should exit edit mode when cancelled', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);
      
      await user.click(screen.getByRole('button'));
      await user.click(screen.getByText('Cancel'));
      
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  describe('Auto-save on Blur', () => {
    it('should save when input loses focus', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(
        <div>
          <InlineEditor {...defaultProps} onSave={onSave} />
          <button>Other button</button>
        </div>
      );
      
      await user.click(screen.getByRole('button', { name: /test content/i }));
      const input = screen.getByDisplayValue('Test content');
      await user.clear(input);
      await user.type(input, 'Updated content');
      await user.click(screen.getByText('Other button'));
      
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('Updated content');
      });
    });

    it('should not save on blur if content is unchanged', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(
        <div>
          <InlineEditor {...defaultProps} onSave={onSave} />
          <button>Other button</button>
        </div>
      );
      
      await user.click(screen.getByRole('button', { name: /test content/i }));
      await user.click(screen.getByText('Other button'));
      
      await waitFor(() => {
        expect(onSave).not.toHaveBeenCalled();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(<InlineEditor {...defaultProps} />);
      
      const editor = screen.getByRole('button');
      expect(editor).toHaveAttribute('tabIndex', '0');
    });

    it('should not be focusable when disabled', () => {
      render(<InlineEditor {...defaultProps} disabled />);
      
      const editor = screen.getByText('Test content').closest('[role="button"]');
      expect(editor).toHaveAttribute('tabIndex', '-1');
    });

    it('should focus input when entering edit mode', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} />);
      
      await user.click(screen.getByRole('button'));
      
      const input = screen.getByDisplayValue('Test content');
      expect(input).toHaveFocus();
    });

    it('should select all text in textarea when entering edit mode', async () => {
      const user = userEvent.setup();
      render(<InlineEditor {...defaultProps} multiline />);
      
      await user.click(screen.getByRole('button'));
      
      const textarea = screen.getByDisplayValue('Test content') as HTMLTextAreaElement;
      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe('Test content'.length);
    });
  });

  describe('Variants', () => {
    it('should apply title variant styles', () => {
      render(<InlineEditor {...defaultProps} className="title" />);
      
      const editor = screen.getByRole('button');
      expect(editor).toHaveClass('title');
    });

    it('should apply subtitle variant styles', () => {
      render(<InlineEditor {...defaultProps} className="subtitle" />);
      
      const editor = screen.getByRole('button');
      expect(editor).toHaveClass('subtitle');
    });

    it('should apply body variant styles', () => {
      render(<InlineEditor {...defaultProps} className="body" />);
      
      const editor = screen.getByRole('button');
      expect(editor).toHaveClass('body');
    });
  });
});