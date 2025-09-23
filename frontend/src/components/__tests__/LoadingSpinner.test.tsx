import React from 'react';
import { render, screen } from '@testing-library/react';
import { LoadingSpinner } from '../LoadingSpinner';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { expect } from 'vitest';
import { it } from 'vitest';
import { describe } from 'vitest';

describe('LoadingSpinner', () => {
  it('should render with default props', () => {
    const { container } = render(<LoadingSpinner />);
    
    const spinner = container.querySelector('.loading-spinner');
    expect(spinner).toHaveClass('loading-spinner');
    expect(spinner).toHaveClass('loading-spinner--medium');
    expect(spinner).toHaveClass('loading-spinner--primary');
  });

  it('should render with small size', () => {
    const { container } = render(<LoadingSpinner size="small" />);
    
    const spinner = container.querySelector('.loading-spinner');
    expect(spinner).toHaveClass('loading-spinner--small');
    expect(spinner).not.toHaveClass('loading-spinner--medium');
  });

  it('should render with large size', () => {
    const { container } = render(<LoadingSpinner size="large" />);
    
    const spinner = container.querySelector('.loading-spinner');
    expect(spinner).toHaveClass('loading-spinner--large');
    expect(spinner).not.toHaveClass('loading-spinner--medium');
  });

  it('should render with secondary color', () => {
    const { container } = render(<LoadingSpinner color="secondary" />);
    
    const spinner = container.querySelector('.loading-spinner');
    expect(spinner).toHaveClass('loading-spinner--secondary');
    expect(spinner).not.toHaveClass('loading-spinner--primary');
  });

  it('should render with white color', () => {
    const { container } = render(<LoadingSpinner color="white" />);
    
    const spinner = container.querySelector('.loading-spinner');
    expect(spinner).toHaveClass('loading-spinner--white');
    expect(spinner).not.toHaveClass('loading-spinner--primary');
  });

  it('should combine size and color props correctly', () => {
    const { container } = render(<LoadingSpinner size="large" color="secondary" />);
    
    const spinner = container.querySelector('.loading-spinner');
    expect(spinner).toHaveClass('loading-spinner--large');
    expect(spinner).toHaveClass('loading-spinner--secondary');
    expect(spinner).not.toHaveClass('loading-spinner--medium');
    expect(spinner).not.toHaveClass('loading-spinner--primary');
  });

  it('should contain the spinning circle element', () => {
    const { container } = render(<LoadingSpinner />);
    
    const circle = container.querySelector('.loading-spinner__circle');
    expect(circle).toBeInTheDocument();
  });

  it('should have proper structure for all size variants', () => {
    const sizes = ['small', 'medium', 'large'] as const;
    
    sizes.forEach(size => {
      const { container, unmount } = render(<LoadingSpinner size={size} />);
      
      const spinner = container.querySelector('.loading-spinner');
      const circle = container.querySelector('.loading-spinner__circle');
      
      expect(spinner).toHaveClass(`loading-spinner--${size}`);
      expect(circle).toBeInTheDocument();
      
      unmount();
    });
  });

  it('should have proper structure for all color variants', () => {
    const colors = ['primary', 'secondary', 'white'] as const;
    
    colors.forEach(color => {
      const { container, unmount } = render(<LoadingSpinner color={color} />);
      
      const spinner = container.querySelector('.loading-spinner');
      expect(spinner).toHaveClass(`loading-spinner--${color}`);
      
      unmount();
    });
  });

  it('should be accessible', () => {
    const { container } = render(<LoadingSpinner />);
    
    // The spinner should be a generic container that doesn't interfere with screen readers
    const spinner = container.querySelector('.loading-spinner');
    expect(spinner).toBeInTheDocument();
    
    // Should not have any interactive elements
    expect(container.querySelector('button')).not.toBeInTheDocument();
    expect(container.querySelector('input')).not.toBeInTheDocument();
  });

  it('should maintain consistent class structure', () => {
    const { container } = render(<LoadingSpinner size="small" color="white" />);
    
    const spinner = container.querySelector('.loading-spinner');
    const circle = container.querySelector('.loading-spinner__circle');
    
    // Should have base class plus modifiers
    expect(spinner).toHaveClass('loading-spinner');
    expect(spinner).toHaveClass('loading-spinner--small');
    expect(spinner).toHaveClass('loading-spinner--white');
    
    // Circle should have its class
    expect(circle).toHaveClass('loading-spinner__circle');
  });

  it('should render multiple spinners independently', () => {
    const { container } = render(
      <div>
        <LoadingSpinner size="small" color="primary" />
        <LoadingSpinner size="large" color="secondary" />
      </div>
    );
    
    const spinners = container.querySelectorAll('.loading-spinner');
    expect(spinners).toHaveLength(2);
    
    expect(spinners[0]).toHaveClass('loading-spinner--small');
    expect(spinners[0]).toHaveClass('loading-spinner--primary');
    
    expect(spinners[1]).toHaveClass('loading-spinner--large');
    expect(spinners[1]).toHaveClass('loading-spinner--secondary');
  });
});