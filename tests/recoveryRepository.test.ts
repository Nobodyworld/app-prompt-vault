import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildBackupDocumentV2,
  serializeBackupDocument,
  sha256,
  type RecoveryLibraryPrompt,
} from "../src/domain/recovery.js";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { StructuredLogger } from "../src/observability/logger.js";
import type { RecoveryFailurePoint } from "../src/repositories/RecoveryRepository.js";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
});

function service(): { service: PromptVaultService; database: Database.Database } {
  const database = new Database(":memory:");
  databases.push(database);
  return {
    database,
    service: new PromptVaultService(database, {
      logger: new StructuredLogger({ level: "error" }),
    }),
  };
}

function sourcePrompt(
  slug = "restore-source",
  options: { tags?: string[]; secondVersion?: boolean; body?: string } = {},
): RecoveryLibraryPrompt {
  const body = options.body ?? "Original body";
  const versions = [{
    sourceId: "source-version-1",
    semanticVersion: "1.0.0",
    body,
    bodyHash: sha256(body),
    changelog: "Initial",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
  if (options.secondVersion) {
    versions.push({
      sourceId: "source-version-2",
      semanticVersion: "1.1.0",
      body: "Second body",
      bodyHash: sha256("Second body"),
      changelog: "Second",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  }
  return {
    id: "source-prompt",
    sourceId: "source-prompt",
    slug,
    title: "Restore source",
    description: "Complete history",
    category: "Safety",
    isFavorite: true,
    rating: 5,
    tags: options.tags ?? ["recovery"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: options.secondVersion
      ? "2026-01-02T00:00:00.000Z"
      : "2026-01-01T00:00:00.000Z",
    versions,
  };
}

function content(prompt: RecoveryLibraryPrompt): string {
  return serializeBackupDocument(
    buildBackupDocumentV2([prompt], "2026-02-01T00:00:00.000Z"),
  );
}

function snapshot(database: Database.Database): string {
  const tables = ["prompts", "prompt_versions", "tags", "prompt_tags"];
  return JSON.stringify(
    Object.fromEntries(
      tables.map((table) => [
        table,
        database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    ),
  );
}

async function previewOrThrow(service: PromptVaultService, source: string) {
  const preview = await service.previewBackupRestore(source);
  expect(preview.validation.valid).toBe(true);
  expect(preview.plan).toBeDefined();
  return preview.plan!;
}

describe("transactional recovery", () => {
  it.each<RecoveryFailurePoint>([
    "prompt-insertion",
    "version-insertion",
    "tag-insertion",
    "relationship-insertion",
  ])("rolls back the complete database after %s", async (failurePoint) => {
    const target = service();
    const source = content(sourcePrompt("rollback-new", { tags: ["alpha", "beta"] }));
    const plan = await previewOrThrow(target.service, source);
    const before = snapshot(target.database);
    await expect(
      target.service.executeBackupRestore({
        content: source,
        plan,
        policy: "skip-existing",
        failurePoint,
      }),
    ).rejects.toThrow("Injected recovery failure");
    expect(snapshot(target.database)).toBe(before);
  });

  it("rolls back copy creation", async () => {
    const target = service();
    await target.service.createPrompt({
      id: randomUUID(),
      slug: "copy-source",
      title: "Current source",
      body: "Current body",
      semanticVersion: "1.0.0",
      format: "markdown",
      tags: [],
    });
    const source = content(sourcePrompt("copy-source", { body: "Imported body" }));
    const plan = await previewOrThrow(target.service, source);
    const before = snapshot(target.database);
    await expect(
      target.service.executeBackupRestore({
        content: source,
        plan,
        policy: "import-as-copy",
        failurePoint: "copy-creation",
      }),
    ).rejects.toThrow("copy-creation");
    expect(snapshot(target.database)).toBe(before);
  });

  it("rolls back a missing-version merge", async () => {
    const target = service();
    await target.service.createPrompt({
      id: randomUUID(),
      slug: "merge-source",
      title: "Restore source",
      description: "Complete history",
      category: "Safety",
      isFavorite: true,
      rating: 5,
      body: "Original body",
      semanticVersion: "1.0.0",
      format: "markdown",
      tags: ["recovery"],
      changelog: "Initial",
    });
    const source = content(sourcePrompt("merge-source", { secondVersion: true }));
    const plan = await previewOrThrow(target.service, source);
    const before = snapshot(target.database);
    await expect(
      target.service.executeBackupRestore({
        content: source,
        plan,
        policy: "add-missing-versions",
        failurePoint: "version-merge",
      }),
    ).rejects.toThrow("version-merge");
    expect(snapshot(target.database)).toBe(before);
  });

  it("executes skip, merge, and deterministic copy policies with verified results", async () => {
    const target = service();
    const prompt = sourcePrompt("policy-source", { secondVersion: true });
    const source = content(prompt);
    const firstPlan = await previewOrThrow(target.service, source);
    await expect(
      target.service.executeBackupRestore({
        content: source,
        plan: firstPlan,
        policy: "skip-existing",
      }),
    ).resolves.toMatchObject({ newPrompts: 1, integrityResult: "ok" });

    const duplicatePlan = await previewOrThrow(target.service, source);
    await expect(
      target.service.executeBackupRestore({
        content: source,
        plan: duplicatePlan,
        policy: "skip-existing",
      }),
    ).resolves.toMatchObject({ skippedPrompts: 1, skippedVersions: 2 });

    const copyPlan = await previewOrThrow(target.service, source);
    await expect(
      target.service.executeBackupRestore({
        content: source,
        plan: copyPlan,
        policy: "import-as-copy",
      }),
    ).resolves.toMatchObject({ copiedPrompts: 1 });
    expect(
      target.database.prepare("SELECT slug FROM prompts ORDER BY slug").all(),
    ).toEqual([{ slug: "policy-source" }, { slug: "policy-source-imported" }]);
  });

  it("rejects a stale plan before mutation", async () => {
    const target = service();
    const source = content(sourcePrompt("stale-source"));
    const plan = await previewOrThrow(target.service, source);
    await target.service.createPrompt({
      id: randomUUID(),
      slug: "concurrent-change",
      title: "Concurrent change",
      body: "Changed library",
      semanticVersion: "1.0.0",
      format: "markdown",
      tags: [],
    });
    const before = snapshot(target.database);
    await expect(
      target.service.executeBackupRestore({
        content: source,
        plan,
        policy: "skip-existing",
      }),
    ).rejects.toThrow(/changed after preview/);
    expect(snapshot(target.database)).toBe(before);
  });
});
