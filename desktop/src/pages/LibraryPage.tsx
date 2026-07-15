import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { PromptList } from "../components/PromptList";
import { useToast } from "../components/Toast";
import { copyTextToClipboard } from "../lib/clipboard";
import { listPrompts } from "../services/promptApi";
import type { PromptSummary } from "../types/prompt";

export function LibraryPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const loadPrompts = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      setPrompts(await listPrompts());
      setError(null);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "Unable to load your prompts.";
      setError(message);
      addToast(message, "error");
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  useEffect(() => {
    const focusSearch = (): void => searchInputRef.current?.focus();
    const clearSearch = (): void => {
      setQuery("");
      searchInputRef.current?.blur();
    };

    window.addEventListener("focus-search", focusSearch);
    window.addEventListener("clear-search", clearSearch);

    return () => {
      window.removeEventListener("focus-search", focusSearch);
      window.removeEventListener("clear-search", clearSearch);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  const availableTags = useMemo(
    () =>
      Array.from(new Set(prompts.flatMap((prompt) => prompt.tags)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [prompts],
  );

  const availableCategories = useMemo(
    () =>
      Array.from(
        new Set(
          prompts
            .map((prompt) => prompt.category?.trim())
            .filter((category): category is string => Boolean(category)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [prompts],
  );

  const filteredPrompts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedTag = tagFilter.trim().toLowerCase();
    const normalizedCategory = categoryFilter.trim().toLowerCase();

    return prompts.filter((prompt) => {
      if (
        normalizedTag &&
        !prompt.tags.some((tag) => tag.toLowerCase() === normalizedTag)
      ) {
        return false;
      }

      if (
        normalizedCategory &&
        (prompt.category ?? "").toLowerCase() !== normalizedCategory
      ) {
        return false;
      }

      if (!normalizedQuery) return true;

      return [
        prompt.title,
        prompt.description,
        prompt.category,
        prompt.latestVersion?.body,
        ...prompt.tags,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [categoryFilter, prompts, query, tagFilter]);

  const handleCopy = useCallback(
    async (prompt: PromptSummary): Promise<void> => {
      const body = prompt.latestVersion?.body;
      if (!body) {
        addToast("This prompt has no copyable content.", "warning");
        return;
      }

      try {
        await copyTextToClipboard(body);
        setCopyError(null);
        setCopiedPromptId(prompt.id);
        addToast("Prompt copied.", "success", 1800);

        if (copyResetRef.current) clearTimeout(copyResetRef.current);
        copyResetRef.current = setTimeout(() => {
          setCopiedPromptId(null);
          copyResetRef.current = null;
        }, 1800);
      } catch (caught: unknown) {
        const message =
          caught instanceof Error ? caught.message : "Unable to copy the prompt.";
        setCopyError(message);
        addToast(message, "error");
      }
    },
    [addToast],
  );

  const hasFilters = Boolean(query.trim() || tagFilter || categoryFilter);

  return (
    <section className="library-home" aria-labelledby="library-heading">
      <header className="library-hero">
        <div>
          <h2 id="library-heading">Your prompt library</h2>
          <p>Find a prompt, copy it, and get back to work.</p>
        </div>
        <button
          type="button"
          className="primary-action"
          onClick={() => navigate("/create")}
        >
          New prompt
        </button>
      </header>

      <div className="library-toolbar" role="search">
        <div className="library-search">
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, text, tags, or categories"
            aria-label="Search prompts"
          />
          {query && (
            <button
              type="button"
              className="text-button"
              onClick={() => setQuery("")}
            >
              Clear
            </button>
          )}
        </div>

        <button
          type="button"
          className="secondary-action"
          onClick={() => setShowFilters((current) => !current)}
          aria-expanded={showFilters}
          aria-controls="library-filters"
        >
          {showFilters ? "Hide filters" : "Filter"}
        </button>
      </div>

      {showFilters && (
        <div className="filter-panel" id="library-filters">
          <label>
            Tag
            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
            >
              <option value="">All tags</option>
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="">All categories</option>
              {availableCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          {hasFilters && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setQuery("");
                setTagFilter("");
                setCategoryFilter("");
              }}
            >
              Reset all
            </button>
          )}
        </div>
      )}

      {isLoading && <p className="status">Loading your prompts…</p>}
      {error && <p className="error">{error}</p>}

      {!isLoading && !error && prompts.length === 0 && (
        <div className="library-empty">
          <h3>Build your first reusable prompt</h3>
          <p>
            Prompt Vault keeps prompts local so they are easy to find, copy, edit,
            and back up.
          </p>
          <div className="empty-actions">
            <button type="button" onClick={() => navigate("/create")}>
              Create a prompt
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => navigate("/settings#data")}
            >
              Import a backup
            </button>
          </div>
        </div>
      )}

      {!isLoading && !error && prompts.length > 0 && (
        <>
          <div className="library-count" aria-live="polite">
            {filteredPrompts.length === prompts.length
              ? `${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`
              : `${filteredPrompts.length} of ${prompts.length} prompts`}
          </div>

          {filteredPrompts.length === 0 ? (
            <div className="library-empty library-empty--compact">
              <h3>No prompts match</h3>
              <p>Try a broader search or reset the active filters.</p>
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setQuery("");
                  setTagFilter("");
                  setCategoryFilter("");
                }}
              >
                Reset filters
              </button>
            </div>
          ) : (
            <PromptList
              prompts={filteredPrompts}
              copiedPromptId={copiedPromptId}
              copyError={copyError}
              onCopy={handleCopy}
              onEdit={(prompt) => navigate(`/edit/${prompt.id}`, { state: { prompt } })}
            />
          )}
        </>
      )}
    </section>
  );
}
