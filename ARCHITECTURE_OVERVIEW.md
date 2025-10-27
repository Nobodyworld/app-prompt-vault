# Architecture Overview

This document captures the current architecture of Prompt Vault after the Stage 3 stabilization pass. It complements the historical notes in `docs/architecture.md` and focuses on the runtime wiring, observability posture, and extension points now available to future maintainers and agents.

## High-Level System Map

```
┌──────────────────────────────────────────────────────────────────────┐
│                            Client Surfaces                           │
│  • React/Tauri desktop (desktop/)    • Commander CLI (src/cli/)      │
└──────────────────────────────────────────────────────────────────────┘
                │ invokes                                             │
                ▼                                                      
┌──────────────────────────────────────────────────────────────────────┐
│                    Application Services (src/services/)              │
│  PromptVaultService – validation, orchestration, plugin hooks        │
│      ▲                 ▲                          ▲                 │
│      │ telemetry/logs  │ plugins                   │ repository API  │
└──────┼─────────────────┴───────────────────────────┴─────────────────┘
       │                                                       ▲
       │                                                       │
┌──────┴────────────────────────────┐              ┌───────────┴──────────────┐
│ Observability (src/observability/)│              │ Persistence (src/db/,    │
│ • Structured logging              │              │ repositories/, migrations)│
│ • Metric registry + health server │◄────────────►│ • better-sqlite3 adapter  │
│ • Runtime bootstrap helpers       │              │ • PromptRepository        │
└───────────────────────────────────┘              └──────────────────────────┘
                ▲
                │
┌───────────────┴─────────────────────┐
│ Extension Host (src/extensions/)    │
│ • PluginHost manages lifecycle      │
│ • Audit trail + operational metrics │
└─────────────────────────────────────┘
```

Key ideas:

- **Single entry façade.** `PromptVaultService` mediates all domain workflows, applies validation, emits structured telemetry, and fires plugin callbacks.
- **Synchronous persistence.** We continue to rely on `better-sqlite3` for deterministic transactions. Repository access is now wrapped in spans so latencies appear in metrics snapshots.
- **First-class observability.** The `src/observability/` package introduces structured logging, a Prometheus-compatible metric registry, and a health endpoint server that can be toggled on per-process (`PROMPT_VAULT_METRICS=true`).
- **Extension layer.** Plugins register against the `PluginHost` and receive prompt lifecycle events with context-aware telemetry/logging helpers. A ready-to-use audit trail plugin demonstrates the pattern.

## Runtime Components

### PromptVaultService

- Accepts optional `telemetry`, `logger`, and `plugins` via constructor options. The CLI now boots it with observability enabled when metrics are requested.
- Emits spans for `createPrompt`, `addVersion`, `searchPrompts`, and `tagPrompt`. Success/failure states increment counters and histograms.
- Logs user-facing actions (`prompt_created`, `prompt_version_added`, `prompt_tagged`, `prompt_search`) with correlation IDs.
- Notifies registered plugins after repository commits to guarantee handlers see durable state.

### PromptRepository

- Wraps each transaction and query in `repository.*` spans for consistent latency tracking.
- Emits duplicate slug warnings before surfacing a `DuplicatePromptError` to callers.
- Migration bootstrap executes inside a span to record cold-start cost.

### Observability Runtime

- `bootstrapObservabilityFromEnv` centralises log level parsing, metrics registry creation, and health server startup. It exposes a `HealthIndicator` so services can toggle readiness/liveness.
- `MetricRegistry` implements counters and histograms with Prometheus exposition format without introducing external dependencies (useful in air-gapped environments).
- `createHealthServer` exports `/healthz`, `/readyz`, and `/metrics` endpoints. The CLI keeps readiness in sync with database availability.

### Plugin System

- `PluginHost` accepts `PromptVaultPlugin` registrations. Handlers execute inside telemetry spans (`plugin.<name>.<event>`) so long-running plugins are observable.
- `createAuditTrailPlugin()` logs lifecycle events while `createOperationalTelemetryPlugin()` increments counters for every write. Future plugins should follow the same pattern and can be scaffolded with the supplied TypeScript types or `npm run extension:scaffold`.

## Operational Topology

- **CLI / Automation workloads** should set `PROMPT_VAULT_METRICS=true` and optionally `PROMPT_VAULT_METRICS_PORT` to expose `/metrics`, `/healthz`, and `/readyz`. Health readiness flips to `ok` while the SQLite handle is open and degrades once released, allowing supervisors to distinguish idle from active sessions.
- **Desktop runtime** can reuse the same observability helpers once the Tauri shell embeds the service. Add the bootstrap call during window startup to benefit from consistent telemetry.
- **Doctor command** (`npm run dev -- doctor`) performs `PRAGMA integrity_check`, counts prompts/tags, and surfaces a sample slug list for quick situational awareness.

## Incident Response & Telemetry Flow

1. Query `/metrics` for `prompt_vault_span_total{span_name="repository.*"}` to identify hot database paths.
2. Inspect structured logs (JSON lines) for matching `traceId` to trace a user workflow end-to-end.
3. Use the new `docs/incident-response.md` playbook for recovery actions such as WAL reset or busy-timeout tuning.

## Future Evolution Hooks

- The plugin host makes it trivial to add connectors (e.g., Slack notifications) without touching core service logic.
- The observability runtime is intentionally dependency-light. Drop-in replacements for OpenTelemetry exporters can be implemented by conforming to the `Telemetry` interface.
- Containerization notes and next-generation opportunities live in `docs/future-proofing.md`; they build on the architecture summarised here.

For more detailed step-by-step history see the Codex chain under `docs/`. This overview should be your first stop when orienting new contributors or agents.
