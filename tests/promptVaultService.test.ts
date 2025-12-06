import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { DuplicatePromptError, PromptNotFoundError, ValidationError } from "../src/domain/errors.js";
import { PromptRepository } from "../src/repositories/PromptRepository.js";
import type { Prompt, PromptVersion, Tag } from "../src/domain/models.js";
import { StructuredLogger } from "../src/observability/logger.js";

function createService(): PromptVaultService {
  return new PromptVaultService(new Database(":memory:"), {
    logger: new StructuredLogger({ level: "error" }),
  });
}

describe("PromptVaultService", () => {
  it("creates and retrieves prompts", async () => {
    const service = createService();
    const id = randomUUID();
    const prompt = await service.createPrompt({
      id,
      slug: "test-prompt",
      title: "Test Prompt",
      description: "A prompt for testing",
      body: "Do something interesting.",
      semanticVersion: "1.0.0",
      tags: ["testing", "demo"],
      changelog: "Initial release",
    });

    const fetched = await service.getPrompt(id);
    expect(fetched.title).toEqual(prompt.title);
    expect(fetched.tags.map((tag) => tag.label)).toContain("testing");
    expect(fetched.latestVersion?.semanticVersion).toEqual("1.0.0");
    expect(fetched.createdAt.getTime()).toBeLessThanOrEqual(fetched.updatedAt.getTime());
  });

  it("validates prompt creation input", async () => {
    const service = createService();
    await expect(
      service.createPrompt({
        id: "not-a-uuid",
        slug: "invalid slug",
        title: "",
        description: "",
        body: "",
        semanticVersion: "1",
        tags: [],
        changelog: undefined,
      })
    ).rejects.toThrow(ValidationError);
  });

  it("throws when prompt is missing", async () => {
    const service = createService();
    await expect(service.getPrompt(randomUUID())).rejects.toThrow(PromptNotFoundError);
  });

  it("adds prompt versions", async () => {
    const service = createService();
    const prompt = await service.createPrompt({
      id: randomUUID(),
      slug: "versioned",
      title: "Versioned",
      description: undefined,
      body: "Initial",
      format: "markdown",
      semanticVersion: "1.0.0",
      tags: [],
      changelog: undefined,
    });

    const version = service.addVersion(prompt.id, "Updated", "1.1.0", "markdown", "Improvements");
    expect(version.semanticVersion).toEqual("1.1.0");
    const refreshed = await service.getPrompt(prompt.id);
    expect(refreshed.latestVersion?.semanticVersion).toEqual("1.1.0");
    expect(refreshed.tags).toHaveLength(0);
  });

  it("updates the prompt timestamp when recording a new version", async () => {
    const service = createService();
    const prompt = await service.createPrompt({
      id: randomUUID(),
      slug: "timed-version",
      title: "Timed",
      description: undefined,
      body: "Initial",
      format: "markdown",
      semanticVersion: "1.0.0",
      tags: [],
      changelog: undefined,
    });

    const initial = await service.getPrompt(prompt.id);

    vi.useFakeTimers();
    const future = new Date(initial.updatedAt.getTime() + 1_000);
    vi.setSystemTime(future);

    service.addVersion(prompt.id, "Updated body", "1.0.1", "markdown");

    vi.useRealTimers();
    const refreshed = await service.getPrompt(prompt.id);

    expect(refreshed.updatedAt.getTime()).toBeGreaterThan(initial.updatedAt.getTime());
    expect(refreshed.latestVersion?.semanticVersion).toEqual("1.0.1");
    expect(refreshed.latestVersion?.createdAt.getTime()).toEqual(
      refreshed.latestVersion?.updatedAt.getTime()
    );
  });

  it("supports prompt search", async () => {
    const service = createService();
    const prompt = await service.createPrompt({
      id: randomUUID(),
      slug: "searchable",
      title: "Searchable Prompt",
      description: "Find me",
      body: "Do this",
      semanticVersion: "1.0.0",
      tags: ["productivity"],
      changelog: undefined,
    });

    await service.tagPrompt(prompt.id, ["workflow"]);

    const result = await service.searchPrompts({ text: "searchable", tags: ["workflow"], page: 0, pageSize: 10 });
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].id).toEqual(prompt.id);
    expect(result.total).toBe(1);
    expect(result.prompts[0].tags.map((tag) => tag.label)).toEqual(["productivity", "workflow"]);
  });

  it("supports paginated prompt searches", async () => {
    const service = createService();
    const ids = Array.from({ length: 3 }, () => randomUUID());

    for (const [index, id] of ids.entries()) {
      await service.createPrompt({
        id,
        slug: `prompt-${index}`,
        title: `Prompt ${index}`,
        description: undefined,
        body: "Body",
        semanticVersion: "1.0.0",
        tags: [],
        changelog: undefined,
      });
    }

    const firstPage = await service.searchPrompts({ page: 0, pageSize: 2 });
    const secondPage = await service.searchPrompts({ page: 1, pageSize: 2 });

    expect(firstPage.prompts).toHaveLength(2);
    expect(secondPage.prompts).toHaveLength(1);
    expect(firstPage.total).toBe(3);
    expect(secondPage.total).toBe(3);
    expect(new Set([...firstPage.prompts, ...secondPage.prompts].map((prompt) => prompt.id))).toEqual(
      new Set(ids)
    );
  });

  it("prevents duplicate prompt slugs", async () => {
    const service = createService();
    const slug = "duplicate-slug";

    await service.createPrompt({
      id: randomUUID(),
      slug,
      title: "Original",
      description: undefined,
      body: "Body",
      semanticVersion: "1.0.0",
      tags: [],
      changelog: undefined,
    });

    await expect(
      service.createPrompt({
        id: randomUUID(),
        slug,
        title: "Duplicate",
        description: undefined,
        body: "Body",
        semanticVersion: "1.0.0",
        tags: [],
        changelog: undefined,
      })
    ).rejects.toThrow(DuplicatePromptError);
  });

  it("deduplicates tag labels when tagging prompts", async () => {
    const service = createService();
    const prompt = await service.createPrompt({
      id: randomUUID(),
      slug: "taggable",
      title: "Taggable",
      description: undefined,
      body: "Body",
      semanticVersion: "1.0.0",
      tags: ["Productivity"],
      changelog: undefined,
    });

    await service.tagPrompt(prompt.id, ["workflow", "Workflow", "  productivity  "]);
    const refreshed = await service.getPrompt(prompt.id);

    expect(refreshed.tags.map((tag) => tag.label)).toEqual(["Productivity", "workflow"]);
  });

  it("ignores no-op tag updates", async () => {
    const service = createService();
    const prompt = await service.createPrompt({
      id: randomUUID(),
      slug: "no-op-tags",
      title: "No-op Tags",
      description: undefined,
      body: "Body",
      semanticVersion: "1.0.0",
      tags: ["Focus"],
      changelog: undefined,
    });

    const baseline = await service.getPrompt(prompt.id);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(baseline.updatedAt.getTime() + 5_000));

    await service.tagPrompt(prompt.id, ["focus", " Focus "]);
    await service.tagPrompt(prompt.id, []);

    vi.useRealTimers();
    const refreshed = await service.getPrompt(prompt.id);

    expect(refreshed.tags.map((tag) => tag.label)).toEqual(["Focus"]);

    expect(refreshed.updatedAt.getTime()).toEqual(baseline.updatedAt.getTime());
  });

  it("removes tags when requested", async () => {
    const service = createService();
    const prompt = await service.createPrompt({
      id: randomUUID(),
      slug: "untaggable",
      title: "Untag",
      description: undefined,
      body: "Body",
      semanticVersion: "1.0.0",
      tags: ["Alpha", "Beta"],
      changelog: undefined,
    });

    const created = await service.getPrompt(prompt.id);
    expect(created.tags.map((tag) => tag.label)).toEqual(["Alpha", "Beta"]);

    vi.useFakeTimers();
    const future = new Date(created.updatedAt.getTime() + 10_000);
    vi.setSystemTime(future);

    await service.untagPrompt(prompt.id, ["beta", "unknown"]);

    vi.useRealTimers();
    const refreshed = await service.getPrompt(prompt.id);

    expect(refreshed.tags.map((tag) => tag.label)).toEqual(["Alpha"]);
    expect(refreshed.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
  });

  it("notifies registered plugins when prompts change", async () => {
    const plugin = {
      name: "test-plugin",
      setup: vi.fn(),
      onPromptCreated: vi.fn(),
      onVersionAdded: vi.fn(),
      onPromptTagged: vi.fn(),
      onPromptUntagged: vi.fn(),
    };
    const service = new PromptVaultService(new Database(":memory:"), {
      plugins: [plugin],
      logger: new StructuredLogger({ level: "error" }),
    });

    const promptId = randomUUID();
    await service.createPrompt({
      id: promptId,
      slug: "plugin-test",
      title: "Plugin Test",
      description: undefined,
      body: "Body",
      semanticVersion: "1.0.0",
      tags: ["alpha"],
      changelog: undefined,
    });

    service.addVersion(promptId, "Body 2", "1.0.1", "markdown");
    await service.tagPrompt(promptId, ["beta"]);
    await service.untagPrompt(promptId, ["beta"]);

    expect(plugin.setup).toHaveBeenCalled();
    expect(plugin.onPromptCreated).toHaveBeenCalled();
    expect(plugin.onVersionAdded).toHaveBeenCalled();
    expect(plugin.onPromptTagged).toHaveBeenCalled();
    expect(plugin.onPromptUntagged).toHaveBeenCalledWith({ promptId, labels: ["beta"] });
  });
});

describe("PromptRepository", () => {
  it("preserves existing tag metadata when reusing labels", () => {
    const database = new Database(":memory:");
    const repository = new PromptRepository(database);
    const timestamp = new Date();

    const prompt: Prompt = {
      id: randomUUID(),
      slug: "tag-cleanup",
      title: "Tag Cleanup",
      description: undefined,
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const version: PromptVersion = {
      id: randomUUID(),
      promptId: prompt.id,
      semanticVersion: "1.0.0",
      body: "Body",
      format: "markdown",
      changelog: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    repository.createPrompt(prompt, version);

    const originalTag: Tag = {
      id: randomUUID(),
      label: "Ops",
      description: "Operations team",
      createdAt: timestamp,
    };
    repository.upsertTags(prompt.id, [originalTag]);

    const initial = repository.getPromptById(prompt.id);
    expect(initial.tags[0]?.description).toBe("Operations team");

    const updatedTag: Tag = {
      id: originalTag.id,
      label: "Ops",
      description: undefined,
      createdAt: new Date(timestamp.getTime() + 1_000),
    };
    repository.upsertTags(prompt.id, [updatedTag]);

    const refreshed = repository.getPromptById(prompt.id);
    expect(refreshed.tags[0]?.description).toBe("Operations team");
  });

  it("removes tag links and cleans up unused tags", () => {
    const database = new Database(":memory:");
    const repository = new PromptRepository(database);
    const timestamp = new Date();

    const prompt: Prompt = {
      id: randomUUID(),
      slug: "tag-upsert",
      title: "Tag Upsert",
      description: undefined,
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const version: PromptVersion = {
      id: randomUUID(),
      promptId: prompt.id,
      semanticVersion: "1.0.0",
      body: "Body",
      format: "markdown",
      changelog: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    repository.createPrompt(prompt, version);

    const tags: Tag[] = [
      { id: randomUUID(), label: "Alpha", description: undefined, createdAt: timestamp },
      { id: randomUUID(), label: "Beta", description: undefined, createdAt: timestamp },
    ];

    repository.upsertTags(prompt.id, tags);

    repository.removeTags(prompt.id, ["beta"]);

    const refreshed = repository.getPromptById(prompt.id);

    expect(refreshed.tags.map((tag) => tag.label)).toEqual(["Alpha"]);

    const tagColumns = database.prepare("PRAGMA table_info(tags)").all() as { name: string }[];
    const labelColumn = tagColumns.some((column) => column.name === "label") ? "label" : "name";

    const remainingTagRow = database
      .prepare(`SELECT COUNT(*) as count FROM tags WHERE LOWER(${labelColumn}) = 'beta'`)
      .get() as { count: number };
    expect(remainingTagRow.count).toBe(0);
  });
});
