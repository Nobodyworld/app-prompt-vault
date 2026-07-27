import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { Prompt, PromptVersion } from "../src/domain/models.js";
import { generateIntegrityChecksum } from "../src/lib/platform-core.js";
import { StructuredLogger } from "../src/observability/logger.js";
import { PromptRepository } from "../src/repositories/PromptRepository.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(
  testDirectory,
  "..",
  "src",
  "db",
  "migrations",
);
const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

interface RepositoryHarness {
  readonly databasePath: string;
  database: Database.Database;
  repository: PromptRepository;
}

function createDisposableDatabasePath(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return join(directory, "prompt-vault.db");
}

function trackDatabase(database: Database.Database): Database.Database {
  databases.push(database);
  return database;
}

function createRepository(database: Database.Database): PromptRepository {
  return new PromptRepository(database, {
    logger: new StructuredLogger({ level: "error" }),
  });
}

function createHarness(prefix = "pv-fts-lifecycle-"): RepositoryHarness {
  const databasePath = createDisposableDatabasePath(prefix);
  const database = trackDatabase(new Database(databasePath));
  return {
    databasePath,
    database,
    repository: createRepository(database),
  };
}

function reopenHarness(harness: RepositoryHarness): void {
  harness.database.close();
  harness.database = trackDatabase(new Database(harness.databasePath));
  harness.repository = createRepository(harness.database);
}

function createPrompt(
  repository: PromptRepository,
  terms: {
    readonly slug: string;
    readonly title: string;
    readonly description: string;
    readonly body: string;
  },
  timestamp = new Date("2026-01-02T03:04:05.000Z"),
): { prompt: Prompt; version: PromptVersion; rowid: number } {
  const prompt: Prompt = {
    id: randomUUID(),
    slug: terms.slug,
    title: terms.title,
    description: terms.description,
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const version: PromptVersion = {
    id: randomUUID(),
    promptId: prompt.id,
    semanticVersion: "1.0.0",
    body: terms.body,
    format: "markdown",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  repository.createPrompt(prompt, version);
  const row = repository
    .getDatabase()
    .prepare("SELECT rowid FROM prompts WHERE id = ?")
    .get(prompt.id) as { rowid: number };
  return { prompt, version, rowid: row.rowid };
}

function searchIds(repository: PromptRepository, term: string): string[] {
  return repository
    .searchPrompts({
      text: term,
      page: 0,
      pageSize: 20,
    })
    .prompts.map((prompt) => prompt.id)
    .sort();
}

function rawMatchRowids(
  database: Database.Database,
  term: string,
): number[] {
  return (
    database
      .prepare(
        "SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ? ORDER BY rowid",
      )
      .all(term) as { rowid: number }[]
  ).map((row) => row.rowid);
}

function verifyFtsIntegrity(database: Database.Database): void {
  expect(() =>
    database.exec(
      "INSERT INTO prompts_fts(prompts_fts) VALUES('integrity-check')",
    ),
  ).not.toThrow();
}

function applyMigrationsThroughVersionSix(
  database: Database.Database,
): void {
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort((left, right) => {
      const leftVersion = Number.parseInt(left, 10);
      const rightVersion = Number.parseInt(right, 10);
      return leftVersion - rightVersion || left.localeCompare(right);
    })
    .filter((file) => Number.parseInt(file, 10) <= 6);

  for (const migrationFile of migrationFiles) {
    const sql = readFileSync(join(migrationsDirectory, migrationFile), "utf8");
    const hasColumn = (table: string, column: string): boolean =>
      (
        database.prepare(`PRAGMA table_info(${table})`).all() as {
          name: string;
        }[]
      ).some((definition) => definition.name === column);
    const isAlreadyAppliedColumnMigration =
      (sql.includes("ALTER TABLE prompts ADD COLUMN category") &&
        hasColumn("prompts", "category")) ||
      (sql.includes("ALTER TABLE prompts ADD COLUMN deleted_at") &&
        hasColumn("prompts", "deleted_at")) ||
      (sql.includes("ALTER TABLE prompt_versions ADD COLUMN format") &&
        hasColumn("prompt_versions", "format")) ||
      (sql.includes("ALTER TABLE prompts ADD COLUMN is_favorite") &&
        hasColumn("prompts", "is_favorite")) ||
      (sql.includes("ALTER TABLE prompts ADD COLUMN rating") &&
        hasColumn("prompts", "rating"));

    if (!isAlreadyAppliedColumnMigration) {
      database.exec(sql);
    }
  }
  database.pragma("user_version = 6");
}

function seedVersionSixPrompt(
  database: Database.Database,
  input: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly description: string;
    readonly body: string;
    readonly deletedAt?: string;
  },
): void {
  const timestamp = "2026-01-02T03:04:05.000Z";
  database
    .prepare(
      `INSERT INTO prompts(
        id, slug, title, description, category, is_favorite, rating,
        integrity_checksum, created_at, updated_at, deleted_at
      ) VALUES(
        @id, @slug, @title, @description, NULL, 0, NULL,
        NULL, @createdAt, @updatedAt, @deletedAt
      )`,
    )
    .run({
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: input.deletedAt ?? null,
    });
  database
    .prepare(
      `INSERT INTO prompt_versions(
        id, prompt_id, semantic_version, body, format, changelog,
        integrity_checksum, created_at, updated_at
      ) VALUES(
        @versionId, @promptId, '1.0.0', @body, 'markdown', NULL,
        @integrityChecksum, @createdAt, @updatedAt
      )`,
    )
    .run({
      versionId: randomUUID(),
      promptId: input.id,
      body: input.body,
      integrityChecksum: generateIntegrityChecksum(input.body),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) {
      database.close();
    }
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("contentless-delete FTS migration", () => {
  it("upgrades a reopened version-6 database and rebuilds only active canonical rows", () => {
    const databasePath = createDisposableDatabasePath("pv-fts-v6-");
    const versionSixDatabase = trackDatabase(new Database(databasePath));
    applyMigrationsThroughVersionSix(versionSixDatabase);

    const activeId = randomUUID();
    seedVersionSixPrompt(versionSixDatabase, {
      id: activeId,
      slug: "version-six-active",
      title: "v6activetitle",
      description: "v6activedescription",
      body: "v6activebody",
    });
    seedVersionSixPrompt(versionSixDatabase, {
      id: randomUUID(),
      slug: "version-six-deleted",
      title: "v6deletedtitle",
      description: "v6deleteddescription",
      body: "v6deletedbody",
      deletedAt: "2026-01-03T00:00:00.000Z",
    });
    expect(
      versionSixDatabase.pragma("user_version", { simple: true }),
    ).toBe(6);
    versionSixDatabase.close();

    const upgradedDatabase = trackDatabase(new Database(databasePath));
    const repository = createRepository(upgradedDatabase);

    expect(
      upgradedDatabase.pragma("user_version", { simple: true }),
    ).toBe(7);
    const table = upgradedDatabase
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'prompts_fts'",
      )
      .get() as { sql: string };
    expect(table.sql).toContain("contentless_delete=1");

    const triggers = upgradedDatabase
      .prepare(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'trigger'
           AND name IN (
             'prompts_fts_insert',
             'prompts_fts_delete',
             'prompts_fts_update',
             'prompt_versions_fts_insert',
             'prompt_versions_fts_update',
             'prompt_versions_fts_delete'
           )
         ORDER BY name`,
      )
      .all() as { name: string; sql: string }[];
    expect(triggers.map((trigger) => trigger.name)).toEqual([
      "prompt_versions_fts_delete",
      "prompt_versions_fts_insert",
      "prompt_versions_fts_update",
      "prompts_fts_delete",
      "prompts_fts_insert",
      "prompts_fts_update",
    ]);
    for (const trigger of triggers) {
      expect(trigger.sql).not.toMatch(
        /INSERT\s+INTO\s+prompts_fts\s*\(\s*prompts_fts\s*,\s*rowid\s*\)/i,
      );
    }
    expect(
      triggers.filter((trigger) =>
        /DELETE\s+FROM\s+prompts_fts/i.test(trigger.sql),
      ),
    ).toHaveLength(5);

    expect(searchIds(repository, "v6activetitle")).toEqual([activeId]);
    expect(searchIds(repository, "v6activedescription")).toEqual([activeId]);
    expect(searchIds(repository, "v6activebody")).toEqual([activeId]);
    expect(searchIds(repository, "v6deletedbody")).toEqual([]);
    expect(rawMatchRowids(upgradedDatabase, "v6deletedbody")).toEqual([]);
    verifyFtsIntegrity(upgradedDatabase);
  });
});

describe("contentless-delete FTS lifecycle", () => {
  it("indexes initial title, description, and body terms and replaces metadata terms", () => {
    const { database, repository } = createHarness();
    verifyFtsIntegrity(database);
    const created = createPrompt(repository, {
      slug: "fts-metadata",
      title: "ftsoldtitlealpha",
      description: "ftsolddescriptionalpha",
      body: "ftsbodykeptalpha",
    });

    expect(searchIds(repository, "ftsoldtitlealpha")).toEqual([
      created.prompt.id,
    ]);
    expect(searchIds(repository, "ftsolddescriptionalpha")).toEqual([
      created.prompt.id,
    ]);
    expect(searchIds(repository, "ftsbodykeptalpha")).toEqual([
      created.prompt.id,
    ]);

    repository.updatePromptMetadata(created.prompt.id, {
      title: "ftsnewtitlealpha",
      description: "ftsnewdescriptionalpha",
    });

    expect(searchIds(repository, "ftsoldtitlealpha")).toEqual([]);
    expect(searchIds(repository, "ftsolddescriptionalpha")).toEqual([]);
    expect(searchIds(repository, "ftsnewtitlealpha")).toEqual([
      created.prompt.id,
    ]);
    expect(searchIds(repository, "ftsnewdescriptionalpha")).toEqual([
      created.prompt.id,
    ]);
    expect(searchIds(repository, "ftsbodykeptalpha")).toEqual([
      created.prompt.id,
    ]);
    verifyFtsIntegrity(database);
  });

  it("tracks the canonical latest version across insert, update, and delete", () => {
    const { database, repository } = createHarness();
    const created = createPrompt(repository, {
      slug: "fts-version-order",
      title: "ftsversiontitle",
      description: "ftsversiondescription",
      body: "ftsoriginalbodybeta",
    });
    const latestVersion: PromptVersion = {
      id: randomUUID(),
      promptId: created.prompt.id,
      semanticVersion: "2.0.0",
      body: "ftslatestbodybeta",
      format: "markdown",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    };
    repository.addVersion(latestVersion);
    expect(searchIds(repository, "ftsoriginalbodybeta")).toEqual([]);
    expect(searchIds(repository, "ftslatestbodybeta")).toEqual([
      created.prompt.id,
    ]);

    const historicalVersion: PromptVersion = {
      id: randomUUID(),
      promptId: created.prompt.id,
      semanticVersion: "0.5.0",
      body: "ftshistoricalbodybeta",
      format: "markdown",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    repository.addVersion(historicalVersion);
    expect(searchIds(repository, "ftshistoricalbodybeta")).toEqual([]);
    expect(searchIds(repository, "ftslatestbodybeta")).toEqual([
      created.prompt.id,
    ]);

    const revisedHistoricalBody = "ftsrevisedhistoricalbeta";
    database
      .prepare(
        `UPDATE prompt_versions
         SET body = @body,
             integrity_checksum = @checksum,
             updated_at = @updatedAt
         WHERE id = @versionId`,
      )
      .run({
        body: revisedHistoricalBody,
        checksum: generateIntegrityChecksum(revisedHistoricalBody),
        updatedAt: "2025-01-02T00:00:00.000Z",
        versionId: historicalVersion.id,
      });
    expect(searchIds(repository, "ftsrevisedhistoricalbeta")).toEqual([]);
    expect(searchIds(repository, "ftslatestbodybeta")).toEqual([
      created.prompt.id,
    ]);

    database
      .prepare(
        `UPDATE prompt_versions
         SET created_at = @createdAt,
             updated_at = @updatedAt
         WHERE id = @versionId`,
      )
      .run({
        createdAt: "2027-01-01T00:00:00.000Z",
        updatedAt: "2027-01-01T00:00:00.000Z",
        versionId: historicalVersion.id,
      });
    expect(searchIds(repository, "ftsrevisedhistoricalbeta")).toEqual([
      created.prompt.id,
    ]);
    expect(searchIds(repository, "ftslatestbodybeta")).toEqual([]);

    database
      .prepare(
        `UPDATE prompt_versions
         SET created_at = @createdAt,
             updated_at = @updatedAt
         WHERE id = @versionId`,
      )
      .run({
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
        versionId: historicalVersion.id,
      });
    expect(searchIds(repository, "ftsrevisedhistoricalbeta")).toEqual([]);
    expect(searchIds(repository, "ftslatestbodybeta")).toEqual([
      created.prompt.id,
    ]);

    database
      .prepare("DELETE FROM prompt_versions WHERE id = ?")
      .run(historicalVersion.id);
    expect(searchIds(repository, "ftslatestbodybeta")).toEqual([
      created.prompt.id,
    ]);

    database
      .prepare("DELETE FROM prompt_versions WHERE id = ?")
      .run(latestVersion.id);
    expect(searchIds(repository, "ftslatestbodybeta")).toEqual([]);
    expect(searchIds(repository, "ftsoriginalbodybeta")).toEqual([
      created.prompt.id,
    ]);
    verifyFtsIntegrity(database);
  });

  it("keeps prompt metadata indexed with an empty body after its final version is deleted", () => {
    const { database, repository } = createHarness();
    const created = createPrompt(repository, {
      slug: "fts-no-versions",
      title: "ftsnoversiontitle",
      description: "ftsnoversiondescription",
      body: "ftsremovedonlybody",
    });

    database
      .prepare("DELETE FROM prompt_versions WHERE id = ?")
      .run(created.version.id);

    expect(rawMatchRowids(database, "ftsremovedonlybody")).toEqual([]);
    expect(rawMatchRowids(database, "ftsnoversiontitle")).toEqual([
      created.rowid,
    ]);
    expect(rawMatchRowids(database, "ftsnoversiondescription")).toEqual([
      created.rowid,
    ]);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM prompt_versions WHERE prompt_id = ?",
        )
        .get(created.prompt.id),
    ).toEqual({ count: 0 });
    verifyFtsIntegrity(database);
  });

  it("removes soft-deleted rows, restores them, and permanently removes FTS state", () => {
    const { database, repository } = createHarness();
    const created = createPrompt(repository, {
      slug: "fts-delete-lifecycle",
      title: "ftsdeletetitlegamma",
      description: "ftsdeletedescriptiongamma",
      body: "ftsdeletebodygamma",
    });

    expect(searchIds(repository, "ftsdeletebodygamma")).toEqual([
      created.prompt.id,
    ]);
    expect(rawMatchRowids(database, "ftsdeletebodygamma")).toEqual([
      created.rowid,
    ]);

    repository.softDeletePrompt(
      created.prompt.id,
      new Date("2026-04-01T00:00:00.000Z"),
    );
    expect(searchIds(repository, "ftsdeletebodygamma")).toEqual([]);
    expect(rawMatchRowids(database, "ftsdeletebodygamma")).toEqual([]);
    verifyFtsIntegrity(database);

    repository.restorePrompt(created.prompt.id);
    expect(searchIds(repository, "ftsdeletebodygamma")).toEqual([
      created.prompt.id,
    ]);
    expect(rawMatchRowids(database, "ftsdeletebodygamma")).toEqual([
      created.rowid,
    ]);
    verifyFtsIntegrity(database);

    repository.permanentlyDeletePrompt(created.prompt.id);
    expect(searchIds(repository, "ftsdeletebodygamma")).toEqual([]);
    expect(rawMatchRowids(database, "ftsdeletebodygamma")).toEqual([]);
    expect(
      database.prepare("SELECT rowid FROM prompts WHERE id = ?").get(
        created.prompt.id,
      ),
    ).toBeUndefined();
    verifyFtsIntegrity(database);
  });

  it("does not leak deleted terms when SQLite reuses a prompt rowid", () => {
    const { database, repository } = createHarness();
    const deleted = createPrompt(repository, {
      slug: "fts-rowid-deleted",
      title: "ftsrowidoldtitle",
      description: "ftsrowidolddescription",
      body: "ftsrowidoldbody",
    });
    repository.permanentlyDeletePrompt(deleted.prompt.id);

    const replacement = createPrompt(repository, {
      slug: "fts-rowid-replacement",
      title: "ftsrowidnewtitle",
      description: "ftsrowidnewdescription",
      body: "ftsrowidnewbody",
    });

    expect(replacement.rowid).toBe(deleted.rowid);
    expect(searchIds(repository, "ftsrowidoldtitle")).toEqual([]);
    expect(searchIds(repository, "ftsrowidolddescription")).toEqual([]);
    expect(searchIds(repository, "ftsrowidoldbody")).toEqual([]);
    expect(rawMatchRowids(database, "ftsrowidoldbody")).toEqual([]);
    expect(searchIds(repository, "ftsrowidnewtitle")).toEqual([
      replacement.prompt.id,
    ]);
    expect(searchIds(repository, "ftsrowidnewdescription")).toEqual([
      replacement.prompt.id,
    ]);
    expect(searchIds(repository, "ftsrowidnewbody")).toEqual([
      replacement.prompt.id,
    ]);
    expect(rawMatchRowids(database, "ftsrowidnewbody")).toEqual([
      replacement.rowid,
    ]);
    verifyFtsIntegrity(database);
  });

  it("preserves current terms and deleted-old-term absence across reopen", () => {
    const harness = createHarness("pv-fts-reopen-");
    const created = createPrompt(harness.repository, {
      slug: "fts-reopen",
      title: "ftsreopenoldtitle",
      description: "ftsreopendescription",
      body: "ftsreopenoldbody",
    });
    harness.repository.updatePromptMetadata(created.prompt.id, {
      title: "ftsreopennewtitle",
    });
    const latestVersion: PromptVersion = {
      id: randomUUID(),
      promptId: created.prompt.id,
      semanticVersion: "2.0.0",
      body: "ftsreopennewbody",
      format: "markdown",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    };
    harness.repository.addVersion(latestVersion);
    verifyFtsIntegrity(harness.database);

    reopenHarness(harness);

    expect(searchIds(harness.repository, "ftsreopenoldtitle")).toEqual([]);
    expect(searchIds(harness.repository, "ftsreopenoldbody")).toEqual([]);
    expect(searchIds(harness.repository, "ftsreopennewtitle")).toEqual([
      created.prompt.id,
    ]);
    expect(searchIds(harness.repository, "ftsreopendescription")).toEqual([
      created.prompt.id,
    ]);
    expect(searchIds(harness.repository, "ftsreopennewbody")).toEqual([
      created.prompt.id,
    ]);
    verifyFtsIntegrity(harness.database);
  });
});
