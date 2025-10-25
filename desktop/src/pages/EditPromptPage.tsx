import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { PromptSummary } from "../types/prompt";
import { addPromptVersion } from "../services/promptApi";
import { isTauriAvailable } from "../lib/tauri";

function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split(".");
  const majorNum = Number.parseInt(major ?? "0", 10);
  const minorNum = Number.parseInt(minor ?? "0", 10);
  const patchNum = Number.parseInt(patch ?? "0", 10);

  if (Number.isNaN(majorNum) || Number.isNaN(minorNum) || Number.isNaN(patchNum)) {
    return version || "1.0.1";
  }

  return `${majorNum}.${minorNum}.${patchNum + 1}`;
}

interface EditLocationState {
  prompt?: PromptSummary;
}

export function EditPromptPage(): JSX.Element {
  const navigate = useNavigate();
  const { state } = useLocation() as { state?: EditLocationState };
  const { id } = useParams();
  const prompt = state?.prompt;
  const runtimeAvailable = isTauriAvailable();

  const latestVersion = prompt?.latestVersion;
  const initialBody = latestVersion?.body ?? "";
  const defaultVersion = latestVersion ? bumpPatch(latestVersion.semanticVersion) : "1.0.1";

  const [body, setBody] = useState(initialBody);
  const [semanticVersion, setSemanticVersion] = useState(defaultVersion);
  const [changelog, setChangelog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const promptTitle = useMemo(() => prompt?.title ?? "Untitled Prompt", [prompt?.title]);

  if (!prompt || !prompt.id || prompt.id !== id) {
    return (
      <div className="status">
        Select a prompt from the library to edit. The editor needs the prompt context passed from the list.
      </div>
    );
  }

  const hasBody = body.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!runtimeAvailable) {
      setError("Desktop runtime unavailable. Launch Prompt Vault from the desktop app to save changes.");
      return;
    }

    if (!hasBody) {
      setError("Prompt body cannot be empty.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await addPromptVersion({
        promptId: prompt.id,
        body,
        semanticVersion: semanticVersion.trim(),
        changelog: changelog.trim() || undefined,
      });

      navigate("/", { replace: true, state: { refresh: true } });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save a new prompt version.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="prompt-form" onSubmit={handleSubmit}>
      <header>
        <h2>Edit Prompt</h2>
        <p>Updating this prompt creates a new version. Older versions remain in the history.</p>
      </header>

      <div className="metadata-preview">
        <div>
          <span className="metadata-label">Prompt</span>
          <span className="metadata-value">{promptTitle}</span>
        </div>
        {latestVersion && (
          <div>
            <span className="metadata-label">Current Version</span>
            <span className="metadata-value">v{latestVersion.semanticVersion}</span>
          </div>
        )}
      </div>

      <label>
        New Semantic Version
        <input
          value={semanticVersion}
          onChange={(event) => setSemanticVersion(event.target.value)}
          placeholder="e.g., 1.0.1"
          required
        />
      </label>

      <label>
        Prompt Body
        <textarea
          required
          rows={12}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Update the prompt instructions"
        />
      </label>

      <label>
        Changelog (optional)
        <textarea
          rows={3}
          value={changelog}
          onChange={(event) => setChangelog(event.target.value)}
          placeholder="Describe what changed in this version"
        />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button className="secondary" type="button" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button type="submit" disabled={isSaving || !runtimeAvailable}>
          {isSaving ? "Saving..." : "Save Version"}
        </button>
      </div>

      {!runtimeAvailable && (
        <p className="warning">
          Desktop runtime unavailable. Launch Prompt Vault from the desktop app to save prompt changes.
        </p>
      )}
    </form>
  );
}
