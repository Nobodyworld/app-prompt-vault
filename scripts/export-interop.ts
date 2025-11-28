/**
 * Export Prompt Vault content as JSON payloads for sibling apps:
 * - Buttons: floating switchboard with quick phrases
 * - Planner: bucket draft seeded with prompt tasks
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { buildButtonsSwitchboardPayload, buildPlannerBucketDraft } from "../src/lib/interop.js";

interface Args {
  format: "buttons" | "planner" | "both";
  db: string;
  limit: number;
  pretty: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Args = {
    format: "both",
    db: "prompt-vault.db",
    limit: 12,
    pretty: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--format" || arg === "-f") && args[i + 1]) {
      const next = args[++i] as Args["format"];
      parsed.format = next;
    } else if ((arg === "--db" || arg === "-d") && args[i + 1]) {
      parsed.db = args[++i];
    } else if ((arg === "--limit" || arg === "-l") && args[i + 1]) {
      parsed.limit = Number.parseInt(args[++i], 10) || parsed.limit;
    } else if (arg === "--compact") {
      parsed.pretty = false;
    }
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dbPath = resolve(args.db);
  if (!existsSync(dbPath)) {
    console.error(`[export-interop] Database not found at ${dbPath}`);
    process.exit(1);
  }

  const database = new Database(dbPath);
  const service = new PromptVaultService(database);
  const prompts = service.listAllPrompts();

  const outputs: Record<string, unknown> = {};

  if (args.format === "buttons" || args.format === "both") {
    const payload = buildButtonsSwitchboardPayload(prompts, args.limit);
    outputs.buttons = payload ?? { error: "No prompts with bodies to export." };
  }

  if (args.format === "planner" || args.format === "both") {
    const payload = buildPlannerBucketDraft(prompts, args.limit);
    outputs.planner = payload ?? { error: "No prompts available to stage planner tasks." };
  }

  const isSingle = args.format !== "both";
  const data = isSingle ? (outputs[args.format] ?? outputs) : outputs;
  const json = JSON.stringify(data, null, args.pretty ? 2 : 0);
  // eslint-disable-next-line no-console
  console.log(json);
}

main().catch((err) => {
  console.error("[export-interop] Failed:", err);
  process.exit(1);
});
