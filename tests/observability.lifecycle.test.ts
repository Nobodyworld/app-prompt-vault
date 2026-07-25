import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHealthIndicator,
  createHealthServer,
} from "../src/observability/healthServer.js";
import { StructuredLogger } from "../src/observability/logger.js";
import { bootstrapObservabilityFromEnv } from "../src/observability/runtime.js";
import {
  MetricRegistry,
  createNoopTelemetry,
  createTelemetry,
} from "../src/observability/telemetry.js";

const servers: Server[] = [];
const originalMetrics = process.env.PROMPT_VAULT_METRICS;
const originalMetricsPort = process.env.PROMPT_VAULT_METRICS_PORT;

async function waitForListening(server: Server): Promise<number> {
  if (!server.listening) {
    await once(server, "listening");
  }
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalMetrics === undefined) {
    delete process.env.PROMPT_VAULT_METRICS;
  } else {
    process.env.PROMPT_VAULT_METRICS = originalMetrics;
  }
  if (originalMetricsPort === undefined) {
    delete process.env.PROMPT_VAULT_METRICS_PORT;
  } else {
    process.env.PROMPT_VAULT_METRICS_PORT = originalMetricsPort;
  }
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("MetricRegistry and telemetry", () => {
  it("records counters, gauges, histograms, summaries, labels, and empty snapshots", () => {
    const registry = new MetricRegistry({ service: "coverage" });
    expect(registry.snapshot()).toBe("# No metrics recorded yet");

    const counter = registry.getOrCreateCounter(
      "coverage_counter_total",
      "Counter help",
      ["service", "quoted"],
    );
    const sameCounter = registry.getOrCreateCounter(
      "coverage_counter_total",
      "ignored replacement",
    );
    expect(sameCounter).toBe(counter);
    counter.increment(
      registry.withDefaultLabels({ quoted: 'owner"one', ignored: "value" }),
      2,
    );
    expect(() => counter.increment({}, -1)).toThrow(
      "Counter value cannot be negative",
    );

    const gauge = registry.getOrCreateGauge(
      "coverage_gauge",
      "Gauge help",
      ["state"],
    );
    expect(registry.getOrCreateGauge("coverage_gauge", "ignored")).toBe(gauge);
    gauge.set(4, { state: "ready" });
    gauge.increment({ state: "ready" }, 3);
    gauge.decrement({ state: "ready" }, 2);

    const histogram = registry.getOrCreateHistogram(
      "coverage_duration_seconds",
      "Histogram help",
      ["operation"],
      [0.5, 1],
    );
    expect(
      registry.getOrCreateHistogram("coverage_duration_seconds", "ignored"),
    ).toBe(histogram);
    histogram.observe(0.25, { operation: "read" });
    histogram.observe(2, { operation: "read" });

    const summary = registry.getOrCreateSummary(
      "coverage_payload_bytes",
      "Summary help",
      ["format"],
      [0.5, 1],
    );
    expect(
      registry.getOrCreateSummary("coverage_payload_bytes", "ignored"),
    ).toBe(summary);
    summary.observe(10, { format: "json" });
    summary.observe(30, { format: "json" });

    const snapshot = registry.snapshot();
    expect(snapshot).toContain(
      'coverage_counter_total{service="coverage",quoted="owner\\"one"} 2',
    );
    expect(snapshot).toContain('coverage_gauge{state="ready"} 5');
    expect(snapshot).toContain(
      'coverage_duration_seconds_bucket{le="0.5",operation="read"} 1',
    );
    expect(snapshot).toContain(
      'coverage_duration_seconds_bucket{le="+Inf",operation="read"} 2',
    );
    expect(snapshot).toContain(
      'coverage_payload_bytes{quantile="0.5",format="json"}',
    );
    expect(snapshot).toContain(
      'coverage_payload_bytes_count{format="json"} 2',
    );
    expect(snapshot).toContain(
      'coverage_payload_bytes_sum{format="json"} 40',
    );
  });

  it("records synchronous and asynchronous span success and failure", async () => {
    const logger = new StructuredLogger({ level: "error" });
    const error = vi.spyOn(logger, "error");
    const telemetry = createTelemetry({
      serviceName: "telemetry-lifecycle",
      logger,
    });

    const syncValue = telemetry.withSpan("sync-success", { count: 1 }, () => {
      const context = telemetry.getActiveContext();
      expect(context?.name).toBe("sync-success");
      const child = telemetry.createChildSpan("manual-child", {
        enabled: true,
      });
      expect(child.traceId).toBe(context?.traceId);
      expect(child.parentSpanId).toBe(context?.spanId);
      return 42;
    });
    expect(syncValue).toBe(42);

    await expect(
      telemetry.withSpan("async-success", {}, async () => "done"),
    ).resolves.toBe("done");
    expect(() =>
      telemetry.withSpan("sync-failure", {}, () => {
        throw new Error("sync exploded");
      }),
    ).toThrow("sync exploded");
    await expect(
      telemetry.withSpan("async-failure", {}, async () => {
        throw new Error("async exploded");
      }),
    ).rejects.toThrow("async exploded");

    await expect(
      telemetry.withChildSpan("child-operation", {}, async () => {
        expect(telemetry.getActiveContext()?.name).toBe("child-operation");
        return "child-result";
      }),
    ).resolves.toBe("child-result");
    telemetry.recordEvent("coverage.event", { result: "ok" });

    const snapshot = telemetry.registry.snapshot();
    expect(snapshot).toContain(
      'prompt_vault_span_total{span_name="sync-success",status="ok"} 1',
    );
    expect(snapshot).toContain(
      'prompt_vault_span_total{span_name="sync-failure",status="error"} 1',
    );
    expect(snapshot).toContain(
      'prompt_vault_events_total{event_name="coverage.event"} 1',
    );
    expect(error).toHaveBeenCalledWith(
      "span_failed:sync-failure",
      expect.objectContaining({ error: "sync exploded" }),
    );
  });

  it("executes no-op telemetry callbacks and exposes isolated child contexts", async () => {
    const defaultNoop = createTelemetry();
    const explicitNoop = createNoopTelemetry();

    expect(defaultNoop.withSpan("sync", {}, () => "value")).toBe("value");
    await expect(
      explicitNoop.withSpan("async", {}, async () => "async-value"),
    ).resolves.toBe("async-value");
    expect(defaultNoop.getActiveContext()).toBeUndefined();
    expect(defaultNoop.createChildSpan("ignored").name).toBe("noop");
    expect(
      defaultNoop.withChildSpan("child", {}, () => "child-value"),
    ).toBe("child-value");
    expect(() => defaultNoop.recordEvent("ignored")).not.toThrow();
  });
});

describe("health server lifecycle", () => {
  it("serves metrics, health, readiness, diagnostics, stats, and protocol errors", async () => {
    const registry = new MetricRegistry();
    registry
      .getOrCreateCounter("health_requests_total", "Health requests")
      .increment();
    const indicator = createHealthIndicator();
    const logger = new StructuredLogger({ level: "error" });
    const statsProvider = vi.fn(async () => ({ prompts: 7 }));
    const handle = createHealthServer({
      host: "127.0.0.1",
      port: 0,
      registry,
      indicator,
      logger,
      statsProvider,
    });
    servers.push(handle.server);
    const port = await waitForListening(handle.server);
    const baseUrl = `http://127.0.0.1:${port}`;

    expect(handle.host).toBe("127.0.0.1");
    expect(handle.indicator.getLiveness()).toEqual({ status: "ok" });
    expect(handle.indicator.getReadiness()).toEqual({
      status: "degraded",
      details: { reason: "not-initialised" },
    });

    const metrics = await fetch(`${baseUrl}/metrics`);
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toContain("text/plain");
    expect(await metrics.text()).toContain("health_requests_total 1");

    const liveness = await fetch(`${baseUrl}/healthz`);
    expect(liveness.status).toBe(200);
    expect(await liveness.json()).toEqual({ status: "ok" });

    const initialReadiness = await fetch(`${baseUrl}/readyz`);
    expect(initialReadiness.status).toBe(503);
    indicator.setReadiness({ status: "ok", details: { migrations: "done" } });
    const readiness = await fetch(`${baseUrl}/readyz`);
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toEqual({
      status: "ok",
      details: { migrations: "done" },
    });

    indicator.setLiveness({ status: "failed", details: { database: "down" } });
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(503);

    const diagnostics = await (
      await fetch(`${baseUrl}/diagnostics`)
    ).json();
    expect(diagnostics).toMatchObject({
      platform: process.platform,
      pid: process.pid,
      health: {
        liveness: { status: "failed" },
        readiness: { status: "ok" },
      },
      metrics: { hasMetrics: true },
    });

    const stats = await fetch(`${baseUrl}/stats`);
    expect(stats.status).toBe(200);
    expect(await stats.json()).toMatchObject({ prompts: 7 });
    expect(statsProvider).toHaveBeenCalledOnce();

    expect(
      (await fetch(`${baseUrl}/unknown`)).status,
    ).toBe(404);
    expect(
      (await fetch(`${baseUrl}/healthz`, { method: "POST" })).status,
    ).toBe(405);
  });

  it("reports missing and failing stats providers without leaking server resources", async () => {
    const registry = new MetricRegistry();
    const withoutStats = createHealthServer({
      host: "127.0.0.1",
      port: 0,
      registry,
    });
    servers.push(withoutStats.server);
    const firstPort = await waitForListening(withoutStats.server);
    const missingResponse = await fetch(
      `http://127.0.0.1:${firstPort}/stats`,
    );
    expect(missingResponse.status).toBe(501);
    expect(await missingResponse.json()).toEqual({
      error: "Stats provider not configured",
    });

    const failing = createHealthServer({
      host: "127.0.0.1",
      port: 0,
      registry,
      statsProvider: async () => {
        throw "stats unavailable";
      },
    });
    servers.push(failing.server);
    const secondPort = await waitForListening(failing.server);
    const failureResponse = await fetch(
      `http://127.0.0.1:${secondPort}/stats`,
    );
    expect(failureResponse.status).toBe(500);
    expect(await failureResponse.json()).toEqual({
      error: "Failed to retrieve stats",
      details: "stats unavailable",
    });
  });
});

describe("observability runtime bootstrap", () => {
  it("keeps metrics disabled by default and provides a repeatable no-op shutdown", async () => {
    delete process.env.PROMPT_VAULT_METRICS;
    delete process.env.PROMPT_VAULT_METRICS_PORT;
    const handle = bootstrapObservabilityFromEnv({
      serviceName: "disabled-runtime",
      logger: new StructuredLogger({ level: "error" }),
    });

    expect(handle.server).toBeUndefined();
    expect(handle.port).toBeUndefined();
    expect(handle.indicator.getReadiness().status).toBe("degraded");
    await expect(handle.shutdown()).resolves.toBeUndefined();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("starts metrics from environment values and shuts down its listener and watcher", async () => {
    process.env.PROMPT_VAULT_METRICS = "TrUe";
    process.env.PROMPT_VAULT_METRICS_PORT = "0";
    const handle = bootstrapObservabilityFromEnv({
      serviceName: "enabled-runtime",
      logger: new StructuredLogger({ level: "error" }),
    });
    expect(handle.server).toBeDefined();
    const server = handle.server!;
    const port = await waitForListening(server);
    handle.indicator.setReadiness({ status: "ok" });

    const readiness = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(readiness.status).toBe(200);
    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain("prompt_vault_span_total");

    await expect(handle.shutdown()).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
  });

  it("honors explicit enablement and port options over disabled environment values", async () => {
    process.env.PROMPT_VAULT_METRICS = "false";
    process.env.PROMPT_VAULT_METRICS_PORT = "not-a-port";
    const handle = bootstrapObservabilityFromEnv({
      serviceName: "explicit-runtime",
      enableMetrics: true,
      metricsPort: 0,
      logger: new StructuredLogger({ level: "error" }),
    });
    expect(handle.server).toBeDefined();
    await waitForListening(handle.server!);
    await handle.shutdown();
  });
});
