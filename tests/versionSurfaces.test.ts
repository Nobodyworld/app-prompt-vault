import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prepareRelease } from "../scripts/release-prepare.js";
import {
  MANAGED_VERSION_PATHS,
  assertVersionSurfaces,
  readVersionSurfaces,
  synchronizeVersionSurfaces,
} from "../scripts/version-surfaces.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureRoots: string[] = [];

function write(root: string, path: string, content: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function createFixture(version = "0.2.0"): string {
  const root = mkdtempSync(join(tmpdir(), "prompt-vault-version-surfaces-"));
  fixtureRoots.push(root);
  write(
    root,
    "package.json",
    `${JSON.stringify({ name: "fixture", version, private: true, untouched: "package marker" }, null, 2)}\n`,
  );
  write(
    root,
    "src-tauri/tauri.conf.json",
    `${JSON.stringify({ productName: "Fixture", version, identifier: "com.example.untouched" }, null, 2)}\n`,
  );
  write(
    root,
    "src-tauri/Cargo.toml",
    `[package]\nname = "prompt-vault-app"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\nserde = "1.0"\n`,
  );
  write(
    root,
    "src-tauri/Cargo.lock",
    `version = 4\n\n[[package]]\nname = "serde"\nversion = "1.0.999"\nsource = "registry+https://example.invalid"\nchecksum = "untouched-checksum"\n\n[[package]]\nname = "prompt-vault-app"\nversion = "${version}"\ndependencies = [\n "serde",\n]\n`,
  );
  write(
    root,
    "src/version.ts",
    `/** untouched runtime comment */\nexport const APPLICATION_VERSION = "${version}";\n`,
  );
  write(
    root,
    "project-stage-snapshot.md",
    `# Snapshot\n\n**Current application version:** ${version}\n\nUntouched snapshot detail.\n`,
  );
  write(root, "CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\nFuture work.\n");
  write(root, "docs/releases/notes.md", "# Prompt Vault Release Notes\n\nHistorical notes.\n");
  return root;
}

function readManaged(root: string): Record<string, string> {
  return Object.fromEntries(
    Object.values(MANAGED_VERSION_PATHS).map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
  );
}

function readPreparationFiles(root: string): Record<string, string> {
  return {
    ...readManaged(root),
    "CHANGELOG.md": readFileSync(resolve(root, "CHANGELOG.md"), "utf8"),
    "docs/releases/notes.md": readFileSync(resolve(root, "docs/releases/notes.md"), "utf8"),
  };
}

afterEach(() => {
  while (fixtureRoots.length > 0) {
    const root = fixtureRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("application version surfaces", () => {
  it("synchronizes every managed surface to a valid requested version", () => {
    const root = createFixture();
    const changed = synchronizeVersionSurfaces(root, "0.4.0");

    expect(changed).toEqual(Object.values(MANAGED_VERSION_PATHS));
    expect(Object.values(readVersionSurfaces(root).versions)).toEqual(
      Array(Object.keys(MANAGED_VERSION_PATHS).length).fill("0.4.0"),
    );
  });

  it("uses package.json as canonical when no requested version is supplied", () => {
    const root = createFixture("0.4.0");
    write(root, "src/version.ts", 'export const APPLICATION_VERSION = "0.3.0";\n');

    synchronizeVersionSurfaces(root);

    expect(assertVersionSurfaces(root).canonicalVersion).toBe("0.4.0");
    expect(readFileSync(resolve(root, "src/version.ts"), "utf8")).toContain('"0.4.0"');
  });

  it("updates the CLI runtime module, Tauri config, Cargo package, and local lock package", () => {
    const root = createFixture();
    synchronizeVersionSurfaces(root, "1.2.3");

    expect(readFileSync(resolve(root, "src/version.ts"), "utf8")).toContain('"1.2.3"');
    expect(JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"))).toMatchObject({
      version: "1.2.3",
      identifier: "com.example.untouched",
    });
    expect(readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8")).toContain(
      'name = "prompt-vault-app"\nversion = "1.2.3"',
    );
    expect(readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8")).toContain(
      'name = "prompt-vault-app"\nversion = "1.2.3"',
    );
  });

  it("changes only local package metadata in Cargo.lock", () => {
    const root = createFixture();
    const before = readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8");
    synchronizeVersionSurfaces(root, "0.4.0");
    const after = readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8");

    expect(after.replace('version = "0.4.0"', 'version = "0.2.0"')).toBe(before);
    expect(after).toContain('checksum = "untouched-checksum"');
  });

  it("is idempotent on repeated synchronization", () => {
    const root = createFixture();
    synchronizeVersionSurfaces(root, "0.4.0");
    const once = readManaged(root);

    expect(synchronizeVersionSurfaces(root, "0.4.0")).toEqual([]);
    expect(readManaged(root)).toEqual(once);
  });

  it("rejects an invalid semantic version before any write", () => {
    const root = createFixture();
    const before = readManaged(root);

    expect(() => synchronizeVersionSurfaces(root, "01.4.0")).toThrow(/strict MAJOR\.MINOR\.PATCH/);
    expect(readManaged(root)).toEqual(before);
  });

  it("fails closed when the Cargo.toml target is missing or duplicated", () => {
    const missing = createFixture();
    write(missing, "src-tauri/Cargo.toml", '[package]\nname = "different-app"\nversion = "0.2.0"\n');
    expect(() => synchronizeVersionSurfaces(missing, "0.4.0")).toThrow(/uniquely name prompt-vault-app/);

    const duplicate = createFixture();
    write(
      duplicate,
      "src-tauri/Cargo.toml",
      '[package]\nname = "prompt-vault-app"\nversion = "0.2.0"\n\n[package]\nname = "prompt-vault-app"\nversion = "0.2.0"\n',
    );
    expect(() => synchronizeVersionSurfaces(duplicate, "0.4.0")).toThrow(/exactly one \[package\] section/);
  });

  it("fails closed when the Cargo.lock local target is missing or duplicated", () => {
    const missing = createFixture();
    write(missing, "src-tauri/Cargo.lock", 'version = 4\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n');
    expect(() => synchronizeVersionSurfaces(missing, "0.4.0")).toThrow(/prompt-vault-app package block; found 0/);

    const duplicate = createFixture();
    const block = '[[package]]\nname = "prompt-vault-app"\nversion = "0.2.0"\n';
    write(duplicate, "src-tauri/Cargo.lock", `version = 4\n\n${block}\n${block}`);
    expect(() => synchronizeVersionSurfaces(duplicate, "0.4.0")).toThrow(/prompt-vault-app package block; found 2/);
  });

  it.each([
    ["malformed JSON", "package.json", '{ "version": "0.2.0",'],
    ["malformed TOML target", "src-tauri/Cargo.toml", '[package]\nname = "prompt-vault-app"\nversion = 0.2.0\n'],
    ["malformed lock block", "src-tauri/Cargo.lock", 'version = 4\n\n[[package]]\nname = "prompt-vault-app"\n'],
  ])("rejects %s before writing", (_label, path, content) => {
    const root = createFixture();
    write(root, path, content);
    const before = readManaged(root);

    expect(() => synchronizeVersionSurfaces(root, "0.4.0")).toThrow();
    expect(readManaged(root)).toEqual(before);
  });

  it("preserves unrelated content in every managed file", () => {
    const root = createFixture();
    synchronizeVersionSurfaces(root, "0.4.0");

    expect(readFileSync(resolve(root, "package.json"), "utf8")).toContain('"untouched": "package marker"');
    expect(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8")).toContain(
      '"identifier": "com.example.untouched"',
    );
    expect(readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8")).toContain('serde = "1.0"');
    expect(readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8")).toContain("untouched-checksum");
    expect(readFileSync(resolve(root, "src/version.ts"), "utf8")).toContain("untouched runtime comment");
    expect(readFileSync(resolve(root, "project-stage-snapshot.md"), "utf8")).toContain(
      "Untouched snapshot detail.",
    );
  });

  it("detects one intentionally mismatched surface in check-only behavior", () => {
    const root = createFixture("0.4.0");
    write(
      root,
      "src-tauri/tauri.conf.json",
      '{\n  "productName": "Fixture",\n  "version": "0.3.0",\n  "identifier": "com.example.untouched"\n}\n',
    );

    expect(() => assertVersionSurfaces(root)).toThrow(
      /tauri\.conf\.json=0\.3\.0/,
    );
  });
});

describe("release preparation", () => {
  it("synchronizes all surfaces and scaffolds source-preview notes without publication claims", () => {
    const root = createFixture();
    const result = prepareRelease(root, "0.4.0", "2026-08-27");
    const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
    const notes = readFileSync(resolve(root, "docs/releases/notes.md"), "utf8");

    expect(result.changedPaths).toEqual([
      ...Object.values(MANAGED_VERSION_PATHS),
      "CHANGELOG.md",
      "docs/releases/notes.md",
    ]);
    expect(assertVersionSurfaces(root).canonicalVersion).toBe("0.4.0");
    expect(changelog).toContain("Source-preview application milestone");
    expect(changelog).toContain("does not imply a Git tag, GitHub Release");
    expect(notes).toContain("No Git tag or GitHub Release is created or implied.");
    expect(notes).toContain("Unsigned build artifacts remain local validation evidence only.");
    expect(notes).not.toContain("before publishing");
  });

  it("validates release documents before writing any version surface", () => {
    const root = createFixture();
    write(root, "CHANGELOG.md", "not a changelog\n");
    const before = readManaged(root);

    expect(() => prepareRelease(root, "0.4.0", "2026-08-27")).toThrow(/CHANGELOG\.md/);
    expect(readManaged(root)).toEqual(before);
  });

  it("preserves the complete Unreleased body and historical sections around a new milestone", () => {
    const root = createFixture();
    const unreleased = [
      "## [Unreleased]",
      "",
      "- Future work remains pending.",
      "- A second pending line remains unclassified.",
      "",
    ].join("\n");
    const historical = [
      "## [0.4.0] - 2026-08-27",
      "",
      "### Fixed",
      "",
      "- Historical text stays byte-identical.",
      "",
    ].join("\n");
    write(root, "CHANGELOG.md", `# Changelog\n\n${unreleased}${historical}`);

    prepareRelease(root, "0.5.0", "2026-09-01");
    const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
    const generatedStart = changelog.indexOf("## [0.5.0]");
    const historicalStart = changelog.indexOf("## [0.4.0]");
    const generated = changelog.slice(generatedStart, historicalStart);

    expect(changelog.startsWith(`# Changelog\n\n${unreleased}## [0.5.0]`)).toBe(true);
    expect(changelog.endsWith(historical)).toBe(true);
    expect(generated).not.toContain("Future work remains pending.");
    expect(generated).not.toContain("A second pending line remains unclassified.");
  });

  it("is fully idempotent for the same version and date", () => {
    const root = createFixture();
    prepareRelease(root, "0.4.0", "2026-08-27");
    const once = readPreparationFiles(root);

    const second = prepareRelease(root, "0.4.0", "2026-08-27");
    const twice = readPreparationFiles(root);

    expect(second.changedPaths).toEqual([]);
    expect(twice).toEqual(once);
    expect(twice["CHANGELOG.md"].match(/^## \[0\.4\.0\]/gm)).toHaveLength(1);
    expect(twice["docs/releases/notes.md"].match(/^## 0\.4\.0 source-preview milestone/gm)).toHaveLength(1);
  });

  it("rejects a conflicting milestone date before writing any file", () => {
    const root = createFixture();
    prepareRelease(root, "0.4.0", "2026-08-27");
    write(root, "src/version.ts", 'export const APPLICATION_VERSION = "0.2.0";\n');
    const before = readPreparationFiles(root);

    expect(() => prepareRelease(root, "0.4.0", "2026-08-28")).toThrow(
      /application version 0\.4\.0 already exists with date 2026-08-27; requested 2026-08-28/,
    );
    expect(readPreparationFiles(root)).toEqual(before);
  });

  it("rejects a conflicting release-note date before writing any file", () => {
    const root = createFixture();
    prepareRelease(root, "0.4.0", "2026-08-27");
    const changelogPath = resolve(root, "CHANGELOG.md");
    write(
      root,
      "CHANGELOG.md",
      readFileSync(changelogPath, "utf8").replace(
        "## [0.4.0] - 2026-08-27",
        "## [0.4.0] - 2026-08-28",
      ),
    );
    write(root, "src/version.ts", 'export const APPLICATION_VERSION = "0.2.0";\n');
    const before = readPreparationFiles(root);

    expect(() => prepareRelease(root, "0.4.0", "2026-08-28")).toThrow(
      /docs\/releases\/notes\.md: application version 0\.4\.0 already exists with date 2026-08-27; requested 2026-08-28/,
    );
    expect(readPreparationFiles(root)).toEqual(before);
  });

  it("rejects duplicate requested-version changelog headings before writing", () => {
    const root = createFixture();
    write(
      root,
      "CHANGELOG.md",
      "# Changelog\n\n## [Unreleased]\n\nFuture work.\n\n## [0.4.0] - 2026-08-27\n\nOne.\n\n## [0.4.0] - 2026-08-27\n\nTwo.\n",
    );
    const before = readPreparationFiles(root);

    expect(() => prepareRelease(root, "0.4.0", "2026-08-27")).toThrow(
      /CHANGELOG\.md: duplicate milestone headings/,
    );
    expect(readPreparationFiles(root)).toEqual(before);
  });

  it("rejects duplicate requested-version release-note headings before writing", () => {
    const root = createFixture();
    write(
      root,
      "docs/releases/notes.md",
      "# Prompt Vault Release Notes\n\n## 0.4.0 source-preview milestone — 2026-08-27\n\nOne.\n\n## 0.4.0 source-preview milestone — 2026-08-27\n\nTwo.\n",
    );
    const before = readPreparationFiles(root);

    expect(() => prepareRelease(root, "0.4.0", "2026-08-27")).toThrow(
      /docs\/releases\/notes\.md: duplicate milestone headings/,
    );
    expect(readPreparationFiles(root)).toEqual(before);
  });

  it("fails closed on ambiguous milestone targets and Unreleased boundaries", () => {
    const ambiguousVersion = createFixture();
    write(
      ambiguousVersion,
      "CHANGELOG.md",
      "# Changelog\n\n## [Unreleased]\n\nFuture work.\n\n## [0.4.0] pending-date\n",
    );
    expect(() => prepareRelease(ambiguousVersion, "0.4.0", "2026-08-27")).toThrow(
      /ambiguous milestone heading/,
    );

    const duplicateUnreleased = createFixture();
    write(
      duplicateUnreleased,
      "CHANGELOG.md",
      "# Changelog\n\n## [Unreleased]\n\nOne.\n\n## [Unreleased]\n\nTwo.\n",
    );
    expect(() => prepareRelease(duplicateUnreleased, "0.4.0", "2026-08-27")).toThrow(
      /exactly one unambiguous ## \[Unreleased\]/,
    );
  });

  it("describes version convergence as durable repository state", () => {
    const snapshot = readFileSync(resolve(repositoryRoot, "project-stage-snapshot.md"), "utf8");

    expect(snapshot).not.toContain("## Current work");
    expect(snapshot).not.toMatch(/Issue #71 is .*current|Issue #71 is .*slice/i);
    expect(snapshot).toContain(
      "Application-version and repository-truth convergence for 0.4.0 is complete",
    );
    expect(snapshot).toMatch(/identity are synchronized and mechanically\s+audited/);
    expect(snapshot).toMatch(/issue #64[\s\S]*not a Prompt Vault runtime\s+dependency/);
  });
});

describe("CLI application version", () => {
  interface CliProcessResult {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }

  let sourceCliResult: CliProcessResult;
  let compiledCliResult: CliProcessResult;

  // These integration proofs launch external toolchain processes and can exceed
  // the ordinary unit-test timeout under the complete parallel coverage suite.
  beforeAll(() => {
    const tsxCli = resolve(repositoryRoot, "node_modules/tsx/dist/cli.mjs");
    const cli = resolve(repositoryRoot, "src/cli/index.ts");
    sourceCliResult = spawnSync(process.execPath, [tsxCli, cli, "--version"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    const outputRoot = mkdtempSync(resolve(repositoryRoot, ".version-cli-build-"));
    fixtureRoots.push(outputRoot);
    const tscCli = resolve(repositoryRoot, "node_modules/typescript/bin/tsc");
    const compile = spawnSync(
      process.execPath,
      [
        tscCli,
        "-p",
        resolve(repositoryRoot, "tsconfig.json"),
        "--outDir",
        outputRoot,
        "--declaration",
        "false",
        "--sourceMap",
        "false",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(compile.status, `${compile.stdout}\n${compile.stderr}`).toBe(0);

    const compiledCli = resolve(outputRoot, "src/cli/index.js");
    expect(existsSync(compiledCli)).toBe(true);
    compiledCliResult = spawnSync(process.execPath, [compiledCli, "--version"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
  }, 30_000);

  it("reports 0.4.0 from the source CLI", () => {
    expect(sourceCliResult.status, sourceCliResult.stderr).toBe(0);
    expect(sourceCliResult.stdout.trim()).toBe("0.4.0");
  });

  it("reports 0.4.0 from a freshly compiled CLI", () => {
    expect(compiledCliResult.status, compiledCliResult.stderr).toBe(0);
    expect(compiledCliResult.stdout.trim()).toBe("0.4.0");
  });
});
