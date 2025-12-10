# Prompt Vault Web/HTTP API Security

This directory contains security middleware for network deployments of the Prompt Vault HTTP API.

## Quick Start

### 1. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Generate a secure JWT secret
JWT_SECRET=$(openssl rand -hex 32)

# Enable security features
REQUIRE_AUTH=true
AUDIT_LOGGING_ENABLED=true
RATE_LIMIT_ENABLED=true

# Optional: API keys for service accounts
API_KEY_ADMIN=your-admin-key-here
API_KEY_READONLY=your-readonly-key-here
```

### 2. Start the Server

```bash
pnpm --filter @nw/prompt-vault run server
```

The server will apply all enabled security middleware automatically.

## Modules

### `auth.ts` — Authentication

**Features:**

- JWT token-based authentication (custom HMAC-SHA256 implementation)
- API key authentication (Bearer or header-based)
- Configurable token expiration (seconds, minutes, hours, days)
- No external dependencies (uses native Node.js crypto)

**Usage:**

```typescript
import { AuthManager, createAuthMiddleware } from "./auth.js";

const authManager = new AuthManager({
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: "24h",
  apiKeys: {
    admin: process.env.API_KEY_ADMIN,
    readonly: process.env.API_KEY_READONLY,
  },
});

// Apply to all routes
app.use(createAuthMiddleware(authManager));

// Or protect specific routes
router.post("/sensitive", requireAuth(authManager), handler);
```

**Token Generation:**

```typescript
const token = authManager.generateToken({
  userId: "user-123",
  username: "alice",
  roles: ["admin"],
});
```

**Token Verification:**

```typescript
const payload = authManager.verifyToken(token);
if (payload) {
  console.log("Authenticated user:", payload.username);
}
```

### `audit.ts` — Audit Logging

**Features:**

- Structured event logging (who, what, when, where)
- Filtering by userId, action, resource, result, date range
- In-memory storage with configurable max events
- Automatic request logging middleware
- Auto-detection of sensitive operations

**Usage:**

```typescript
import { InMemoryAuditLogger, createAuditMiddleware } from "./audit.js";

const auditLogger = new InMemoryAuditLogger({
  maxEvents: 10_000,
  logger,
});

// Log all requests
app.use(createAuditMiddleware(auditLogger));

// Or auto-log sensitive operations only
app.use(createAutoAuditMiddleware(auditLogger));
```

**Manual Logging:**

```typescript
auditLogger.log({
  userId: "user-123",
  action: "delete",
  resource: "prompt:abc",
  result: "success",
  details: { reason: "user requested" },
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});
```

**Query Events:**

```typescript
const events = auditLogger.getEvents({
  userId: "user-123",
  action: "delete",
  result: "failure",
  startDate: new Date("2025-01-01"),
  limit: 100,
});
```

### `rate-limit.ts` — Rate Limiting

**Features:**

- Sliding window algorithm for accurate rate limiting
- Per-IP or custom key rate limiting
- X-RateLimit-* headers (Limit, Remaining, Reset)
- 429 Too Many Requests with Retry-After
- Automatic cleanup of expired entries
- Separate limits for sensitive endpoints

**Usage:**

```typescript
import { createRateLimitMiddleware, createEndpointRateLimiter } from "./rate-limit.js";

// Global rate limit (100 req/min per IP)
app.use(
  createRateLimitMiddleware({
    maxRequests: 100,
    windowMs: 60_000,
    logger,
  })
);

// Stricter limit for sensitive endpoints (10 req/min)
router.post(
  "/auth/login",
  createEndpointRateLimiter({ maxRequests: 10, windowMs: 60_000 }),
  handler
);
```

**Custom Key Generator:**

```typescript
createRateLimitMiddleware({
  maxRequests: 50,
  windowMs: 60_000,
  keyGenerator: (req) => req.user?.id || req.ip,
});
```

**Skip Certain Requests:**

```typescript
createRateLimitMiddleware({
  maxRequests: 100,
  windowMs: 60_000,
  skip: (req) => req.path === "/health",
});
```

## Environment Variables

See `.env.example` for full configuration options.

| Variable                        | Default | Description                                      |
| ------------------------------- | ------- | ------------------------------------------------ |
| `JWT_SECRET`                    | —       | **Required** JWT signing secret (min 32 chars)   |
| `JWT_EXPIRES_IN`                | `24h`   | Token expiration (s/m/h/d)                       |
| `REQUIRE_AUTH`                  | `false` | Require authentication for all API routes        |
| `LOCALHOST_ONLY`                | `false` | Restrict API access to localhost                 |
| `API_KEY_<NAME>`                | —       | API keys for service accounts                    |
| `AUDIT_LOGGING_ENABLED`         | `true`  | Enable audit logging                             |
| `AUDIT_MAX_EVENTS`              | `10000` | Max events in memory                             |
| `RATE_LIMIT_ENABLED`            | `true`  | Toggle global rate limiting middleware           |
| `RATE_LIMIT_MAX_REQUESTS`       | `100`   | Requests per window for API routes               |
| `RATE_LIMIT_WINDOW_MS`          | `60000` | Rate limit window for API routes (ms)            |
| `RATE_LIMIT_AUTH_MAX_REQUESTS`  | `10`    | Requests per window for `/auth/token` issuance   |
| `RATE_LIMIT_AUTH_WINDOW_MS`     | `60000` | Rate limit window for `/auth/token` (ms)         |

## Security Best Practices

1. **Always use HTTPS in production** — JWT tokens and API keys should never be transmitted over plain HTTP
2. **Rotate JWT secrets regularly** — Use environment-specific secrets and rotate periodically
3. **Use strong API keys** — Generate with `openssl rand -hex 32`
4. **Enable all security features** — Set `REQUIRE_AUTH`, `AUDIT_LOGGING_ENABLED`, and `RATE_LIMIT_ENABLED` to `true`
5. **Review audit logs regularly** — Monitor for suspicious activity
6. **Use reverse proxy** — Deploy behind nginx/Caddy with additional security headers
7. **Limit token expiration** — Use short-lived tokens (1-24 hours) for better security
8. **Store secrets securely** — Use secret management systems in production (AWS Secrets Manager, HashiCorp Vault, etc.)

## Testing

Run unit tests:

```bash
pnpm --filter @nw/prompt-vault test tests/auth.test.ts
pnpm --filter @nw/prompt-vault test tests/audit.test.ts
pnpm --filter @nw/prompt-vault test tests/rate-limit.test.ts
```

## Production Deployment

See `docs/SECURITY.md` for:

- Nginx/Caddy reverse proxy configuration
- Docker deployment examples
- Kubernetes security contexts
- Monitoring and alerting setup
- Incident response procedures

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     Prompt Vault Server                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                  Express Middleware                  │  │
│  │                                                      │  │
│  │  1. Rate Limit ──> 429 if exceeded                  │  │
│  │                                                      │  │
│  │  2. Auth ──────────> 401 if invalid/missing         │  │
│  │                                                      │  │
│  │  3. Audit ─────────> Log all requests               │  │
│  │                                                      │  │
│  │  4. Routes ────────> Business logic                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │               Security Headers                       │  │
│  │                                                      │  │
│  │  • Strict-Transport-Security (HSTS)                 │  │
│  │  • X-Frame-Options                                  │  │
│  │  • X-Content-Type-Options                           │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Limitations

### In-Memory Storage

Current implementation uses in-memory storage for:

- Audit logs
- Rate limit counters

**Limitations:**

- Data lost on server restart
- Not suitable for multi-instance deployments (no shared state)

**Production Alternatives:**

- Audit logging: PostgreSQL, Elasticsearch, CloudWatch Logs
- Rate limiting: Redis, Memcached

### No User Management

Current implementation provides authentication primitives but no user management:

- No user registration/password reset
- No role-based access control (RBAC)
- No session management

For production deployments with multiple users, integrate with:

- Auth0
- Keycloak
- AWS Cognito
- Custom user management system

## Contributing

When adding new security features:

1. Add unit tests in `tests/`
2. Update `.env.example` with new variables
3. Update `docs/SECURITY.md` with configuration details
4. Document in this README
5. Follow principle of least privilege
6. Fail closed (deny by default)
