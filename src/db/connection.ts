import Database from "better-sqlite3";

/**
 * Configuration options for the SQLite connection.
 */
export interface ConnectionOptions {
  /** File path for the SQLite database. Use `:memory:` for ephemeral DB. */
  readonly filePath: string;
  /** Whether to open the database in readonly mode. */
  readonly readonly?: boolean;
  /** Enable verbose logging for SQL statements. */
  readonly verbose?: boolean;
}

/**
 * Factory responsible for producing a configured SQLite connection.
 */
export class ConnectionFactory {
  /**
   * Create a new SQLite Database instance.
   * @param options - Options controlling connection behaviour.
   * @returns Configured Database instance.
   */
  public static create(options: ConnectionOptions): Database.Database {
    const database = new Database(options.filePath, {
      readonly: options.readonly ?? false,
      verbose: options.verbose ? console.debug : undefined,
    });

    database.pragma("foreign_keys = ON");
    const busyTimeout = Number.parseInt(
      process.env.PROMPT_VAULT_BUSY_TIMEOUT ?? "5000",
      10,
    );
    database.pragma(
      `busy_timeout = ${Number.isFinite(busyTimeout) ? busyTimeout : 5000}`,
    );

    if (!(options.readonly ?? false)) {
      database.pragma("journal_mode = WAL");
    }

    return database;
  }
}
