import React from 'react';
import './LoadingSpinner.css';

interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  color?: 'primary' | 'secondary' | 'white';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  color = 'primary',
}) => {
  return (
    <div className={`loading-spinner loading-spinner--${size} loading-spinner--${color}`}>
      <div className="loading-spinner__circle"></div>
    </div>
  );
};