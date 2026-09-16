import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planObservedLocalUpdate, REGISTRATION_ROOTS } from "../src/domain/localUpdateEvidence.js";
import type { UpdateObservation } from "../src/domain/localUpdateEvidence.js";
import type { LocalUpdateManifest } from "../src/domain/localUpdate.js";
import { parsePlanArguments, confinedFile } from "../scripts/plan-local-update.js";

const sha = (digit: string): string => digit.repeat(64);
const guid = (digit: string): string => `{${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}}`;
function fixture(): { manifest: LocalUpdateManifest; prior: LocalUpdateManifest & Record<string, unknown>; observation: UpdateObservation } {
  const manifest: LocalUpdateManifest = {
    manifestVersion: "1", application: { identifier: "com.nobodyworld.promptvault", version: "0.5.0", sourceCommit: "a".repeat(40) },
    artifact: { format: "msi", relativePath: "selected.msi", byteLength: 1000, sha256: sha("a") },
    msi: { productCode: guid("1"), upgradeCode: guid("2"), packageCode: guid("3"), installScope: "per-machine" },
    executable: { relativePath: "prompt-vault-app.exe", fileVersion: "0.5.0.0", productVersion: "0.5.0", sha256: sha("b") },
  };
  const prior = { ...structuredClone(manifest), application: { ...manifest.application, version: "0.4.0" },
    artifact: { ...manifest.artifact, relativePath: "prior.msi", sha256: sha("c") },
    msi: { ...manifest.msi, productCode: guid("4"), packageCode: guid("5") },
    executable: { ...manifest.executable, fileVersion: "0.4.0.0", productVersion: "0.4.0", sha256: sha("d") },
    recoveryProcedure: { relativePath: "procedure.md", byteLength: 100, sha256: sha("e"), kind: "manual-prior-msi", testedSourceCommit: "a".repeat(40) },
  };
  function msi(m: LocalUpdateManifest): NonNullable<UpdateObservation["selected"]> {
    return { digest: { byteLength: m.artifact.byteLength, sha256: m.artifact.sha256 }, properties: {
      ProductName: "Prompt Vault", Manufacturer: "Nobody Production", ProductVersion: m.application.version,
      ProductCode: m.msi.productCode, UpgradeCode: m.msi.upgradeCode, ALLUSERS: "1",
    }, packageCode: m.msi.packageCode, template: "x64;0", wordCount: 2,
    files: [{ key: "Path", component: "Path", name: "short.exe|prompt-vault-app.exe", size: 200, version: m.executable.fileVersion, attributes: 512, sequence: 1 }],
    components: [{ key: "Path", directory: "INSTALLDIR" }], directories: [{ key: "INSTALLDIR", parent: "ProgramFiles64Folder", name: "Prompt Vault" }],
    media: [{ diskId: 1, lastSequence: 1, cabinet: "#cab1.cab", digest: { byteLength: 500, sha256: sha("f") }, error: null,
      members: [{ key: "Path", file: { byteLength: 200, sha256: m.executable.sha256, fileVersion: m.executable.fileVersion, productVersion: m.executable.productVersion } }] }],
    };
  }
  const location = "C:\\Program Files\\Prompt Vault";
  const observation: UpdateObservation = {
    schemaVersion: 1, selected: msi(manifest), recovery: msi(prior), procedure: { byteLength: 100, sha256: sha("e") },
    roots: [...REGISTRATION_ROOTS], relatedProducts: [prior.msi.productCode], errors: [], processes: [],
    registrations: [{ source: REGISTRATION_ROOTS[2], key: prior.msi.productCode, displayName: "Prompt Vault", displayVersion: "0.4.0", publisher: "Nobody Production",
      installLocation: location, displayIcon: location + "\\prompt-vault-app.exe,0", windowsInstaller: "1", errors: [],
      services: [{ context: 4, localPackage: "C:\\Windows\\Installer\\synthetic.msi", version: "0.4.0", packageCode: prior.msi.packageCode, installLocation: location }],
      cachedMsi: msi(prior), executable: { path: location + "\\prompt-vault-app.exe", byteLength: 200, sha256: prior.executable.sha256, fileVersion: "0.4.0.0", productVersion: "0.4.0" } }],
  };
  return { manifest, prior, observation };
}
function run(f = fixture()): ReturnType<typeof planObservedLocalUpdate> { return planObservedLocalUpdate(f.manifest, f.observation, f.prior); }

describe("observed read-only update planning", () => {
  it("plans an eligible higher version with complete prior media and leaves execution conditional", () => {
    const report = run();
    expect(report.blockers).toEqual([]);
    expect(report.planner).toMatchObject({ decision: "upgrade", conditional: true, proposedMutation: true });
    expect(report).toMatchObject({ readOnly: true, installationMutationOccurred: false, processMutationOccurred: false, applicationDataAccessed: false, payloadCorrespondenceProven: true });
    expect(report.recovery.ready).toBe(true);
    expect(report.futureExecutionGates).toContain("attended-synthetic-msi-acceptance");
  });
  it.each([null, [], {}, { schemaVersion: 2 }, { ...fixture().observation, roots: "HKLM" }])("rejects malformed observations without throwing", (raw) => {
    expect(planObservedLocalUpdate(fixture().manifest, raw).blockers).toContain("evidence:malformed-observations");
  });
  it.each([
    ["tampered MSI", (f: ReturnType<typeof fixture>) => { f.observation.selected!.digest.sha256 = sha("0"); }, "selected:artifact-digest-mismatch"],
    ["tampered payload", (f: ReturnType<typeof fixture>) => { f.observation.selected!.media[0].members[0].file.sha256 = sha("0"); }, "selected:executable-payload-unproven"],
    ["duplicate registration", (f: ReturnType<typeof fixture>) => { f.observation.registrations.push(structuredClone(f.observation.registrations[0])); }, "installed:ambiguous-registration"],
    ["foreign registration", (f: ReturnType<typeof fixture>) => { f.observation.registrations[0].publisher = "Other publisher"; }, "installed:foreign-target"],
    ["foreign MSI", (f: ReturnType<typeof fixture>) => { f.observation.selected!.properties.ProductName = "Other product"; }, "selected:foreign-or-unsupported-msi"],
    ["wrong root", (f: ReturnType<typeof fixture>) => { f.observation.roots.pop(); }, "installed:registration-inventory-incomplete"],
    ["wrong scope", (f: ReturnType<typeof fixture>) => { f.observation.registrations[0].source = REGISTRATION_ROOTS[0]; }, "installed:scope-contradiction"],
    ["wrong ProductCode", (f: ReturnType<typeof fixture>) => { f.observation.registrations[0].key = guid("9"); }, "installed:identity-contradiction"],
    ["wrong package", (f: ReturnType<typeof fixture>) => { f.observation.registrations[0].services[0].packageCode = guid("9"); }, "installed:identity-contradiction"],
    ["wrong location", (f: ReturnType<typeof fixture>) => { f.observation.registrations[0].executable!.path = "C:\\Foreign\\prompt-vault-app.exe"; }, "installed:location-contradiction"],
    ["cached MSI absent", (f: ReturnType<typeof fixture>) => { f.observation.registrations[0].cachedMsi = null; }, "installed:incomplete-identity"],
    ["no installation", (f: ReturnType<typeof fixture>) => { f.observation.registrations = []; }, "installed:not-installed"],
    ["missing media", (f: ReturnType<typeof fixture>) => { f.observation.recovery = null; }, "recovery:complete-original-media-required"],
    ["missing procedure", (f: ReturnType<typeof fixture>) => { f.observation.procedure = null; }, "recovery:verified-procedure-required"],
    ["wrong recovery product", (f: ReturnType<typeof fixture>) => { f.prior.msi.productCode = guid("9"); }, "recovery:prior-installation-identity-mismatch"],
    ["cached MSI only", (f: ReturnType<typeof fixture>) => { f.observation.recovery!.media[0].members = []; }, "recovery:cached-msi-is-insufficient"],
    ["process inventory unavailable", (f: ReturnType<typeof fixture>) => { f.observation.errors = ["process-inventory-unreadable"]; }, "installed:process-inventory-incomplete"],
  ])("fails closed for %s", (_name, alter, blocker) => {
    const f = fixture(); alter(f); const report = run(f);
    expect(report.blockers).toContain(blocker);
    expect(report.installationMutationOccurred).toBe(false);
  });
  it("delegates no-op, downgrade, same-version and upgrade identity decisions to the existing contract", () => {
    const f = fixture();
    expect(planObservedLocalUpdate(f.prior, { ...f.observation, selected: f.observation.recovery }, f.prior).planner.decision).toBe("no-op");
    f.manifest.application.version = "0.3.0";
    f.manifest.executable.fileVersion = "0.3.0.0"; f.manifest.executable.productVersion = "0.3.0";
    f.observation.selected!.properties.ProductVersion = "0.3.0"; f.observation.selected!.files[0].version = "0.3.0.0";
    Object.assign(f.observation.selected!.media[0].members[0].file, { fileVersion: "0.3.0.0", productVersion: "0.3.0" });
    expect(run(f).planner.decision).toBe("refuse-downgrade");
    const same = fixture(); same.manifest = structuredClone(same.prior); same.manifest.msi.packageCode = guid("9"); same.observation.selected = structuredClone(same.observation.recovery); same.observation.selected!.packageCode = guid("9");
    expect(run(same).planner.decision).toBe("refuse-same-version-different-payload");
    const different = fixture(); different.manifest.msi.upgradeCode = guid("9"); different.observation.selected!.properties.UpgradeCode = guid("9");
    expect(run(different).planner.decision).toBe("refuse-upgrade-identity-mismatch");
    const scope = fixture(); scope.manifest.msi.installScope = "per-user"; delete scope.observation.selected!.properties.ALLUSERS;
    expect(run(scope).planner.decision).toBe("refuse-scope-mismatch");
  });
  it("never identifies a running application by process name", () => {
    const f = fixture(); const exe = f.observation.registrations[0].executable!;
    f.observation.processes = [{ pid: 123, path: exe.path, file: { ...exe } }];
    expect(run(f).installed.matchingProcessCount).toBe(1);
    f.observation.processes[0].path = "C:\\Foreign\\prompt-vault-app.exe";
    expect(run(f).blockers).toContain("installed:unverified-process");
    f.observation.processes[0] = { pid: 123, path: "", file: null };
    expect(run(f).installed.reconciled).toBe(false);
  });
  it("verifies the exact external cabinet set and its digests", () => {
    const f = fixture(); const medium = f.observation.recovery!.media[0]; medium.cabinet = "media.cab";
    expect(run(f).blockers).toContain("recovery:external-cabinet-unverified");
    f.prior.media = { cabinets: [{ relativePath: "media.cab", ...medium.digest! }] };
    expect(run(f).recovery.ready).toBe(true);
    medium.digest!.sha256 = sha("0");
    expect(run(f).recovery.ready).toBe(false);
  });
  it.each(["missing", "duplicate", "size", "loose", "unmapped", "administrative", "unsupported-layout"])("refuses %s payload evidence", (kind) => {
    const f = fixture(); const msi = f.observation.selected!;
    if (kind === "missing") msi.media[0].members = [];
    if (kind === "duplicate") msi.media[0].members.push(msi.media[0].members[0]);
    if (kind === "size") msi.files[0].size++;
    if (kind === "loose") msi.files[0].attributes = 8192;
    if (kind === "unmapped") msi.files[0].sequence = 2;
    if (kind === "administrative") msi.wordCount |= 4;
    if (kind === "unsupported-layout") msi.components[0].directory = "OTHER";
    expect(run(f).payloadCorrespondenceProven).toBe(false);
  });
  it("redacts paths and collector error details", () => {
    const f = fixture(); f.observation.errors = ["C:\\Private\\operator"];
    expect(JSON.stringify(run(f))).not.toContain("C:");
  });
});

describe("explicit planner inputs", () => {
  it.each([[], ["--msi", "a.msi", "--manifest", "b.json"], ["--msi"], ["--msi", "a.msi", "--msi", "b.msi"], ["--newest", "true"]])("refuses ambiguous arguments %j", (args) => {
    expect(() => parsePlanArguments(args)).toThrow();
  });
  it("accepts one explicit selection plus optional recovery", () => {
    expect(parsePlanArguments(["--", "--manifest", "m.json", "--recovery-manifest", "r.json"]).get("--manifest")).toBe("m.json");
  });
  it("rejects path traversal and symbolic-link escape before collection", () => {
    const root = mkdtempSync(join(tmpdir(), "pv73-test-"));
    try {
      writeFileSync(join(root, "file.msi"), "synthetic");
      expect(confinedFile(root, "file.msi")).toBe(join(root, "file.msi"));
      expect(() => confinedFile(root, "../file.msi")).toThrow();
      symlinkSync(root, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
      expect(() => confinedFile(root, "link/file.msi")).toThrow();
    } finally { rmSync(join(root, "link"), { force: true, recursive: true }); rmSync(root, { recursive: true, force: true }); }
  });
});
