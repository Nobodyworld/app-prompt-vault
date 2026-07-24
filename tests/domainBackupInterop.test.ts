import { gzipSync } from "node:zlib";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertPromptContent,
  detectPromptFormat,
  validatePromptContent,
} from "../src/domain/conversion.js";
import {
  buildButtonsSwitchboardPayload as buildDomainButtonsPayload,
  buildPlannerBucketDraft as buildDomainPlannerDraft,
} from "../src/domain/interop.js";
import { SnapshotManager } from "../src/domain/snapshot.js";
import {
  buildButtonsSwitchboardPayload as buildLibraryButtonsPayload,
  buildPlannerBucketDraft as buildLibraryPlannerDraft,
} from "../src/lib/interop.js";
import type { Prompt } from "../src/domain/models.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prompt-vault-backup-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createPrompt(overrides: Partial<Prompt> = {}): Prompt {
  const now = new Date("2026-01-02T03:04:05.000Z");
  return {
    id: "prompt-1",
    slug: "example-prompt",
    title: "Example Prompt",
    description: "Example description",
    createdAt: now,
    updatedAt: now,
    tags: [
      {
        id: "tag-1",
        label: "quality",
        createdAt: now,
      },
    ],
    latestVersion: {
      id: "version-1",
      promptId: "prompt-1",
      semanticVersion: "1.0.0",
      body: "Use this prompt",
      format: "markdown",
      createdAt: now,
      updatedAt: now,
    },
    ...overrides,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SnapshotManager", () => {
  it("creates, validates, describes, and restores a compressed SQLite snapshot", async () => {
    const directory = await createTemporaryDirectory();
    const snapshotPath = join(directory, "vault.snapshot.gz");
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE records (
        id INTEGER PRIMARY KEY,
        label TEXT,
        optional_value TEXT,
        active INTEGER
      );
      CREATE TABLE empty_records (id INTEGER PRIMARY KEY);
      INSERT INTO records (id, label, optional_value, active)
      VALUES (1, 'Owner''s prompt', NULL, 1);
    `);

    try {
      await SnapshotManager.createSnapshot(database, snapshotPath);

      await expect(access(`${snapshotPath}.tmp`)).rejects.toThrow();
      expect(await SnapshotManager.validateSnapshot(snapshotPath)).toBe(true);
      const info = await SnapshotManager.getSnapshotInfo(snapshotPath);
      expect(info.size).toBeGreaterThan(0);
      expect(info.created).toBeInstanceOf(Date);
      expect(info.compressed).toBe(true);

      database.exec(`
        DELETE FROM records;
        INSERT INTO records (id, label, optional_value, active)
        VALUES (2, 'replacement', 'present', 0);
      `);

      await SnapshotManager.restoreSnapshot(snapshotPath, database);

      expect(
        database
          .prepare("SELECT id, label, optional_value, active FROM records")
          .all(),
      ).toEqual([
        {
          id: 1,
          label: "Owner's prompt",
          optional_value: null,
          active: 1,
        },
      ]);
      await expect(access(`${snapshotPath}.tmp`)).rejects.toThrow();
    } finally {
      database.close();
    }
  });

  it("continues past malformed restore statements while retaining valid rows", async () => {
    const directory = await createTemporaryDirectory();
    const snapshotPath = join(directory, "partial.snapshot.gz");
    const database = new Database(":memory:");
    database.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT)");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(
      snapshotPath,
      gzipSync(
        "INSERT INTO records (id, label) VALUES (1, 'valid');" +
          "INSERT INTO missing_table (id) VALUES (2);",
      ),
    );

    try {
      await SnapshotManager.restoreSnapshot(snapshotPath, database);
      expect(
        database.prepare("SELECT id, label FROM records").all(),
      ).toEqual([{ id: 1, label: "valid" }]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO missing_table"),
        expect.any(Error),
      );
    } finally {
      database.close();
    }
  });

  it("rejects empty, plain-text, missing, and non-SQL gzip snapshots", async () => {
    const directory = await createTemporaryDirectory();
    const emptyPath = join(directory, "empty.gz");
    const textPath = join(directory, "plain.txt");
    const nonSqlPath = join(directory, "not-sql.gz");
    await writeFile(emptyPath, "");
    await writeFile(textPath, "not compressed");
    await writeFile(nonSqlPath, gzipSync("SELECT 1;"));

    expect(await SnapshotManager.validateSnapshot(emptyPath)).toBe(false);
    expect(await SnapshotManager.validateSnapshot(textPath)).toBe(false);
    expect(await SnapshotManager.validateSnapshot(nonSqlPath)).toBe(false);
    expect(
      await SnapshotManager.validateSnapshot(join(directory, "missing.gz")),
    ).toBe(false);

    const info = await SnapshotManager.getSnapshotInfo(textPath);
    expect(info.compressed).toBe(false);
    expect(await readFile(textPath, "utf8")).toBe("not compressed");
  });
});

describe("prompt format conversion", () => {
  it("converts between markdown, JSON, and YAML without changing same-format input", () => {
    const markdown = "# Heading\nBody";
    const json = convertPromptContent(markdown, "markdown", "json");
    expect(JSON.parse(json)).toEqual({ content: markdown });
    expect(convertPromptContent(json, "json", "markdown")).toBe(markdown);

    const yaml = convertPromptContent(json, "json", "yaml");
    expect(yaml).toContain("content:");
    expect(
      JSON.parse(convertPromptContent(yaml, "yaml", "json")),
    ).toEqual({ content: markdown });
    expect(convertPromptContent(markdown, "markdown", "markdown")).toBe(
      markdown,
    );
    expect(convertPromptContent('{"name":"prompt"}', "json", "markdown")).toBe(
      "name: prompt\n",
    );
  });

  it("detects supported formats and falls back to markdown for ambiguous input", () => {
    expect(detectPromptFormat('{"name":"prompt"}')).toBe("json");
    expect(detectPromptFormat("[1,2,3]")).toBe("json");
    expect(detectPromptFormat("{invalid}")).toBe("markdown");
    expect(detectPromptFormat("name: prompt\nitems:\n  - one")).toBe("yaml");
    expect(detectPromptFormat("- one\n- two")).toBe("yaml");
    expect(detectPromptFormat("# Heading\nFree text")).toBe("markdown");
  });

  it("validates supported formats and reports parse and format failures", () => {
    expect(validatePromptContent('{"valid":true}', "json")).toBe(true);
    expect(validatePromptContent("valid: true", "yaml")).toBe(true);
    expect(validatePromptContent("anything", "markdown")).toBe(true);

    expect(() => validatePromptContent("{", "json")).toThrow(
      "Invalid json content",
    );
    expect(() =>
      convertPromptContent("{", "json", "markdown"),
    ).toThrow("Failed to parse json content");
    expect(() =>
      convertPromptContent("body", "unsupported" as "markdown", "json"),
    ).toThrow("Failed to parse unsupported content");
    expect(() =>
      convertPromptContent("body", "markdown", "unsupported" as "json"),
    ).toThrow("Failed to serialize to unsupported");
    expect(() =>
      validatePromptContent("body", "unsupported" as "markdown"),
    ).toThrow("Invalid unsupported content");
  });
});

describe("domain and library interoperability payloads", () => {
  const implementations = [
    {
      name: "domain",
      buttons: buildDomainButtonsPayload,
      planner: buildDomainPlannerDraft,
      expectedTitle: "Prompt Vault x Buttons",
    },
    {
      name: "library",
      buttons: buildLibraryButtonsPayload,
      planner: buildLibraryPlannerDraft,
      expectedTitle: "Prompt Vault Quick Phrases",
    },
  ] as const;

  for (const implementation of implementations) {
    it(`${implementation.name} returns null for empty usable input`, () => {
      expect(implementation.buttons([])).toBeNull();
      expect(
        implementation.buttons([
          createPrompt({ latestVersion: undefined }),
        ]),
      ).toBeNull();
      expect(implementation.planner([])).toBeNull();
    });

    it(`${implementation.name} limits and maps switchboard and planner records`, () => {
      vi.spyOn(Date, "now").mockReturnValue(123_456);
      const prompts = [
        createPrompt(),
        createPrompt({
          id: "prompt-2",
          slug: "fallback-title",
          title: "",
          tags: [],
          latestVersion: {
            ...createPrompt().latestVersion!,
            id: "version-2",
            promptId: "prompt-2",
            body: "Second body",
          },
        }),
      ];

      const buttons = implementation.buttons(prompts, 1);
      expect(buttons).toMatchObject({
        id: "pv-switchboard-123456",
        title: implementation.expectedTitle,
        context: { type: "global" },
        isEnabled: true,
      });
      expect(buttons?.switchboard.phrases).toEqual([
        {
          id: "prompt-1",
          label: "Example Prompt",
          value: "Use this prompt",
        },
      ]);

      const planner = implementation.planner(prompts, 2);
      expect(planner).toMatchObject({
        name: "Prompt Vault Picks",
        source: "prompt-vault",
        tags: ["prompt-vault", "import"],
      });
      expect(planner?.tasks).toEqual([
        {
          title: "Use: Example Prompt",
          note: "Use this prompt",
          tags: ["prompt-vault", "quality"],
        },
        {
          title: "Use: ",
          note: "Second body",
          tags: ["prompt-vault"],
        },
      ]);
    });
  }
});
