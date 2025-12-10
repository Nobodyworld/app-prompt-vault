/**
 * Quick Add Prompt Widget
 *
 * A compact widget for quickly capturing a new prompt from the Hub.
 */

import React, { useState } from "react";
import { createPrompt } from "../services/promptApi";
import type { CreatePromptInput } from "../types/prompt";

interface PromptQuickAddWidgetProps {
  onPromptCreated?: (promptId: string) => void;
}

export function PromptQuickAddWidget({
  onPromptCreated,
}: PromptQuickAddWidgetProps): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      // Generate slug from title
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .substring(0, 50);

      const input: CreatePromptInput = {
        slug,
        title: title.trim(),
        description: undefined,
        category: undefined,
        body: content.trim(),
        semanticVersion: "1.0.0",
        tags: [],
      };

      const prompt = await createPrompt(input);
      onPromptCreated?.(prompt.id);

      setTitle("");
      setContent("");
      setSuccess(true);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to create prompt:", err);
      setError("Failed to create prompt. Please try again.");
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
        {error && <div className="pv-error">{error}</div>}
        {success && <div className="pv-success">Prompt created successfully!</div>}
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
