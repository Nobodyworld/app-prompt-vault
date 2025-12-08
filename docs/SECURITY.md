# Security Guide — Prompt Vault & Hub HTTP APIs

This guide covers the security features available for network deployments of Prompt Vault and Hub HTTP APIs.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Audit Logging](#audit-logging)
- [Rate Limiting](#rate-limiting)
- [Configuration](#configuration)
- [Deployment Best Practices](#deployment-best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

By default, Prompt Vault and Hub are designed for **local-only** deployments. When deploying over a network, you should enable additional security features:

1. **Authentication** - JWT or API key-based access control
2. **Audit Logging** - Track sensitive operations (who/what/when)
3. **Rate Limiting** - Protect against abuse and DoS attacks

---

## Authentication

### JWT Token-Based Authentication

#### Configuration

Set the following environment variables:

```bash
# JWT secret key (required for production)
JWT_SECRET=your-secret-key-min-32-chars

# Token expiration (default: 24h)
JWT_EXPIRES_IN=24h

# Require authentication for all routes (default: false)
REQUIRE_AUTH=true

# Restrict to localhost only (default: false)
LOCALHOST_ONLY=false
```

#### Generating Tokens

Use the auth manager to generate tokens programmatically:

```typescript
import { AuthManager } from "./web/auth.js";

const authManager = new AuthManager({
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: "24h",
});

const token = authManager.generateToken({
  userId: "user-123",
  username: "alice",
  roles: ["admin"],
});

console.log("Token:", token);
```

#### Using Tokens

Include the token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3001/api/prompts
```

### API Key Authentication

#### Configuration

Set API keys via environment variables:

```bash
# Format: KEY_NAME=key_value
API_KEY_ADMIN=admin-key-abc123
API_KEY_READONLY=readonly-key-xyz789
```

Or configure programmatically:

```typescript
const authManager = new AuthManager({
  apiKeys: {
    admin: "admin-key-abc123",
    readonly: "readonly-key-xyz789",
  },
});
```

#### Using API Keys

Include the key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: admin-key-abc123" \
  http://localhost:3001/api/prompts
```

### Protecting Routes

```typescript
import { createAuthMiddleware, requireAuth } from "./web/auth.js";

// Apply auth to all /api routes
app.use("/api", createAuthMiddleware({
  authManager,
  requireAuth: false, // Optional by default
  localhostOnly: false,
  logger,
}));

// Require auth for specific routes
router.post("/prompts", requireAuth(), createPromptHandler);
router.delete("/prompts/:id", requireAuth({ roles: ["admin"] }), deletePromptHandler);
```

---

## Audit Logging

### Overview

Audit logging tracks sensitive operations with the following information:

- **Who**: User ID and IP address
- **What**: Action (e.g., create_prompt, delete_secret, execute_tool)
- **When**: ISO 8601 timestamp
- **Result**: Success, failure, or denied
- **Details**: Additional context (method, path, status code, etc.)

### Configuration

```bash
# Enable audit logging (default: true)
AUDIT_LOGGING_ENABLED=true

# Maximum audit events in memory (default: 10000)
AUDIT_MAX_EVENTS=10000

# Audit log file (optional, for persistent storage)
AUDIT_LOG_FILE=/var/log/prompt-vault/audit.log
```

### Usage

```typescript
import { InMemoryAuditLogger, createAuditMiddleware, createAutoAuditMiddleware } from "./web/audit.js";

const auditLogger = new InMemoryAuditLogger({
  maxEvents: 10_000,
  logger,
});

// Enable audit middleware
app.use(createAuditMiddleware({ auditLogger, logger }));
app.use(createAutoAuditMiddleware()); // Automatically detect sensitive routes

// Manual audit logging in route handlers
router.post("/prompts", (req, res) => {
  res.locals.auditAction = "create_prompt";
  res.locals.auditResource = "prompts";
  res.locals.auditDetails = { promptId: "123" };

  // ... handler logic
});
```

### Querying Audit Logs

```typescript
// Get all audit events
const allEvents = auditLogger.getEvents();

// Filter by user
const userEvents = auditLogger.getEvents({ userId: "user-123" });

// Filter by action
const createEvents = auditLogger.getEvents({ action: "create_prompt" });

// Filter by result
const deniedEvents = auditLogger.getEvents({ result: "denied" });

// Filter by date range
const recentEvents = auditLogger.getEvents({
  startDate: new Date(Date.now() - 86400_000), // Last 24 hours
  limit: 100,
});
```

### Sensitive Operations Logged

- **Prompt operations**: create, update, delete
- **Secret access**: get, set, delete credentials
- **Configuration changes**: update settings
- **Tool execution**: orchestrator tool invocations
- **Authentication failures**: denied access attempts

---

## Rate Limiting

### Overview

Rate limiting protects APIs from abuse using a sliding window algorithm. Limits are enforced per IP address (or user ID if authenticated).

### Configuration

```bash
# Global rate limit (requests per minute)
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000

# Strict rate limit for sensitive endpoints
RATE_LIMIT_STRICT_MAX_REQUESTS=10
RATE_LIMIT_STRICT_WINDOW_MS=60000
```

### Usage

```typescript
import { createRateLimitMiddleware, createEndpointRateLimiter } from "./web/rate-limit.js";

// Global rate limit
app.use("/api", createRateLimitMiddleware({
  maxRequests: 100,
  windowMs: 60_000, // 1 minute
  logger,
}));

// Endpoint-specific strict rate limit
const strictLimiter = createEndpointRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
  logger,
});

router.post("/prompts", strictLimiter, createPromptHandler);
router.delete("/prompts/:id", strictLimiter, deletePromptHandler);
```

### Rate Limit Headers

Responses include rate limit information:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 2025-12-07T12:34:56.789Z
Retry-After: 42 (only when limit exceeded)
```

### Handling Rate Limit Errors

```bash
HTTP/1.1 429 Too Many Requests
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Maximum 100 requests per 60 seconds.",
  "retryAfter": 42
}
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | (random) | JWT signing secret (32+ chars recommended) |
| `JWT_EXPIRES_IN` | `24h` | Token expiration time |
| `REQUIRE_AUTH` | `false` | Require authentication for all routes |
| `LOCALHOST_ONLY` | `false` | Restrict API to localhost only |
| `API_KEY_*` | - | API keys (e.g., `API_KEY_ADMIN=abc123`) |
| `AUDIT_LOGGING_ENABLED` | `true` | Enable audit logging |
| `AUDIT_MAX_EVENTS` | `10000` | Max audit events in memory |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (milliseconds) |

### Programmatic Configuration

```typescript
import { loadServerConfig } from "./config/serverConfig.js";

const config = loadServerConfig({
  defaults: {
    port: 3001,
    // ... other defaults
  },
});

// Configure auth
const authManager = new AuthManager({
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
  requireAuthByDefault: process.env.REQUIRE_AUTH === "true",
  localhostOnly: process.env.LOCALHOST_ONLY === "true",
  apiKeys: extractApiKeys(process.env),
});

// Configure audit logging
const auditLogger = new InMemoryAuditLogger({
  maxEvents: parseInt(process.env.AUDIT_MAX_EVENTS || "10000", 10),
  logger,
});

// Configure rate limiting
const rateLimiter = createRateLimitMiddleware({
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  logger,
});

function extractApiKeys(env: NodeJS.ProcessEnv): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("API_KEY_") && value) {
      const keyName = key.replace("API_KEY_", "").toLowerCase();
      keys[keyName] = value;
    }
  }
  return keys;
}
```

---

## Deployment Best Practices

### Production Deployment Checklist

- [ ] Set a strong `JWT_SECRET` (minimum 32 characters, random)
- [ ] Enable `REQUIRE_AUTH=true` for network deployments
- [ ] Configure specific `allowedOrigins` for CORS (avoid `*`)
- [ ] Enable HTTPS/TLS (use reverse proxy like nginx or Caddy)
- [ ] Set appropriate rate limits based on expected traffic
- [ ] Enable audit logging and monitor for anomalies
- [ ] Rotate API keys and JWT secrets periodically
- [ ] Use API keys with least privilege (read-only when possible)
- [ ] Monitor rate limit violations and adjust thresholds
- [ ] Set up log aggregation for audit logs (e.g., ELK, Splunk)

### Reverse Proxy Configuration

#### nginx

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /api {
        proxy_pass http://localhost:3001/api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Caddy

```
api.example.com {
    reverse_proxy localhost:3001
}
```

### Docker Deployment

```dockerfile
FROM node:24-alpine

WORKDIR /app
COPY . .
RUN pnpm install --prod
RUN pnpm build

ENV JWT_SECRET=your-secret-key
ENV REQUIRE_AUTH=true
ENV LOCALHOST_ONLY=false
ENV RATE_LIMIT_MAX_REQUESTS=100

EXPOSE 3001
CMD ["node", "dist/server.js"]
```

```bash
docker build -t prompt-vault .
docker run -d \
  -p 3001:3001 \
  -e JWT_SECRET=your-secret-key \
  -e REQUIRE_AUTH=true \
  -v /data:/app/data \
  prompt-vault
```

---

## Troubleshooting

### Authentication Issues

**Problem**: "Authentication required" error

- Verify token is included in `Authorization: Bearer <token>` header
- Check token expiration with `jwt.verify()` or decode manually
- Ensure `JWT_SECRET` matches between token generation and validation

**Problem**: "Forbidden" error with valid token

- Check user roles match required roles for the endpoint
- Verify `requireAuth({ roles: ["admin"] })` configuration

### Rate Limiting Issues

**Problem**: 429 Too Many Requests

- Check `X-RateLimit-Reset` header for reset time
- Reduce request frequency or implement exponential backoff
- Consider requesting higher rate limits for your use case

**Problem**: Rate limits too strict

- Adjust `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_MS`
- Use endpoint-specific rate limiters for sensitive operations only
- Implement user-based rate limiting (requires authentication)

### Audit Logging Issues

**Problem**: Audit events not appearing

- Verify `AUDIT_LOGGING_ENABLED=true`
- Check that `res.locals.auditAction` and `res.locals.auditResource` are set
- Enable debug logging: `logger.setLevel("debug")`

**Problem**: Memory usage high

- Reduce `AUDIT_MAX_EVENTS` to lower memory footprint
- Implement persistent storage (database or file) for audit logs
- Set up log rotation and archival

---

## Security Contacts

For security vulnerabilities, please email: <security@example.com>

---

Last updated: December 7, 2025
