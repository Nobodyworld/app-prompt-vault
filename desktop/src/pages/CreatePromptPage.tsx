import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPrompt } from "../services/promptApi";
import { isTauriAvailable } from "../lib/tauri";

interface FormState {
  title: string;
  body: string;
  customTags: string;
}

const INITIAL_FORM: FormState = {
  title: "",
  body: "",
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

export function CreatePromptPage(): JSX.Element {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [slugSuffix, setSlugSuffix] = useState<string>(createSlugSuffix);
  const [runtimeAvailable, setRuntimeAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setRuntimeAvailable(isTauriAvailable());
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
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    if (!runtimeAvailable) {
      setError("Desktop runtime unavailable. Launch Prompt Vault from the desktop app to save prompts.");
      setIsSubmitting(false);
      return;
    }

    if (form.body.trim().length === 0) {
      setError("Prompt body is required.");
      setIsSubmitting(false);
      return;
    }

    try {
      const title = form.title.trim() || "Untitled Prompt";
      const customTags = parseCustomTags(form.customTags);
      const tags = Array.from(new Set([...selectedTags, ...customTags]));

      await createPrompt({
        slug: slugPreview,
        title,
        description: undefined,
        body: form.body,
        semanticVersion: INITIAL_VERSION,
        changelog: undefined,
        tags,
      });

      resetForm();
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create prompt");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="prompt-form" onSubmit={handleSubmit}>
      <header>
        <h2>Create Prompt</h2>
        <p>Provide the prompt message and (optionally) a title. Slug and version are generated automatically.</p>
      </header>

      <div className="metadata-preview">
        <div>
          <span className="metadata-label">Slug</span>
          <span className="metadata-value">{slugPreview}</span>
        </div>
        <div>
          <span className="metadata-label">Version</span>
          <span className="metadata-value">{INITIAL_VERSION}</span>
        </div>
        {tagPreview && (
          <div>
            <span className="metadata-label">Tags</span>
            <span className="metadata-value">{tagPreview}</span>
          </div>
        )}
      </div>

      <label>
        Title (optional)
        <input
          value={form.title}
          onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))}
          placeholder="Give your prompt a friendly name"
        />
      </label>

      <label>
        Prompt Message
        <textarea
          required
          rows={10}
          value={form.body}
          onChange={(event) => setForm((state) => ({ ...state, body: event.target.value }))}
          placeholder="Paste or write your reusable prompt here"
        />
      </label>

      <section className="tag-selector">
        <span className="tag-selector__label">Quick Tags</span>
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
        Custom Tags (optional)
        <input
          value={form.customTags}
          onChange={(event) => setForm((state) => ({ ...state, customTags: event.target.value }))}
          placeholder="Add comma separated labels"
        />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button className="secondary" type="button" onClick={() => navigate("/")}>
          Cancel
        </button>
        <button type="submit" disabled={isSubmitting || !runtimeAvailable}>
          {isSubmitting ? "Creating..." : "Create Prompt"}
        </button>
      </div>

      {!runtimeAvailable && (
        <p className="warning">
          Desktop runtime unavailable. Launch Prompt Vault from the desktop app to save prompts locally.
        </p>
      )}
    </form>
  );
}
