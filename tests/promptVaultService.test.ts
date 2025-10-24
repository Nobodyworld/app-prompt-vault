import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { PromptNotFoundError, ValidationError } from "../src/domain/errors.js";

function createService(): PromptVaultService {
  return new PromptVaultService(new Database(":memory:"));
}

describe("PromptVaultService", () => {
  it("creates and retrieves prompts", () => {
    const service = createService();
    const id = randomUUID();
    const prompt = service.createPrompt({
      id,
      slug: "test-prompt",
      title: "Test Prompt",
      description: "A prompt for testing",
      body: "Do something interesting.",
      semanticVersion: "1.0.0",
      tags: ["testing", "demo"],
      changelog: "Initial release",
    });

    const fetched = service.getPrompt(id);
    expect(fetched.title).toEqual(prompt.title);
    expect(fetched.tags.map((tag) => tag.label)).toContain("testing");
    expect(fetched.latestVersion?.semanticVersion).toEqual("1.0.0");
  });

  it("validates prompt creation input", () => {
    const service = createService();
    expect(() =>
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
    ).toThrow(ValidationError);
  });

  it("throws when prompt is missing", () => {
    const service = createService();
    expect(() => service.getPrompt(randomUUID())).toThrow(PromptNotFoundError);
  });

  it("adds prompt versions", () => {
    const service = createService();
    const prompt = service.createPrompt({
      id: randomUUID(),
      slug: "versioned",
      title: "Versioned Prompt",
      description: undefined,
      body: "Initial",
      semanticVersion: "1.0.0",
      tags: [],
      changelog: undefined,
    });

    const version = service.addVersion(prompt.id, "Updated", "1.1.0", "Improvements");
    expect(version.semanticVersion).toEqual("1.1.0");
    const refreshed = service.getPrompt(prompt.id);
    expect(refreshed.latestVersion?.semanticVersion).toEqual("1.1.0");
  });

  it("supports prompt search", () => {
    const service = createService();
    const prompt = service.createPrompt({
      id: randomUUID(),
      slug: "searchable",
      title: "Searchable Prompt",
      description: "Find me",
      body: "Do this",
      semanticVersion: "1.0.0",
      tags: ["productivity"],
      changelog: undefined,
    });

    service.tagPrompt(prompt.id, ["workflow"]);

    const result = service.searchPrompts({ text: "searchable", tags: ["workflow"], page: 0, pageSize: 10 });
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].id).toEqual(prompt.id);
  });
});
