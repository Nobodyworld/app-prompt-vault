import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createAuditMiddleware, InMemoryAuditLogger } from "./audit.js";

type MockRes = Partial<Response> & {
    locals: Record<string, unknown>;
    headers: Record<string, string | number>;
    statusCode: number;
    end: Response["end"];
    setHeader: (name: string, value: string | number) => Response;
};

type MockReq = Partial<Request> & { locals: Record<string, unknown> };

function makeRes(): MockRes {
    const headers: Record<string, string | number> = {};
    const res: MockRes = {
        locals: {},
        headers,
        statusCode: 200,
        end: function () {
            return this as unknown as Response;
        },
        setHeader(name: string, value: string | number) {
            headers[name] = value;
            return this as unknown as Response;
        },
    };
    return res;
}

function makeReq(method: string, path: string): MockReq {
    return {
        method,
        path,
        locals: {},
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" } as unknown as Request["socket"],
        get: vi.fn((name: string) => {
            if (name === "set-cookie") {
                return undefined;
            }
            return "test-agent";
        }) as unknown as Request["get"],
    };
}

describe("audit middleware", () => {
    it("logs audit entry when metadata is set", async () => {
        const auditLogger = new InMemoryAuditLogger();
        const logSpy = vi.spyOn(auditLogger, "log");
        const middleware = createAuditMiddleware({ auditLogger });

        const req = makeReq("POST", "/prompts");
        const res = makeRes();
        res.locals.auditAction = "create_prompt";
        res.locals.auditResource = "prompts";
        res.locals.requestId = "req-1";
        res.locals.traceId = "trace-1";
        res.locals.userId = "user-1";

        const next: NextFunction = vi.fn();

        middleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalled();

        // simulate end of response to trigger logging
        res.end();

        expect(logSpy).toHaveBeenCalledTimes(1);
        const entry = logSpy.mock.calls[0][0];
        expect(entry.action).toBe("create_prompt");
        expect(entry.resource).toBe("prompts");
        expect(entry.result).toBe("success");
    });

    it("skips non-sensitive GET requests", async () => {
        const auditLogger = new InMemoryAuditLogger();
        const logSpy = vi.spyOn(auditLogger, "log");
        const middleware = createAuditMiddleware({ auditLogger });

        const req = makeReq("GET", "/healthz");
        const res = makeRes();
        const next: NextFunction = vi.fn();

        middleware(req as Request, res as Response, next);
        res.end();

        expect(next).toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
    });
});
