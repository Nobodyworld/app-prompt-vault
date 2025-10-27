import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listPrompts } from "../services/promptApi";
import type { PromptSummary } from "../types/prompt";
import { PromptList } from "../components/PromptList";
import { copyTextToClipboard } from "../lib/clipboard";

type LocationState = { refresh?: boolean } | null;

export function PromptListPage(): React.JSX.Element {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const { state } = useLocation() as { state: LocationState };

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

  const handleCopy = useCallback(async (prompt: PromptSummary): Promise<void> => {
    if (!prompt.latestVersion?.body) {
      setCopyError("Prompt body is unavailable. Try opening the editor to refresh this entry.");
      return;
    }

    try {
      await copyTextToClipboard(prompt.latestVersion.body);
      setCopyError(null);
      setCopiedPromptId(prompt.id);
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
        setCopyError("Clipboard access blocked. Try using Ctrl+C/Cmd+C to copy manually, or enable clipboard permissions in your browser settings.");
      } else if (errorMessage === 'FALLBACK_COPY_FAILED') {
        setCopyError("Automatic copying failed. The prompt text has been displayed in an alert - please copy it manually.");
      } else if (errorMessage === 'MANUAL_COPY_REQUIRED') {
        setCopyError("Prompt text displayed in alert popup. Please copy it manually using Ctrl+C/Cmd+C.");
      } else {
        setCopyError(errorMessage);
      }
    }
  }, []);

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

  if (isLoading) {
    return <p className="status">Loading prompts...</p>;
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (prompts.length === 0) {
    return <p className="status">No prompts yet - create your first prompt to get started.</p>;
  }

  return (
    <PromptList
      prompts={prompts}
      copiedPromptId={copiedPromptId}
      copyError={copyError}
      onCopy={handleCopy}
      onEdit={handleEdit}
    />
  );
}
