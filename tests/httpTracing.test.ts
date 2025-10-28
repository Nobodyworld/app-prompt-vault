import { EventEmitter } from "node:events";
import type { Request, Response, NextFunction } from "express";
import { describe, expect, it, vi } from "vitest";
import { createHttpTracingMiddleware } from "../src/observability/httpTracing.js";
import { MetricRegistry } from "../src/observability/telemetry.js";
import type { Telemetry, TelemetrySpanAttributes, TelemetrySpanContext } from "../src/observability/telemetry.js";
import type { StructuredLogger } from "../src/observability/logger.js";

class FakeResponse extends EventEmitter {
  public locals: Record<string, unknown> = {};
  public statusCode = 200;
}

class FakeTelemetry implements Telemetry {
  public readonly registry = new MetricRegistry();
  public spans: Array<{ name: string; attributes: TelemetrySpanAttributes }> = [];
  private context?: TelemetrySpanContext;

  public withSpan<T>(name: string, attributes: TelemetrySpanAttributes, fn: () => T): T;
  public withSpan<T>(name: string, attributes: TelemetrySpanAttributes, fn: () => Promise<T>): Promise<T>;
  public withSpan<T>(
    name: string,
    attributes: TelemetrySpanAttributes,
    fn: () => T | Promise<T>
  ): T | Promise<T> {
    this.context = {
      traceId: "trace-test",
      spanId: "span-test",
      name,
      startTime: Date.now(),
      attributes,
    };
    this.spans.push({ name, attributes });
    const clear = (): void => {
      this.context = undefined;
    };
    try {
      const result = fn();
      if (result && typeof (result as Promise<T>).then === "function") {
        return (result as Promise<T>).finally(clear);
      }
      clear();
      return result as T;
    } catch (error) {
      clear();
      throw error;
    }
  }

  public recordEvent(_name: string, _attributes: TelemetrySpanAttributes = {}): void {}

  public getActiveContext(): TelemetrySpanContext | undefined {
    return this.context;
  }
}

function createLogger(): StructuredLogger {
  const base = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as StructuredLogger;
  base.child = vi.fn(() => base);
  return base;
}

describe("createHttpTracingMiddleware", () => {
  it("records spans and decorates responses with trace identifiers", async () => {
    const telemetry = new FakeTelemetry();
    const logger = createLogger();
    const middleware = createHttpTracingMiddleware({ telemetry, logger });

    const request = {
      method: "GET",
      path: "/observability",
      originalUrl: "/observability",
      baseUrl: "",
      route: { path: "/observability" },
    } as unknown as Request;
    const response = new FakeResponse() as unknown as Response;
    const next: NextFunction = vi.fn(() => {
      process.nextTick(() => {
        (response as unknown as FakeResponse).emit("finish");
      });
    });

    middleware(request, response, next);

    await new Promise<void>((resolve) => {
      (response as unknown as FakeResponse).once("finish", () => resolve());
    });

    expect(response.locals.traceId).toBe("trace-test");
    expect(telemetry.spans).toHaveLength(1);
    expect(telemetry.spans[0]).toEqual({
      name: "http.server.request",
      attributes: { method: "GET", route: "/observability" },
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
