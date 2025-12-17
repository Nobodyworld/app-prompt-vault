import type { Request, RequestHandler, Response } from "express";
import type { StructuredLogger } from "./logger.js";
import type { Telemetry } from "./telemetry.js";

interface HttpInstrumentationOptions {
  readonly telemetry: Telemetry;
  readonly logger: StructuredLogger;
}

function getRouteLabel(request: Request): string {
  const routePath = (request.route?.path as string | undefined) ?? "";
  const base = request.baseUrl ?? "";
  const merged = `${base}${routePath}`;
  if (merged.length === 0 || merged === "//") {
    return request.path || "unknown";
  }
  const segments = merged.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return "/";
  }
  return `/${segments.join("/")}`;
}

/**
 * Express middleware that records Prometheus-compatible request counters and latency histograms.
 * The middleware is intentionally dependency-light so it can operate in air-gapped environments.
 */
export function createHttpMetricsMiddleware(
  options: HttpInstrumentationOptions,
): RequestHandler {
  const requestCounter = options.telemetry.registry.getOrCreateCounter(
    "prompt_vault_http_requests_total",
    "Total number of HTTP requests",
    ["method", "status", "route"],
  );
  const latencyHistogram = options.telemetry.registry.getOrCreateHistogram(
    "prompt_vault_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "status", "route"],
    [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  );

  return (request, response, next) => {
    const start = process.hrtime.bigint();
    let finished = false;

    const finalize = (res: Response): void => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        const statusCode = res.statusCode || 0;
        const durationSeconds =
          Number(process.hrtime.bigint() - start) / 1_000_000_000;
        const route = getRouteLabel(request);
        const labels = options.telemetry.registry.withDefaultLabels({
          method: request.method,
          status: String(statusCode),
          route,
        });
        requestCounter.increment(labels);
        latencyHistogram.observe(durationSeconds, labels);
        options.logger.debug("http_metrics_recorded", {
          route,
          method: request.method,
          status: statusCode,
          durationSeconds,
        });
      } catch (error) {
        options.logger.warn("http_metrics_failed", {
          error: error instanceof Error ? error.message : error,
        });
      }
    };

    response.on("finish", () => finalize(response));
    response.on("close", () => finalize(response));
    next();
  };
}
