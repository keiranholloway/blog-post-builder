import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { SearchAndFilter } from '../SearchAndFilter';
import { ContentStatus } from '../../types/BlogContent';

describe('SearchAndFilter', () => {
  const mockOnFiltersChange = vi.fn();

  const defaultProps = {
    filters: {},
    onFiltersChange: mockOnFiltersChange,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('should render search input and filters toggle', () => {
    render(<SearchAndFilter {...defaultProps} />);

    expect(screen.getByPlaceholderText('Search posts by title or content...')).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('should show expanded filters when toggle is clicked', () => {
    render(<SearchAndFilter {...defaultProps} />);

    fireEvent.click(screen.getByText('Filters'));

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Date Range')).toBeInTheDocument();
  });

  it('should hide expanded filters when toggle is clicked again', () => {
    render(<SearchAndFilter {...defaultProps} />);

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));
    expect(screen.getByText('Status')).toBeInTheDocument();

    // Collapse filters
    fireEvent.click(screen.getByText('Filters'));
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
  });

  it('should debounce search query changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchAndFilter {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText('Search posts by title or content...');

    // Type in search input
    await user.type(searchInput, 'test query');

    // Should not call onFiltersChange immediately
    expect(mockOnFiltersChange).not.toHaveBeenCalled();

    // Advance timers to trigger debounce
    vi.advanceTimersByTime(300);

    await waitFor(() => {
      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        searchQuery: 'test query',
      });
    });
  });

  it('should handle status filter changes', () => {
    render(<SearchAndFilter {...defaultProps} />);

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));

    // Click on draft status
    const draftCheckbox = screen.getByLabelText(/Draft/i);
    fireEvent.click(draftCheckbox);

    expect(mockOnFiltersChange).toHaveBeenCalledWith({
      status: ['draft'],
    });
  });

  it('should handle multiple status selections', () => {
    render(<SearchAndFilter {...defaultProps} />);

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));

    // Select multiple statuses
    fireEvent.click(screen.getByLabelText(/Draft/i));
    fireEvent.click(screen.getByLabelText(/Published/i));

    expect(mockOnFiltersChange).toHaveBeenLastCalledWith({
      status: ['draft', 'published'],
    });
  });

  it('should handle status deselection', () => {
    const propsWithStatus = {
      ...defaultProps,
      filters: { status: ['draft', 'published'] as ContentStatus[] },
    };

    render(<SearchAndFilter {...propsWithStatus} />);

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));

    // Deselect draft
    fireEvent.click(screen.getByLabelText(/Draft/i));

    expect(mockOnFiltersChange).toHaveBeenCalledWith({
      status: ['published'],
    });
  });

  it('should handle platform filter changes', () => {
    render(<SearchAndFilter {...defaultProps} />);

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));

    // Click on Medium platform
    const mediumCheckbox = screen.getByLabelText('Medium');
    fireEvent.click(mediumCheckbox);

    expect(mockOnFiltersChange).toHaveBeenCalledWith({
      platform: ['Medium'],
    });
  });

  it('should handle date range changes', () => {
    render(<SearchAndFilter {...defaultProps} />);

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));

    // Set start date
    const startDateInput = screen.getAllByDisplayValue('')[0]; // First empty date input
    fireEvent.change(startDateInput, { target: { value: '2023-01-01' } });

    expect(mockOnFiltersChange).toHaveBeenCalledWith({
      dateRange: {
        start: new Date('2023-01-01'),
        end: new Date(''),
      },
    });
  });

  it('should handle complete date range', () => {
    render(<SearchAndFilter {...defaultProps} />);

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));

    const dateInputs = screen.getAllByDisplayValue('');
    
    // Set start date
    fireEvent.change(dateInputs[0], { target: { value: '2023-01-01' } });
    
    // Set end date
    fireEvent.change(dateInputs[1], { target: { value: '2023-01-31' } });

    expect(mockOnFiltersChange).toHaveBeenLastCalledWith({
      dateRange: {
        start: new Date('2023-01-01'),
        end: new Date('2023-01-31'),
      },
    });
  });

  it('should show clear all button when filters are active', () => {
    const propsWithFilters = {
      ...defaultProps,
      filters: { searchQuery: 'test', status: ['draft'] as ContentStatus[] },
    };

    render(<SearchAndFilter {...propsWithFilters} />);

    expect(screen.getByText('Clear All')).toBeInTheDocument();
  });

  it('should not show clear all button when no filters are active', () => {
    render(<SearchAndFilter {...defaultProps} />);

    expect(screen.queryByText('Clear All')).not.toBeInTheDocument();
  });

  it('should clear all filters when clear all is clicked', () => {
    const propsWithFilters = {
      ...defaultProps,
      filters: { 
        searchQuery: 'test', 
        status: ['draft'] as ContentStatus[],
        platform: ['Medium'],
      },
    };

    render(<SearchAndFilter {...propsWithFilters} />);

    fireEvent.click(screen.getByText('Clear All'));

    expect(mockOnFiltersChange).toHaveBeenCalledWith({});
  });

  it('should show active indicator when filters are applied', () => {
    const propsWithFilters = {
      ...defaultProps,
      filters: { searchQuery: 'test' },
    };

    render(<SearchAndFilter {...propsWithFilters} />);

    expect(screen.getByText('•')).toBeInTheDocument();
  });

  it('should initialize with existing filter values', () => {
    const existingFilters = {
      searchQuery: 'existing query',
      status: ['draft', 'published'] as ContentStatus[],
      platform: ['Medium'],
      dateRange: {
        start: new Date('2023-01-01'),
        end: new Date('2023-01-31'),
      },
    };

    render(<SearchAndFilter filters={existingFilters} onFiltersChange={mockOnFiltersChange} />);

    // Check search input
    expect(screen.getByDisplayValue('existing query')).toBeInTheDocument();

    // Expand filters to check other values
    fireEvent.click(screen.getByText('Filters'));

    // Check status checkboxes
    expect(screen.getByLabelText(/Draft/i)).toBeChecked();
    expect(screen.getByLabelText(/Published/i)).toBeChecked();

    // Check platform checkboxes
    expect(screen.getByLabelText('Medium')).toBeChecked();

    // Check date inputs
    expect(screen.getByDisplayValue('2023-01-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2023-01-31')).toBeInTheDocument();
  });

  it('should disable inputs when loading', () => {
    render(<SearchAndFilter {...defaultProps} loading={true} />);

    const searchInput = screen.getByPlaceholderText('Search posts by title or content...');
    expect(searchInput).toBeDisabled();

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));

    // Check that checkboxes are disabled
    const draftCheckbox = screen.getByLabelText(/Draft/i);
    expect(draftCheckbox).toBeDisabled();

    // Check that date inputs are disabled
    const dateInputs = screen.getAllByDisplayValue('');
    dateInputs.forEach(input => {
      expect(input).toBeDisabled();
    });
  });

  it('should handle combined filters correctly', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchAndFilter {...defaultProps} />);

    // Add search query
    const searchInput = screen.getByPlaceholderText('Search posts by title or content...');
    await user.type(searchInput, 'test');

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));

    // Add status filter
    fireEvent.click(screen.getByLabelText(/Draft/i));

    // Add platform filter
    fireEvent.click(screen.getByLabelText('Medium'));

    // Advance timers for search debounce
    vi.advanceTimersByTime(300);

    await waitFor(() => {
      expect(mockOnFiltersChange).toHaveBeenLastCalledWith({
        searchQuery: 'test',
        status: ['draft'],
        platform: ['Medium'],
      });
    });
  });

  it('should format status labels correctly', () => {
    render(<SearchAndFilter {...defaultProps} />);

    // Expand filters
    fireEvent.click(screen.getByText('Filters'));

    // Check that status labels are properly formatted
    expect(screen.getByLabelText('Ready For Review')).toBeInTheDocument();
    expect(screen.getByLabelText('Revision Requested')).toBeInTheDocument();
  });
});