import type { NextFunction, Request, Response } from "express";
import type { StructuredLogger } from "../observability/logger.js";

type RateLimitMiddleware = (request: Request, response: Response, next: NextFunction) => void;

interface RateLimitStore {
    get(key: string): RateLimitEntry | undefined;
    set(key: string, entry: RateLimitEntry): void;
    delete(key: string): void;
    clear(): void;
}

interface RateLimitEntry {
    count: number;
    resetAt: number;
    firstRequestAt: number;
}

/**
 * In-memory rate limit store using token bucket algorithm.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
    private store = new Map<string, RateLimitEntry>();
    private cleanupInterval: NodeJS.Timeout;

    public constructor(cleanupIntervalMs = 60_000) {
        // Periodically clean up expired entries
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.store.entries()) {
                if (entry.resetAt < now) {
                    this.store.delete(key);
                }
            }
        }, cleanupIntervalMs);
    }

    public get(key: string): RateLimitEntry | undefined {
        return this.store.get(key);
    }

    public set(key: string, entry: RateLimitEntry): void {
        this.store.set(key, entry);
    }

    public delete(key: string): void {
        this.store.delete(key);
    }

    public clear(): void {
        this.store.clear();
    }

    public destroy(): void {
        clearInterval(this.cleanupInterval);
        this.clear();
    }
}

export interface RateLimitConfig {
    /**
     * Maximum number of requests allowed per window.
     * Default: 100
     */
    maxRequests?: number;

    /**
     * Time window in milliseconds.
     * Default: 60000 (1 minute)
     */
    windowMs?: number;

    /**
     * Custom key generator function.
     * By default, uses IP address.
     */
    keyGenerator?: (request: Request) => string;

    /**
     * Handler for rate limit exceeded.
     */
    onLimitExceeded?: (request: Request, response: Response) => void;

    /**
     * Skip rate limiting for certain requests.
     */
    skip?: (request: Request) => boolean;

    /**
     * Custom rate limit store.
     */
    store?: RateLimitStore;
}

/**
 * Express middleware for rate limiting using sliding window algorithm.
 *
 * Limits requests per IP address (or custom key) within a time window.
 *
 * Usage:
 * ```typescript
 * app.use("/api", createRateLimitMiddleware({
 *   maxRequests: 100,
 *   windowMs: 60_000, // 1 minute
 *   logger
 * }));
 *
 * // Different limits for specific routes
 * router.post("/prompts", createRateLimitMiddleware({
 *   maxRequests: 10,
 *   windowMs: 60_000
 * }), handler);
 * ```
 */
export function createRateLimitMiddleware(
    config: RateLimitConfig & { logger?: StructuredLogger } = {}
): RateLimitMiddleware {
    const {
        maxRequests = 100,
        windowMs = 60_000,
        keyGenerator = (req) => req.ip || req.socket.remoteAddress || "unknown",
        onLimitExceeded,
        skip,
        store = new InMemoryRateLimitStore(),
        logger,
    } = config;

    return (request: Request, response: Response, next: NextFunction) => {
        // Skip rate limiting if requested
        if (skip && skip(request)) {
            return next();
        }

        const key = keyGenerator(request);
        const now = Date.now();

        // Get current rate limit entry
        let entry = store.get(key);

        // Initialize or reset if window expired
        if (!entry || entry.resetAt < now) {
            entry = {
                count: 1,
                resetAt: now + windowMs,
                firstRequestAt: now,
            };
            store.set(key, entry);

            // Add rate limit headers
            response.setHeader("X-RateLimit-Limit", maxRequests);
            response.setHeader("X-RateLimit-Remaining", maxRequests - 1);
            response.setHeader("X-RateLimit-Reset", new Date(entry.resetAt).toISOString());

            return next();
        }

        // Increment count
        entry.count++;
        store.set(key, entry);

        // Check if limit exceeded
        if (entry.count > maxRequests) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

            logger?.warn("rate_limit_exceeded", {
                key,
                count: entry.count,
                maxRequests,
                windowMs,
                path: request.path,
                requestId: response.locals.requestId,
            });

            // Add rate limit headers
            response.setHeader("X-RateLimit-Limit", maxRequests);
            response.setHeader("X-RateLimit-Remaining", 0);
            response.setHeader("X-RateLimit-Reset", new Date(entry.resetAt).toISOString());
            response.setHeader("Retry-After", retryAfter);

            if (onLimitExceeded) {
                return onLimitExceeded(request, response);
            }

            response.status(429).json({
                error: "Too Many Requests",
                message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
                retryAfter,
            });
            return;
        }

        // Add rate limit headers
        response.setHeader("X-RateLimit-Limit", maxRequests);
        response.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count));
        response.setHeader("X-RateLimit-Reset", new Date(entry.resetAt).toISOString());

        next();
    };
}

/**
 * Create endpoint-specific rate limits with different thresholds.
 *
 * Usage:
 * ```typescript
 * const strictLimiter = createEndpointRateLimiter({
 *   maxRequests: 10,
 *   windowMs: 60_000
 * });
 *
 * router.post("/sensitive-operation", strictLimiter, handler);
 * ```
 */
export function createEndpointRateLimiter(
    config: RateLimitConfig & { logger?: StructuredLogger }
): RateLimitMiddleware {
    return createRateLimitMiddleware(config);
}

/**
 * Create user-based rate limiter (requires authentication).
 *
 * Usage:
 * ```typescript
 * const userLimiter = createUserRateLimiter({
 *   maxRequests: 1000,
 *   windowMs: 3600_000 // 1 hour
 * });
 *
 * app.use("/api", authMiddleware, userLimiter);
 * ```
 */
export function createUserRateLimiter(
    config: Omit<RateLimitConfig, "keyGenerator"> & { logger?: StructuredLogger }
): RateLimitMiddleware {
    return createRateLimitMiddleware({
        ...config,
        keyGenerator: (req: Request & { locals?: { userId?: string } }) =>
            req.locals?.userId || req.ip || req.socket.remoteAddress || "anonymous",
    });
}
