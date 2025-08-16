import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders create blog post heading', () => {
    render(<App />);
    const linkElement = screen.getByText(/Create Your Blog Post/i);
    expect(linkElement).toBeInTheDocument();
  });
});