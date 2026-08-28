import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MANAGED_VERSION_PATHS = {
  packageJson: "package.json",
  tauriConfig: "src-tauri/tauri.conf.json",
  cargoToml: "src-tauri/Cargo.toml",
  cargoLock: "src-tauri/Cargo.lock",
  runtimeModule: "src/version.ts",
  projectStage: "project-stage-snapshot.md",
} as const;

export type VersionSurfaceName = keyof typeof MANAGED_VERSION_PATHS;

export interface VersionSurfaceState {
  readonly canonicalVersion: string;
  readonly versions: Readonly<Record<VersionSurfaceName, string>>;
}

export interface VersionSurfaceUpdate {
  readonly name: VersionSurfaceName;
  readonly path: string;
  readonly before: string;
  readonly after: string;
}

const APPLICATION_PACKAGE_NAME = "prompt-vault-app";
const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function surfaceError(path: string, message: string): Error {
  return new Error(`${path}: ${message}`);
}

export function validateApplicationVersion(version: unknown): asserts version is string {
  if (typeof version !== "string" || !STRICT_VERSION.test(version)) {
    throw new Error(
      `Invalid application version ${JSON.stringify(version)}. Expected strict MAJOR.MINOR.PATCH.`,
    );
  }
}

function read(root: string, path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function parseJsonObject(content: string, path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw surfaceError(
      path,
      `malformed JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw surfaceError(path, "expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function jsonVersion(content: string, path: string): string {
  const parsed = parseJsonObject(content, path);
  const matches = [...content.matchAll(/"version"\s*:\s*"([^"]*)"/g)];
  if (matches.length !== 1) {
    throw surfaceError(path, `expected exactly one string version target; found ${matches.length}`);
  }
  if (parsed.version !== matches[0][1]) {
    throw surfaceError(path, "version target is malformed or ambiguous");
  }
  validateApplicationVersion(parsed.version);
  return parsed.version;
}

function renderJsonVersion(content: string, path: string, version: string): string {
  jsonVersion(content, path);
  return content.replace(
    /("version"\s*:\s*")[^"]*(")/,
    `$1${version}$2`,
  );
}

interface TextTarget {
  readonly version: string;
  readonly versionStart: number;
  readonly versionEnd: number;
}

function replaceTarget(content: string, target: TextTarget, version: string): string {
  return `${content.slice(0, target.versionStart)}${version}${content.slice(target.versionEnd)}`;
}

function cargoPackageTarget(content: string, path: string): TextTarget {
  const sectionMatches = [...content.matchAll(/^\[package\]\s*$/gm)];
  if (sectionMatches.length !== 1 || sectionMatches[0].index === undefined) {
    throw surfaceError(path, `expected exactly one [package] section; found ${sectionMatches.length}`);
  }

  const start = sectionMatches[0].index + sectionMatches[0][0].length;
  const followingHeader = /^\[/gm;
  followingHeader.lastIndex = start;
  const nextHeader = followingHeader.exec(content);
  const end = nextHeader?.index ?? content.length;
  const section = content.slice(start, end);
  const nameMatches = [...section.matchAll(/^name\s*=\s*"([^"]+)"\s*$/gm)];
  const versionMatches = [...section.matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];

  if (nameMatches.length !== 1 || nameMatches[0][1] !== APPLICATION_PACKAGE_NAME) {
    throw surfaceError(path, `the [package] section must uniquely name ${APPLICATION_PACKAGE_NAME}`);
  }
  if (versionMatches.length !== 1 || versionMatches[0].index === undefined) {
    throw surfaceError(path, `expected exactly one package version; found ${versionMatches.length}`);
  }

  const version = versionMatches[0][1];
  validateApplicationVersion(version);
  const assignmentOffset = versionMatches[0][0].indexOf(`"${version}"`) + 1;
  const versionStart = start + versionMatches[0].index + assignmentOffset;
  return { version, versionStart, versionEnd: versionStart + version.length };
}

function cargoLockTarget(content: string, path: string): TextTarget {
  if (!/^version\s*=\s*4\s*$/m.test(content)) {
    throw surfaceError(path, "expected a Cargo lockfile with format version 4");
  }

  const blockMatches = [...content.matchAll(/^\[\[package\]\]\s*$/gm)];
  if (blockMatches.length === 0) {
    throw surfaceError(path, "contains no [[package]] blocks");
  }

  const targets: TextTarget[] = [];
  for (let index = 0; index < blockMatches.length; index += 1) {
    const match = blockMatches[index];
    if (match.index === undefined) continue;
    const start = match.index + match[0].length;
    const end = blockMatches[index + 1]?.index ?? content.length;
    const block = content.slice(start, end);
    const nameMatches = [...block.matchAll(/^name\s*=\s*"([^"]+)"\s*$/gm)];
    const versionMatches = [...block.matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
    if (nameMatches.length !== 1 || versionMatches.length !== 1) {
      throw surfaceError(path, `malformed [[package]] block ${index + 1}`);
    }
    if (nameMatches[0][1] !== APPLICATION_PACKAGE_NAME) continue;
    if (versionMatches[0].index === undefined) continue;

    const version = versionMatches[0][1];
    validateApplicationVersion(version);
    const assignmentOffset = versionMatches[0][0].indexOf(`"${version}"`) + 1;
    const versionStart = start + versionMatches[0].index + assignmentOffset;
    targets.push({
      version,
      versionStart,
      versionEnd: versionStart + version.length,
    });
  }

  if (targets.length !== 1) {
    throw surfaceError(
      path,
      `expected exactly one ${APPLICATION_PACKAGE_NAME} package block; found ${targets.length}`,
    );
  }
  return targets[0];
}

function runtimeModuleTarget(content: string, path: string): TextTarget {
  const matches = [
    ...content.matchAll(
      /^export const APPLICATION_VERSION\s*=\s*"([^"]+)";\s*$/gm,
    ),
  ];
  if (matches.length !== 1 || matches[0].index === undefined) {
    throw surfaceError(path, `expected exactly one APPLICATION_VERSION target; found ${matches.length}`);
  }
  const version = matches[0][1];
  validateApplicationVersion(version);
  const assignmentOffset = matches[0][0].indexOf(`"${version}"`) + 1;
  const versionStart = matches[0].index + assignmentOffset;
  return { version, versionStart, versionEnd: versionStart + version.length };
}

function projectStageTarget(content: string, path: string): TextTarget {
  const matches = [
    ...content.matchAll(
      /^\*\*Current application version:\*\*\s*([^\s]+)\s*$/gm,
    ),
  ];
  if (matches.length !== 1 || matches[0].index === undefined) {
    throw surfaceError(path, `expected exactly one current application version field; found ${matches.length}`);
  }
  const version = matches[0][1];
  validateApplicationVersion(version);
  const versionOffset = matches[0][0].indexOf(version);
  const versionStart = matches[0].index + versionOffset;
  return { version, versionStart, versionEnd: versionStart + version.length };
}

interface LoadedSurface {
  readonly path: string;
  readonly content: string;
  readonly version: string;
  readonly render: (version: string) => string;
}

function loadSurfaces(root: string): Record<VersionSurfaceName, LoadedSurface> {
  const packageContent = read(root, MANAGED_VERSION_PATHS.packageJson);
  const tauriContent = read(root, MANAGED_VERSION_PATHS.tauriConfig);
  const cargoTomlContent = read(root, MANAGED_VERSION_PATHS.cargoToml);
  const cargoLockContent = read(root, MANAGED_VERSION_PATHS.cargoLock);
  const runtimeContent = read(root, MANAGED_VERSION_PATHS.runtimeModule);
  const projectStageContent = read(root, MANAGED_VERSION_PATHS.projectStage);
  const cargoToml = cargoPackageTarget(cargoTomlContent, MANAGED_VERSION_PATHS.cargoToml);
  const cargoLock = cargoLockTarget(cargoLockContent, MANAGED_VERSION_PATHS.cargoLock);
  const runtimeModule = runtimeModuleTarget(runtimeContent, MANAGED_VERSION_PATHS.runtimeModule);
  const projectStage = projectStageTarget(projectStageContent, MANAGED_VERSION_PATHS.projectStage);

  return {
    packageJson: {
      path: MANAGED_VERSION_PATHS.packageJson,
      content: packageContent,
      version: jsonVersion(packageContent, MANAGED_VERSION_PATHS.packageJson),
      render: (version) => renderJsonVersion(packageContent, MANAGED_VERSION_PATHS.packageJson, version),
    },
    tauriConfig: {
      path: MANAGED_VERSION_PATHS.tauriConfig,
      content: tauriContent,
      version: jsonVersion(tauriContent, MANAGED_VERSION_PATHS.tauriConfig),
      render: (version) => renderJsonVersion(tauriContent, MANAGED_VERSION_PATHS.tauriConfig, version),
    },
    cargoToml: {
      path: MANAGED_VERSION_PATHS.cargoToml,
      content: cargoTomlContent,
      version: cargoToml.version,
      render: (version) => replaceTarget(cargoTomlContent, cargoToml, version),
    },
    cargoLock: {
      path: MANAGED_VERSION_PATHS.cargoLock,
      content: cargoLockContent,
      version: cargoLock.version,
      render: (version) => replaceTarget(cargoLockContent, cargoLock, version),
    },
    runtimeModule: {
      path: MANAGED_VERSION_PATHS.runtimeModule,
      content: runtimeContent,
      version: runtimeModule.version,
      render: (version) => replaceTarget(runtimeContent, runtimeModule, version),
    },
    projectStage: {
      path: MANAGED_VERSION_PATHS.projectStage,
      content: projectStageContent,
      version: projectStage.version,
      render: (version) => replaceTarget(projectStageContent, projectStage, version),
    },
  };
}

export function readVersionSurfaces(root = repositoryRoot): VersionSurfaceState {
  const surfaces = loadSurfaces(root);
  const versions = Object.fromEntries(
    Object.entries(surfaces).map(([name, surface]) => [name, surface.version]),
  ) as Record<VersionSurfaceName, string>;
  return { canonicalVersion: versions.packageJson, versions };
}

export function assertVersionSurfaces(root = repositoryRoot): VersionSurfaceState {
  const state = readVersionSurfaces(root);
  const mismatches = Object.entries(state.versions)
    .filter(([, version]) => version !== state.canonicalVersion)
    .map(([name, version]) => `${MANAGED_VERSION_PATHS[name as VersionSurfaceName]}=${version}`);
  if (mismatches.length > 0) {
    throw new Error(
      `Version surfaces do not match canonical package.json=${state.canonicalVersion}: ${mismatches.join(", ")}`,
    );
  }
  return state;
}

export function createVersionSurfacePlan(
  root = repositoryRoot,
  requestedVersion?: string,
): readonly VersionSurfaceUpdate[] {
  const surfaces = loadSurfaces(root);
  const version = requestedVersion ?? surfaces.packageJson.version;
  validateApplicationVersion(version);

  return (Object.keys(MANAGED_VERSION_PATHS) as VersionSurfaceName[]).map((name) => {
    const surface = surfaces[name];
    return {
      name,
      path: surface.path,
      before: surface.content,
      after: surface.render(version),
    };
  });
}

export function writeVersionSurfacePlan(
  root: string,
  updates: readonly VersionSurfaceUpdate[],
): readonly string[] {
  const changed: string[] = [];
  for (const update of updates) {
    if (update.before === update.after) continue;
    writeFileSync(resolve(root, update.path), update.after);
    changed.push(update.path);
  }
  return changed;
}

export function synchronizeVersionSurfaces(
  root = repositoryRoot,
  requestedVersion?: string,
): readonly string[] {
  const plan = createVersionSurfacePlan(root, requestedVersion);
  const changed = writeVersionSurfacePlan(root, plan);
  assertVersionSurfaces(root);
  return changed;
}

function runCli(): void {
  const mode = process.argv[2] ?? "--check";
  try {
    if (mode === "--check") {
      const state = assertVersionSurfaces(repositoryRoot);
      console.log(`version-surfaces: ${state.canonicalVersion} is synchronized`);
      return;
    }
    if (mode === "--write") {
      const changed = synchronizeVersionSurfaces(repositoryRoot);
      const state = assertVersionSurfaces(repositoryRoot);
      console.log(
        `version-surfaces: ${state.canonicalVersion} synchronized (${changed.length} file${changed.length === 1 ? "" : "s"} changed)`,
      );
      return;
    }
    throw new Error(`Unknown mode ${mode}. Use --check or --write.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
