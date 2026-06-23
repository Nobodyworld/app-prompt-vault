# Observability (app-prompt-vault)

Logging/telemetry utilities and diagnostics hooks.

This module provides structured logging, tracing (trace IDs), and runtime telemetry wiring.

Notes:

- The server exposes `/observability/metrics` when `PROMPT_VAULT_METRICS=true`.
- The desktop renderer can forward telemetry events to the Tauri backend for local persistence (see `docs/operations/telemetry.md`).
- Audit logging is implemented via the audit trail plugin (see `src/extensions/`).
