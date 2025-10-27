# Incident Response Playbook

This playbook outlines the recommended recovery steps when Prompt Vault experiences degraded behaviour.

## 1. Verify Health Endpoints

1. Hit `/observability/healthz` (or the standalone `/healthz` if running the metrics server directly) to confirm the process is alive.
2. Hit `/observability/readyz` to ensure the service is accepting work. A degraded response typically includes contextual `details`.
3. Scrape `/observability/metrics` and inspect `prompt_vault_span_total` and `prompt_vault_http_requests_total` for rapidly increasing error counts.

## 2. Common Recovery Actions

| Symptom | Mitigation |
| --- | --- |
| `SQLITE_BUSY` errors | Increase `PROMPT_VAULT_BUSY_TIMEOUT` (see `src/db/connection.ts`) or stagger concurrent jobs. |
| Slow queries | Review `prompt_vault_span_duration_seconds{span_name="repository.searchPrompts"}` and consider adding indexes or reducing page sizes. |
| Duplicate slug attempts | Investigate audit logs (`prompt_created` entries) and deduplicate at the caller before retries. |

## 3. Restoring Consistency

1. Run `npm run dev -- doctor --db <path>` to execute `PRAGMA integrity_check` and summarise dataset counts.
2. Review structured logs filtered by `traceId` for the impacted window.
3. If WAL files appear corrupt, back up `prompt-vault.db`, remove lingering `-wal`/`-shm` files, and restart the process.

## 4. Post-Incident Checklist

- Document the root cause and fix in `RELEASE_NOTES.md` under "Fixed".
- Add regression tests or plugins where appropriate (e.g., validation plugin to reject malformed data).
- Update monitoring dashboards to alert on the observed metric/signature.

Maintainers should keep this file updated as new operational lessons emerge.
