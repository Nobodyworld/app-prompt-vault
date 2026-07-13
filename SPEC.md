# Prompt Vault — Root Specification

Prompt Vault is a desktop-first local application and reusable domain service for storing, organizing, searching, versioning, and exporting prompts.

The repository is now **standalone-first**:

- application source declares no private `@nw/*` or `workspace:*` dependencies;
- Prompt Vault owns its persistence, tags/projects, logging, events, authentication compatibility, tools, widgets, and native secrets boundary;
- external Nobodyworld or Hub integration may consume these app-owned contracts through optional adapters, but is not required to install the application.

## Canonical specifications

- Product and architecture spec: [`docs/SPEC.md`](docs/SPEC.md)
- API specification: [`docs/api-reference/SPEC.md`](docs/api-reference/SPEC.md)
- OpenAPI document: [`docs/api-reference/openapi.yaml`](docs/api-reference/openapi.yaml)
- Standalone boundary: [`docs/developer-guide/standalone-dependency-matrix.md`](docs/developer-guide/standalone-dependency-matrix.md)

## Primary surfaces

- Domain and persistence: `src/domain`, `src/repositories`, `src/services`
- CLI and HTTP API: `src/cli`, `src/web`, `src/server.ts`
- React UI: `desktop/`
- Tauri shell: `src-tauri/`
- Automation tools: `src/tools/`, with app-local registration in `src/lib/platform-orchestrator.ts`
- Widget metadata: `src/widgets/`, with app-local registration in `src/lib/platform-pages-widgets.ts`
- Platform compatibility: `src/lib/platform-core.ts`

## Release status

The source boundary is self-contained, but the release remains pre-release until issue #26 proves a reviewed lockfile, clean standalone install, current-head tests/builds, Playwright, Rust/Tauri packaging, Windows artifact behavior, and legacy tag/project migration.
