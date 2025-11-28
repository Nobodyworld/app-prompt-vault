/**
 * Recent Prompts Widget
 *
 * Displays a list of recently created or modified prompts.
 */

import React, { useState, useEffect } from "react";

interface Prompt {
  id: string;
  title: string;
  updatedAt: Date;
}

interface RecentPromptsWidgetProps {
  onPromptSelected?: (promptId: string) => void;
  limit?: number;
}

export function RecentPromptsWidget({
  onPromptSelected,
  limit = 5,
}: RecentPromptsWidgetProps): React.JSX.Element {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Integrate with PromptVault service
    // For now, show placeholder data
    const fetchPrompts = async () => {
      setIsLoading(true);
      try {
        // Simulated data
        const mockPrompts: Prompt[] = [
          { id: "1", title: "Code Review Checklist", updatedAt: new Date() },
          { id: "2", title: "Meeting Summary Template", updatedAt: new Date(Date.now() - 3600000) },
          { id: "3", title: "Bug Report Format", updatedAt: new Date(Date.now() - 7200000) },
        ];
        setPrompts(mockPrompts.slice(0, limit));
      } finally {
        setIsLoading(false);
      }
    };
    fetchPrompts();
  }, [limit]);

  const formatTime = (date: Date): string => {
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
                <span className="pv-prompt-time">{formatTime(prompt.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
