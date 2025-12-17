import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  createRateLimitMiddleware,
  InMemoryRateLimitStore,
} from "./rate-limit.js";

type MockResponse = Partial<Response> & {
  locals: Record<string, unknown>;
  headers: Record<string, string | number>;
  statusCode: number;
  status: (code: number) => Response;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string | number) => void;
};

type MockRequest = Partial<Request> & { locals: Record<string, unknown> };

type Next = NextFunction & { calls?: number };

function createMockRes(): MockResponse {
  const headers: Record<string, string | number> = {};
  const res: MockResponse = {
    locals: {},
    headers,
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this as unknown as Response;
    },
    json: vi.fn(),
    setHeader(name: string, value: string | number) {
      headers[name] = value;
      return this as unknown as Response;
    },
  };
  return res;
}

function createMockReq(ip = "127.0.0.1"): MockRequest {
  return {
    ip,
    socket: { remoteAddress: ip } as unknown as Request["socket"],
    locals: {},
  };
}

describe("rate-limit middleware", () => {
  it("allows requests within the window and sets headers", async () => {
    const store = new InMemoryRateLimitStore();
    const middleware = createRateLimitMiddleware({
      maxRequests: 2,
      windowMs: 1000,
      store,
    });

    const req1 = createMockReq();
    const res1 = createMockRes();
    const next1: Next = vi.fn() as Next;

    middleware(req1 as Request, res1 as Response, next1 as NextFunction);

    expect(next1).toHaveBeenCalled();
    expect(res1.headers["X-RateLimit-Limit"]).toBe(2);
    expect(res1.headers["X-RateLimit-Remaining"]).toBe(1);

    const req2 = createMockReq();
    const res2 = createMockRes();
    const next2: Next = vi.fn() as Next;

    middleware(req2 as Request, res2 as Response, next2 as NextFunction);

    expect(next2).toHaveBeenCalled();
    expect(res2.headers["X-RateLimit-Remaining"]).toBe(0);
  });

  it("returns 429 and calls onLimitExceeded when limit is exceeded", async () => {
    const store = new InMemoryRateLimitStore();
    const onLimitExceeded = vi.fn();
    const middleware = createRateLimitMiddleware({
      maxRequests: 1,
      windowMs: 10_000,
      store,
      onLimitExceeded,
    });

    const req = createMockReq();
    const res = createMockRes();
    const next: Next = vi.fn() as Next;

    // first call allowed
    middleware(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);

    // second call hits limit
    const res2 = createMockRes();
    const next2: Next = vi.fn() as Next;
    middleware(req as Request, res2 as Response, next2 as NextFunction);

    expect(next2).not.toHaveBeenCalled();
    expect(res2.headers["Retry-After"]).toBeDefined();
    expect(onLimitExceeded).toHaveBeenCalled();
  });
});
