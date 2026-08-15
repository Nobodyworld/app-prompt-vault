import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { win32 } from "node:path";
import Database from "better-sqlite3";
import { parseBackupText, type RecoveryDocument } from "../../src/domain/recovery.js";
import { PromptVaultService } from "../../src/services/PromptVaultService.js";
import { StructuredLogger } from "../../src/observability/logger.js";
import { resetCoreDb } from "../../src/lib/platform-core.js";
import { assertDownloadPath } from "./installed-webview2-cdp.js";

export type InstalledProfileGroup = "isolated-self-test" | "isolated-storage-status" | "isolated-missing-source" | "legacy-recovery" | "backup-and-restart" | "skip-policy" | "merge-policy" | "copy-policy" | "cancellation" | "stale-plan" | "version-revert-and-restart" | "final-verification";

export const PHASE_PROFILE_GROUP: Readonly<Record<string, InstalledProfileGroup>> = {
  "self-test": "isolated-self-test", "storage-status": "isolated-storage-status", "missing-legacy-source": "isolated-missing-source", "compatible-legacy-inspection": "legacy-recovery", "explicit-legacy-restore": "legacy-recovery", "backup-2-export-and-verify": "backup-and-restart", "backup-1-preview-and-cancel": "cancellation", "skip-existing": "skip-policy", "add-missing-versions": "merge-policy", "import-as-copy": "copy-policy", "cancellation": "cancellation", "stale-plan-rejection": "stale-plan", "version-history-preview": "version-revert-and-restart", "version-history-revert": "version-revert-and-restart", "restart-verification": "backup-and-restart", "version-history-restart-verification": "version-revert-and-restart", "final-database-verification": "final-verification",
};

export function phaseEvidenceDirectory(root: string, index: number, phase: string, attempt: number): string {
  if (!Number.isInteger(index) || index < 1 || !Number.isInteger(attempt) || attempt < 1 || !/^[a-z0-9-]+$/.test(phase)) throw new Error("Invalid phase evidence identity.");
  return assertDownloadPath(win32.join(root, "phases", `${String(index).padStart(2, "0")}-${phase}`, `attempt-${attempt}`), root);
}

export async function writeSafePhaseEvidence(root: string, index: number, phase: string, attempt: number, value: Record<string, unknown>): Promise<string> {
  const directory = phaseEvidenceDirectory(root, index, phase, attempt);
  await mkdir(directory, { recursive: true });
  const path = assertDownloadPath(win32.join(directory, "phase-result.json"), root);
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
  return path;
}

export interface LogicalPromptSnapshot { readonly id: string; readonly slug: string; readonly title: string; readonly description: string | null; readonly category: string | null; readonly favorite: boolean; readonly rating: number | null; readonly createdAt: string; readonly updatedAt: string; readonly versions: readonly { readonly id: string; readonly semanticVersion: string; readonly bodySha256: string; readonly changelog: string | null; readonly createdAt: string; readonly updatedAt: string }[]; readonly tags: readonly string[]; }
export interface LogicalDatabaseSnapshot { readonly prompts: readonly LogicalPromptSnapshot[]; readonly tagLabels: readonly string[]; readonly relationships: readonly { readonly promptId: string; readonly tagLabel: string }[]; readonly counts: { readonly prompts: number; readonly versions: number; readonly tags: number; readonly relationships: number }; readonly digest: string; }
export type SnapshotTransitionPolicy = "skip-existing" | "add-missing-versions" | "import-as-copy" | "cancel" | "stale-plan" | "version-revert" | "version-revert-restart";
export interface SnapshotTransitionResult { readonly policy: SnapshotTransitionPolicy; readonly beforeCounts: LogicalDatabaseSnapshot["counts"]; readonly afterCounts: LogicalDatabaseSnapshot["counts"]; readonly beforeDigest: string; readonly afterDigest: string; }

export function snapshotDisposableDatabase(path: string): LogicalDatabaseSnapshot {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const promptRows = db.prepare("SELECT id, slug, title, description, category, is_favorite, rating, created_at, updated_at FROM prompts WHERE deleted_at IS NULL ORDER BY LOWER(slug), id").all() as Array<Record<string, unknown>>;
    const versions = db.prepare("SELECT id, semantic_version, body, changelog, created_at, updated_at FROM prompt_versions WHERE prompt_id = ? ORDER BY datetime(created_at), rowid");
    const tags = db.prepare("SELECT t.label FROM tags t JOIN prompt_tags pt ON pt.tag_id=t.id WHERE pt.prompt_id=? ORDER BY LOWER(t.label), t.label");
    const prompts = promptRows.map((row) => ({ id: String(row.id), slug: String(row.slug), title: String(row.title), description: row.description === null ? null : String(row.description), category: row.category === null ? null : String(row.category), favorite: Number(row.is_favorite) !== 0, rating: row.rating === null ? null : Number(row.rating), createdAt: String(row.created_at), updatedAt: String(row.updated_at), versions: (versions.all(row.id) as Array<Record<string, unknown>>).map((version) => ({ id: String(version.id), semanticVersion: String(version.semantic_version), bodySha256: createHash("sha256").update(String(version.body)).digest("hex"), changelog: version.changelog === null ? null : String(version.changelog), createdAt: String(version.created_at), updatedAt: String(version.updated_at) })), tags: (tags.all(row.id) as Array<{ label: string }>).map((tag) => tag.label) }));
    const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
    const counts = { prompts: count("prompts"), versions: count("prompt_versions"), tags: count("tags"), relationships: count("prompt_tags") };
    const tagLabels = (db.prepare("SELECT label FROM tags ORDER BY LOWER(label), label").all() as Array<{ label: string }>).map((tag) => tag.label);
    const relationships = (db.prepare("SELECT prompt_id, tag_id FROM prompt_tags ORDER BY prompt_id, tag_id").all() as Array<{ prompt_id: string; tag_id: string }>).map((relationship) => {
      const tag = db.prepare("SELECT label FROM tags WHERE id = ?").get(relationship.tag_id) as { label: string } | undefined;
      if (!tag) throw new Error("Prompt-tag relationship references a missing tag.");
      return { promptId: relationship.prompt_id, tagLabel: tag.label };
    });
    const canonical = JSON.stringify({ prompts, tagLabels, relationships, counts });
    return { prompts, tagLabels, relationships, counts, digest: createHash("sha256").update(canonical).digest("hex") };
  } finally { db.close(); }
}

function jsonEqual(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function sortedUnique(values: readonly string[]): string[] { return [...new Map(values.map((value) => [value.toLowerCase(), value])).values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "accent" })); }
function requireNoDuplicateTagsOrVersions(snapshot: LogicalDatabaseSnapshot): void {
  if (new Set(snapshot.tagLabels.map((tag) => tag.toLowerCase())).size !== snapshot.tagLabels.length) throw new Error("Committed state contains duplicate tags.");
  const links = snapshot.relationships.map((relationship) => `${relationship.promptId}\u0000${relationship.tagLabel.toLowerCase()}`);
  if (new Set(links).size !== links.length) throw new Error("Committed state contains duplicate prompt-tag relationships.");
  for (const prompt of snapshot.prompts) {
    if (new Set(prompt.tags.map((tag) => tag.toLowerCase())).size !== prompt.tags.length) throw new Error("Committed state contains duplicate prompt tags.");
    const identities = prompt.versions.map((version) => `${version.semanticVersion}\u0000${version.bodySha256}`);
    if (new Set(identities).size !== identities.length) throw new Error("Committed state contains duplicate version identities.");
  }
}
function sourcePrompt(document: RecoveryDocument | undefined, slug: string) {
  const source = document?.prompts.find((prompt) => prompt.slug === slug);
  if (!source) throw new Error(`The required ${slug} production fixture was not supplied for transition verification.`);
  return source;
}
function requireExistingUnchanged(before: LogicalDatabaseSnapshot, after: LogicalDatabaseSnapshot, exceptPromptId?: string): void {
  const afterById = new Map(after.prompts.map((prompt) => [prompt.id, prompt]));
  for (const prompt of before.prompts) {
    if (prompt.id !== exceptPromptId && !jsonEqual(prompt, afterById.get(prompt.id))) throw new Error(`Existing prompt ${prompt.slug} changed unexpectedly.`);
  }
}
function requireImportedPrompt(actual: LogicalPromptSnapshot, source: RecoveryDocument["prompts"][number]): void {
  if (source.sourceId && actual.id === source.sourceId) throw new Error("Imported prompt reused the backup source ID.");
  if (actual.slug !== source.slug || actual.title !== source.title || actual.description !== source.description || actual.category !== source.category || actual.favorite !== source.isFavorite || actual.rating !== source.rating || actual.createdAt !== source.createdAt || actual.updatedAt !== source.updatedAt || !jsonEqual(actual.tags, source.tags) || actual.versions.length !== source.versions.length) throw new Error("Imported prompt metadata or tag state does not match the production fixture.");
  for (let index = 0; index < source.versions.length; index += 1) {
    const expected = source.versions[index]!; const received = actual.versions[index]!;
    if ((expected.sourceId && received.id === expected.sourceId) || received.semanticVersion !== expected.semanticVersion || received.bodySha256 !== createHash("sha256").update(expected.body).digest("hex") || received.changelog !== expected.changelog || received.createdAt !== expected.createdAt || received.updatedAt !== expected.updatedAt) throw new Error("Imported prompt version state does not match the production fixture.");
  }
}
function requireExpectedLinks(before: LogicalDatabaseSnapshot, after: LogicalDatabaseSnapshot, prompt: LogicalPromptSnapshot, tags: readonly string[]): void {
  const expectedTags = sortedUnique([...before.tagLabels, ...tags]);
  const expectedLinks = [...before.relationships, ...tags.map((tagLabel) => ({ promptId: prompt.id, tagLabel }))].sort((left, right) => `${left.promptId}\u0000${left.tagLabel}`.localeCompare(`${right.promptId}\u0000${right.tagLabel}`));
  const receivedLinks = [...after.relationships].sort((left, right) => `${left.promptId}\u0000${left.tagLabel}`.localeCompare(`${right.promptId}\u0000${right.tagLabel}`));
  if (!jsonEqual(after.tagLabels, expectedTags) || !jsonEqual(receivedLinks, expectedLinks)) throw new Error("Committed tag labels or prompt-tag relationships do not match the expected transition.");
}
function result(policy: SnapshotTransitionPolicy, before: LogicalDatabaseSnapshot, after: LogicalDatabaseSnapshot): SnapshotTransitionResult { return { policy, beforeCounts: before.counts, afterCounts: after.counts, beforeDigest: before.digest, afterDigest: after.digest }; }

export function requireSnapshotTransition(before: LogicalDatabaseSnapshot, after: LogicalDatabaseSnapshot, policy: SnapshotTransitionPolicy, document?: RecoveryDocument): SnapshotTransitionResult {
  if (policy === "cancel" || policy === "version-revert-restart") { if (before.digest === after.digest) return result(policy, before, after); throw new Error(`${policy} changed the logical database snapshot.`); }
  const original = before.prompts.find((prompt) => prompt.slug === "synthetic-recovery");
  const current = after.prompts.find((prompt) => prompt.slug === "synthetic-recovery");
  if (!original || !current) throw new Error(`Policy ${policy} lost the original synthetic-recovery prompt.`);
  requireNoDuplicateTagsOrVersions(after);
  if (policy === "stale-plan") {
    const mutations = after.prompts.filter((prompt) => prompt.slug === "stale-target-mutation");
    if (!jsonEqual(original, current) || mutations.length !== 1 || after.counts.prompts !== before.counts.prompts + 1 || after.counts.versions !== before.counts.versions + 1 || after.counts.tags !== before.counts.tags + 1 || after.counts.relationships !== before.counts.relationships + 2) throw new Error("Stale-plan result includes more than the deliberate ordinary product mutation.");
    requireExistingUnchanged(before, after); requireExpectedLinks(before, after, mutations[0]!, ["acceptance", "stale-plan"]); return result(policy, before, after);
  }
  if (policy === "skip-existing") {
    const source = sourcePrompt(document, "synthetic-new");
    const inserted = after.prompts.filter((prompt) => prompt.slug === "synthetic-new");
    if (!jsonEqual(original, current) || inserted.length !== 1 || after.counts.prompts !== before.counts.prompts + 1 || after.counts.versions !== before.counts.versions + source.versions.length || after.counts.tags !== before.counts.tags || after.counts.relationships !== before.counts.relationships + source.tags.length) throw new Error("Skip-existing committed state does not match the expected transition.");
    requireExistingUnchanged(before, after); requireImportedPrompt(inserted[0]!, source); requireExpectedLinks(before, after, inserted[0]!, source.tags); return result(policy, before, after);
  }
  if (policy === "add-missing-versions") {
    const source = sourcePrompt(document, "synthetic-recovery");
    const previousVersions = original.versions;
    const missing = source.versions.filter((version) => !previousVersions.some((currentVersion) => currentVersion.semanticVersion === version.semanticVersion && currentVersion.bodySha256 === createHash("sha256").update(version.body).digest("hex")));
    const actualAdded = current.versions.filter((version) => !previousVersions.some((currentVersion) => currentVersion.id === version.id));
    const metadataBefore = { ...original, updatedAt: null, versions: previousVersions };
    const metadataAfter = { ...current, updatedAt: null, versions: current.versions.filter((version) => previousVersions.some((currentVersion) => currentVersion.id === version.id)) };
    if (!jsonEqual(metadataBefore, metadataAfter) || !jsonEqual(actualAdded.map((version) => ({ semanticVersion: version.semanticVersion, bodySha256: version.bodySha256, changelog: version.changelog, createdAt: version.createdAt, updatedAt: version.updatedAt })), missing.map((version) => ({ semanticVersion: version.semanticVersion, bodySha256: createHash("sha256").update(version.body).digest("hex"), changelog: version.changelog, createdAt: version.createdAt, updatedAt: version.updatedAt }))) || actualAdded.some((version, index) => Boolean(missing[index]?.sourceId) && version.id === missing[index]!.sourceId) || after.counts.prompts !== before.counts.prompts || after.counts.versions !== before.counts.versions + missing.length || after.counts.tags !== before.counts.tags || after.counts.relationships !== before.counts.relationships) throw new Error("Add-missing-versions committed state does not match the expected transition.");
    requireExistingUnchanged(before, after, original.id); return result(policy, before, after);
  }
  if (policy === "version-revert") {
    const originalVersion = original.versions.find((version) => version.semanticVersion === "1.0.0");
    const added = current.versions.filter((version) => !original.versions.some((previous) => previous.id === version.id));
    const preserved = current.versions.filter((version) => original.versions.some((previous) => previous.id === version.id));
    const metadataBefore = { ...original, updatedAt: null, versions: original.versions };
    const metadataAfter = { ...current, updatedAt: null, versions: preserved };
    if (!originalVersion || !jsonEqual(metadataBefore, metadataAfter) || added.length !== 1 || added[0]!.semanticVersion !== "1.2.1" || added[0]!.bodySha256 !== originalVersion.bodySha256 || added[0]!.changelog !== "Revert to v1.0.0" || after.counts.prompts !== before.counts.prompts || after.counts.versions !== before.counts.versions + 1 || after.counts.tags !== before.counts.tags || after.counts.relationships !== before.counts.relationships) throw new Error("Revert did not append the expected historical version.");
    requireExistingUnchanged(before, after, original.id); return result(policy, before, after);
  }
  const source = sourcePrompt(document, "synthetic-recovery");
  const copies = after.prompts.filter((prompt) => prompt.slug !== "synthetic-recovery" && prompt.title.includes("Synthetic recovery copy source"));
  if (!jsonEqual(original, current) || copies.length !== 1 || copies[0]!.id === original.id || copies[0]!.slug !== "synthetic-recovery-imported" || copies[0]!.title !== "Synthetic recovery copy source (imported copy)" || after.counts.prompts !== before.counts.prompts + 1 || after.counts.versions !== before.counts.versions + source.versions.length || after.counts.tags !== before.counts.tags || after.counts.relationships !== before.counts.relationships + source.tags.length) throw new Error("Import-as-copy committed state does not match the expected transition.");
  requireExistingUnchanged(before, after); requireImportedPrompt(copies[0]!, { ...source, slug: "synthetic-recovery-imported", title: "Synthetic recovery copy source (imported copy)" }); requireExpectedLinks(before, after, copies[0]!, source.tags); return result(policy, before, after);
}

/**
 * A constrained, repository-owned acceptance mutation. It uses the production
 * service API (rather than SQL) and only accepts the disposable target asserted
 * by the Windows runner. The stable identifiers make the subsequent stale-plan
 * snapshot transition deterministic without recording any prompt body.
 */
export async function mutateDisposableTargetWithProductionService(path: string): Promise<{ readonly id: string; readonly slug: string }> {
  const database = new Database(path);
  try {
    const service = new PromptVaultService(database, { logger: new StructuredLogger({ level: "error" }) });
    const id = "e3c2f3a4-1693-4d28-9b39-02f3f9e1fa92";
    await service.createPrompt({ id, slug: "stale-target-mutation", title: "Stale target mutation", description: "Synthetic ordinary product mutation.", body: "Synthetic stale-plan mutation body.", semanticVersion: "1.0.0", tags: ["acceptance", "stale-plan"], changelog: "Ordinary product mutation." });
    return { id, slug: "stale-target-mutation" };
  } finally { database.close(); await resetCoreDb(); }
}

/** Verifies an exported 2.0 document against the content-safe database snapshot. */
export function verifyBackupAgainstSnapshot(content: string, snapshot: LogicalDatabaseSnapshot): void {
  const parsed = parseBackupText(content);
  if (!parsed.valid || parsed.version !== "2.0" || !parsed.document) throw new Error("Backup is not a verified format 2.0 document.");
  const document: RecoveryDocument = parsed.document;
  if (parsed.promptCount !== snapshot.counts.prompts || parsed.versionCount !== snapshot.counts.versions) throw new Error("Backup counts do not match the pre-export database snapshot.");
  const raw = JSON.parse(content) as Record<string, unknown>;
  const allowedTopLevel = ["format", "version", "exportedAt", "summary", "prompts"];
  if (!jsonEqual(Object.keys(raw).sort(), allowedTopLevel.sort())) throw new Error("Backup contains unrelated top-level metadata.");
  const rawSummary = raw.summary as Record<string, unknown>;
  const rawPrompts = raw.prompts as Array<Record<string, unknown>>;
  if (!rawSummary || !jsonEqual(Object.keys(rawSummary).sort(), ["promptCount", "versionCount"]) || !Array.isArray(rawPrompts)) throw new Error("Backup summary or prompt collection is not canonical.");
  const expectedPromptIds = snapshot.prompts.map((prompt) => prompt.id);
  if (!jsonEqual(rawPrompts.map((prompt) => prompt.sourceId), expectedPromptIds)) throw new Error("Backup raw prompt order is not deterministic.");
  for (let index = 0; index < rawPrompts.length; index += 1) {
    const rawPrompt = rawPrompts[index]!; const expected = snapshot.prompts[index]!;
    const allowedPrompt = ["sourceId", "slug", "title", "description", "category", "isFavorite", "rating", "tags", "createdAt", "updatedAt", "versions"];
    const rawVersions = rawPrompt.versions as Array<Record<string, unknown>>;
    if (!jsonEqual(Object.keys(rawPrompt).sort(), allowedPrompt.sort()) || !Array.isArray(rawPrompt.tags) || !Array.isArray(rawVersions) || !jsonEqual(rawPrompt.tags, expected.tags)) throw new Error("Backup raw prompt metadata or tag ordering is not canonical.");
    const rawIdentities = rawVersions.map((version) => {
      const allowedVersion = ["sourceId", "semanticVersion", "body", "changelog", "createdAt", "updatedAt"];
      if (!jsonEqual(Object.keys(version).sort(), allowedVersion.sort()) || typeof version.semanticVersion !== "string" || typeof version.body !== "string") throw new Error("Backup raw version metadata is not canonical.");
      return `${version.semanticVersion}:${createHash("sha256").update(version.body).digest("hex")}`;
    });
    const expectedIdentities = expected.versions.map((version) => `${version.semanticVersion}:${version.bodySha256}`);
    if (!jsonEqual(rawIdentities, expectedIdentities)) throw new Error("Backup raw version order is not deterministic.");
  }
  if (document.prompts.length !== snapshot.prompts.length || !jsonEqual(document.prompts.map((prompt) => prompt.sourceId), snapshot.prompts.map((prompt) => prompt.id))) throw new Error("Backup prompt identities or deterministic prompt order do not exactly match the database snapshot.");
  for (let index = 0; index < document.prompts.length; index += 1) {
    const prompt = document.prompts[index]!;
    const expected = snapshot.prompts[index]!;
    if (!prompt.sourceId || prompt.sourceId !== expected.id) throw new Error("Backup prompt identity is absent from the database snapshot.");
    const identities = prompt.versions.map((version) => `${version.semanticVersion}:${createHash("sha256").update(version.body).digest("hex")}`);
    const expectedIdentities = expected.versions.map((version) => `${version.semanticVersion}:${version.bodySha256}`);
    if (prompt.slug !== expected.slug || prompt.title !== expected.title || prompt.description !== expected.description || prompt.category !== expected.category || prompt.isFavorite !== expected.favorite || prompt.rating !== expected.rating || prompt.createdAt !== expected.createdAt || prompt.updatedAt !== expected.updatedAt || JSON.stringify(identities) !== JSON.stringify(expectedIdentities) || JSON.stringify(prompt.tags) !== JSON.stringify(expected.tags)) throw new Error("Backup metadata, ordering, tags, or version identities do not match the database snapshot.");
  }
  if (/(?:[A-Za-z]:\\|api[_-]?key|token|telemetry|machine|userprofile)/i.test(content)) throw new Error("Backup contains prohibited local or secret metadata.");
}
