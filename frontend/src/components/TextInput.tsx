import React, { useState } from 'react';
import './TextInput.css';

interface TextInputProps {
  onSubmit: (text: string) => void;
  onError: (error: string) => void;
  placeholder?: string;
  maxLength?: number;
}

export const TextInput: React.FC<TextInputProps> = ({
  onSubmit,
  onError,
  placeholder = "Type your blog post ideas here...",
  maxLength = 5000
}) => {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!text.trim()) {
      onError('Please enter some text before submitting');
      return;
    }

    if (text.trim().length < 10) {
      onError('Please enter at least 10 characters');
      return;
    }

    setIsSubmitting(true);
    
    try {
      await onSubmit(text.trim());
      setText(''); // Clear after successful submission
    } catch (error) {
      onError('Failed to submit text. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    if (newText.length <= maxLength) {
      setText(newText);
    }
  };

  const characterCount = text.length;
  const isNearLimit = characterCount > maxLength * 0.9;
  const isValid = text.trim().length >= 10;

  return (
    <div className="text-input">
      <form onSubmit={handleSubmit} className="text-input__form">
        <div className="text-input__container">
          <textarea
            value={text}
            onChange={handleTextChange}
            placeholder={placeholder}
            className="text-input__textarea"
            rows={8}
            disabled={isSubmitting}
          />
          
          <div className="text-input__footer">
            <div className="text-input__character-count">
              <span className={isNearLimit ? 'text-input__character-count--warning' : ''}>
                {characterCount}/{maxLength}
              </span>
            </div>
            
            <button
              type="submit"
              className="text-input__submit-button"
              disabled={!isValid || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <div className="text-input__spinner" />
                  Processing...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                  Submit Ideas
                </>
              )}
            </button>
          </div>
        </div>
      </form>
      
      <div className="text-input__tips">
        <h4>💡 Tips for better results:</h4>
        <ul>
          <li>Describe your main topic or theme</li>
          <li>Include key points you want to cover</li>
          <li>Mention your target audience</li>
          <li>Add any specific examples or stories</li>
        </ul>
      </div>
    </div>
  );
};