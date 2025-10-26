import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listPrompts } from "../services/promptApi";
import type { PromptSummary } from "../types/prompt";
import { PromptList } from "../components/PromptList";
import { isTauriAvailable } from "../lib/tauri";
import { copyTextToClipboard } from "../lib/clipboard";

type LocationState = { refresh?: boolean } | null;

export function PromptListPage(): JSX.Element {
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

    if (!isTauriAvailable()) {
      setError("Desktop runtime unavailable. Launch Prompt Vault from the desktop app to view your library.");
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

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
      setCopyError(err instanceof Error ? err.message : "Unable to copy prompt to the clipboard.");
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
