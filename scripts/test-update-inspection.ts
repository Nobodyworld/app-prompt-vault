import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { plainFile } from "./plan-local-update.js";
import { planObservedLocalUpdate } from "../src/domain/localUpdateEvidence.js";
import type { UpdateObservation } from "../src/domain/localUpdateEvidence.js";
import type { LocalUpdateManifest } from "../src/domain/localUpdate.js";

// Read-only Windows package acceptance; requires one explicitly selected MSI.
try {
  assert.equal(process.platform, "win32");
  assert.equal(process.argv[2], "--msi");
  assert.equal(process.argv.length, 4);
  const selectedPath = plainFile(process.argv[3]);
  const before = createHash("sha256").update(readFileSync(selectedPath)).digest("hex");
  const raw = execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", join(dirname(fileURLToPath(import.meta.url)), "windows", "collect-update-evidence.ps1")], {
    input: JSON.stringify({ selectedPath, recoveryPath: null, procedurePath: null }), encoding: "utf8", windowsHide: true, shell: false, maxBuffer: 32 * 1024 * 1024,
  });
  const observation = JSON.parse(raw.replace(/^\uFEFF/, "")) as UpdateObservation;
  const inspected = planObservedLocalUpdate(undefined, observation).selected;
  assert.ok(inspected?.executable);
  assert.ok(inspected.productCode && inspected.packageCode && inspected.upgradeCode && inspected.productVersion && inspected.installScope);
  assert.ok(inspected.executable.fileVersion && inspected.executable.productVersion);
  // This is a test receipt bound to the supplied build; it is not recovery or signing authority.
  const manifest: LocalUpdateManifest = {
    manifestVersion: "1", application: { identifier: "com.nobodyworld.promptvault", version: inspected.productVersion, sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() },
    artifact: { format: "msi", relativePath: basename(selectedPath), byteLength: inspected.byteLength, sha256: inspected.sha256 },
    msi: { productCode: inspected.productCode, packageCode: inspected.packageCode, upgradeCode: inspected.upgradeCode, installScope: inspected.installScope },
    executable: { relativePath: "prompt-vault-app.exe", fileVersion: inspected.executable.fileVersion, productVersion: inspected.executable.productVersion, sha256: inspected.executable.sha256 },
  };
  const plan = planObservedLocalUpdate(manifest, observation);
  assert.equal(plan.payloadCorrespondenceProven, true);
  assert.equal(plan.blockers.some((blocker) => blocker.startsWith("selected:")), false);
  assert.equal(plan.installationMutationOccurred, false);
  assert.equal(plan.recovery.ready, false);
  assert.equal(createHash("sha256").update(readFileSync(selectedPath)).digest("hex"), before);
  const tampered = { ...manifest, artifact: { ...manifest.artifact, sha256: "0".repeat(64) } };
  assert.ok(planObservedLocalUpdate(tampered, observation).blockers.includes("selected:artifact-digest-mismatch"));
  const tamperedPayload = { ...manifest, executable: { ...manifest.executable, sha256: "0".repeat(64) } };
  assert.equal(planObservedLocalUpdate(tamperedPayload, observation).payloadCorrespondenceProven, false);
  console.log(JSON.stringify({ nativeInspection: "PASS", artifactUnchanged: true, report: plan }, null, 2));
} catch {
  console.error("Read-only MSI inspection acceptance failed; no installer or application process was launched.");
  process.exitCode = 1;
}
