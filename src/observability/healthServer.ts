import http from "node:http";
import type { AddressInfo } from "node:net";
import type { MetricRegistry } from "./telemetry.js";
import type { StructuredLogger } from "./logger.js";

export interface HealthStatus {
  readonly status: "ok" | "degraded" | "failed";
  readonly details?: Record<string, unknown>;
}

export interface HealthIndicator {
  setLiveness(status: HealthStatus): void;
  setReadiness(status: HealthStatus): void;
  getLiveness(): HealthStatus;
  getReadiness(): HealthStatus;
}

class StatefulHealthIndicator implements HealthIndicator {
  private liveness: HealthStatus = { status: "ok" };

  private readiness: HealthStatus = {
    status: "degraded",
    details: { reason: "not-initialised" },
  };

  public setLiveness(status: HealthStatus): void {
    this.liveness = status;
  }

  public setReadiness(status: HealthStatus): void {
    this.readiness = status;
  }

  public getLiveness(): HealthStatus {
    return this.liveness;
  }

  public getReadiness(): HealthStatus {
    return this.readiness;
  }
}

export interface HealthServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly registry: MetricRegistry;
  readonly logger?: StructuredLogger;
  readonly indicator?: HealthIndicator;
  readonly statsProvider?: () => Promise<Record<string, unknown>>;
}

export interface HealthServerHandle {
  readonly server: http.Server;
  readonly indicator: HealthIndicator;
  readonly port: number;
  readonly host: string;
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

export function createHealthServer(
  options: HealthServerOptions,
): HealthServerHandle {
  const indicator = options.indicator ?? new StatefulHealthIndicator();
  const logger = options.logger;

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      writeJson(res, 400, { error: "Unknown request" });
      return;
    }

    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (req.url.startsWith("/metrics")) {
      const snapshot = options.registry.snapshot();
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; version=0.0.4");
      res.setHeader("Content-Length", Buffer.byteLength(snapshot));
      res.end(snapshot);
      return;
    }

    if (req.url.startsWith("/healthz")) {
      const status = indicator.getLiveness();
      writeJson(res, status.status === "failed" ? 503 : 200, status);
      return;
    }

    if (req.url.startsWith("/readyz")) {
      const status = indicator.getReadiness();
      writeJson(res, status.status === "ok" ? 200 : 503, status);
      return;
    }

    if (req.url.startsWith("/diagnostics")) {
      const snapshot = options.registry.snapshot();
      const diagnostics = {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        cwd: process.cwd(),
        health: {
          liveness: indicator.getLiveness(),
          readiness: indicator.getReadiness(),
        },
        metrics: {
          snapshotLines: snapshot.split("\n").length,
          hasMetrics: snapshot.includes("# HELP"),
        },
      };
      writeJson(res, 200, diagnostics);
      return;
    }

    if (req.url.startsWith("/stats")) {
      if (!options.statsProvider) {
        writeJson(res, 501, { error: "Stats provider not configured" });
        return;
      }
      try {
        const stats = await options.statsProvider();
        writeJson(res, 200, {
          timestamp: new Date().toISOString(),
          ...stats,
        });
        return;
      } catch (error) {
        writeJson(res, 500, {
          error: "Failed to retrieve stats",
          details: error instanceof Error ? error.message : error,
        });
        return;
      }
    }

    writeJson(res, 404, { error: "Not found" });
  });

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 9464;

  server.listen(port, host, () => {
    logger?.info("health_server_started", { host, port });
  });

  server.on("error", (error) => {
    logger?.error("health_server_error", {
      error: error instanceof Error ? error.message : error,
    });
  });

  const address = server.address() as AddressInfo | null;
  return {
    server,
    indicator,
    host,
    port: address?.port ?? port,
  };
}

export function createHealthIndicator(): HealthIndicator {
  return new StatefulHealthIndicator();
}
