# Prompt Vault Web/HTTP Security

This directory contains the Express middleware for Prompt Vault's loopback-only pre-alpha HTTP surface. Public-network and public-internet deployment are unsupported.

## Authentication

`auth.ts` supports:

- Prompt Vault JWTs using the exact `HS256` / `JWT` header;
- configured API keys;
- the app-owned API-key compatibility store.

Direct legacy Nobodyworld Core DB session tokens are not supported.

### Configuration

```bash
# Required only when JWT verification and issuance are needed.
# Use at least 32 random characters and never commit the real value.
JWT_SECRET=replace-with-a-random-secret
JWT_EXPIRES_IN=24h

# Optional direct API keys.
API_KEY_ADMIN=replace-with-a-random-api-key

# The supported entrypoint remains loopback-only.
PROMPT_VAULT_HOST=127.0.0.1
LOCALHOST_ONLY=true
REQUIRE_AUTH=false
RATE_LIMIT_ENABLED=true
```

Initialize the manager before using JWT methods:

```typescript
import { AuthManager, createAuthMiddleware } from "./auth.js";

const authManager = new AuthManager({
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: "24h",
  apiKeys: {
    admin: process.env.API_KEY_ADMIN ?? "",
  },
});

await authManager.initialize();

app.use(
  createAuthMiddleware({
    authManager,
    requireAuth: false,
    localhostOnly: true,
    logger,
  }),
);
```

Without an injected `JWT_SECRET`, initialization succeeds in a JWT-disabled state. Local reads can remain available, and configured keys can still authenticate. `verifyToken()` returns `null`, `generateToken()` throws `JwtSigningUnavailableError`, and `/auth/token` returns HTTP `503` after validating the API key. No random process-local JWT authority is created.

### JWT contract

Generated and accepted JWTs use exactly:

```json
{ "alg": "HS256", "typ": "JWT" }
```

The required payload claims are `userId`, `username`, `iat`, and `exp`. Optional claims are `roles` and `scopes`. Header and payload objects are strict; additional properties are rejected. Timestamps must be non-negative integers, `exp` must exceed `iat`, and `iat` may be at most 60 seconds in the future. Expiration has a bounded 60-second clock-skew allowance.

All three compact segments are strictly decoded as unpadded canonical base64url. Signatures use raw HMAC-SHA256 buffers, an explicit length check, and Node's `timingSafeEqual`.

```typescript
const token = authManager.generateToken({
  userId: "user-123",
  username: "alice",
  roles: ["admin"],
  scopes: ["prompt-vault:read"],
});

const payload = authManager.verifyToken(token);
```

### API keys

Configured keys are hashed to fixed-length SHA-256 buffers during manager construction. Presented keys are hashed and compared with `timingSafeEqual`. The key name is returned after a match; raw keys and digests must never be logged.

Use a configured key directly:

```bash
curl \
  -H "X-API-Key: YOUR_KEY" \
  http://127.0.0.1:3001/api/prompts
```

The existing API-key Bearer fallback is also supported. A Bearer value is never interpreted as a legacy Core DB session token.

Exchange a valid API key for a JWT only when `JWT_SECRET` is configured:

```bash
curl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d "{}" \
  http://127.0.0.1:3001/auth/token
```

## Other middleware

### `audit.ts`

The audit middleware records bounded in-memory events for sensitive operations. Prompt bodies and credentials must not be included in audit details.

### `rate-limit.ts`

API routes use a sliding-window limiter. `/auth/token` has an independent, stricter limiter. Rate limiting remains enabled by default for the supported local entrypoint.

### Authorization boundaries

- local safe reads may be unauthenticated while `REQUIRE_AUTH=false`;
- unsafe methods always require authentication;
- required JWT/compatibility-store scopes are checked;
- `requireAuth()` enforces route roles and scopes;
- logs always require authentication;
- browser origins stay explicit.

## Environment variables

| Variable | Default | Behavior |
| --- | --- | --- |
| `JWT_SECRET` | unavailable | Required for JWT verification and issuance |
| `JWT_EXPIRES_IN` | `24h` | Token lifetime in `s`, `m`, `h`, or `d` |
| `REQUIRE_AUTH` | `false` | Also require auth for safe API reads |
| `LOCALHOST_ONLY` | `true` at supported entrypoint | Reject non-loopback clients |
| `API_KEY_<NAME>` | unavailable | Direct configured API key |
| `RATE_LIMIT_ENABLED` | `true` | Enable API rate limiting |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | API requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | API rate-limit window |
| `RATE_LIMIT_AUTH_MAX_REQUESTS` | `20` | Token requests per window |
| `RATE_LIMIT_AUTH_WINDOW_MS` | `60000` | Token rate-limit window |

## Testing

```bash
pnpm exec vitest run tests/auth.test.ts tests/httpSecurity.test.ts tests/platformAuth.test.ts
```

For the exact supported behavior and data-at-rest limitations, see `docs/SECURITY.md`.
