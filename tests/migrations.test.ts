import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { PromptRepository } from "../src/repositories/PromptRepository.js";

function listIndexNames(database: Database.Database, table: string): string[] {
  const rows = database.prepare(`PRAGMA index_list('${table}')`).all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe("database migrations", () => {
  it("applies all SQL files in order", () => {
    const database = new Database(":memory:");
    // eslint-disable-next-line no-new -- Constructor applies migrations synchronously.
    new PromptRepository(database);

    const promptIndexes = listIndexNames(database, "prompts");
    const versionIndexes = listIndexNames(database, "prompt_versions");
    const tagIndexes = listIndexNames(database, "tags");
    const promptTagIndexes = listIndexNames(database, "prompt_tags");

    expect(promptIndexes).toContain("idx_prompts_updated_at");
    expect(versionIndexes).toContain("idx_prompt_versions_prompt_id_created_at");
    expect(tagIndexes).toContain("idx_tags_label_lower");
    expect(promptTagIndexes).toContain("idx_prompt_tags_tag_id");

    database.close();
  });
});
