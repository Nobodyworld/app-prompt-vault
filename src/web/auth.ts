import type { NextFunction, Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { getSecret, storeSecret } from "@nw/secrets";
import type { StructuredLogger } from "../observability/logger.js";
import { createEndpointRateLimiter } from "./rate-limit.js";

export interface AuthConfig {
  /**
   * JWT expiration time (e.g., "1h", "7d", "30d").
   * Default: "24h"
   */
  jwtExpiresIn?: string;

  /**
   * Optional JWT secret. When provided, it is used instead of reading from @nw/secrets.
   * Useful for environments that inject secrets via env vars or orchestration tools.
   */
  jwtSecret?: string;

  /**
   * Whether to require authentication for all routes.
   * If false, only routes marked with requireAuth will need authentication.
   * Default: false
   */
  requireAuthByDefault?: boolean;

  /**
   * List of allowed origins for CORS. If empty, allows all origins.
   * Use specific origins for production (e.g., ["https://app.example.com"]).
   */
  allowedOrigins?: string[];

  /**
   * Whether to restrict API access to localhost only.
   * When true, rejects requests from non-local IP addresses.
   * Default: false
   */
  localhostOnly?: boolean;

  /**
   * API keys for simple token-based authentication (alternative to JWT).
   * Format: { "key-name": "api-key-value" }
   */
  apiKeys?: Record<string, string>;
}

export interface AuthPayload {
  userId: string;
  username: string;
  roles?: string[];
  iat?: number;
  exp?: number;
}

/**
 * Authentication manager for JWT-based auth and API key validation.
 */
export class AuthManager {
  private jwtSecret!: string;
  private readonly jwtExpiresIn: string;
  private readonly apiKeys: Map<string, string>;
  private readonly tokenTtlSeconds: number;
  private readonly logger?: StructuredLogger;
  private readonly providedSecret?: string;

  public constructor(config: AuthConfig, logger?: StructuredLogger) {
    this.jwtExpiresIn = config.jwtExpiresIn || "24h";
    this.apiKeys = new Map(Object.entries(config.apiKeys || {}));
    this.logger = logger;
    this.tokenTtlSeconds = this.parseExpiresIn(this.jwtExpiresIn);
    this.providedSecret = config.jwtSecret?.trim();
  }

  /**
   * Initialize the JWT secret from @nw/secrets or generate a random one.
   * Should be called after construction and before using JWT functionality.
   */
  public async initialize(): Promise<void> {
    const secretRef = "prompt-vault:jwt-secret";

    if (this.providedSecret) {
      this.jwtSecret = this.providedSecret;
      this.logger?.info("auth_secret_provided", { secretRef });
      return;
    }

    // Try to get existing secret
    const existingSecret = await getSecret(secretRef);
    if (existingSecret) {
      this.jwtSecret = existingSecret;
      this.logger?.info("auth_secret_loaded", { secretRef });
    } else {
      // Generate and store new secret
      const newSecret = randomBytes(64).toString("hex");
      await storeSecret(secretRef, newSecret);
      this.jwtSecret = newSecret;
      this.logger?.info("auth_secret_generated", { secretRef });
    }
  }

  /**
   * Generate a JWT token for a user (simple HMAC-based implementation).
   */
  public generateToken(payload: Omit<AuthPayload, "iat" | "exp">): string {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.tokenTtlSeconds;

    const fullPayload: AuthPayload = {
      ...payload,
      iat,
      exp,
    };

    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(fullPayload));
    const signature = this.sign(`${encodedHeader}.${encodedPayload}`);

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Verify and decode a JWT token (simple HMAC-based implementation).
   */
  public verifyToken(token: string): AuthPayload | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return null;
      }

      const [encodedHeader, encodedPayload, signature] = parts;
      const expectedSignature = this.sign(`${encodedHeader}.${encodedPayload}`);

      // Verify signature
      if (signature !== expectedSignature) {
        this.logger?.debug("token_signature_invalid");
        return null;
      }

      // Decode payload
      const payload = JSON.parse(this.base64UrlDecode(encodedPayload)) as AuthPayload;

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        this.logger?.debug("token_expired", { exp: payload.exp, now });
        return null;
      }

      return payload;
    } catch (error) {
      this.logger?.debug("token_verification_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  public getTokenTtlSeconds(): number {
    return this.tokenTtlSeconds;
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 86400; // Default 1 day
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 3600;
      case "d":
        return value * 86400;
      default:
        return 86400;
    }
  }

  private sign(data: string): string {
    const hmac = createHmac("sha256", this.jwtSecret);
    hmac.update(data);
    return this.base64UrlEncode(hmac.digest());
  }

  private base64UrlEncode(data: string | Buffer): string {
    const base64 = Buffer.from(data).toString("base64");
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  private base64UrlDecode(data: string): string {
    let base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    while (base64.length % 4) {
      base64 += "=";
    }
    return Buffer.from(base64, "base64").toString("utf8");
  }

  /**
   * Validate an API key.
   */
  public validateApiKey(key: string): string | null {
    for (const [name, value] of this.apiKeys) {
      if (value === key) {
        return name;
      }
    }
    return null;
  }
}

const tokenRequestSchema = z.object({
  apiKey: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  roles: z.array(z.string().min(1)).max(10).optional(),
});

export function createAuthRouter(options: {
  authManager: AuthManager;
  logger?: StructuredLogger;
  rateLimit?: {
    maxRequests?: number;
    windowMs?: number;
  };
}): Router {
  const router = createRouter();
  const { authManager, logger } = options;
  const rateLimit = {
    maxRequests: options.rateLimit?.maxRequests ?? 10,
    windowMs: options.rateLimit?.windowMs ?? 60_000,
  };

  router.use(
    createEndpointRateLimiter({
      maxRequests: rateLimit.maxRequests,
      windowMs: rateLimit.windowMs,
      logger,
    })
  );

  router.post("/token", (request, response) => {
    const parsed = tokenRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      response.status(400).json({
        error: "Request validation failed",
        details: parsed.error.issues.map((issue) => issue.message),
      });
      return;
    }

    const apiKeyFromHeader = request.header("x-api-key");
    const apiKey = parsed.data.apiKey ?? apiKeyFromHeader;

    if (!apiKey) {
      response.status(401).json({
        error: "Unauthorized",
        message: "API key is required to obtain a token",
      });
      return;
    }

    const keyName = authManager.validateApiKey(apiKey);

    if (!keyName) {
      response.status(401).json({
        error: "Unauthorized",
        message: "Invalid API key",
      });
      return;
    }

    const token = authManager.generateToken({
      userId: parsed.data.userId ?? keyName,
      username: parsed.data.username ?? keyName,
      roles: parsed.data.roles ?? ["api"],
    });

    logger?.info("auth_token_issued", {
      userId: parsed.data.userId ?? keyName,
      requestId: response.locals.requestId,
    });

    response.status(201).json({
      token,
      tokenType: "Bearer",
      expiresInSeconds: authManager.getTokenTtlSeconds(),
    });
  });

  return router;
}

/**
 * Express middleware for JWT authentication.
 *
 * Supports multiple authentication methods:
 * 1. Bearer token in Authorization header
 * 2. API key in X-API-Key header
 *
 * Usage:
 * ```typescript
 * const authManager = new AuthManager({ jwtSecret: process.env.JWT_SECRET });
 * app.use("/api", createAuthMiddleware({ authManager, requireAuth: true }));
 * ```
 */
export function createAuthMiddleware(options: {
  authManager: AuthManager;
  requireAuth?: boolean;
  localhostOnly?: boolean;
  logger?: StructuredLogger;
}) {
  const { authManager, requireAuth = false, localhostOnly = false, logger } = options;

  return (request: Request, response: Response, next: NextFunction) => {
    // Check localhost-only restriction
    if (localhostOnly) {
      const remoteAddr = request.socket.remoteAddress || request.ip;
      const isLocalhost =
        remoteAddr === "::1" ||
        remoteAddr === "::ffff:127.0.0.1" ||
        remoteAddr === "127.0.0.1" ||
        remoteAddr === "localhost";

      if (!isLocalhost) {
        logger?.warn("non_localhost_access_denied", {
          remoteAddr,
          path: request.path,
          requestId: response.locals.requestId,
        });

        response.status(403).json({
          error: "Forbidden",
          message: "API access is restricted to localhost only",
        });
        return;
      }
    }

    // Extract authentication credentials
    const authHeader = request.header("authorization");
    const apiKeyHeader = request.header("x-api-key");

    let authenticated = false;
    let authPayload: AuthPayload | null = null;
    let authMethod: string | undefined;

    // Try JWT Bearer token
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      authPayload = authManager.verifyToken(token);

      if (authPayload) {
        authenticated = true;
        authMethod = "jwt";
        response.locals.userId = authPayload.userId;
        response.locals.username = authPayload.username;
        response.locals.userRoles = authPayload.roles || [];
      }
    }

    // Try API key
    if (!authenticated && apiKeyHeader) {
      const keyName = authManager.validateApiKey(apiKeyHeader);

      if (keyName) {
        authenticated = true;
        authMethod = "api-key";
        response.locals.userId = keyName;
        response.locals.username = keyName;
        response.locals.userRoles = ["api"];
      }
    }

    // Enforce API key for unsafe/write HTTP methods even when requireAuth is false.
    const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
    if (unsafeMethods.has(request.method.toUpperCase())) {
      // If the request was not authenticated via API key, reject.
      const apiKeyHeaderPresent = !!apiKeyHeader;
      const apiKeyValid = apiKeyHeaderPresent && authManager.validateApiKey(apiKeyHeader || "") !== null;
      if (!apiKeyValid) {
        logger?.warn("unsafe_method_requires_api_key", {
          method: request.method,
          path: request.path,
          requestId: response.locals.requestId,
        });

        response.status(401).json({
          error: "Unauthorized",
          message: "Unsafe HTTP methods require a valid API key in the X-API-Key header",
        });
        return;
      }
      // mark authenticated by api-key
      authenticated = true;
      authMethod = "api-key";
    }

    // Check if authentication is required
    const routeRequiresAuth = requireAuth || response.locals.requireAuth;

    if (routeRequiresAuth && !authenticated) {
      logger?.warn("authentication_required", {
        path: request.path,
        requestId: response.locals.requestId,
        hasAuthHeader: !!authHeader,
        hasApiKeyHeader: !!apiKeyHeader,
      });

      response.status(401).json({
        error: "Unauthorized",
        message: "Authentication required. Provide a valid Bearer token or X-API-Key header.",
      });
      return;
    }

    if (authenticated) {
      response.locals.authenticated = true;
      response.locals.authMethod = authMethod;

      logger?.debug("request_authenticated", {
        userId: response.locals.userId,
        authMethod,
        path: request.path,
        requestId: response.locals.requestId,
      });
    }

    next();
  };
}

/**
 * Middleware to mark specific routes as requiring authentication.
 *
 * Usage:
 * ```typescript
 * router.post("/prompts", requireAuth(), handler);
 * router.delete("/prompts/:id", requireAuth({ roles: ["admin"] }), handler);
 * ```
 */
export function requireAuth(options: { roles?: string[] } = {}) {
  return (request: Request, response: Response, next: NextFunction) => {
    response.locals.requireAuth = true;

    // Check role requirements
    if (options.roles && options.roles.length > 0) {
      const userRoles = (response.locals.userRoles as string[]) || [];
      const hasRequiredRole = options.roles.some((role) => userRoles.includes(role));

      if (!hasRequiredRole) {
        response.status(403).json({
          error: "Forbidden",
          message: `Access denied. Required roles: ${options.roles.join(", ")}`,
        });
        return;
      }
    }

    next();
  };
}
