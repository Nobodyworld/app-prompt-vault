export const LOCAL_UPDATE_MANIFEST_VERSION = "1" as const;
export const PROMPT_VAULT_IDENTIFIER = "com.nobodyworld.promptvault" as const;

export type InstallScope = "per-user" | "per-machine";

export interface LocalUpdateManifest {
  readonly manifestVersion: typeof LOCAL_UPDATE_MANIFEST_VERSION;
  readonly application: {
    readonly identifier: typeof PROMPT_VAULT_IDENTIFIER;
    readonly version: string;
    readonly sourceCommit: string;
  };
  readonly artifact: {
    readonly format: "msi";
    readonly relativePath: string;
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly msi: {
    readonly productCode: string;
    readonly upgradeCode: string;
    readonly packageCode: string;
    readonly installScope: InstallScope;
  };
  readonly executable: {
    readonly relativePath: string;
    readonly fileVersion: string;
    readonly productVersion: string;
    readonly sha256: string;
  };
}

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly manifest?: LocalUpdateManifest;
}

export interface InstalledUpdateIdentity {
  readonly applicationIdentifier: string;
  readonly version: string;
  readonly executableSha256: string;
  readonly productCode: string;
  readonly upgradeCode: string;
  readonly packageCode: string;
  readonly installScope: InstallScope;
}

export type LocalUpdateDecision =
  | "no-op"
  | "upgrade"
  | "refuse-not-installed"
  | "refuse-foreign-target"
  | "refuse-downgrade"
  | "refuse-same-version-different-payload"
  | "refuse-upgrade-identity-mismatch"
  | "refuse-scope-mismatch";

export interface LocalUpdatePlan {
  readonly decision: LocalUpdateDecision;
  readonly mutatesInstallation: boolean;
  readonly reason: string;
}

export interface VerifiedFileEvidence {
  readonly relativePath: string;
  readonly expectedByteLength: number;
  readonly actualByteLength: number;
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly exists: boolean;
}

export interface RecoverySourceEvidence {
  readonly originalMsi: VerifiedFileEvidence;
  readonly requiresExternalCabinets: boolean;
  readonly cabinets: readonly VerifiedFileEvidence[];
}

export interface RecoverySourceResult {
  readonly ready: boolean;
  readonly errors: readonly string[];
}

export type LocalUpdateOutcomeKind =
  | "not-started"
  | "transaction-failed"
  | "committed-verification-failed"
  | "committed-restart-failed"
  | "success"
  | "success-reboot-required";

export type LocalUpdateFollowUp =
  | "none"
  | "verify-transaction-rollback"
  | "recovery-required";

export interface LocalUpdateOutcome {
  readonly kind: LocalUpdateOutcomeKind;
  readonly installerCommitted: boolean;
  readonly transactionRollbackProven: boolean;
  readonly followUp: LocalUpdateFollowUp;
}

interface VersionTriplet {
  readonly major: number;
  readonly minor: number;
  readonly build: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
): string | null {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string.`);
    return null;
  }
  return value;
}

function readPositiveInteger(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
): number | null {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    errors.push(`${field} must be a positive safe integer.`);
    return null;
  }
  return value;
}

export function normalizeSha256(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export function normalizeMsiGuid(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  const hasOpenBrace = normalized.startsWith("{");
  const hasCloseBrace = normalized.endsWith("}");
  if (hasOpenBrace !== hasCloseBrace) return null;
  const bare = hasOpenBrace ? normalized.slice(1, -1) : normalized;
  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(bare)) {
    return null;
  }
  return `{${bare}}`;
}

export function normalizeConfinedRelativePath(value: string): string | null {
  if (value.includes("\0")) return null;
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes(":")
  ) {
    return null;
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" "),
    )
  ) {
    return null;
  }
  return segments.join("/");
}

export function parseMsiProductVersion(value: string): VersionTriplet | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const build = Number(match[3]);
  if (major > 255 || minor > 255 || build > 65_535) return null;
  return { major, minor, build };
}

export function compareMsiProductVersions(left: string, right: string): -1 | 0 | 1 {
  const a = parseMsiProductVersion(left);
  const b = parseMsiProductVersion(right);
  if (!a || !b) {
    throw new Error("Both versions must be valid three-field Windows Installer ProductVersion values.");
  }
  const leftParts = [a.major, a.minor, a.build];
  const rightParts = [b.major, b.minor, b.build];
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

export function validateLocalUpdateManifest(value: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["manifest must be an object."] };

  if (value.manifestVersion !== LOCAL_UPDATE_MANIFEST_VERSION) {
    errors.push(`manifestVersion must equal ${LOCAL_UPDATE_MANIFEST_VERSION}.`);
  }

  const application = isRecord(value.application) ? value.application : null;
  const artifact = isRecord(value.artifact) ? value.artifact : null;
  const msi = isRecord(value.msi) ? value.msi : null;
  const executable = isRecord(value.executable) ? value.executable : null;
  if (!application) errors.push("application must be an object.");
  if (!artifact) errors.push("artifact must be an object.");
  if (!msi) errors.push("msi must be an object.");
  if (!executable) errors.push("executable must be an object.");
  if (!application || !artifact || !msi || !executable) return { valid: false, errors };

  const identifier = readString(application, "identifier", errors);
  const version = readString(application, "version", errors);
  const sourceCommit = readString(application, "sourceCommit", errors);
  const artifactPath = readString(artifact, "relativePath", errors);
  const artifactBytes = readPositiveInteger(artifact, "byteLength", errors);
  const artifactSha = readString(artifact, "sha256", errors);
  const productCode = readString(msi, "productCode", errors);
  const upgradeCode = readString(msi, "upgradeCode", errors);
  const packageCode = readString(msi, "packageCode", errors);
  const executablePath = readString(executable, "relativePath", errors);
  const fileVersion = readString(executable, "fileVersion", errors);
  const productVersion = readString(executable, "productVersion", errors);
  const executableSha = readString(executable, "sha256", errors);

  if (identifier && identifier !== PROMPT_VAULT_IDENTIFIER) {
    errors.push(`application.identifier must equal ${PROMPT_VAULT_IDENTIFIER}.`);
  }
  if (version && !parseMsiProductVersion(version)) {
    errors.push("application.version must be a valid three-field Windows Installer ProductVersion.");
  }
  if (sourceCommit && !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    errors.push("application.sourceCommit must be a full lowercase 40-character Git SHA.");
  }
  if (artifact.format !== "msi") errors.push("artifact.format must equal msi.");
  if (artifactPath && !normalizeConfinedRelativePath(artifactPath)) {
    errors.push("artifact.relativePath must be a confined relative path.");
  }
  if (artifactSha && !normalizeSha256(artifactSha)) {
    errors.push("artifact.sha256 must be a SHA-256 hex digest.");
  }
  if (productCode && !normalizeMsiGuid(productCode)) errors.push("msi.productCode must be a GUID.");
  if (upgradeCode && !normalizeMsiGuid(upgradeCode)) errors.push("msi.upgradeCode must be a GUID.");
  if (packageCode && !normalizeMsiGuid(packageCode)) errors.push("msi.packageCode must be a GUID.");
  if (msi.installScope !== "per-user" && msi.installScope !== "per-machine") {
    errors.push("msi.installScope must be per-user or per-machine.");
  }
  if (executablePath && !normalizeConfinedRelativePath(executablePath)) {
    errors.push("executable.relativePath must be a confined relative path.");
  }
  if (executableSha && !normalizeSha256(executableSha)) {
    errors.push("executable.sha256 must be a SHA-256 hex digest.");
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    manifest: {
      manifestVersion: LOCAL_UPDATE_MANIFEST_VERSION,
      application: {
        identifier: PROMPT_VAULT_IDENTIFIER,
        version: version!,
        sourceCommit: sourceCommit!,
      },
      artifact: {
        format: "msi",
        relativePath: normalizeConfinedRelativePath(artifactPath!)!,
        byteLength: artifactBytes!,
        sha256: normalizeSha256(artifactSha!)!,
      },
      msi: {
        productCode: normalizeMsiGuid(productCode!)!,
        upgradeCode: normalizeMsiGuid(upgradeCode!)!,
        packageCode: normalizeMsiGuid(packageCode!)!,
        installScope: msi.installScope as InstallScope,
      },
      executable: {
        relativePath: normalizeConfinedRelativePath(executablePath!)!,
        fileVersion: fileVersion!,
        productVersion: productVersion!,
        sha256: normalizeSha256(executableSha!)!,
      },
    },
  };
}

export function planLocalUpdate(
  manifest: LocalUpdateManifest,
  installed: InstalledUpdateIdentity | null,
): LocalUpdatePlan {
  if (!installed) {
    return {
      decision: "refuse-not-installed",
      mutatesInstallation: false,
      reason: "The installed-build updater requires an existing verified Prompt Vault installation.",
    };
  }
  if (installed.applicationIdentifier !== manifest.application.identifier) {
    return {
      decision: "refuse-foreign-target",
      mutatesInstallation: false,
      reason: "The installed target does not match the Prompt Vault application identity.",
    };
  }
  if (installed.installScope !== manifest.msi.installScope) {
    return {
      decision: "refuse-scope-mismatch",
      mutatesInstallation: false,
      reason: "The target MSI installation scope does not match the installed application scope.",
    };
  }

  const ordering = compareMsiProductVersions(installed.version, manifest.application.version);
  if (ordering > 0) {
    return {
      decision: "refuse-downgrade",
      mutatesInstallation: false,
      reason: "The selected MSI version is lower than the installed version.",
    };
  }
  if (ordering === 0) {
    const samePayload =
      normalizeSha256(installed.executableSha256) === manifest.executable.sha256 &&
      normalizeMsiGuid(installed.productCode) === manifest.msi.productCode &&
      normalizeMsiGuid(installed.upgradeCode) === manifest.msi.upgradeCode &&
      normalizeMsiGuid(installed.packageCode) === manifest.msi.packageCode;
    return samePayload
      ? {
          decision: "no-op",
          mutatesInstallation: false,
          reason: "Installed version and verified package payload already match the selected MSI.",
        }
      : {
          decision: "refuse-same-version-different-payload",
          mutatesInstallation: false,
          reason: "Same-version replacement with different package or executable identity is unsupported.",
        };
  }
  if (normalizeMsiGuid(installed.upgradeCode) !== manifest.msi.upgradeCode) {
    return {
      decision: "refuse-upgrade-identity-mismatch",
      mutatesInstallation: false,
      reason: "The selected MSI does not share the installed UpgradeCode.",
    };
  }
  return {
    decision: "upgrade",
    mutatesInstallation: true,
    reason: "A higher MSI ProductVersion with matching application, scope, and UpgradeCode may proceed to later safety gates.",
  };
}

function verifyFileEvidence(file: VerifiedFileEvidence, label: string, errors: string[]): void {
  if (!file.exists) errors.push(`${label} is missing.`);
  if (!normalizeConfinedRelativePath(file.relativePath)) errors.push(`${label} path is not confined.`);
  if (!Number.isSafeInteger(file.expectedByteLength) || file.expectedByteLength <= 0) {
    errors.push(`${label} expected byte length is invalid.`);
  }
  if (!Number.isSafeInteger(file.actualByteLength) || file.actualByteLength <= 0) {
    errors.push(`${label} actual byte length is invalid.`);
  }
  if (file.actualByteLength !== file.expectedByteLength) errors.push(`${label} byte length does not match.`);
  const expectedSha = normalizeSha256(file.expectedSha256);
  const actualSha = normalizeSha256(file.actualSha256);
  if (!expectedSha || !actualSha || expectedSha !== actualSha) errors.push(`${label} SHA-256 does not match.`);
}

export function evaluateRecoverySource(evidence: RecoverySourceEvidence): RecoverySourceResult {
  const errors: string[] = [];
  verifyFileEvidence(evidence.originalMsi, "original MSI", errors);
  if (evidence.requiresExternalCabinets && evidence.cabinets.length === 0) {
    errors.push("required external cabinet evidence is missing.");
  }
  evidence.cabinets.forEach((cabinet, index) => verifyFileEvidence(cabinet, `cabinet ${index + 1}`, errors));
  return { ready: errors.length === 0, errors };
}

export function classifyLocalUpdateOutcome(input: {
  readonly installerLaunched: boolean;
  readonly installerExitCode: number | null;
  readonly transactionRollbackProven?: boolean;
  readonly postInstallVerificationPassed?: boolean;
  readonly restartAttempted?: boolean;
  readonly restartPassed?: boolean;
}): LocalUpdateOutcome {
  if (!input.installerLaunched) {
    return {
      kind: "not-started",
      installerCommitted: false,
      transactionRollbackProven: false,
      followUp: "none",
    };
  }
  if (input.installerExitCode !== 0 && input.installerExitCode !== 3010) {
    const rollbackProven = input.transactionRollbackProven === true;
    return {
      kind: "transaction-failed",
      installerCommitted: false,
      transactionRollbackProven: rollbackProven,
      followUp: rollbackProven ? "none" : "verify-transaction-rollback",
    };
  }
  if (input.postInstallVerificationPassed === false) {
    return {
      kind: "committed-verification-failed",
      installerCommitted: true,
      transactionRollbackProven: false,
      followUp: "recovery-required",
    };
  }
  if (input.restartAttempted && input.restartPassed === false) {
    return {
      kind: "committed-restart-failed",
      installerCommitted: true,
      transactionRollbackProven: false,
      followUp: "recovery-required",
    };
  }
  return {
    kind: input.installerExitCode === 3010 ? "success-reboot-required" : "success",
    installerCommitted: true,
    transactionRollbackProven: false,
    followUp: "none",
  };
}
