import type { PromptSummary } from "../types/prompt";

interface PromptListProps {
  readonly prompts: readonly PromptSummary[];
}

export function PromptList({ prompts }: PromptListProps): JSX.Element {
  return (
    <div className="prompt-table">
      <div className="prompt-table__row prompt-table__row--header">
        <span>Title</span>
        <span>Slug</span>
        <span>Tags</span>
        <span>Latest Version</span>
      </div>
      {prompts.map((prompt) => {
        const latestVersion = prompt.latestVersion;
        const updatedTooltip = latestVersion?.updatedAt
          ? new Date(latestVersion.updatedAt).toLocaleString()
          : "No version history";

        return (
          <div key={prompt.id} className="prompt-table__row">
            <span className="prompt-table__title">{prompt.title || "Untitled Prompt"}</span>
            <span className="prompt-table__slug">{prompt.slug}</span>
            <span className="prompt-table__tags">
              {prompt.tags.length > 0 ? prompt.tags.join(", ") : "No tags"}
            </span>
            <span className="prompt-table__version" title={updatedTooltip}>
              {latestVersion ? `v${latestVersion.semanticVersion}` : "--"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
