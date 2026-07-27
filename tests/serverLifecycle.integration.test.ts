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
  "JWT_EXPIRES_IN",
  "API_KEY_COVERAGE",
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
  directory = await mkdtemp(join(tmpdir(), "pv-http-server-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    PORT: "0",
    PROMPT_VAULT_DB_PATH: join(directory, "server.db"),
    PROMPT_VAULT_TAG_DB_PATH: ":memory:",
    PROMPT_VAULT_STATIC_DIR: join(directory, "missing-static"),
    PROMPT_VAULT_ALLOWED_ORIGINS: "http://allowed.example",
    PROMPT_VAULT_OBSERVABILITY_ALLOWED_ORIGINS: "http://allowed.example",
    PROMPT_VAULT_METRICS: "false",
    JWT_SECRET: "server-lifecycle-secret-with-sufficient-length",
    JWT_EXPIRES_IN: "10m",
    API_KEY_COVERAGE: "server-lifecycle-api-key",
    REQUIRE_AUTH: "false",
    LOCALHOST_ONLY: "true",
    RATE_LIMIT_ENABLED: "false",
    LOG_LEVEL: "error",
  });
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

describe("full HTTP server lifecycle with configured JWT signing", () => {
  it("starts on loopback, completes readiness, and uses the disposable database", async () => {
    const address = serverModule.server.address() as AddressInfo;
    expect(address.address).toBe("127.0.0.1");
    expect(address.port).toBeGreaterThan(0);
    expect(serverModule.config.port).toBe(0);
    expect(serverModule.config.databasePath).toBe(
      join(directory, "server.db"),
    );
    expect(serverModule.database.open).toBe(true);

    const readiness = await fetch(`${baseUrl}/observability/readyz`);
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toEqual({ status: "ok" });
  });

  it("sets request IDs, security headers, HSTS, and the configured CORS origin", async () => {
    const response = await fetch(`${baseUrl}/api/prompts`, {
      headers: {
        origin: "http://allowed.example",
        "x-forwarded-proto": "https",
        "x-request-id": "request-coverage-1234",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(
      "request-coverage-1234",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("permissions-policy")).toContain(
      "geolocation=()",
    );
    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age=31536000",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://allowed.example",
    );
  });

  it("generates a safe request ID when the incoming value is unsuitable", async () => {
    const response = await fetch(`${baseUrl}/api/prompts`, {
      headers: { "x-request-id": "bad/value" },
    });
    expect(response.status).toBe(200);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("keeps unsafe methods authenticated and supports API-key and JWT flows", async () => {
    const prompt = {
      slug: "server-created",
      title: "Server Created",
      body: "Created through the full server",
      semanticVersion: "1.0.0",
    };
    const unauthenticated = await fetch(`${baseUrl}/api/prompts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prompt),
    });
    expect(unauthenticated.status).toBe(401);

    const created = await fetch(`${baseUrl}/api/prompts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "server-lifecycle-api-key",
      },
      body: JSON.stringify(prompt),
    });
    expect(created.status).toBe(201);
    const createdPayload = await created.json();
    expect(createdPayload.data.prompt).toMatchObject({
      slug: "server-created",
      title: "Server Created",
    });

    const tokenResponse = await fetch(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "server-lifecycle-api-key" }),
    });
    expect(tokenResponse.status).toBe(201);
    const tokenPayload = await tokenResponse.json();
    expect(tokenPayload.data.token.split(".")).toHaveLength(3);

    const jwtRead = await fetch(`${baseUrl}/api/prompts`, {
      headers: {
        authorization: `Bearer ${tokenPayload.data.token}`,
      },
    });
    expect(jwtRead.status).toBe(200);
    expect((await jwtRead.json()).data.pagination.total).toBe(1);

    const invalidTokenRequest = await fetch(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "not-the-api-key" }),
    });
    expect(invalidTokenRequest.status).toBe(401);
  });

  it("returns a deliberate malformed-JSON response before route dispatch", async () => {
    const response = await fetch(`${baseUrl}/api/prompts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "server-lifecycle-api-key",
      },
      body: '{"slug":',
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatchObject({
      code: "BAD_REQUEST",
      message: "Malformed JSON payload",
      details: { requestId: expect.any(String) },
    });
  });

  it("keeps logs authenticated and validates log filters", async () => {
    expect((await fetch(`${baseUrl}/logs`)).status).toBe(401);

    const invalidLevel = await fetch(`${baseUrl}/logs?level=verbose`, {
      headers: { "x-api-key": "server-lifecycle-api-key" },
    });
    expect(invalidLevel.status).toBe(400);
    expect(await invalidLevel.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid log level 'verbose'",
      },
    });

    const logs = await fetch(`${baseUrl}/logs?level=error,warn&limit=5`, {
      headers: { "x-api-key": "server-lifecycle-api-key" },
    });
    expect(logs.status).toBe(200);
    const payload = await logs.json();
    expect(Array.isArray(payload.data.logs)).toBe(true);
    expect(payload.data.logs.length).toBeLessThanOrEqual(5);
  });

  it("enforces observability browser origins and exposes health, metrics, diagnostics, and stats", async () => {
    const rejected = await fetch(`${baseUrl}/observability/healthz`, {
      headers: { origin: "http://rejected.example" },
    });
    expect(rejected.status).toBe(403);

    const health = await fetch(`${baseUrl}/observability/healthz`, {
      headers: { origin: "http://allowed.example" },
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const metrics = await fetch(`${baseUrl}/observability/metrics`);
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain(
      "prompt_vault_http_requests_total",
    );

    const diagnostics = await fetch(
      `${baseUrl}/observability/diagnostics`,
    );
    expect(diagnostics.status).toBe(200);
    expect(await diagnostics.json()).toMatchObject({
      summary: {
        totalPrompts: 1,
        totalVersions: 1,
        invalidContent: 0,
      },
      migration: {
        pendingVersions: [],
      },
      integrity: expect.any(Object),
      issues: expect.any(Array),
    });

    const stats = await fetch(`${baseUrl}/observability/stats`);
    expect(stats.status).toBe(200);
    expect(await stats.json()).toMatchObject({
      prompts: expect.any(Object),
      versions: expect.any(Object),
    });

    const repair = await fetch(`${baseUrl}/observability/repair`, {
      method: "POST",
      headers: { "x-api-key": "server-lifecycle-api-key" },
    });
    expect(repair.status).toBe(404);
  });
});
