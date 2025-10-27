import type { AddPromptVersionInput, CreatePromptInput, PromptSummary, PromptVersionSummary, UpdatePromptInput } from "../types/prompt";
import { isTauriAvailable } from "../lib/tauri";
import type { PromptVersionSummary as Version, PromptSummary as Summary } from "../types/prompt";

// In-memory fallback store used when the HTTP API is unreachable (web dev without server)
type InMemoryPrompt = Summary & { versions: Version[] };
const inMemoryStore: { prompts: InMemoryPrompt[] } = { prompts: [] };

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix = "p"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
}

// Browser API base URL - can be configured via environment variable
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

async function browserApiCall<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// --- Persistence and fallback state management ---
const LOCAL_STORAGE_KEY = 'prompt-vault:inMemoryStore:v1';
let fallbackActive = false;
const fallbackSubscribers = new Set<(b: boolean) => void>();

function notifyFallback(active: boolean): void {
  fallbackActive = active;
  for (const cb of fallbackSubscribers) cb(active);
}


export function isUsingFallback(): boolean {
  return fallbackActive;
}

export function subscribeFallback(cb: (b: boolean) => void): () => void {
  fallbackSubscribers.add(cb);
  cb(fallbackActive);
  return () => fallbackSubscribers.delete(cb);
}

function saveStore(): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(inMemoryStore));
  } catch (err) {
    // ignore storage errors
    console.warn('Failed to save inMemoryStore to localStorage', err);
  }
}

function loadStore(): void {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { prompts?: InMemoryPrompt[] };
      if (parsed && Array.isArray(parsed.prompts)) {
        inMemoryStore.prompts = parsed.prompts;
      }
    }
  } catch (err) {
    console.warn('Failed to load inMemoryStore from localStorage', err);
  }
}

// --- Auto-sync logic ---
async function trySyncToServer(): Promise<void> {
  if (isTauriAvailable()) return;
  if (!inMemoryStore.prompts.length) return;

  try {
    // fetch server prompts
    const srv = await browserApiCall<{ prompts: PromptSummary[] }>('/prompts');
    const serverBySlug = new Map<string, PromptSummary>();
    for (const p of srv.prompts) serverBySlug.set(p.slug, p);

    // iterate local prompts and push to server
    for (const localPrompt of [...inMemoryStore.prompts]) {
      const localLatest = localPrompt.versions[localPrompt.versions.length - 1];
      const serverMatch = serverBySlug.get(localPrompt.slug);

      if (!serverMatch) {
        // create on server
        try {
          const createPayload: CreatePromptInput = {
            slug: localPrompt.slug,
            title: localPrompt.title,
            description: localPrompt.description,
            body: localLatest?.body || '',
            semanticVersion: localLatest?.semanticVersion || '1.0.0',
            tags: localPrompt.tags || [],
          };
          await browserApiCall<{ prompt: PromptSummary }>('/prompts', {
            method: 'POST',
            body: JSON.stringify(createPayload),
          });
          // remove from local store after successful push
          inMemoryStore.prompts = inMemoryStore.prompts.filter((p) => p.id !== localPrompt.id);
          saveStore();
        } catch (err) {
          console.warn('trySyncToServer: failed to create prompt on server', err);
        }
      } else {
        // server exists — if semantic version differs, try to push latest version
        const serverLatestVer = serverMatch.latestVersion?.semanticVersion;
        if (localLatest && localLatest.semanticVersion !== serverLatestVer) {
          try {
            await browserApiCall<{ version: PromptVersionSummary }>(`/prompts/${serverMatch.id}/versions`, {
              method: 'POST',
              body: JSON.stringify({ body: localLatest.body, semanticVersion: localLatest.semanticVersion }),
            });
            // after pushing, remove local prompt
            inMemoryStore.prompts = inMemoryStore.prompts.filter((p) => p.id !== localPrompt.id);
            saveStore();
          } catch (err) {
            console.warn('trySyncToServer: failed to push version to server', err);
          }
        } else {
          // nothing to sync, remove local prompt to avoid duplicate attempts
          inMemoryStore.prompts = inMemoryStore.prompts.filter((p) => p.id !== localPrompt.id);
          saveStore();
        }
      }
    }
  } catch (err) {
    // server still unreachable — we'll keep retrying
    console.debug('trySyncToServer: server unreachable', err);
  }
}

function startBackgroundPoll(): void {
  if (isTauriAvailable()) return;
  // initial load
  loadStore();

  // quick check to set initial fallback state
  (async () => {
    try {
      await browserApiCall<{ prompts: PromptSummary[] }>('/prompts');
      // server reachable
      notifyFallback(false);
    } catch (err) {
      // keep the error variable used so linters don't complain and retain a debug trace
      console.debug('startBackgroundPoll initial check failed', err);
      notifyFallback(true);
    }
  })();

  setInterval(async () => {
    try {
      await browserApiCall<{ prompts: PromptSummary[] }>('/prompts');
      // server reachable — attempt sync if we were in fallback mode
      if (fallbackActive) {
        await trySyncToServer();
        notifyFallback(false);
      }
    } catch (err) {
      console.debug('startBackgroundPoll periodic check failed', err);
      notifyFallback(true);
    }
  }, 5000);
}

// start polling immediately in browser/dev mode
if (typeof window !== 'undefined' && !isTauriAvailable()) {
  startBackgroundPoll();
}

// Persist on every mutation

// --- In-memory fallback helpers ---
function listPromptsFromMemory(): Summary[] {
  // ensure loaded
  loadStore();
  return inMemoryStore.prompts.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    tags: p.tags,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    latestVersion: p.versions.length ? p.versions[p.versions.length - 1] : undefined,
  }));
}

function createPromptInMemory(input: CreatePromptInput): Summary {
  const id = makeId('p');
  const createdAt = nowIso();
  const versionId = makeId('v');
  const version: Version = {
    id: versionId,
    semanticVersion: input.semanticVersion,
    updatedAt: createdAt,
    body: input.body,
  };

  const prompt: InMemoryPrompt = {
    id,
    slug: input.slug,
    title: input.title,
    description: input.description,
    tags: input.tags || [],
    createdAt,
    updatedAt: createdAt,
    latestVersion: version,
    versions: [version],
  };

  inMemoryStore.prompts.push(prompt);
  saveStore();
  notifyFallback(true);
  return {
    id: prompt.id,
    slug: prompt.slug,
    title: prompt.title,
    description: prompt.description,
    tags: prompt.tags,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    latestVersion: version,
  };
}

function addPromptVersionInMemory(input: AddPromptVersionInput): Version {
  const prompt = inMemoryStore.prompts.find((p) => p.id === input.promptId);
  if (!prompt) throw new Error(`Prompt not found: ${input.promptId}`);
  const v: Version = {
    id: makeId('v'),
    semanticVersion: input.semanticVersion,
    updatedAt: nowIso(),
    body: input.body,
  };
  prompt.versions.push(v);
  prompt.latestVersion = v;
  prompt.updatedAt = v.updatedAt;
  saveStore();
  notifyFallback(true);
  return v;
}

function updatePromptInMemory(input: UpdatePromptInput): Summary {
  const prompt = inMemoryStore.prompts.find((p) => p.id === input.id);
  if (!prompt) throw new Error(`Prompt not found: ${input.id}`);
  if (input.title !== undefined) prompt.title = input.title;
  if (input.description !== undefined) prompt.description = input.description;
  if (input.tags !== undefined) prompt.tags = input.tags;
  prompt.updatedAt = nowIso();
  prompt.latestVersion = prompt.versions.length ? prompt.versions[prompt.versions.length - 1] : undefined;
  saveStore();
  notifyFallback(true);
  return {
    id: prompt.id,
    slug: prompt.slug,
    title: prompt.title,
    description: prompt.description,
    tags: prompt.tags,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    latestVersion: prompt.latestVersion,
  };
}

export async function listPrompts(): Promise<PromptSummary[]> {
  if (isTauriAvailable()) {
    // Use Tauri API
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ prompts: PromptSummary[] }>("list_prompts");
    return response.prompts;
  } else {
    // Use HTTP API with graceful fallback to in-memory store
    try {
      const response = await browserApiCall<{ prompts: PromptSummary[] }>('/prompts');
      return response.prompts;
    } catch (err: unknown) {
      // network / connection refused -> fall back to in-memory
      console.warn('listPrompts: HTTP API failed, using in-memory fallback', err);
      notifyFallback(true);
      return listPromptsFromMemory();
    }
  }
}

export async function createPrompt(input: CreatePromptInput): Promise<PromptSummary> {
  if (isTauriAvailable()) {
    // Use Tauri API
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ prompt: PromptSummary }>("create_prompt", { payload: input });
    return response.prompt;
  } else {
    try {
      const response = await browserApiCall<{ prompt: PromptSummary }>('/prompts', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return response.prompt;
    } catch (err: unknown) {
      console.warn('createPrompt: HTTP API failed, creating prompt in-memory', err);
      return createPromptInMemory(input);
    }
  }
}

export async function addPromptVersion(input: AddPromptVersionInput): Promise<PromptVersionSummary> {
  if (isTauriAvailable()) {
    // Use Tauri API
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ version: PromptVersionSummary }>("add_prompt_version", { payload: input });
    return response.version;
  } else {
    try {
      const response = await browserApiCall<{ version: PromptVersionSummary }>(`/prompts/${input.promptId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ body: input.body, semanticVersion: input.semanticVersion, changelog: input.changelog }),
      });
      return response.version;
    } catch (err: unknown) {
      console.warn('addPromptVersion: HTTP API failed, adding version in-memory', err);
      return addPromptVersionInMemory(input);
    }
  }
}

export async function updatePrompt(input: UpdatePromptInput): Promise<PromptSummary> {
  if (isTauriAvailable()) {
    // Use Tauri API
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ prompt: PromptSummary }>("update_prompt", { payload: input });
    return response.prompt;
  } else {
    try {
      const response = await browserApiCall<{ prompt: PromptSummary }>(`/prompts/${input.id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      return response.prompt;
    } catch (err: unknown) {
      console.warn('updatePrompt: HTTP API failed, updating in-memory', err);
      return updatePromptInMemory(input);
    }
  }
}
