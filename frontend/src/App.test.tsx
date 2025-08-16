import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders automated blog poster heading', () => {
  render(<App />);
  const linkElement = screen.getByText(/Automated Blog Poster/i);
  expect(linkElement).toBeInTheDocument();
});