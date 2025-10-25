import type { PromptSummary } from "../types/prompt";

interface PromptListProps {
  readonly prompts: readonly PromptSummary[];
  readonly copiedPromptId: string | null;
  readonly onCopy: (prompt: PromptSummary) => void;
  readonly onEdit: (prompt: PromptSummary) => void;
  readonly copyError?: string | null;
}

export function PromptList({ prompts, copiedPromptId, onCopy, onEdit, copyError }: PromptListProps): JSX.Element {
  return (
    <div className="library-panel">
      <header className="library-header">
        <h2>Prompt Library</h2>
        <p>Tap a prompt to copy its latest version. Edit to create a new revision.</p>
      </header>

      {copyError && <p className="error library-error">{copyError}</p>}

      <div className="prompt-list">
        {prompts.map((prompt) => {
          const hasTags = prompt.tags.length > 0;
          const isCopied = copiedPromptId === prompt.id;
          const latestVersion = prompt.latestVersion;
          const tagsDisplay = hasTags ? prompt.tags.join(", ") : "No tags";

          return (
            <div key={prompt.id} className={`prompt-row${isCopied ? " prompt-row--copied" : ""}`}>
              <button
                type="button"
                className="prompt-row__copy"
                onClick={() => onCopy(prompt)}
                aria-label={`Copy prompt ${prompt.title}`}
              >
                <span className="prompt-row__title">{prompt.title || "Untitled Prompt"}</span>
                <span className="prompt-row__tags">{tagsDisplay}</span>
                {latestVersion && <span className="prompt-row__version">v{latestVersion.semanticVersion}</span>}
                <span className="prompt-row__hint">Tap to copy prompt body</span>
                {isCopied && <span className="prompt-row__feedback">Copied!</span>}
              </button>

              <button
                type="button"
                className="prompt-row__edit"
                onClick={() => onEdit(prompt)}
                aria-label={`Edit prompt ${prompt.title}`}
              >
                Edit
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
