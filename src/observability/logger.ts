import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly fields?: LogFields;
}

function normaliseLevel(level: string | undefined): LogLevel {
  if (!level) {
    return "info";
  }
  const lower = level.toLowerCase();
  if (lower === "debug" || lower === "info" || lower === "warn" || lower === "error") {
    return lower;
  }
  return "info";
}

/**
 * Structured logger emitting JSON payloads for downstream aggregation.
 */
export class StructuredLogger {
  private readonly level: LogLevel;

  private readonly fields: LogFields;

  public constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.fields = options.fields ?? {};
  }

  public child(fields: LogFields): StructuredLogger {
    return new StructuredLogger({ level: this.level, fields: { ...this.fields, ...fields } });
  }

  public debug(message: string, extra: LogFields = {}): void {
    this.log("debug", message, extra);
  }

  public info(message: string, extra: LogFields = {}): void {
    this.log("info", message, extra);
  }

  public warn(message: string, extra: LogFields = {}): void {
    this.log("warn", message, extra);
  }

  public error(message: string, extra: LogFields = {}): void {
    this.log("error", message, extra);
  }

  public log(level: LogLevel, message: string, extra: LogFields = {}): void {
    if (levelWeights[level] < levelWeights[this.level]) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.fields,
      ...extra,
    };

    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](JSON.stringify(payload));
  }
}

export interface LoggerFactoryOptions {
  readonly serviceName: string;
  readonly level?: LogLevel;
  readonly fields?: LogFields;
}

export function createLoggerFromEnv(options: LoggerFactoryOptions): StructuredLogger {
  const level = options.level ?? normaliseLevel(process.env.PROMPT_VAULT_LOG_LEVEL);
  const baseFields: LogFields = {
    service: options.serviceName,
    pid: process.pid,
    trace: randomUUID(),
    ...options.fields,
  };
  return new StructuredLogger({ level, fields: baseFields });
}
