# Step 07 – Audit Dependencies & Security

## Summary

- Declared runtime dependencies only where necessary (SQLite driver, CLI ergonomics, validation library).
- Documented the dependency graph with security posture in `docs/DEPENDENCIES.md`.
- Established security policy via `SECURITY.md` including reporting instructions and hardening checklist.

## Risk Mitigation

- Node 18.17+ requirement ensures we receive upstream security fixes and TLS improvements.
- Encouraged automated tooling (`npm audit`, Dependabot/Renovate) to keep libraries current.
- Limited transitive dependency surface by avoiding heavy frameworks until the UI layer is added.
