import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listPrompts } from "../services/promptApi";
import type { PromptSummary } from "../types/prompt";
import { PromptList } from "../components/PromptList";
import { copyTextToClipboard } from "../lib/clipboard";
import { useToast } from "../components/Toast";

type LocationState = { refresh?: boolean } | null;

export function PromptListPage(): React.JSX.Element {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const { state } = useLocation() as { state: LocationState };
  const { addToast } = useToast();

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
          setError(null);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load prompts");
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
  }, [reloadToken]);

  const filteredPrompts = useMemo(() => {
    if (!searchQuery.trim()) {
      return prompts;
    }

    const query = searchQuery.toLowerCase().trim();
    return prompts.filter((prompt) => {
      const titleMatch = prompt.title?.toLowerCase().includes(query);
      const categoryMatch = prompt.category?.toLowerCase().includes(query);
      const tagMatch = prompt.tags.some((tag) => tag.toLowerCase().includes(query));
      const bodyMatch = prompt.latestVersion?.body?.toLowerCase().includes(query);
      return titleMatch || categoryMatch || tagMatch || bodyMatch;
    });
  }, [prompts, searchQuery]);

  const handleCopy = useCallback(async (prompt: PromptSummary): Promise<void> => {
    if (!prompt.latestVersion?.body) {
      addToast("Prompt body is unavailable. Try opening the editor to refresh this entry.", "error");
      return;
    }

    try {
      await copyTextToClipboard(prompt.latestVersion.body);
      setCopyError(null);
      setCopiedPromptId(prompt.id);
      addToast("Prompt copied to clipboard!", "success", 2000);
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
      }
      clearTimerRef.current = setTimeout(() => {
        setCopiedPromptId(null);
        clearTimerRef.current = null;
      }, 2000);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unable to copy prompt to the clipboard.";
      // Provide more helpful error messages for common clipboard issues
      if (errorMessage === 'CLIPBOARD_PERMISSIONS_BLOCKED') {
        addToast("Clipboard access blocked. Try using Ctrl+C/Cmd+C to copy manually, or enable clipboard permissions in your browser settings.", "error");
      } else if (errorMessage === 'FALLBACK_COPY_FAILED') {
        addToast("Automatic copying failed. The prompt text has been displayed in an alert - please copy it manually.", "warning");
      } else if (errorMessage === 'MANUAL_COPY_REQUIRED') {
        addToast("Prompt text displayed in alert popup. Please copy it manually using Ctrl+C/Cmd+C.", "info");
      } else {
        addToast(errorMessage, "error");
      }
    }
  }, [addToast]);

  const handleEdit = useCallback(
    (prompt: PromptSummary) => {
      navigate(`/edit/${prompt.id}`, { state: { prompt } });
    },
    [navigate]
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
      const searchInput = document.querySelector('.search-input') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus();
      }
    };

    const handleClearSearch = (): void => {
      setSearchQuery('');
      const searchInput = document.querySelector('.search-input') as HTMLInputElement;
      if (searchInput) {
        searchInput.blur();
      }
    };

    window.addEventListener('focus-search', handleFocusSearch);
    window.addEventListener('clear-search', handleClearSearch);

    return () => {
      window.removeEventListener('focus-search', handleFocusSearch);
      window.removeEventListener('clear-search', handleClearSearch);
    };
  }, []);

  if (isLoading) {
    return <p className="status">Loading prompts...</p>;
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  return (
    <div className="library-panel">
      <div className="library-header">
        <div className="search-container">
          <input
            type="text"
            placeholder="Search prompts... (Ctrl+K to focus, Esc to clear)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="search-clear"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        {searchQuery && (
          <p className="search-results">
            {filteredPrompts.length === 0
              ? "No prompts match your search."
              : `Found ${filteredPrompts.length} prompt${filteredPrompts.length === 1 ? "" : "s"}`}
          </p>
        )}
      </div>

      {copyError && <p className="error library-error">{copyError}</p>}

      <PromptList
        prompts={filteredPrompts}
        copiedPromptId={copiedPromptId}
        copyError={copyError}
        onCopy={handleCopy}
        onEdit={handleEdit}
      />
    </div>
  );
}
