export const BACKUP_FORMAT = "prompt-vault-backup" as const;
export const BACKUP_VERSION = "2.0" as const;
export const LEGACY_BACKUP_VERSION = "1.0" as const;

export const RECOVERY_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxPrompts: 10_000,
  maxVersions: 50_000,
  maxBodyCharacters: 100 * 1024,
  maxTitleCharacters: 500,
  maxDescriptionCharacters: 2_000,
  maxCategoryCharacters: 100,
  maxChangelogCharacters: 2_000,
  maxTagsPerPrompt: 10,
  maxTagCharacters: 100,
} as const;

export interface RecoveryVersion {
  readonly sourceId?: string;
  readonly semanticVersion: string;
  readonly body: string;
  readonly bodyHash: string;
  readonly changelog: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecoveryPrompt {
  readonly sourceId?: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly isFavorite: boolean;
  readonly rating: number | null;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: readonly RecoveryVersion[];
}

export interface RecoveryDocument {
  readonly format: typeof BACKUP_FORMAT;
  readonly sourceVersion: typeof BACKUP_VERSION | typeof LEGACY_BACKUP_VERSION;
  readonly exportedAt: string;
  readonly historyCoverage: "full-history" | "latest-version-only";
  readonly prompts: readonly RecoveryPrompt[];
}

export interface BackupVersionV2 {
  readonly sourceId?: string;
  readonly semanticVersion: string;
  readonly body: string;
  readonly changelog: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BackupPromptV2 {
  readonly sourceId?: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly isFavorite: boolean;
  readonly rating: number | null;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: readonly BackupVersionV2[];
}

export interface BackupDocumentV2 {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: typeof BACKUP_VERSION;
  readonly exportedAt: string;
  readonly summary: {
    readonly promptCount: number;
    readonly versionCount: number;
  };
  readonly prompts: readonly BackupPromptV2[];
}

export interface BackupValidationResult {
  readonly valid: boolean;
  readonly format: string | null;
  readonly version: string | null;
  readonly exportedAt: string | null;
  readonly promptCount: number;
  readonly versionCount: number;
  readonly validRecordCount: number;
  readonly invalidRecordCount: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly latestVersionOnly: boolean;
  readonly unsupportedVersion: boolean;
  readonly document?: RecoveryDocument;
}

export interface RecoveryLibraryPrompt extends RecoveryPrompt {
  readonly id: string;
}

export type RestoreConflictKind =
  | "new-prompt"
  | "existing-exact-duplicate"
  | "existing-slug-conflict"
  | "mergeable-missing-versions"
  | "copy-required-conflict";

export type RestorePolicy =
  | "skip-existing"
  | "add-missing-versions"
  | "import-as-copy";

export interface RestorePlanEntry {
  readonly sourceSlug: string;
  readonly kind: RestoreConflictKind;
  readonly currentPromptId: string | null;
  readonly missingVersionIdentities: readonly string[];
  readonly skippedVersionIdentities: readonly string[];
  readonly copySlug: string | null;
  readonly copyTitle: string | null;
}

export interface RestorePlan {
  readonly planVersion: "1";
  readonly planId: string;
  readonly sourceVersion: RecoveryDocument["sourceVersion"];
  readonly documentFingerprint: string;
  readonly currentLibraryFingerprint: string;
  readonly entries: readonly RestorePlanEntry[];
  readonly warnings: readonly string[];
}

export interface RestoreResult {
  readonly sourceFormat: RecoveryDocument["sourceVersion"];
  readonly policy: RestorePolicy;
  readonly newPrompts: number;
  readonly copiedPrompts: number;
  readonly mergedVersions: number;
  readonly skippedPrompts: number;
  readonly skippedVersions: number;
  readonly invalidRecords: number;
  readonly warnings: readonly string[];
  readonly integrityResult: "ok" | "unavailable";
  readonly foreignKeyViolationCount: number;
}

export interface ExportVerificationResult {
  readonly verified: boolean;
  readonly promptCount: number;
  readonly versionCount: number;
  readonly deterministicOrdering: boolean;
  readonly errors: readonly string[];
}

export interface StorageStatus {
  readonly runtime: "native" | "http" | "browser-fallback";
  readonly storage: "sqlite" | "localStorage";
  readonly databasePath: string | null;
  readonly databaseExists: boolean | null;
  readonly databaseSize: number | null;
  readonly sqliteUserVersion: number | null;
  readonly promptCount: number | null;
  readonly versionCount: number | null;
  readonly tagCount: number | null;
  readonly relationshipCount: number | null;
  readonly walExists: boolean | null;
  readonly walSize: number | null;
  readonly shmExists: boolean | null;
  readonly shmSize: number | null;
  readonly integrityStatus: "ok" | "failed" | "not-requested" | "unavailable";
  readonly nativeSqliteAvailable: boolean;
  readonly legacyRecoveryAvailable: boolean;
  readonly plaintextWarning: string;
}

export type LegacySourceState =
  | "not-found"
  | "compatible"
  | "unsupported-schema"
  | "unreadable"
  | "corrupt";

export interface LegacySourceStatus {
  readonly state: LegacySourceState;
  readonly fileName: string | null;
  readonly fileSize: number | null;
  readonly sha256: string | null;
  readonly sqliteUserVersion: number | null;
  readonly recognizedSchema: string | null;
  readonly promptCount: number | null;
  readonly versionCount: number | null;
  readonly tagCount: number | null;
  readonly relationshipCount: number | null;
  readonly integrityStatus: "ok" | "failed" | "unavailable";
  readonly warnings: readonly string[];
}

export interface LegacyRecoveryPreview {
  readonly status: LegacySourceStatus;
  readonly sourceHash: string;
  readonly document: RecoveryDocument;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(
  value: unknown,
  field: string,
  errors: string[],
  options: { nullable?: boolean; max?: number; allowEmpty?: boolean } = {},
): string | null {
  if (value === null && options.nullable) return null;
  if (typeof value !== "string") {
    errors.push(`${field} must be ${options.nullable ? "a string or null" : "a string"}.`);
    return null;
  }
  if (!options.allowEmpty && value.trim().length === 0) {
    errors.push(`${field} cannot be empty.`);
  }
  if (options.max !== undefined && value.length > options.max) {
    errors.push(`${field} exceeds the ${options.max}-character limit.`);
  }
  return value;
}

function normalizedIso(
  value: unknown,
  field: string,
  errors: string[],
  fallback?: string,
): string {
  if (value === undefined && fallback) return fallback;
  if (typeof value !== "string") {
    errors.push(`${field} must be an ISO-8601 timestamp.`);
    return fallback ?? "1970-01-01T00:00:00.000Z";
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    errors.push(`${field} is not a possible timestamp.`);
    return fallback ?? "1970-01-01T00:00:00.000Z";
  }
  const normalized = new Date(time).toISOString();
  const year = new Date(time).getUTCFullYear();
  if (year < 1970 || year > 9999) {
    errors.push(`${field} is outside the supported year range.`);
  }
  return normalized;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function isSemanticVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.trim());
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareVersions(left: RecoveryVersion, right: RecoveryVersion): number {
  return (
    compareText(left.createdAt, right.createdAt) ||
    compareText(left.semanticVersion, right.semanticVersion) ||
    compareText(left.bodyHash, right.bodyHash) ||
    compareText(left.sourceId ?? "", right.sourceId ?? "")
  );
}

function normalizeTags(
  value: unknown,
  field: string,
  errors: string[],
  warnings: string[],
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return [];
  }
  if (value.length > RECOVERY_LIMITS.maxTagsPerPrompt) {
    errors.push(`${field} exceeds the ${RECOVERY_LIMITS.maxTagsPerPrompt}-tag limit.`);
  }
  const tags = new Map<string, string>();
  value.forEach((candidate, index) => {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      errors.push(`${field}[${index}] must be a non-empty string.`);
      return;
    }
    const tag = candidate.trim();
    if (tag.length > RECOVERY_LIMITS.maxTagCharacters) {
      errors.push(`${field}[${index}] exceeds the ${RECOVERY_LIMITS.maxTagCharacters}-character limit.`);
      return;
    }
    const key = tag.toLowerCase();
    if (tags.has(key)) {
      warnings.push(`${field} contained a duplicate tag; the duplicate was removed.`);
      return;
    }
    tags.set(key, tag);
  });
  return [...tags.values()].sort((left, right) =>
    compareText(left.toLowerCase(), right.toLowerCase()) || compareText(left, right),
  );
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Small dependency-free SHA-256 implementation shared by browser and Node. */
export function sha256(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high);
  view.setUint32(paddedLength - 4, low);
  const constants = new Uint32Array(64);
  const initial = new Uint32Array(8);
  let prime = 2;
  let constantIndex = 0;
  while (constantIndex < 64) {
    let isPrime = true;
    for (let divisor = 2; divisor * divisor <= prime; divisor += 1) {
      if (prime % divisor === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) {
      if (constantIndex < 8) {
        initial[constantIndex] = Math.floor((Math.sqrt(prime) % 1) * 0x1_0000_0000);
      }
      constants[constantIndex] = Math.floor((Math.cbrt(prime) % 1) * 0x1_0000_0000);
      constantIndex += 1;
    }
    prime += 1;
  }
  const hash = initial;
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = rightRotate(x, 7) ^ rightRotate(x, 18) ^ (x >>> 3);
      const sigma1 = rightRotate(y, 17) ^ rightRotate(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function versionIdentity(version: Pick<RecoveryVersion, "semanticVersion" | "body" | "bodyHash">): string {
  return `${version.semanticVersion.trim()}\u0000${version.bodyHash || sha256(version.body)}`;
}

function parseVersion(
  value: unknown,
  field: string,
  errors: string[],
  fallbackTimestamp: string,
  legacy = false,
): RecoveryVersion | null {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object.`);
    return null;
  }
  const semanticVersion = stringValue(value.semanticVersion ?? value.version, `${field}.semanticVersion`, errors);
  const body = stringValue(value.body, `${field}.body`, errors, {
    max: RECOVERY_LIMITS.maxBodyCharacters,
  });
  if (semanticVersion !== null && !isSemanticVersion(semanticVersion)) {
    errors.push(`${field}.semanticVersion must follow MAJOR.MINOR.PATCH.`);
  }
  if (semanticVersion === null || body === null) return null;
  const updatedAt = normalizedIso(value.updatedAt, `${field}.updatedAt`, errors, fallbackTimestamp);
  const createdAt = normalizedIso(value.createdAt, `${field}.createdAt`, errors, updatedAt);
  const changelog = legacy
    ? null
    : stringValue(value.changelog ?? null, `${field}.changelog`, errors, {
        nullable: true,
        max: RECOVERY_LIMITS.maxChangelogCharacters,
        allowEmpty: true,
      });
  const sourceId = typeof value.sourceId === "string" && value.sourceId.trim() ? value.sourceId : undefined;
  return {
    ...(sourceId ? { sourceId } : {}),
    semanticVersion: semanticVersion.trim(),
    body,
    bodyHash: sha256(body),
    changelog,
    createdAt,
    updatedAt,
  };
}

function parsePrompt(
  value: unknown,
  index: number,
  errors: string[],
  warnings: string[],
  exportedAt: string,
  legacy: boolean,
): RecoveryPrompt | null {
  const field = `prompts[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${field} must be an object.`);
    return null;
  }
  const slug = stringValue(value.slug, `${field}.slug`, errors);
  const title = stringValue(value.title, `${field}.title`, errors, { max: RECOVERY_LIMITS.maxTitleCharacters });
  if (slug !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizeSlug(slug))) {
    errors.push(`${field}.slug must use lowercase letters, numbers, and hyphens.`);
  }
  const description = stringValue(value.description ?? null, `${field}.description`, errors, {
    nullable: true,
    max: RECOVERY_LIMITS.maxDescriptionCharacters,
    allowEmpty: true,
  });
  const category = stringValue(value.category ?? null, `${field}.category`, errors, {
    nullable: true,
    max: RECOVERY_LIMITS.maxCategoryCharacters,
    allowEmpty: true,
  });
  const isFavorite = value.isFavorite ?? false;
  if (typeof isFavorite !== "boolean") errors.push(`${field}.isFavorite must be a boolean.`);
  const rating = value.rating ?? null;
  if (rating !== null && (!Number.isInteger(rating) || Number(rating) < 1 || Number(rating) > 5)) {
    errors.push(`${field}.rating must be null or an integer from 1 through 5.`);
  }
  const tags = normalizeTags(value.tags ?? [], `${field}.tags`, errors, warnings);
  const updatedAt = normalizedIso(value.updatedAt, `${field}.updatedAt`, errors, exportedAt);
  const createdAt = normalizedIso(value.createdAt, `${field}.createdAt`, errors, updatedAt);
  const versionValues = legacy
    ? [{
        sourceId: typeof value.id === "string" ? value.id : undefined,
        semanticVersion: value.version ?? "1.0.0",
        body: value.body,
        changelog: null,
        createdAt,
        updatedAt,
      }]
    : value.versions;
  if (!Array.isArray(versionValues) || versionValues.length === 0) {
    errors.push(`${field}.versions must contain at least one version.`);
    return null;
  }
  const versions = versionValues
    .map((candidate, versionIndex) =>
      parseVersion(candidate, `${field}.versions[${versionIndex}]`, errors, updatedAt, legacy),
    )
    .filter((candidate): candidate is RecoveryVersion => candidate !== null)
    .sort(compareVersions);
  const seenVersions = new Set<string>();
  for (const version of versions) {
    const identity = versionIdentity(version);
    if (seenVersions.has(identity)) {
      errors.push(`${field} contains a duplicate version identity (${version.semanticVersion}).`);
    }
    seenVersions.add(identity);
  }
  if (slug === null || title === null || typeof isFavorite !== "boolean") return null;
  const sourceIdValue = value.sourceId ?? value.id;
  const sourceId = typeof sourceIdValue === "string" && sourceIdValue.trim() ? sourceIdValue : undefined;
  return {
    ...(sourceId ? { sourceId } : {}),
    slug: normalizeSlug(slug),
    title: title.trim(),
    description: description?.trim() || null,
    category: category?.trim() || null,
    isFavorite,
    rating: rating === null ? null : Number(rating),
    tags,
    createdAt,
    updatedAt,
    versions,
  };
}

function invalidResult(overrides: Partial<BackupValidationResult>): BackupValidationResult {
  return {
    valid: false,
    format: null,
    version: null,
    exportedAt: null,
    promptCount: 0,
    versionCount: 0,
    validRecordCount: 0,
    invalidRecordCount: 0,
    warnings: [],
    errors: [],
    latestVersionOnly: false,
    unsupportedVersion: false,
    ...overrides,
  };
}

export function validateBackupValue(value: unknown): BackupValidationResult {
  if (!isRecord(value)) return invalidResult({ errors: ["The backup root must be an object."] });
  const rawVersion = value.version;
  const format = value.format;
  const isV2 = format === BACKUP_FORMAT && rawVersion === BACKUP_VERSION;
  const isV1 = rawVersion === LEGACY_BACKUP_VERSION && (format === undefined || format === BACKUP_FORMAT);
  if (!isV2 && !isV1) {
    const version = typeof rawVersion === "string" ? rawVersion : null;
    return invalidResult({
      format: typeof format === "string" ? format : null,
      version,
      unsupportedVersion: version !== null,
      errors: [version ? `Backup version ${version} is not supported.` : "The backup format/version is missing or unsupported."],
    });
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const exportedAt = normalizedIso(value.exportedAt, "exportedAt", errors);
  const rawPrompts = value.prompts;
  if (!Array.isArray(rawPrompts)) {
    return invalidResult({
      format: isV2 ? BACKUP_FORMAT : null,
      version: isV2 ? BACKUP_VERSION : LEGACY_BACKUP_VERSION,
      exportedAt,
      errors: [...errors, "prompts must be an array."],
      latestVersionOnly: isV1,
    });
  }
  if (rawPrompts.length > RECOVERY_LIMITS.maxPrompts) {
    errors.push(`The backup exceeds the ${RECOVERY_LIMITS.maxPrompts}-prompt limit.`);
  }
  const prompts = rawPrompts
    .map((candidate, index) => parsePrompt(candidate, index, errors, warnings, exportedAt, isV1))
    .filter((candidate): candidate is RecoveryPrompt => candidate !== null)
    .sort((left, right) => compareText(left.slug, right.slug) || compareText(left.sourceId ?? "", right.sourceId ?? ""));
  const seenSlugs = new Set<string>();
  for (const prompt of prompts) {
    if (seenSlugs.has(prompt.slug)) errors.push(`The backup contains duplicate prompt slug "${prompt.slug}".`);
    seenSlugs.add(prompt.slug);
  }
  const versionCount = prompts.reduce((count, prompt) => count + prompt.versions.length, 0);
  if (versionCount > RECOVERY_LIMITS.maxVersions) {
    errors.push(`The backup exceeds the ${RECOVERY_LIMITS.maxVersions}-version limit.`);
  }
  if (isV2) {
    if (!isRecord(value.summary)) {
      errors.push("summary must be an object.");
    } else {
      if (value.summary.promptCount !== prompts.length) errors.push("summary.promptCount does not match the backup document.");
      if (value.summary.versionCount !== versionCount) errors.push("summary.versionCount does not match the backup document.");
    }
  } else {
    warnings.push("Backup 1.0 contains only the latest available version; absent history was not preserved or verified.");
  }
  const document: RecoveryDocument = {
    format: BACKUP_FORMAT,
    sourceVersion: isV2 ? BACKUP_VERSION : LEGACY_BACKUP_VERSION,
    exportedAt,
    historyCoverage: isV2 ? "full-history" : "latest-version-only",
    prompts,
  };
  return {
    valid: errors.length === 0,
    format: BACKUP_FORMAT,
    version: document.sourceVersion,
    exportedAt,
    promptCount: prompts.length,
    versionCount,
    validRecordCount: errors.length === 0 ? prompts.length : 0,
    invalidRecordCount: errors.length === 0 ? 0 : Math.max(1, rawPrompts.length - prompts.length),
    warnings,
    errors,
    latestVersionOnly: isV1,
    unsupportedVersion: false,
    ...(errors.length === 0 ? { document } : {}),
  };
}

export function parseBackupText(text: string): BackupValidationResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > RECOVERY_LIMITS.maxBytes) {
    return invalidResult({ errors: [`The backup exceeds the ${RECOVERY_LIMITS.maxBytes}-byte input limit.`] });
  }
  try {
    return validateBackupValue(JSON.parse(text) as unknown);
  } catch {
    return invalidResult({ errors: ["The selected file is not valid JSON."] });
  }
}

function versionForExport(version: RecoveryVersion): BackupVersionV2 {
  return {
    ...(version.sourceId ? { sourceId: version.sourceId } : {}),
    semanticVersion: version.semanticVersion,
    body: version.body,
    changelog: version.changelog,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

export function buildBackupDocumentV2(
  prompts: readonly RecoveryLibraryPrompt[],
  exportedAt = new Date().toISOString(),
): BackupDocumentV2 {
  const normalizedPrompts = prompts
    .map((prompt): BackupPromptV2 => ({
      sourceId: prompt.id,
      slug: normalizeSlug(prompt.slug),
      title: prompt.title,
      description: prompt.description ?? null,
      category: prompt.category ?? null,
      isFavorite: prompt.isFavorite,
      rating: prompt.rating ?? null,
      tags: normalizeTags(prompt.tags, `prompt ${prompt.slug} tags`, [], []),
      createdAt: normalizedIso(prompt.createdAt, "createdAt", []),
      updatedAt: normalizedIso(prompt.updatedAt, "updatedAt", []),
      versions: [...prompt.versions].sort(compareVersions).map(versionForExport),
    }))
    .sort((left, right) => compareText(left.slug, right.slug) || compareText(left.sourceId ?? "", right.sourceId ?? ""));
  const versionCount = normalizedPrompts.reduce((count, prompt) => count + prompt.versions.length, 0);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: normalizedIso(exportedAt, "exportedAt", []),
    summary: { promptCount: normalizedPrompts.length, versionCount },
    prompts: normalizedPrompts,
  };
}

export function serializeBackupDocument(document: BackupDocumentV2): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function verifyBackupExport(document: BackupDocumentV2): ExportVerificationResult {
  const validation = parseBackupText(serializeBackupDocument(document));
  const rebuilt = validation.document
    ? buildBackupDocumentV2(
        validation.document.prompts.map((prompt, index) => ({ ...prompt, id: prompt.sourceId ?? `source-${index}` })),
        validation.document.exportedAt,
      )
    : null;
  const deterministicOrdering = rebuilt !== null && serializeBackupDocument(rebuilt) === serializeBackupDocument(document);
  const errors = [...validation.errors];
  if (!deterministicOrdering) errors.push("The backup document is not in deterministic order.");
  return {
    verified: validation.valid && deterministicOrdering,
    promptCount: validation.promptCount,
    versionCount: validation.versionCount,
    deterministicOrdering,
    errors,
  };
}

function canonicalRecoveryDocument(document: RecoveryDocument): string {
  return JSON.stringify({
    format: document.format,
    sourceVersion: document.sourceVersion,
    exportedAt: document.exportedAt,
    historyCoverage: document.historyCoverage,
    prompts: document.prompts,
  });
}

export function fingerprintRecoveryDocument(document: RecoveryDocument): string {
  return sha256(canonicalRecoveryDocument(document));
}

export function fingerprintLibrary(prompts: readonly RecoveryLibraryPrompt[]): string {
  const canonical = prompts
    .map((prompt) => ({
      id: prompt.id,
      slug: normalizeSlug(prompt.slug),
      title: prompt.title,
      description: prompt.description ?? null,
      category: prompt.category ?? null,
      isFavorite: prompt.isFavorite,
      rating: prompt.rating ?? null,
      tags: [...prompt.tags].sort((left, right) => compareText(left.toLowerCase(), right.toLowerCase())),
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
      versions: prompt.versions
        .map((version) => ({
          identity: versionIdentity(version),
          createdAt: version.createdAt,
          updatedAt: version.updatedAt,
          changelog: version.changelog,
        }))
        .sort((left, right) => compareText(left.createdAt, right.createdAt) || compareText(left.identity, right.identity)),
    }))
    .sort((left, right) => compareText(left.slug, right.slug) || compareText(left.id, right.id));
  return sha256(JSON.stringify(canonical));
}

function copiedTitle(title: string): string {
  return title.endsWith(" (imported copy)") ? title : `${title} (imported copy)`;
}

export function buildRestorePlan(
  document: RecoveryDocument,
  currentLibrary: readonly RecoveryLibraryPrompt[],
): RestorePlan {
  const currentBySlug = new Map(currentLibrary.map((prompt) => [normalizeSlug(prompt.slug), prompt]));
  const reservedSlugs = new Set(currentLibrary.map((prompt) => normalizeSlug(prompt.slug)));
  const entries = document.prompts.map((source): RestorePlanEntry => {
    const current = currentBySlug.get(source.slug);
    if (!current) {
      reservedSlugs.add(source.slug);
      return {
        sourceSlug: source.slug,
        kind: "new-prompt",
        currentPromptId: null,
        missingVersionIdentities: source.versions.map(versionIdentity),
        skippedVersionIdentities: [],
        copySlug: null,
        copyTitle: null,
      };
    }
    const currentIdentities = new Set(current.versions.map(versionIdentity));
    const missing = source.versions.map(versionIdentity).filter((identity) => !currentIdentities.has(identity));
    const skipped = source.versions.map(versionIdentity).filter((identity) => currentIdentities.has(identity));
    const currentSemantics = new Map(current.versions.map((version) => [version.semanticVersion, version.bodyHash]));
    const semanticBodyConflict = source.versions.some((version) => {
      const existingHash = currentSemantics.get(version.semanticVersion);
      return existingHash !== undefined && existingHash !== version.bodyHash;
    });
    const metadataEqual =
      current.title === source.title &&
      (current.description ?? null) === source.description &&
      (current.category ?? null) === source.category &&
      current.isFavorite === source.isFavorite &&
      (current.rating ?? null) === source.rating &&
      JSON.stringify([...current.tags].map((tag) => tag.toLowerCase()).sort()) ===
        JSON.stringify([...source.tags].map((tag) => tag.toLowerCase()).sort());
    let kind: RestoreConflictKind;
    if (missing.length === 0 && metadataEqual) kind = "existing-exact-duplicate";
    else if (missing.length === 0) kind = "existing-slug-conflict";
    else if (semanticBodyConflict) kind = "copy-required-conflict";
    else if (skipped.length > 0) kind = "mergeable-missing-versions";
    else kind = "existing-slug-conflict";
    const base = `${source.slug}-imported`;
    let copySlug = base;
    let suffix = 2;
    while (reservedSlugs.has(copySlug)) {
      copySlug = `${base}-${suffix}`;
      suffix += 1;
    }
    reservedSlugs.add(copySlug);
    return {
      sourceSlug: source.slug,
      kind,
      currentPromptId: current.id,
      missingVersionIdentities: missing,
      skippedVersionIdentities: skipped,
      copySlug,
      copyTitle: copiedTitle(source.title),
    };
  });
  const documentFingerprint = fingerprintRecoveryDocument(document);
  const currentLibraryFingerprint = fingerprintLibrary(currentLibrary);
  const planCore = {
    planVersion: "1" as const,
    sourceVersion: document.sourceVersion,
    documentFingerprint,
    currentLibraryFingerprint,
    entries,
    warnings:
      document.historyCoverage === "latest-version-only"
        ? ["Backup 1.0 contains only the latest available version."]
        : [],
  };
  return { ...planCore, planId: sha256(JSON.stringify(planCore)) };
}

export function planMatches(
  plan: RestorePlan,
  document: RecoveryDocument,
  currentLibrary: readonly RecoveryLibraryPrompt[],
): boolean {
  const rebuilt = buildRestorePlan(document, currentLibrary);
  return rebuilt.planId === plan.planId && rebuilt.currentLibraryFingerprint === plan.currentLibraryFingerprint;
}
