import React, { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { PromptSummary } from "../types/prompt";
import type { PromptVersionSummary } from "../types/prompt";
import { addPromptVersion, listPromptVersions, updatePrompt } from "../services/promptApi";
import { isTauriAvailable } from "../lib/tauri";
import { useI18n } from "../i18n";

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

export function EditPromptPage(): React.JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { state } = useLocation() as { state?: EditLocationState };
  const { id } = useParams();
  const prompt = state?.prompt;
  const runtimeAvailable = isTauriAvailable();

  // Early return if prompt is not available or doesn't match the ID
  if (!prompt || !prompt.id || prompt.id !== id) {
    return (
      <div className="status">
        {t("edit.missingContext")}
      </div>
    );
  }

  // At this point, prompt is guaranteed to be defined
  const safePrompt = prompt;
  const latestVersion = safePrompt.latestVersion;
  const initialBody = latestVersion?.body ?? "";
  const defaultVersion = latestVersion ? bumpPatch(latestVersion.semanticVersion) : "1.0.1";

  const [body, setBody] = useState(initialBody);
  const [semanticVersion, setSemanticVersion] = useState(defaultVersion);
  const [changelog, setChangelog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [title, setTitle] = useState(safePrompt.title ?? "");
  const [category, setCategory] = useState(safePrompt.category ?? "");
  const [isFavorite, setIsFavorite] = useState(Boolean(safePrompt.isFavorite));
  const [rating, setRating] = useState<string>(safePrompt.rating == null ? "" : String(safePrompt.rating));

  const promptId = safePrompt.id;

  const hasBody = body.trim().length > 0;

  useEffect(() => {
    let mounted = true;
    setIsLoadingVersions(true);
    void (async () => {
      try {
        const result = await listPromptVersions(promptId);
        if (mounted) setVersions(result);
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : t("edit.failed"));
        }
      } finally {
        if (mounted) setIsLoadingVersions(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [promptId, t]);

  async function handleRevert(version: PromptVersionSummary): Promise<void> {
    if (!runtimeAvailable) {
      setError(t("edit.runtimeUnavailable"));
      return;
    }

    const ok = window.confirm(`Revert to v${version.semanticVersion}? This will create a new version.`);
    if (!ok) return;

    setIsSaving(true);
    setError(null);

    try {
      const nextVersion = bumpPatch(latestVersion?.semanticVersion ?? version.semanticVersion);
      await addPromptVersion({
        promptId: safePrompt.id,
        body: version.body,
        semanticVersion: nextVersion,
        changelog: `Revert to v${version.semanticVersion}`,
      });
      navigate("/", { replace: true, state: { refresh: true } });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("edit.failed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!runtimeAvailable) {
      setError(t("edit.runtimeUnavailable"));
      return;
    }

    if (!hasBody) {
      setError(t("edit.bodyEmpty"));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const ratingNumber = rating.trim() === "" ? null : Number.parseInt(rating, 10);
      if (rating.trim() !== "" && (Number.isNaN(ratingNumber) || ratingNumber < 1 || ratingNumber > 5)) {
        setError(t("create.ratingInvalid"));
        setIsSaving(false);
        return;
      }

      const titleChanged = title.trim() !== (safePrompt?.title ?? "");
      const categoryChanged = category.trim() !== (safePrompt?.category ?? "");
      const favoriteChanged = isFavorite !== Boolean(safePrompt.isFavorite);
      const ratingChanged = (safePrompt.rating ?? null) !== (ratingNumber ?? null);

      // Update title and category if changed
      if (titleChanged || categoryChanged || favoriteChanged || ratingChanged) {
        await updatePrompt({
          id: safePrompt.id,
          title: title.trim() || undefined,
          category: category.trim() || undefined,
          isFavorite,
          rating: ratingNumber,
        });
      }

      await addPromptVersion({
        promptId: safePrompt.id,
        body,
        semanticVersion: semanticVersion.trim(),
        changelog: changelog.trim() || undefined,
      });

      navigate("/", { replace: true, state: { refresh: true } });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("edit.failed"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="prompt-form" onSubmit={handleSubmit}>
      <header>
        <h2>{t("edit.title")}</h2>
        <p>{t("edit.subtitle")}</p>
      </header>

      <label>
        {t("edit.label.title")}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("edit.title.placeholder")}
          required
        />
      </label>

      <label>
        {t("edit.label.category")}
        <input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder={t("create.category.placeholder")}
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={isFavorite}
          onChange={(event) => setIsFavorite(event.target.checked)}
        />
        {t("edit.label.favorite")}
      </label>

      <label>
        {t("edit.label.rating")}
        <input
          inputMode="numeric"
          value={rating}
          onChange={(event) => setRating(event.target.value)}
          placeholder={t("create.rating.placeholder")}
        />
      </label>

      <label>
        {t("edit.label.body")}
        <textarea
          required
          rows={12}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t("edit.body.placeholder")}
        />
      </label>

      <label>
        {t("edit.label.changelog")}
        <textarea
          rows={3}
          value={changelog}
          onChange={(event) => setChangelog(event.target.value)}
          placeholder={t("edit.changelog.placeholder")}
        />
      </label>

      <div className="metadata-preview">
        <div>
          <span className="metadata-label">{t("edit.meta.id")}</span>
          <span className="metadata-value">{promptId}</span>
        </div>
        {latestVersion && (
          <div>
            <span className="metadata-label">{t("edit.meta.currentVersion")}</span>
            <span className="metadata-value">v{latestVersion.semanticVersion}</span>
          </div>
        )}
      </div>

      <section className="metadata-preview" aria-label="Version history">
        <div>
          <span className="metadata-label">Version history</span>
          <span className="metadata-value">
            {isLoadingVersions ? "Loading…" : `${versions.length} version(s)`}
          </span>
        </div>
        {!isLoadingVersions && versions.length > 0 && (
          <div className="metadata-value version-history__content">
            <ul className="version-history__list">
              {versions.map((version) => (
                <li key={version.id} className="version-history__item">
                  <span>
                    v{version.semanticVersion} · {new Date(version.updatedAt).toLocaleString()}
                  </span>
                  <button type="button" className="secondary" onClick={() => void handleRevert(version)} disabled={isSaving}>
                    Revert
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <label>
        {t("edit.label.newVersion")}
        <input
          value={semanticVersion}
          onChange={(event) => setSemanticVersion(event.target.value)}
          placeholder={t("edit.newVersion.placeholder")}
          required
        />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button className="secondary" type="button" onClick={() => navigate(-1)}>
          {t("actions.cancel")}
        </button>
        <button type="submit" disabled={isSaving || !runtimeAvailable}>
          {isSaving ? t("actions.saving") : t("actions.save")}
        </button>
      </div>

      {!runtimeAvailable && (
        <p className="warning">
          {t("edit.warning.runtimeUnavailable")}
        </p>
      )}
    </form>
  );
}
