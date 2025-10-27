#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function toSegments(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

function toPascalCase(name: string): string {
  return toSegments(name)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

const rawName = process.argv[2];

if (!rawName) {
  console.error("Usage: npm run extension:scaffold -- <name>");
  process.exit(1);
}

const pascal = toPascalCase(rawName);
if (pascal.length === 0) {
  console.error(`Could not derive plugin name from "${rawName}".`);
  process.exit(1);
}

const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
const exportName = `create${pascal}Plugin`;
const fileName = `${camel}Plugin.ts`;

const targetDir = resolve("src", "extensions", "plugins");
if (!existsSync(targetDir)) {
  mkdirSync(targetDir, { recursive: true });
}

const targetPath = resolve(targetDir, fileName);
if (existsSync(targetPath)) {
  console.error(`Plugin file ${targetPath} already exists.`);
  process.exit(1);
}

const template = `import type { PromptVaultPlugin } from "../types.js";

export function ${exportName}(): PromptVaultPlugin {
  return {
    name: "${camel}",
    setup({ logger, telemetry }) {
      logger.info("${camel}_plugin_ready");
      telemetry.recordEvent("plugin.${camel}.setup");
    },
    // TODO(P3, 1d): Implement lifecycle hooks.
  };
}
`;

writeFileSync(targetPath, template);

console.log(`Created ${targetPath}.`);
console.log("Remember to export the plugin from src/extensions/index.ts and add documentation if it is user-facing.");
