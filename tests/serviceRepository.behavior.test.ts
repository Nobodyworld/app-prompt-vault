import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PromptNotFoundError,
  ValidationError,
} from "../src/domain/errors.js";
import type {
  Prompt,
  PromptVersion,
} from "../src/domain/models.js";
import { resetCoreDb } from "../src/lib/platform-core.js";
import { StructuredLogger } from "../src/observability/logger.js";
import { PromptRepository } from "../src/repositories/PromptRepository.js";
import { PromptVaultService } from "../src/services/PromptVaultService.js";

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];
const originalTagDatabasePath = process.env.PROMPT_VAULT_TAG_DB_PATH;

function createService(
  options: ConstructorParameters<typeof PromptVaultService>[1] = {},
): PromptVaultService {
  const database = new Database(":memory:");
  databases.push(database);
  return new PromptVaultService(database, {
    logger: new StructuredLogger({ level: "error" }),
    ...options,
  });
}

async function createPrompt(
  service: PromptVaultService,
  slug = `prompt-${randomUUID().slice(0, 8)}`,
): Promise<Prompt> {
  return service.createPrompt({
    id: randomUUID(),
    slug,
    title: "Service Prompt",
    description: "Original description",
    category: "general",
    body: "Original body",
    format: "markdown",
    semanticVersion: "1.0.0",
    tags: ["Alpha", "Beta"],
  });
}

beforeEach(async () => {
  process.env.PROMPT_VAULT_TAG_DB_PATH = ":memory:";
  await resetCoreDb();
});

afterEach(async () => {
  await resetCoreDb();
  for (const database of databases.splice(0)) {
    if (database.open) {
      database.close();
    }
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  if (originalTagDatabasePath === undefined) {
    delete process.env.PROMPT_VAULT_TAG_DB_PATH;
  } else {
    process.env.PROMPT_VAULT_TAG_DB_PATH = originalTagDatabasePath;
  }
});

describe("PromptVaultService persistence and failure behavior", () => {
  it("updates, clears, and preserves omitted metadata and tag fields", async () => {
    const service = createService();
    const prompt = await createPrompt(service, "metadata-semantics");

    const updated = await service.updatePrompt(prompt.id, {
      title: "Updated title",
      description: "",
      category: "automation",
      isFavorite: true,
      rating: 5,
      tags: ["Beta", "Gamma"],
    });
    expect(updated).toMatchObject({
      title: "Updated title",
      description: "",
      category: "automation",
      isFavorite: true,
      rating: 5,
    });
    expect(updated.tags.map((tag) => tag.label)).toEqual(["Beta", "Gamma"]);

    const cleared = await service.updatePrompt(prompt.id, {
      rating: null,
      tags: [],
    });
    expect(cleared.title).toBe("Updated title");
    expect(cleared.category).toBe("automation");
    expect(cleared.rating ?? null).toBeNull();
    expect(cleared.tags).toEqual([]);

    await expect(
      service.updatePrompt(randomUUID(), { title: "Missing" }),
    ).rejects.toThrow(PromptNotFoundError);
    await expect(
      service.updatePrompt(prompt.id, { rating: 6 }),
    ).resolves.toMatchObject({ rating: 6 });
  });

  it("soft deletes, restores, rejects repeated restores, and permanently removes trash", async () => {
    const service = createService();
    const prompt = await createPrompt(service, "trash-lifecycle");
    const deletedAt = new Date("2026-03-04T05:06:07.000Z");

    service.softDeletePrompt(prompt.id, deletedAt);
    await expect(service.getPrompt(prompt.id)).rejects.toThrow(
      PromptNotFoundError,
    );
    const deleted = await service.getDeletedPrompts();
    expect(deleted).toEqual([
      expect.objectContaining({ id: prompt.id, deletedAt }),
    ]);

    service.restorePrompt(prompt.id);
    await expect(service.getPrompt(prompt.id)).resolves.toMatchObject({
      id: prompt.id,
      deletedAt: undefined,
    });
    expect(await service.getDeletedPrompts()).toEqual([]);
    expect(() => service.restorePrompt(prompt.id)).toThrow(
      PromptNotFoundError,
    );

    service.softDeletePrompt(prompt.id);
    service.permanentlyDeletePrompt(prompt.id);
    expect(await service.getDeletedPrompts()).toEqual([]);
    expect(() => service.permanentlyDeletePrompt(prompt.id)).toThrow(
      PromptNotFoundError,
    );
  });

  it("exports and imports JSON/YAML bundles with create, skip, update, and parse failures", async () => {
    const source = createService();
    const sourcePrompt = await createPrompt(source, "bundle-source");
    const jsonExport = await source.exportPromptBundle({
      format: "json",
      includeMetadata: true,
      promptIds: [sourcePrompt.id],
    });
    expect(jsonExport.mimeType).toBe("application/json");
    expect(JSON.parse(jsonExport.content)).toMatchObject({
      schemaVersion: 1,
      metadata: { source: "prompt-vault" },
      prompts: [{ slug: "bundle-source", body: "Original body" }],
    });
    const yamlExport = await source.exportPromptBundle({
      format: "yaml",
    });
    expect(yamlExport.mimeType).toBe("text/yaml");
    expect(yamlExport.content).toContain("schemaVersion: 1");

    const target = createService();
    await expect(
      target.importPromptBundle({
        format: "json",
        content: jsonExport.content,
      }),
    ).resolves.toEqual({ created: 1, updated: 0, skipped: 0 });
    await expect(
      target.importPromptBundle({
        format: "json",
        content: jsonExport.content,
        conflictStrategy: "skip",
      }),
    ).resolves.toEqual({ created: 0, updated: 0, skipped: 1 });

    const updatedBundle = JSON.parse(jsonExport.content);
    updatedBundle.prompts[0].title = "Imported update";
    updatedBundle.prompts[0].body = "Imported version body";
    updatedBundle.prompts[0].semanticVersion = "1.1.0";
    await expect(
      target.importPromptBundle({
        format: "json",
        content: JSON.stringify(updatedBundle),
        conflictStrategy: "addVersion",
      }),
    ).resolves.toEqual({ created: 0, updated: 1, skipped: 0 });
    const importedId = target
      .listAllPrompts()
      .then((prompts) => prompts[0].id);
    const imported = await target.getPrompt(await importedId);
    expect(imported).toMatchObject({
      title: "Imported update",
      latestVersion: {
        body: "Imported version body",
        semanticVersion: "1.1.0",
      },
    });
    expect(target.listPromptVersions(imported.id)).toHaveLength(2);

    await expect(
      target.importPromptBundle({ format: "json", content: "{" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      target.importPromptBundle({
        format: "yaml",
        content: "prompts:\n  - slug: x\n",
      }),
    ).rejects.toThrow();
  });

  it("imports and exports bundle files and reports deterministic filesystem failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pv-service-bundle-"));
    temporaryDirectories.push(directory);
    const source = createService();
    await createPrompt(source, "file-bundle-source");
    const nestedPath = join(directory, "nested", "bundle.json");

    await source.exportPromptBundleToFile(nestedPath, {
      format: "json",
      includeMetadata: true,
    });
    expect(JSON.parse(await readFile(nestedPath, "utf8")).prompts).toHaveLength(
      1,
    );

    const target = createService();
    await expect(
      target.importPromptBundleFromFile(nestedPath),
    ).resolves.toEqual({ created: 1, updated: 0, skipped: 0 });

    await expect(
      source.exportPromptBundleToFile(directory, { format: "json" }),
    ).rejects.toThrow();
    await writeFile(join(directory, "malformed.json"), "{");
    await expect(
      target.importPromptBundleFromFile(join(directory, "malformed.json")),
    ).rejects.toThrow(ValidationError);
  });
});

describe("PromptRepository transaction and storage failures", () => {
  it("rolls back a prompt insert when its initial version violates a constraint", () => {
    const database = new Database(":memory:");
    databases.push(database);
    const repository = new PromptRepository(database, {
      logger: new StructuredLogger({ level: "error" }),
    });
    const timestamp = new Date("2026-04-05T06:07:08.000Z");
    const firstPrompt: Prompt = {
      id: randomUUID(),
      slug: "transaction-first",
      title: "First",
      createdAt: timestamp,
      updatedAt: timestamp,
      tags: [],
    };
    const sharedVersionId = randomUUID();
    const firstVersion: PromptVersion = {
      id: sharedVersionId,
      promptId: firstPrompt.id,
      semanticVersion: "1.0.0",
      body: "First body",
      format: "markdown",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    repository.createPrompt(firstPrompt, firstVersion);

    const secondPrompt: Prompt = {
      ...firstPrompt,
      id: randomUUID(),
      slug: "transaction-second",
      title: "Second",
    };
    const conflictingVersion: PromptVersion = {
      ...firstVersion,
      promptId: secondPrompt.id,
    };

    expect(() =>
      repository.createPrompt(secondPrompt, conflictingVersion),
    ).toThrow();
    expect(repository.getPromptIdBySlug(secondPrompt.slug)).toBeNull();
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM prompts WHERE id = ?")
        .get(secondPrompt.id),
    ).toEqual({ count: 0 });
    expect(repository.getPromptIdBySlug(firstPrompt.slug)).toBe(
      firstPrompt.id,
    );
  });

  it("reports missing versions and closed-database operations", () => {
    const database = new Database(":memory:");
    const repository = new PromptRepository(database, {
      logger: new StructuredLogger({ level: "error" }),
    });
    databases.push(database);

    expect(() => repository.listPromptVersions(randomUUID())).toThrow(
      PromptNotFoundError,
    );
    expect(repository.hasTable("prompts")).toBe(true);
    expect(repository.hasTable("not_a_table")).toBe(false);

    database.close();
    expect(() => repository.getAllPrompts()).toThrow();
  });
});
