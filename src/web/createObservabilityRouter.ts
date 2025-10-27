import { Router } from "express";
import type { NextFunction, Request, Response, Router as ExpressRouter } from "express";
import type { StructuredLogger } from "../observability/logger.js";
import type { HealthIndicator } from "../observability/healthServer.js";
import type { MetricRegistry } from "../observability/telemetry.js";

interface ObservabilityRouterOptions {
  readonly indicator: HealthIndicator;
  readonly registry: MetricRegistry;
  readonly logger: StructuredLogger;
}

export function createObservabilityRouter(options: ObservabilityRouterOptions): ExpressRouter {
  const router = Router();

  router.get("/healthz", (_request, response) => {
    const status = options.indicator.getLiveness();
    response.status(status.status === "failed" ? 503 : 200).json(status);
  });

  router.get("/readyz", (_request, response) => {
    const status = options.indicator.getReadiness();
    response.status(status.status === "ok" ? 200 : 503).json(status);
  });

  router.get("/metrics", (_request, response) => {
    const snapshot = options.registry.snapshot();
    response.status(200).type("text/plain; version=0.0.4").send(snapshot);
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    options.logger.error("observability_router_error", {
      error: error instanceof Error ? error.message : error,
    });
    response.status(500).json({ error: "Observability router error" });
  });

  return router;
}
