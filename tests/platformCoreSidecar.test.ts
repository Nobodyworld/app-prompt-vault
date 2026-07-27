import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSharedTag,
  resetCoreDb,
} from "../src/lib/platform-core.js";

const temporaryDirectories: string[] = [];

function createLegacyCoreDb(path: string): void {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT
    );
    CREATE TABLE pages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL
    );
    CREATE TABLE prompts (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL
    );
    CREATE TABLE prompt_versions (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL
    );
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
  database.close();
}

function createMainPromptVaultDb(path: string): void {
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

afterEach(async () => {
  await resetCoreDb();
  delete process.env.PROMPT_VAULT_TAG_DB_PATH;
  delete process.env.NW_CORE_DB_PATH;
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("app-owned tag sidecar path safety", () => {
  it("derives a new platform file instead of opening the legacy Core DB", async () => {
    const directory = mkdtempSync(join(tmpdir(), "prompt-vault-sidecar-"));
    temporaryDirectories.push(directory);
    const legacyPath = join(directory, "prompt-vault.core.db");
    const derivedPath = join(directory, "prompt-vault.platform.db");
    createLegacyCoreDb(legacyPath);

    delete process.env.PROMPT_VAULT_TAG_DB_PATH;
    process.env.NW_CORE_DB_PATH = legacyPath;
    await resetCoreDb();

    const created = await createSharedTag({ name: "standalone" });
    expect(created.name).toBe("standalone");
    expect(existsSync(derivedPath)).toBe(true);

    const legacy = new Database(legacyPath, { readonly: true });
    const legacyColumns = legacy.prepare("PRAGMA table_info(tags)").all() as Array<{
      name: string;
    }>;
    const legacyCount = legacy
      .prepare("SELECT COUNT(*) AS count FROM tags")
      .get() as { count: number };
    legacy.close();

    expect(legacyColumns.map((column) => column.name)).toContain("type");
    expect(legacyColumns.map((column) => column.name)).not.toContain("kind");
    expect(legacyCount.count).toBe(0);

    const derived = new Database(derivedPath, { readonly: true });
    const derivedColumns = derived.prepare("PRAGMA table_info(tags)").all() as Array<{
      name: string;
    }>;
    const derivedCount = derived
      .prepare("SELECT COUNT(*) AS count FROM tags")
      .get() as { count: number };
    derived.close();

    expect(derivedColumns.map((column) => column.name)).toContain("kind");
    expect(derivedCount.count).toBe(1);
  });

  it("refuses an explicit path to the main Prompt Vault database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "prompt-vault-sidecar-main-"));
    temporaryDirectories.push(directory);
    const mainPath = join(directory, "prompt-vault.db");
    createMainPromptVaultDb(mainPath);

    process.env.PROMPT_VAULT_TAG_DB_PATH = mainPath;
    delete process.env.NW_CORE_DB_PATH;
    await resetCoreDb();

    await expect(createSharedTag({ name: "unsafe" })).rejects.toThrow(
      /appears to be the main Prompt Vault database/i,
    );

    const main = new Database(mainPath, { readonly: true });
    const unexpectedTags = main
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tags'",
      )
      .get();
    main.close();
    expect(unexpectedTags).toBeUndefined();
  });

  it("refuses an explicit legacy Core DB path without modifying it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "prompt-vault-sidecar-legacy-"));
    temporaryDirectories.push(directory);
    const legacyPath = join(directory, "prompt-vault.core.db");
    createLegacyCoreDb(legacyPath);

    process.env.PROMPT_VAULT_TAG_DB_PATH = legacyPath;
    delete process.env.NW_CORE_DB_PATH;
    await resetCoreDb();

    await expect(createSharedTag({ name: "unsafe" })).rejects.toThrow(
      /(appears to be the main Prompt Vault database|uses the legacy Core DB schema)/i,
    );

    const legacy = new Database(legacyPath, { readonly: true });
    const legacyColumns = legacy.prepare("PRAGMA table_info(tags)").all() as Array<{
      name: string;
    }>;
    const legacyCount = legacy
      .prepare("SELECT COUNT(*) AS count FROM tags")
      .get() as { count: number };
    legacy.close();

    expect(legacyColumns.map((column) => column.name)).toContain("type");
    expect(legacyColumns.map((column) => column.name)).not.toContain("kind");
    expect(legacyCount.count).toBe(0);
  });
});