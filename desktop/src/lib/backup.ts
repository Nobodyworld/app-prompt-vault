import type { CreatePromptInput, PromptSummary } from "../types/prompt";

export interface BackupPrompt {
  id?: string;
  slug: string;
  title: string;
  description?: string | null;
  category?: string | null;
  isFavorite?: boolean;
  rating?: number | null;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  body: string;
  version?: string;
}

export interface BackupExport {
  version: "1.0";
  exportedAt: string;
  prompts: BackupPrompt[];
}

export function buildBackupExport(
  prompts: PromptSummary[],
  exportedAt = new Date().toISOString(),
): BackupExport {
  return {
    version: "1.0",
    exportedAt,
    prompts: prompts.map((prompt) => ({
      id: prompt.id,
      slug: prompt.slug,
      title: prompt.title,
      description: prompt.description ?? null,
      category: prompt.category ?? null,
      isFavorite: prompt.isFavorite,
      rating: prompt.rating ?? null,
      tags: prompt.tags,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
      body: prompt.latestVersion?.body ?? "",
      version: prompt.latestVersion?.semanticVersion ?? "1.0.0",
    })),
  };
}

export function isBackupPrompt(value: unknown): value is BackupPrompt {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.slug === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.body === "string" &&
    (candidate.description === undefined ||
      candidate.description === null ||
      typeof candidate.description === "string") &&
    (candidate.category === undefined ||
      candidate.category === null ||
      typeof candidate.category === "string") &&
    (candidate.isFavorite === undefined ||
      typeof candidate.isFavorite === "boolean") &&
    (candidate.rating === undefined ||
      candidate.rating === null ||
      (typeof candidate.rating === "number" &&
        Number.isInteger(candidate.rating) &&
        candidate.rating >= 1 &&
        candidate.rating <= 5)) &&
    (candidate.version === undefined || typeof candidate.version === "string") &&
    (candidate.tags === undefined ||
      (Array.isArray(candidate.tags) &&
        candidate.tags.every((tag) => typeof tag === "string")))
  );
}

export function backupPromptToCreateInput(
  candidate: BackupPrompt,
): CreatePromptInput {
  return {
    slug: candidate.slug,
    title: candidate.title,
    description: candidate.description ?? undefined,
    category: candidate.category ?? undefined,
    isFavorite: candidate.isFavorite ?? false,
    rating: candidate.rating ?? null,
    tags: candidate.tags ?? [],
    body: candidate.body,
    semanticVersion: candidate.version ?? "1.0.0",
  };
}
