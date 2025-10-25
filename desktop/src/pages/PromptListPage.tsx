import { useEffect, useState } from "react";
import { listPrompts } from "../services/promptApi";
import type { PromptSummary } from "../types/prompt";
import { PromptList } from "../components/PromptList";
import { isTauriAvailable } from "../lib/tauri";

export function PromptListPage(): JSX.Element {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      try {
        setIsLoading(true);
        const data = await listPrompts();
        if (mounted) {
          setPrompts(data);
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

    load();

    return () => {
      mounted = false;
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

  return <PromptList prompts={prompts} />;
}
