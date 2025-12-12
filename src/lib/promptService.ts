import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Prompt } from "../domain/models.js";
import { buildPlannerBucketDraft, type PlannerBucketDraft } from "../domain/interop.js";
import { renderTemplate, templateVariablesSchema, type TemplateVariables } from "../domain/templating.js";
import { PromptVaultService } from "../services/PromptVaultService.js";
import {
  createProjectTag,
  getProjectTagBySlug,
  listTagsForEntity,
  tagPrompt,
  untagPrompt,
} from "@nw/tags-projects";

type CreatePromptParams = Parameters<PromptVaultService["createPrompt"]>[0];
type UpdatePromptParams = Parameters<PromptVaultService["updatePrompt"]>[1];

export interface PromptFilters {
  projectSlug?: string;
  tags?: string[];
  query?: string;
}

export interface PromptInput {
  title: string;
  body: string;
  projectSlug?: string;
  tags?: string[];
}

export interface PromptImportItem extends PromptInput {}

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

export async function listPrompts(filters: PromptFilters = {}): Promise<Prompt[]> {
  const service = getService();

  let projectTagId: string | undefined;
  if (filters.projectSlug) {
    const projectTag = await getProjectTagBySlug(filters.projectSlug);
    if (!projectTag) {
      return [];
    }
    projectTagId = projectTag.id;
  }

  // Use the service's search capability which handles text and tags
  const searchResult = await service.searchPrompts({
    text: filters.query,
    tags: filters.tags,
    page: 0,
    pageSize: 100, // Reasonable default limit
    projectTagId,
  });

  return [...searchResult.prompts];
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
    tags: input.tags ?? [],
    changelog: "Created via orchestrator",
  } as CreatePromptParams);

  if (input.projectSlug) {
    const projectTagId = await ensureProjectTagId(input.projectSlug);
    await tagPrompt(created.id, projectTagId);
  }

  return created;
}

export async function updatePrompt(id: string, patch: Partial<PromptInput>): Promise<Prompt | null> {
  const service = getService();

  try {
    if (patch.title || patch.body || patch.tags) {
      const updateData: Partial<UpdatePromptParams> = {};
      if (patch.title) updateData.title = patch.title;
      if (patch.tags) updateData.tags = patch.tags;

      if (Object.keys(updateData).length > 0) {
        await service.updatePrompt(id, updateData);
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

/**
 * Execute a prompt template with variable substitution.
 * Returns rendered text plus missing-variable info for UX/tools.
 */
export function executePromptTemplate(
  template: string,
  variables: Record<string, unknown> = {}
): ReturnType<typeof renderTemplate> {
  const parsed = templateVariablesSchema.parse(variables) as TemplateVariables;
  return renderTemplate(template, parsed);
}

/**
 * Build a Planner bucket draft payload from Prompt Vault content.
 */
export async function exportPlannerDraft(
  filters: PromptFilters = {},
  limit = 10
): Promise<PlannerBucketDraft | null> {
  const prompts = await listPrompts(filters);
  return buildPlannerBucketDraft(prompts, limit);
}

/**
 * Bulk-import prompts into Prompt Vault.
 * Returns both created prompts and any failures for telemetry/reporting.
 */
export async function importPrompts(items: readonly PromptImportItem[]): Promise<{
  created: Prompt[];
  failed: Array<{ title: string; reason: string }>;
}> {
  const created: Prompt[] = [];
  const failed: Array<{ title: string; reason: string }> = [];

  for (const item of items) {
    try {
      const prompt = await createPrompt({
        title: item.title,
        body: item.body,
        tags: item.tags,
        projectSlug: item.projectSlug,
      });
      created.push(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ title: item.title, reason: message });
    }
  }

  return { created, failed };
}
