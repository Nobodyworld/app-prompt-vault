# Agent Instructions (app-prompt-vault)

## Doc Meta

- **Tier:** 3

Guidance for automated changes within `apps/app-prompt-vault`.

## Where to Look

- Developer guide: `docs/developer-guide/`

## Non-negotiables

- Desktop-first: Windows + Tauri is the primary target.
- Avoid cross-app imports; integrate via shared `@nw/*` packages/contracts.

## Local Rules

### Migrations

- **DO**: Run migrations automatically on service startup with proper error handling and rollback capabilities.
- **DON'T**: Modify database schema directly; always use migration scripts with version tracking.
- **DO**: Include migration tests that validate schema changes and data integrity.
- **DON'T**: Skip migration validation in production; always test migrations on staging data first.

### Security

- **DO**: Implement JWT-based authentication with configurable secrets and API key fallbacks.
- **DON'T**: Store secrets in plaintext; use secure backends (Tauri, environment variables) with encryption.
- **DO**: Apply rate limiting to all API endpoints with configurable limits and proper error responses.
- **DON'T**: Expose sensitive operations without authentication; all admin endpoints require auth.
- **DO**: Log security events (auth failures, rate limit hits) to audit trails without exposing PII.

### Tool Surfaces

- **DO**: Register tools with descriptive names (pv_* prefix) and clear parameter schemas.
- **DON'T**: Expose internal implementation details in tool interfaces; maintain stable contracts.
- **DO**: Include input validation and error handling in all tool implementations.
- **DON'T**: Allow tools to modify data without proper authorization checks.
