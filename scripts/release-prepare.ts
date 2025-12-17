import { readFileSync, writeFileSync } from "node:fs";

// # agent-safe-task: Automates version bump and release note scaffolding.

const version = process.argv[2];

if (!version) {
  console.error("Usage: npm run release:prepare -- <version>");
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version "${version}". Expected format MAJOR.MINOR.PATCH.`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const changelogPath = new URL("../CHANGELOG.md", import.meta.url);
const changelog = readFileSync(changelogPath, "utf8");
const changelogEntry = `## [${version}] - ${date}\n\n### Added\n- TODO(P2, 1d): Describe additions.\n\n### Changed\n- TODO(P2, 1d): Describe changes.\n\n### Fixed\n- TODO(P2, 1d): Describe fixes.\n`;
if (!changelog.includes(`[${version}]`)) {
  writeFileSync(changelogPath, changelog.replace("# Changelog", `# Changelog\n\n${changelogEntry}\n`));
}

const releaseNotesPath = new URL("../docs/releases/notes.md", import.meta.url);
const releaseNotes = readFileSync(releaseNotesPath, "utf8");
const notesEntry = `## ${version} (${date})\n\n### Highlights\n- TODO(P2, 1d): Summarise highlights.\n\n### Upgrade Steps\n1. TODO(P2, 1d): Document upgrade guidance.\n\n### Breaking Changes\n- TODO(P2, 1d): Document breaking changes or state "None".\n\n### Operational Notes\n- TODO(P3, 1d): Capture operational learnings.\n`;
if (!releaseNotes.includes(`## ${version} (${date})`)) {
  writeFileSync(
    releaseNotesPath,
    releaseNotes.replace("# Prompt Vault Release Notes", `# Prompt Vault Release Notes\n\n${notesEntry}`)
  );
}

console.log(`Prepared release stub for ${version}. Update CHANGELOG.md and docs/releases/notes.md before publishing.`);
