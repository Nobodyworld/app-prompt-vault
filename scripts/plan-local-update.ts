import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfinedRelativePath, validateLocalUpdateManifest } from "../src/domain/localUpdate.js";
import { planObservedLocalUpdate } from "../src/domain/localUpdateEvidence.js";

export function plainFile(path: string): string {
  if (path !== path.trim() || path.includes("\0")) throw new Error("input:ambiguous-path");
  const full = resolve(path);
  if (process.platform === "win32" && (!/^[A-Za-z]:\\/.test(full) || full.slice(2).includes(":"))) throw new Error("input:local-file-required");
  let cursor = full;
  while (true) {
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("input:reparse-point-refused");
    if (cursor === parse(cursor).root) break;
    cursor = dirname(cursor);
  }
  if (!lstatSync(full).isFile()) throw new Error("input:file-required");
  return full;
}
export function confinedFile(root: string, relative: string): string {
  const normalized = normalizeConfinedRelativePath(relative);
  if (!normalized || isAbsolute(relative)) throw new Error("input:unconfined-path");
  return plainFile(join(root, normalized));
}
function readManifest(path: string): { value: Record<string, unknown>; msiPath: string; procedurePath: string | null } {
  const full = plainFile(path);
  if (lstatSync(full).size > 1024 * 1024) throw new Error("input:manifest-too-large");
  const value = JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown>;
  const manifest = validateLocalUpdateManifest(value).manifest;
  if (!manifest) throw new Error("input:invalid-manifest");
  const msiPath = confinedFile(dirname(full), manifest.artifact.relativePath);
  if (extname(msiPath).toLowerCase() !== ".msi") throw new Error("input:msi-required");
  const procedure = value.recoveryProcedure as { relativePath?: unknown } | undefined;
  const procedurePath = procedure && typeof procedure.relativePath === "string" ? confinedFile(dirname(full), procedure.relativePath) : null;
  return { value, msiPath, procedurePath };
}
export function parsePlanArguments(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (args[0] === "--") args = args.slice(1);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!["--msi", "--manifest", "--recovery-manifest"].includes(key) || !value || value.startsWith("--") || result.has(key)) throw new Error("input:invalid-arguments");
    result.set(key, value);
  }
  if (Number(result.has("--msi")) + Number(result.has("--manifest")) !== 1) throw new Error("input:select-exactly-one-msi-or-manifest");
  return result;
}
export function main(args: string[]): number {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Read-only: desktop:plan-update --manifest <manifest.json> [--recovery-manifest <prior.json>]\nInspection only: desktop:plan-update --msi <exact.msi>\nExit 0: verified no-op/conditional plan with complete evidence; 2: blocked/refused. No installation, process, or application-data mutation. Local paths are redacted.");
    return 0;
  }
  try {
    const options = parsePlanArguments(args);
    if (process.platform !== "win32") throw new Error("input:windows-required");
    const selected = options.has("--manifest") ? readManifest(options.get("--manifest")!) : null;
    const selectedPath = selected?.msiPath ?? plainFile(options.get("--msi")!);
    if (extname(selectedPath).toLowerCase() !== ".msi") throw new Error("input:msi-required");
    // Missing recovery files remain a blocker but must not suppress selected/installed inspection.
    let recovery: ReturnType<typeof readManifest> | null = null;
    let recoveryInputInvalid = false;
    try { if (options.has("--recovery-manifest")) recovery = readManifest(options.get("--recovery-manifest")!); } catch { recoveryInputInvalid = true; }
    const raw = execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", join(dirname(fileURLToPath(import.meta.url)), "windows", "collect-update-evidence.ps1")], {
      input: JSON.stringify({ selectedPath, recoveryPath: recovery?.msiPath ?? null, procedurePath: recovery?.procedurePath ?? null }),
      encoding: "utf8", windowsHide: true, shell: false, maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
    });
    const report = planObservedLocalUpdate(selected?.value, JSON.parse(raw.replace(/^\uFEFF/, "")), recovery?.value);
    const blockers = recoveryInputInvalid ? [...report.blockers, "recovery:invalid-or-unavailable-input"] : report.blockers;
    console.log(JSON.stringify({ ...report, blockers }, null, 2));
    return blockers.length === 0 && ["no-op", "upgrade"].includes(report.planner.decision) ? 0 : 2;
  } catch (error) {
    const code = error instanceof Error && /^input:[a-z-]+$/.test(error.message) ? error.message : "evidence:read-only-inspection-failed";
    console.log(JSON.stringify({ ...planObservedLocalUpdate(undefined, undefined), blockers: [code] }, null, 2));
    return 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
