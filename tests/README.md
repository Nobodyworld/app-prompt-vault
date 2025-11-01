# Test Suite

Vitest powers the automated checks for Prompt Vault. Specs live alongside the runtime entry points they exercise and focus on
end-to-end behaviour of the service layer.

Current coverage:

- `httpRouter.test.ts` – Validates HTTP routing and response contracts for the Express server.
- `httpTracing.test.ts` – Ensures request tracing headers propagate correctly.
- `migrations.test.ts` – Checks database migration ordering and idempotency.
- `observability.test.ts` – Confirms metrics and health endpoints respond as expected.
- `promptVaultService.test.ts` – Exercises the core prompt lifecycle flows.
- `serverConfig.test.ts` – Verifies configuration validation and normalization logic.
- `telemetryFileReader.test.ts` – Tests log aggregation helpers used by observability tooling.

Run the suite with `npm test` or `npm run quality:gate` before pushing changes.
