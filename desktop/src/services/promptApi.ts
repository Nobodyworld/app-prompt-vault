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

// --- In-memory fallback helpers ---
function listPromptsFromMemory(): Summary[] {
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
