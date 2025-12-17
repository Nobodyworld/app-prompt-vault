import { createReadStream, createWriteStream } from "node:fs";
import { unlink, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import type Database from "better-sqlite3";

/**
 * Utility for creating and restoring compressed database snapshots.
 */
export class SnapshotManager {
  /**
   * Create a compressed backup of the database.
   * @param database - The SQLite database instance.
   * @param snapshotPath - Path where the compressed snapshot should be saved.
   * @returns Promise that resolves when backup is complete.
   */
  public static async createSnapshot(
    database: Database.Database,
    snapshotPath: string,
  ): Promise<void> {
    // SQLite data dump to temporary file (only INSERT statements, no schema)
    const dumpPath = `${snapshotPath}.tmp`;
    const dumpStream = createWriteStream(dumpPath);

    // Write data for each table as INSERT statements
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];
    for (const { name } of tables) {
      const rows = database.prepare(`SELECT * FROM ${name}`).all();
      if (rows.length > 0) {
        // Write INSERT statements
        const firstRow = rows[0] as Record<string, unknown>;
        const columns = Object.keys(firstRow).join(", ");
        for (const row of rows) {
          const rowData = row as Record<string, unknown>;
          const values = Object.values(rowData)
            .map((value) =>
              value === null
                ? "NULL"
                : typeof value === "string"
                  ? `'${value.replace(/'/g, "''")}'`
                  : typeof value === "boolean"
                    ? value
                      ? "1"
                      : "0"
                    : String(value),
            )
            .join(", ");
          dumpStream.write(
            `INSERT INTO ${name} (${columns}) VALUES (${values});\n`,
          );
        }
      }
    }

    dumpStream.end();
    await new Promise<void>((resolve, reject) => {
      dumpStream.on("finish", () => resolve());
      dumpStream.on("error", reject);
    });

    // Compress the dump
    const gzipStream = createGzip();
    await pipeline(
      createReadStream(dumpPath),
      gzipStream,
      createWriteStream(snapshotPath),
    );

    // Clean up temporary file
    await unlink(dumpPath);
  }

  /**
   * Restore database from a compressed snapshot.
   * @param snapshotPath - Path to the compressed snapshot file.
   * @param database - The SQLite database instance to restore into.
   * @returns Promise that resolves when restore is complete.
   */
  public static async restoreSnapshot(
    snapshotPath: string,
    database: Database.Database,
  ): Promise<void> {
    // Decompress snapshot to temporary file
    const dumpPath = `${snapshotPath}.tmp`;
    await pipeline(
      createReadStream(snapshotPath),
      createGunzip(),
      createWriteStream(dumpPath),
    );

    // Execute the SQL dump
    const sql = readFileSync(dumpPath, "utf8");
    const statements = sql
      .split(";")
      .map((stmt: string) => stmt.trim())
      .filter((stmt: string) => stmt.length > 0);

    // Clear existing data
    database.exec("PRAGMA foreign_keys = OFF");
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];
    for (const { name } of tables) {
      database.exec(`DELETE FROM ${name}`);
    }
    database.exec("PRAGMA foreign_keys = ON");

    // Execute restore statements (should only be INSERT statements)
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          database.exec(statement);
        } catch (error) {
          // Log but continue - some statements might fail if data already exists
          console.warn(
            `Failed to execute statement: ${statement.substring(0, 100)}...`,
            error,
          );
        }
      }
    }

    // Clean up temporary file
    await unlink(dumpPath);
  }

  /**
   * Get information about a snapshot file.
   * @param snapshotPath - Path to the snapshot file.
   * @returns Promise resolving to snapshot metadata.
   */
  public static async getSnapshotInfo(snapshotPath: string): Promise<{
    size: number;
    created: Date;
    compressed: boolean;
  }> {
    const stats = await stat(snapshotPath);
    return {
      size: stats.size,
      created: stats.birthtime,
      compressed:
        snapshotPath.endsWith(".gz") || snapshotPath.endsWith(".gzip"),
    };
  }

  /**
   * Validate that a snapshot file is readable and appears to be a valid database dump.
   * @param snapshotPath - Path to the snapshot file.
   * @returns Promise resolving to true if valid, false otherwise.
   */
  public static async validateSnapshot(snapshotPath: string): Promise<boolean> {
    try {
      const stats = await stat(snapshotPath);
      if (stats.size === 0) return false;

      // Try to decompress and check for SQL content using Node.js zlib
      const fs = await import("node:fs");
      const zlib = await import("node:zlib");

      const fileContent = fs.readFileSync(snapshotPath);
      const decompressed = zlib.gunzipSync(fileContent).toString("utf8");

      // Check if it contains SQL statements
      return (
        decompressed.includes("INSERT INTO") || decompressed.includes("PRAGMA")
      );
    } catch {
      return false;
    }
  }
}
