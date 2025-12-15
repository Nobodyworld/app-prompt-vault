import type { NextFunction, Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  getSecret,
  storeSecret,
  verifyCoreDbApiKey,
  verifyCoreDbSessionToken,
  type CoreDbAuthContext,
} from "../lib/platform-core.js";
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
  scopes?: string[];
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

  public getJwtSecret(): string {
    return this.jwtSecret;
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

  router.post("/token", async (request, response) => {
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

    const localKeyName = authManager.validateApiKey(apiKey);

    let tokenPayload: Omit<AuthPayload, "iat" | "exp"> | null = null;

    if (localKeyName) {
      tokenPayload = {
        userId: `api-key:${localKeyName}`,
        username: localKeyName,
        roles: ["api-key"],
        scopes: ["prompt-vault:*"]
      };
    } else {
      let authCtx: CoreDbAuthContext | null = null;
      try {
        authCtx = await verifyCoreDbApiKey(apiKey, { scopes: ["prompt-vault:token"] });
      } catch (error) {
        logger?.warn("core_db_api_key_verification_failed", {
          message: error instanceof Error ? error.message : String(error)
        });
      }

      if (authCtx) {
        tokenPayload = {
          userId: authCtx.userId,
          username: authCtx.displayName ?? authCtx.userId,
          roles: authCtx.roles,
          scopes: authCtx.scopes,
        };
      }
    }

    if (!tokenPayload) {
      response.status(401).json({
        error: "Unauthorized",
        message: "Invalid API key",
      });
      return;
    }

    // Issue Prompt Vault JWT signed with Prompt Vault secret.
    const ttlSeconds = authManager.getTokenTtlSeconds();
    const token = authManager.generateToken(tokenPayload);

    logger?.info("auth_token_issued", {
      userId: tokenPayload.userId,
      requestId: response.locals.requestId,
    });

    response.status(201).json({
      token,
      tokenType: "Bearer",
      expiresInSeconds: ttlSeconds,
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

  return async (request: Request, response: Response, next: NextFunction) => {
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
    let authMethod: string | undefined;
    let authCtx: CoreDbAuthContext | null = null;

    const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
    const isUnsafeMethod = unsafeMethods.has(request.method.toUpperCase());

    // Treat unsafe/write methods as authenticated-only even when requireAuth=false.
    // Note: route-level requireAuth() runs after this middleware.
    const routeRequiresAuth = requireAuth || isUnsafeMethod;

    const requiredScopes = routeRequiresAuth ? [isUnsafeMethod ? "prompt-vault:write" : "prompt-vault:read"] : [];

    const scopeAllows = (granted: string, required: string): boolean => {
      if (granted === "*" || granted === required) return true;
      if (granted.endsWith("*")) return required.startsWith(granted.slice(0, -1));
      return false;
    };

    const hasAllScopes = (grantedScopes: string[], required: string[]): boolean => {
      if (required.length === 0) return true;
      if (grantedScopes.length === 0) return false;
      return required.every((req) => grantedScopes.some((g) => scopeAllows(g, req)));
    };

    // Try Bearer token (Prompt Vault JWT) first, then Core DB fallbacks.
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);

      const jwtPayload = authManager.verifyToken(token);
      if (jwtPayload) {
        const grantedScopes = jwtPayload.scopes ?? ["prompt-vault:*"];
        if (hasAllScopes(grantedScopes, requiredScopes)) {
          authenticated = true;
          authMethod = "jwt";
          authCtx = {
            kind: "jwt",
            userId: jwtPayload.userId,
            displayName: jwtPayload.username,
            roles: jwtPayload.roles ?? [],
            scopes: grantedScopes,
          };
        }
      }

      if (!authenticated) {
        try {
          authCtx =
            (await verifyCoreDbSessionToken(token, authManager.getJwtSecret(), { scopes: requiredScopes })) ??
            (await verifyCoreDbApiKey(token, { scopes: requiredScopes }));
          if (authCtx) {
            authenticated = true;
            authMethod = authCtx.kind;
          }
        } catch (error) {
          logger?.warn("core_db_bearer_verification_failed", {
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    // Try X-API-Key (local keys first, then Core DB)
    if (!authenticated && apiKeyHeader) {
      const localKeyName = authManager.validateApiKey(apiKeyHeader);
      if (localKeyName) {
        authenticated = true;
        authMethod = "api-key";
        authCtx = {
          kind: "api-key",
          userId: `api-key:${localKeyName}`,
          displayName: localKeyName,
          roles: ["api-key"],
          scopes: ["prompt-vault:*"]
        };
      } else {
        try {
          authCtx = await verifyCoreDbApiKey(apiKeyHeader, { scopes: requiredScopes });
          if (authCtx) {
            authenticated = true;
            authMethod = authCtx.kind;
          }
        } catch (error) {
          logger?.warn("core_db_api_key_header_verification_failed", {
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

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
      response.locals.userId = authCtx?.userId;
      response.locals.username = authCtx?.displayName ?? authCtx?.userId;
      response.locals.userRoles = authCtx?.roles ?? [];
      response.locals.userScopes = authCtx?.scopes ?? [];

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
export function requireAuth(options: { roles?: string[]; scopes?: string[] } = {}) {
  return (request: Request, response: Response, next: NextFunction) => {
    response.locals.requireAuth = true;

    if (!response.locals.authenticated) {
      response.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
      return;
    }

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

    if (options.scopes && options.scopes.length > 0) {
      const userScopes = (response.locals.userScopes as string[]) || [];
      const scopeAllows = (granted: string, required: string): boolean => {
        if (granted === "*" || granted === required) return true;
        if (granted.endsWith("*")) return required.startsWith(granted.slice(0, -1));
        return false;
      };
      const hasAll = options.scopes.every((req) => userScopes.some((g) => scopeAllows(g, req)));
      if (!hasAll) {
        response.status(403).json({
          error: "Forbidden",
          message: `Access denied. Missing required scopes: ${options.scopes.join(", ")}`,
        });
        return;
      }
    }

    next();
  };
}
