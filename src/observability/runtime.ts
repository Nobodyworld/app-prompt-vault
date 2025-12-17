import type { Server } from "node:http";
import type { StructuredLogger } from "./logger.js";
import { createLoggerFromEnv } from "./logger.js";
import type { Telemetry } from "./telemetry.js";
import {
  createNoopTelemetry,
  createTelemetry,
  MetricRegistry,
} from "./telemetry.js";
import type { HealthIndicator } from "./healthServer.js";
import { createHealthIndicator, createHealthServer } from "./healthServer.js";
import { startTelemetryMetricsWatcher } from "./telemetryFileReader.js";

export interface ObservabilityBootstrapOptions {
  readonly serviceName: string;
  readonly enableMetrics?: boolean;
  readonly metricsPort?: number;
  readonly logger?: StructuredLogger;
}

export interface ObservabilityHandle {
  readonly telemetry: Telemetry;
  readonly logger: StructuredLogger;
  readonly indicator: HealthIndicator;
  readonly server?: Server;
  readonly port?: number;
  shutdown(): Promise<void>;
}

export function bootstrapObservabilityFromEnv(
  options: ObservabilityBootstrapOptions,
): ObservabilityHandle {
  const logger =
    options.logger ?? createLoggerFromEnv({ serviceName: options.serviceName });
  const metricsEnabled =
    options.enableMetrics ??
    (process.env.PROMPT_VAULT_METRICS ?? "").toLowerCase() === "true";
  const metricsPort =
    options.metricsPort ??
    Number.parseInt(process.env.PROMPT_VAULT_METRICS_PORT ?? "", 10);

  if (!metricsEnabled) {
    return {
      telemetry: createNoopTelemetry(),
      logger,
      indicator: createHealthIndicator(),
      async shutdown() {
        // noop
      },
    };
  }

  const registry = new MetricRegistry({ service: options.serviceName });
  const telemetry = createTelemetry({
    serviceName: options.serviceName,
    logger,
    registry,
  });
  const indicator = createHealthIndicator();
  const serverHandle = createHealthServer({
    registry,
    logger,
    indicator,
    port: Number.isFinite(metricsPort) ? metricsPort : undefined,
  });

  // Start telemetry metrics watcher which reads renderer-produced telemetry-metrics.json and increments counters.
  // The watcher is best-effort and only runs when metrics are enabled.
  const watcher = startTelemetryMetricsWatcher(registry);

  return {
    telemetry,
    logger,
    indicator,
    server: serverHandle.server,
    port: serverHandle.port,
    async shutdown() {
      await new Promise<void>((resolve, reject) => {
        serverHandle.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      watcher.stop();
    },
  };
}
