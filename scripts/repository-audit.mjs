import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function fail(message) {
  console.error(`repository-audit: ${message}`);
  process.exitCode = 1;
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownSection(markdown, heading) {
  const headings = [...markdown.matchAll(/^##[ \t]+([^\r\n]+?)[ \t]*(?:\r?\n|$)/gm)].map(
    (match) => ({
      start: match.index,
      bodyStart: match.index + match[0].length,
      title: match[1],
    }),
  );
  const matches = headings.filter(({ title }) => title === heading);
  if (matches.length !== 1) return "";

  const targetIndex = headings.indexOf(matches[0]);
  const bodyEnd = headings[targetIndex + 1]?.start ?? markdown.length;
  return markdown.slice(matches[0].bodyStart, bodyEnd);
}

function checkMarkdownSectionExtraction() {
  const markdown = [
    "# Synthetic document",
    "",
    "## Repository state",
    "",
    "First required line.",
    "Second required line.",
    "Third required line.",
    "",
    "## Following section",
    "",
    "Outside text.",
    "",
    "## Final section",
    "",
    "Final first line.",
    "Final second line.",
  ].join("\n");
  const repositoryState = markdownSection(markdown, "Repository state");
  requireCondition(
    repositoryState.includes("First required line.") &&
      repositoryState.includes("Second required line.") &&
      repositoryState.includes("Third required line.") &&
      !repositoryState.includes("## Following section") &&
      !repositoryState.includes("Outside text."),
    "Markdown section extraction must preserve a complete multi-line body and stop at the next level-two heading",
  );

  const finalSection = markdownSection(markdown, "Final section");
  requireCondition(
    finalSection.includes("Final first line.") && finalSection.includes("Final second line."),
    "Markdown section extraction must preserve a final section through absolute document end",
  );
  requireCondition(
    markdownSection(markdown, "Absent section") === "",
    "Markdown section extraction must return empty for an absent heading",
  );

  const duplicate = `${markdown}\n## Repository state\n\nDuplicate body.\n`;
  requireCondition(
    markdownSection(duplicate, "Repository state") === "",
    "Markdown section extraction must fail closed for duplicate headings",
  );
}

function collectSourceFiles(directory) {
  const absolute = resolve(repositoryRoot, directory);
  if (!existsSync(absolute)) return [];
  const files = [];
  for (const entry of readdirSync(absolute)) {
    const path = resolve(absolute, entry);
    const relative = path.slice(repositoryRoot.length).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) {
      files.push(...collectSourceFiles(relative));
    } else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry)) {
      files.push(relative);
    }
  }
  return files;
}

function checkNoWorkspaceImports() {
  const importPattern =
    /(?:from\s+|import\s*\(|require\s*\()\s*["']@nw\//;
  for (const root of ["src", "desktop/src", "tests"]) {
    for (const path of collectSourceFiles(root)) {
      const content = read(path);
      requireCondition(
        !importPattern.test(content),
        `${path} still imports a private @nw/* workspace package`,
      );
    }
  }
}

checkMarkdownSectionExtraction();

function checkPublicMarkdownLinks(path) {
  const markdown = read(path);
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

  for (const match of markdown.matchAll(linkPattern)) {
    const rawTarget = match[1].trim();
    if (
      !rawTarget ||
      rawTarget.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(rawTarget) ||
      rawTarget.startsWith("../../issues/") ||
      rawTarget.startsWith("../../pull/")
    ) {
      continue;
    }

    const target = decodeURIComponent(
      rawTarget.split("#", 1)[0].split("?", 1)[0],
    );
    const sourcePath = resolve(repositoryRoot, path);
    const resolvedTarget = resolve(dirname(sourcePath), target);

    requireCondition(
      resolvedTarget.startsWith(repositoryRoot),
      `${path} links outside the repository: ${rawTarget}`,
    );
    requireCondition(
      existsSync(resolvedTarget),
      `${path} links to a missing path: ${rawTarget}`,
    );
  }
}

const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargoToml = read("src-tauri/Cargo.toml");
const cargoLock = read("src-tauri/Cargo.lock");
const cli = read("src/cli/index.ts");
const runtimeVersionModule = read("src/version.ts");
const readme = read("README.md");
const changelog = read("CHANGELOG.md");
const releaseNotes = read("docs/releases/notes.md");
const projectStage = read("project-stage-snapshot.md");
const versionPolicy = read("docs/developer-guide/version-policy.md");
const docsIndex = read("docs/README.md");
const developerWorkflows = read("docs/developer-guide/workflows.md");
const releasePrepare = read("scripts/release-prepare.ts");
const versionSurfaces = read("scripts/version-surfaces.ts");
const securityPolicy = read("docs/security/policies/security.md");
const license = read("LICENSE");
const envExample = read(".env.example");
const workflow = read(".github/workflows/repository-audit.yml");
const vitestConfig = read("vitest.config.ts");
const rootTsconfig = read("tsconfig.json");
const desktopTsconfig = read("desktop/tsconfig.json");
const httpAdapter = read("src/lib/platform-connectors.ts");
const themeAdapter = read("desktop/src/lib/platform-ui.ts");
const platformCore = read("src/lib/platform-core.ts");
const platformOrchestrator = read("src/lib/platform-orchestrator.ts");
const platformWidgets = read("src/lib/platform-pages-widgets.ts");
const legacyMigration = read("src/lib/legacy-tag-migration.ts");
const legacyMigrationCli = read("scripts/migrate-legacy-tags.ts");
const legacyMigrationGuide = read(
  "docs/developer-guide/legacy-tag-migration.md",
);

const cargoVersion = cargoToml.match(
  /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
)?.[1];
const cargoLockPackageBlocks = cargoLock.split(/(?=^\[\[package\]\]\s*$)/m);
const cargoLockApplicationBlocks = cargoLockPackageBlocks.filter((block) =>
  /^name\s*=\s*"prompt-vault-app"\s*$/m.test(block),
);
const cargoLockVersion = cargoLockApplicationBlocks[0]?.match(
  /^version\s*=\s*"([^"]+)"\s*$/m,
)?.[1];
const runtimeVersion = runtimeVersionModule.match(
  /^export const APPLICATION_VERSION\s*=\s*"([^"]+)";\s*$/m,
)?.[1];
const projectStageVersion = projectStage.match(
  /^\*\*Current application version:\*\*\s*([^\s]+)\s*$/m,
)?.[1];
const strictVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

requireCondition(Boolean(cargoVersion), "could not read the Cargo package version");
requireCondition(
  strictVersion.test(packageJson.version),
  `package.json version must be strict MAJOR.MINOR.PATCH; found ${packageJson.version}`,
);
requireCondition(
  cargoLockApplicationBlocks.length === 1 && Boolean(cargoLockVersion),
  `Cargo.lock must contain exactly one versioned prompt-vault-app package block; found ${cargoLockApplicationBlocks.length}`,
);
requireCondition(Boolean(runtimeVersion), "could not read the CLI/runtime application version");
requireCondition(Boolean(projectStageVersion), "could not read the project-stage application version");
requireCondition(
  packageJson.version === tauriConfig.version &&
    packageJson.version === cargoVersion &&
    packageJson.version === cargoLockVersion &&
    packageJson.version === runtimeVersion &&
    packageJson.version === projectStageVersion,
  `version mismatch: package=${packageJson.version}, tauri=${tauriConfig.version}, cargo=${cargoVersion}, cargoLock=${cargoLockVersion}, runtime=${runtimeVersion}, projectStage=${projectStageVersion}`,
);
requireCondition(
  cli.includes('import { APPLICATION_VERSION } from "../version.js"') &&
    cli.includes(".version(APPLICATION_VERSION)") &&
    !/\.version\("\d+\.\d+\.\d+"\)/.test(cli),
  "CLI must consume the synchronized runtime version instead of a hard-coded literal",
);
requireCondition(
  tauriConfig.identifier === "com.nobodyworld.promptvault",
  "application identifier must remain com.nobodyworld.promptvault",
);

const escapedApplicationVersion = escapeRegExp(packageJson.version);
requireCondition(
  new RegExp(`^## \\[${escapedApplicationVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(changelog),
  `CHANGELOG.md must contain application version ${packageJson.version}`,
);
requireCondition(
  new RegExp(`^## ${escapedApplicationVersion} source-preview milestone — \\d{4}-\\d{2}-\\d{2}$`, "m").test(releaseNotes),
  `release notes must contain application version ${packageJson.version}`,
);
requireCondition(
  projectStageVersion === packageJson.version,
  `project-stage snapshot must report application version ${packageJson.version}`,
);
const currentBlockers = markdownSection(projectStage, "Current blockers and limitations");
requireCondition(
  !/#2[2-6]\b/.test(currentBlockers),
  "project-stage snapshot still presents completed issues #22 through #26 as current blockers",
);
const repositoryState = markdownSection(projectStage, "Repository state");
requireCondition(
  /application-version and repository-truth convergence for 0\.4\.0 is complete/i.test(repositoryState) &&
    /identity are synchronized and mechanically\s+audited/i.test(repositoryState) &&
    /issue #64[\s\S]*evidence-ownership improvement[\s\S]*not a Prompt Vault runtime\s+dependency[\s\S]*not a source-usage prerequisite/i.test(repositoryState),
  "project-stage snapshot must describe durable version convergence and separate evidence ownership",
);

for (const [path, content] of [
  ["README.md", readme],
  ["docs/releases/notes.md", releaseNotes],
  ["project-stage-snapshot.md", projectStage],
  ["docs/developer-guide/version-policy.md", versionPolicy],
]) {
  requireCondition(
    /source preview|source-preview/i.test(content),
    `${path} must retain the source-preview boundary`,
  );
}
requireCondition(
  readme.includes("There is no supported") &&
    releaseNotes.includes("No GitHub Release exists") &&
    releaseNotes.includes("No supported installer download") &&
    releaseNotes.includes("No public update channel exists") &&
    projectStage.includes("Signed and supported distribution remains disabled") &&
    versionPolicy.includes("Unsigned workflow or local build artifacts are validation evidence only"),
  "source-preview/no-supported-release boundaries are incomplete",
);

const unsupportedAffirmativeClaims = [
  /^(?!.*\b(?:no|not|without|disabled|unsupported|absent)\b).*(?:a|the) public update channel (?:is|remains) (?:available|active|enabled|supported).*$/im,
  /^(?!.*\b(?:no|not|without|disabled|unsupported|absent)\b).*signed distribution (?:is|remains) (?:available|active|enabled|supported).*$/im,
  /^(?!.*\b(?:no|not|without|disabled|unsupported|absent)\b).*supported installer download (?:is|remains) (?:available|active|enabled).*$/im,
];
for (const [path, content] of [
  ["README.md", readme],
  ["CHANGELOG.md", changelog],
  ["docs/releases/notes.md", releaseNotes],
  ["project-stage-snapshot.md", projectStage],
  ["docs/developer-guide/version-policy.md", versionPolicy],
]) {
  for (const pattern of unsupportedAffirmativeClaims) {
    requireCondition(!pattern.test(content), `${path} contains an unauthorized supported-release claim`);
  }
}

for (const path of Object.values({
  packageJson: "package.json",
  tauriConfig: "src-tauri/tauri.conf.json",
  cargoToml: "src-tauri/Cargo.toml",
  cargoLock: "src-tauri/Cargo.lock",
  runtimeModule: "src/version.ts",
  projectStage: "project-stage-snapshot.md",
})) {
  requireCondition(
    versionSurfaces.includes(`"${path}"`),
    `version synchronization tooling does not manage ${path}`,
  );
}
requireCondition(
  releasePrepare.includes("createVersionSurfacePlan") &&
    releasePrepare.includes("writeVersionSurfacePlan") &&
    !releasePrepare.includes('from "node:child_process"'),
  "release preparation must use the complete version-surface plan without publication subprocesses",
);
requireCondition(
  docsIndex.includes("developer-guide/version-policy.md") &&
    developerWorkflows.includes("version-policy.md"),
  "version policy must be linked from the documentation index and developer workflows",
);

requireCondition(
  packageJson.scripts?.["web:build"] &&
    !packageJson.scripts["web:build"].includes("web:dev"),
  "web:build must terminate instead of starting the development server",
);
requireCondition(
  packageJson.scripts?.["tauri:build"],
  "package.json must expose tauri:build",
);
requireCondition(
  packageJson.scripts?.["tags:migrate-legacy"] ===
    "tsx scripts/migrate-legacy-tags.ts",
  "package.json must expose the reviewed legacy tag migration command",
);
requireCondition(
  packageJson.scripts?.["quality:gate"]?.includes("typecheck"),
  "quality:gate must include typecheck",
);
requireCondition(
  packageJson.scripts?.["quality:gate"]?.includes("repository:audit"),
  "quality:gate must include repository:audit",
);
requireCondition(
  packageJson.packageManager === "pnpm@10.24.0",
  "packageManager must pin the supported pnpm version",
);

const declaredDependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
  ...(packageJson.optionalDependencies ?? {}),
};
for (const [name, version] of Object.entries(declaredDependencies)) {
  requireCondition(
    !String(version).startsWith("workspace:"),
    `package.json still declares workspace dependency ${name}@${version}`,
  );
  requireCondition(
    !name.startsWith("@nw/"),
    `package.json still declares private Nobodyworld dependency ${name}`,
  );
}
checkNoWorkspaceImports();

requireCondition(
  vitestConfig.includes('from "./vitest.shared"'),
  "Vitest must use the app-local shared coverage config",
);
requireCondition(
  !vitestConfig.includes("../../vitest.shared"),
  "Vitest still references a parent workspace config",
);
requireCondition(
  !rootTsconfig.includes("../../node_modules"),
  "root tsconfig still references parent node_modules",
);
requireCondition(
  !desktopTsconfig.includes("../../node_modules"),
  "desktop tsconfig still references parent node_modules",
);
requireCondition(
  cargoToml.includes('nw-secrets = { path = "crates/nw-secrets" }'),
  "Cargo must use the vendored native secrets crate",
);
requireCondition(
  !cargoToml.includes("../../../packages"),
  "Cargo still references a parent workspace package",
);

requireCondition(
  !httpAdapter.includes("@nw/"),
  "HTTP adapter still imports a workspace package",
);
requireCondition(
  !themeAdapter.includes("@nw/"),
  "theme adapter still imports a workspace package",
);
requireCondition(
  !platformCore.includes("@nw/"),
  "platform core still references a workspace package",
);
requireCondition(
  platformCore.includes("const localSecretStore = new Map"),
  "platform core must provide the app-local process secret fallback",
);
requireCondition(
  platformCore.includes("Secure secret persistence is unavailable in production"),
  "app-local secret fallback must refuse insecure production use",
);
requireCondition(
  platformCore.includes("CREATE TABLE IF NOT EXISTS taggings"),
  "platform core must provide app-owned persistent tag associations",
);
requireCondition(
  platformCore.includes("bootstrapCoreDbAuthFromApiKeys"),
  "platform core must provide standalone API-key compatibility",
);
requireCondition(
  !platformOrchestrator.includes("@nw/"),
  "orchestrator adapter still references a workspace package",
);
requireCondition(
  platformOrchestrator.includes("const toolRegistry = new Map"),
  "orchestrator adapter must provide an app-local tool registry",
);
requireCondition(
  !platformWidgets.includes("@nw/"),
  "widget adapter still references a workspace package",
);
requireCondition(
  platformWidgets.includes("const widgetRegistry = new Map"),
  "widget adapter must provide an app-local widget registry",
);

requireCondition(
  legacyMigration.includes("export function migrateLegacyTagSidecar"),
  "legacy tag migration module must expose the reviewed migration entry point",
);
requireCondition(
  legacyMigration.includes("readonly: true") &&
    legacyMigration.includes("fileMustExist: true"),
  "legacy tag migration must open its source read-only and require an existing file",
);
requireCondition(
  legacyMigration.includes('const coreMarkers = ["schema_migrations", "settings", "pages"]') &&
    legacyMigration.includes("Source is not a recognized legacy Nobodyworld Core DB"),
  "legacy tag migration must distinguish the full Core DB from the standalone Prompt Vault database",
);
requireCondition(
  legacyMigration.includes("Target appears to be the main Prompt Vault database"),
  "legacy tag migration must refuse the main Prompt Vault database as its target",
);
requireCondition(
  legacyMigration.includes("target.transaction"),
  "legacy tag migration writes must remain transactional",
);
requireCondition(
  legacyMigration.includes("dryRun") &&
    legacyMigrationCli.includes("--dry-run"),
  "legacy tag migration must retain an explicit dry-run path",
);
requireCondition(
  legacyMigrationCli.includes("PROMPT_VAULT_LEGACY_TAG_DB_PATH") &&
    legacyMigrationCli.includes("PROMPT_VAULT_TAG_DB_PATH"),
  "legacy tag migration CLI must retain documented environment overrides",
);
requireCondition(
  legacyMigrationGuide.includes("Do not point the new runtime directly") &&
    legacyMigrationGuide.includes("--dry-run") &&
    legacyMigrationGuide.includes("schema_migrations"),
  "legacy tag migration guide must document Core DB identification, isolation, and dry-run safeguards",
);

requireCondition(
  readme.includes("**Release status:** pre-release"),
  "README must state the pre-release status",
);
requireCondition(
  readme.includes("issue #26"),
  "README must link the public-showcase release tracker",
);
requireCondition(
  readme.includes("legacy sidecar migration procedure"),
  "README must link the legacy sidecar migration procedure",
);
requireCondition(
  !readme.includes("security@prompt-vault.local"),
  "README contains the obsolete local-only security address",
);
requireCondition(
  securityPolicy.includes("GitHub Private Vulnerability Reporting") &&
    securityPolicy.includes("Report a vulnerability"),
  "security policy must route reports through GitHub Private Vulnerability Reporting",
);
requireCondition(
  !securityPolicy.includes("security@nobodyworld.com") &&
    !securityPolicy.includes("security@prompt-vault.local"),
  "security policy contains an unverified or obsolete reporting address",
);
requireCondition(
  !license.includes("[Jurisdiction]"),
  "LICENSE still contains a jurisdiction placeholder",
);
requireCondition(
  license.includes("source code and documentation") &&
    license.includes("review and evaluation"),
  "LICENSE must explicitly describe source-available review terms",
);

for (const markdownPath of [
  "README.md",
  "CONTRIBUTING.md",
  "docs/README.md",
  "docs/developer-guide/version-policy.md",
  "docs/developer-guide/workflows.md",
  "docs/developer-guide/legacy-tag-migration.md",
]) {
  checkPublicMarkdownLinks(markdownPath);
}

const envLines = new Set(
  envExample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=", 1)[0]),
);

for (const key of [
  "PROMPT_VAULT_ALLOWED_ORIGINS",
  "PROMPT_VAULT_METRICS",
  "PROMPT_VAULT_METRICS_PORT",
  "PROMPT_VAULT_TAG_DB_PATH",
  "RATE_LIMIT_AUTH_MAX_REQUESTS",
  "RATE_LIMIT_AUTH_WINDOW_MS",
]) {
  requireCondition(envLines.has(key), `.env.example is missing ${key}`);
}

for (const obsolete of ["ALLOWED_ORIGINS", "METRICS_ENABLED", "METRICS_PORT"]) {
  requireCondition(
    !envLines.has(obsolete),
    `.env.example still defines ${obsolete}`,
  );
}

const usesLines = workflow
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("uses:"));

requireCondition(usesLines.length > 0, "repository audit workflow contains no actions");
for (const line of usesLines) {
  requireCondition(
    /uses:\s+[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/i.test(line),
    `workflow action is not pinned to a full commit SHA: ${line}`,
  );
}

if (!process.exitCode) {
  console.log(
    `repository-audit: passed for Prompt Vault ${packageJson.version} (${usesLines.length} pinned actions, synchronized version and standalone dependency boundaries)`,
  );
}
