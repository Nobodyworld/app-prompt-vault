import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { parseBackupText, type RecoveryDocument } from "../src/domain/recovery.js";
import { buildInstalledRecoveryFixtureDocuments, writeSyntheticLegacyFixtureAtPath } from "../scripts/windows/installed-webview2-fixtures.js";
import { mutateDisposableTargetWithProductionService, requireSnapshotTransition, snapshotDisposableDatabase, verifyInstalledDisposableDatabase } from "../scripts/windows/verify-installed-webview2-database.js";
import { PHASE_PROFILE_GROUP, phaseEvidenceDirectory, verifyBackupAgainstSnapshot, type LogicalDatabaseSnapshot, type LogicalPromptSnapshot } from "../scripts/windows/installed-webview2-evidence.js";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function snapshotPrompt(source: RecoveryDocument["prompts"][number], id: string, overrides: Partial<LogicalPromptSnapshot> = {}): LogicalPromptSnapshot {
  const initial: LogicalPromptSnapshot = {
    id,
    slug: source.slug,
    title: source.title,
    description: source.description,
    category: source.category,
    favorite: source.isFavorite,
    rating: source.rating,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    tags: [...source.tags],
    versions: source.versions.map((version, index) => ({
      id: `${id}-version-${index + 1}`,
      semanticVersion: version.semanticVersion,
      bodySha256: createHash("sha256").update(version.body).digest("hex"),
      changelog: version.changelog,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
    })),
  };
  return { ...initial, ...overrides };
}

function logicalSnapshot(prompts: readonly LogicalPromptSnapshot[]): LogicalDatabaseSnapshot {
  const tagLabels = [...new Set(prompts.flatMap((prompt) => prompt.tags).map((tag) => tag.toLowerCase()))].sort();
  const normalizedPrompts = prompts.map((prompt) => ({ ...prompt, tags: [...prompt.tags].sort() }));
  const relationships = normalizedPrompts.flatMap((prompt) => prompt.tags.map((tagLabel) => ({ promptId: prompt.id, tagLabel }))).sort((left, right) => `${left.promptId}\u0000${left.tagLabel}`.localeCompare(`${right.promptId}\u0000${right.tagLabel}`));
  const counts = { prompts: normalizedPrompts.length, versions: normalizedPrompts.reduce((total, prompt) => total + prompt.versions.length, 0), tags: tagLabels.length, relationships: relationships.length };
  const digest = createHash("sha256").update(JSON.stringify({ prompts: normalizedPrompts, tagLabels, relationships, counts })).digest("hex");
  return { prompts: normalizedPrompts, tagLabels, relationships, counts, digest };
}

function fixtureDocument(content: string): RecoveryDocument {
  const parsed = parseBackupText(content);
  if (!parsed.valid || !parsed.document) throw new Error("Expected a production-valid fixture document.");
  return parsed.document;
}

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

  it("produces a canonical body-safe snapshot and detects cancellation mismatch", () => {
    const root = mkdtempSync(join(tmpdir(), "prompt-vault-snapshot-")); const path = join(root, "prompt-vault.db"); const database = new Database(path);
    try {
      database.exec("CREATE TABLE prompts (id TEXT, slug TEXT, title TEXT, category TEXT, is_favorite INTEGER, rating INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT); CREATE TABLE prompt_versions (id TEXT, prompt_id TEXT, semantic_version TEXT, body TEXT, changelog TEXT, created_at TEXT, updated_at TEXT); CREATE TABLE tags (id TEXT, label TEXT); CREATE TABLE prompt_tags (prompt_id TEXT, tag_id TEXT);");
      database.exec("ALTER TABLE prompts ADD COLUMN description TEXT");
      database.prepare("INSERT INTO prompts VALUES ('p','synthetic-recovery','Synthetic',NULL,1,5,'a','b',NULL,'private description')").run(); database.prepare("INSERT INTO prompt_versions VALUES ('v','p','1.0.0','private body','change','a','b')").run();
      database.prepare("INSERT INTO tags VALUES ('t','acceptance')").run(); database.prepare("INSERT INTO prompt_tags VALUES ('p','t')").run();
      const before = snapshotDisposableDatabase(path); expect(JSON.stringify(before)).not.toContain("private body"); expect(before).toMatchObject({ tagLabels: ["acceptance"], relationships: [{ promptId: "p", tagLabel: "acceptance" }] }); requireSnapshotTransition(before, before, "cancel");
      database.prepare("UPDATE prompts SET title='Changed'").run(); const after = snapshotDisposableDatabase(path); expect(() => requireSnapshotTransition(before, after, "cancel")).toThrow("changed");
    } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps profile persistence only within the declared group and phase evidence paths unique", () => {
    expect(PHASE_PROFILE_GROUP["backup-2-export-and-verify"]).toBe(PHASE_PROFILE_GROUP["restart-verification"]);
    expect(PHASE_PROFILE_GROUP["version-history-revert"]).toBe(PHASE_PROFILE_GROUP["version-history-restart-verification"]);
    expect(PHASE_PROFILE_GROUP["skip-existing"]).not.toBe(PHASE_PROFILE_GROUP["import-as-copy"]);
    expect(phaseEvidenceDirectory("C:\\tmp\\evidence", 1, "self-test", 1)).not.toBe(phaseEvidenceDirectory("C:\\tmp\\evidence", 2, "storage-status", 1));
    expect(phaseEvidenceDirectory("C:\\tmp\\evidence", 1, "self-test", 1)).not.toBe(phaseEvidenceDirectory("C:\\tmp\\evidence", 1, "self-test", 2));
  });

  it("uses the production persistence service for the deliberate stale-plan mutation", async () => {
    const root = mkdtempSync(join(tmpdir(), "prompt-vault-stale-mutation-")); const path = join(root, "prompt-vault.db");
    try {
      await expect(mutateDisposableTargetWithProductionService(path)).resolves.toMatchObject({ slug: "stale-target-mutation" });
      const snapshot = snapshotDisposableDatabase(path);
      expect(snapshot.prompts).toHaveLength(1);
      expect(snapshot.prompts[0]!.versions).toHaveLength(1);
      expect(JSON.stringify(snapshot)).not.toContain("Synthetic stale-plan mutation body.");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("reconciles skip, merge, copy, cancellation, stale, and revert transitions against production fixture content", () => {
    const documents = buildInstalledRecoveryFixtureDocuments();
    const primary = fixtureDocument(documents.backup2).prompts[0]!;
    const skip = fixtureDocument(documents.skipExisting);
    const merge = fixtureDocument(documents.addMissingVersions).prompts[0]!;
    const copy = fixtureDocument(documents.importAsCopy).prompts[0]!;
    const before = logicalSnapshot([snapshotPrompt(primary, "target-primary")]);

    const skippedNew = snapshotPrompt(skip.prompts.find((prompt) => prompt.slug === "synthetic-new")!, "target-new");
    const skipAfter = logicalSnapshot([before.prompts[0]!, skippedNew]);
    expect(requireSnapshotTransition(before, skipAfter, "skip-existing", skip)).toMatchObject({ policy: "skip-existing", afterCounts: { prompts: 2, versions: 4 } });
    expect(() => requireSnapshotTransition(before, logicalSnapshot([before.prompts[0]!, { ...skippedNew, title: "tampered" }]), "skip-existing", skip)).toThrow("metadata");

    const missing = merge.versions[1]!;
    const mergedPrimary: LogicalPromptSnapshot = { ...before.prompts[0]!, versions: [...before.prompts[0]!.versions, { id: "target-primary-version-3", semanticVersion: missing.semanticVersion, bodySha256: createHash("sha256").update(missing.body).digest("hex"), changelog: missing.changelog, createdAt: missing.createdAt, updatedAt: missing.updatedAt }] };
    const mergeAfter = logicalSnapshot([mergedPrimary]);
    expect(requireSnapshotTransition(before, mergeAfter, "add-missing-versions", fixtureDocument(documents.addMissingVersions))).toMatchObject({ policy: "add-missing-versions", afterCounts: { versions: 3 } });
    expect(() => requireSnapshotTransition(before, logicalSnapshot([{ ...mergedPrimary, category: "overwritten" }]), "add-missing-versions", fixtureDocument(documents.addMissingVersions))).toThrow("Add-missing-versions");

    const importedCopy = snapshotPrompt(copy, "target-copy", { slug: "synthetic-recovery-imported", title: "Synthetic recovery copy source (imported copy)" });
    const copyAfter = logicalSnapshot([before.prompts[0]!, importedCopy]);
    expect(requireSnapshotTransition(before, copyAfter, "import-as-copy", fixtureDocument(documents.importAsCopy))).toMatchObject({ policy: "import-as-copy", afterCounts: { prompts: 2, versions: 4 } });
    expect(() => requireSnapshotTransition(before, logicalSnapshot([before.prompts[0]!, { ...importedCopy, id: "fixture-copy-source" }]), "import-as-copy", fixtureDocument(documents.importAsCopy))).toThrow("source ID");

    expect(requireSnapshotTransition(before, before, "cancel")).toMatchObject({ policy: "cancel" });
    const stale = logicalSnapshot([...before.prompts, { ...snapshotPrompt(primary, "stale-prompt", { slug: "stale-target-mutation", title: "Stale target mutation", description: "Synthetic ordinary product mutation.", tags: ["acceptance", "stale-plan"] }), versions: [{ id: "stale-version", semanticVersion: "1.0.0", bodySha256: createHash("sha256").update("stale body").digest("hex"), changelog: "Ordinary product mutation.", createdAt: primary.createdAt, updatedAt: primary.updatedAt }] }]);
    expect(requireSnapshotTransition(before, stale, "stale-plan")).toMatchObject({ policy: "stale-plan", afterCounts: { prompts: 2, versions: 3, tags: 3, relationships: 4 } });

    const versionRevertBefore = mergeAfter;
    const reverted = logicalSnapshot([{ ...mergedPrimary, versions: [...mergedPrimary.versions, { id: "target-primary-version-4", semanticVersion: "1.2.1", bodySha256: mergedPrimary.versions[0]!.bodySha256, changelog: "Revert to v1.0.0", createdAt: "2025-01-04T00:00:00.000Z", updatedAt: "2025-01-04T00:00:00.000Z" }] }]);
    expect(requireSnapshotTransition(versionRevertBefore, reverted, "version-revert")).toMatchObject({ policy: "version-revert", afterCounts: { versions: 4 } });
    expect(requireSnapshotTransition(reverted, reverted, "version-revert-restart")).toMatchObject({ policy: "version-revert-restart" });
  });

  it("reconciles a verified 2.0 export against body-safe prompt, tag, and version snapshot state", () => {
    const documents = buildInstalledRecoveryFixtureDocuments();
    const source = fixtureDocument(documents.backup2).prompts[0]!;
    const snapshot = logicalSnapshot([snapshotPrompt(source, source.sourceId ?? "fixture-primary")]);
    expect(() => verifyBackupAgainstSnapshot(documents.backup2, snapshot)).not.toThrow();
    const reorderedTags = JSON.parse(documents.backup2) as { prompts: Array<{ tags: string[] }> };
    reorderedTags.prompts[0]!.tags.reverse();
    expect(() => verifyBackupAgainstSnapshot(JSON.stringify(reorderedTags), snapshot)).toThrow("tag ordering");
    const withPrivateMetadata = JSON.parse(documents.backup2) as Record<string, unknown>;
    withPrivateMetadata.machinePath = "C:\\private";
    expect(() => verifyBackupAgainstSnapshot(JSON.stringify(withPrivateMetadata), snapshot)).toThrow("unrelated top-level metadata");
  });
});
