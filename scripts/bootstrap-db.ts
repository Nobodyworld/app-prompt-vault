import { resolve } from "node:path";
import Database from "better-sqlite3";
import { PromptVaultService } from "../src/services/PromptVaultService.js";

// # agent-safe-task: Bootstraps a SQLite database with current migrations.

const target = process.argv[2] ?? "prompt-vault.db";
const absolute = resolve(process.cwd(), target);

const database = new Database(absolute);
new PromptVaultService(database);
database.close();

console.log(`SQLite database initialised at ${absolute}`);
