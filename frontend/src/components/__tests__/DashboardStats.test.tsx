import React from 'react';
import { render, screen } from '@testing-library/react';
import { DashboardStats } from '../DashboardStats';
import { DashboardStats as StatsType } from '../../services/dashboardService';

describe('DashboardStats', () => {
  const mockStats: StatsType = {
    totalPosts: 25,
    publishedPosts: 18,
    draftPosts: 5,
    failedPosts: 2,
    recentActivity: 8,
  };

  it('should render all stat cards', () => {
    render(<DashboardStats stats={mockStats} />);

    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('Total Posts')).toBeInTheDocument();

    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Drafts')).toBeInTheDocument();

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();

    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
  });

  it('should calculate and display success rate correctly', () => {
    render(<DashboardStats stats={mockStats} />);

    // Success rate should be (18/25) * 100 = 72%
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('Success Rate')).toBeInTheDocument();
  });

  it('should handle zero total posts', () => {
    const zeroStats: StatsType = {
      totalPosts: 0,
      publishedPosts: 0,
      draftPosts: 0,
      failedPosts: 0,
      recentActivity: 0,
    };

    render(<DashboardStats stats={zeroStats} />);

    expect(screen.getByText('0%')).toBeInTheDocument(); // Success rate should be 0%
    expect(screen.getAllByText('0')).toHaveLength(5); // All other stats should be 0
  });

  it('should handle 100% success rate', () => {
    const perfectStats: StatsType = {
      totalPosts: 10,
      publishedPosts: 10,
      draftPosts: 0,
      failedPosts: 0,
      recentActivity: 3,
    };

    render(<DashboardStats stats={perfectStats} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('should format large numbers correctly', () => {
    const largeStats: StatsType = {
      totalPosts: 1234,
      publishedPosts: 987,
      draftPosts: 123,
      failedPosts: 45,
      recentActivity: 67,
    };

    render(<DashboardStats stats={largeStats} />);

    // Check that numbers are formatted with commas (locale-dependent)
    expect(screen.getByText(/1,?234/)).toBeInTheDocument();
    expect(screen.getByText(/987/)).toBeInTheDocument();
  });

  it('should apply correct CSS classes for different card types', () => {
    const { container } = render(<DashboardStats stats={mockStats} />);

    const cards = container.querySelectorAll('.dashboard-stats__card');
    expect(cards).toHaveLength(6);

    // Check for specific variant classes
    expect(container.querySelector('.dashboard-stats__card--success')).toBeInTheDocument();
    expect(container.querySelector('.dashboard-stats__card--warning')).toBeInTheDocument();
    expect(container.querySelector('.dashboard-stats__card--error')).toBeInTheDocument();
    expect(container.querySelector('.dashboard-stats__card--info')).toBeInTheDocument();
  });

  it('should handle edge case with more published than total', () => {
    // This shouldn't happen in real data, but test defensive programming
    const edgeStats: StatsType = {
      totalPosts: 5,
      publishedPosts: 10, // More published than total (data inconsistency)
      draftPosts: 0,
      failedPosts: 0,
      recentActivity: 2,
    };

    render(<DashboardStats stats={edgeStats} />);

    // Success rate would be (10/5) * 100 = 200%
    expect(screen.getByText('200%')).toBeInTheDocument();
  });

  it('should handle decimal success rates correctly', () => {
    const decimalStats: StatsType = {
      totalPosts: 3,
      publishedPosts: 1,
      draftPosts: 1,
      failedPosts: 1,
      recentActivity: 1,
    };

    render(<DashboardStats stats={decimalStats} />);

    // Success rate should be (1/3) * 100 = 33.33... rounded to 33%
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('should render with proper accessibility structure', () => {
    render(<DashboardStats stats={mockStats} />);

    // Check that the component has proper structure for screen readers
    const statsContainer = screen.getByText('Total Posts').closest('.dashboard-stats');
    expect(statsContainer).toBeInTheDocument();

    // Each stat should have a value and label
    const totalPostsCard = screen.getByText('Total Posts').closest('.dashboard-stats__card');
    expect(totalPostsCard?.querySelector('.dashboard-stats__value')).toHaveTextContent('25');
    expect(totalPostsCard?.querySelector('.dashboard-stats__label')).toHaveTextContent('Total Posts');
  });

  it('should handle very large numbers', () => {
    const veryLargeStats: StatsType = {
      totalPosts: 999999,
      publishedPosts: 888888,
      draftPosts: 77777,
      failedPosts: 6666,
      recentActivity: 555,
    };

    render(<DashboardStats stats={veryLargeStats} />);

    // Should format large numbers appropriately
    expect(screen.getByText(/999,?999/)).toBeInTheDocument();
    expect(screen.getByText(/888,?888/)).toBeInTheDocument();
  });

  it('should maintain consistent layout with varying number lengths', () => {
    const { container } = render(<DashboardStats stats={mockStats} />);

    const cards = container.querySelectorAll('.dashboard-stats__card');
    
    // All cards should have the same basic structure
    cards.forEach(card => {
      expect(card.querySelector('.dashboard-stats__value')).toBeInTheDocument();
      expect(card.querySelector('.dashboard-stats__label')).toBeInTheDocument();
    });

    // Recent activity card should have sublabel
    const recentActivityCard = screen.getByText('Recent Activity').closest('.dashboard-stats__card');
    expect(recentActivityCard?.querySelector('.dashboard-stats__sublabel')).toHaveTextContent('Last 7 days');
  });
});