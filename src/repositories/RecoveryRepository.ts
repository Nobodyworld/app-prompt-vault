import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { generateIntegrityChecksum } from "../lib/platform-core.js";
import {
  fingerprintRecoveryDocument,
  planMatches,
  versionIdentity,
  type RecoveryDocument,
  type RecoveryLibraryPrompt,
  type RecoveryPrompt,
  type RecoveryVersion,
  type RestorePlan,
  type RestorePolicy,
  type RestoreResult,
} from "../domain/recovery.js";

export type RecoveryFailurePoint =
  | "prompt-insertion"
  | "version-insertion"
  | "tag-insertion"
  | "relationship-insertion"
  | "copy-creation"
  | "version-merge";

interface PromptRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly category: string | null;
  readonly is_favorite: number;
  readonly rating: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface VersionRow {
  readonly id: string;
  readonly prompt_id: string;
  readonly semantic_version: string;
  readonly body: string;
  readonly changelog: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function throwAt(point: RecoveryFailurePoint | undefined, expected: RecoveryFailurePoint): void {
  if (point === expected) throw new Error(`Injected recovery failure after ${expected}`);
}

export function readRecoveryLibrary(
  database: Database.Database,
  tagOverrides: ReadonlyMap<string, readonly string[]> = new Map(),
): RecoveryLibraryPrompt[] {
  const prompts = database
    .prepare(
      `SELECT id, slug, title, description, category, is_favorite, rating, created_at, updated_at
       FROM prompts
       WHERE deleted_at IS NULL
       ORDER BY LOWER(slug), id`,
    )
    .all() as PromptRow[];
  const versionStatement = database.prepare(
    `SELECT id, prompt_id, semantic_version, body, changelog, created_at, updated_at
     FROM prompt_versions
     WHERE prompt_id = ?
     ORDER BY datetime(created_at), rowid`,
  );
  const tagStatement = database.prepare(
    `SELECT t.label
     FROM tags t
     JOIN prompt_tags pt ON pt.tag_id = t.id
     WHERE pt.prompt_id = ?
     ORDER BY LOWER(t.label), t.label`,
  );
  return prompts.map((prompt) => {
    const versions = (versionStatement.all(prompt.id) as VersionRow[]).map(
      (version): RecoveryVersion => ({
        sourceId: version.id,
        semanticVersion: version.semantic_version,
        body: version.body,
        bodyHash: generateIntegrityChecksum(version.body),
        changelog: version.changelog,
        createdAt: new Date(version.created_at).toISOString(),
        updatedAt: new Date(version.updated_at).toISOString(),
      }),
    );
    const storedTags = (tagStatement.all(prompt.id) as { label: string }[]).map(
      (row) => row.label,
    );
    const tags = [
      ...new Map(
        [...storedTags, ...(tagOverrides.get(prompt.id) ?? [])].map((tag) => [
          tag.toLowerCase(),
          tag,
        ]),
      ).values(),
    ].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
    return {
      id: prompt.id,
      sourceId: prompt.id,
      slug: prompt.slug.trim().toLowerCase(),
      title: prompt.title ?? "",
      description: prompt.description,
      category: prompt.category,
      isFavorite: prompt.is_favorite !== 0,
      rating: prompt.rating,
      tags,
      createdAt: new Date(prompt.created_at).toISOString(),
      updatedAt: new Date(prompt.updated_at).toISOString(),
      versions,
    };
  });
}

function insertPrompt(
  database: Database.Database,
  source: RecoveryPrompt,
  slug: string,
  title: string,
  failurePoint?: RecoveryFailurePoint,
): string {
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO prompts
       (id, slug, title, description, category, is_favorite, rating, integrity_checksum, created_at, updated_at, deleted_at)
       VALUES (@id, @slug, @title, @description, @category, @isFavorite, @rating, @checksum, @createdAt, @updatedAt, NULL)`,
    )
    .run({
      id,
      slug,
      title,
      description: source.description,
      category: source.category,
      isFavorite: source.isFavorite ? 1 : 0,
      rating: source.rating,
      checksum: generateIntegrityChecksum(JSON.stringify({
        id,
        slug,
        title,
        description: source.description,
        category: source.category,
        isFavorite: source.isFavorite,
        rating: source.rating,
      })),
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    });
  throwAt(failurePoint, "prompt-insertion");
  return id;
}

function insertVersion(
  database: Database.Database,
  promptId: string,
  version: RecoveryVersion,
): void {
  database
    .prepare(
      `INSERT INTO prompt_versions
       (id, prompt_id, semantic_version, body, format, changelog, integrity_checksum, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'markdown', ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      promptId,
      version.semanticVersion,
      version.body,
      version.changelog,
      generateIntegrityChecksum(version.body),
      version.createdAt,
      version.updatedAt,
    );
}

function storeTags(
  database: Database.Database,
  promptId: string,
  tags: readonly string[],
  failurePoint?: RecoveryFailurePoint,
): void {
  const find = database.prepare("SELECT id FROM tags WHERE LOWER(label) = LOWER(?) LIMIT 1");
  const insert = database.prepare(
    "INSERT INTO tags (id, label, description, created_at) VALUES (?, ?, NULL, ?)",
  );
  const link = database.prepare(
    "INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)",
  );
  for (const label of tags) {
    let row = find.get(label) as { id: string } | undefined;
    if (!row) {
      row = { id: randomUUID() };
      insert.run(row.id, label, new Date().toISOString());
      throwAt(failurePoint, "tag-insertion");
    }
    link.run(promptId, row.id);
    throwAt(failurePoint, "relationship-insertion");
  }
}

function insertCompletePrompt(
  database: Database.Database,
  source: RecoveryPrompt,
  slug: string,
  title: string,
  failurePoint?: RecoveryFailurePoint,
): string {
  const id = insertPrompt(database, source, slug, title, failurePoint);
  source.versions.forEach((version, index) => {
    insertVersion(database, id, version);
    if (index === 0) throwAt(failurePoint, "version-insertion");
  });
  storeTags(database, id, source.tags, failurePoint);
  return id;
}

export function executeRecoveryTransaction(input: {
  readonly database: Database.Database;
  readonly document: RecoveryDocument;
  readonly plan: RestorePlan;
  readonly policy: RestorePolicy;
  readonly tagOverrides?: ReadonlyMap<string, readonly string[]>;
  readonly failurePoint?: RecoveryFailurePoint;
}): RestoreResult {
  if (fingerprintRecoveryDocument(input.document) !== input.plan.documentFingerprint) {
    throw new Error("The recovery source changed after preview. Create a new preview.");
  }
  const execute = input.database.transaction((): Omit<RestoreResult, "integrityResult" | "foreignKeyViolationCount"> => {
    const current = readRecoveryLibrary(input.database, input.tagOverrides);
    if (!planMatches(input.plan, input.document, current)) {
      throw new Error("The current library changed after preview. Create a new preview.");
    }
    const sourceBySlug = new Map(input.document.prompts.map((prompt) => [prompt.slug, prompt]));
    let newPrompts = 0;
    let copiedPrompts = 0;
    let mergedVersions = 0;
    let skippedPrompts = 0;
    let skippedVersions = 0;
    for (const entry of input.plan.entries) {
      const source = sourceBySlug.get(entry.sourceSlug);
      if (!source) throw new Error(`Restore plan source is missing: ${entry.sourceSlug}`);
      if (entry.kind === "new-prompt") {
        insertCompletePrompt(input.database, source, source.slug, source.title, input.failurePoint);
        newPrompts += 1;
        continue;
      }
      if (input.policy === "skip-existing") {
        skippedPrompts += 1;
        skippedVersions += source.versions.length;
        continue;
      }
      if (input.policy === "import-as-copy") {
        if (!entry.copySlug || !entry.copyTitle) throw new Error("Restore plan copy target is missing.");
        insertCompletePrompt(input.database, source, entry.copySlug, entry.copyTitle, input.failurePoint);
        throwAt(input.failurePoint, "copy-creation");
        copiedPrompts += 1;
        continue;
      }
      if (!entry.currentPromptId) throw new Error("Restore plan merge target is missing.");
      const missing = new Set(entry.missingVersionIdentities);
      for (const version of source.versions) {
        if (!missing.has(versionIdentity(version))) {
          skippedVersions += 1;
          continue;
        }
        insertVersion(input.database, entry.currentPromptId, version);
        mergedVersions += 1;
        throwAt(input.failurePoint, "version-merge");
      }
      if (entry.missingVersionIdentities.length === 0) skippedPrompts += 1;
      if (entry.missingVersionIdentities.length > 0) {
        const latest = source.versions.reduce(
          (value, version) => (version.updatedAt > value ? version.updatedAt : value),
          "",
        );
        input.database
          .prepare(
            `UPDATE prompts
             SET updated_at = CASE WHEN updated_at > ? THEN updated_at ELSE ? END
             WHERE id = ?`,
          )
          .run(latest, latest, entry.currentPromptId);
      }
    }
    const foreignKeys = input.database.pragma("foreign_key_check") as unknown[];
    const integrity = input.database.pragma("integrity_check", { simple: true }) as string;
    if (integrity !== "ok" || foreignKeys.length > 0) {
      throw new Error("Post-restore SQLite verification failed; the transaction was rolled back.");
    }
    return {
      sourceFormat: input.document.sourceVersion,
      policy: input.policy,
      newPrompts,
      copiedPrompts,
      mergedVersions,
      skippedPrompts,
      skippedVersions,
      invalidRecords: 0,
      warnings: input.plan.warnings,
    };
  });
  const result = execute();
  return {
    ...result,
    integrityResult: "ok",
    foreignKeyViolationCount: 0,
  };
}
