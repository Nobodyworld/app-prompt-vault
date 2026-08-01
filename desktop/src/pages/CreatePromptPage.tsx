import React, { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { useToast } from "../components/Toast";
import { createPrompt } from "../services/promptApi";

interface FormState {
  title: string;
  body: string;
  tags: string;
  category: string;
  isFavorite: boolean;
  rating: string;
}

const STORAGE_KEY = "prompt-vault-create-form-v2";
const INITIAL_VERSION = "1.0.0";
const INITIAL_FORM: FormState = {
  title: "",
  body: "",
  tags: "",
  category: "",
  isFavorite: false,
  rating: "",
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createSlugSuffix(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  return generated ? generated.slice(0, 6) : Math.random().toString(36).slice(2, 8);
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

function parseSavedForm(serialized: string): FormState {
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  return {
    title: typeof parsed.title === "string" ? parsed.title : "",
    body: typeof parsed.body === "string" ? parsed.body : "",
    tags: typeof parsed.tags === "string" ? parsed.tags : "",
    category: typeof parsed.category === "string" ? parsed.category : "",
    isFavorite: parsed.isFavorite === true,
    rating: typeof parsed.rating === "string" ? parsed.rating : "",
  };
}

export function CreatePromptPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [slugSuffix, setSlugSuffix] = useState(createSlugSuffix);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setForm(parseSavedForm(saved));
    } catch (caught: unknown) {
      console.error("Failed to restore the prompt draft:", caught);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch (caught: unknown) {
      console.error("Failed to save the prompt draft:", caught);
    }
  }, [form]);

  const slugPreview = useMemo(() => {
    const base = slugify(form.title) || "prompt";
    return `${base}-${slugSuffix}`;
  }, [form.title, slugSuffix]);

  const resetForm = (): void => {
    setForm(INITIAL_FORM);
    setSlugSuffix(createSlugSuffix());
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!form.title.trim()) {
      setError("Give the prompt a clear title.");
      return;
    }

    if (!form.body.trim()) {
      setError("Add the prompt text you want to reuse.");
      return;
    }

    const rating = form.rating.trim()
      ? Number.parseInt(form.rating, 10)
      : null;
    if (rating !== null && (Number.isNaN(rating) || rating < 1 || rating > 5)) {
      setError("Rating must be between 1 and 5.");
      return;
    }

    setIsSubmitting(true);
    try {
      await createPrompt({
        slug: slugPreview,
        title: form.title.trim(),
        description: undefined,
        body: form.body,
        semanticVersion: INITIAL_VERSION,
        changelog: undefined,
        tags: parseTags(form.tags),
        category: form.category.trim() || undefined,
        isFavorite: form.isFavorite,
        rating,
      });

      addToast("Prompt saved.", "success");
      resetForm();
      navigate("/");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save the prompt.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="prompt-form prompt-form--focused" onSubmit={handleSubmit}>
      <header className="form-heading">
        <div>
          <h2>New prompt</h2>
          <p>Save the prompt now. Add optional organization only when useful.</p>
        </div>
      </header>

      <label>
        Title
        <input
          autoFocus
          required
          value={form.title}
          onChange={(event) =>
            setForm((current) => ({ ...current, title: event.target.value }))
          }
          placeholder="Example: Weekly project status update"
        />
      </label>

      <label>
        Prompt
        <textarea
          required
          rows={14}
          value={form.body}
          onChange={(event) =>
            setForm((current) => ({ ...current, body: event.target.value }))
          }
          placeholder="Write or paste the reusable prompt here…"
        />
      </label>

      <label>
        Tags <span className="field-optional">Optional</span>
        <input
          value={form.tags}
          onChange={(event) =>
            setForm((current) => ({ ...current, tags: event.target.value }))
          }
          placeholder="writing, reporting, client-work"
        />
        <small>Separate tags with commas.</small>
      </label>

      <details className="advanced-fields">
        <summary>More options</summary>
        <div className="advanced-fields__content">
          <label>
            Category
            <input
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              placeholder="Work, Personal, Research…"
            />
          </label>

          <label>
            Rating
            <input
              inputMode="numeric"
              value={form.rating}
              onChange={(event) =>
                setForm((current) => ({ ...current, rating: event.target.value }))
              }
              placeholder="1–5"
            />
          </label>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.isFavorite}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isFavorite: event.target.checked,
                }))
              }
            />
            Mark as favorite
          </label>

          <div className="metadata-preview metadata-preview--quiet">
            <div>
              <span className="metadata-label">Slug</span>
              <span className="metadata-value">{slugPreview}</span>
            </div>
            <div>
              <span className="metadata-label">Version</span>
              <span className="metadata-value">{INITIAL_VERSION}</span>
            </div>
          </div>
        </div>
      </details>

      {error && <p className="error">{error}</p>}
      <div className="form-actions form-actions--balanced">
        <button
          type="button"
          className="secondary-action"
          onClick={() => navigate("/")}
        >
          Cancel
        </button>
        <div className="form-actions__primary">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              if (window.confirm("Clear this draft?")) resetForm();
            }}
          >
            Clear draft
          </button>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save prompt"}
          </button>
        </div>
      </div>
    </form>
  );
}
