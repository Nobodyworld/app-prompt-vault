import React from "react";
import type { PromptSummary } from "../types/prompt";

interface PromptListProps {
  readonly prompts: readonly PromptSummary[];
  readonly copiedPromptId: string | null;
  readonly onCopy: (prompt: PromptSummary) => void;
  readonly onEdit: (prompt: PromptSummary) => void;
  readonly copyError?: string | null;
}

export function PromptList({ prompts, copiedPromptId, onCopy, onEdit, copyError }: PromptListProps): React.JSX.Element {
  return (
    <div className="library-panel">
      {copyError && <p className="error library-error">{copyError}</p>}

      <div className="prompt-list">
        {prompts.map((prompt) => {
          const hasTags = prompt.tags.length > 0;
          const isCopied = copiedPromptId === prompt.id;
          const tagsDisplay = hasTags ? prompt.tags : [];

          return (
            <div key={prompt.id} className={`prompt-row${isCopied ? " prompt-row--copied" : ""}`}>
              <div
                className="prompt-row__copy"
                onClick={() => onCopy(prompt)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onCopy(prompt);
                  }
                }}
                aria-label={`Copy prompt ${prompt.title}`}
              >
                <div className="prompt-row__content">
                  <span className="prompt-row__title">{prompt.title || "Untitled Prompt"}</span>
                  {hasTags && (
                    <div className="prompt-row__tags">
                      {tagsDisplay.map((tag) => (
                        <span key={tag} className="tag-bubble">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="prompt-row__hint">Tap to copy</span>
                  {isCopied && <span className="prompt-row__feedback">Copied!</span>}
                </div>
              </div>
              <button
                type="button"
                className="prompt-row__edit"
                onClick={() => onEdit(prompt)}
                aria-label={`Edit prompt ${prompt.title}`}
              >
                ✏️
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
