import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { win32 } from "node:path";
import Database from "better-sqlite3";
import {
  buildBackupDocumentV2,
  parseBackupText,
  serializeBackupDocument,
  type RecoveryLibraryPrompt,
} from "../../src/domain/recovery.js";
import { assertDownloadPath, assertEvidencePath } from "./installed-webview2-cdp.js";

const timestamp = "2025-01-01T00:00:00.000Z";
const changedTimestamp = "2025-01-02T00:00:00.000Z";

function prompt(id: string, slug: string, title: string, versions = 2): RecoveryLibraryPrompt {
  return {
    id,
    slug,
    title,
    description: "Synthetic installed-acceptance fixture.",
    category: "acceptance",
    isFavorite: true,
    rating: 5,
    tags: ["acceptance", "synthetic"],
    createdAt: timestamp,
    updatedAt: changedTimestamp,
    versions: [
      { sourceId: `${id}-v1`, semanticVersion: "1.0.0", body: "Synthetic version one.", bodyHash: createHash("sha256").update("Synthetic version one.").digest("hex"), changelog: "Synthetic change one.", createdAt: timestamp, updatedAt: timestamp },
      { sourceId: `${id}-v2`, semanticVersion: "1.1.0", body: "Synthetic version two.", bodyHash: createHash("sha256").update("Synthetic version two.").digest("hex"), changelog: "Synthetic change two.", createdAt: changedTimestamp, updatedAt: changedTimestamp },
    ].slice(0, versions),
  };
}

export interface InstalledRecoveryFixtureDocuments {
  readonly backup2: string;
  readonly backup1: string;
  readonly skipExisting: string;
  readonly addMissingVersions: string;
  readonly importAsCopy: string;
  readonly cancellation: string;
  readonly stalePlan: string;
}

export interface SyntheticLegacyFixtureSummary {
  readonly path: string;
  readonly promptCount: number;
  readonly versionCount: number;
  readonly tagCount: number;
  readonly relationshipCount: number;
}

export function buildInstalledRecoveryFixtureDocuments(): InstalledRecoveryFixtureDocuments {
  const primary = prompt("fixture-primary", "synthetic-recovery", "Synthetic recovery");
  const newPrompt = prompt("fixture-new", "synthetic-new", "Synthetic new");
  const missingVersion = {
    ...prompt("fixture-primary", "synthetic-recovery", "Conflicting source metadata", 1),
    description: "Must not replace current metadata.",
    category: "source-category",
    isFavorite: false,
    rating: 1,
    tags: ["acceptance", "source-only"],
    versions: [
      prompt("fixture-primary", "synthetic-recovery", "Synthetic recovery", 1).versions[0]!,
      { sourceId: "fixture-primary-v3", semanticVersion: "1.2.0", body: "Synthetic version three.", bodyHash: createHash("sha256").update("Synthetic version three.").digest("hex"), changelog: "Synthetic missing version.", createdAt: "2025-01-03T00:00:00.000Z", updatedAt: "2025-01-03T00:00:00.000Z" },
    ],
  } satisfies RecoveryLibraryPrompt;
  const conflictingCopy = { ...primary, id: "fixture-copy-source", title: "Synthetic recovery copy source" } satisfies RecoveryLibraryPrompt;
  const serialize = (prompts: readonly RecoveryLibraryPrompt[]) => serializeBackupDocument(buildBackupDocumentV2(prompts, changedTimestamp));
  const backup2 = serialize([primary]);
  const latest = primary.versions[1]!;
  const backup1 = JSON.stringify({ version: "1.0", exportedAt: changedTimestamp, prompts: [{ id: primary.id, slug: primary.slug, title: primary.title, description: primary.description, category: primary.category, isFavorite: primary.isFavorite, rating: primary.rating, tags: primary.tags, createdAt: primary.createdAt, updatedAt: primary.updatedAt, version: latest.semanticVersion, body: latest.body }] }, null, 2);
  return {
    backup2,
    backup1,
    skipExisting: serialize([primary, newPrompt]),
    addMissingVersions: serialize([missingVersion]),
    importAsCopy: serialize([conflictingCopy]),
    cancellation: serialize([newPrompt]),
    stalePlan: serialize([newPrompt]),
  };
}

/** Writes only production-validated synthetic backup documents beneath a fresh evidence root. */
export async function writeInstalledRecoveryFixtures(evidencePath: string): Promise<Record<keyof InstalledRecoveryFixtureDocuments, { readonly path: string; readonly sha256: string }>> {
  const evidence = assertEvidencePath(evidencePath);
  const fixturesDirectory = assertDownloadPath(win32.join(evidence, "fixtures"), evidence);
  await mkdir(fixturesDirectory, { recursive: true });
  const documents = buildInstalledRecoveryFixtureDocuments();
  const entries = Object.entries(documents) as Array<[keyof InstalledRecoveryFixtureDocuments, string]>;
  const result = {} as Record<keyof InstalledRecoveryFixtureDocuments, { readonly path: string; readonly sha256: string }>;
  for (const [name, content] of entries) {
    const validation = parseBackupText(content);
    if (!validation.valid) throw new Error(`Synthetic ${name} fixture was rejected by the production parser.`);
    const path = assertDownloadPath(win32.join(fixturesDirectory, `${name}.json`), evidence);
    await writeFile(path, content, "utf8");
    result[name] = { path, sha256: createHash("sha256").update(content).digest("hex") };
  }
  return result;
}

/**
 * Creates the smallest native-compatible legacy source outside the repository.
 * It deliberately uses the persisted legacy shape, while backup fixtures above
 * use the production backup serializer and parser. No user content is used.
 */
export function writeSyntheticLegacyFixture(evidencePath: string): SyntheticLegacyFixtureSummary {
  const evidence = assertEvidencePath(evidencePath);
  const path = assertDownloadPath(win32.join(evidence, "legacy", "prompt-vault.db"), evidence);
  return writeSyntheticLegacyFixtureAtPath(path);
}

/** Internal path-level builder kept separate so Linux CI can test the SQLite shape. */
export function writeSyntheticLegacyFixtureAtPath(path: string): SyntheticLegacyFixtureSummary {
  const directory = win32.dirname(path);
  // This helper is invoked only by the Windows orchestrator after it created a
  // fresh evidence root. better-sqlite3 creates no application-data files.
  mkdirSync(directory, { recursive: true });
  const database = new Database(path);
  try {
    database.pragma("foreign_keys = ON");
    database.exec(`
      CREATE TABLE prompts (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        description TEXT, category TEXT, is_favorite INTEGER NOT NULL DEFAULT 0,
        rating INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE prompt_versions (
        id TEXT PRIMARY KEY, prompt_id TEXT NOT NULL REFERENCES prompts(id),
        semantic_version TEXT NOT NULL, body TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'markdown',
        changelog TEXT, integrity_checksum TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE tags (id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE);
      CREATE TABLE prompt_tags (
        prompt_id TEXT NOT NULL REFERENCES prompts(id), tag_id TEXT NOT NULL REFERENCES tags(id),
        PRIMARY KEY (prompt_id, tag_id)
      );
      PRAGMA user_version = 5;
    `);
    database.prepare(`INSERT INTO prompts
      (id, slug, title, description, category, is_favorite, rating, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .run("legacy-fixture-prompt", "synthetic-recovery", "Synthetic recovery", "Synthetic installed-acceptance fixture.", "acceptance", 1, 5, timestamp, changedTimestamp);
    const insertVersion = database.prepare(`INSERT INTO prompt_versions
      (id, prompt_id, semantic_version, body, format, changelog, integrity_checksum, created_at, updated_at)
      VALUES (?, 'legacy-fixture-prompt', ?, ?, 'markdown', ?, ?, ?, ?)`);
    insertVersion.run("legacy-fixture-v1", "1.0.0", "Synthetic version one.", "Synthetic change one.", createHash("sha256").update("Synthetic version one.").digest("hex"), timestamp, timestamp);
    insertVersion.run("legacy-fixture-v2", "1.1.0", "Synthetic version two.", "Synthetic change two.", createHash("sha256").update("Synthetic version two.").digest("hex"), changedTimestamp, changedTimestamp);
    database.prepare("INSERT INTO tags (id, label) VALUES (?, ?)").run("legacy-tag-acceptance", "acceptance");
    database.prepare("INSERT INTO tags (id, label) VALUES (?, ?)").run("legacy-tag-synthetic", "synthetic");
    database.prepare("INSERT INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)").run("legacy-fixture-prompt", "legacy-tag-acceptance");
    database.prepare("INSERT INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)").run("legacy-fixture-prompt", "legacy-tag-synthetic");
    return { path, promptCount: 1, versionCount: 2, tagCount: 2, relationshipCount: 2 };
  } finally {
    database.close();
  }
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1]?.endsWith("installed-webview2-fixtures.ts")) {
  const evidence = option("--evidence");
  if (!evidence) throw new Error("--evidence is required.");
  const legacy = option("--legacy");
  const safeLegacy = legacy ? assertDownloadPath(legacy, evidence) : undefined;
  Promise.all([writeInstalledRecoveryFixtures(evidence), Promise.resolve(safeLegacy ? writeSyntheticLegacyFixtureAtPath(safeLegacy) : writeSyntheticLegacyFixture(evidence))])
    .then(([backups, legacy]) => process.stdout.write(`${JSON.stringify({ backups, legacy })}\n`))
    .catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
