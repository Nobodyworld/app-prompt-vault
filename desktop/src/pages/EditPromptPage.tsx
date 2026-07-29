import React, { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import type {
  PromptSummary,
  PromptVersionSummary,
} from "../types/prompt";
import {
  addPromptVersion,
  getPromptById,
  listPromptVersions,
  updatePrompt,
} from "../services/promptApi";

const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split(".");
  const majorNum = Number.parseInt(major ?? "0", 10);
  const minorNum = Number.parseInt(minor ?? "0", 10);
  const patchNum = Number.parseInt(patch ?? "0", 10);

  if ([majorNum, minorNum, patchNum].some(Number.isNaN)) return "1.0.1";
  return `${majorNum}.${minorNum}.${patchNum + 1}`;
}

function parseTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left)].toSorted();
  const normalizedRight = [...new Set(right)].toSorted();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((tag, index) => tag === normalizedRight[index])
  );
}

interface EditLocationState {
  prompt?: PromptSummary;
}

export function EditPromptPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { state } = useLocation() as { state?: EditLocationState };
  const { id = "" } = useParams();
  const routedPrompt =
    state?.prompt?.id === id ? state.prompt : undefined;

  const [prompt, setPrompt] = useState<PromptSummary | undefined>(routedPrompt);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(!routedPrompt);
  const [notFound, setNotFound] = useState(false);
  const [title, setTitle] = useState(routedPrompt?.title ?? "");
  const [body, setBody] = useState(routedPrompt?.latestVersion?.body ?? "");
  const [tags, setTags] = useState(routedPrompt?.tags.join(", ") ?? "");
  const [category, setCategory] = useState(routedPrompt?.category ?? "");
  const [isFavorite, setIsFavorite] = useState(
    Boolean(routedPrompt?.isFavorite),
  );
  const [rating, setRating] = useState(
    routedPrompt?.rating == null ? "" : String(routedPrompt.rating),
  );
  const [semanticVersion, setSemanticVersion] = useState(
    routedPrompt?.latestVersion
      ? bumpPatch(routedPrompt.latestVersion.semanticVersion)
      : "1.0.1",
  );
  const [changelog, setChangelog] = useState("");
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (routedPrompt || !id) {
      setIsLoadingPrompt(false);
      setNotFound(!routedPrompt);
      return;
    }

    let active = true;
    setIsLoadingPrompt(true);
    void getPromptById(id)
      .then((loadedPrompt) => {
        if (!active) return;
        setPrompt(loadedPrompt);
        setNotFound(!loadedPrompt);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof Error ? caught.message : "Unable to load the prompt.",
        );
        setNotFound(true);
      })
      .finally(() => {
        if (active) setIsLoadingPrompt(false);
      });

    return () => {
      active = false;
    };
  }, [id, routedPrompt]);

  useEffect(() => {
    if (!prompt) return;
    setTitle(prompt.title);
    setBody(prompt.latestVersion?.body ?? "");
    setTags(prompt.tags.join(", "));
    setCategory(prompt.category ?? "");
    setIsFavorite(Boolean(prompt.isFavorite));
    setRating(prompt.rating == null ? "" : String(prompt.rating));
    setSemanticVersion(
      prompt.latestVersion ? bumpPatch(prompt.latestVersion.semanticVersion) : "1.0.1",
    );
  }, [prompt]);

  useEffect(() => {
    if (!prompt?.id) return;
    let active = true;
    setIsLoadingVersions(true);
    void listPromptVersions(prompt.id)
      .then((result) => {
        if (active) setVersions(result);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load version history.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoadingVersions(false);
      });
    return () => {
      active = false;
    };
  }, [prompt?.id]);

  const parsedTags = useMemo(() => parseTags(tags), [tags]);

  async function handleRevert(version: PromptVersionSummary): Promise<void> {
    if (!prompt) return;
    if (!window.confirm(`Revert to v${version.semanticVersion}? This will create a new version.`)) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await addPromptVersion({
        promptId: prompt.id,
        body: version.body,
        semanticVersion: bumpPatch(
          prompt.latestVersion?.semanticVersion ?? version.semanticVersion,
        ),
        changelog: `Revert to v${version.semanticVersion}`,
      });
      navigate("/", { replace: true, state: { refresh: true } });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to revert.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!prompt) return;
    setError(null);
    setMessage(null);

    if (!title.trim()) {
      setError("Give the prompt a clear title.");
      return;
    }
    if (!body.trim()) {
      setError("Prompt text cannot be empty.");
      return;
    }

    const ratingNumber = rating.trim() ? Number.parseInt(rating, 10) : null;
    if (
      ratingNumber !== null &&
      (Number.isNaN(ratingNumber) || ratingNumber < 1 || ratingNumber > 5)
    ) {
      setError("Rating must be a whole number from 1 to 5 (or empty).");
      return;
    }

    const normalizedCategory = category.trim();
    const originalCategory = prompt.category?.trim() ?? "";
    const titleChanged = title.trim() !== prompt.title.trim();
    const categoryChanged = normalizedCategory !== originalCategory;
    const favoriteChanged = isFavorite !== Boolean(prompt.isFavorite);
    const ratingChanged = ratingNumber !== (prompt.rating ?? null);
    const tagsChanged = !sameTags(parsedTags, prompt.tags);
    const bodyChanged = body !== (prompt.latestVersion?.body ?? "");
    const versionOptionsChanged =
      semanticVersion.trim() !==
        (prompt.latestVersion
          ? bumpPatch(prompt.latestVersion.semanticVersion)
          : "1.0.1") || Boolean(changelog.trim());
    const metadataChanged =
      titleChanged ||
      categoryChanged ||
      favoriteChanged ||
      ratingChanged ||
      tagsChanged;

    if (!metadataChanged && !bodyChanged) {
      setMessage(
        versionOptionsChanged
          ? "Change the prompt text before adding a version or changelog."
          : "No changes to save.",
      );
      return;
    }
    if (bodyChanged && !SEMANTIC_VERSION_PATTERN.test(semanticVersion.trim())) {
      setError("Semantic version must follow MAJOR.MINOR.PATCH.");
      return;
    }

    setIsSaving(true);
    try {
      if (metadataChanged) {
        await updatePrompt({
          id: prompt.id,
          ...(titleChanged ? { title: title.trim() } : {}),
          ...(categoryChanged
            ? { category: normalizedCategory || null }
            : {}),
          ...(favoriteChanged ? { isFavorite } : {}),
          ...(ratingChanged ? { rating: ratingNumber } : {}),
          ...(tagsChanged ? { tags: parsedTags } : {}),
        });
      }
      if (bodyChanged) {
        await addPromptVersion({
          promptId: prompt.id,
          body,
          semanticVersion: semanticVersion.trim(),
          changelog: changelog.trim() || undefined,
        });
      }
      navigate("/", { replace: true, state: { refresh: true } });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Unable to save changes.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoadingPrompt) {
    return <div className="status">Loading prompt…</div>;
  }

  if (notFound || !prompt) {
    return (
      <section className="status" aria-labelledby="prompt-not-found-title">
        <h2 id="prompt-not-found-title">Prompt not found</h2>
        <p>This prompt may have been deleted or is no longer available.</p>
        <Link to="/">Return to Library</Link>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <form className="prompt-form prompt-form--focused" onSubmit={handleSubmit}>
      <header className="form-heading">
        <div>
          <h2>Edit prompt</h2>
          <p>Metadata saves in place. Changing prompt text creates one new version.</p>
        </div>
      </header>

      <label>
        Title
        <input
          autoFocus
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <label>
        Prompt
        <textarea
          required
          rows={14}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>

      <label>
        Tags <span className="field-optional">Optional</span>
        <input
          aria-label="Tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="writing, reporting, client-work"
        />
        <small>Separate tags with commas. Repeated tags are removed.</small>
      </label>

      <details className="advanced-fields">
        <summary>Version and organization</summary>
        <div className="advanced-fields__content">
          <label>
            Category
            <input
              aria-label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Work, Personal, Research…"
            />
          </label>

          <label>
            Rating
            <input
              inputMode="numeric"
              value={rating}
              onChange={(event) => setRating(event.target.value)}
              placeholder="1–5"
            />
          </label>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={isFavorite}
              onChange={(event) => setIsFavorite(event.target.checked)}
            />
            Mark as favorite
          </label>

          <label>
            Next semantic version
            <input
              value={semanticVersion}
              onChange={(event) => setSemanticVersion(event.target.value)}
              placeholder="1.0.1"
            />
            <small>Used only when the prompt text changes.</small>
          </label>

          <label>
            Changelog <span className="field-optional">Optional</span>
            <textarea
              rows={3}
              value={changelog}
              onChange={(event) => setChangelog(event.target.value)}
            />
          </label>

          <div className="metadata-preview metadata-preview--quiet">
            <div>
              <span className="metadata-label">ID</span>
              <span className="metadata-value">{prompt.id}</span>
            </div>
            {prompt.latestVersion && (
              <div>
                <span className="metadata-label">Current version</span>
                <span className="metadata-value">
                  {prompt.latestVersion.semanticVersion}
                </span>
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
              <ul className="version-history__list">
                {versions.map((version) => (
                  <li key={version.id} className="version-history__item">
                    <span>
                      v{version.semanticVersion} ·{" "}
                      {new Date(version.updatedAt).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void handleRevert(version)}
                      disabled={isSaving}
                    >
                      Revert
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </details>

      {message && <p className="status">{message}</p>}
      {error && <p className="error">{error}</p>}

      <div className="form-actions form-actions--balanced">
        <button className="secondary" type="button" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save changes"}
        </button>
      </div>

    </form>
  );
}
