import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrapCoreDbAuthFromApiKeys,
  getSecret,
  resetCoreDb,
  storeSecret,
  verifyCoreDbApiKey,
  verifyCoreDbSessionToken,
} from "../src/lib/platform-core.js";

const originalNodeEnv = process.env.NODE_ENV;
const originalInsecureOverride = process.env.NW_SECRETS_ALLOW_INSECURE;

afterEach(async () => {
  await resetCoreDb();
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalInsecureOverride === undefined) {
    delete process.env.NW_SECRETS_ALLOW_INSECURE;
  } else {
    process.env.NW_SECRETS_ALLOW_INSECURE = originalInsecureOverride;
  }
});

beforeEach(async () => {
  await resetCoreDb();
});

describe("app-local authentication compatibility", () => {
  it("seeds and verifies scoped environment API keys", async () => {
    const result = await bootstrapCoreDbAuthFromApiKeys(
      { admin: "admin-secret", readOnly: "reader-secret" },
      {
        ownerUserId: "owner-1",
        ownerDisplayName: "Owner One",
        scopes: ["prompt-vault:read", "prompt-vault:write"],
        idPrefix: "test",
      },
    );

    expect(result.ownerUserId).toBe("owner-1");
    expect(result.apiKeyIds).toHaveLength(2);

    const context = await verifyCoreDbApiKey("admin-secret", {
      scopes: ["prompt-vault:write"],
    });
    expect(context).toMatchObject({
      kind: "api-key",
      userId: "owner-1",
      displayName: "Owner One",
      roles: ["owner"],
    });
    expect(context?.scopes).toEqual([
      "prompt-vault:read",
      "prompt-vault:write",
    ]);
  });

  it("rejects unknown keys and unmet scope requirements", async () => {
    await bootstrapCoreDbAuthFromApiKeys(
      { readOnly: "reader-secret" },
      { scopes: ["prompt-vault:read"] },
    );

    await expect(verifyCoreDbApiKey("unknown")).resolves.toBeNull();
    await expect(
      verifyCoreDbApiKey("reader-secret", {
        scopes: ["prompt-vault:write"],
      }),
    ).resolves.toBeNull();
    await expect(verifyCoreDbApiKey("reader-secreu")).resolves.toBeNull();
    await expect(verifyCoreDbApiKey("reader-secret-longer")).resolves.toBeNull();
    await expect(verifyCoreDbApiKey("réader-secret")).resolves.toBeNull();
  });

  it("supports wildcard scopes without restoring the Core DB dependency", async () => {
    await bootstrapCoreDbAuthFromApiKeys(
      { admin: "admin-secret" },
      { scopes: ["prompt-vault:*"] },
    );

    await expect(
      verifyCoreDbApiKey("admin-secret", {
        scopes: ["prompt-vault:read", "prompt-vault:write"],
      }),
    ).resolves.toMatchObject({ kind: "api-key" });
  });

  it("does not silently accept legacy Core DB session tokens", async () => {
    await expect(
      verifyCoreDbSessionToken("legacy-session", {
        scopes: ["prompt-vault:read"],
      }),
    ).resolves.toBeNull();
  });
});

describe("process-local secret compatibility utility", () => {
  it("stores and retrieves a development-only secret", async () => {
    process.env.NODE_ENV = "test";
    await storeSecret("test:secret", "value");
    await expect(getSecret("test:secret")).resolves.toBe("value");
  });

  it("refuses insecure production storage without an explicit override", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.NW_SECRETS_ALLOW_INSECURE;

    await expect(storeSecret("production:secret", "value")).rejects.toThrow(
      /Secure secret persistence is unavailable in production/i,
    );
  });

  it("allows an explicit emergency diagnostics override", async () => {
    process.env.NODE_ENV = "production";
    process.env.NW_SECRETS_ALLOW_INSECURE = "1";

    await storeSecret("diagnostic:secret", "value");
    await expect(getSecret("diagnostic:secret")).resolves.toBe("value");
  });
});
