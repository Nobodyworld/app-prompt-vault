import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Prompt } from "../domain/models.js";
import { PromptVaultService } from "../services/PromptVaultService.js";
import {
  createProjectTag,
  getProjectTagBySlug,
  listEntitiesByTags,
  listEntitiesWithProject,
  listTagsForEntity,
  tagPrompt,
  untagPrompt,
} from "@nw/tags-projects";

export interface PromptFilters {
  projectSlug?: string;
  tagIds?: string[];
  query?: string;
}

export interface PromptInput {
  title: string;
  body: string;
  projectSlug?: string;
  tagIds?: string[];
}

let serviceInstance: PromptVaultService | null = null;

/**
 * Test hook to inject a PromptVaultService instance.
 * When set, the injected instance will be used instead of creating a new one.
 */
export function setPromptVaultServiceForTests(service: PromptVaultService | null): void {
  serviceInstance = service;
}

function getDefaultDatabasePath(): string {
  const envPath = process.env.PROMPT_VAULT_DB_PATH;
  if (envPath && envPath.trim().length > 0) {
    return envPath;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "prompt-vault.db");
}

function getService(): PromptVaultService {
  if (serviceInstance) {
    return serviceInstance;
  }

  const dbPath = getDefaultDatabasePath();
  const database = new Database(dbPath);
  serviceInstance = new PromptVaultService(database);
  return serviceInstance;
}

function generateSlugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

async function ensureProjectTagId(projectSlug: string): Promise<string> {
  const existing = await getProjectTagBySlug(projectSlug);
  if (existing) {
    return existing.id;
  }
  const created = await createProjectTag({ slug: projectSlug, label: projectSlug });
  return created.id;
}

async function syncPromptTags(promptId: string, tagIds: string[] | undefined): Promise<void> {
  if (!tagIds) {
    return;
  }

  const existingTags = await listTagsForEntity({ entityType: "prompts", entityId: promptId });
  const existingIds = new Set(existingTags.map((tag) => tag.id));
  const desiredIds = new Set(tagIds);

  const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));

  for (const tagId of toAdd) {
    await tagPrompt(promptId, tagId);
  }

  for (const tagId of toRemove) {
    await untagPrompt(promptId, tagId);
  }
}

export async function listPrompts(filters: PromptFilters = {}): Promise<Prompt[]> {
  const service = getService();

  let filteredIds: Set<string> | null = null;

  if (filters.projectSlug) {
    const ids = await listEntitiesWithProject({
      entityType: "prompts",
      projectSlug: filters.projectSlug,
    });
    filteredIds = new Set(ids);
  }

  if (filters.tagIds && filters.tagIds.length > 0) {
    const ids = await listEntitiesByTags({
      entityType: "prompts",
      tagIds: filters.tagIds,
      match: "any",
    });
    const tagSet = new Set(ids);
    filteredIds = filteredIds
      ? new Set([...filteredIds].filter((id) => tagSet.has(id)))
      : tagSet;
  }

  const text = filters.query?.trim();
  let prompts: Prompt[];

  if (text) {
    const result = await service.searchPrompts({
      text,
      page: 0,
      pageSize: 50,
    } as any);
    prompts = [...result.prompts];
  } else if (filteredIds) {
    prompts = await Promise.all([...filteredIds].map((id) => service.getPrompt(id)));
  } else {
    prompts = await service.listAllPrompts() as Prompt[];
  }

  if (filteredIds) {
    prompts = prompts.filter((prompt) => filteredIds!.has(prompt.id));
  }

  return prompts;
}

export async function getPrompt(id: string): Promise<Prompt | null> {
  const service = getService();
  try {
    return await service.getPrompt(id);
  } catch {
    return null;
  }
}

export async function createPrompt(input: PromptInput): Promise<Prompt> {
  const service = getService();

  const id = randomUUID();
  const slug = generateSlugFromTitle(input.title);

  const created = await service.createPrompt({
    id,
    slug,
    title: input.title,
    description: undefined,
    category: undefined,
    body: input.body,
    format: "markdown",
    semanticVersion: "1.0.0",
    tags: [],
    changelog: "Created via orchestrator",
  } as any);

  if (input.projectSlug) {
    const projectTagId = await ensureProjectTagId(input.projectSlug);
    await tagPrompt(created.id, projectTagId);
  }

  if (input.tagIds && input.tagIds.length > 0) {
    await syncPromptTags(created.id, input.tagIds);
  }

  return created;
}

export async function updatePrompt(id: string, patch: Partial<PromptInput>): Promise<Prompt | null> {
  const service = getService();

  try {
    if (patch.title || patch.body) {
      if (patch.title) {
        await service.updatePrompt(id, { title: patch.title });
      }

      if (patch.body) {
        const existing = await service.getPrompt(id);
        const currentVersion = existing.latestVersion?.semanticVersion ?? "1.0.0";
        const parts = currentVersion.split(".").map((part) => Number.parseInt(part, 10) || 0);
        const nextVersion = [parts[0], parts[1], (parts[2] ?? 0) + 1].join(".");
        service.addVersion(id, patch.body, nextVersion, "markdown");
      }
    }

    if (patch.projectSlug) {
      const projectTagId = await ensureProjectTagId(patch.projectSlug);
      await tagPrompt(id, projectTagId);
    }

    if (patch.tagIds) {
      await syncPromptTags(id, patch.tagIds);
    }

    return await service.getPrompt(id);
  } catch {
    return null;
  }
}

export async function deletePrompt(id: string): Promise<void> {
  const service = getService();

  try {
    const existingTags = await listTagsForEntity({ entityType: "prompts", entityId: id });
    for (const tag of existingTags) {
      await untagPrompt(id, tag.id);
    }
  } catch {
    // Ignore tag cleanup errors; prompt deletion should still proceed.
  }

  try {
    service.permanentlyDeletePrompt(id);
  } catch {
    // If permanent delete fails, attempt a soft delete as a fallback.
    try {
      service.softDeletePrompt(id);
    } catch {
      // Ignore failures; callers treat delete as best-effort.
    }
  }
}

