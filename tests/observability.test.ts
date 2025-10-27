import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { StructuredLogger } from "../src/observability/logger.js";
import { createTelemetry } from "../src/observability/telemetry.js";
import { createHttpMetricsMiddleware } from "../src/observability/httpInstrumentation.js";
import { createObservabilityRouter } from "../src/web/createObservabilityRouter.js";
import { createHealthIndicator } from "../src/observability/healthServer.js";

describe("observability integration", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          })
      )
    );
  });

  it("records HTTP metrics for successful requests", async () => {
    const telemetry = createTelemetry({
      serviceName: "test-http", 
      logger: new StructuredLogger({ level: "error" }),
    });
    const app = express();
    app.use(
      createHttpMetricsMiddleware({
        telemetry,
        logger: new StructuredLogger({ level: "error" }),
      })
    );
    app.get("/ok", (_request, response) => {
      response.status(204).send();
    });

    const server = app.listen(0);
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/ok`);
    expect(response.status).toBe(204);

    const snapshot = telemetry.registry.snapshot();
    expect(snapshot).toContain("prompt_vault_http_requests_total");
    expect(snapshot).toContain('route="/ok"');
    expect(snapshot).toContain('status="204"');
  });

  it("exposes health and metrics endpoints", async () => {
    const telemetry = createTelemetry({
      serviceName: "test-observability",
      logger: new StructuredLogger({ level: "error" }),
    });
    const indicator = createHealthIndicator();
    indicator.setLiveness({ status: "ok" });
    indicator.setReadiness({ status: "ok" });

    const app = express();
    app.use(
      "/observability",
      createObservabilityRouter({
        indicator,
        registry: telemetry.registry,
        logger: new StructuredLogger({ level: "error" }),
      })
    );

    const server = app.listen(0);
    servers.push(server);
    const { port } = server.address() as AddressInfo;

    const health = await fetch(`http://127.0.0.1:${port}/observability/healthz`);
    expect(health.status).toBe(200);
    const readiness = await fetch(`http://127.0.0.1:${port}/observability/readyz`);
    expect(readiness.status).toBe(200);
    const metrics = await fetch(`http://127.0.0.1:${port}/observability/metrics`);
    expect(metrics.status).toBe(200);
    const metricsBody = await metrics.text();
    expect(metricsBody).toContain("prompt_vault_span_total");
  });
});
