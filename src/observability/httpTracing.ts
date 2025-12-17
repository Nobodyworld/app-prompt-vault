import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { StructuredLogger } from "./logger.js";
import type { Telemetry } from "./telemetry.js";

interface HttpTracingOptions {
  readonly telemetry: Telemetry;
  readonly logger: StructuredLogger;
}

function resolveRoute(request: Request): string {
  const routePath = (request.route?.path as string | undefined) ?? "";
  const baseUrl = request.baseUrl ?? "";
  const merged = `${baseUrl}${routePath}`;
  if (!merged || merged === "//") {
    return request.path || request.originalUrl || "unknown";
  }
  const segments = merged.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return "/";
  }
  return `/${segments.join("/")}`;
}

export function createHttpTracingMiddleware(
  options: HttpTracingOptions,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const route = resolveRoute(request);
    options.telemetry
      .withSpan(
        "http.server.request",
        {
          method: request.method,
          route,
        },
        () =>
          new Promise<void>((resolve, reject) => {
            const context = options.telemetry.getActiveContext();
            if (context) {
              response.locals.traceId = context.traceId;
            }

            let finished = false;
            const cleanup = (): void => {
              if (finished) {
                return;
              }
              finished = true;
              response.removeListener("finish", onFinish);
              response.removeListener("close", onFinish);
              response.removeListener("error", onError);
            };

            const onFinish = (): void => {
              cleanup();
              resolve();
            };

            const onError = (error?: unknown): void => {
              cleanup();
              if (error instanceof Error) {
                reject(error);
              } else if (error !== undefined) {
                reject(new Error(String(error)));
              } else {
                resolve();
              }
            };

            response.once("finish", onFinish);
            response.once("close", onFinish);
            response.once("error", onError);

            try {
              next();
            } catch (error) {
              onError(error);
            }
          }),
      )
      .catch((error: unknown) => {
        options.logger.error("http_tracing_failed", {
          error: error instanceof Error ? error.message : error,
          method: request.method,
          route,
        });
        next(error instanceof Error ? error : new Error(String(error)));
      });
  };
}
