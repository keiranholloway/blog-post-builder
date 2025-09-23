import React, { useState, useEffect } from 'react';
import './Onboarding.css';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  component: React.ReactNode;
  canSkip?: boolean;
}

interface OnboardingProps {
  onComplete: () => void;
  onSkip: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete, onSkip }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  const steps: OnboardingStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to Automated Blog Poster',
      description: 'Transform your voice recordings into published blog posts in minutes.',
      component: (
        <div className="onboarding-welcome">
          <div className="welcome-icon">🎙️</div>
          <p>This quick tour will show you how to:</p>
          <ul>
            <li>Record voice memos for blog ideas</li>
            <li>Review AI-generated content</li>
            <li>Publish to multiple platforms</li>
          </ul>
        </div>
      ),
      canSkip: true
    },
    {
      id: 'voice-input',
      title: 'Voice Input Made Simple',
      description: 'Just tap and speak for 1-3 minutes about your blog idea.',
      component: (
        <div className="onboarding-demo">
          <div className="demo-phone">
            <div className="demo-voice-button">
              <div className="pulse-animation"></div>
              🎤
            </div>
          </div>
          <div className="demo-tips">
            <h4>Recording Tips:</h4>
            <ul>
              <li>Find a quiet space</li>
              <li>Speak naturally and clearly</li>
              <li>Share your thoughts freely</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'ai-processing',
      title: 'AI Does the Heavy Lifting',
      description: 'Our AI agents transform your ideas into polished content.',
      component: (
        <div className="onboarding-process">
          <div className="process-flow">
            <div className="process-step">
              <div className="step-icon">🎵</div>
              <span>Voice to Text</span>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="step-icon">✍️</div>
              <span>Content Generation</span>
            </div>
            <div className="process-arrow">→</div>
            <div className="process-step">
              <div className="step-icon">🖼️</div>
              <span>Image Creation</span>
            </div>
          </div>
          <p>The AI learns your writing style and creates content that sounds like you.</p>
        </div>
      )
    },
    {
      id: 'review-feedback',
      title: 'Review and Refine',
      description: 'Review the generated content and provide feedback for revisions.',
      component: (
        <div className="onboarding-review">
          <div className="demo-review-interface">
            <div className="demo-content">
              <h4>Generated Blog Post</h4>
              <p>Your AI-generated content appears here...</p>
            </div>
            <div className="demo-image">
              <div className="image-placeholder">🖼️</div>
            </div>
          </div>
          <div className="feedback-options">
            <button className="demo-button">👍 Approve</button>
            <button className="demo-button">💬 Give Feedback</button>
          </div>
        </div>
      )
    },
    {
      id: 'publishing',
      title: 'Publish Everywhere',
      description: 'Connect your platforms and publish to multiple channels at once.',
      component: (
        <div className="onboarding-publishing">
          <div className="platform-grid">
            <div className="platform-card">
              <div className="platform-icon">📝</div>
              <span>Medium</span>
            </div>
            <div className="platform-card">
              <div className="platform-icon">💼</div>
              <span>LinkedIn</span>
            </div>
            <div className="platform-card">
              <div className="platform-icon">➕</div>
              <span>More Coming</span>
            </div>
          </div>
          <p>Connect once, publish everywhere. Each platform gets optimized formatting.</p>
        </div>
      )
    },
    {
      id: 'ready',
      title: 'You\'re All Set!',
      description: 'Ready to create your first blog post?',
      component: (
        <div className="onboarding-ready">
          <div className="ready-icon">🚀</div>
          <p>You now know how to:</p>
          <ul>
            <li>✅ Record voice memos</li>
            <li>✅ Review AI-generated content</li>
            <li>✅ Publish to multiple platforms</li>
          </ul>
          <div className="next-steps">
            <h4>Next Steps:</h4>
            <ol>
              <li>Connect your publishing platforms</li>
              <li>Record your first voice memo</li>
              <li>Watch the magic happen!</li>
            </ol>
          </div>
        </div>
      )
    }
  ];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      completeOnboarding();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const completeOnboarding = () => {
    setIsVisible(false);
    localStorage.setItem('onboarding-completed', 'true');
    onComplete();
  };

  const skipOnboarding = () => {
    setIsVisible(false);
    localStorage.setItem('onboarding-skipped', 'true');
    onSkip();
  };

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  if (!isVisible) return null;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <div className="onboarding-header">
          <h2>{currentStepData.title}</h2>
          <p className="onboarding-description">{currentStepData.description}</p>
          {currentStepData.canSkip && (
            <button className="skip-button" onClick={skipOnboarding}>
              Skip Tour
            </button>
          )}
        </div>

        <div className="onboarding-content">
          {currentStepData.component}
        </div>

        <div className="onboarding-progress">
          <div className="progress-dots">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`progress-dot ${index === currentStep ? 'active' : ''} ${
                  index < currentStep ? 'completed' : ''
                }`}
              />
            ))}
          </div>
          <span className="progress-text">
            {currentStep + 1} of {steps.length}
          </span>
        </div>

        <div className="onboarding-actions">
          <button
            className="onboarding-button secondary"
            onClick={prevStep}
            disabled={currentStep === 0}
          >
            Back
          </button>
          <button
            className="onboarding-button primary"
            onClick={nextStep}
          >
            {isLastStep ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;