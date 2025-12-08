/**
 * Prompt Stats Widget
 *
 * Displays overview statistics for the prompt vault.
 */

import React, { useState, useEffect } from "react";
import { listPrompts } from "../services/promptApi";

interface Stats {
  totalPrompts: number;
  totalTags: number;
  promptsThisWeek: number;
}

export function PromptStatsWidget(): React.JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const prompts = await listPrompts();

        // Calculate stats
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const promptsThisWeek = prompts.filter(p =>
          new Date(p.updatedAt) >= weekAgo
        ).length;

        // Collect unique tags
        const uniqueTags = new Set<string>();
        for (const prompt of prompts) {
          for (const tag of prompt.tags || []) {
            uniqueTags.add(tag);
          }
        }

        setStats({
          totalPrompts: prompts.length,
          totalTags: uniqueTags.size,
          promptsThisWeek,
        });
      } catch (err) {
        console.error("Failed to load prompt stats:", err);
        setError("Failed to load stats");
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
        ) : error ? (
          <div className="pv-error">{error}</div>
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
