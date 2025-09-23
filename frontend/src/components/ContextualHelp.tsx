import React, { useState, useEffect } from 'react';
import './ContextualHelp.css';

interface HelpTip {
  id: string;
  title: string;
  content: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  trigger: 'hover' | 'click' | 'focus';
}

interface ContextualHelpProps {
  helpKey: string;
  children: React.ReactNode;
  className?: string;
}

const helpContent: Record<string, HelpTip> = {
  'voice-recording': {
    id: 'voice-recording',
    title: 'Voice Recording Tips',
    content: 'Tap and hold to record. Speak clearly for 1-3 minutes about your blog idea. Find a quiet space for best results.',
    position: 'top',
    trigger: 'hover'
  },
  'text-input': {
    id: 'text-input',
    title: 'Text Input Alternative',
    content: 'Type or paste your blog ideas here. Can be rough notes or structured content - the AI will organize it.',
    position: 'top',
    trigger: 'focus'
  },
  'platform-connection': {
    id: 'platform-connection',
    title: 'Connect Publishing Platforms',
    content: 'Connect Medium, LinkedIn, and other platforms once. Then publish to multiple channels with one click.',
    position: 'right',
    trigger: 'hover'
  },
  'content-review': {
    id: 'content-review',
    title: 'Review Generated Content',
    content: 'Read through the AI-generated blog post and image. Use the feedback forms to request changes.',
    position: 'bottom',
    trigger: 'hover'
  },
  'feedback-form': {
    id: 'feedback-form',
    title: 'Providing Effective Feedback',
    content: 'Be specific about changes you want. Example: "Make it more casual" or "Add more technical details".',
    position: 'left',
    trigger: 'focus'
  },
  'publishing-options': {
    id: 'publishing-options',
    title: 'Publishing Settings',
    content: 'Choose which platforms to publish to. Each platform gets optimized formatting automatically.',
    position: 'top',
    trigger: 'hover'
  },
  'draft-management': {
    id: 'draft-management',
    title: 'Managing Drafts',
    content: 'Save work in progress and return later. Drafts are automatically saved as you work.',
    position: 'right',
    trigger: 'hover'
  },
  'search-filter': {
    id: 'search-filter',
    title: 'Find Your Content',
    content: 'Search by title, date, or platform. Filter by status: draft, published, or failed.',
    position: 'bottom',
    trigger: 'focus'
  }
};

const ContextualHelp: React.FC<ContextualHelpProps> = ({ 
  helpKey, 
  children, 
  className = '' 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const helpTip = helpContent[helpKey];

  if (!helpTip) {
    return <>{children}</>;
  }

  const showHelp = (event: React.MouseEvent | React.FocusEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;

    let x = rect.left + scrollX;
    let y = rect.top + scrollY;

    // Adjust position based on preferred position
    switch (helpTip.position) {
      case 'top':
        x += rect.width / 2;
        y -= 10;
        break;
      case 'bottom':
        x += rect.width / 2;
        y += rect.height + 10;
        break;
      case 'left':
        x -= 10;
        y += rect.height / 2;
        break;
      case 'right':
        x += rect.width + 10;
        y += rect.height / 2;
        break;
    }

    setPosition({ x, y });
    setIsVisible(true);
  };

  const hideHelp = () => {
    setIsVisible(false);
  };

  const handleMouseEnter = (event: React.MouseEvent) => {
    if (helpTip.trigger === 'hover') {
      showHelp(event);
    }
  };

  const handleMouseLeave = () => {
    if (helpTip.trigger === 'hover') {
      hideHelp();
    }
  };

  const handleClick = (event: React.MouseEvent) => {
    if (helpTip.trigger === 'click') {
      event.preventDefault();
      if (isVisible) {
        hideHelp();
      } else {
        showHelp(event);
      }
    }
  };

  const handleFocus = (event: React.FocusEvent) => {
    if (helpTip.trigger === 'focus') {
      showHelp(event);
    }
  };

  const handleBlur = () => {
    if (helpTip.trigger === 'focus') {
      hideHelp();
    }
  };

  // Close help when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (helpTip.trigger === 'click') {
        hideHelp();
      }
    };

    if (isVisible) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isVisible, helpTip.trigger]);

  return (
    <>
      <div
        className={`contextual-help-wrapper ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        {children}
        {helpTip.trigger === 'hover' && (
          <div className="help-indicator">?</div>
        )}
      </div>
      
      {isVisible && (
        <div
          className={`contextual-help-tooltip ${helpTip.position}`}
          style={{
            left: position.x,
            top: position.y,
          }}
        >
          <div className="help-tooltip-content">
            <h4 className="help-tooltip-title">{helpTip.title}</h4>
            <p className="help-tooltip-text">{helpTip.content}</p>
          </div>
          <div className={`help-tooltip-arrow ${helpTip.position}`}></div>
        </div>
      )}
    </>
  );
};

// Hook for programmatic help display
export const useContextualHelp = () => {
  const [activeHelp, setActiveHelp] = useState<string | null>(null);

  const showHelp = (helpKey: string) => {
    setActiveHelp(helpKey);
  };

  const hideHelp = () => {
    setActiveHelp(null);
  };

  return { activeHelp, showHelp, hideHelp };
};

// Help button component for explicit help triggers
interface HelpButtonProps {
  helpKey: string;
  size?: 'small' | 'medium' | 'large';
  variant?: 'icon' | 'text' | 'both';
}

export const HelpButton: React.FC<HelpButtonProps> = ({ 
  helpKey, 
  size = 'medium',
  variant = 'icon'
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const helpTip = helpContent[helpKey];

  if (!helpTip) return null;

  const toggleHelp = () => {
    setIsVisible(!isVisible);
  };

  return (
    <div className="help-button-container">
      <button
        className={`help-button ${size} ${variant}`}
        onClick={toggleHelp}
        aria-label={`Help: ${helpTip.title}`}
      >
        {(variant === 'icon' || variant === 'both') && (
          <span className="help-icon">?</span>
        )}
        {(variant === 'text' || variant === 'both') && (
          <span className="help-text">Help</span>
        )}
      </button>
      
      {isVisible && (
        <div className="help-popup">
          <div className="help-popup-header">
            <h4>{helpTip.title}</h4>
            <button 
              className="help-close-button"
              onClick={() => setIsVisible(false)}
              aria-label="Close help"
            >
              ×
            </button>
          </div>
          <div className="help-popup-content">
            <p>{helpTip.content}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// Help overlay for guided tours
interface HelpOverlayProps {
  isVisible: boolean;
  onClose: () => void;
  helpKey: string;
}

export const HelpOverlay: React.FC<HelpOverlayProps> = ({
  isVisible,
  onClose,
  helpKey
}) => {
  const helpTip = helpContent[helpKey];

  if (!isVisible || !helpTip) return null;

  return (
    <div className="help-overlay">
      <div className="help-overlay-backdrop" onClick={onClose} />
      <div className="help-overlay-content">
        <div className="help-overlay-header">
          <h3>{helpTip.title}</h3>
          <button 
            className="help-overlay-close"
            onClick={onClose}
            aria-label="Close help"
          >
            ×
          </button>
        </div>
        <div className="help-overlay-body">
          <p>{helpTip.content}</p>
        </div>
        <div className="help-overlay-footer">
          <button className="help-overlay-button" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};

export default ContextualHelp;