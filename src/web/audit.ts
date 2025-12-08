import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { StructuredLogger } from "../observability/logger.js";

export interface AuditEvent {
    id: string;
    timestamp: string;
    userId?: string;
    requestId?: string;
    traceId?: string;
    action: string;
    resource: string;
    result: "success" | "failure" | "denied";
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
}

export interface AuditLogger {
    log(event: Omit<AuditEvent, "id" | "timestamp">): void;
    getEvents(filters?: AuditEventFilters): readonly AuditEvent[];
}

export interface AuditEventFilters {
    userId?: string;
    action?: string;
    resource?: string;
    result?: "success" | "failure" | "denied";
    startDate?: Date;
    endDate?: Date;
    limit?: number;
}

/**
 * In-memory audit logger with optional persistent storage.
 * For production, integrate with a dedicated audit log storage (database, log aggregator, etc.)
 */
export class InMemoryAuditLogger implements AuditLogger {
    private events: AuditEvent[] = [];
    private readonly maxEvents: number;
    private readonly logger?: StructuredLogger;

    public constructor(options: { maxEvents?: number; logger?: StructuredLogger } = {}) {
        this.maxEvents = options.maxEvents ?? 10_000;
        this.logger = options.logger;
    }

    public log(event: Omit<AuditEvent, "id" | "timestamp">): void {
        const auditEvent: AuditEvent = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            ...event,
        };

        // Keep memory bounded
        if (this.events.length >= this.maxEvents) {
            this.events.shift();
        }

        this.events.push(auditEvent);

        // Also log to structured logger for integration with observability systems
        if (this.logger) {
            this.logger.info("audit_event", {
                auditId: auditEvent.id,
                userId: auditEvent.userId,
                action: auditEvent.action,
                resource: auditEvent.resource,
                result: auditEvent.result,
                details: auditEvent.details,
            });
        }
    }

    public getEvents(filters?: AuditEventFilters): readonly AuditEvent[] {
        let filtered = [...this.events];

        if (filters) {
            if (filters.userId) {
                filtered = filtered.filter((e) => e.userId === filters.userId);
            }
            if (filters.action) {
                filtered = filtered.filter((e) => e.action === filters.action);
            }
            if (filters.resource) {
                filtered = filtered.filter((e) => e.resource === filters.resource);
            }
            if (filters.result) {
                filtered = filtered.filter((e) => e.result === filters.result);
            }
            if (filters.startDate) {
                filtered = filtered.filter((e) => new Date(e.timestamp) >= filters.startDate!);
            }
            if (filters.endDate) {
                filtered = filtered.filter((e) => new Date(e.timestamp) <= filters.endDate!);
            }
            if (filters.limit) {
                filtered = filtered.slice(-filters.limit);
            }
        }

        return filtered;
    }
}

/**
 * Express middleware to log sensitive operations to the audit trail.
 *
 * Usage:
 * ```typescript
 * const auditLogger = new InMemoryAuditLogger({ logger });
 * app.use(createAuditMiddleware({ auditLogger, logger }));
 *
 * // In route handlers, attach audit metadata:
 * router.post("/prompts", (req, res, next) => {
 *   res.locals.auditAction = "create_prompt";
 *   res.locals.auditResource = "prompts";
 *   // ... handler logic
 * });
 * ```
 */
export function createAuditMiddleware(options: { auditLogger: AuditLogger; logger?: StructuredLogger }) {
    const { auditLogger, logger } = options;

    return (request: Request, response: Response, next: NextFunction) => {
        // Skip non-sensitive operations (GET requests to read-only endpoints)
        const isSensitive =
            request.method !== "GET" ||
            request.path.includes("/secrets") ||
            request.path.includes("/credentials") ||
            request.path.includes("/config");

        if (!isSensitive) {
            return next();
        }

        // Capture original end function
        const originalEnd = response.end;

        // Wrap response.end to log after response is sent
        response.end = function (this: Response, ...args: any[]): Response {
            // Restore original end
            response.end = originalEnd;

            // Log audit event if metadata was attached
            const action = response.locals.auditAction as string | undefined;
            const resource = response.locals.auditResource as string | undefined;

            if (action && resource) {
                const result: "success" | "failure" | "denied" =
                    response.statusCode >= 200 && response.statusCode < 300
                        ? "success"
                        : response.statusCode === 401 || response.statusCode === 403
                            ? "denied"
                            : "failure";

                auditLogger.log({
                    userId: response.locals.userId,
                    requestId: response.locals.requestId,
                    traceId: response.locals.traceId,
                    action,
                    resource,
                    result,
                    details: {
                        method: request.method,
                        path: request.path,
                        statusCode: response.statusCode,
                        ...(response.locals.auditDetails || {}),
                    },
                    ipAddress: request.ip || request.socket.remoteAddress,
                    userAgent: request.get("user-agent"),
                });
            }

            // Call original end
            return originalEnd.apply(this, args);
        };

        next();
    };
}

/**
 * Middleware to automatically audit sensitive route patterns.
 * Attaches audit metadata based on route and method.
 */
export function createAutoAuditMiddleware() {
    return (request: Request, response: Response, next: NextFunction) => {
        const { method, path } = request;

        // Map routes to audit actions
        if (method === "POST" && path.includes("/prompts")) {
            response.locals.auditAction = "create_prompt";
            response.locals.auditResource = "prompts";
        } else if (method === "PUT" && path.includes("/prompts")) {
            response.locals.auditAction = "update_prompt";
            response.locals.auditResource = "prompts";
        } else if (method === "DELETE" && path.includes("/prompts")) {
            response.locals.auditAction = "delete_prompt";
            response.locals.auditResource = "prompts";
        } else if (path.includes("/secrets") || path.includes("/credentials")) {
            response.locals.auditAction = `${method.toLowerCase()}_secret`;
            response.locals.auditResource = "secrets";
        } else if (path.includes("/config")) {
            response.locals.auditAction = `${method.toLowerCase()}_config`;
            response.locals.auditResource = "configuration";
        } else if (path.includes("/tools") && method === "POST") {
            response.locals.auditAction = "execute_tool";
            response.locals.auditResource = "orchestrator";
            response.locals.auditDetails = { toolName: request.body?.tool };
        }

        next();
    };
}
