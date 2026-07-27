# Prompt Vault HTTP Security

## Doc Meta

- **Tier:** 3

Prompt Vault is a local-first pre-alpha application. Its supported HTTP surface is loopback-only. Public-network and public-internet deployment are unsupported, and the authentication controls described here do not make the application ready for either.

## Network boundary

Start the HTTP entrypoint through `src/server.ts`. It installs the loopback guard before loading the Express server:

- `PROMPT_VAULT_HOST` is fixed to `127.0.0.1`;
- a configured non-loopback host fails closed;
- `LOCALHOST_ONLY` is forced on for the supported entrypoint;
- browser origins must be explicit HTTP or HTTPS origins;
- unsafe methods remain authenticated even when local reads are left open;
- logs remain authenticated;
- rate limiting remains active unless explicitly disabled for local diagnostics;
- observability repair is disabled by default.

`LOCALHOST_ONLY=false`, wildcard origins, reverse-proxy examples, and public bind addresses are not supported deployment options.

## Supported authentication

Prompt Vault supports only:

1. Prompt Vault JWTs signed with an explicitly configured `JWT_SECRET`;
2. configured API keys;
3. API keys in the app-owned compatibility store.

Direct legacy Nobodyworld Core DB session tokens are intentionally unsupported. Prompt Vault does not open a private Core DB to verify sessions and does not pass its signing secret to the disabled compatibility boundary. A future legacy integration would require a separately reviewed optional adapter or explicit token-exchange flow.

### JWT secret lifecycle

Set an injected signing secret before starting the server:

```bash
JWT_SECRET=replace-with-at-least-32-random-characters
JWT_EXPIRES_IN=24h
```

Never commit an actual signing secret or API key.

`AuthManager.initialize()` enables JWT signing only when an explicit non-empty secret was supplied. It does not generate or retrieve a process-local fallback secret. This produces stable verification across separately initialized processes that use the same injected secret.

When `JWT_SECRET` is absent:

- the loopback server may still start;
- unauthenticated local reads may remain available when `REQUIRE_AUTH=false`;
- unsafe methods remain authenticated-only;
- configured API keys may still authenticate directly;
- `verifyToken()` returns `null`;
- `generateToken()` throws a controlled `JwtSigningUnavailableError`;
- a valid API key sent to `POST /auth/token` receives HTTP `503` with `JWT_SIGNING_UNAVAILABLE`;
- no JWT is issued.

The app-local `getSecret`/`storeSecret` compatibility utility is process-local memory only. It is not persistent secure storage and is not a JWT signing fallback.

### JWT format

Compact JWT input must have exactly three non-empty, unpadded base64url segments. Each segment must contain only `A-Z`, `a-z`, `0-9`, `_`, or `-`, and decoded bytes must re-encode to the exact original segment. Invalid UTF-8, invalid JSON, padded input, and noncanonical encodings are rejected.

The protected header schema is exact and permits no additional properties:

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

`none`, other HMAC algorithms, altered casing, arrays, primitives, `null`, missing fields, and additional header fields are rejected.

The payload schema is also exact:

```text
userId: non-empty string, maximum 200 characters
username: non-empty string, maximum 200 characters
iat: non-negative integer
exp: non-negative integer
roles: optional array of at most 10 non-empty strings, 100 characters each
scopes: optional array of at most 20 non-empty strings, 100 characters each
```

Additional payload properties and malformed arrays are rejected. `exp` must be greater than `iat`.

Prompt Vault allows 60 seconds of clock skew. A token is rejected when `iat` is more than 60 seconds in the future or when `exp` is at least 60 seconds behind the verifier clock. This bounded allowance means a token can remain acceptable for at most 60 seconds after its nominal expiration.

JWT signatures are HMAC-SHA256 digests produced with Node crypto. Verification strictly decodes the presented signature to raw bytes, rejects a digest-length mismatch, and calls `timingSafeEqual` only for equal-length buffers. Encoded signatures are never compared with ordinary string equality.

### Token issuance

`POST /auth/token` requires a valid configured or app-owned compatibility API key. A successful request returns a Prompt Vault JWT only when `JWT_SECRET` is configured.

```bash
curl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_CONFIGURED_KEY" \
  -d "{}" \
  http://127.0.0.1:3001/auth/token
```

Invalid keys receive HTTP `401`. A valid key with unavailable JWT signing receives HTTP `503`; it is not converted into a process-local signing authority.

### API keys

Configure one environment variable per key:

```bash
API_KEY_ADMIN=replace-with-a-random-api-key
API_KEY_READONLY=replace-with-a-different-random-api-key
```

Configured keys can be presented in `X-API-Key`. The existing supported Bearer API-key fallback remains available. During construction, configured key values are hashed to fixed-length SHA-256 buffers. Presented keys are hashed the same way and compared with `timingSafeEqual`; raw configured keys are not compared with `===`.

The app-owned compatibility store indexes SHA-256 hex digests rather than raw secrets and enforces its assigned roles and scopes. Its map lookup is over a digest, not a raw-secret comparison. Do not log raw keys or their digests.

## Authorization behavior

- Unsafe methods (`POST`, `PUT`, `PATCH`, and `DELETE`) require authentication even when `REQUIRE_AUTH=false`.
- JWT and compatibility-store scopes are checked before a request is marked authenticated.
- Configured local API keys retain the existing `prompt-vault:*` scope.
- Route-level `requireAuth()` continues to enforce required roles and scopes.
- The `/logs` surface always requires authentication.
- Token issuance has a separate rate limiter.

## Data confidentiality

Authentication controls who can use an HTTP route; it does not encrypt prompt content or databases.

Prompt bodies, the main SQLite database, and the app-owned platform sidecar remain plaintext at rest. Protect them with operating-system permissions and full-disk encryption. Do not place credentials, tokens, or other secrets in prompts, logs, fixtures, screenshots, or telemetry.

## Local configuration

```bash
PROMPT_VAULT_HOST=127.0.0.1
PROMPT_VAULT_ALLOWED_ORIGINS=http://127.0.0.1:1420,http://localhost:1420
LOCALHOST_ONLY=true
REQUIRE_AUTH=false
RATE_LIMIT_ENABLED=true
JWT_SECRET=replace-with-at-least-32-random-characters
JWT_EXPIRES_IN=24h
API_KEY_ADMIN=replace-with-a-random-api-key
```

See `.env.example` for the complete local configuration. Report suspected vulnerabilities through the repository security policy rather than a public issue.
