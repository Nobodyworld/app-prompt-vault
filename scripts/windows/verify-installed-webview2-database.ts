import Database from "better-sqlite3";

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
  const databaseIndex = process.argv.indexOf("--database");
  const path = databaseIndex >= 0 ? process.argv[databaseIndex + 1] : undefined;
  if (!path) throw new Error("--database is required.");
  process.stdout.write(`${JSON.stringify(verifyInstalledDisposableDatabase(path))}\n`);
}
