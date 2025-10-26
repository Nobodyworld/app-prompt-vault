# Performance Notes

The Stage 3 pass introduced lightweight profiling hooks via telemetry spans. Use this document to capture baseline observations and tuning strategies.

## Baseline Metrics

- `metrics:snapshot` batch create (50 prompts): **30.78 ms** on Node 22 / Linux with in-memory SQLite.
- `metrics:snapshot` search (pageSize=50): **3.39 ms** including validation and repository overhead.
- Repository-level spans remain visible via `PROMPT_VAULT_METRICS=true` for long-running diagnostics.

Run `npm run metrics:snapshot` to reproduce the snapshot (it bootstraps an in-memory database and emits a quick summary). For production-like traces, start the observability stack (`npm run observability`) and scrape `/metrics` while executing CLI workflows.

## Optimisation Guidelines

1. **Avoid large page sizes.** Keep `pageSize` ≤ 100 to prevent UI stalls and oversized SQL results.
2. **Batch tagging operations.** Use `tagPrompt` with deduplicated labels; the repository already performs inserts in a single transaction.
3. **Leverage WAL mode.** WAL journaling plus the default busy timeout (5s) maintains good write throughput for concurrent CLI sessions.
4. **Instrument plugins.** Plugins run inside spans—monitor `plugin.<name>.*` buckets for slow handlers.

Update this file whenever new bottlenecks or tuning recommendations emerge.
