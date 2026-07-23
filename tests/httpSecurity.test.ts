import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { createHmac, randomUUID } from "node:crypto";
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
  jwtSecret: string | undefined;
}

const DEFAULT_JWT_SECRET = "http-security-test-jwt-secret";

function createSignedJwt(
  secret: string,
  header: unknown,
  payload: unknown,
): string {
  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function withSecureServer(
  handler: (context: ServerContext) => Promise<void>,
  options: {
    jwtExpiresIn?: string;
    jwtSecret?: string | null;
    rateLimit?: { maxRequests?: number; windowMs?: number };
    includeAuthRouter?: boolean;
    authRateLimit?: { maxRequests?: number; windowMs?: number };
  } = {}
): Promise<void> {
  const database = new Database(":memory:");
  const logger = new StructuredLogger({ level: "error" });
  const service = new PromptVaultService(database, { logger });
  const apiKey = "test-api-key";
  const jwtSecret =
    options.jwtSecret === null
      ? undefined
      : (options.jwtSecret ?? DEFAULT_JWT_SECRET);
  const authManager = new AuthManager(
    {
      apiKeys: { tester: apiKey },
      requireAuthByDefault: true,
      jwtExpiresIn: options.jwtExpiresIn ?? "1h",
      jwtSecret,
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
    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
        details: {
          requestId: response.locals.requestId,
        },
      },
    });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler({ baseUrl, apiKey, authManager, jwtSecret });
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
      expect(payload.error.code).toBe("UNAUTHORIZED");
      expect(payload.error.message).toContain("Authentication required");
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
      expect(payload.data.prompt.slug).toBeDefined();
      expect(payload.data.prompt.latestVersion.semanticVersion).toBe("1.0.0");
    });
  });

  it("allows a configured API key in the supported Bearer fallback", async () => {
    await withSecureServer(async ({ baseUrl, apiKey }) => {
      const response = await fetch(`${baseUrl}/api/prompts`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });

      expect(response.status).toBe(200);
    });
  });

  it("allows authorized requests via JWT bearer token", async () => {
    await withSecureServer(async ({ baseUrl, authManager }) => {
      const token = authManager.generateToken({
        userId: "user-1",
        username: "jwt-user",
        scopes: ["prompt-vault:write"],
      });

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
      expect(payload.data.prompt.slug).toBeDefined();
      expect(payload.data.prompt.latestVersion.semanticVersion).toBe("1.0.0");
    });
  });

  it("rejects malformed and unsupported Bearer JWTs", async () => {
    await withSecureServer(async ({ baseUrl, jwtSecret }) => {
      const malformed = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer malformed.jwt.value",
        },
        body: JSON.stringify({
          slug: `jwt-malformed-${randomUUID().slice(0, 8)}`,
          title: "Malformed JWT",
          body: "Body",
          semanticVersion: "1.0.0",
        }),
      });
      expect(malformed.status).toBe(401);

      const now = Math.floor(Date.now() / 1000);
      const unsupported = createSignedJwt(
        jwtSecret as string,
        { alg: "HS512", typ: "JWT" },
        {
          userId: "user-2",
          username: "unsupported",
          iat: now,
          exp: now + 3600,
        },
      );
      const unsupportedResponse = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${unsupported}`,
        },
        body: JSON.stringify({
          slug: `jwt-unsupported-${randomUUID().slice(0, 8)}`,
          title: "Unsupported JWT",
          body: "Body",
          semanticVersion: "1.0.0",
        }),
      });
      expect(unsupportedResponse.status).toBe(401);
    });
  });

  it("rejects expired and materially future-issued JWTs", async () => {
    await withSecureServer(async ({ baseUrl, jwtSecret }) => {
      const now = Math.floor(Date.now() / 1000);
      const basePayload = {
        userId: "user-2",
        username: "invalid-time",
        scopes: ["prompt-vault:write"],
      };
      const expired = createSignedJwt(
        jwtSecret as string,
        { alg: "HS256", typ: "JWT" },
        { ...basePayload, iat: now - 600, exp: now - 120 },
      );
      const future = createSignedJwt(
        jwtSecret as string,
        { alg: "HS256", typ: "JWT" },
        { ...basePayload, iat: now + 300, exp: now + 3600 },
      );

      for (const token of [expired, future]) {
        const response = await fetch(`${baseUrl}/api/prompts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            slug: `jwt-time-${randomUUID().slice(0, 8)}`,
            title: "Invalid JWT Time",
            body: "Body",
            semanticVersion: "1.0.0",
          }),
        });

        expect(response.status).toBe(401);
        const payload = await response.json();
        expect(payload.error.code).toBe("UNAUTHORIZED");
      }
    });
  });

  it("continues to enforce required JWT scopes", async () => {
    await withSecureServer(async ({ baseUrl, authManager }) => {
      const token = authManager.generateToken({
        userId: "user-3",
        username: "reader",
        scopes: ["prompt-vault:read"],
      });

      const response = await fetch(`${baseUrl}/api/prompts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          slug: `jwt-scope-${randomUUID().slice(0, 8)}`,
          title: "Scope Required",
          body: "Body",
          semanticVersion: "1.0.0",
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  it("does not accept direct legacy Core DB session tokens", async () => {
    await withSecureServer(async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/prompts`, {
        headers: { authorization: "Bearer legacy-core-db-session-token" },
      });

      expect(response.status).toBe(401);
    });
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
      expect(payload.error.code).toBe("RATE_LIMITED");
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
        expect(typeof payload.data.token).toBe("string");

        const response = await fetch(`${baseUrl}/api/prompts`, {
          headers: {
            authorization: `Bearer ${payload.data.token}`,
          },
        });

        expect(response.status).toBe(200);
      },
      { includeAuthRouter: true, rateLimit: { maxRequests: 10, windowMs: 1000 } }
    );
  });

  it("does not issue JWT without an explicitly configured signing secret", async () => {
    await withSecureServer(
      async ({ baseUrl, apiKey }) => {
        const response = await fetch(`${baseUrl}/auth/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey }),
        });

        expect(response.status).toBe(503);
        const payload = await response.json();
        expect(payload.error.code).toBe("JWT_SIGNING_UNAVAILABLE");
      },
      {
        includeAuthRouter: true,
        jwtSecret: null,
        rateLimit: { maxRequests: 10, windowMs: 1000 },
      }
    );
  });

  it("does not issue JWT for an invalid API key", async () => {
    await withSecureServer(
      async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/auth/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: "invalid-api-key" }),
        });

        expect(response.status).toBe(401);
        const payload = await response.json();
        expect(payload.error.code).toBe("UNAUTHORIZED");
      },
      {
        includeAuthRouter: true,
        rateLimit: { maxRequests: 10, windowMs: 1000 },
      }
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
