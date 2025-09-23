import React, { useState, useEffect } from 'react';
import { ContentStatus } from '../types/BlogContent';
import { DashboardFilters } from '../services/dashboardService';
import './SearchAndFilter.css';

interface SearchAndFilterProps {
  filters: DashboardFilters;
  onFiltersChange: (filters: DashboardFilters) => void;
  loading?: boolean;
}

export const SearchAndFilter: React.FC<SearchAndFilterProps> = ({
  filters,
  onFiltersChange,
  loading = false,
}) => {
  const [searchQuery, setSearchQuery] = useState(filters.searchQuery || '');
  const [selectedStatuses, setSelectedStatuses] = useState<ContentStatus[]>(filters.status || []);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(filters.platform || []);
  const [dateRange, setDateRange] = useState({
    start: filters.dateRange?.start ? filters.dateRange.start.toISOString().split('T')[0] : '',
    end: filters.dateRange?.end ? filters.dateRange.end.toISOString().split('T')[0] : '',
  });
  const [isExpanded, setIsExpanded] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      handleFiltersUpdate();
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleFiltersUpdate = () => {
    const newFilters: DashboardFilters = {};

    if (searchQuery.trim()) {
      newFilters.searchQuery = searchQuery.trim();
    }

    if (selectedStatuses.length > 0) {
      newFilters.status = selectedStatuses;
    }

    if (selectedPlatforms.length > 0) {
      newFilters.platform = selectedPlatforms;
    }

    if (dateRange.start && dateRange.end) {
      newFilters.dateRange = {
        start: new Date(dateRange.start),
        end: new Date(dateRange.end),
      };
    }

    onFiltersChange(newFilters);
  };

  const handleStatusToggle = (status: ContentStatus) => {
    const newStatuses = selectedStatuses.includes(status)
      ? selectedStatuses.filter(s => s !== status)
      : [...selectedStatuses, status];
    
    setSelectedStatuses(newStatuses);
  };

  const handlePlatformToggle = (platform: string) => {
    const newPlatforms = selectedPlatforms.includes(platform)
      ? selectedPlatforms.filter(p => p !== platform)
      : [...selectedPlatforms, platform];
    
    setSelectedPlatforms(newPlatforms);
  };

  const handleDateRangeChange = (field: 'start' | 'end', value: string) => {
    setDateRange(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedStatuses([]);
    setSelectedPlatforms([]);
    setDateRange({ start: '', end: '' });
    onFiltersChange({});
  };

  const hasActiveFilters = searchQuery || selectedStatuses.length > 0 || selectedPlatforms.length > 0 || dateRange.start || dateRange.end;

  // Apply filters when non-search filters change
  useEffect(() => {
    handleFiltersUpdate();
  }, [selectedStatuses, selectedPlatforms, dateRange]);

  const statusOptions: ContentStatus[] = [
    'processing',
    'draft',
    'ready_for_review',
    'ready',
    'revision_requested',
    'approved',
    'publishing',
    'published',
    'failed',
    'completed',
  ];

  const platformOptions = ['Medium', 'LinkedIn', 'Dev.to', 'Hashnode'];

  return (
    <div className="search-filter">
      <div className="search-filter__main">
        <div className="search-filter__search">
          <input
            type="text"
            placeholder="Search posts by title or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-filter__search-input"
            disabled={loading}
          />
          <button
            className="search-filter__toggle"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label="Toggle filters"
          >
            Filters {hasActiveFilters && <span className="search-filter__active-indicator">•</span>}
          </button>
        </div>

        {hasActiveFilters && (
          <button
            className="search-filter__clear"
            onClick={clearFilters}
            disabled={loading}
          >
            Clear All
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="search-filter__expanded">
          <div className="search-filter__section">
            <h4 className="search-filter__section-title">Status</h4>
            <div className="search-filter__options">
              {statusOptions.map((status) => (
                <label key={status} className="search-filter__option">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(status)}
                    onChange={() => handleStatusToggle(status)}
                    disabled={loading}
                  />
                  <span className="search-filter__option-text">
                    {status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="search-filter__section">
            <h4 className="search-filter__section-title">Platform</h4>
            <div className="search-filter__options">
              {platformOptions.map((platform) => (
                <label key={platform} className="search-filter__option">
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.includes(platform)}
                    onChange={() => handlePlatformToggle(platform)}
                    disabled={loading}
                  />
                  <span className="search-filter__option-text">{platform}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="search-filter__section">
            <h4 className="search-filter__section-title">Date Range</h4>
            <div className="search-filter__date-range">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => handleDateRangeChange('start', e.target.value)}
                className="search-filter__date-input"
                disabled={loading}
                placeholder="Start date"
              />
              <span className="search-filter__date-separator">to</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => handleDateRangeChange('end', e.target.value)}
                className="search-filter__date-input"
                disabled={loading}
                placeholder="End date"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};