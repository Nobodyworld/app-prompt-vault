import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthIndicator } from "../src/observability/healthServer.js";
import { StructuredLogger } from "../src/observability/logger.js";
import { MetricRegistry } from "../src/observability/telemetry.js";
import type { PromptVaultService } from "../src/services/PromptVaultService.js";
import { createObservabilityRouter } from "../src/web/createObservabilityRouter.js";

const ALLOWED_ORIGIN = "http://127.0.0.1:1420";

function buildApp(enableRepair = false) {
  const repairIntegrity = vi.fn(async () => ({ repaired: true }));
  const service = {
    runDiagnostics: vi.fn(async () => ({ status: "ok" })),
    getLibraryStats: vi.fn(async () => ({ prompts: 0 })),
    repairIntegrity,
  } as unknown as PromptVaultService;

  const app = express();
  app.use(
    "/observability",
    createObservabilityRouter({
      indicator: createHealthIndicator(),
      registry: new MetricRegistry({ service: "test" }),
      logger: new StructuredLogger({ level: "error" }),
      service,
      enableRepair,
    }),
  );

  return { app, repairIntegrity };
}

describe("observability router security", () => {
  beforeEach(() => {
    vi.stubEnv("PROMPT_VAULT_ALLOWED_ORIGINS", ALLOWED_ORIGIN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects an unlisted browser origin before reading health state", async () => {
    const { app } = buildApp();

    const response = await request(app)
      .get("/observability/healthz")
      .set("Origin", "https://malicious.example")
      .expect(403);

    expect(response.body).toEqual({ error: "Forbidden browser origin" });
  });

  it("allows an explicitly listed local browser origin", async () => {
    const { app } = buildApp();

    const response = await request(app)
      .get("/observability/healthz")
      .set("Origin", ALLOWED_ORIGIN)
      .expect(200);

    expect(response.body).toEqual({ status: "ok" });
  });

  it("does not register the mutation-capable repair route by default", async () => {
    const { app, repairIntegrity } = buildApp();

    await request(app).post("/observability/repair").expect(404);

    expect(repairIntegrity).not.toHaveBeenCalled();
  });

  it("still blocks a hostile browser origin when repair is explicitly enabled", async () => {
    const { app, repairIntegrity } = buildApp(true);

    await request(app)
      .post("/observability/repair")
      .set("Origin", "https://malicious.example")
      .expect(403);

    expect(repairIntegrity).not.toHaveBeenCalled();
  });

  it("permits explicitly enabled repair from an allowed local origin", async () => {
    const { app, repairIntegrity } = buildApp(true);

    const response = await request(app)
      .post("/observability/repair")
      .set("Origin", ALLOWED_ORIGIN)
      .expect(200);

    expect(response.body.repaired).toBe(true);
    expect(repairIntegrity).toHaveBeenCalledOnce();
  });
});
