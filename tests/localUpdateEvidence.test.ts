import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
    schemaVersion: 1, selected: msi(manifest), recovery: msi(prior), recoverySource: "independent-media", procedure: { byteLength: 100, sha256: sha("e") },
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
  it("refuses the registered LocalPackage even with complete matching recovery payloads", () => {
    const f = fixture(); f.observation.recoverySource = "installer-cache";
    const report = run(f);
    expect(report.recovery.media?.media).toEqual([{ embedded: true, sha256: sha("f"), byteLength: 500, memberCount: 1 }]);
    expect(report.recovery.media?.executable?.sha256).toBe(f.prior.executable.sha256);
    expect(report.recovery.procedureVerified).toBe(true);
    expect(report.blockers).toEqual(["recovery:cached-msi-is-insufficient"]);
    expect(report.recovery.ready).toBe(false);
  });
  it("allows independently retained media with the same digest and package identity as LocalPackage", () => {
    const f = fixture(); const cached = f.observation.registrations[0].cachedMsi!;
    expect(f.observation.recoverySource).toBe("independent-media");
    expect(f.observation.recovery!.digest).toEqual(cached.digest);
    expect(f.observation.recovery!.packageCode).toBe(cached.packageCode);
    expect(f.observation.recovery!.properties).toEqual(cached.properties);
    const report = run(f);
    expect(report.blockers).toEqual([]);
    expect(report.recovery.ready).toBe(true);
  });
  it("reports incomplete independent cabinets without inferring cache provenance from equal digests", () => {
    const f = fixture(); f.observation.recovery!.media[0].members = [];
    const report = run(f);
    expect(report.blockers).toContain("recovery:incomplete-cabinet");
    expect(report.blockers).toContain("recovery:executable-payload-unproven");
    expect(report.blockers).not.toContain("recovery:cached-msi-is-insufficient");
    expect(report.recovery.ready).toBe(false);
  });
  it.each([undefined, null, false, "unknown"])("requires valid recovery provenance: %s", (recoverySource) => {
    const f = fixture();
    const report = planObservedLocalUpdate(f.manifest, { ...f.observation, recoverySource }, f.prior);
    expect(report.blockers).toContain("evidence:malformed-observations");
    expect(report.recovery.ready).toBe(false);
  });
  it.each(["unverified", "not-supplied"] as const)("refuses complete recovery with %s provenance", (source) => {
    const f = fixture(); f.observation.recoverySource = source;
    const report = run(f);
    expect(report.blockers).toEqual(["recovery:source-provenance-unverified"]);
    expect(report.recovery.ready).toBe(false);
  });
  it("keeps the cache refusal when recovery inspection or its manifest is unavailable", () => {
    const f = fixture(); f.observation.recoverySource = "installer-cache"; f.observation.recovery = null;
    const report = planObservedLocalUpdate(f.manifest, f.observation);
    expect(report.blockers).toContain("recovery:cached-msi-is-insufficient");
    expect(report.blockers).toContain("recovery:complete-original-media-required");
    expect(report.recovery.ready).toBe(false);
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
  it.each(["installer-cache", "independent-media"] as const)("never exposes recovery or LocalPackage paths for %s", (source) => {
    const f = fixture(); f.observation.recoverySource = source;
    const localPackage = f.observation.registrations[0].services[0].localPackage;
    const recoveryPath = source === "installer-cache" ? localPackage : "C:\\Private\\retained\\prior.msi";
    const report = planObservedLocalUpdate(f.manifest, { ...f.observation, recoveryPath }, f.prior);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(JSON.stringify(recoveryPath).slice(1, -1));
    expect(serialized).not.toContain(JSON.stringify(localPackage).slice(1, -1));
    expect(serialized).not.toContain("C:");
  });
});

describe.skipIf(process.platform !== "win32")("Windows recovery path provenance", () => {
  it("compares every registered full path and fails closed on unsupported identities", () => {
    const root = mkdtempSync(join(tmpdir(), "pv73-provenance-"));
    try {
      const cache = join(root, "package.msi"); const retained = join(root, "retained", "package.msi");
      const sibling = join(root, "other.msi");
      mkdirSync(join(root, "retained"));
      for (const file of [cache, retained, sibling]) writeFileSync(file, "identical synthetic MSI bytes");
      symlinkSync(join(root, "retained"), join(root, "link"), "junction");
      const registrations = (...groups: string[][]): { services: { localPackage: string }[] }[] => groups.map((paths) => ({ services: paths.map((localPackage) => ({ localPackage })) }));
      const cases = [
        { name: "exact path", recoveryPath: cache, registrations: registrations([cache]), expected: "installer-cache" },
        { name: "case insensitive", recoveryPath: cache.toUpperCase(), registrations: registrations([cache]), expected: "installer-cache" },
        { name: "normalized path", recoveryPath: root + "\\retained\\..\\package.msi", registrations: registrations([cache]), expected: "installer-cache" },
        { name: "normalized cache path", recoveryPath: cache, registrations: registrations([root + "\\retained\\..\\package.msi"]), expected: "installer-cache" },
        { name: "Windows separators", recoveryPath: cache.replaceAll("\\", "/"), registrations: registrations([cache]), expected: "installer-cache" },
        { name: "all registrations and services", recoveryPath: cache, registrations: registrations([retained], [sibling, cache]), expected: "installer-cache" },
        { name: "known match despite another invalid path", recoveryPath: cache, registrations: registrations(["relative.msi", cache]), expected: "installer-cache" },
        { name: "same name and bytes at independent path", recoveryPath: retained, registrations: registrations([cache]), expected: "independent-media" },
        { name: "same directory and bytes at independent path", recoveryPath: sibling, registrations: registrations([cache]), expected: "independent-media" },
        { name: "relative service path", recoveryPath: retained, registrations: registrations([cache], ["relative.msi"]), expected: "unverified" },
        { name: "missing service file", recoveryPath: retained, registrations: registrations([join(root, "missing.msi")]), expected: "unverified" },
        { name: "empty service path", recoveryPath: retained, registrations: registrations([""]), expected: "unverified" },
        { name: "no registrations", recoveryPath: retained, registrations: [], expected: "unverified" },
        { name: "no services", recoveryPath: retained, registrations: registrations([]), expected: "unverified" },
        { name: "relative recovery", recoveryPath: "package.msi", registrations: registrations([cache]), expected: "unverified" },
        { name: "missing recovery", recoveryPath: join(root, "missing.msi"), registrations: registrations([cache]), expected: "unverified" },
        { name: "stream alias", recoveryPath: cache + ":stream", registrations: registrations([cache]), expected: "unverified" },
        { name: "trimmed alias", recoveryPath: cache + ".", registrations: registrations([cache]), expected: "unverified" },
        { name: "short-name alias", recoveryPath: join(root, "PACKAG~1.MSI"), registrations: registrations([cache]), expected: "unverified" },
        { name: "directory", recoveryPath: root, registrations: registrations([cache]), expected: "unverified" },
        { name: "recovery reparse point", recoveryPath: join(root, "link", "package.msi"), registrations: registrations([cache]), expected: "unverified" },
        { name: "service reparse point", recoveryPath: retained, registrations: registrations([join(root, "link", "package.msi")]), expected: "unverified" },
        { name: "not supplied", recoveryPath: "", registrations: registrations([cache]), expected: "not-supplied" },
      ];
      // Load only these path helpers from the trusted collector source; do
      // not execute collection, query installed registrations or open an MSI.
      const command = `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$inputCases = [Console]::In.ReadToEnd() | ConvertFrom-Json
$tokens = $null; $parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($inputCases.collector, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Collector syntax invalid.' }
$names = @('Assert-PlainPath', 'Resolve-RecoveryIdentityPath', 'Get-RecoverySource')
$functions = @($tree.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $names }, $true))
if ($functions.Count -ne $names.Count) { throw 'Path helpers missing.' }
foreach ($definition in $functions) { . ([scriptblock]::Create($definition.Extent.Text)) }
@(foreach ($case in $inputCases.cases) { Get-RecoverySource $case.recoveryPath $case.registrations }) | ConvertTo-Json -Compress
`;
      const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
        encoding: "utf8", timeout: 15_000, windowsHide: true,
        input: JSON.stringify({ collector: fileURLToPath(new URL("../scripts/windows/collect-update-evidence.ps1", import.meta.url)), cases }),
      });
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const sources: unknown[] = JSON.parse(result.stdout);
      expect(sources).toHaveLength(cases.length);
      cases.forEach((testCase, index) => expect(sources[index], testCase.name).toBe(testCase.expected));
    } finally {
      rmSync(join(root, "link"), { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
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
