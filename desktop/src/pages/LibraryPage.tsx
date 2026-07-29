import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { PromptList } from "../components/PromptList";
import { useToast } from "../components/Toast";
import { copyTextToClipboard } from "../lib/clipboard";
import {
  EMPTY_LIBRARY_FILTERS,
  LIBRARY_SORT_OPTIONS,
  filterAndSortLibraryPrompts,
  hasActiveLibraryFilters,
  isLibrarySortMode,
  loadLibrarySortPreference,
  saveLibrarySortPreference,
} from "../lib/libraryWorkspace";
import { listPrompts, updatePrompt } from "../services/promptApi";
import type { PromptSummary } from "../types/prompt";

function promptLabel(prompt: PromptSummary): string {
  return prompt.title.trim() || "Untitled Prompt";
}

function isLibraryShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])',
    ),
  );
}

export function LibraryPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pendingFavoriteIdsRef = useRef(new Set<string>());

  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [query, setQuery] = useState(EMPTY_LIBRARY_FILTERS.query);
  const [tagFilter, setTagFilter] = useState(EMPTY_LIBRARY_FILTERS.tag);
  const [categoryFilter, setCategoryFilter] = useState(
    EMPTY_LIBRARY_FILTERS.category,
  );
  const [favoritesOnly, setFavoritesOnly] = useState(
    EMPTY_LIBRARY_FILTERS.favoritesOnly,
  );
  const [sortMode, setSortMode] = useState(loadLibrarySortPreference);
  const [requestedActivePromptId, setRequestedActivePromptId] = useState<
    string | null
  >(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<
    ReadonlySet<string>
  >(new Set());

  const resetFilters = useCallback((): void => {
    setQuery(EMPTY_LIBRARY_FILTERS.query);
    setTagFilter(EMPTY_LIBRARY_FILTERS.tag);
    setCategoryFilter(EMPTY_LIBRARY_FILTERS.category);
    setFavoritesOnly(EMPTY_LIBRARY_FILTERS.favoritesOnly);
  }, []);

  const loadPrompts = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    try {
      const loadedPrompts = await listPrompts();
      if (!mountedRef.current) return;
      setPrompts(loadedPrompts);
      setError(null);
    } catch (caught: unknown) {
      if (!mountedRef.current) return;
      const message =
        caught instanceof Error ? caught.message : "Unable to load your prompts.";
      setError(message);
      addToast(message, "error");
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  useEffect(() => {
    const focusSearch = (): void => searchInputRef.current?.focus();
    const clearSearchAndFilters = (): void => {
      resetFilters();
      searchInputRef.current?.blur();
    };

    window.addEventListener("focus-search", focusSearch);
    window.addEventListener("clear-search", clearSearchAndFilters);

    return () => {
      window.removeEventListener("focus-search", focusSearch);
      window.removeEventListener("clear-search", clearSearchAndFilters);
    };
  }, [resetFilters]);

  const availableTags = useMemo(
    () =>
      Array.from(new Set(prompts.flatMap((prompt) => prompt.tags)))
        .filter(Boolean)
        .toSorted((left, right) =>
          left
            .toLocaleLowerCase("en-US")
            .localeCompare(right.toLocaleLowerCase("en-US")),
        ),
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
      ).toSorted((left, right) =>
        left
          .toLocaleLowerCase("en-US")
          .localeCompare(right.toLocaleLowerCase("en-US")),
      ),
    [prompts],
  );

  const filters = useMemo(
    () => ({
      query,
      tag: tagFilter,
      category: categoryFilter,
      favoritesOnly,
    }),
    [categoryFilter, favoritesOnly, query, tagFilter],
  );

  const visiblePrompts = useMemo(
    () => filterAndSortLibraryPrompts(prompts, filters, sortMode),
    [filters, prompts, sortMode],
  );

  const activePromptId = useMemo(() => {
    if (
      requestedActivePromptId &&
      visiblePrompts.some((prompt) => prompt.id === requestedActivePromptId)
    ) {
      return requestedActivePromptId;
    }
    return visiblePrompts[0]?.id ?? null;
  }, [requestedActivePromptId, visiblePrompts]);

  useEffect(() => {
    if (requestedActivePromptId !== activePromptId) {
      setRequestedActivePromptId(activePromptId);
    }
  }, [activePromptId, requestedActivePromptId]);

  const handleCopy = useCallback(
    async (prompt: PromptSummary): Promise<void> => {
      const body = prompt.latestVersion?.body;
      if (!body?.trim()) {
        const message = `“${promptLabel(prompt)}” has no copyable prompt text. Open Edit to add content.`;
        setCopyError(message);
        addToast(message, "warning");
        return;
      }

      try {
        await copyTextToClipboard(body);
        if (!mountedRef.current) return;
        setCopyError(null);
        setCopiedPromptId(prompt.id);
        addToast("Prompt copied.", "success", 1800);

        if (copyResetRef.current) clearTimeout(copyResetRef.current);
        copyResetRef.current = setTimeout(() => {
          if (mountedRef.current) setCopiedPromptId(null);
          copyResetRef.current = null;
        }, 1800);
      } catch {
        if (!mountedRef.current) return;
        const message = `Couldn’t copy “${promptLabel(prompt)}”. Check clipboard permissions and try again.`;
        setCopyError(message);
        addToast(message, "error");
      }
    },
    [addToast],
  );

  const handleToggleFavorite = useCallback(
    async (prompt: PromptSummary): Promise<void> => {
      if (pendingFavoriteIdsRef.current.has(prompt.id)) return;

      const nextFavorite = !prompt.isFavorite;
      pendingFavoriteIdsRef.current.add(prompt.id);
      setPendingFavoriteIds(
        (current) => new Set([...current, prompt.id]),
      );
      setFavoriteError(null);
      setPrompts((current) =>
        current.map((candidate) =>
          candidate.id === prompt.id
            ? { ...candidate, isFavorite: nextFavorite }
            : candidate,
        ),
      );

      try {
        const persisted = await updatePrompt({
          id: prompt.id,
          isFavorite: nextFavorite,
        });
        if (!mountedRef.current) return;
        setPrompts((current) =>
          current.map((candidate) =>
            candidate.id === prompt.id
              ? {
                  ...candidate,
                  ...persisted,
                  latestVersion:
                    persisted.latestVersion ?? candidate.latestVersion,
                }
              : candidate,
          ),
        );
        addToast(
          nextFavorite ? "Added to favorites." : "Removed from favorites.",
          "success",
          2200,
        );
      } catch {
        if (!mountedRef.current) return;
        setPrompts((current) =>
          current.map((candidate) =>
            candidate.id === prompt.id
              ? { ...candidate, isFavorite: prompt.isFavorite }
              : candidate,
          ),
        );
        const message = `Couldn’t update the favorite state for “${promptLabel(prompt)}”. Try again.`;
        setFavoriteError(message);
        addToast(message, "error");
      } finally {
        pendingFavoriteIdsRef.current.delete(prompt.id);
        if (mountedRef.current) {
          setPendingFavoriteIds((current) => {
            const next = new Set(current);
            next.delete(prompt.id);
            return next;
          });
        }
      }
    },
    [addToast],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        isLibraryShortcutTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const activeIndex = visiblePrompts.findIndex(
        (prompt) => prompt.id === activePromptId,
      );

      if (key === "arrowdown" || key === "arrowup") {
        if (visiblePrompts.length === 0) return;
        event.preventDefault();
        const direction = key === "arrowdown" ? 1 : -1;
        const startingIndex = activeIndex < 0 ? 0 : activeIndex;
        const nextIndex = Math.min(
          visiblePrompts.length - 1,
          Math.max(0, startingIndex + direction),
        );
        setRequestedActivePromptId(visiblePrompts[nextIndex]?.id ?? null);
        return;
      }

      const activePrompt =
        activeIndex >= 0 ? visiblePrompts[activeIndex] : undefined;
      if (!activePrompt) return;

      if (key === "enter") {
        event.preventDefault();
        void handleCopy(activePrompt);
      } else if (key === "e") {
        event.preventDefault();
        navigate(`/edit/${activePrompt.id}`, {
          state: { prompt: activePrompt },
        });
      } else if (key === "f") {
        event.preventDefault();
        void handleToggleFavorite(activePrompt);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    activePromptId,
    handleCopy,
    handleToggleFavorite,
    navigate,
    visiblePrompts,
  ]);

  const hasFilters = hasActiveLibraryFilters(filters);
  const activePrompt = visiblePrompts.find(
    (prompt) => prompt.id === activePromptId,
  );

  return (
    <section
      className="library-home"
      aria-labelledby="library-heading"
      aria-describedby="library-keyboard-help"
    >
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

        <div className="library-quick-controls">
          <button
            type="button"
            className={`secondary-action favorite-filter${favoritesOnly ? " is-active" : ""}`}
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((current) => !current)}
          >
            <span aria-hidden="true">★</span>
            Favorites
          </button>

          <label className="library-sort">
            <span>Sort</span>
            <select
              value={sortMode}
              onChange={(event) => {
                const nextMode = event.target.value;
                if (!isLibrarySortMode(nextMode)) return;
                setSortMode(nextMode);
                saveLibrarySortPreference(nextMode);
              }}
            >
              {LIBRARY_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="secondary-action"
            onClick={() => setShowFilters((current) => !current)}
            aria-expanded={showFilters}
            aria-controls="library-filters"
          >
            {showFilters ? "Hide filters" : "More filters"}
          </button>

          {hasFilters && (
            <button
              type="button"
              className="text-button library-reset"
              onClick={resetFilters}
            >
              Reset all
            </button>
          )}
        </div>
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
        </div>
      )}

      {hasFilters && (
        <div className="active-filters" aria-label="Active filters">
          <span>Active filters:</span>
          {query.trim() && <span className="filter-chip">Query: {query.trim()}</span>}
          {favoritesOnly && <span className="filter-chip">Favorites</span>}
          {tagFilter && <span className="filter-chip">Tag: {tagFilter}</span>}
          {categoryFilter && (
            <span className="filter-chip">Category: {categoryFilter}</span>
          )}
        </div>
      )}

      <p className="library-keyboard-help" id="library-keyboard-help">
        Library keys: ↑/↓ choose a row, Enter copies, E edits, and F changes
        favorite. Shortcuts pause while a form control is focused.
      </p>

      {activePrompt && (
        <p className="visually-hidden" aria-live="polite">
          Active prompt: {promptLabel(activePrompt)}
        </p>
      )}

      {isLoading && <p className="status">Loading your prompts…</p>}
      {error && (
        <div className="library-load-error" role="alert">
          <p className="error">{error}</p>
          <button
            type="button"
            className="secondary-action"
            onClick={() => void loadPrompts()}
          >
            Try loading again
          </button>
        </div>
      )}

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
          <div className="library-count" aria-live="polite" aria-atomic="true">
            {visiblePrompts.length === prompts.length
              ? `${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`
              : `${visiblePrompts.length} of ${prompts.length} prompts`}
          </div>

          {visiblePrompts.length === 0 ? (
            <div className="library-empty library-empty--compact">
              <h3>No prompts match the active filters</h3>
              <p>
                Your library is still here. Broaden the search or reset all
                filters.
              </p>
              <button
                type="button"
                className="secondary-action"
                onClick={resetFilters}
              >
                Reset all filters
              </button>
            </div>
          ) : (
            <PromptList
              prompts={visiblePrompts}
              activePromptId={activePromptId}
              copiedPromptId={copiedPromptId}
              pendingFavoriteIds={pendingFavoriteIds}
              copyError={copyError}
              favoriteError={favoriteError}
              onActivate={setRequestedActivePromptId}
              onCopy={(prompt) => void handleCopy(prompt)}
              onEdit={(prompt) =>
                navigate(`/edit/${prompt.id}`, { state: { prompt } })
              }
              onToggleFavorite={(prompt) => void handleToggleFavorite(prompt)}
            />
          )}
        </>
      )}
    </section>
  );
}
