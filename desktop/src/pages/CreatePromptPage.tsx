import React, { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createPrompt } from "../services/promptApi";
import { isTauriAvailable } from "../lib/tauri";
import { useToast } from "../components/Toast";
import { useI18n } from "../i18n";

interface FormState {
  title: string;
  body: string;
  category: string;
  isFavorite: boolean;
  rating: string;
  customTags: string;
}

const INITIAL_FORM: FormState = {
  title: "",
  body: "",
  category: "",
  isFavorite: false,
  rating: "",
  customTags: "",
};

const TAG_PRESETS = ["Brainstorming", "Email Draft", "Product Strategy", "Support Reply", "Code Review", "Workflow"];
const INITIAL_VERSION = "1.0.0";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function parseCustomTags(input: string): string[] {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

const STORAGE_KEY = "prompt-vault-create-form";

interface PersistedState {
  form: FormState;
  selectedTags: string[];
  slugSuffix: string;
}

export function CreatePromptPage(): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [slugSuffix, setSlugSuffix] = useState<string>(createSlugSuffix);
  const [runtimeAvailable, setRuntimeAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { addToast } = useToast();

  // Load persisted form data on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: PersistedState = JSON.parse(saved);
        setForm(parsed.form);
        setSelectedTags(parsed.selectedTags);
        setSlugSuffix(parsed.slugSuffix);
      }
    } catch (error) {
      console.error("Failed to load saved form data:", error);
    }
  }, []);

  // Save form data whenever it changes
  useEffect(() => {
    const stateToSave: PersistedState = {
      form,
      selectedTags,
      slugSuffix,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error("Failed to save form data:", error);
    }
  }, [form, selectedTags, slugSuffix]);

  useEffect(() => {
    setRuntimeAvailable(isTauriAvailable());
  }, []);

  // Listen for custom event to submit form from header
  useEffect(() => {
    const handleSubmitEvent = (): void => {
      const formElement = document.querySelector('.prompt-form') as HTMLFormElement;
      if (formElement) {
        formElement.requestSubmit();
      }
    };

    window.addEventListener('submit-create-form', handleSubmitEvent);
    return () => window.removeEventListener('submit-create-form', handleSubmitEvent);
  }, []);

  const slugPreview = useMemo(() => {
    const base = slugify(form.title);
    return base ? `${base}-${slugSuffix}` : `prompt-${slugSuffix}`;
  }, [form.title, slugSuffix]);

  const tagPreview = useMemo(() => {
    const custom = parseCustomTags(form.customTags);
    const combined = Array.from(new Set([...selectedTags, ...custom]));
    return combined.join(", ");
  }, [selectedTags, form.customTags]);

  function toggleTag(tag: string): void {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  function resetForm(): void {
    setForm(INITIAL_FORM);
    setSelectedTags([]);
    setSlugSuffix(createSlugSuffix());
    // Clear persisted data
    localStorage.removeItem(STORAGE_KEY);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    if (!runtimeAvailable) {
      setError(t("create.runtimeUnavailable"));
      setIsSubmitting(false);
      return;
    }

    if (form.body.trim().length === 0) {
      setError(t("create.bodyRequired"));
      setIsSubmitting(false);
      return;
    }

    try {
      const title = form.title.trim() || t("create.untitled");
      const customTags = parseCustomTags(form.customTags);
      const tags = Array.from(new Set([...selectedTags, ...customTags]));

      const ratingNumber = form.rating.trim() === "" ? null : Number.parseInt(form.rating, 10);
      if (form.rating.trim() !== "" && (Number.isNaN(ratingNumber) || ratingNumber < 1 || ratingNumber > 5)) {
        setError(t("create.ratingInvalid"));
        return;
      }

      await createPrompt({
        slug: slugPreview,
        title,
        description: undefined,
        category: form.category.trim() || undefined,
        isFavorite: form.isFavorite,
        rating: ratingNumber,
        body: form.body,
        semanticVersion: INITIAL_VERSION,
        changelog: undefined,
        tags,
      });

      addToast(t("create.success"), "success");
      resetForm();
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("create.failed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="prompt-form" onSubmit={handleSubmit}>
      <header>
        <h2>{t("create.title")}</h2>
      </header>

      <label>
        {t("create.promptMessage")}
        <textarea
          required
          rows={10}
          value={form.body}
          onChange={(event) => setForm((state) => ({ ...state, body: event.target.value }))}
          placeholder={t("create.promptMessage.placeholder")}
        />
      </label>

      <label>
        {t("create.category")}
        <input
          value={form.category}
          onChange={(event) => setForm((state) => ({ ...state, category: event.target.value }))}
          placeholder={t("create.category.placeholder")}
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={form.isFavorite}
          onChange={(event) => setForm((state) => ({ ...state, isFavorite: event.target.checked }))}
        />
        {t("create.favorite")}
      </label>

      <label>
        {t("create.rating")}
        <input
          inputMode="numeric"
          value={form.rating}
          onChange={(event) => setForm((state) => ({ ...state, rating: event.target.value }))}
          placeholder={t("create.rating.placeholder")}
        />
      </label>

      <section className="tag-selector">
        <span className="tag-selector__label">{t("create.quickTags")}</span>
        <div className="tag-grid">
          {TAG_PRESETS.map((tag) => {
            const isActive = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`tag-button${isActive ? " tag-button--active" : ""}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </section>

      <label>
        {t("create.customTags")}
        <input
          value={form.customTags}
          onChange={(event) => setForm((state) => ({ ...state, customTags: event.target.value }))}
          placeholder={t("create.customTags.placeholder")}
        />
      </label>

      <div className="metadata-preview">
        <div>
          <span className="metadata-label">{t("create.meta.slug")}</span>
          <span className="metadata-value">{slugPreview}</span>
        </div>
        <div>
          <span className="metadata-label">{t("create.meta.version")}</span>
          <span className="metadata-value">{INITIAL_VERSION}</span>
        </div>
        {tagPreview && (
          <div>
            <span className="metadata-label">{t("create.meta.tags")}</span>
            <span className="metadata-value">{tagPreview}</span>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button className="secondary" type="button" onClick={() => navigate("/")}>
          {t("actions.cancel")}
        </button>
        <button
          className="danger"
          type="button"
          onClick={() => {
            if (confirm(t("actions.clearConfirm"))) {
              resetForm();
            }
          }}
        >
          {t("actions.clear")}
        </button>
        <button type="submit" disabled={isSubmitting || !runtimeAvailable}>
          {isSubmitting ? t("actions.creating") : t("actions.create")}
        </button>
      </div>

      {!runtimeAvailable && (
        <p className="warning">
          {t("create.warning.runtimeUnavailable")}
        </p>
      )}
    </form>
  );
}
