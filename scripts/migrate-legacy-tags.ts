import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { migrateLegacyTagSidecar } from "../src/lib/legacy-tag-migration.js";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

export function runLegacyTagMigrationCli(args = process.argv.slice(2)): void {
  const sourcePath =
    readOption(args, "source") ?? process.env.PROMPT_VAULT_LEGACY_TAG_DB_PATH;
  const targetPath =
    readOption(args, "target") ?? process.env.PROMPT_VAULT_TAG_DB_PATH;
  const dryRun = args.includes("--dry-run");

  if (!sourcePath || !targetPath) {
    throw new Error(
      "Usage: pnpm tags:migrate-legacy -- --source <legacy.core.db> --target <prompt-vault-platform.db> [--dry-run]",
    );
  }

  const result = migrateLegacyTagSidecar({
    sourcePath,
    targetPath,
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const currentPath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === currentPath) {
  try {
    runLegacyTagMigrationCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
