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
const readme = read("README.md");
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

requireCondition(Boolean(cargoVersion), "could not read the Cargo package version");
requireCondition(
  packageJson.version === tauriConfig.version &&
    packageJson.version === cargoVersion,
  `version mismatch: package=${packageJson.version}, tauri=${tauriConfig.version}, cargo=${cargoVersion}`,
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
  legacyMigration.includes("Source appears to be the main Prompt Vault database") &&
    legacyMigration.includes("Target appears to be the main Prompt Vault database"),
  "legacy tag migration must refuse the main Prompt Vault database as source or target",
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
    legacyMigrationGuide.includes("--dry-run"),
  "legacy tag migration guide must document isolation and dry-run safeguards",
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
  securityPolicy.includes("security@nobodyworld.com"),
  "security policy must contain the public reporting address",
);
requireCondition(
  !securityPolicy.includes("security@prompt-vault.local"),
  "security policy contains the obsolete local-only reporting address",
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
    `repository-audit: passed for Prompt Vault ${packageJson.version} (${usesLines.length} pinned actions, standalone dependency and migration boundary)`,
  );
}
