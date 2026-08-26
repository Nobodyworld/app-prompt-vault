import type {
  AddPromptVersionInput,
  CreatePromptInput,
  PromptSummary,
  PromptVersionSummary,
  UpdatePromptInput,
} from "../types/prompt";
import {
  buildBackupDocumentV2,
  buildRestorePlan,
  fingerprintRecoveryDocument,
  parseBackupText,
  planMatches,
  serializeBackupDocument,
  sha256,
  verifyBackupExport,
  versionIdentity,
  type BackupValidationResult,
  type LegacyRecoveryPreview,
  type LegacySourceStatus,
  type RecoveryDocument,
  type RecoveryLibraryPrompt,
  type RestorePlan,
  type RestorePolicy,
  type RestoreResult,
  type StorageStatus,
} from "../../../src/domain/recovery";
import { isTauriAvailable } from "../lib/tauri";
import { httpFetch } from "../../../src/lib/platform-connectors";
import type {
  PromptVersionSummary as Version,
  PromptSummary as Summary,
} from "../types/prompt";

type ApiTag = string | { id?: string; label?: string };

type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type ApiSuccessEnvelope<T> = {
  data: T;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isRecord(value)) return false;
  if (!isRecord(value.error)) return false;
  return typeof value.error.code === "string" &&
    typeof value.error.message === "string";
}

export function unwrapApiEnvelope<T>(payload: unknown): T {
  if (!isRecord(payload) || !("data" in payload)) {
    throw new Error("Invalid API response: missing data envelope");
  }
  return (payload as ApiSuccessEnvelope<T>).data;
}

class PromptVaultApiError extends Error {
  public readonly code: string;

  public readonly status: number;

  public readonly details?: unknown;

  public constructor(input: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "PromptVaultApiError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
  }
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const labels = tags
    .map((tag) => {
      if (typeof tag === "string") return tag;
      if (tag && typeof tag === "object" && "label" in tag) {
        const label = (tag as { label?: unknown }).label;
        return typeof label === "string" ? label : "";
      }
      return "";
    })
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  return labels;
}

function normalizePromptSummary(raw: unknown): PromptSummary {
  const candidate = raw as Partial<PromptSummary> & { tags?: ApiTag[] };
  return {
    id: candidate.id ?? "",
    slug: candidate.slug ?? "",
    title: candidate.title ?? "",
    description: candidate.description,
    category: candidate.category?.trim() || undefined,
    isFavorite: Boolean(candidate.isFavorite),
    rating: candidate.rating ?? null,
    tags: normalizeTags(candidate.tags),
    createdAt: candidate.createdAt ?? nowIso(),
    updatedAt: candidate.updatedAt ?? nowIso(),
    latestVersion: candidate.latestVersion,
  };
}

export interface SearchPromptsInput {
  text?: string;
  tag?: string;
  category?: string;
  projectTagId?: string;
  page?: number;
  pageSize?: number;
}

export type PromptBundleFormat = "json" | "yaml";

export interface ExportPromptBundleInput {
  format: PromptBundleFormat;
  promptIds?: string[];
  includeMetadata?: boolean;
}

export interface ImportPromptBundleInput {
  format: PromptBundleFormat;
  content: string;
  conflictStrategy?: "skip" | "addVersion";
}

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
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";

async function browserApiCall<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await httpFetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.toLowerCase().includes("application/json");

  if (!response.ok) {
    if (isJson) {
      const json = (await response.json().catch(() => undefined)) as unknown;
      if (isErrorEnvelope(json)) {
        const detailIssues = isRecord(json.error.details) &&
          Array.isArray(json.error.details.issues)
          ? json.error.details.issues.filter(
              (issue): issue is string => typeof issue === "string",
            )
          : [];
        throw new PromptVaultApiError({
          code: json.error.code,
          message: detailIssues[0] ?? json.error.message,
          details: json.error.details,
          status: response.status,
        });
      }
    }
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as unknown;
  return unwrapApiEnvelope<T>(json);
}

async function browserApiCallText(
  endpoint: string,
  options?: RequestInit,
): Promise<string> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await httpFetch(url, {
    headers: {
      ...options?.headers,
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.toLowerCase().includes("application/json");

  if (!response.ok) {
    if (isJson) {
      const json = (await response.json().catch(() => undefined)) as unknown;
      if (isErrorEnvelope(json)) {
        throw new PromptVaultApiError({
          code: json.error.code,
          message: json.error.message,
          details: json.error.details,
          status: response.status,
        });
      }
    }
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function browserApiCallVoid(
  endpoint: string,
  options?: RequestInit,
): Promise<void> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await httpFetch(url, {
    headers: {
      ...options?.headers,
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.toLowerCase().includes("application/json");

  if (!response.ok) {
    if (isJson) {
      const json = (await response.json().catch(() => undefined)) as unknown;
      if (isErrorEnvelope(json)) {
        throw new PromptVaultApiError({
          code: json.error.code,
          message: json.error.message,
          details: json.error.details,
          status: response.status,
        });
      }
    }
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }
}

// --- Persistence and fallback state management ---
const LOCAL_STORAGE_KEY = "prompt-vault:inMemoryStore:v1";
const STORAGE_PERSISTENCE_ERROR =
  "Unable to save prompt changes to local browser storage. Check storage availability and try again.";
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

function saveStore(): boolean {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(inMemoryStore));
    return true;
  } catch (err) {
    console.warn("Failed to save inMemoryStore to localStorage", err);
    return false;
  }
}

function persistStoreOrRollback(rollback: () => void): void {
  if (saveStore()) return;
  rollback();
  throw new Error(STORAGE_PERSISTENCE_ERROR);
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
    console.warn("Failed to load inMemoryStore from localStorage", err);
  }
}

// --- Auto-sync logic ---
async function trySyncToServer(): Promise<void> {
  if (isTauriAvailable()) return;
  if (!inMemoryStore.prompts.length) return;

  try {
    // fetch server prompts
    const srv = await browserApiCall<{ prompts: unknown[] }>("/prompts");
    const serverBySlug = new Map<string, PromptSummary>();
    for (const prompt of srv.prompts.map((raw) => normalizePromptSummary(raw))) {
      serverBySlug.set(prompt.slug, prompt);
    }

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
            category: localPrompt.category,
            isFavorite: localPrompt.isFavorite,
            rating: localPrompt.rating ?? null,
            body: localLatest?.body || "",
            semanticVersion: localLatest?.semanticVersion || "1.0.0",
            tags: localPrompt.tags || [],
          };
          await browserApiCall<{ prompt: unknown }>("/prompts", {
            method: "POST",
            body: JSON.stringify(createPayload),
          });
          // remove from local store after successful push
          inMemoryStore.prompts = inMemoryStore.prompts.filter(
            (p) => p.id !== localPrompt.id,
          );
          saveStore();
        } catch (err) {
          console.warn(
            "trySyncToServer: failed to create prompt on server",
            err,
          );
        }
      } else {
        // server exists — if semantic version differs, try to push latest version
        const serverLatestVer = serverMatch.latestVersion?.semanticVersion;
        if (localLatest && localLatest.semanticVersion !== serverLatestVer) {
          try {
            await browserApiCall<{ version: PromptVersionSummary }>(
              `/prompts/${serverMatch.id}/versions`,
              {
                method: "POST",
                body: JSON.stringify({
                  body: localLatest.body,
                  semanticVersion: localLatest.semanticVersion,
                }),
              },
            );
            // after pushing, remove local prompt
            inMemoryStore.prompts = inMemoryStore.prompts.filter(
              (p) => p.id !== localPrompt.id,
            );
            saveStore();
          } catch (err) {
            console.warn(
              "trySyncToServer: failed to push version to server",
              err,
            );
          }
        } else {
          // nothing to sync, remove local prompt to avoid duplicate attempts
          inMemoryStore.prompts = inMemoryStore.prompts.filter(
            (p) => p.id !== localPrompt.id,
          );
          saveStore();
        }
      }
    }
  } catch (err) {
    // server still unreachable — we'll keep retrying
    console.debug("trySyncToServer: server unreachable", err);
  }
}

function startBackgroundPoll(): void {
  if (isTauriAvailable()) return;
  // initial load
  loadStore();

  // quick check to set initial fallback state
  (async () => {
    try {
      await browserApiCall<{ prompts: unknown[] }>("/prompts");
      // server reachable
      notifyFallback(false);
    } catch (err) {
      // keep the error variable used so linters don't complain and retain a debug trace
      console.debug("startBackgroundPoll initial check failed", err);
      notifyFallback(true);
    }
  })();

  setInterval(async () => {
    try {
      await browserApiCall<{ prompts: unknown[] }>("/prompts");
      // server reachable — attempt sync if we were in fallback mode
      if (fallbackActive) {
        await trySyncToServer();
        notifyFallback(false);
      }
    } catch (err) {
      console.debug("startBackgroundPoll periodic check failed", err);
      notifyFallback(true);
    }
  }, 5000);
}

// start polling immediately in browser/dev mode
if (typeof window !== "undefined" && !isTauriAvailable()) {
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
    category: p.category,
    isFavorite: p.isFavorite,
    rating: p.rating ?? null,
    tags: p.tags,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    latestVersion: p.versions.length
      ? p.versions[p.versions.length - 1]
      : undefined,
  }));
}

function createPromptInMemory(input: CreatePromptInput): Summary {
  const id = makeId("p");
  const createdAt = nowIso();
  const versionId = makeId("v");
  const version: Version = {
    id: versionId,
    semanticVersion: input.semanticVersion,
    changelog: input.changelog ?? null,
    createdAt,
    updatedAt: createdAt,
    body: input.body,
  };

  const prompt: InMemoryPrompt = {
    id,
    slug: input.slug,
    title: input.title,
    description: input.description,
    category: input.category,
    isFavorite: input.isFavorite ?? false,
    rating: input.rating ?? null,
    tags: input.tags || [],
    createdAt,
    updatedAt: createdAt,
    latestVersion: version,
    versions: [version],
  };

  const insertionIndex = inMemoryStore.prompts.length;
  inMemoryStore.prompts.push(prompt);
  persistStoreOrRollback(() => {
    inMemoryStore.prompts.splice(insertionIndex, 1);
  });
  notifyFallback(true);
  return {
    id: prompt.id,
    slug: prompt.slug,
    title: prompt.title,
    description: prompt.description,
    category: prompt.category,
    isFavorite: prompt.isFavorite,
    rating: prompt.rating ?? null,
    tags: prompt.tags,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    latestVersion: version,
  };
}

function addPromptVersionInMemory(input: AddPromptVersionInput): Version {
  const prompt = inMemoryStore.prompts.find((p) => p.id === input.promptId);
  if (!prompt) throw new Error(`Prompt not found: ${input.promptId}`);
  const previousVersions = [...prompt.versions];
  const previousLatestVersion = prompt.latestVersion;
  const previousUpdatedAt = prompt.updatedAt;
  const createdAt = nowIso();
  const v: Version = {
    id: makeId("v"),
    semanticVersion: input.semanticVersion,
    changelog: input.changelog ?? null,
    createdAt,
    updatedAt: createdAt,
    body: input.body,
  };
  prompt.versions.push(v);
  prompt.latestVersion = v;
  prompt.updatedAt = v.updatedAt;
  persistStoreOrRollback(() => {
    prompt.versions.splice(
      0,
      prompt.versions.length,
      ...previousVersions,
    );
    prompt.latestVersion = previousLatestVersion;
    prompt.updatedAt = previousUpdatedAt;
  });
  notifyFallback(true);
  return v;
}

function listPromptVersionsFromMemory(promptId: string): Version[] {
  loadStore();
  const prompt = inMemoryStore.prompts.find((p) => p.id === promptId);
  if (!prompt) throw new Error(`Prompt not found: ${promptId}`);
  return [...prompt.versions].slice().reverse();
}

function deletePromptFromMemory(promptId: string): void {
  loadStore();
  const promptIndex = inMemoryStore.prompts.findIndex(
    (prompt) => prompt.id === promptId,
  );
  if (promptIndex === -1) {
    throw new Error(`Prompt not found: ${promptId}`);
  }
  const [deletedPrompt] = inMemoryStore.prompts.splice(promptIndex, 1);
  persistStoreOrRollback(() => {
    inMemoryStore.prompts.splice(promptIndex, 0, deletedPrompt);
  });
  notifyFallback(true);
}

function updatePromptInMemory(input: UpdatePromptInput): Summary {
  const prompt = inMemoryStore.prompts.find((p) => p.id === input.id);
  if (!prompt) throw new Error(`Prompt not found: ${input.id}`);
  const previous = {
    title: prompt.title,
    description: prompt.description,
    category: prompt.category,
    isFavorite: prompt.isFavorite,
    rating: prompt.rating,
    tags: [...prompt.tags],
    updatedAt: prompt.updatedAt,
    latestVersion: prompt.latestVersion,
  };
  if (input.title !== undefined) prompt.title = input.title;
  if (input.description !== undefined) prompt.description = input.description;
  if (input.category !== undefined) {
    prompt.category = input.category?.trim() || undefined;
  }
  if (input.isFavorite !== undefined) prompt.isFavorite = input.isFavorite;
  if (input.rating !== undefined) prompt.rating = input.rating;
  if (input.tags !== undefined) prompt.tags = input.tags;
  prompt.updatedAt = nowIso();
  prompt.latestVersion = prompt.versions.length
    ? prompt.versions[prompt.versions.length - 1]
    : undefined;
  persistStoreOrRollback(() => {
    Object.assign(prompt, previous);
  });
  notifyFallback(true);
  return {
    id: prompt.id,
    slug: prompt.slug,
    title: prompt.title,
    description: prompt.description,
    category: prompt.category,
    isFavorite: prompt.isFavorite,
    rating: prompt.rating ?? null,
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
    return response.prompts.map((prompt) => normalizePromptSummary(prompt));
  } else {
    // Use HTTP API with graceful fallback to in-memory store
    try {
      const response = await browserApiCall<{ prompts: unknown[] }>(
        "/prompts?page=0&pageSize=100",
      );
      return response.prompts.map((prompt) => normalizePromptSummary(prompt));
    } catch (err: unknown) {
      // network / connection refused -> fall back to in-memory
      console.warn(
        "listPrompts: HTTP API failed, using in-memory fallback",
        err,
      );
      notifyFallback(true);
      return listPromptsFromMemory();
    }
  }
}

/**
 * Resolves an edit-route prompt through the shared list contract so web and
 * Tauri keep one UI path. The browser API list is currently capped at 100
 * prompts; a dedicated cross-platform read endpoint can remove that limit.
 */
export async function getPromptById(
  promptId: string,
): Promise<PromptSummary | undefined> {
  const prompts = await listPrompts();
  return prompts.find((prompt) => prompt.id === promptId);
}

export async function searchPrompts(
  input: SearchPromptsInput,
): Promise<PromptSummary[]> {
  const page = input.page ?? 0;
  const pageSize = input.pageSize ?? 100;

  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ prompts: PromptSummary[] }>(
      "search_prompts",
      {
        payload: {
          text: input.text ?? "",
          tag: input.tag ?? "",
          category: input.category ?? "",
          projectTagId: input.projectTagId ?? "",
          page,
          pageSize,
        },
      },
    );

    return response.prompts;
  }

  try {
    const params = new URLSearchParams();
    if (input.text && input.text.trim()) params.set("text", input.text.trim());
    if (input.tag && input.tag.trim()) params.set("tags", input.tag.trim());
    if (input.category && input.category.trim())
      params.set("category", input.category.trim());
    if (input.projectTagId && input.projectTagId.trim())
      params.set("projectTagId", input.projectTagId.trim());
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    const response = await browserApiCall<{ prompts: unknown[] }>(
      `/prompts?${params.toString()}`,
    );
    return response.prompts.map((prompt) => normalizePromptSummary(prompt));
  } catch (err: unknown) {
    console.warn(
      "searchPrompts: HTTP API failed, using in-memory fallback",
      err,
    );
    notifyFallback(true);
    // fallback is client-side filtering over memory store
    const all = listPromptsFromMemory();
    const normalizedText = input.text?.toLowerCase().trim();
    return all.filter((prompt) => {
      if (input.tag && input.tag.trim()) {
        if (
          !prompt.tags.some(
            (tag) => tag.toLowerCase() === input.tag?.toLowerCase().trim(),
          )
        )
          return false;
      }
      if (input.category && input.category.trim()) {
        if (
          (prompt.category ?? "").toLowerCase() !==
          input.category.toLowerCase().trim()
        )
          return false;
      }
      // projectTagId filtering is not supported in the in-memory fallback store
      if (normalizedText) {
        const title = prompt.title?.toLowerCase() ?? "";
        const desc = prompt.description?.toLowerCase() ?? "";
        const cat = prompt.category?.toLowerCase() ?? "";
        const tags = prompt.tags.join(" ").toLowerCase();
        const body = prompt.latestVersion?.body?.toLowerCase() ?? "";
        return (
          title.includes(normalizedText) ||
          desc.includes(normalizedText) ||
          cat.includes(normalizedText) ||
          tags.includes(normalizedText) ||
          body.includes(normalizedText)
        );
      }
      return true;
    });
  }
}

export async function exportPromptBundle(
  input: ExportPromptBundleInput,
): Promise<string> {
  const params = new URLSearchParams();
  params.set("format", input.format);
  if (input.promptIds && input.promptIds.length > 0) {
    params.set("ids", input.promptIds.join(","));
  }
  if (typeof input.includeMetadata === "boolean") {
    params.set("includeMetadata", String(input.includeMetadata));
  }

  // Prefer HTTP endpoint (works in web-mode; may also work in desktop runtime when server is running)
  return browserApiCallText(`/bundles/prompts?${params.toString()}`);
}

export async function importPromptBundle(
  input: ImportPromptBundleInput,
): Promise<{ imported: number; skipped: number }> {
  const response = await browserApiCall<{ imported: number; skipped: number }>(
    "/bundles/prompts/import",
    {
      method: "POST",
      body: JSON.stringify({
        format: input.format,
        content: input.content,
        conflictStrategy: input.conflictStrategy,
      }),
    },
  );
  return response;
}

export async function createPrompt(
  input: CreatePromptInput,
): Promise<PromptSummary> {
  if (isTauriAvailable()) {
    // Use Tauri API
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ prompt: PromptSummary }>("create_prompt", {
      payload: input,
    });
    return normalizePromptSummary(response.prompt);
  } else {
    try {
      const response = await browserApiCall<{ prompt: unknown }>(
        "/prompts",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return normalizePromptSummary(response.prompt);
    } catch (err: unknown) {
      console.warn(
        "createPrompt: HTTP API failed, creating prompt in-memory",
        err,
      );
      return createPromptInMemory(input);
    }
  }
}

export async function addPromptVersion(
  input: AddPromptVersionInput,
): Promise<PromptVersionSummary> {
  if (isTauriAvailable()) {
    // Use Tauri API
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ version: PromptVersionSummary }>(
      "add_prompt_version",
      { payload: input },
    );
    return response.version;
  } else {
    try {
      const response = await browserApiCall<{ version: PromptVersionSummary }>(
        `/prompts/${input.promptId}/versions`,
        {
          method: "POST",
          body: JSON.stringify({
            body: input.body,
            semanticVersion: input.semanticVersion,
            changelog: input.changelog,
          }),
        },
      );
      return response.version;
    } catch (err: unknown) {
      console.warn(
        "addPromptVersion: HTTP API failed, adding version in-memory",
        err,
      );
      return addPromptVersionInMemory(input);
    }
  }
}

export async function updatePrompt(
  input: UpdatePromptInput,
): Promise<PromptSummary> {
  if (isTauriAvailable()) {
    // Use Tauri API
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ prompt: PromptSummary }>("update_prompt", {
      payload: input,
    });
    return normalizePromptSummary(response.prompt);
  } else {
    try {
      const response = await browserApiCall<{ prompt: unknown }>(
        `/prompts/${input.id}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
      return normalizePromptSummary(response.prompt);
    } catch (err: unknown) {
      console.warn("updatePrompt: HTTP API failed, updating in-memory", err);
      return updatePromptInMemory(input);
    }
  }
}

export async function listPromptVersions(
  promptId: string,
): Promise<PromptVersionSummary[]> {
  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ versions: PromptVersionSummary[] }>(
      "list_prompt_versions",
      {
        payload: { promptId },
      },
    );
    return response.versions;
  }

  try {
    const response = await browserApiCall<{ versions: PromptVersionSummary[] }>(
      `/prompts/${promptId}/versions`,
    );
    return response.versions;
  } catch (err: unknown) {
    console.warn(
      "listPromptVersions: HTTP API failed, using in-memory fallback",
      err,
    );
    notifyFallback(true);
    return listPromptVersionsFromMemory(promptId);
  }
}

export async function deletePrompt(promptId: string): Promise<void> {
  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("delete_prompt", {
      payload: { promptId },
    });
    return;
  }

  try {
    await browserApiCallVoid(`/prompts/${promptId}`, { method: "DELETE" });
  } catch (err: unknown) {
    console.warn("deletePrompt: HTTP API failed, deleting in-memory", err);
    deletePromptFromMemory(promptId);
  }
}

function memoryRecoveryLibrary(): RecoveryLibraryPrompt[] {
  loadStore();
  return inMemoryStore.prompts.map((prompt) => ({
    id: prompt.id,
    sourceId: prompt.id,
    slug: prompt.slug.trim().toLowerCase(),
    title: prompt.title,
    description: prompt.description ?? null,
    category: prompt.category ?? null,
    isFavorite: prompt.isFavorite,
    rating: prompt.rating ?? null,
    tags: [...prompt.tags],
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    versions: prompt.versions.map((version) => ({
      sourceId: version.id,
      semanticVersion: version.semanticVersion,
      body: version.body,
      bodyHash: sha256(version.body),
      changelog: version.changelog ?? null,
      createdAt: version.createdAt ?? version.updatedAt,
      updatedAt: version.updatedAt,
    })),
  }));
}

export async function getRecoveryLibrary(): Promise<RecoveryLibraryPrompt[]> {
  if (!isTauriAvailable() && fallbackActive) return memoryRecoveryLibrary();
  const prompts = await listPrompts();
  return Promise.all(
    prompts.map(async (prompt): Promise<RecoveryLibraryPrompt> => {
      const versions = await listPromptVersions(prompt.id);
      return {
        id: prompt.id,
        sourceId: prompt.id,
        slug: prompt.slug.trim().toLowerCase(),
        title: prompt.title,
        description: prompt.description ?? null,
        category: prompt.category ?? null,
        isFavorite: prompt.isFavorite,
        rating: prompt.rating ?? null,
        tags: [...prompt.tags],
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
        versions: versions.map((version) => ({
          sourceId: version.id,
          semanticVersion: version.semanticVersion,
          body: version.body,
          bodyHash: sha256(version.body),
          changelog: version.changelog ?? null,
          createdAt: version.createdAt ?? version.updatedAt,
          updatedAt: version.updatedAt,
        })),
      };
    }),
  );
}

export async function exportVerifiedBackup(exportedAt = new Date().toISOString()): Promise<{
  content: string;
  verification: ReturnType<typeof verifyBackupExport>;
}> {
  const document = buildBackupDocumentV2(await getRecoveryLibrary(), exportedAt);
  const verification = verifyBackupExport(document);
  if (!verification.verified) {
    throw new Error(`Backup verification failed: ${verification.errors.join(" ")}`);
  }
  return { content: serializeBackupDocument(document), verification };
}

export async function previewBackupRestore(content: string): Promise<{
  validation: BackupValidationResult;
  plan?: RestorePlan;
}> {
  const validation = parseBackupText(content);
  if (!validation.valid || !validation.document) return { validation };
  const current = await getRecoveryLibrary();
  return {
    validation,
    plan: buildRestorePlan(validation.document, current),
  };
}

function addDocumentPromptToMemory(
  prompt: RecoveryDocument["prompts"][number],
  slug: string,
  title: string,
): void {
  const id = makeId("p");
  const versions: Version[] = prompt.versions.map((version) => ({
    id: makeId("v"),
    semanticVersion: version.semanticVersion,
    body: version.body,
    changelog: version.changelog,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  }));
  inMemoryStore.prompts.push({
    id,
    slug,
    title,
    description: prompt.description ?? undefined,
    category: prompt.category ?? undefined,
    isFavorite: prompt.isFavorite,
    rating: prompt.rating,
    tags: [...prompt.tags],
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    latestVersion: versions.at(-1),
    versions,
  });
}

function executeMemoryRestore(
  document: RecoveryDocument,
  plan: RestorePlan,
  policy: RestorePolicy,
): RestoreResult {
  const current = memoryRecoveryLibrary();
  if (
    fingerprintRecoveryDocument(document) !== plan.documentFingerprint ||
    !planMatches(plan, document, current)
  ) {
    throw new Error("The source or current library changed after preview. Create a new preview.");
  }
  const snapshot = JSON.stringify(inMemoryStore);
  const sourceBySlug = new Map(document.prompts.map((prompt) => [prompt.slug, prompt]));
  let newPrompts = 0;
  let copiedPrompts = 0;
  let mergedVersions = 0;
  let skippedPrompts = 0;
  let skippedVersions = 0;
  try {
    for (const entry of plan.entries) {
      const source = sourceBySlug.get(entry.sourceSlug);
      if (!source) throw new Error("Restore plan source is missing.");
      if (entry.kind === "new-prompt") {
        addDocumentPromptToMemory(source, source.slug, source.title);
        newPrompts += 1;
        continue;
      }
      if (policy === "skip-existing") {
        skippedPrompts += 1;
        skippedVersions += source.versions.length;
        continue;
      }
      if (policy === "import-as-copy") {
        if (!entry.copySlug || !entry.copyTitle) throw new Error("Restore copy target is missing.");
        addDocumentPromptToMemory(source, entry.copySlug, entry.copyTitle);
        copiedPrompts += 1;
        continue;
      }
      const target = inMemoryStore.prompts.find((prompt) => prompt.id === entry.currentPromptId);
      if (!target) throw new Error("Restore merge target is missing.");
      const missing = new Set(entry.missingVersionIdentities);
      for (const version of source.versions) {
        if (!missing.has(versionIdentity(version))) {
          skippedVersions += 1;
          continue;
        }
        target.versions.push({
          id: makeId("v"),
          semanticVersion: version.semanticVersion,
          body: version.body,
          changelog: version.changelog,
          createdAt: version.createdAt,
          updatedAt: version.updatedAt,
        });
        mergedVersions += 1;
      }
      target.versions.sort((left, right) =>
        (left.createdAt ?? left.updatedAt).localeCompare(right.createdAt ?? right.updatedAt),
      );
      target.latestVersion = target.versions.at(-1);
      target.updatedAt = target.versions.reduce(
        (latest, version) => (version.updatedAt > latest ? version.updatedAt : latest),
        target.updatedAt,
      );
      if (entry.missingVersionIdentities.length === 0) skippedPrompts += 1;
    }
    if (!saveStore()) throw new Error(STORAGE_PERSISTENCE_ERROR);
  } catch (error) {
    const parsed = JSON.parse(snapshot) as { prompts: InMemoryPrompt[] };
    inMemoryStore.prompts = parsed.prompts;
    throw error;
  }
  notifyFallback(true);
  return {
    sourceFormat: document.sourceVersion,
    policy,
    newPrompts,
    copiedPrompts,
    mergedVersions,
    skippedPrompts,
    skippedVersions,
    invalidRecords: 0,
    warnings: plan.warnings,
    integrityResult: "unavailable",
    foreignKeyViolationCount: 0,
  };
}

export async function executeBackupRestore(input: {
  content: string;
  plan: RestorePlan;
  policy: RestorePolicy;
}): Promise<RestoreResult> {
  const validation = parseBackupText(input.content);
  if (!validation.valid || !validation.document) {
    throw new Error(validation.errors.join(" ") || "Backup validation failed.");
  }
  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<RestoreResult>("execute_backup_restore", {
      payload: {
        document: validation.document,
        plan: input.plan,
        policy: input.policy,
      },
    });
  }
  try {
    return await browserApiCall<RestoreResult>("/recovery/execute", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof PromptVaultApiError) throw error;
    return executeMemoryRestore(validation.document, input.plan, input.policy);
  }
}

export async function getStorageStatus(integrityRequested = false): Promise<StorageStatus> {
  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<StorageStatus>("get_storage_status", { integrityRequested });
  }
  try {
    return await browserApiCall<StorageStatus>(
      `/storage/status?integrity=${String(integrityRequested)}`,
    );
  } catch {
    return {
      runtime: "browser-fallback",
      storage: "localStorage",
      databasePath: null,
      databaseExists: null,
      databaseSize: null,
      sqliteUserVersion: null,
      promptCount: inMemoryStore.prompts.length,
      versionCount: inMemoryStore.prompts.reduce(
        (count, prompt) => count + prompt.versions.length,
        0,
      ),
      tagCount: null,
      relationshipCount: null,
      walExists: null,
      walSize: null,
      shmExists: null,
      shmSize: null,
      integrityStatus: "unavailable",
      nativeSqliteAvailable: false,
      legacyRecoveryAvailable: false,
      plaintextWarning: "Browser fallback stores plaintext prompt data in localStorage.",
    };
  }
}

export async function inspectLegacySource(): Promise<LegacySourceStatus> {
  if (!isTauriAvailable()) throw new Error("Legacy database recovery is available only in the native Windows app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LegacySourceStatus>("inspect_legacy_database");
}

export async function previewLegacyRestore(): Promise<{
  preview: LegacyRecoveryPreview;
  plan: RestorePlan;
}> {
  if (!isTauriAvailable()) throw new Error("Legacy database recovery is available only in the native Windows app.");
  const { invoke } = await import("@tauri-apps/api/core");
  const preview = await invoke<LegacyRecoveryPreview>("preview_legacy_recovery");
  const plan = buildRestorePlan(preview.document, await getRecoveryLibrary());
  return { preview, plan };
}

export async function executeLegacyRestore(input: {
  sourceHash: string;
  plan: RestorePlan;
  policy: RestorePolicy;
}): Promise<RestoreResult> {
  if (!isTauriAvailable()) throw new Error("Legacy database recovery is available only in the native Windows app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RestoreResult>("execute_legacy_restore", { payload: input });
}
