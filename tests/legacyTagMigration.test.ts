import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyTagSidecar } from "../src/lib/legacy-tag-migration.js";

const temporaryDirectories: string[] = [];

function createFixture(): { directory: string; source: string; target: string } {
  const directory = mkdtempSync(join(tmpdir(), "prompt-vault-tag-migration-"));
  temporaryDirectories.push(directory);
  const source = join(directory, "legacy.core.db");
  const target = join(directory, "prompt-vault-platform.db");

  const database = new Database(source);
  database.exec(`
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      color TEXT,
      description TEXT,
      is_archived INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE taggings (
      id TEXT PRIMARY KEY,
      tag_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      context TEXT,
      created_at TEXT
    );
  `);
  database
    .prepare(
      "INSERT INTO tags (id, name, type, color, description, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "tag-alpha",
      "alpha",
      "label",
      "#111111",
      "Alpha label",
      0,
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    );
  database
    .prepare(
      "INSERT INTO tags (id, name, type, color, description, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "tag-project",
      "project:demo-project",
      "project",
      "#222222",
      "Demo Project",
      0,
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    );
  database
    .prepare(
      "INSERT INTO taggings (id, tag_id, entity_type, entity_id, context, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      "tagging-alpha",
      "tag-alpha",
      "prompts",
      "prompt-1",
      null,
      "2026-01-03T00:00:00.000Z",
    );
  database
    .prepare(
      "INSERT INTO taggings (id, tag_id, entity_type, entity_id, context, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      "tagging-project",
      "tag-project",
      "prompts",
      "prompt-1",
      null,
      "2026-01-03T00:00:00.000Z",
    );
  database.close();

  return { directory, source, target };
}

function createMainDatabase(path: string): void {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE prompts (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL
    );
    CREATE TABLE prompt_versions (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL
    );
  `);
  database.close();
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("legacy tag sidecar migration", () => {
  it("reports a dry run without creating the target", () => {
    const { source, target } = createFixture();

    const result = migrateLegacyTagSidecar({
      sourcePath: source,
      targetPath: target,
      dryRun: true,
    });

    expect(result.sourceTags).toBe(2);
    expect(result.sourceTaggings).toBe(2);
    expect(result.insertedTags).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  it("preserves tags, project metadata, associations, and idempotence", () => {
    const { source, target } = createFixture();

    const first = migrateLegacyTagSidecar({
      sourcePath: source,
      targetPath: target,
    });
    expect(first.insertedTags).toBe(2);
    expect(first.insertedTaggings).toBe(2);

    const targetDatabase = new Database(target, { readonly: true });
    const tags = targetDatabase
      .prepare(
        "SELECT id, name, kind, color, description, is_archived FROM tags ORDER BY id",
      )
      .all() as Array<Record<string, unknown>>;
    const taggings = targetDatabase
      .prepare(
        "SELECT tag_id, entity_type, entity_id, context FROM taggings ORDER BY tag_id",
      )
      .all() as Array<Record<string, unknown>>;
    targetDatabase.close();

    expect(tags).toEqual([
      {
        id: "tag-alpha",
        name: "alpha",
        kind: "label",
        color: "#111111",
        description: "Alpha label",
        is_archived: 0,
      },
      {
        id: "tag-project",
        name: "project:demo-project",
        kind: "project",
        color: "#222222",
        description: "Demo Project",
        is_archived: 0,
      },
    ]);
    expect(taggings).toEqual([
      {
        tag_id: "tag-alpha",
        entity_type: "prompts",
        entity_id: "prompt-1",
        context: "",
      },
      {
        tag_id: "tag-project",
        entity_type: "prompts",
        entity_id: "prompt-1",
        context: "",
      },
    ]);

    const second = migrateLegacyTagSidecar({
      sourcePath: source,
      targetPath: target,
    });
    expect(second.updatedTags).toBe(2);
    expect(second.insertedTaggings).toBe(0);
    expect(second.skippedTaggings).toBe(2);
  });

  it("refuses to read from the main Prompt Vault database", () => {
    const directory = mkdtempSync(join(tmpdir(), "prompt-vault-tag-safety-"));
    temporaryDirectories.push(directory);
    const mainDatabase = join(directory, "prompt-vault.db");
    const target = join(directory, "prompt-vault-platform.db");
    createMainDatabase(mainDatabase);

    expect(() =>
      migrateLegacyTagSidecar({
        sourcePath: mainDatabase,
        targetPath: target,
      }),
    ).toThrow(/main Prompt Vault database/i);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses to write into the main Prompt Vault database", () => {
    const { directory, source } = createFixture();
    const mainDatabase = join(directory, "prompt-vault.db");
    createMainDatabase(mainDatabase);

    expect(() =>
      migrateLegacyTagSidecar({
        sourcePath: source,
        targetPath: mainDatabase,
      }),
    ).toThrow(/target appears to be the main Prompt Vault database/i);

    const verification = new Database(mainDatabase, { readonly: true });
    const unexpectedTaggings = verification
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'taggings'",
      )
      .get();
    verification.close();
    expect(unexpectedTaggings).toBeUndefined();
  });
});
