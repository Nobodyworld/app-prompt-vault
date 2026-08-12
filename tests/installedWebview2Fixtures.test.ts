import { describe, expect, it } from "vitest";
import { parseBackupText } from "../src/domain/recovery.js";
import { buildInstalledRecoveryFixtureDocuments, writeSyntheticLegacyFixtureAtPath } from "../scripts/windows/installed-webview2-fixtures.js";
import { verifyInstalledDisposableDatabase } from "../scripts/windows/verify-installed-webview2-database.js";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("installed recovery fixture documents", () => {
  it("uses production serialization and validation for every synthetic backup fixture", () => {
    for (const [name, content] of Object.entries(buildInstalledRecoveryFixtureDocuments())) {
      const validation = parseBackupText(content);
      expect(validation.valid, name).toBe(true);
      expect(validation.promptCount, name).toBeGreaterThan(0);
    }
  });

  it("marks the 1.0 fixture as latest-version-only", () => {
    const validation = parseBackupText(buildInstalledRecoveryFixtureDocuments().backup1);
    expect(validation.version).toBe("1.0");
    expect(validation.latestVersionOnly).toBe(true);
  });

  it("creates a native-compatible synthetic legacy database outside application-data", () => {
    const root = mkdtempSync(join(tmpdir(), "prompt-vault-legacy-fixture-"));
    const fixture = writeSyntheticLegacyFixtureAtPath(join(root, "prompt-vault.db"));
    expect(fixture).toMatchObject({ promptCount: 1, versionCount: 2, tagCount: 2, relationshipCount: 2 });
    const database = new Database(fixture.path, { readonly: true });
    expect(database.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(database.pragma("foreign_key_check")).toEqual([]);
    database.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("verifies a disposable current database without retaining prompt bodies", () => {
    const root = mkdtempSync(join(tmpdir(), "prompt-vault-installed-db-"));
    const path = join(root, "prompt-vault.db");
    const database = new Database(path);
    try {
      database.exec("PRAGMA foreign_keys=ON; CREATE TABLE prompts (id TEXT); CREATE TABLE prompt_versions (id TEXT); CREATE TABLE tags (id TEXT); CREATE TABLE prompt_tags (id TEXT);");
      database.prepare("INSERT INTO prompts VALUES (?)").run("one");
      const summary = verifyInstalledDisposableDatabase(path);
      expect(summary).toEqual({ integrity: "ok", foreignKeyViolations: 0, promptCount: 1, versionCount: 0, tagCount: 0, relationshipCount: 0 });
      expect(JSON.stringify(summary)).not.toContain("Synthetic");
    } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
