import React from 'react';
import { DashboardStats as StatsType } from '../services/dashboardService';
import './DashboardStats.css';

interface DashboardStatsProps {
  stats: StatsType;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({ stats }) => {
  const getSuccessRate = (): number => {
    if (stats.totalPosts === 0) return 0;
    return Math.round((stats.publishedPosts / stats.totalPosts) * 100);
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat().format(num);
  };

  return (
    <div className="dashboard-stats">
      <div className="dashboard-stats__grid">
        <div className="dashboard-stats__card">
          <div className="dashboard-stats__value">{formatNumber(stats.totalPosts)}</div>
          <div className="dashboard-stats__label">Total Posts</div>
        </div>

        <div className="dashboard-stats__card dashboard-stats__card--success">
          <div className="dashboard-stats__value">{formatNumber(stats.publishedPosts)}</div>
          <div className="dashboard-stats__label">Published</div>
        </div>

        <div className="dashboard-stats__card dashboard-stats__card--warning">
          <div className="dashboard-stats__value">{formatNumber(stats.draftPosts)}</div>
          <div className="dashboard-stats__label">Drafts</div>
        </div>

        <div className="dashboard-stats__card dashboard-stats__card--error">
          <div className="dashboard-stats__value">{formatNumber(stats.failedPosts)}</div>
          <div className="dashboard-stats__label">Failed</div>
        </div>

        <div className="dashboard-stats__card dashboard-stats__card--info">
          <div className="dashboard-stats__value">{getSuccessRate()}%</div>
          <div className="dashboard-stats__label">Success Rate</div>
        </div>

        <div className="dashboard-stats__card">
          <div className="dashboard-stats__value">{formatNumber(stats.recentActivity)}</div>
          <div className="dashboard-stats__label">Recent Activity</div>
          <div className="dashboard-stats__sublabel">Last 7 days</div>
        </div>
      </div>
    </div>
  );
};