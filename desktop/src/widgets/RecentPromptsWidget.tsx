/**
 * Recent Prompts Widget
 *
 * Displays a list of recently created or modified prompts.
 */

import React, { useState, useEffect } from "react";
import { listPrompts } from "../services/promptApi";
import type { PromptSummary } from "../types/prompt";

interface RecentPromptsWidgetProps {
  onPromptSelected?: (promptId: string) => void;
  limit?: number;
}

export function RecentPromptsWidget({
  onPromptSelected,
  limit = 5,
}: RecentPromptsWidgetProps): React.JSX.Element {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPrompts = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await listPrompts();
        // Sort by updatedAt descending and take the limit
        const sorted = [...result].sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        setPrompts(sorted.slice(0, limit));
      } catch (err) {
        console.error("Failed to load recent prompts:", err);
        setError("Failed to load prompts");
      } finally {
        setIsLoading(false);
      }
    };
    fetchPrompts();
  }, [limit]);

  const formatTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  return (
    <div className="pv-widget pv-recent-prompts">
      <div className="pv-widget-header">
        <h3>Recent Prompts</h3>
      </div>
      <div className="pv-widget-content">
        {isLoading ? (
          <div className="pv-loading">Loading...</div>
        ) : error ? (
          <div className="pv-error">{error}</div>
        ) : prompts.length === 0 ? (
          <div className="pv-empty">No prompts yet</div>
        ) : (
          <ul className="pv-prompt-list">
            {prompts.map((prompt) => (
              <li
                key={prompt.id}
                className="pv-prompt-item"
                onClick={() => onPromptSelected?.(prompt.id)}
              >
                <span className="pv-prompt-title">{prompt.title}</span>
                <span className="pv-prompt-time">
                  {formatTime(prompt.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
