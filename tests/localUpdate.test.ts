import {
  LOCAL_UPDATE_MANIFEST_VERSION,
  PROMPT_VAULT_IDENTIFIER,
  classifyLocalUpdateOutcome,
  compareMsiProductVersions,
  evaluateRecoverySource,
  normalizeConfinedRelativePath,
  normalizeMsiGuid,
  parseMsiProductVersion,
  planLocalUpdate,
  validateLocalUpdateManifest,
  type InstalledUpdateIdentity,
  type LocalUpdateManifest,
  type VerifiedFileEvidence,
} from "../src/domain/localUpdate.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const PRODUCT_CODE = "{11111111-1111-1111-1111-111111111111}";
const UPGRADE_CODE = "{22222222-2222-2222-2222-222222222222}";
const PACKAGE_CODE = "{33333333-3333-3333-3333-333333333333}";

function manifest(overrides: Partial<LocalUpdateManifest> = {}): LocalUpdateManifest {
  return {
    manifestVersion: LOCAL_UPDATE_MANIFEST_VERSION,
    application: {
      identifier: PROMPT_VAULT_IDENTIFIER,
      version: "0.5.0",
      sourceCommit: "c".repeat(40),
    },
    artifact: {
      format: "msi",
      relativePath: "src-tauri/target/release/bundle/msi/Prompt Vault_0.5.0_x64_en-US.msi",
      byteLength: 123456,
      sha256: SHA_A,
    },
    msi: {
      productCode: PRODUCT_CODE,
      upgradeCode: UPGRADE_CODE,
      packageCode: PACKAGE_CODE,
      installScope: "per-user",
    },
    executable: {
      relativePath: "Program Files/Prompt Vault/prompt-vault-app.exe",
      fileVersion: "0.5.0.0",
      productVersion: "0.5.0.0",
      sha256: SHA_A,
    },
    ...overrides,
  };
}

function installed(overrides: Partial<InstalledUpdateIdentity> = {}): InstalledUpdateIdentity {
  return {
    applicationIdentifier: PROMPT_VAULT_IDENTIFIER,
    version: "0.4.0",
    executableSha256: SHA_B,
    productCode: "{44444444-4444-4444-4444-444444444444}",
    upgradeCode: UPGRADE_CODE,
    packageCode: "{55555555-5555-5555-5555-555555555555}",
    installScope: "per-user",
    ...overrides,
  };
}

function verifiedFile(overrides: Partial<VerifiedFileEvidence> = {}): VerifiedFileEvidence {
  return {
    relativePath: "recovery/original.msi",
    expectedByteLength: 100,
    actualByteLength: 100,
    expectedSha256: SHA_A,
    actualSha256: SHA_A,
    exists: true,
    ...overrides,
  };
}

describe("local update manifest contract", () => {
  it("accepts a bounded canonical manifest and normalizes GUIDs and paths", () => {
    const candidate = manifest({
      artifact: {
        format: "msi",
        relativePath: "src-tauri\\target\\release\\bundle\\msi\\Prompt Vault.msi",
        byteLength: 123456,
        sha256: SHA_A.toUpperCase(),
      },
      msi: {
        productCode: PRODUCT_CODE.toLowerCase(),
        upgradeCode: UPGRADE_CODE.toLowerCase(),
        packageCode: PACKAGE_CODE.toLowerCase(),
        installScope: "per-user",
      },
    });
    const result = validateLocalUpdateManifest(candidate);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.manifest?.artifact.relativePath).toBe(
      "src-tauri/target/release/bundle/msi/Prompt Vault.msi",
    );
    expect(result.manifest?.artifact.sha256).toBe(SHA_A);
    expect(result.manifest?.msi.productCode).toBe(PRODUCT_CODE);
  });

  it.each([
    "../outside.msi",
    "bundle/../outside.msi",
    "C:\\temp\\candidate.msi",
    "\\\\server\\share\\candidate.msi",
    "/absolute/candidate.msi",
    "bundle//candidate.msi",
    "bundle/candidate.msi:stream",
    "bundle/candidate.msi.",
    "bundle/candidate.msi ",
    " bundle/candidate.msi",
  ])("rejects escaping or ambiguous artifact path %s", (relativePath) => {
    const candidate = manifest({ artifact: { ...manifest().artifact, relativePath } });
    const result = validateLocalUpdateManifest(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("artifact.relativePath must be a confined relative path.");
  });

  it("rejects malformed identity, digests, source commit, and unsupported scope", () => {
    const candidate = {
      ...manifest(),
      application: { identifier: "foreign.app", version: "0.5.0.1", sourceCommit: "abc" },
      artifact: { ...manifest().artifact, sha256: "not-a-hash" },
      msi: {
        productCode: "not-a-guid",
        upgradeCode: UPGRADE_CODE,
        packageCode: PACKAGE_CODE,
        installScope: "system",
      },
      executable: { ...manifest().executable, sha256: "bad" },
    };
    const result = validateLocalUpdateManifest(candidate);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        `application.identifier must equal ${PROMPT_VAULT_IDENTIFIER}.`,
        "application.version must be a valid three-field Windows Installer ProductVersion.",
        "application.sourceCommit must be a full lowercase 40-character Git SHA.",
        "artifact.sha256 must be a SHA-256 hex digest.",
        "msi.productCode must be a GUID.",
        "msi.installScope must be per-user or per-machine.",
        "executable.sha256 must be a SHA-256 hex digest.",
      ]),
    );
  });

  it("rejects mismatched GUID braces while accepting bare canonical GUIDs", () => {
    expect(normalizeMsiGuid("11111111-1111-1111-1111-111111111111")).toBe(PRODUCT_CODE);
    expect(normalizeMsiGuid("{11111111-1111-1111-1111-111111111111")).toBeNull();
    expect(normalizeMsiGuid("11111111-1111-1111-1111-111111111111}")).toBeNull();
  });
});

describe("Windows Installer ProductVersion ordering", () => {
  it.each(["0.0.0", "255.255.65535", "1.2.3"])('accepts valid version "%s"', (version) => {
    expect(parseMsiProductVersion(version)).not.toBeNull();
  });

  it.each([
    "1.2",
    "1.2.3.4",
    "256.0.0",
    "1.256.0",
    "1.2.65536",
    "01.2.3",
    "1.2.-1",
    " 1.2.3",
    "1.2.3 ",
  ])('rejects invalid or unsupported version "%s"', (version) => {
    expect(parseMsiProductVersion(version)).toBeNull();
  });

  it("compares only the supported three MSI fields", () => {
    expect(compareMsiProductVersions("0.4.0", "0.5.0")).toBe(-1);
    expect(compareMsiProductVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareMsiProductVersions("2.0.0", "1.255.65535")).toBe(1);
  });
});

describe("installed update planning", () => {
  it("refuses when no installed target is present", () => {
    expect(planLocalUpdate(manifest(), null).decision).toBe("refuse-not-installed");
  });

  it("refuses a foreign target or scope mismatch", () => {
    expect(
      planLocalUpdate(manifest(), installed({ applicationIdentifier: "foreign.app" })).decision,
    ).toBe("refuse-foreign-target");
    expect(planLocalUpdate(manifest(), installed({ installScope: "per-machine" })).decision).toBe(
      "refuse-scope-mismatch",
    );
  });

  it("refuses downgrade and same-version replacement with different payload", () => {
    expect(planLocalUpdate(manifest(), installed({ version: "0.6.0" })).decision).toBe(
      "refuse-downgrade",
    );
    expect(planLocalUpdate(manifest(), installed({ version: "0.5.0" })).decision).toBe(
      "refuse-same-version-different-payload",
    );
  });

  it("returns no-op only when same-version package and executable identity match", () => {
    const candidate = manifest();
    const matching = installed({
      version: "0.5.0",
      executableSha256: candidate.executable.sha256,
      productCode: candidate.msi.productCode,
      upgradeCode: candidate.msi.upgradeCode,
      packageCode: candidate.msi.packageCode,
    });
    expect(planLocalUpdate(candidate, matching)).toMatchObject({
      decision: "no-op",
      mutatesInstallation: false,
    });
    expect(
      planLocalUpdate(candidate, {
        ...matching,
        upgradeCode: "{99999999-9999-9999-9999-999999999999}",
      }).decision,
    ).toBe("refuse-same-version-different-payload");
  });

  it("allows only a higher version with matching UpgradeCode", () => {
    expect(planLocalUpdate(manifest(), installed()).decision).toBe("upgrade");
    expect(
      planLocalUpdate(
        manifest(),
        installed({ upgradeCode: "{99999999-9999-9999-9999-999999999999}" }),
      ).decision,
    ).toBe("refuse-upgrade-identity-mismatch");
  });
});

describe("recovery source precondition", () => {
  it("accepts complete verified original media", () => {
    expect(
      evaluateRecoverySource({
        originalMsi: verifiedFile(),
        requiresExternalCabinets: true,
        cabinets: [verifiedFile({ relativePath: "recovery/media1.cab" })],
      }),
    ).toEqual({ ready: true, errors: [] });
  });

  it("fails closed for missing cabinets, changed bytes, hashes, or escaping paths", () => {
    const missingCabinet = evaluateRecoverySource({
      originalMsi: verifiedFile(),
      requiresExternalCabinets: true,
      cabinets: [],
    });
    expect(missingCabinet.ready).toBe(false);
    expect(missingCabinet.errors).toContain("required external cabinet evidence is missing.");

    const changedMedia = evaluateRecoverySource({
      originalMsi: verifiedFile({
        relativePath: "../original.msi",
        actualByteLength: 101,
        actualSha256: SHA_B,
      }),
      requiresExternalCabinets: false,
      cabinets: [],
    });
    expect(changedMedia.ready).toBe(false);
    expect(changedMedia.errors).toEqual(
      expect.arrayContaining([
        "original MSI path is not confined.",
        "original MSI byte length does not match.",
        "original MSI SHA-256 does not match.",
      ]),
    );
  });
});

describe("failure classification", () => {
  it("requires rollback verification after a failed MSI transaction", () => {
    expect(classifyLocalUpdateOutcome({ installerLaunched: true, installerExitCode: 1603 })).toEqual({
      kind: "transaction-failed",
      installerCommitted: false,
      transactionRollbackProven: false,
      followUp: "verify-transaction-rollback",
    });
    expect(
      classifyLocalUpdateOutcome({
        installerLaunched: true,
        installerExitCode: 1603,
        transactionRollbackProven: true,
      }),
    ).toMatchObject({ transactionRollbackProven: true, followUp: "none" });
  });

  it("does not report success before explicit committed-install verification", () => {
    expect(classifyLocalUpdateOutcome({ installerLaunched: true, installerExitCode: 0 })).toEqual({
      kind: "committed-verification-pending",
      installerCommitted: true,
      transactionRollbackProven: false,
      followUp: "verify-committed-install",
    });
  });

  it("classifies post-commit verification and restart failures as recovery-required", () => {
    expect(
      classifyLocalUpdateOutcome({
        installerLaunched: true,
        installerExitCode: 0,
        postInstallVerificationPassed: false,
      }),
    ).toMatchObject({ kind: "committed-verification-failed", followUp: "recovery-required" });
    expect(
      classifyLocalUpdateOutcome({
        installerLaunched: true,
        installerExitCode: 0,
        postInstallVerificationPassed: true,
        restartAttempted: true,
        restartPassed: false,
      }),
    ).toMatchObject({ kind: "committed-restart-failed", followUp: "recovery-required" });
  });

  it("requires explicit restart evidence after a verified ordinary commit", () => {
    expect(
      classifyLocalUpdateOutcome({
        installerLaunched: true,
        installerExitCode: 0,
        postInstallVerificationPassed: true,
      }),
    ).toMatchObject({ kind: "committed-restart-pending", followUp: "restart-required" });
    expect(
      classifyLocalUpdateOutcome({
        installerLaunched: true,
        installerExitCode: 0,
        postInstallVerificationPassed: true,
        restartAttempted: true,
      }),
    ).toMatchObject({ kind: "committed-restart-pending", followUp: "restart-required" });
  });

  it("distinguishes verified success, reboot-required success, and no launch", () => {
    expect(
      classifyLocalUpdateOutcome({
        installerLaunched: true,
        installerExitCode: 0,
        postInstallVerificationPassed: true,
        restartAttempted: true,
        restartPassed: true,
      }).kind,
    ).toBe("success");
    expect(
      classifyLocalUpdateOutcome({
        installerLaunched: true,
        installerExitCode: 3010,
        postInstallVerificationPassed: true,
      }),
    ).toMatchObject({ kind: "success-reboot-required", followUp: "restart-required" });
    expect(classifyLocalUpdateOutcome({ installerLaunched: false, installerExitCode: null })).toEqual({
      kind: "not-started",
      installerCommitted: false,
      transactionRollbackProven: false,
      followUp: "none",
    });
  });
});

describe("confined path helper", () => {
  it("normalizes Windows separators without inventing filesystem access", () => {
    expect(normalizeConfinedRelativePath("bundle\\candidate.msi")).toBe("bundle/candidate.msi");
  });
});
