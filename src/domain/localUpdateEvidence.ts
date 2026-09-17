import { z } from "zod";
import {
  evaluateRecoverySource, normalizeConfinedRelativePath, normalizeMsiGuid,
  normalizeSha256, parseMsiProductVersion, planLocalUpdate, PROMPT_VAULT_IDENTIFIER,
  validateLocalUpdateManifest, SYNTHETIC_UPDATE_IDENTIFIER,
} from "./localUpdate.js";
import type { InstalledUpdateIdentity, InstallScope, LocalUpdateManifest, LocalUpdatePlan } from "./localUpdate.js";

export const PRODUCT_UPDATE_TARGET = { identifier: PROMPT_VAULT_IDENTIFIER, name: "Prompt Vault", executable: "prompt-vault-app.exe" } as const;
export const SYNTHETIC_UPDATE_TARGET = { identifier: SYNTHETIC_UPDATE_IDENTIFIER, name: "Prompt Vault Update Acceptance", executable: "prompt-vault-update-acceptance.exe" } as const;
export type UpdateTarget = typeof PRODUCT_UPDATE_TARGET | typeof SYNTHETIC_UPDATE_TARGET;

const digest = z.object({ byteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const executable = digest.extend({ fileVersion: z.string(), productVersion: z.string() });
const installedFile = executable.extend({ path: z.string() });
const msiSchema = z.object({
  digest, properties: z.record(z.string(), z.string()), packageCode: z.string(), template: z.string(), wordCount: z.number().int(),
  files: z.array(z.object({ key: z.string(), component: z.string(), name: z.string(), size: z.number().int().positive(), version: z.string(), attributes: z.number().int(), sequence: z.number().int().positive() })),
  components: z.array(z.object({ key: z.string(), directory: z.string() })),
  directories: z.array(z.object({ key: z.string(), parent: z.string(), name: z.string() })),
  media: z.array(z.object({ diskId: z.number().int().positive(), lastSequence: z.number().int().positive(), cabinet: z.string(), digest: digest.nullable(), members: z.array(z.object({ key: z.string(), file: executable })), error: z.string().nullable() })),
});
const observationSchema = z.object({
  schemaVersion: z.literal(1), selected: msiSchema.nullable(), recovery: msiSchema.nullable(), procedure: digest.nullable(),
  recoverySource: z.enum(["not-supplied", "independent-media", "installer-cache", "unverified"]),
  roots: z.array(z.string()), relatedProducts: z.array(z.string()), errors: z.array(z.string()),
  registrations: z.array(z.object({
    source: z.string(), key: z.string(), displayName: z.string(), displayVersion: z.string(), publisher: z.string(),
    installLocation: z.string(), displayIcon: z.string(), windowsInstaller: z.string(), errors: z.array(z.string()),
    services: z.array(z.object({ context: z.number().int(), localPackage: z.string(), version: z.string(), packageCode: z.string(), installLocation: z.string() })),
    cachedMsi: msiSchema.nullable(), executable: installedFile.nullable(),
  })),
  processes: z.array(z.object({ pid: z.number().int().positive(), path: z.string(), file: installedFile.nullable() })),
});
export type UpdateObservation = z.infer<typeof observationSchema>;
type MsiObservation = z.infer<typeof msiSchema>;
type Digest = z.infer<typeof digest>;
const mediaReceipt = z.object({ cabinets: z.array(digest.extend({ relativePath: z.string() })) });
const procedureReceipt = digest.extend({ relativePath: z.string(), kind: z.literal("manual-prior-msi"), testedSourceCommit: z.string().regex(/^[a-f0-9]{40}$/) });
export const REGISTRATION_ROOTS = ["HKCU", "HKLM"].flatMap((hive) => [
  `${hive}/Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall`,
  `${hive}/Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall`,
]);

export interface ReadOnlyUpdateReport {
  readonly schemaVersion: 1;
  readonly readOnly: true;
  readonly installationMutationOccurred: false;
  readonly processMutationOccurred: false;
  readonly applicationDataAccessed: false;
  readonly selected: ReturnType<typeof summarizeMsi>;
  readonly selectedManifest: { valid: boolean; sourceCommit: string | null; artifactVerified: boolean };
  readonly installed: { registrationCount: number; reconciled: boolean; identity: InstalledUpdateIdentity | null; matchingProcessCount: number };
  readonly recovery: { ready: boolean; procedureVerified: boolean; media: ReturnType<typeof summarizeMsi> };
  readonly payloadCorrespondenceProven: boolean;
  readonly planner: { decision: string; reason: string; proposedMutation: boolean; conditional: boolean };
  readonly blockers: readonly string[];
  readonly futureExecutionGates: readonly string[];
}

function scope(msi: MsiObservation): InstallScope | null {
  if (msi.properties.ALLUSERS === "1" && !msi.properties.MSIINSTALLPERUSER) return "per-machine";
  if (!msi.properties.ALLUSERS && !msi.properties.MSIINSTALLPERUSER) return "per-user";
  return null; // Dual-purpose packages need runtime choices this planner cannot establish.
}
function summarizeMsi(msi: MsiObservation | null, target: UpdateTarget): {
  productCode: string | null; upgradeCode: string | null; packageCode: string | null;
  productVersion: string | null; installScope: InstallScope | null; sha256: string; byteLength: number;
  executable: { sha256: string; byteLength: number; fileVersion: string | null; productVersion: string | null } | null;
  media: { embedded: boolean; sha256: string | null; byteLength: number | null; memberCount: number }[];
} | null {
  if (!msi) return null;
  const file = msi.media.flatMap((medium) => medium.members).find((member) => member.key === executableRow(msi, target)?.key)?.file;
  return {
    productCode: normalizeMsiGuid(msi.properties.ProductCode ?? ""), upgradeCode: normalizeMsiGuid(msi.properties.UpgradeCode ?? ""), packageCode: normalizeMsiGuid(msi.packageCode),
    productVersion: parseMsiProductVersion(msi.properties.ProductVersion ?? "") ? msi.properties.ProductVersion : null,
    installScope: scope(msi), ...msi.digest,
    executable: file ? { ...file, fileVersion: /^\d+\.\d+\.\d+\.\d+$/.test(file.fileVersion) ? file.fileVersion : null, productVersion: parseMsiProductVersion(file.productVersion) ? file.productVersion : null } : null,
    media: msi.media.map((medium) => ({ embedded: medium.cabinet.startsWith("#"), sha256: medium.digest?.sha256 ?? null, byteLength: medium.digest?.byteLength ?? null, memberCount: medium.members.length })),
  };
}
function sameDigest(actual: Digest | null, expected: Digest): boolean {
  return actual?.sha256 === normalizeSha256(expected.sha256) && actual.byteLength === expected.byteLength;
}
function metadataValid(msi: MsiObservation, target: UpdateTarget): boolean {
  return msi.properties.ProductName === target.name && msi.properties.Manufacturer === "Nobody Production"
    && !!parseMsiProductVersion(msi.properties.ProductVersion ?? "") && !!scope(msi)
    && !!normalizeMsiGuid(msi.properties.ProductCode ?? "") && !!normalizeMsiGuid(msi.properties.UpgradeCode ?? "")
    && !!normalizeMsiGuid(msi.packageCode) && /^x64;\d+(,\d+)*$/.test(msi.template)
    && (target.identifier !== SYNTHETIC_UPDATE_IDENTIFIER || msi.properties.PV_ACCEPTANCE_IDENTIFIER === target.identifier);
}
function unique(values: readonly (string | number)[]): boolean { return new Set(values).size === values.length; }
function longName(value: string): string { return value.split("|").at(-1) ?? ""; }
function executableRow(msi: MsiObservation, target: UpdateTarget): MsiObservation["files"][number] | null {
  const rows = msi.files.filter((file) => longName(file.name).toLowerCase() === target.executable);
  if (rows.length !== 1) return null;
  const components = msi.components.filter((component) => component.key === rows[0].component);
  // The currently supported Tauri layout puts the executable directly in INSTALLDIR.
  if (components.length !== 1 || components[0].directory !== "INSTALLDIR") return null;
  if (msi.directories.filter((directory) => directory.key === "INSTALLDIR").length !== 1) return null;
  return rows[0];
}
function verifyMedia(msi: MsiObservation, receipt: unknown, label: string, blockers: string[]): boolean {
  const start = blockers.length;
  if (!msi.files.length || !msi.media.length || (msi.wordCount & 4) !== 0
    || !unique(msi.files.map((file) => file.key)) || !unique(msi.files.map((file) => file.sequence))
    || !unique(msi.media.map((medium) => medium.diskId)) || !unique(msi.media.map((medium) => medium.cabinet))) {
    blockers.push(`${label}:invalid-media-layout`);
  }
  const external = msi.media.filter((medium) => !medium.cabinet.startsWith("#"));
  const parsedReceipt = mediaReceipt.safeParse(receipt ?? { cabinets: [] });
  if (!parsedReceipt.success) blockers.push(`${label}:invalid-cabinet-receipt`);
  const cabinets = parsedReceipt.success ? parsedReceipt.data.cabinets : [];
  if (cabinets.length !== external.length || !unique(cabinets.map((cabinet) => cabinet.relativePath.toLowerCase()))) blockers.push(`${label}:cabinet-set-mismatch`);
  let lower = 0;
  for (const medium of [...msi.media].sort((a, b) => a.diskId - b.diskId)) {
    const expected = msi.files.filter((file) => file.sequence > lower && file.sequence <= medium.lastSequence);
    if (medium.lastSequence <= lower || medium.error || !medium.digest || !medium.cabinet || !expected.length || !unique(medium.members.map((member) => member.key)) || medium.members.length !== expected.length) blockers.push(`${label}:incomplete-cabinet`);
    for (const file of expected) {
      const member = medium.members.find((entry) => entry.key === file.key);
      if ((file.attributes & 8192) !== 0 || ((file.attributes & 16384) === 0 && (msi.wordCount & 2) === 0) || !member || member.file.byteLength !== file.size) blockers.push(`${label}:payload-file-mismatch`);
    }
    lower = medium.lastSequence;
    if (!medium.cabinet.startsWith("#")) {
      const expectedCabinet = cabinets.find((cabinet) => cabinet.relativePath === medium.cabinet);
      if (!expectedCabinet || normalizeConfinedRelativePath(expectedCabinet.relativePath) !== medium.cabinet || !sameDigest(medium.digest, expectedCabinet)) blockers.push(`${label}:external-cabinet-unverified`);
    }
  }
  if (msi.files.some((file) => file.sequence > lower)) blockers.push(`${label}:unmapped-payload-file`);
  return blockers.length === start;
}
function verifyManifest(msi: MsiObservation, manifest: LocalUpdateManifest, label: string, blockers: string[], target: UpdateTarget): void {
  if (!metadataValid(msi, target)) blockers.push(`${label}:foreign-or-unsupported-msi`);
  if (!sameDigest(msi.digest, manifest.artifact)) blockers.push(`${label}:artifact-digest-mismatch`);
  if (msi.properties.ProductVersion !== manifest.application.version
    || normalizeMsiGuid(msi.properties.ProductCode ?? "") !== manifest.msi.productCode
    || normalizeMsiGuid(msi.properties.UpgradeCode ?? "") !== manifest.msi.upgradeCode
    || normalizeMsiGuid(msi.packageCode) !== manifest.msi.packageCode
    || scope(msi) !== manifest.msi.installScope) blockers.push(`${label}:manifest-msi-identity-mismatch`);
}
function verifyPayload(msi: MsiObservation, manifest: LocalUpdateManifest, label: string, blockers: string[], target: UpdateTarget): boolean {
  const row = executableRow(msi, target);
  const members = msi.media.flatMap((medium) => medium.members).filter((member) => member.key === row?.key);
  const payload = members.length === 1 ? members[0].file : null;
  const valid = !!row && !!payload && manifest.executable.relativePath === target.executable
    && payload.sha256 === manifest.executable.sha256 && payload.fileVersion === manifest.executable.fileVersion
    && payload.productVersion === manifest.executable.productVersion && row.size === payload.byteLength
    && row.version === payload.fileVersion && payload.productVersion === manifest.application.version;
  if (!valid) blockers.push(`${label}:executable-payload-unproven`);
  return valid;
}
function canonicalPath(value: string): string | null {
  if (!/^[A-Za-z]:\\/.test(value) || value !== value.trim() || /["<>|?*]/.test(value) || [...value].some((char) => char.charCodeAt(0) < 32) || value.slice(2).includes(":")) return null;
  const parts = value.slice(3).replace(/\\$/, "").split("\\");
  if (parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part))) return null;
  return value.replace(/\\$/, "").toLowerCase();
}
function reconcile(observation: UpdateObservation, blockers: string[], target: UpdateTarget): InstalledUpdateIdentity | null {
  const start = blockers.length;
  if (observation.errors.some((error) => error.startsWith("process-"))) blockers.push("installed:process-inventory-incomplete");
  if (observation.errors.includes("related-products-unreadable") || !unique(observation.relatedProducts)
    || observation.relatedProducts.some((code) => !normalizeMsiGuid(code) || !observation.registrations.some((record) => normalizeMsiGuid(record.key) === normalizeMsiGuid(code)))) blockers.push("installed:related-product-inventory-incomplete");
  if (observation.roots.length !== REGISTRATION_ROOTS.length || !REGISTRATION_ROOTS.every((root) => observation.roots.includes(root))) blockers.push("installed:registration-inventory-incomplete");
  if (observation.registrations.length !== 1) {
    blockers.push(observation.registrations.length ? "installed:ambiguous-registration" : "installed:not-installed"); return null;
  }
  const record = observation.registrations[0]; const cached = record.cachedMsi; const exe = record.executable;
  if (!cached || !exe || record.errors.length || record.services.length !== 1 || !REGISTRATION_ROOTS.includes(record.source)) { blockers.push("installed:incomplete-identity"); return null; }
  if (!metadataValid(cached, target) || record.displayName !== target.name || record.publisher !== "Nobody Production" || record.windowsInstaller !== "1") blockers.push("installed:foreign-target");
  const installScope = record.source.startsWith("HKLM/") ? "per-machine" : "per-user";
  const service = record.services[0]; const row = executableRow(cached, target);
  const location = canonicalPath(record.installLocation); const path = canonicalPath(exe.path);
  const icon = record.displayIcon.replace(/^"(.+)"(?:,0)?$/, "$1").replace(/,0$/, "");
  if (!location || path !== location + "\\" + target.executable || canonicalPath(service.installLocation) !== location || (/\.exe$/i.test(icon) && canonicalPath(icon) !== path)) blockers.push("installed:location-contradiction");
  if (scope(cached) !== installScope || (installScope === "per-machine" ? service.context !== 4 : ![1, 2].includes(service.context))) blockers.push("installed:scope-contradiction");
  if (normalizeMsiGuid(record.key) !== normalizeMsiGuid(cached.properties.ProductCode ?? "")
    || normalizeMsiGuid(service.packageCode) !== normalizeMsiGuid(cached.packageCode)
    || record.displayVersion !== cached.properties.ProductVersion || service.version !== record.displayVersion
    || !row || row.version !== exe.fileVersion || row.size !== exe.byteLength || exe.productVersion !== record.displayVersion) blockers.push("installed:identity-contradiction");
  for (const process of observation.processes) {
    if (!process.file || canonicalPath(process.path) !== path || canonicalPath(process.file.path) !== path || !sameDigest(process.file, exe)
      || process.file.fileVersion !== exe.fileVersion || process.file.productVersion !== exe.productVersion) blockers.push("installed:unverified-process");
  }
  if (blockers.length !== start) return null;
  return { applicationIdentifier: target.identifier, version: record.displayVersion, executableSha256: exe.sha256, productCode: normalizeMsiGuid(record.key)!, upgradeCode: normalizeMsiGuid(cached.properties.UpgradeCode)!, packageCode: normalizeMsiGuid(cached.packageCode)!, installScope };
}
function extension(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[field] : undefined;
}

/** Pure validation only; collector JSON is untrusted and cannot authorize mutation. */
export function planObservedLocalUpdate(manifestInput: unknown, observationInput: unknown, recoveryInput?: unknown, target: UpdateTarget = PRODUCT_UPDATE_TARGET): ReadOnlyUpdateReport {
  const blockers: string[] = [];
  const parsed = observationSchema.safeParse(observationInput);
  const observation = parsed.success ? parsed.data : null;
  if (!observation) blockers.push("evidence:malformed-observations");
  if (observation?.errors.length) blockers.push("evidence:collection-incomplete");
  const checked = validateLocalUpdateManifest(manifestInput, target.identifier);
  if (!checked.manifest) blockers.push("selected:valid-source-manifest-required");
  const manifest = checked.manifest;
  const selected = observation?.selected ?? null;
  if (!selected) blockers.push("selected:msi-unavailable");
  const selectedStart = blockers.length;
  let payload = false;
  if (selected) {
    if (!metadataValid(selected, target)) blockers.push("selected:foreign-or-unsupported-msi");
    const complete = verifyMedia(selected, extension(manifestInput, "media"), "selected", blockers);
    if (manifest) {
      verifyManifest(selected, manifest, "selected", blockers, target);
      payload = verifyPayload(selected, manifest, "selected", blockers, target) && complete;
    }
  }
  const installed = observation ? reconcile(observation, blockers, target) : null;
  let recoveryReady = false; let procedureVerified = false;
  const recovery = observation?.recovery ?? null;
  const recoveryManifest = validateLocalUpdateManifest(recoveryInput, target.identifier).manifest;
  const recoveryStart = blockers.length;
  if (observation?.recoverySource === "installer-cache") blockers.push("recovery:cached-msi-is-insufficient");
  if (observation?.recoverySource === "unverified" || (recovery && observation?.recoverySource === "not-supplied")) blockers.push("recovery:source-provenance-unverified");
  if (!recovery || !recoveryManifest) blockers.push("recovery:complete-original-media-required");
  else {
    verifyManifest(recovery, recoveryManifest, "recovery", blockers, target);
    verifyMedia(recovery, extension(recoveryInput, "media"), "recovery", blockers);
    verifyPayload(recovery, recoveryManifest, "recovery", blockers, target);
    if (!installed || planLocalUpdate(recoveryManifest, installed).decision !== "no-op") blockers.push("recovery:prior-installation-identity-mismatch");
    const procedure = procedureReceipt.safeParse(extension(recoveryInput, "recoveryProcedure"));
    procedureVerified = procedure.success && !!normalizeConfinedRelativePath(procedure.data.relativePath)
      && /\.(md|txt)$/i.test(procedure.data.relativePath) && procedure.data.testedSourceCommit === recoveryManifest.application.sourceCommit
      && sameDigest(observation?.procedure ?? null, procedure.data);
    if (!procedureVerified) blockers.push("recovery:verified-procedure-required");
    const external = recovery.media.filter((medium) => !medium.cabinet.startsWith("#"));
    const receipt = mediaReceipt.safeParse(extension(recoveryInput, "media") ?? { cabinets: [] });
    const files = (receipt.success ? receipt.data.cabinets : []).map((expected) => ({
      relativePath: expected.relativePath, expectedByteLength: expected.byteLength, expectedSha256: expected.sha256,
      actualByteLength: external.find((medium) => medium.cabinet === expected.relativePath)?.digest?.byteLength ?? 0,
      actualSha256: external.find((medium) => medium.cabinet === expected.relativePath)?.digest?.sha256 ?? "", exists: external.some((medium) => medium.cabinet === expected.relativePath && !!medium.digest),
    }));
    const source = evaluateRecoverySource({ originalMsi: { relativePath: recoveryManifest.artifact.relativePath, expectedByteLength: recoveryManifest.artifact.byteLength, expectedSha256: recoveryManifest.artifact.sha256, actualByteLength: recovery.digest.byteLength, actualSha256: recovery.digest.sha256, exists: true }, requiresExternalCabinets: external.length > 0, cabinets: files });
    if (!source.ready) blockers.push("recovery:source-verification-failed");
    recoveryReady = blockers.length === recoveryStart;
  }
  let plan: LocalUpdatePlan | null = null;
  // Domain comparison is meaningful only after the selected and installed identity reconcile.
  const selectedValid = !!manifest && !!selected && payload && !blockers.slice(selectedStart).some((blocker) => blocker.startsWith("selected:"));
  if (selectedValid && installed) plan = planLocalUpdate(manifest, installed);
  if (plan?.decision.startsWith("refuse-")) blockers.push(`planner:${plan.decision}`);
  const uniqueBlockers = [...new Set(blockers)];
  const decision = plan?.decision ?? "refuse-unverified-evidence";
  return {
    schemaVersion: 1, readOnly: true, installationMutationOccurred: false, processMutationOccurred: false, applicationDataAccessed: false,
    selected: summarizeMsi(selected, target), selectedManifest: { valid: !!manifest, sourceCommit: manifest?.application.sourceCommit ?? null, artifactVerified: selectedValid },
    installed: { registrationCount: observation?.registrations.length ?? 0, reconciled: !!installed, identity: installed, matchingProcessCount: installed ? observation!.processes.length : 0 },
    recovery: { ready: recoveryReady, procedureVerified, media: summarizeMsi(recovery, target) }, payloadCorrespondenceProven: payload,
    planner: { decision, reason: plan?.reason ?? "Evidence is incomplete or contradictory; no verified update plan exists.", proposedMutation: plan?.mutatesInstallation ?? false, conditional: decision === "upgrade" },
    blockers: uniqueBlockers,
    futureExecutionGates: ["attended-synthetic-msi-acceptance", "reviewed-mutating-executor", "fresh-execution-boundary-revalidation", "graceful-shutdown-and-supported-backup", "quiescent-data-preservation-inventory", "explicit-owner-authorization"],
  };
}
