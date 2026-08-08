import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  buildBackupDocumentV2,
  buildRestorePlan,
  fingerprintLibrary,
  parseBackupText,
  serializeBackupDocument,
  sha256,
  validateBackupValue,
  verifyBackupExport,
  versionIdentity,
  type RecoveryLibraryPrompt,
} from "../src/domain/recovery.js";

const firstVersion = {
  sourceId: "version-1",
  semanticVersion: "1.0.0",
  body: "Original body",
  bodyHash: sha256("Original body"),
  changelog: "Initial version",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

const secondVersion = {
  sourceId: "version-2",
  semanticVersion: "1.1.0",
  body: "Updated body",
  bodyHash: sha256("Updated body"),
  changelog: null,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
} as const;

function libraryPrompt(
  id: string,
  slug: string,
  overrides: Partial<RecoveryLibraryPrompt> = {},
): RecoveryLibraryPrompt {
  return {
    id,
    sourceId: id,
    slug,
    title: `Title ${slug}`,
    description: null,
    category: null,
    isFavorite: false,
    rating: null,
    tags: ["zeta", "Alpha"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    versions: [secondVersion, firstVersion],
    ...overrides,
  };
}

describe("backup 2.0", () => {
  it("serializes every version with deterministic prompt, tag, and version ordering", () => {
    const document = buildBackupDocumentV2(
      [libraryPrompt("b", "zulu"), libraryPrompt("a", "alpha")],
      "2026-02-01T00:00:00.000Z",
    );
    expect(document).toMatchObject({
      format: BACKUP_FORMAT,
      version: "2.0",
      summary: { promptCount: 2, versionCount: 4 },
    });
    expect(document.prompts.map((prompt) => prompt.slug)).toEqual(["alpha", "zulu"]);
    expect(document.prompts[0].tags).toEqual(["Alpha", "zeta"]);
    expect(document.prompts[0].versions.map((version) => version.semanticVersion)).toEqual([
      "1.0.0",
      "1.1.0",
    ]);
    expect(document.prompts[0].versions[0].changelog).toBe("Initial version");
    expect(verifyBackupExport(document)).toEqual({
      verified: true,
      promptCount: 2,
      versionCount: 4,
      deterministicOrdering: true,
      errors: [],
    });
  });

  it("changes only exportedAt between otherwise identical exports", () => {
    const prompt = libraryPrompt("a", "alpha");
    const first = buildBackupDocumentV2([prompt], "2026-02-01T00:00:00.000Z");
    const second = buildBackupDocumentV2([prompt], "2026-02-02T00:00:00.000Z");
    expect({ ...first, exportedAt: "ignored" }).toEqual({ ...second, exportedAt: "ignored" });
  });

  it.each([
    ["invalid JSON", "{"],
    ["unsupported version", JSON.stringify({ format: BACKUP_FORMAT, version: "3.0", prompts: [] })],
    ["invalid timestamp", JSON.stringify({
      format: BACKUP_FORMAT,
      version: "2.0",
      exportedAt: "not-a-date",
      summary: { promptCount: 0, versionCount: 0 },
      prompts: [],
    })],
  ])("rejects %s", (_label, content) => {
    expect(parseBackupText(content).valid).toBe(false);
  });

  it("rejects invalid ratings, malformed semantic versions, duplicate prompts, and duplicate version identities", () => {
    const document = buildBackupDocumentV2([libraryPrompt("a", "alpha")], "2026-02-01T00:00:00.000Z");
    const invalid = structuredClone(document) as unknown as {
      prompts: Array<{ rating: number; versions: unknown[] }>;
      summary: { promptCount: number; versionCount: number };
    };
    invalid.prompts[0].rating = 8;
    const duplicate = structuredClone((document.prompts as unknown[])[0]) as { versions: unknown[] };
    duplicate.versions[0] = { ...(duplicate.versions[0] as object), semanticVersion: "not-semver" };
    invalid.prompts.push(duplicate as never);
    invalid.summary.promptCount = 2;
    invalid.summary.versionCount = 4;
    const result = validateBackupValue(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/rating/);
    expect(result.errors.join(" ")).toMatch(/MAJOR\.MINOR\.PATCH/);
    expect(result.errors.join(" ")).toMatch(/duplicate prompt slug/);

    const duplicateVersion = structuredClone(document) as unknown as {
      prompts: Array<{ versions: unknown[] }>;
      summary: { versionCount: number };
    };
    duplicateVersion.prompts[0].versions.push(duplicateVersion.prompts[0].versions[0]);
    duplicateVersion.summary.versionCount = 3;
    expect(validateBackupValue(duplicateVersion).errors.join(" ")).toMatch(/duplicate version identity/);
  });

  it("accepts 1.0 as latest-version-only without inventing history", () => {
    const result = validateBackupValue({
      version: "1.0",
      exportedAt: "2026-02-01T00:00:00.000Z",
      prompts: [{
        id: "legacy-id",
        slug: "legacy-prompt",
        title: "Legacy prompt",
        body: "Only available body",
        version: "1.2.3",
        tags: ["legacy"],
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      }],
    });
    expect(result.valid).toBe(true);
    expect(result.latestVersionOnly).toBe(true);
    expect(result.document?.historyCoverage).toBe("latest-version-only");
    expect(result.document?.prompts[0].versions).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/only the latest/i);
  });
});

describe("deterministic restore planning", () => {
  it("keeps document, empty-library, and plan fingerprints compatible with native Rust", () => {
    const document = validateBackupValue(buildBackupDocumentV2([{
      id: "legacy-prompt",
      sourceId: "legacy-prompt",
      slug: "cross-runtime",
      title: "Recovery fixture",
      description: "Disposable source",
      category: "Safety",
      isFavorite: true,
      rating: 5,
      tags: ["alpha", "recovery"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      versions: [
        {
          sourceId: "legacy-version-1",
          semanticVersion: "1.0.0",
          body: "Original recovery body",
          bodyHash: sha256("Original recovery body"),
          changelog: "Initial",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          sourceId: "legacy-version-2",
          semanticVersion: "1.1.0",
          body: "Second recovery body",
          bodyHash: sha256("Second recovery body"),
          changelog: "Second",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    }], "2026-02-01T00:00:00.000Z")).document!;
    const plan = buildRestorePlan(document, []);
    expect(plan.documentFingerprint).toBe(
      "c4a8cf76a152881df929c7133478333fedfaed60a83370aabcd0fc3fc6170093",
    );
    expect(plan.currentLibraryFingerprint).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    );
    expect(plan.planId).toBe(
      "136afdad207d9b65aa4a17204ac0651ad50182210760b7b695633454f3f71b79",
    );
  });

  it("classifies new, duplicate, slug, mergeable, and copy-required entries", () => {
    const current = [
      libraryPrompt("exact", "exact"),
      libraryPrompt("metadata", "metadata"),
      libraryPrompt("merge", "merge", { versions: [firstVersion] }),
      libraryPrompt("copy", "copy", { versions: [firstVersion] }),
    ];
    const sources = [
      libraryPrompt("source-new", "new"),
      libraryPrompt("source-exact", "exact"),
      libraryPrompt("source-metadata", "metadata", { title: "Changed metadata" }),
      libraryPrompt("source-merge", "merge"),
      libraryPrompt("source-copy", "copy", {
        versions: [{ ...firstVersion, body: "Conflicting body", bodyHash: sha256("Conflicting body") }],
      }),
    ];
    const document = validateBackupValue(buildBackupDocumentV2(sources, "2026-03-01T00:00:00.000Z")).document;
    expect(document).toBeDefined();
    const plan = buildRestorePlan(document!, current);
    expect(Object.fromEntries(plan.entries.map((entry) => [entry.sourceSlug, entry.kind]))).toEqual({
      copy: "copy-required-conflict",
      exact: "existing-exact-duplicate",
      merge: "mergeable-missing-versions",
      metadata: "existing-slug-conflict",
      new: "new-prompt",
    });
    expect(plan.entries.find((entry) => entry.sourceSlug === "copy")?.copySlug).toBe("copy-imported");
  });

  it("generates stable non-colliding copy slugs from database state and plan order", () => {
    const current = [
      libraryPrompt("one", "alpha"),
      libraryPrompt("two", "alpha-imported"),
      libraryPrompt("three", "alpha-imported-2"),
    ];
    const document = validateBackupValue(buildBackupDocumentV2([
      libraryPrompt("source", "alpha", { versions: [{ ...firstVersion, body: "Different", bodyHash: sha256("Different") }] }),
    ], "2026-03-01T00:00:00.000Z")).document!;
    const first = buildRestorePlan(document, current);
    const second = buildRestorePlan(document, [...current].reverse());
    expect(first.entries[0].copySlug).toBe("alpha-imported-3");
    expect(second).toEqual(first);
  });

  it("changes the library fingerprint for metadata, tag, or version changes", () => {
    const prompt = libraryPrompt("one", "alpha");
    const original = fingerprintLibrary([prompt]);
    expect(fingerprintLibrary([{ ...prompt, title: "Changed" }])).not.toBe(original);
    expect(fingerprintLibrary([{ ...prompt, tags: ["different"] }])).not.toBe(original);
    expect(fingerprintLibrary([{ ...prompt, versions: [firstVersion] }])).not.toBe(original);
  });

  it("uses normalized semantic version and body hash as version identity", () => {
    expect(versionIdentity(firstVersion)).toBe(`1.0.0\u0000${sha256("Original body")}`);
    expect(versionIdentity({ ...firstVersion, body: "different", bodyHash: sha256("different") })).not.toBe(versionIdentity(firstVersion));
  });
});
