import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { parseBackupText } from "../../src/domain/recovery.js";
export { mutateDisposableTargetWithProductionService, requireSnapshotTransition, snapshotDisposableDatabase } from "./installed-webview2-evidence.js";

export interface InstalledDatabaseVerification {
  readonly integrity: "ok";
  readonly foreignKeyViolations: number;
  readonly promptCount: number;
  readonly versionCount: number;
  readonly tagCount: number;
  readonly relationshipCount: number;
}

function count(database: Database.Database, table: "prompts" | "prompt_versions" | "tags" | "prompt_tags"): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

/** Opens only a disposable current database supplied by the acceptance harness. */
export function verifyInstalledDisposableDatabase(path: string): InstalledDatabaseVerification {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`Disposable current database integrity_check failed: ${String(integrity)}`);
    const foreignKeyViolations = (database.pragma("foreign_key_check") as unknown[]).length;
    if (foreignKeyViolations !== 0) throw new Error(`Disposable current database has ${foreignKeyViolations} foreign-key violations.`);
    return { integrity: "ok", foreignKeyViolations, promptCount: count(database, "prompts"), versionCount: count(database, "prompt_versions"), tagCount: count(database, "tags"), relationshipCount: count(database, "prompt_tags") };
  } finally {
    database.close();
  }
}

if (process.argv[1]?.endsWith("verify-installed-webview2-database.ts")) {
  const transition = process.argv.indexOf("--transition");
  if (transition >= 0) {
    const before = process.argv[process.argv.indexOf("--before") + 1]; const after = process.argv[process.argv.indexOf("--after") + 1]; const policy = process.argv[transition + 1] as import("./installed-webview2-evidence.js").SnapshotTransitionPolicy;
    const fixtureIndex = process.argv.indexOf("--fixture"); const fixturePath = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined;
    if (!before || !after || !policy) throw new Error("--transition requires --before, --after, and a policy.");
    const fixture = fixturePath ? parseBackupText(readFileSync(fixturePath, "utf8")).document : undefined;
    if (fixturePath && !fixture) throw new Error("--fixture must be a production-valid backup document.");
    const { requireSnapshotTransition } = await import("./installed-webview2-evidence.js");
    const result = requireSnapshotTransition(JSON.parse(readFileSync(before, "utf8")), JSON.parse(readFileSync(after, "utf8")), policy, fixture);
    process.stdout.write(`${JSON.stringify({ verified: true, ...result })}\n`);
    process.exit(0);
  }
  const databaseIndex = process.argv.indexOf("--database");
  const path = databaseIndex >= 0 ? process.argv[databaseIndex + 1] : undefined;
  if (!path) throw new Error("--database is required unless --transition is used.");
  const snapshot = process.argv.includes("--snapshot");
  const { snapshotDisposableDatabase } = await import("./installed-webview2-evidence.js");
  process.stdout.write(`${JSON.stringify(snapshot ? snapshotDisposableDatabase(path) : verifyInstalledDisposableDatabase(path))}\n`);
}
