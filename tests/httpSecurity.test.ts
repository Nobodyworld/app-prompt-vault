import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StructuredLogger } from "../src/observability/logger.js";
import { PromptVaultService } from "../src/services/PromptVaultService.js";
import { createPromptVaultRouter } from "../src/web/createPromptVaultRouter.js";
import { AuthManager, createAuthMiddleware, createAuthRouter } from "../src/web/auth.js";
import { createRateLimitMiddleware, InMemoryRateLimitStore } from "../src/web/rate-limit.js";

interface ServerContext {
  baseUrl: string;
  apiKey: string;
  authManager: AuthManager;
}

async function withSecureServer(
  handler: (context: ServerContext) => Promise<void>,
  options: {
    jwtExpiresIn?: string;
    rateLimit?: { maxRequests?: number; windowMs?: number };
    includeAuthRouter?: boolean;
    authRateLimit?: { maxRequests?: number; windowMs?: number };
  } = {}
): Promise<void> {
  const database = new Database(":memory:");
  const logger = new StructuredLogger({ level: "error" });
  const service = new PromptVaultService(database, { logger });
  const apiKey = "test-api-key";
  const authManager = new AuthManager(
    {
      apiKeys: { tester: apiKey },
      requireAuthByDefault: true,
      jwtExpiresIn: options.jwtExpiresIn ?? "1h",
    },
    logger
  );
  await authManager.initialize();

  const rateLimitStore = new InMemoryRateLimitStore(5000);
  const maxRequests = options.rateLimit?.maxRequests ?? 2;
  const windowMs = options.rateLimit?.windowMs ?? 1000;

  const app = express();
  app.disable("x-powered-by");

  app.use((request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  });

  app.use(express.json());

  if (options.includeAuthRouter) {
    app.use(
      "/auth",
      createAuthRouter({
        authManager,
        logger,
        rateLimit: {
          maxRequests: options.authRateLimit?.maxRequests ?? 10,
          windowMs: options.authRateLimit?.windowMs ?? 60_000,
        },
      })
    );
  }

  app.use(
    createAuthMiddleware({
      authManager,
      requireAuth: true,
      logger,
    })
  );

  app.use(
    createRateLimitMiddleware({
      maxRequests,
      windowMs,
      store: rateLimitStore,
      logger,
    })
  );

  app.use(
    "/api",
    createPromptVaultRouter(service, logger, {
      telemetry: undefined,
    })
  );

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response
      .status(500)
      .json({ error: error instanceof Error ? error.message : String(error), requestId: response.locals.requestId });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler({ baseUrl, apiKey, authManager });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rateLimitStore.destroy();
    database.close();
  }
}

describe("HTTP security middleware", () => {
  it("rejects unauthenticated requests when auth is required", async () => {
    await withSecureServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: `auth-${randomUUID().slice(0, 8)}`,
          title: "Auth Required",
          body: "Body",
          semanticVersion: "1.0.0",
        }),
      });

      expect(response.status).toBe(401);
      const payload = await response.json();
      expect(payload.error).toBe("Unauthorized");
      expect(payload.message).toContain("Authentication required");
    });
  });

  it("allows authorized requests via API key", async () => {
    await withSecureServer(async ({ baseUrl, apiKey }) => {
      const response = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          slug: `auth-ok-${randomUUID().slice(0, 8)}`,
          title: "Authorized",
          body: "Body",
          semanticVersion: "1.0.0",
        }),
      });

      expect(response.status).toBe(201);
      const payload = await response.json();
      expect(payload.prompt.slug).toBeDefined();
      expect(payload.prompt.latestVersion.semanticVersion).toBe("1.0.0");
    });
  });

  it("allows authorized requests via JWT bearer token", async () => {
    await withSecureServer(async ({ baseUrl, authManager }) => {
      const token = authManager.generateToken({ userId: "user-1", username: "jwt-user" });

      const response = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          slug: `jwt-ok-${randomUUID().slice(0, 8)}`,
          title: "JWT Authorized",
          body: "Body",
          semanticVersion: "1.0.0",
        }),
      });

      expect(response.status).toBe(201);
      const payload = await response.json();
      expect(payload.prompt.slug).toBeDefined();
      expect(payload.prompt.latestVersion.semanticVersion).toBe("1.0.0");
    });
  });

  it("rejects expired JWT tokens", async () => {
    await withSecureServer(
      async ({ baseUrl, authManager }) => {
        const token = authManager.generateToken({ userId: "user-2", username: "expired" });

        await new Promise((resolve) => setTimeout(resolve, 2100));

        const response = await fetch(`${baseUrl}/api/prompts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            slug: `jwt-expired-${randomUUID().slice(0, 8)}`,
            title: "JWT Expired",
            body: "Body",
            semanticVersion: "1.0.0",
          }),
        });

        expect(response.status).toBe(401);
        const payload = await response.json();
        expect(payload.error).toBe("Unauthorized");
      },
      { jwtExpiresIn: "1s" }
    );
  });

  it("enforces rate limits and returns 429", async () => {
    await withSecureServer(async ({ baseUrl, apiKey }) => {
      const headers = { "x-api-key": apiKey };

      const first = await fetch(`${baseUrl}/api/prompts`, { headers });
      expect(first.status).toBe(200);

      const second = await fetch(`${baseUrl}/api/prompts`, { headers });
      expect(second.status).toBe(200);

      const third = await fetch(`${baseUrl}/api/prompts`, { headers });
      expect(third.status).toBe(429);
      const payload = await third.json();
      expect(payload.error).toBe("Too Many Requests");
      expect(third.headers.get("retry-after")).toBeTruthy();
    });
  });

  it("issues JWT via /auth/token when API key is valid", async () => {
    await withSecureServer(
      async ({ baseUrl, apiKey }) => {
        const tokenResponse = await fetch(`${baseUrl}/auth/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey }),
        });

        expect(tokenResponse.status).toBe(201);
        const payload = await tokenResponse.json();
        expect(typeof payload.token).toBe("string");

        const response = await fetch(`${baseUrl}/api/prompts`, {
          headers: {
            authorization: `Bearer ${payload.token}`,
          },
        });

        expect(response.status).toBe(200);
      },
      { includeAuthRouter: true, rateLimit: { maxRequests: 10, windowMs: 1000 } }
    );
  });

  it("rate limits token issuance", async () => {
    await withSecureServer(
      async ({ baseUrl, apiKey }) => {
        const first = await fetch(`${baseUrl}/auth/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey }),
        });

        expect(first.status).toBe(201);

        const second = await fetch(`${baseUrl}/auth/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey }),
        });

        expect(second.status).toBe(429);
      },
      {
        includeAuthRouter: true,
        rateLimit: { maxRequests: 10, windowMs: 1000 },
        authRateLimit: { maxRequests: 1, windowMs: 1000 },
      }
    );
  });
});
