import React from 'react';
import './StatusIndicator.css';

interface StatusIndicatorProps {
  status: string;
  variant: string;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, variant }) => {
  return (
    <span className={`status-indicator status-indicator--${variant}`}>
      {status}
    </span>
  );
};

export default StatusIndicator;