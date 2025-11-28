/**
 * Quick Add Prompt Widget
 *
 * A compact widget for quickly capturing a new prompt from the Hub.
 */

import React, { useState } from "react";

interface PromptQuickAddWidgetProps {
  onPromptCreated?: (promptId: string) => void;
}

export function PromptQuickAddWidget({
  onPromptCreated,
}: PromptQuickAddWidgetProps): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setIsSubmitting(true);
    try {
      // TODO: Integrate with PromptVault service
      // For now, just log and reset
      console.log("Creating prompt:", { title, content });

      // Simulate creation
      const promptId = crypto.randomUUID();
      onPromptCreated?.(promptId);

      setTitle("");
      setContent("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="pv-widget pv-quick-add">
      <div className="pv-widget-header">
        <h3>Quick Add Prompt</h3>
      </div>
      <form onSubmit={handleSubmit} className="pv-quick-add-form">
        <input
          type="text"
          placeholder="Prompt title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="pv-input"
          disabled={isSubmitting}
        />
        <textarea
          placeholder="Enter your prompt content..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="pv-textarea"
          rows={4}
          disabled={isSubmitting}
        />
        <button
          type="submit"
          disabled={isSubmitting || !title.trim() || !content.trim()}
          className="pv-button pv-button-primary"
        >
          {isSubmitting ? "Saving..." : "Save Prompt"}
        </button>
      </form>
    </div>
  );
}
