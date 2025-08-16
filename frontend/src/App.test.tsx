import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders automated blog poster heading', () => {
    render(<App />);
    const linkElement = screen.getByText(/Automated Blog Poster/i);
    expect(linkElement).toBeInTheDocument();
  });
});