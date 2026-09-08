import React, { useEffect, useRef } from "react";
import type { PromptSummary } from "../types/prompt";
import { promptFeedbackId } from "../lib/feedbackAnchors";
import { PromptRowActions } from "./PromptRowActions";

interface PromptListProps {
  readonly prompts: readonly PromptSummary[];
  readonly activePromptId?: string | null;
  readonly copiedPromptId: string | null;
  readonly pendingFavoriteIds?: ReadonlySet<string>;
  readonly onActivate?: (promptId: string) => void;
  readonly onCopy: (prompt: PromptSummary) => void;
  readonly onEdit: (prompt: PromptSummary) => void;
  readonly onToggleFavorite?: (prompt: PromptSummary) => void;
  readonly copyError?: string | null;
  readonly favoriteError?: string | null;
  readonly selectedPromptIds?: ReadonlySet<string>;
  readonly onToggleSelected?: (promptId: string) => void;
}

const EMPTY_PROMPT_IDS: ReadonlySet<string> = new Set();

function promptLabel(prompt: PromptSummary): string {
  return prompt.title.trim() || "Untitled Prompt";
}

function formatPromptDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

export function PromptList({
  prompts,
  activePromptId = null,
  copiedPromptId,
  pendingFavoriteIds = EMPTY_PROMPT_IDS,
  onActivate,
  onCopy,
  onEdit,
  onToggleFavorite,
  copyError,
  favoriteError,
  selectedPromptIds,
  onToggleSelected,
}: PromptListProps): React.JSX.Element {
  const activeRowRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activePromptId]);

  return (
    <div className="library-panel">
      {copyError && <p className="error library-error">{copyError}</p>}
      {favoriteError && <p className="error library-error">{favoriteError}</p>}

      <ul className="prompt-list" aria-label="Visible prompts">
        {prompts.map((prompt) => {
          const label = promptLabel(prompt);
          const isCopied = copiedPromptId === prompt.id;
          const isActive = activePromptId === prompt.id;
          const isFavoritePending = pendingFavoriteIds.has(prompt.id);
          const visibleTags = prompt.tags.slice(0, 3);
          const hiddenTagCount = prompt.tags.length - visibleTags.length;
          const isSelectable = Boolean(selectedPromptIds && onToggleSelected);
          const isSelected = Boolean(selectedPromptIds?.has(prompt.id));
          const feedbackId = promptFeedbackId(prompt.id);

          return (
            <li
              key={prompt.id}
              ref={isActive ? activeRowRef : undefined}
              className={[
                "prompt-row",
                isActive ? "prompt-row--active" : "",
                prompt.isFavorite ? "prompt-row--favorite" : "",
                isCopied ? "prompt-row--copied" : "",
                isFavoritePending ? "prompt-row--pending" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-testid="prompt-row"
              data-prompt-id={prompt.id}
              data-feedback-id={feedbackId}
              data-feedback-private
              data-feedback-redact
              aria-current={isActive ? "true" : undefined}
              onPointerDown={() => onActivate?.(prompt.id)}
            >
              {isSelectable && (
                <label
                  className="prompt-row__select"
                  aria-label={`Select prompt ${label}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelected?.(prompt.id)}
                    data-feedback-id={promptFeedbackId(prompt.id, "select")}
                  />
                </label>
              )}

              <button
                type="button"
                className="prompt-row__copy"
                onClick={() => {
                  onActivate?.(prompt.id);
                  onCopy(prompt);
                }}
                aria-label={`Copy prompt ${label}`}
                data-feedback-id={promptFeedbackId(prompt.id, "copy")}
              >
                <span className="prompt-row__content">
                  <span className="prompt-row__title">{label}</span>

                  <span className="prompt-row__metadata">
                    {prompt.category && (
                      <span className="prompt-row__category">
                        {prompt.category}
                      </span>
                    )}
                    {prompt.rating != null && (
                      <span className="prompt-row__rating">
                        Rating {prompt.rating} of 5
                      </span>
                    )}
                    <span>Updated {formatPromptDate(prompt.updatedAt)}</span>
                    <span>Created {formatPromptDate(prompt.createdAt)}</span>
                  </span>

                  {visibleTags.length > 0 && (
                    <span className="prompt-row__tags" aria-label="Tags">
                      {visibleTags.map((tag) => (
                        <span key={tag} className="tag-bubble">
                          {tag}
                        </span>
                      ))}
                      {hiddenTagCount > 0 && (
                        <span className="tag-bubble tag-bubble--more">
                          +{hiddenTagCount} more
                        </span>
                      )}
                    </span>
                  )}

                  <span className="prompt-row__hint">
                    {isCopied ? (
                      <span className="prompt-row__feedback">Copied</span>
                    ) : (
                      "Copy prompt"
                    )}
                  </span>
                </span>
              </button>

              <PromptRowActions
                prompt={prompt}
                label={label}
                isFavoritePending={isFavoritePending}
                onActivate={onActivate}
                onEdit={onEdit}
                onToggleFavorite={onToggleFavorite}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
