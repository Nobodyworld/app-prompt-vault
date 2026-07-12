# Prompt Vault project stage snapshot

**Snapshot date:** 2026-07-12  
**Current version:** 0.2.0 pre-release  
**Release tracker:** issue #26

This file is a point-in-time summary. Source code, the README, CI results, and open GitHub issues are authoritative.

## Overall status

Prompt Vault contains a substantial working product, but it is **not yet ready for an unrestricted public release or downloadable showcase artifact**.

The remaining blockers are concentrated in repository reproducibility, release verification, public documentation/legal hygiene, and presentation-focused UX validation—not in proving that the application concept exists.

## Surface status

| Surface | Stage | Current assessment |
| --- | --- | --- |
| Domain service and SQLite | Late beta | Broad prompt, version, tag, import/export, diagnostics, and migration functionality with meaningful tests |
| CLI and HTTP API | Beta | Substantial routes, security controls, observability, and automation surfaces; requires clean-checkout and release CI proof |
| React interface | Beta | Core create, edit, search, copy, filtering, import/export, and bulk workflows exist; public-showcase hierarchy and E2E coverage remain |
| Tauri application | Pre-release | Native CRUD, storage, telemetry, and packaging configuration exist; dependency topology and installer validation remain blockers |
| MCP and Nobodyworld integration | Internal beta | Tool contracts and shared-package integration are substantial but currently coupled to the parent workspace |
| Documentation and operations | Remediation | Public status and key guides are being corrected; historical documents must not override current source or issues |

## Blocking issues

- **#22:** make the supported checkout reproducibly buildable.
- **#23:** restore release-grade CI and produce verified artifacts.
- **#24:** finish public documentation, versioning, security contact, and license corrections.
- **#25:** complete showcase UX and end-to-end validation.
- **#26:** coordinate the release gate.

## Release decision

The repository may be shown privately as an active beta project. It should not be represented as independently installable, production-ready, or publicly released until issue #26 is complete.
