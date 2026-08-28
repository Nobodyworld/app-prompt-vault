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

interface LevelTwoHeading {
  readonly start: number;
  readonly text: string;
}

function levelTwoHeadings(content: string): readonly LevelTwoHeading[] {
  return [...content.matchAll(/^##[ \t]+([^\r\n]+?)[ \t]*(?:\r?\n|$)/gm)].map((match) => ({
    start: match.index,
    text: match[1],
  }));
}

function documentLineEnding(content: string): "\n" | "\r\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function existingMilestoneDate(
  headings: readonly LevelTwoHeading[],
  path: string,
  version: string,
  candidatePattern: RegExp,
  exactPattern: RegExp,
): string | undefined {
  const candidates = headings.filter(({ text }) => candidatePattern.test(text));
  if (candidates.length > 1) {
    throw new Error(`${path}: duplicate milestone headings for application version ${version}`);
  }
  if (candidates.length === 0) return undefined;

  const match = candidates[0].text.match(exactPattern);
  if (!match) {
    throw new Error(`${path}: ambiguous milestone heading for application version ${version}`);
  }
  return match[1];
}

function requireMatchingMilestoneDate(
  path: string,
  version: string,
  requestedDate: string,
  existingDate: string | undefined,
): boolean {
  if (!existingDate) return false;
  if (existingDate !== requestedDate) {
    throw new Error(
      `${path}: application version ${version} already exists with date ${existingDate}; requested ${requestedDate}`,
    );
  }
  return true;
}

function renderChangelog(content: string, version: string, date: string): string {
  requireSingleHeading(content, "# Changelog", "CHANGELOG.md");
  const headings = levelTwoHeadings(content);
  const unreleased = headings.filter(({ text }) => text === "[Unreleased]");
  const unreleasedTargets = headings.filter(({ text }) => text.startsWith("[Unreleased]"));
  if (unreleased.length !== 1 || unreleasedTargets.length !== 1) {
    throw new Error(
      `CHANGELOG.md: expected exactly one unambiguous ## [Unreleased] heading; found ${unreleasedTargets.length}`,
    );
  }

  const escapedVersion = escapeRegExp(version);
  const existingDate = existingMilestoneDate(
    headings,
    "CHANGELOG.md",
    version,
    new RegExp(`^\\[${escapedVersion}\\]`),
    new RegExp(`^\\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})$`),
  );
  if (requireMatchingMilestoneDate("CHANGELOG.md", version, date, existingDate)) {
    return content;
  }

  const lineEnding = documentLineEnding(content);
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
  ].join(lineEnding);
  const unreleasedIndex = headings.indexOf(unreleased[0]);
  const insertionIndex = headings[unreleasedIndex + 1]?.start ?? content.length;
  const before = content.slice(0, insertionIndex);
  const after = content.slice(insertionIndex);
  const entryPrefix = before.endsWith("\n") ? "" : lineEnding;
  const entrySuffix = after.length > 0 ? `${lineEnding}${lineEnding}` : "";
  return `${before}${entryPrefix}${entry}${entrySuffix}${after}`;
}

function renderReleaseNotes(content: string, version: string, date: string): string {
  requireSingleHeading(content, "# Prompt Vault Release Notes", "docs/releases/notes.md");
  const headings = levelTwoHeadings(content);
  const escapedVersion = escapeRegExp(version);
  const existingDate = existingMilestoneDate(
    headings,
    "docs/releases/notes.md",
    version,
    new RegExp(`^${escapedVersion}(?:\\s|$)`),
    new RegExp(`^${escapedVersion} source-preview milestone — (\\d{4}-\\d{2}-\\d{2})$`),
  );
  if (requireMatchingMilestoneDate("docs/releases/notes.md", version, date, existingDate)) {
    return content;
  }

  const lineEnding = documentLineEnding(content);
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
  ].join(lineEnding);
  return content.replace(
    "# Prompt Vault Release Notes",
    `# Prompt Vault Release Notes${lineEnding}${lineEnding}${entry}`,
  );
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
