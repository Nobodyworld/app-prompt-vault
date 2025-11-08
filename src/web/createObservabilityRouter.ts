import { Router } from "express";
import type { NextFunction, Request, Response, Router as ExpressRouter } from "express";
import type { StructuredLogger } from "../observability/logger.js";
import type { HealthIndicator } from "../observability/healthServer.js";
import type { MetricRegistry } from "../observability/telemetry.js";
import type { PromptVaultService } from "../services/PromptVaultService.js";

interface ObservabilityRouterOptions {
  readonly indicator: HealthIndicator;
  readonly registry: MetricRegistry;
  readonly logger: StructuredLogger;
  readonly service?: PromptVaultService;
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

  // Diagnostics endpoints (only available if service is provided)
  if (options.service) {
    const service = options.service;

    router.get("/diagnostics", (_request, response) => {
      try {
        const result = service.runDiagnostics();
        response.status(200).json({
          timestamp: new Date().toISOString(),
          ...result
        });
      } catch (error) {
        options.logger.error("diagnostics_endpoint_error", {
          error: error instanceof Error ? error.message : error,
        });
        response.status(500).json({
          error: "Failed to run diagnostics",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    router.get("/stats", (_request, response) => {
      try {
        const result = service.getLibraryStats();
        response.status(200).json({
          timestamp: new Date().toISOString(),
          ...result
        });
      } catch (error) {
        options.logger.error("stats_endpoint_error", {
          error: error instanceof Error ? error.message : error,
        });
        response.status(500).json({
          error: "Failed to get library stats",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    router.post("/repair", (_request, response) => {
      try {
        const result = service.repairIntegrity();
        response.status(200).json({
          timestamp: new Date().toISOString(),
          ...result
        });
      } catch (error) {
        options.logger.error("repair_endpoint_error", {
          error: error instanceof Error ? error.message : error,
        });
        response.status(500).json({
          error: "Failed to repair integrity",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    options.logger.error("observability_router_error", {
      error: error instanceof Error ? error.message : error,
    });
    response.status(500).json({ error: "Observability router error" });
  });

  return router;
}
