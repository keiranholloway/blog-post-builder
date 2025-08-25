import React, { useState, useRef, useEffect } from 'react';
import './InlineEditor.css';

interface InlineEditorProps {
  value: string;
  onSave: (newValue: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
}

export const InlineEditor: React.FC<InlineEditorProps> = ({
  value,
  onSave,
  onCancel,
  placeholder = 'Click to edit...',
  multiline = false,
  maxLength,
  className = '',
  disabled = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (multiline) {
        // For textarea, select all text
        inputRef.current.select();
      } else {
        // For input, set cursor at end
        const length = inputRef.current.value.length;
        inputRef.current.setSelectionRange(length, length);
      }
    }
  }, [isEditing, multiline]);

  const handleStartEdit = () => {
    if (disabled) return;
    setIsEditing(true);
    setEditValue(value);
  };

  const handleSave = async () => {
    if (editValue.trim() === value.trim()) {
      setIsEditing(false);
      return;
    }

    try {
      setIsSaving(true);
      await onSave(editValue.trim());
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving inline edit:', error);
      // Keep editing mode open on error
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
    if (onCancel) {
      onCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Enter' && multiline && e.ctrlKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleBlur = () => {
    // Small delay to allow clicking save button
    setTimeout(() => {
      if (isEditing && !isSaving) {
        handleSave();
      }
    }, 150);
  };

  if (isEditing) {
    return (
      <div className={`inline-editor editing ${className}`}>
        <div className="editor-input-container">
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder={placeholder}
              maxLength={maxLength}
              className="editor-textarea"
              disabled={isSaving}
              rows={3}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder={placeholder}
              maxLength={maxLength}
              className="editor-input"
              disabled={isSaving}
            />
          )}
          
          {maxLength && (
            <div className="character-count">
              {editValue.length}/{maxLength}
            </div>
          )}
        </div>

        <div className="editor-actions">
          <button
            type="button"
            onClick={handleSave}
            className="save-button"
            disabled={isSaving || !editValue.trim()}
          >
            {isSaving ? (
              <>
                <span className="spinner-small"></span>
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="cancel-button"
            disabled={isSaving}
          >
            Cancel
          </button>
        </div>

        <div className="editor-hint">
          {multiline ? 'Ctrl+Enter to save, Esc to cancel' : 'Enter to save, Esc to cancel'}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`inline-editor display ${className} ${disabled ? 'disabled' : ''}`}
      onClick={handleStartEdit}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          handleStartEdit();
        }
      }}
    >
      <div className="display-content">
        {value || (
          <span className="placeholder-text">{placeholder}</span>
        )}
      </div>
      
      {!disabled && (
        <div className="edit-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </div>
      )}
    </div>
  );
};