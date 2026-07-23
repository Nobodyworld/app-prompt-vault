import type { NextFunction, Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  verifyCoreDbApiKey,
  type CoreDbAuthContext,
} from "../lib/platform-core.js";
import type { StructuredLogger } from "../observability/logger.js";
import { createEndpointRateLimiter } from "./rate-limit.js";

const JWT_CLOCK_SKEW_SECONDS = 60;
const JWT_TEXT_MAX_LENGTH = 200;
const JWT_ROLE_OR_SCOPE_MAX_LENGTH = 100;
const JWT_ROLES_MAX_LENGTH = 10;
const JWT_SCOPES_MAX_LENGTH = 20;
const BASE64URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const jwtHeaderSchema = z
  .object({
    alg: z.literal("HS256"),
    typ: z.literal("JWT"),
  })
  .strict();

const jwtPayloadSchema = z
  .object({
    userId: z.string().min(1).max(JWT_TEXT_MAX_LENGTH),
    username: z.string().min(1).max(JWT_TEXT_MAX_LENGTH),
    roles: z
      .array(z.string().min(1).max(JWT_ROLE_OR_SCOPE_MAX_LENGTH))
      .max(JWT_ROLES_MAX_LENGTH)
      .optional(),
    scopes: z
      .array(z.string().min(1).max(JWT_ROLE_OR_SCOPE_MAX_LENGTH))
      .max(JWT_SCOPES_MAX_LENGTH)
      .optional(),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
  })
  .strict();
const jwtTokenInputSchema = jwtPayloadSchema.omit({ iat: true, exp: true });

function getErrorDetails(response: Response): { requestId?: string; traceId?: string } {
  const requestId =
    typeof response.locals.requestId === "string"
      ? (response.locals.requestId as string)
      : undefined;
  const traceId =
    typeof response.locals.traceId === "string"
      ? (response.locals.traceId as string)
      : undefined;
  return { requestId, traceId };
}

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
  iat: number;
  exp: number;
}

export class JwtSigningUnavailableError extends Error {
  public constructor() {
    super(
      "JWT signing is unavailable because no Prompt Vault JWT secret is configured",
    );
    this.name = "JwtSigningUnavailableError";
  }
}

/**
 * Authentication manager for JWT-based auth and API key validation.
 */
export class AuthManager {
  private jwtSecret: string | null = null;
  private readonly jwtExpiresIn: string;
  private readonly apiKeys: Map<string, Buffer>;
  private readonly tokenTtlSeconds: number;
  private readonly logger?: StructuredLogger;
  private readonly providedSecret?: string;

  public constructor(config: AuthConfig, logger?: StructuredLogger) {
    this.jwtExpiresIn = config.jwtExpiresIn || "24h";
    this.apiKeys = new Map(
      Object.entries(config.apiKeys || {})
        .filter(([, value]) => value.length > 0)
        .map(([name, value]) => [name, this.hashApiKey(value)]),
    );
    this.logger = logger;
    this.tokenTtlSeconds = this.parseExpiresIn(this.jwtExpiresIn);
    this.providedSecret = config.jwtSecret?.trim();
  }

  /**
   * Initialize JWT signing from an explicitly provided secret.
   *
   * Missing configuration intentionally leaves JWT verification and issuance
   * unavailable. Prompt Vault does not create a process-local signing authority.
   * Should be called after construction and before using JWT functionality.
   */
  public async initialize(): Promise<void> {
    const secretRef = "prompt-vault:jwt-secret";

    if (this.providedSecret) {
      this.jwtSecret = this.providedSecret;
      this.logger?.info("auth_secret_provided", { secretRef });
      return;
    }

    this.jwtSecret = null;
    this.logger?.warn("auth_secret_unavailable", {
      secretRef,
      jwtIssuanceEnabled: false,
    });
  }

  /**
   * Generate a JWT token for a user (simple HMAC-based implementation).
   */
  public generateToken(payload: Omit<AuthPayload, "iat" | "exp">): string {
    const jwtSecret = this.requireJwtSecret();
    const supportedPayload = jwtTokenInputSchema.parse(payload);
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.tokenTtlSeconds;

    const fullPayload: AuthPayload = {
      ...supportedPayload,
      iat,
      exp,
    };

    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(fullPayload));
    const signature = this.sign(
      `${encodedHeader}.${encodedPayload}`,
      jwtSecret,
    ).toString("base64url");

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Verify and decode a JWT token (simple HMAC-based implementation).
   */
  public verifyToken(token: string): AuthPayload | null {
    if (!this.jwtSecret) {
      return null;
    }

    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return null;
      }

      const [encodedHeader, encodedPayload, signature] = parts;
      const presentedSignature = this.strictBase64UrlDecode(signature);
      const expectedSignature = this.sign(
        `${encodedHeader}.${encodedPayload}`,
        this.jwtSecret,
      );

      if (
        presentedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(expectedSignature, presentedSignature)
      ) {
        this.logger?.debug("token_signature_invalid");
        return null;
      }

      const header = jwtHeaderSchema.parse(
        this.parseJsonSegment(encodedHeader),
      );
      if (header.alg !== "HS256" || header.typ !== "JWT") {
        return null;
      }

      const payload = jwtPayloadSchema.parse(
        this.parseJsonSegment(encodedPayload),
      );

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= payload.iat) {
        this.logger?.debug("token_lifetime_invalid");
        return null;
      }
      if (payload.iat > now + JWT_CLOCK_SKEW_SECONDS) {
        this.logger?.debug("token_issued_in_future", { iat: payload.iat, now });
        return null;
      }
      if (payload.exp <= now - JWT_CLOCK_SKEW_SECONDS) {
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

  private requireJwtSecret(): string {
    if (!this.jwtSecret) {
      throw new JwtSigningUnavailableError();
    }
    return this.jwtSecret;
  }

  private sign(data: string, secret: string): Buffer {
    const hmac = createHmac("sha256", secret);
    hmac.update(data);
    return hmac.digest();
  }

  private base64UrlEncode(data: string | Buffer): string {
    return Buffer.from(data).toString("base64url");
  }

  private strictBase64UrlDecode(segment: string): Buffer {
    if (!segment || !BASE64URL_SEGMENT_PATTERN.test(segment)) {
      throw new Error("Invalid compact JWT base64url segment");
    }

    const decoded = Buffer.from(segment, "base64url");
    if (decoded.toString("base64url") !== segment) {
      throw new Error("Noncanonical compact JWT base64url segment");
    }
    return decoded;
  }

  private parseJsonSegment(segment: string): unknown {
    const decoded = this.strictBase64UrlDecode(segment);
    return JSON.parse(utf8Decoder.decode(decoded)) as unknown;
  }

  private hashApiKey(key: string): Buffer {
    return createHash("sha256").update(key).digest();
  }

  /**
   * Validate an API key.
   */
  public validateApiKey(key: string): string | null {
    const presentedDigest = this.hashApiKey(key);
    for (const [name, configuredDigest] of this.apiKeys) {
      if (timingSafeEqual(configuredDigest, presentedDigest)) {
        return name;
      }
    }
    return null;
  }
}

const tokenRequestSchema = z.object({
  apiKey: z.string().min(1).optional(),
  userId: z.string().min(1).max(JWT_TEXT_MAX_LENGTH).optional(),
  username: z.string().min(1).max(JWT_TEXT_MAX_LENGTH).optional(),
  roles: z
    .array(z.string().min(1).max(JWT_ROLE_OR_SCOPE_MAX_LENGTH))
    .max(JWT_ROLES_MAX_LENGTH)
    .optional(),
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
    }),
  );

  router.post("/token", async (request, response) => {
    const parsed = tokenRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: {
            ...getErrorDetails(response),
            issues: parsed.error.issues.map((issue) => issue.message),
          },
        },
      });
      return;
    }

    const apiKeyFromHeader = request.header("x-api-key");
    const apiKey = parsed.data.apiKey ?? apiKeyFromHeader;

    if (!apiKey) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "API key is required to obtain a token",
          details: getErrorDetails(response),
        },
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
        scopes: ["prompt-vault:*"],
      };
    } else {
      let authCtx: CoreDbAuthContext | null = null;
      try {
        authCtx = await verifyCoreDbApiKey(apiKey, {
          scopes: ["prompt-vault:token"],
        });
      } catch (error) {
        logger?.warn("core_db_api_key_verification_failed", {
          message: error instanceof Error ? error.message : String(error),
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
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid API key",
          details: getErrorDetails(response),
        },
      });
      return;
    }

    // Issue Prompt Vault JWT signed with Prompt Vault secret.
    const ttlSeconds = authManager.getTokenTtlSeconds();
    let token: string;
    try {
      token = authManager.generateToken(tokenPayload);
    } catch (error) {
      if (error instanceof JwtSigningUnavailableError) {
        logger?.warn("auth_token_issuance_unavailable", {
          requestId: response.locals.requestId,
        });
        response.status(503).json({
          error: {
            code: "JWT_SIGNING_UNAVAILABLE",
            message:
              "JWT issuance is unavailable because no signing secret is configured",
            details: getErrorDetails(response),
          },
        });
        return;
      }
      throw error;
    }

    logger?.info("auth_token_issued", {
      userId: tokenPayload.userId,
      requestId: response.locals.requestId,
    });

    response.status(201).json({
      data: {
        token,
        tokenType: "Bearer",
        expiresInSeconds: ttlSeconds,
      },
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
  const {
    authManager,
    requireAuth = false,
    localhostOnly = false,
    logger,
  } = options;

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
          error: {
            code: "FORBIDDEN",
            message: "API access is restricted to localhost only",
            details: getErrorDetails(response),
          },
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

    const requiredScopes = routeRequiresAuth
      ? [isUnsafeMethod ? "prompt-vault:write" : "prompt-vault:read"]
      : [];

    const scopeAllows = (granted: string, required: string): boolean => {
      if (granted === "*" || granted === required) return true;
      if (granted.endsWith("*"))
        return required.startsWith(granted.slice(0, -1));
      return false;
    };

    const hasAllScopes = (
      grantedScopes: string[],
      required: string[],
    ): boolean => {
      if (required.length === 0) return true;
      if (grantedScopes.length === 0) return false;
      return required.every((req) =>
        grantedScopes.some((g) => scopeAllows(g, req)),
      );
    };

    // Try a Prompt Vault JWT first, then the app-owned API-key compatibility store.
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);

      const jwtPayload = authManager.verifyToken(token);
      if (jwtPayload) {
        const grantedScopes = jwtPayload.scopes ?? [];
        if (hasAllScopes(grantedScopes, requiredScopes)) {
          authenticated = true;
          authMethod = "jwt";
          authCtx = {
            kind: "session",
            userId: jwtPayload.userId,
            displayName: jwtPayload.username,
            roles: jwtPayload.roles ?? [],
            scopes: grantedScopes,
          };
        }
      }

      if (!authenticated) {
        const localKeyName = authManager.validateApiKey(token);
        if (localKeyName) {
          authenticated = true;
          authMethod = "api-key";
          authCtx = {
            kind: "api-key",
            userId: `api-key:${localKeyName}`,
            displayName: localKeyName,
            roles: ["api-key"],
            scopes: ["prompt-vault:*"],
          };
        } else {
          try {
            authCtx = await verifyCoreDbApiKey(token, {
              scopes: requiredScopes,
            });
            if (authCtx) {
              authenticated = true;
              authMethod = authCtx.kind;
            }
          } catch (error) {
            logger?.warn("api_key_bearer_verification_failed", {
              message: error instanceof Error ? error.message : String(error),
            });
          }
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
          scopes: ["prompt-vault:*"],
        };
      } else {
        try {
          authCtx = await verifyCoreDbApiKey(apiKeyHeader, {
            scopes: requiredScopes,
          });
          if (authCtx) {
            authenticated = true;
            authMethod = authCtx.kind;
          }
        } catch (error) {
          logger?.warn("core_db_api_key_header_verification_failed", {
            message: error instanceof Error ? error.message : String(error),
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
        error: {
          code: "UNAUTHORIZED",
          message:
            "Authentication required. Provide a valid Bearer token or X-API-Key header.",
          details: getErrorDetails(response),
        },
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
export function requireAuth(
  options: { roles?: string[]; scopes?: string[] } = {},
) {
  return (request: Request, response: Response, next: NextFunction) => {
    response.locals.requireAuth = true;

    if (!response.locals.authenticated) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          details: getErrorDetails(response),
        },
      });
      return;
    }

    // Check role requirements
    if (options.roles && options.roles.length > 0) {
      const userRoles = (response.locals.userRoles as string[]) || [];
      const hasRequiredRole = options.roles.some((role) =>
        userRoles.includes(role),
      );

      if (!hasRequiredRole) {
        response.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: `Access denied. Required roles: ${options.roles.join(", ")}`,
            details: getErrorDetails(response),
          },
        });
        return;
      }
    }

    if (options.scopes && options.scopes.length > 0) {
      const userScopes = (response.locals.userScopes as string[]) || [];
      const scopeAllows = (granted: string, required: string): boolean => {
        if (granted === "*" || granted === required) return true;
        if (granted.endsWith("*"))
          return required.startsWith(granted.slice(0, -1));
        return false;
      };
      const hasAll = options.scopes.every((req) =>
        userScopes.some((g) => scopeAllows(g, req)),
      );
      if (!hasAll) {
        response.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: `Access denied. Missing required scopes: ${options.scopes.join(", ")}`,
            details: getErrorDetails(response),
          },
        });
        return;
      }
    }

    next();
  };
}
