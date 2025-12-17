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

export interface MutableLogFields {
  [key: string]: unknown;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly fields?: LogFields;
  readonly includeTraceId?: boolean;
  readonly includeSpanId?: boolean;
  readonly telemetry?: {
    getActiveContext(): { traceId: string; spanId: string } | undefined;
  };
}

function normaliseLevel(level: string | undefined): LogLevel {
  if (!level) {
    return "info";
  }
  const lower = level.toLowerCase();
  if (
    lower === "debug" ||
    lower === "info" ||
    lower === "warn" ||
    lower === "error"
  ) {
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

  private readonly includeTraceId: boolean;

  private readonly includeSpanId: boolean;

  private readonly telemetry?: {
    getActiveContext(): { traceId: string; spanId: string } | undefined;
  };

  public constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.fields = options.fields ?? {};
    this.includeTraceId = options.includeTraceId ?? true;
    this.includeSpanId = options.includeSpanId ?? false;
    this.telemetry = options.telemetry;
  }

  public child(fields: LogFields): StructuredLogger {
    return new StructuredLogger({
      level: this.level,
      fields: { ...this.fields, ...fields },
      includeTraceId: this.includeTraceId,
      includeSpanId: this.includeSpanId,
      telemetry: this.telemetry,
    });
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

    const context = this.telemetry?.getActiveContext();
    const payload: MutableLogFields = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.fields,
      ...extra,
    };

    if (this.includeTraceId && context?.traceId) {
      payload.traceId = context.traceId;
    }

    if (this.includeSpanId && context?.spanId) {
      payload.spanId = context.spanId;
    }

    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      JSON.stringify(payload),
    );
  }
}

export interface LoggerFactoryOptions {
  readonly serviceName: string;
  readonly level?: LogLevel;
  readonly fields?: LogFields;
  readonly includeTraceId?: boolean;
  readonly telemetry?: {
    getActiveContext(): { traceId: string; spanId: string } | undefined;
  };
}

export function createLoggerFromEnv(
  options: LoggerFactoryOptions,
): StructuredLogger {
  const level =
    options.level ?? normaliseLevel(process.env.PROMPT_VAULT_LOG_LEVEL);
  const baseFields: LogFields = {
    service: options.serviceName,
    pid: process.pid,
    trace: randomUUID(),
    ...options.fields,
  };
  return new StructuredLogger({
    level,
    fields: baseFields,
    includeTraceId: true,
    telemetry: options.telemetry,
  });
}
