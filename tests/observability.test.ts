import { describe, expect, it } from "vitest";
import { MetricRegistry, createTelemetry } from "../src/observability/telemetry.js";
import { StructuredLogger } from "../src/observability/logger.js";
import { createHealthIndicator } from "../src/observability/healthServer.js";

describe("Observability", () => {
  it("records spans and exposes metrics", () => {
    const registry = new MetricRegistry();
    const telemetry = createTelemetry({
      serviceName: "test-service",
      logger: new StructuredLogger({ level: "error" }),
      registry,
    });

    telemetry.withSpan("test.span", { example: true }, () => {});
    telemetry.recordEvent("test.event", { value: 1 });

    const snapshot = registry.snapshot();
    expect(snapshot).toContain("prompt_vault_span_total");
    expect(snapshot).toContain("prompt_vault_events_total");
  });

  it("tracks health indicator state transitions", () => {
    const indicator = createHealthIndicator();
    indicator.setLiveness({ status: "ok" });
    indicator.setReadiness({ status: "failed", details: { reason: "db" } });

    expect(indicator.getLiveness().status).toBe("ok");
    expect(indicator.getReadiness().status).toBe("failed");
    expect(indicator.getReadiness().details).toEqual({ reason: "db" });
  });
});
