import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router";
import {
  deletePrompt,
  exportPromptBundle,
  importPromptBundle,
  listPrompts,
  searchPrompts,
  updatePrompt,
} from "../services/promptApi";
import type { PromptSummary } from "../types/prompt";
import { PromptList } from "../components/PromptList";
import { useToast } from "../components/Toast";
import { copyTextToClipboard } from "../lib/clipboard";
import {
  buildButtonsSwitchboardPayload,
  buildPlannerBucketDraft,
} from "../lib/interop";
import { useI18n } from "../i18n";

type LocationState = { refresh?: boolean } | null;

export function PromptListPage(): React.JSX.Element {
  const { t } = useI18n();
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [displayPrompts, setDisplayPrompts] = useState<PromptSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [projectTagIdFilter, setProjectTagIdFilter] = useState("");
  const [bundleText, setBundleText] = useState("");
  const [isBundleBusy, setIsBundleBusy] = useState(false);
  const [selectedPromptIds, setSelectedPromptIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkTags, setBulkTags] = useState("");
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasShownSearchFallbackToastRef = useRef(false);
  const searchRequestIdRef = useRef(0);
  const navigate = useNavigate();
  const { state } = useLocation() as { state: LocationState };
  const { addToast } = useToast();

  const selectedCount = selectedPromptIds.size;

  const toggleSelected = useCallback((promptId: string) => {
    setSelectedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(promptId)) next.delete(promptId);
      else next.add(promptId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPromptIds(new Set());
  }, []);

  const requestReload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    if (state?.refresh) {
      requestReload();
      navigate(".", { replace: true, state: null });
    }
  }, [navigate, requestReload, state?.refresh]);

  useEffect(() => {
    let mounted = true;

    async function load(): Promise<void> {
      setIsLoading(true);
      try {
        const data = await listPrompts();
        if (mounted) {
          setPrompts(data);
          setDisplayPrompts(data);
          setError(null);
          setSelectedPromptIds(new Set());
        }
      } catch (err: unknown) {
        if (mounted) {
          const message =
            err instanceof Error ? err.message : t("library.failedLoad");
          setError(message);
          addToast(message, "error");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [reloadToken, t]);

  useEffect(() => {
    // Prune selections that are no longer present in the currently displayed list.
    setSelectedPromptIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(displayPrompts.map((p) => p.id));
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
      }
      return next;
    });
  }, [displayPrompts]);

  useEffect(() => {
    let cancelled = false;

    const requestId = (searchRequestIdRef.current += 1);

    const activeText = searchQuery.trim();
    const activeTag = tagFilter.trim();
    const activeCategory = categoryFilter.trim();
    const activeProjectTagId = projectTagIdFilter.trim();
    const hasServerFilters = Boolean(
      activeText || activeTag || activeCategory || activeProjectTagId,
    );

    if (!hasServerFilters) {
      setDisplayPrompts(prompts);
      setIsSearching(false);
      return () => {
        cancelled = true;
      };
    }

    setIsSearching(true);

    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const serverResults = await searchPrompts({
            text: activeText || undefined,
            tag: activeTag || undefined,
            category: activeCategory || undefined,
            projectTagId: activeProjectTagId || undefined,
            page: 0,
            pageSize: 200,
          });
          if (!cancelled && requestId === searchRequestIdRef.current) {
            setDisplayPrompts(serverResults);
          }
        } catch {
          if (!cancelled && !hasShownSearchFallbackToastRef.current) {
            hasShownSearchFallbackToastRef.current = true;
            addToast(t("library.toast.searchFallback"), "warning");
          }

          const query = activeText.toLowerCase();
          const normalizedTag = activeTag.toLowerCase();
          const normalizedCategory = activeCategory.toLowerCase();
          const requiresProjectScope = Boolean(activeProjectTagId);

          const filtered = prompts.filter((prompt) => {
            if (requiresProjectScope) {
              return false;
            }

            if (normalizedTag) {
              if (
                !prompt.tags.some((tag) => tag.toLowerCase() === normalizedTag)
              )
                return false;
            }

            if (normalizedCategory) {
              if ((prompt.category ?? "").toLowerCase() !== normalizedCategory)
                return false;
            }

            if (!query) return true;
            const titleMatch = prompt.title?.toLowerCase().includes(query);
            const categoryMatch = prompt.category
              ?.toLowerCase()
              .includes(query);
            const tagMatch = prompt.tags.some((tag) =>
              tag.toLowerCase().includes(query),
            );
            const bodyMatch = prompt.latestVersion?.body
              ?.toLowerCase()
              .includes(query);
            return titleMatch || categoryMatch || tagMatch || bodyMatch;
          });

          if (!cancelled && requestId === searchRequestIdRef.current) {
            setDisplayPrompts(filtered);
          }
        } finally {
          if (!cancelled && requestId === searchRequestIdRef.current) {
            setIsSearching(false);
          }
        }
      })();
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    addToast,
    categoryFilter,
    projectTagIdFilter,
    prompts,
    searchQuery,
    tagFilter,
    t,
  ]);

  const availableTags = useMemo(() => {
    const unique = new Set<string>();
    for (const prompt of prompts) {
      for (const tag of prompt.tags ?? []) {
        const trimmed = tag.trim();
        if (trimmed) unique.add(trimmed);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [prompts]);

  const availableCategories = useMemo(() => {
    const unique = new Set<string>();
    for (const prompt of prompts) {
      const category = (prompt.category ?? "").trim();
      if (category) unique.add(category);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [prompts]);

  const buttonsPayload = useMemo(
    () => buildButtonsSwitchboardPayload(displayPrompts),
    [displayPrompts],
  );
  const plannerDraft = useMemo(
    () => buildPlannerBucketDraft(displayPrompts),
    [displayPrompts],
  );

  const handleSelectAllVisible = useCallback(() => {
    setSelectedPromptIds((prev) => {
      const allIds = displayPrompts.map((p) => p.id);
      if (prev.size === allIds.length && allIds.length > 0) {
        return new Set();
      }
      return new Set(allIds);
    });
  }, [displayPrompts]);

  const handleBulkTag = useCallback(async () => {
    const tagsToAdd = bulkTags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (tagsToAdd.length === 0) {
      addToast("Enter one or more tags (comma-separated).", "warning");
      return;
    }

    if (selectedPromptIds.size === 0) {
      addToast("Select one or more prompts first.", "warning");
      return;
    }

    setIsBulkBusy(true);
    try {
      const promptsById = new Map(prompts.map((p) => [p.id, p] as const));
      for (const promptId of selectedPromptIds) {
        const prompt = promptsById.get(promptId);
        if (!prompt) continue;

        const existing = prompt.tags ?? [];
        const existingLower = new Set(existing.map((tag) => tag.toLowerCase()));
        const merged = [...existing];
        for (const tag of tagsToAdd) {
          const key = tag.toLowerCase();
          if (!existingLower.has(key)) {
            existingLower.add(key);
            merged.push(tag);
          }
        }

        await updatePrompt({
          id: promptId,
          tags: merged,
        });
      }

      addToast(`Added tags to ${selectedPromptIds.size} prompt(s).`, "success");
      setBulkTags("");
      requestReload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast(message, "error");
    } finally {
      setIsBulkBusy(false);
    }
  }, [addToast, bulkTags, prompts, requestReload, selectedPromptIds]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedPromptIds.size === 0) {
      addToast("Select one or more prompts first.", "warning");
      return;
    }

    const ok = window.confirm(
      `Delete ${selectedPromptIds.size} prompt(s)? This cannot be undone.`,
    );
    if (!ok) return;

    setIsBulkBusy(true);
    try {
      for (const promptId of selectedPromptIds) {
        await deletePrompt(promptId);
      }

      addToast(`Deleted ${selectedPromptIds.size} prompt(s).`, "success");
      clearSelection();
      requestReload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast(message, "error");
    } finally {
      setIsBulkBusy(false);
    }
  }, [addToast, clearSelection, requestReload, selectedPromptIds]);

  const handleCopy = useCallback(
    async (prompt: PromptSummary): Promise<void> => {
      if (!prompt.latestVersion?.body) {
        addToast(t("library.toast.bodyUnavailable"), "error");
        return;
      }

      try {
        await copyTextToClipboard(prompt.latestVersion.body);
        setCopyError(null);
        setCopiedPromptId(prompt.id);
        addToast(t("library.toast.copied"), "success", 2000);

        if (clearTimerRef.current) {
          clearTimeout(clearTimerRef.current);
        }

        clearTimerRef.current = setTimeout(() => {
          setCopiedPromptId(null);
          clearTimerRef.current = null;
        }, 2000);
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Unable to copy prompt to the clipboard.";
        setCopyError(errorMessage);

        if (errorMessage === "CLIPBOARD_PERMISSIONS_BLOCKED") {
          addToast(t("library.toast.clipboardBlocked"), "error");
        } else if (errorMessage === "FALLBACK_COPY_FAILED") {
          addToast(t("library.toast.fallbackCopyFailed"), "warning");
        } else if (errorMessage === "MANUAL_COPY_REQUIRED") {
          addToast(t("library.toast.manualCopyRequired"), "info");
        } else {
          addToast(errorMessage, "error");
        }
      }
    },
    [addToast, t],
  );

  const handleCopyButtonsPayload = useCallback(async () => {
    if (!buttonsPayload) {
      addToast(t("library.toast.exportButtonsMissing"), "warning");
      return;
    }
    await copyTextToClipboard(JSON.stringify(buttonsPayload, null, 2));
    addToast(t("library.toast.buttonsCopied"), "success");
  }, [addToast, buttonsPayload, t]);

  const handleCopyPlannerDraft = useCallback(async () => {
    if (!plannerDraft) {
      addToast(t("library.toast.exportPlannerMissing"), "warning");
      return;
    }
    await copyTextToClipboard(JSON.stringify(plannerDraft, null, 2));
    addToast(t("library.toast.plannerCopied"), "success");
  }, [addToast, plannerDraft, t]);

  const handleEdit = useCallback(
    (prompt: PromptSummary) => {
      navigate(`/edit/${prompt.id}`, { state: { prompt } });
    },
    [navigate],
  );

  const handleExportBundle = useCallback(
    async (format: "json" | "yaml") => {
      setIsBundleBusy(true);
      try {
        const bundle = await exportPromptBundle({
          format,
          promptIds: displayPrompts.map((prompt) => prompt.id),
          includeMetadata: true,
        });
        await copyTextToClipboard(bundle);
        addToast(t("bundle.toast.exportCopied"), "success");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addToast(`${t("bundle.toast.exportFailed")}: ${message}`, "error");
      } finally {
        setIsBundleBusy(false);
      }
    },
    [addToast, displayPrompts, t],
  );

  const handleImportBundle = useCallback(
    async (format: "json" | "yaml") => {
      if (!bundleText.trim()) {
        addToast(t("bundle.toast.importMissing"), "warning");
        return;
      }

      setIsBundleBusy(true);
      try {
        const result = await importPromptBundle({
          format,
          content: bundleText,
          conflictStrategy: "addVersion",
        });
        addToast(
          t("bundle.toast.imported", { count: result.imported }),
          "success",
        );
        setBundleText("");
        requestReload();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addToast(`${t("bundle.toast.importFailed")}: ${message}`, "error");
      } finally {
        setIsBundleBusy(false);
      }
    },
    [addToast, bundleText, requestReload, t],
  );

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleFocusSearch = (): void => {
      const searchInput = document.querySelector(
        ".search-input",
      ) as HTMLInputElement | null;
      searchInput?.focus();
    };

    const handleClearSearch = (): void => {
      setSearchQuery("");
      const searchInput = document.querySelector(
        ".search-input",
      ) as HTMLInputElement | null;
      searchInput?.blur();
    };

    window.addEventListener("focus-search", handleFocusSearch);
    window.addEventListener("clear-search", handleClearSearch);

    return () => {
      window.removeEventListener("focus-search", handleFocusSearch);
      window.removeEventListener("clear-search", handleClearSearch);
    };
  }, []);

  if (isLoading) {
    return <p className="status">{t("library.loading")}</p>;
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  const hasAnyFilter = Boolean(
    searchQuery.trim() ||
    tagFilter.trim() ||
    categoryFilter.trim() ||
    projectTagIdFilter.trim(),
  );

  return (
    <div className="library-panel">
      <div className="library-header">
        <div className="search-container">
          <input
            type="text"
            placeholder={t("library.search.placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="search-clear"
              aria-label={t("library.search.clear")}
            >
              ✕
            </button>
          )}
        </div>

        <div className="search-filters">
          <datalist id="prompt-vault-tag-options">
            {availableTags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <datalist id="prompt-vault-category-options">
            {availableCategories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <input
            type="text"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder={t("library.search.tagPlaceholder")}
            className="search-input search-input--small"
            list="prompt-vault-tag-options"
          />
          <input
            type="text"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            placeholder={t("library.search.categoryPlaceholder")}
            className="search-input search-input--small"
            list="prompt-vault-category-options"
          />
          <input
            type="text"
            value={projectTagIdFilter}
            onChange={(e) => setProjectTagIdFilter(e.target.value)}
            placeholder={t("library.search.projectTagIdPlaceholder")}
            className="search-input search-input--small"
          />
        </div>

        {hasAnyFilter && (
          <p className="search-results">
            {isSearching
              ? t("library.search.searching")
              : displayPrompts.length === 0
                ? t("library.search.noMatches")
                : t("library.search.found", { count: displayPrompts.length })}
          </p>
        )}
      </div>

      <div className="interop-card">
        <div className="interop-card__header">
          <div>
            <p className="interop-eyebrow">Send to other apps</p>
            <h3>Reuse these prompts elsewhere</h3>
            <p className="interop-muted">
              Copy JSON payloads that drop directly into Buttons (floating
              switchboard) or Planner (bucket draft).
            </p>
          </div>
          <div className="interop-counts">
            <span className="interop-pill">
              {displayPrompts.length} selected
            </span>
            <span className="interop-pill interop-pill--soft">
              {buttonsPayload?.switchboard.phrases.length ?? 0} phrases
            </span>
          </div>
        </div>
        <div className="interop-actions">
          <button
            type="button"
            className="interop-btn"
            onClick={() => void handleCopyButtonsPayload()}
            disabled={!buttonsPayload}
            title="Copy a Buttons-compatible switchboard button"
          >
            Copy Buttons switchboard JSON
          </button>
          <button
            type="button"
            className="interop-btn secondary"
            onClick={() => void handleCopyPlannerDraft()}
            disabled={!plannerDraft}
            title="Copy a Planner bucket draft with tasks seeded from these prompts"
          >
            Copy Planner bucket draft
          </button>
        </div>
      </div>

      <div className="interop-card">
        <div className="interop-card__header">
          <div>
            <p className="interop-eyebrow">{t("bundle.eyebrow")}</p>
            <h3>{t("bundle.title")}</h3>
            <p className="interop-muted">{t("bundle.description")}</p>
          </div>
        </div>

        <div className="bundle-stack">
          <textarea
            className="search-input"
            rows={6}
            value={bundleText}
            onChange={(e) => setBundleText(e.target.value)}
            placeholder={t("bundle.importPlaceholder")}
          />
          <div className="interop-actions">
            <button
              type="button"
              className="interop-btn"
              onClick={() => void handleExportBundle("json")}
              disabled={isBundleBusy || displayPrompts.length === 0}
            >
              {t("bundle.exportJson")}
            </button>
            <button
              type="button"
              className="interop-btn secondary"
              onClick={() => void handleExportBundle("yaml")}
              disabled={isBundleBusy || displayPrompts.length === 0}
            >
              {t("bundle.exportYaml")}
            </button>
            <button
              type="button"
              className="interop-btn"
              onClick={() => void handleImportBundle("json")}
              disabled={isBundleBusy}
            >
              {t("bundle.importJson")}
            </button>
            <button
              type="button"
              className="interop-btn secondary"
              onClick={() => void handleImportBundle("yaml")}
              disabled={isBundleBusy}
            >
              {t("bundle.importYaml")}
            </button>
          </div>
        </div>
      </div>

      {copyError && <p className="error library-error">{copyError}</p>}

      <div className="interop-card">
        <div className="interop-card__header">
          <div>
            <p className="interop-eyebrow">Bulk actions</p>
            <h3>Manage multiple prompts</h3>
            <p className="interop-muted">
              Select prompts below, then tag or delete them in one go.
            </p>
          </div>
          <div className="interop-counts">
            <span className="interop-pill">{selectedCount} selected</span>
          </div>
        </div>
        <div className="bundle-stack">
          <input
            type="text"
            value={bulkTags}
            onChange={(event) => setBulkTags(event.target.value)}
            placeholder="Tags to add (comma-separated)"
            className="search-input"
          />
          <div className="interop-actions">
            <button
              type="button"
              className="interop-btn secondary"
              onClick={handleSelectAllVisible}
              disabled={isBulkBusy || displayPrompts.length === 0}
            >
              {selectedCount === displayPrompts.length &&
              displayPrompts.length > 0
                ? "Clear selection"
                : "Select all filtered"}
            </button>
            <button
              type="button"
              className="interop-btn"
              onClick={() => void handleBulkTag()}
              disabled={isBulkBusy}
            >
              Add tags
            </button>
            <button
              type="button"
              className="interop-btn secondary"
              onClick={() => void handleBulkDelete()}
              disabled={isBulkBusy}
            >
              Delete selected
            </button>
          </div>
        </div>
      </div>

      <PromptList
        prompts={displayPrompts}
        copiedPromptId={copiedPromptId}
        copyError={copyError}
        onCopy={handleCopy}
        onEdit={handleEdit}
        selectedPromptIds={selectedPromptIds}
        onToggleSelected={toggleSelected}
      />
    </div>
  );
}
