/**
 * Prompt Stats Widget
 *
 * Displays overview statistics for the prompt vault.
 */

import React, { useState, useEffect } from "react";

interface Stats {
  totalPrompts: number;
  totalTags: number;
  promptsThisWeek: number;
}

export function PromptStatsWidget(): React.JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Integrate with PromptVault service
    const fetchStats = async (): Promise<void> => {
      setIsLoading(true);
      try {
        // Simulated data
        setStats({
          totalPrompts: 42,
          totalTags: 12,
          promptsThisWeek: 7,
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, []);

  return (
    <div className="pv-widget pv-stats">
      <div className="pv-widget-header">
        <h3>Prompt Stats</h3>
      </div>
      <div className="pv-widget-content">
        {isLoading ? (
          <div className="pv-loading">Loading...</div>
        ) : stats ? (
          <div className="pv-stats-grid">
            <div className="pv-stat">
              <span className="pv-stat-value">{stats.totalPrompts}</span>
              <span className="pv-stat-label">Total Prompts</span>
            </div>
            <div className="pv-stat">
              <span className="pv-stat-value">{stats.totalTags}</span>
              <span className="pv-stat-label">Tags</span>
            </div>
            <div className="pv-stat">
              <span className="pv-stat-value">{stats.promptsThisWeek}</span>
              <span className="pv-stat-label">This Week</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
