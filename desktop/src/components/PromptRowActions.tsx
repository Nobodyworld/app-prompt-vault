import React, { memo } from "react";
import { promptFeedbackId } from "../lib/feedbackAnchors";
import type { PromptSummary } from "../types/prompt";

interface PromptRowActionsProps {
  readonly prompt: PromptSummary;
  readonly label: string;
  readonly isFavoritePending: boolean;
  readonly onActivate?: (promptId: string) => void;
  readonly onEdit: (prompt: PromptSummary) => void;
  readonly onToggleFavorite?: (prompt: PromptSummary) => void;
}

function PromptRowActionsComponent({
  prompt,
  label,
  isFavoritePending,
  onActivate,
  onEdit,
  onToggleFavorite,
}: PromptRowActionsProps): React.JSX.Element {
  const activate = (): void => onActivate?.(prompt.id);

  return (
    <div className="prompt-row__actions" aria-label={`Actions for ${label}`}>
      {onToggleFavorite && (
        <button
          type="button"
          className="prompt-row__favorite"
          aria-label={
            prompt.isFavorite
              ? `Remove ${label} from favorites`
              : `Add ${label} to favorites`
          }
          aria-pressed={prompt.isFavorite}
          disabled={isFavoritePending}
          data-feedback-id={promptFeedbackId(prompt.id, "favorite")}
          onClick={() => {
            activate();
            onToggleFavorite(prompt);
          }}
        >
          <span aria-hidden="true">{prompt.isFavorite ? "★" : "☆"}</span>
          <span>
            {isFavoritePending
              ? "Saving…"
              : prompt.isFavorite
                ? "Favorite"
                : "Add favorite"}
          </span>
        </button>
      )}
      <button
        type="button"
        className="prompt-row__edit"
        onClick={() => {
          activate();
          onEdit(prompt);
        }}
        aria-label={`Edit prompt ${label}`}
        data-feedback-id={promptFeedbackId(prompt.id, "edit")}
      >
        Edit
      </button>
    </div>
  );
}

export const PromptRowActions = memo(PromptRowActionsComponent);
