import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import cors from "cors";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { PromptVaultService } from "./src/services/PromptVaultService.js";
import { bootstrapObservabilityFromEnv } from "./src/observability/index.js";
import { createAuditTrailPlugin, createOperationalTelemetryPlugin } from "./src/extensions/index.js";
import { createPromptVaultRouter } from "./src/web/createPromptVaultRouter.js";
import { createHttpMetricsMiddleware } from "./src/observability/httpInstrumentation.js";
import { createObservabilityRouter } from "./src/web/createObservabilityRouter.js";

const observability = bootstrapObservabilityFromEnv({ serviceName: "prompt-vault-http" });
const logger = observability.logger.child({ component: "http" });

observability.indicator.setLiveness({ status: "ok" });
observability.indicator.setReadiness({ status: "degraded", details: { reason: "initialising" } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultDbPath = process.env.PROMPT_VAULT_DB_PATH ?? resolve(__dirname, "prompt-vault.db");
const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const allowedOrigins = process.env.PROMPT_VAULT_ALLOWED_ORIGINS;

const database = new Database(defaultDbPath);
const service = new PromptVaultService(database, {
  telemetry: observability.telemetry,
  logger: logger.child({ component: "service" }),
  plugins: [createAuditTrailPlugin(), createOperationalTelemetryPlugin()],
});

const app = express();
app.disable("x-powered-by");

const parsedAllowedOrigins = allowedOrigins
  ?.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (parsedAllowedOrigins && parsedAllowedOrigins.length > 0) {
  app.use(cors({ origin: parsedAllowedOrigins }));
} else {
  app.use(cors());
}

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use((request, response, next) => {
  const incomingRequestId = request.header("x-request-id");
  // Only allow simple request identifiers to avoid header-based log injection.
  const sanitized = incomingRequestId && /^[A-Za-z0-9-_.]{8,128}$/.test(incomingRequestId);
  const requestId = sanitized ? incomingRequestId : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);

  const start = process.hrtime.bigint();
  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.info("http_request_completed", {
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs,
      requestId,
    });
  });

  next();
});

app.use(
  createHttpMetricsMiddleware({
    telemetry: observability.telemetry,
    logger: logger.child({ component: "http-metrics" }),
  })
);

app.use(express.json({ limit: "1mb" }));
app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  if (error instanceof SyntaxError) {
    logger.warn("malformed_json", {
      path: request.path,
      requestId: response.locals.requestId,
    });
    response.status(400).json({ error: "Malformed JSON payload" });
    return;
  }
  next(error);
});

app.use(
  "/api",
  createPromptVaultRouter(service, logger.child({ component: "router" }), {
    telemetry: observability.telemetry,
  })
);

app.use(
  "/observability",
  createObservabilityRouter({
    indicator: observability.indicator,
    registry: observability.telemetry.registry,
    logger: logger.child({ component: "observability-router" }),
  })
);

const staticDir = resolve(__dirname, "desktop", "dist");
if (existsSync(staticDir)) {
  logger.info("serving_static_assets", { staticDir });
  app.use(express.static(staticDir));
  app.get("*", (_request, response) => {
    response.sendFile(resolve(staticDir, "index.html"));
  });
} else {
  logger.warn("static_assets_missing", { staticDir });
}

const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  logger.error("unhandled_error", {
    method: request.method,
    path: request.path,
    error: error instanceof Error ? error.stack ?? error.message : error,
    requestId: response.locals.requestId,
  });
  response.status(500).json({ error: "Internal Server Error", requestId: response.locals.requestId });
};

app.use(errorHandler);

const server = app.listen(port, () => {
  logger.info("server_started", { port, dbPath: defaultDbPath });
  observability.indicator.setReadiness({ status: "ok" });
});

let shuttingDown = false;

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  observability.indicator.setReadiness({ status: "degraded", details: { reason: "shutdown" } });
  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise());
  });
  database.close();
  await observability.shutdown();
  process.exit(exitCode);
}

process.once("SIGINT", () => {
  logger.info("signal_received", { signal: "SIGINT" });
  void shutdown(130);
});

process.once("SIGTERM", () => {
  logger.info("signal_received", { signal: "SIGTERM" });
  void shutdown(143);
});

process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", { error: error instanceof Error ? error.stack ?? error.message : error });
  void shutdown(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", { reason: reason instanceof Error ? reason.stack ?? reason.message : reason });
  void shutdown(1);
});

process.on("exit", () => {
  if (!shuttingDown) {
    database.close();
    void observability.shutdown();
  }
});
