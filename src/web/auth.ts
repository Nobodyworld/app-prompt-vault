import type { NextFunction, Request, Response } from "express";
import { createHmac, randomBytes } from "node:crypto";
import type { StructuredLogger } from "../observability/logger.js";

export interface AuthConfig {
  /**
   * JWT secret key. Should be set via environment variable in production.
   * If not provided, a random key will be generated (not suitable for multi-instance deployments).
   */
  jwtSecret?: string;

  /**
   * JWT expiration time (e.g., "1h", "7d", "30d").
   * Default: "24h"
   */
  jwtExpiresIn?: string;

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
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly apiKeys: Map<string, string>;
  private readonly logger?: StructuredLogger;

  public constructor(config: AuthConfig, logger?: StructuredLogger) {
    // Generate random secret if not provided (NOT suitable for production multi-instance)
    this.jwtSecret = config.jwtSecret || randomBytes(64).toString("hex");
    this.jwtExpiresIn = config.jwtExpiresIn || "24h";
    this.apiKeys = new Map(Object.entries(config.apiKeys || {}));
    this.logger = logger;

    if (!config.jwtSecret) {
      this.logger?.warn("auth_no_secret", {
        message: "JWT secret not configured. Generated a random secret. This will not work across multiple instances.",
      });
    }
  }

  /**
   * Generate a JWT token for a user (simple HMAC-based implementation).
   */
  public generateToken(payload: Omit<AuthPayload, "iat" | "exp">): string {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.parseExpiresIn(this.jwtExpiresIn);

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
