import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import cors from "cors";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { PromptVaultService } from "./services/PromptVaultService.js";
import { createAuditTrailPlugin, createOperationalTelemetryPlugin } from "./extensions/index.js";
import { createPromptVaultRouter } from "./web/createPromptVaultRouter.js";
import { createLogger, getRecentLogs, type LogLevel } from "@nw/logging";
import {
  bootstrapObservabilityFromEnv,
  createHttpMetricsMiddleware,
  createHttpTracingMiddleware,
} from "./observability/index.js";
import { createObservabilityRouter } from "./web/createObservabilityRouter.js";
import { ConfigurationError, loadServerConfig, type LoadConfigResult } from "./config/serverConfig.js";
import { AuthManager, createAuthMiddleware, createAuthRouter } from "./web/auth.js";
import { InMemoryAuditLogger, createAuditMiddleware, createAutoAuditMiddleware } from "./web/audit.js";
import { createRateLimitMiddleware } from "./web/rate-limit.js";

const envLogLevel = parseLogLevel(process.env.LOG_LEVEL || process.env.PROMPT_VAULT_LOG_LEVEL);
const bootstrapLogger = createLogger({
  context: { app: "prompt-vault", module: "server" },
  level: envLogLevel ?? "info",
});

function parseLogLevel(value: string | undefined): LogLevel | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return undefined;
}

function parseLevelFilter(raw: unknown): { levels?: LogLevel | LogLevel[]; error?: string } {
  if (raw === undefined) return {};
  const parts = String(raw)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return {};

  const mapped: LogLevel[] = [];
  for (const part of parts) {
    const level = parseLogLevel(part);
    if (!level) {
      return { error: `Invalid log level '${part}'` };
    }
    mapped.push(level);
  }

  return { levels: mapped.length === 1 ? mapped[0] : mapped };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultDbPath = process.env.PROMPT_VAULT_DB_PATH ?? resolve(__dirname, "prompt-vault.db");
const defaultStaticDir = resolve(__dirname, "desktop", "dist");

let loadedConfig: LoadConfigResult;
try {
  loadedConfig = loadServerConfig({
    defaults: {
      port: 3001,
      databasePath: defaultDbPath,
      staticDirectory: defaultStaticDir,
    },
  });
} catch (error) {
  if (error instanceof ConfigurationError) {
    bootstrapLogger.error("Failed to load server configuration", { issues: error.issues.join("; ") });
    process.exit(1);
  }
  throw error;
}

const config = loadedConfig.config;

const observability = bootstrapObservabilityFromEnv({
  serviceName: "prompt-vault-http",
  enableMetrics: config.metrics.enabled,
  metricsPort: config.metrics.port,
});
const logger = observability.logger.child({ component: "http" });

if (loadedConfig.warnings.length > 0) {
  for (const warning of loadedConfig.warnings) {
    logger.warn("configuration_warning", { warning });
  }
}

const requireAuth = process.env.REQUIRE_AUTH === "true";
const localhostOnly = process.env.LOCALHOST_ONLY === "true";
const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== "false";
const rateLimitMaxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10);
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
const authRateLimitMaxRequests = parseInt(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || "20", 10);
const authRateLimitWindowMs = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || "60000", 10);

logger.info("configuration_loaded", {
  port: config.port,
  databasePath: config.databasePath,
  allowedOrigins: config.allowedOrigins ?? "*",
  metricsEnabled: config.metrics.enabled,
  metricsPort: config.metrics.port,
  staticDirectory: config.staticDirectory,
  requireAuth,
  localhostOnly,
  rateLimitEnabled,
  rateLimitMaxRequests,
  rateLimitWindowMs,
  authRateLimitMaxRequests,
  authRateLimitWindowMs,
});

observability.indicator.setLiveness({ status: "ok" });
observability.indicator.setReadiness({ status: "degraded", details: { reason: "initialising" } });

const database = new Database(config.databasePath);
const service = new PromptVaultService(database, {
  telemetry: observability.telemetry,
  logger: logger.child({ component: "service" }),
  plugins: [createAuditTrailPlugin(), createOperationalTelemetryPlugin()],
  limits: config.limits,
});

const app = express();
app.disable("x-powered-by");

app.use(
  createHttpTracingMiddleware({
    telemetry: observability.telemetry,
    logger: logger.child({ subcomponent: "tracing" }),
  })
);

if (config.allowedOrigins && config.allowedOrigins.length > 0) {
  app.use(cors({ origin: [...config.allowedOrigins] }));
} else {
  app.use(cors());
}

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  if (request.protocol === "https" || request.headers["x-forwarded-proto"] === "https") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// Extract API keys from environment
function extractApiKeys(env: NodeJS.ProcessEnv): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("API_KEY_") && value) {
      const keyName = key.replace("API_KEY_", "").toLowerCase();
      keys[keyName] = value;
    }
  }
  return keys;
}

// Initialize security features
const authManager = new AuthManager(
  {
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
    jwtSecret: process.env.JWT_SECRET,
    requireAuthByDefault: requireAuth,
    localhostOnly,
    apiKeys: extractApiKeys(process.env),
  },
  logger.child({ component: "auth" })
);

// Initialize auth manager (loads/stores JWT secret)
await authManager.initialize();

const auditLogger = new InMemoryAuditLogger({
  maxEvents: parseInt(process.env.AUDIT_MAX_EVENTS || "10000", 10),
  logger: logger.child({ component: "audit" }),
});

app.use((request, response, next) => {
  const incomingRequestId = request.header("x-request-id");
  // Only allow simple request identifiers to avoid header-based log injection.
  const sanitized = incomingRequestId && /^[A-Za-z0-9-_.]{8,128}$/.test(incomingRequestId);
  const requestId = sanitized ? incomingRequestId : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  if (response.locals.traceId) {
    response.setHeader("x-trace-id", response.locals.traceId);
  }

  const start = process.hrtime.bigint();
  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.info("http_request_completed", {
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs,
      requestId,
      traceId: response.locals.traceId,
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
      traceId: response.locals.traceId,
    });
    response.status(400).json({ error: "Malformed JSON payload" });
    return;
  }
  next(error);
});

const apiRouter = express.Router();

apiRouter.use(
  createAuthMiddleware({
    authManager,
    requireAuth,
    localhostOnly,
    logger: logger.child({ component: "auth-middleware" }),
  })
);

apiRouter.use(createAuditMiddleware({ auditLogger, logger: logger.child({ component: "audit-middleware" }) }));
apiRouter.use(createAutoAuditMiddleware());

if (rateLimitEnabled) {
  apiRouter.use(
    createRateLimitMiddleware({
      maxRequests: rateLimitMaxRequests,
      windowMs: rateLimitWindowMs,
      logger: logger.child({ component: "rate-limit" }),
    })
  );
}

apiRouter.use(
  createPromptVaultRouter(service, logger.child({ component: "router" }), {
    telemetry: observability.telemetry,
  })
);

app.use(
  "/auth",
  createAuthRouter({
    authManager,
    logger: logger.child({ component: "auth-router" }),
    rateLimit: {
      maxRequests: authRateLimitMaxRequests,
      windowMs: authRateLimitWindowMs,
    },
  })
);

app.use("/api", apiRouter);

app.use(
  "/observability",
  createObservabilityRouter({
    indicator: observability.indicator,
    registry: observability.telemetry.registry,
    logger: logger.child({ component: "observability-router" }),
    service,
  })
);

// Minimal log aggregation feed (in-memory, best-effort)
const logsRouter = express.Router();

logsRouter.use(
  createAuthMiddleware({
    authManager,
    // Always require auth for log access, even if the API is otherwise open.
    requireAuth: true,
    localhostOnly,
    logger: logger.child({ component: "logs-auth" }),
  })
);

if (rateLimitEnabled) {
  logsRouter.use(
    createRateLimitMiddleware({
      maxRequests: rateLimitMaxRequests,
      windowMs: rateLimitWindowMs,
      logger: logger.child({ component: "logs-rate-limit" }),
    })
  );
}

logsRouter.get("/", (request, response) => {
  const parsed = z
    .object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
      level: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .safeParse(request.query);

  if (!parsed.success) {
    response.status(400).json({ error: "Request validation failed", details: parsed.error.issues.map((i) => i.message) });
    return;
  }

  const { levels, error: levelError } = parseLevelFilter(parsed.data.level);
  if (levelError) {
    response.status(400).json({ error: levelError });
    return;
  }

  response.json({ logs: getRecentLogs(parsed.data.limit, levels) });
});

app.use("/logs", logsRouter);

const staticDirectory = config.staticDirectory;
if (staticDirectory && existsSync(staticDirectory)) {
  logger.info("serving_static_assets", { staticDir: staticDirectory });
  app.use(express.static(staticDirectory));
  app.get("*", (_request, response) => {
    response.sendFile(resolve(staticDirectory, "index.html"));
  });
} else {
  logger.warn("static_assets_missing", { staticDir: staticDirectory });
}

const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  logger.error("unhandled_error", {
    method: request.method,
    path: request.path,
    error: error instanceof Error ? error.stack ?? error.message : error,
    requestId: response.locals.requestId,
    traceId: response.locals.traceId,
  });
  response
    .status(500)
    .json({ error: "Internal Server Error", requestId: response.locals.requestId, traceId: response.locals.traceId });
};

app.use(errorHandler);

const server = app.listen(config.port, () => {
  logger.info("server_started", { port: config.port, dbPath: config.databasePath });
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
