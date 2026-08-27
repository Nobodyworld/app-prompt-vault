import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertVersionSurfaces,
  createVersionSurfacePlan,
  validateApplicationVersion,
  writeVersionSurfacePlan,
} from "./version-surfaces.js";

// # agent-safe-task: Synchronizes application-version surfaces and source-preview notes.

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export interface ReleasePreparationResult {
  readonly version: string;
  readonly date: string;
  readonly changedPaths: readonly string[];
}

function requireSingleHeading(content: string, heading: string, path: string): void {
  const matches = [...content.matchAll(new RegExp(`^${heading}$`, "gm"))];
  if (matches.length !== 1) {
    throw new Error(`${path}: expected exactly one ${heading} heading; found ${matches.length}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderChangelog(content: string, version: string, date: string): string {
  requireSingleHeading(content, "# Changelog", "CHANGELOG.md");
  requireSingleHeading(content, "## \\[Unreleased\\]", "CHANGELOG.md");
  if (new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s|$)`, "m").test(content)) {
    return content;
  }

  const entry = [
    `## [${version}] - ${date}`,
    "",
    "> Source-preview application milestone. This version does not imply a Git tag, GitHub Release, signed distribution, supported installer, update channel, or production release.",
    "",
    "### Added",
    "",
    "- TODO: Describe source changes included in this application milestone.",
    "",
    "### Changed",
    "",
    "- TODO: Describe repository-truth or compatibility changes.",
    "",
    "### Fixed",
    "",
    "- TODO: Describe fixes.",
  ].join("\n");
  return content.replace("## [Unreleased]", `## [Unreleased]\n\n${entry}`);
}

function renderReleaseNotes(content: string, version: string, date: string): string {
  requireSingleHeading(content, "# Prompt Vault Release Notes", "docs/releases/notes.md");
  if (
    new RegExp(
      `^## ${escapeRegExp(version)} source-preview milestone — ${escapeRegExp(date)}$`,
      "m",
    ).test(content)
  ) {
    return content;
  }

  const entry = [
    `## ${version} source-preview milestone — ${date}`,
    "",
    "**Status:** application version prepared for public source preview only.",
    "",
    "- No Git tag or GitHub Release is created or implied.",
    "- No signed or supported installer download is created or implied.",
    "- Unsigned build artifacts remain local validation evidence only.",
    "- No public update channel or production-readiness claim is created or implied.",
    "",
    "### Highlights",
    "",
    "- TODO: Summarize the source milestone.",
    "",
    "### Compatibility notes",
    "",
    "- TODO: Record compatibility effects, or state that there are none.",
  ].join("\n");
  return content.replace("# Prompt Vault Release Notes", `# Prompt Vault Release Notes\n\n${entry}`);
}

export function prepareRelease(
  root: string,
  version: string,
  date = new Date().toISOString().slice(0, 10),
): ReleasePreparationResult {
  validateApplicationVersion(version);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid preparation date ${JSON.stringify(date)}. Expected YYYY-MM-DD.`);
  }

  // Build and validate every update before writing any file.
  const versionPlan = createVersionSurfacePlan(root, version);
  const changelogPath = resolve(root, "CHANGELOG.md");
  const releaseNotesPath = resolve(root, "docs/releases/notes.md");
  const changelog = readFileSync(changelogPath, "utf8");
  const releaseNotes = readFileSync(releaseNotesPath, "utf8");
  const nextChangelog = renderChangelog(changelog, version, date);
  const nextReleaseNotes = renderReleaseNotes(releaseNotes, version, date);

  const changedPaths = [...writeVersionSurfacePlan(root, versionPlan)];
  if (nextChangelog !== changelog) {
    writeFileSync(changelogPath, nextChangelog);
    changedPaths.push("CHANGELOG.md");
  }
  if (nextReleaseNotes !== releaseNotes) {
    writeFileSync(releaseNotesPath, nextReleaseNotes);
    changedPaths.push("docs/releases/notes.md");
  }
  assertVersionSurfaces(root);
  return { version, date, changedPaths };
}

function runCli(): void {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: pnpm release:prepare -- <version>");
    process.exitCode = 1;
    return;
  }

  try {
    const result = prepareRelease(repositoryRoot, version);
    console.log(
      `Prepared source-preview application milestone ${result.version} (${result.changedPaths.length} file${result.changedPaths.length === 1 ? "" : "s"} changed).`,
    );
    console.log(
      "No tag, GitHub Release, signing, installer publication, update feed, installation, or database action was performed.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
