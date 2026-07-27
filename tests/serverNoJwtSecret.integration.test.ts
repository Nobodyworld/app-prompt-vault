import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { resetCoreDb } from "../src/lib/platform-core.js";

type ServerModule = typeof import("../src/server-internal.js");

const managedEnvironmentKeys = [
  "NODE_ENV",
  "PORT",
  "PROMPT_VAULT_DB_PATH",
  "PROMPT_VAULT_TAG_DB_PATH",
  "PROMPT_VAULT_STATIC_DIR",
  "PROMPT_VAULT_ALLOWED_ORIGINS",
  "PROMPT_VAULT_OBSERVABILITY_ALLOWED_ORIGINS",
  "PROMPT_VAULT_METRICS",
  "JWT_SECRET",
  "API_KEY_NO_SECRET",
  "REQUIRE_AUTH",
  "LOCALHOST_ONLY",
  "RATE_LIMIT_ENABLED",
  "LOG_LEVEL",
] as const;

const originalEnvironment = Object.fromEntries(
  managedEnvironmentKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof managedEnvironmentKeys)[number], string | undefined>;

let directory: string;
let baseUrl: string;
let serverModule: ServerModule;

function restoreEnvironment(): void {
  for (const key of managedEnvironmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "pv-http-no-secret-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "0",
    PROMPT_VAULT_DB_PATH: join(directory, "server.db"),
    PROMPT_VAULT_TAG_DB_PATH: ":memory:",
    PROMPT_VAULT_STATIC_DIR: join(directory, "missing-static"),
    PROMPT_VAULT_ALLOWED_ORIGINS: "http://allowed.example",
    PROMPT_VAULT_OBSERVABILITY_ALLOWED_ORIGINS: "http://allowed.example",
    PROMPT_VAULT_METRICS: "false",
    API_KEY_NO_SECRET: "no-secret-api-key",
    REQUIRE_AUTH: "false",
    LOCALHOST_ONLY: "true",
    RATE_LIMIT_ENABLED: "false",
    LOG_LEVEL: "error",
  });
  delete process.env.JWT_SECRET;
  serverModule = await import("../src/server-internal.js");
  if (!serverModule.server.listening) {
    await once(serverModule.server, "listening");
  }
  const address = serverModule.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 20_000);

afterAll(async () => {
  await serverModule?.closeServerForTests();
  await resetCoreDb();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
  restoreEnvironment();
});

describe("full HTTP server lifecycle without JWT signing", () => {
  it("keeps local reads and configured API-key writes available but refuses JWT issuance", async () => {
    const read = await fetch(`${baseUrl}/api/prompts`);
    expect(read.status).toBe(200);

    const token = await fetch(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "no-secret-api-key" }),
    });
    expect(token.status).toBe(503);
    expect(await token.json()).toMatchObject({
      error: { code: "JWT_SIGNING_UNAVAILABLE" },
    });

    const created = await fetch(`${baseUrl}/api/prompts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "no-secret-api-key",
      },
      body: JSON.stringify({
        slug: "api-key-only",
        title: "API Key Only",
        body: "JWT signing is unavailable",
        semanticVersion: "1.0.0",
      }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      data: { prompt: { slug: "api-key-only" } },
    });
  });
});
