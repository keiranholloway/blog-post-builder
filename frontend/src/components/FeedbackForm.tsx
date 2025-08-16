import React, { useState } from 'react';
import './FeedbackForm.css';

interface FeedbackFormProps {
  type: 'content' | 'image';
  onSubmit: (feedback: string, revisionType?: string) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  className?: string;
}

const CONTENT_REVISION_TYPES = [
  { value: 'tone', label: 'Tone & Style' },
  { value: 'structure', label: 'Structure & Flow' },
  { value: 'information', label: 'Information & Facts' },
  { value: 'length', label: 'Length & Detail' },
  { value: 'audience', label: 'Target Audience' },
  { value: 'other', label: 'Other' }
];

const IMAGE_REVISION_TYPES = [
  { value: 'style', label: 'Visual Style' },
  { value: 'composition', label: 'Composition' },
  { value: 'colors', label: 'Colors & Lighting' },
  { value: 'subject', label: 'Subject Matter' },
  { value: 'mood', label: 'Mood & Atmosphere' },
  { value: 'other', label: 'Other' }
];

const FEEDBACK_TEMPLATES = {
  content: {
    tone: 'Please adjust the tone to be more...',
    structure: 'The structure could be improved by...',
    information: 'Please add/remove information about...',
    length: 'Please make this content...',
    audience: 'Please adjust for the target audience by...',
    other: 'Please make the following changes...'
  },
  image: {
    style: 'Please change the visual style to be more...',
    composition: 'Please adjust the composition by...',
    colors: 'Please modify the colors to be more...',
    subject: 'Please change the subject matter to show...',
    mood: 'Please adjust the mood to be more...',
    other: 'Please make the following changes to the image...'
  }
};

export const FeedbackForm: React.FC<FeedbackFormProps> = ({
  type,
  onSubmit,
  onCancel,
  isSubmitting = false,
  className = ''
}) => {
  const [feedback, setFeedback] = useState('');
  const [revisionType, setRevisionType] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);

  const revisionTypes = type === 'content' ? CONTENT_REVISION_TYPES : IMAGE_REVISION_TYPES;
  const templates = FEEDBACK_TEMPLATES[type];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (feedback.trim()) {
      onSubmit(feedback.trim(), revisionType || undefined);
    }
  };

  const handleTemplateSelect = (templateKey: string) => {
    const template = templates[templateKey as keyof typeof templates];
    setFeedback(template);
    setRevisionType(templateKey);
    setShowTemplates(false);
  };

  const handleRevisionTypeChange = (value: string) => {
    setRevisionType(value);
    if (value && templates[value as keyof typeof templates]) {
      setFeedback(templates[value as keyof typeof templates]);
    }
  };

  return (
    <div className={`feedback-form ${className}`}>
      <form onSubmit={handleSubmit}>
        <div className="form-header">
          <h3>
            Provide {type === 'content' ? 'Content' : 'Image'} Feedback
          </h3>
          <p className="form-description">
            {type === 'content' 
              ? 'Describe what changes you\'d like to see in the content. Be specific about tone, structure, or information that should be added or removed.'
              : 'Describe what changes you\'d like to see in the image. Mention style, colors, composition, or subject matter adjustments.'
            }
          </p>
        </div>

        {/* Revision type selector */}
        <div className="form-group">
          <label htmlFor="revision-type" className="form-label">
            What type of changes do you want? (Optional)
          </label>
          <select
            id="revision-type"
            value={revisionType}
            onChange={(e) => handleRevisionTypeChange(e.target.value)}
            className="revision-type-select"
            disabled={isSubmitting}
          >
            <option value="">Select revision type...</option>
            {revisionTypes.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        {/* Quick templates */}
        <div className="form-group">
          <button
            type="button"
            onClick={() => setShowTemplates(!showTemplates)}
            className="template-toggle"
            disabled={isSubmitting}
          >
            {showTemplates ? 'Hide' : 'Show'} Quick Templates
          </button>
          
          {showTemplates && (
            <div className="template-options">
              {Object.entries(templates).map(([key, template]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleTemplateSelect(key)}
                  className="template-button"
                  disabled={isSubmitting}
                >
                  <strong>{revisionTypes.find(t => t.value === key)?.label}:</strong>
                  <span>{template}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Feedback textarea */}
        <div className="form-group">
          <label htmlFor="feedback-text" className="form-label">
            Your feedback <span className="required">*</span>
          </label>
          <textarea
            id="feedback-text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={`Enter your ${type} feedback here...`}
            className="feedback-textarea"
            rows={6}
            disabled={isSubmitting}
            required
          />
          <div className="character-count">
            {feedback.length} characters
          </div>
        </div>

        {/* Action buttons */}
        <div className="form-actions">
          <button
            type="button"
            onClick={onCancel}
            className="cancel-button"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="submit-button"
            disabled={!feedback.trim() || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="spinner-small"></span>
                Submitting...
              </>
            ) : (
              `Submit ${type === 'content' ? 'Content' : 'Image'} Feedback`
            )}
          </button>
        </div>
      </form>
    </div>
  );
};