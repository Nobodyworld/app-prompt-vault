import { resolve } from "node:path";
import { z } from "zod";

export interface EnvironmentVariables {
  readonly [key: string]: string | undefined;
}

export interface ServerConfigOptions {
  readonly env?: EnvironmentVariables;
  readonly defaults?: {
    readonly port?: number;
    readonly databasePath?: string;
    readonly allowedOrigins?: readonly string[] | null;
    readonly metricsEnabled?: boolean;
    readonly metricsPort?: number;
    readonly staticDirectory?: string | null;
  };
}

export interface ServerConfig {
  readonly port: number;
  readonly databasePath: string;
  readonly allowedOrigins: readonly string[] | null;
  readonly metrics: {
    readonly enabled: boolean;
    readonly port?: number;
  };
  readonly staticDirectory?: string;
}

export class ConfigurationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(issues.join("\n"));
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

export interface LoadConfigResult {
  readonly config: ServerConfig;
  readonly warnings: readonly string[];
}

const booleanSchema = z
  .union([z.string(), z.boolean(), z.number()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    throw new Error("Invalid boolean value");
  });

const portSchema = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("Invalid port number");
    }
    return parsed;
  })
  .refine((value) => value >= 0 && value <= 65535, {
    message: "Port must be between 0 and 65535",
  });

function normalizeDatabasePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    throw new Error("Database path cannot be empty");
  }
  return resolve(trimmed);
}

function normalizeAllowedOrigins(
  value: string | undefined,
  defaults: readonly string[] | null | undefined
): { origins: string[] | null; warnings: string[] } {
  if (value === undefined || value.trim().length === 0) {
    if (defaults == null || defaults.length === 0) {
      return { origins: null, warnings: [] };
    }
    return normalizeAllowedOrigins(defaults.join(","), null);
  }

  const seen = new Set<string>();
  const warnings: string[] = [];
  const origins: string[] = [];
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  for (const origin of parts) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http and https origins are allowed");
      }
      const canonical = `${parsed.protocol}//${parsed.host}`;
      if (seen.has(canonical)) {
        warnings.push(`Duplicate allowed origin detected: ${canonical}`);
        continue;
      }
      seen.add(canonical);
      origins.push(canonical);
    } catch (error) {
      throw new Error(`Invalid allowed origin "${origin}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (origins.length === 0) {
    return { origins: null, warnings };
  }

  return { origins, warnings };
}

function normalizeStaticDirectory(value: string | undefined, defaults: string | null | undefined): string | undefined {
  const candidate = value ?? defaults ?? undefined;
  if (candidate == null) {
    return undefined;
  }
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return resolve(trimmed);
}

export function loadServerConfig(options: ServerConfigOptions = {}): LoadConfigResult {
  const env = options.env ?? process.env;
  const issues: string[] = [];
  const warnings: string[] = [];

  const portResult = (() => {
    const raw = env.PORT ?? options.defaults?.port ?? 3001;
    try {
      return portSchema.parse(raw);
    } catch (error) {
      issues.push(`PORT: ${error instanceof Error ? error.message : String(error)}`);
      return 3001;
    }
  })();

  const databasePathResult = (() => {
    const raw = env.PROMPT_VAULT_DB_PATH ?? options.defaults?.databasePath ?? "prompt-vault.db";
    try {
      return normalizeDatabasePath(raw);
    } catch (error) {
      issues.push(`PROMPT_VAULT_DB_PATH: ${error instanceof Error ? error.message : String(error)}`);
      return normalizeDatabasePath("prompt-vault.db");
    }
  })();

  const metricsEnabledResult = (() => {
    const raw = env.PROMPT_VAULT_METRICS ?? options.defaults?.metricsEnabled ?? false;
    try {
      return booleanSchema.parse(raw);
    } catch (error) {
      issues.push(`PROMPT_VAULT_METRICS: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  })();

  const metricsPortResult = (() => {
    const raw = env.PROMPT_VAULT_METRICS_PORT ?? options.defaults?.metricsPort;
    if (raw === undefined || raw === null || raw === "") {
      return undefined;
    }
    try {
      return portSchema.parse(raw);
    } catch (error) {
      issues.push(`PROMPT_VAULT_METRICS_PORT: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  })();

  const allowedOriginsResult = (() => {
      try {
        return normalizeAllowedOrigins(env.PROMPT_VAULT_ALLOWED_ORIGINS, options.defaults?.allowedOrigins ?? null);
      } catch (error) {
        issues.push(`PROMPT_VAULT_ALLOWED_ORIGINS: ${error instanceof Error ? error.message : String(error)}`);
        return { origins: null, warnings: [] };
      }
  })();

  warnings.push(...allowedOriginsResult.warnings);

  const staticDirectory = normalizeStaticDirectory(env.PROMPT_VAULT_STATIC_DIR, options.defaults?.staticDirectory ?? undefined);

  if (!metricsEnabledResult && metricsPortResult !== undefined) {
    warnings.push("PROMPT_VAULT_METRICS_PORT is set but PROMPT_VAULT_METRICS is disabled. Metrics will remain disabled.");
  }

  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  return {
    config: {
      port: portResult,
      databasePath: databasePathResult,
      allowedOrigins: allowedOriginsResult.origins,
      metrics: {
        enabled: metricsEnabledResult,
        port: metricsEnabledResult ? metricsPortResult : undefined,
      },
      staticDirectory,
    },
    warnings,
  };
}
