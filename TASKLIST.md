# TASKLIST: Features to Port from PRM to app-prompt-vault

-*NEVER REMOVE SPEC.md, STYLE-GUIDE.md, or TASKLIST.md FROM THE ROOT*

Use this file to compile and track all features that need to be ported from the PRM (Prompt Rules Manager) project to app-prompt-vault. Check off items as they are completed. Keep each task on a single line. Check off already completed tasks and keep things in chronological order when updating and adding to the file. Follow Template Entry below.

Keep entries one-line, oldest-first. When completing a task, check it off and append a one-line completion note indented underneath (date + PR/link + 1â€“2 sentence summary).

## Template (single-line + optional completion note)

```text
- [ ] Short task description — TK-YYYYMMDD-###
```

Completion note (indented, one line):

```text
  - Completed: YYYY-MM-DD — PR: <url> — short summary
```

---

## Tasks

### ✅ Completed Features (Already Ported)

- [x] Advanced search functionality with content search, excerpts, case sensitivity, tag/format filters — TK-20251107-001
  - Completed: 2025-11-07 — Ported from PRM: Advanced search with detailed match information and CLI command
- [x] Trash/recovery system with soft deletes and restore functionality — TK-20251107-002
  - Completed: 2025-11-07 — Ported from PRM: Soft delete system with database migration, service methods, and CLI commands
- [x] Desktop app search and filtering — TK-20251112-001
  - Completed: 2025-11-12 — Added real-time search functionality to prompt library with filtering by title, tags, and content
- [x] Desktop app keyboard shortcuts — TK-20251112-002
  - Completed: 2025-11-12 — Implemented keyboard shortcuts (Ctrl+N for create, Ctrl+K for search focus, Esc to clear) with help documentation
- [x] Desktop app data import/export UI — TK-20251112-003
  - Completed: 2025-11-12 — Added JSON import/export functionality to desktop settings with error handling and success notifications
- [x] Desktop app usage analytics — TK-20251112-004
  - Completed: 2025-11-12 — Implemented usage statistics dashboard in settings showing prompt counts, tag analytics, and usage metrics

### 🔄 High Priority Features (Core Functionality)

- [x] MCP integration with JSON schemas for agent automation — TK-20251107-003
  - Completed: 2025-11-07 — Implemented MCP server with JSON schemas and tool definitions for agent automation
- [x] Import/export functionality for external files — TK-20251107-004
  - Completed: 2025-11-07 — Implemented importPromptFromFile() and exportPromptToFile() methods in PromptVaultService with format detection, YAML/JSON conversion, and file system operations
- [x] Snapshots/backup system for point-in-time library backups — TK-20251107-005
  - Completed: 2025-11-07 — Implemented SnapshotManager class with create/restore/validate operations, service layer methods, and CLI commands (backup, restore, info)
- [x] VS Code integration for deep editing of prompts — TK-20251107-006
  - Completed: 2025-11-07 — Implemented CLI edit command that opens prompts in VS Code, auto-saves changes as new versions, and provides proper version incrementing
- [x] Format conversion between Markdown ↔ YAML ↔ JSON — TK-20251107-007
  - Completed: 2025-11-07 — Implemented convertPromptContent() function with full bidirectional conversion, CLI convert command, and MCP convertPrompt tool

### 🔄 Medium Priority Features (Enhanced UX)

- [x] Library diagnostics and integrity checks — TK-20251107-008
  - Completed: 2025-11-08 — Implemented runDiagnostics(), getLibraryStats(), repairIntegrity() methods in PromptVaultService with CLI commands (diagnostics, stats, repair) and comprehensive testing
- [x] Library summary/analytics (tag distributions, format breakdowns) — TK-20251107-009
  - Completed: 2025-11-08 — Implemented comprehensive getLibraryStats() method with tag distributions, format breakdowns, usage analytics, and activity metrics via stats CLI command
- [x] Health/diagnostics endpoints for monitoring — TK-20251107-010
  - Completed: 2025-11-08 — Implemented GET /observability/diagnostics, GET /observability/stats, POST /observability/repair endpoints with conditional service injection and JSON responses
- [x] Enhanced plugin system with filesystem connectors — TK-20251107-011
  - Completed: 2025-11-08 — Implemented dynamic plugin loading from filesystem, connector interfaces, plugin discovery system, CLI management commands, and filesystem connector example
- [x] File size limits and validation guards — TK-20251107-012
  - Completed: 2025-11-08 — Implemented configurable file size limits (10MB default) and prompt content length limits (100KB default) with environment variable support, validation in import/export operations and prompt creation, CLI integration

### 🔄 Low Priority Features (Enterprise/Advanced)

- [x] Structured logging and telemetry system — TK-20251107-013
  - Completed: 2025-11-11 — Enhanced telemetry with Gauge/Summary metrics, improved tracing with child spans, structured logging with trace correlation, and comprehensive health endpoints
- [x] Metrics and observability endpoints — TK-20251107-014
  - Completed: 2025-11-11 — Added /diagnostics and /stats endpoints, enhanced metrics registry with additional metric types, and improved health monitoring
- [ ] Desktop Electron UI (alternative to CLI) — TK-20251107-015
  Decision: Deferred — The repository targets Tauri for the desktop experience. Prefer extending the existing Tauri desktop UI rather than adding Electron unless a specific blocker arises. Revisit if native Electron-only integrations are requested.

### 🔄 Remaining Desktop App Features

- [x] Enhanced error handling and user notifications — TK-20251112-005
  - Completed: 2025-11-12 — Added toast notification system with success/error/warning/info types, integrated throughout the app for better user feedback
- [x] Theme switching (dark/light mode toggle) — TK-20251112-006
  - Completed: 2025-11-12 — Implemented theme provider with CSS variables, theme toggle in settings, and localStorage persistence
- [x] Prompt categories/folders for organization — TK-20251112-007
  - Completed: 2025-11-12 — Implemented category field in domain model, database migration, UI forms, search filtering, and import/export support
- [ ] Advanced clipboard management with history — TK-20251112-008
- [ ] Prompt templates and quick-start wizards — TK-20251112-009
- [x] Bulk operations (import/export multiple prompts) — TK-20251112-019
  - Completed: 2025-11-12 — Implemented bulk-import and bulk-export CLI commands with progress tracking, error handling, and comprehensive options for tags, categories, formats, and naming patterns
- [ ] Prompt versioning with diff visualization — TK-20251112-020
- [ ] Advanced search with fuzzy matching and AI suggestions — TK-20251112-021

### 🔄 High Priority Remaining Tasks

- [x] Git integration and sync capabilities — TK-20251107-016
  - Completed: 2025-11-12 — Implemented GitService and SyncService with CLI commands (sync init/push/pull/status) for cross-device prompt synchronization, conflict resolution, and Git-based version control
- [x] Schema validation and lints for prompts — TK-20251107-017
  - Completed: 2025-11-12 — Implemented CLI lint command that validates external prompt files against Zod schemas with auto-detection of JSON/YAML/Markdown formats, plus CI integration in quality gate pipeline
- [x] API documentation with OpenAPI specification — TK-20251112-016
  - Completed: 2025-11-12 — Created comprehensive OpenAPI 3.0.3 specification at docs/api-reference/openapi.yaml documenting all REST API endpoints with request/response schemas, error handling, and pagination
- [x] Docker containerization and deployment — TK-20251112-017
  - Completed: 2025-11-12 — Created multi-stage Dockerfile, docker-compose.yml with persistent volumes, deployment script, and npm scripts for easy container management
- [x] CI/CD pipeline with automated testing — TK-20251112-018
  - Completed: 2025-11-12 — Implemented comprehensive GitHub Actions CI pipeline with build, test, lint, coverage, and UI testing workflows

### 🔄 Nice-to-Have Features (Future Enhancements)

- [ ] Delta snapshots to reduce redundant payload size — TK-20251107-018
- [x] End-to-end tests for critical user journeys — TK-20251107-019
  - Completed: 2025-11-12 — Added comprehensive Vitest E2E test framework with smoke tests and critical user journey testing (create→list→delete→restore workflows, import/export, diagnostics/stats) plus `test:e2e` npm script
- [x] Playwright smoke tests for UI validation — TK-20251107-020
  - Completed: 2025-11-12 — Implemented comprehensive Playwright smoke tests with 7 test cases covering app loading, navigation, sidebar elements, page transitions, basic interactions, responsiveness, and error boundaries. Fixed ESLint configuration for playwright.config.ts and excluded Playwright tests from Vitest to prevent conflicts.
- [ ] Performance benchmarks and guardrails — TK-20251107-021
- [x] Semantic release automation with changelogs — TK-20251107-022
  - Completed: 2025-11-12 — Implemented automated release preparation script (`npm run release:prepare`) that handles version bumping, package.json updates, and generates changelog/release notes stubs
- [ ] Advanced search with fuzzy matching and relevance scoring — TK-20251112-010
- [ ] Prompt versioning with diff visualization — TK-20251112-011
- [ ] Collaborative features (shared prompt libraries) — TK-20251112-012
- [ ] AI-powered prompt suggestions and auto-tagging — TK-20251112-013
- [ ] Mobile companion app for prompt access — TK-20251112-014
- [ ] Integration with popular AI tools (ChatGPT, Claude, etc.) — TK-20251112-015
- [x] Git integration design document — TK-20251111-001
  - Completed: 2025-11-11 — Created comprehensive design doc at `docs/developer-guide/git-integration.md` covering auth models, conflict resolution, repository structure, and implementation phases.
- [x] CLI lint command implementation — TK-20251111-002
  - Completed: 2025-11-12 — Added `lint` CLI command that validates prompt files against Zod schemas, supports JSON/YAML/Markdown formats with auto-detection, and provides detailed validation error reporting
- [x] E2E test framework scaffolding — TK-20251111-003
  - Completed: 2025-11-12 — Added comprehensive Vitest E2E scaffold with smoke tests and critical user journey testing (create→list→delete→restore workflows, import/export, diagnostics/stats) plus `test:e2e` npm script
- [x] Security audit and dependency vulnerability scanning — TK-20251112-022
  - Completed: 2025-11-12 — Implemented comprehensive security scanning with `npm run security:scan` script that checks for vulnerabilities, insecure dependencies, and security best practices
- [ ] Multi-language support (i18n) for international users — TK-20251112-023
- [ ] Plugin marketplace and registry system — TK-20251112-024
- [ ] Backup encryption and secure storage options — TK-20251112-025
- [ ] Data migration tools for upgrading between versions — TK-20251112-026
- [ ] Web-based UI alternative to desktop app — TK-20251112-027
- [ ] Offline mode with local synchronization — TK-20251112-028
- [ ] Real-time collaboration and sharing features — TK-20251112-029
- [ ] Advanced permission and access control system — TK-20251112-030
- [ ] Audit logging and compliance reporting — TK-20251112-031
- [ ] Integration with external AI APIs and services — TK-20251112-032
- [ ] Performance monitoring and optimization — TK-20251112-033

---

## Implementation Notes

### Architecture Differences

- **PRM**: Electron desktop app with filesystem-based storage, React UI, comprehensive MCP server
- **app-prompt-vault**: CLI-first with SQLite database, Node.js focused, minimal MCP surface

### Migration Strategy

1. **Phase 1 (High Priority)**: Core functionality (MCP, import/export, snapshots, VS Code, conversion)
2. **Phase 2 (Medium Priority)**: Enhanced UX (diagnostics, analytics, health endpoints, plugins)
3. **Phase 3 (Low Priority)**: Enterprise features (logging, metrics, desktop UI)
4. **Phase 4 (Future)**: Advanced features and optimizations

### Dependencies to Consider

- MCP integration requires JSON schema definitions and tool implementations
- Desktop UI would need Electron and React dependencies
- Snapshots system needs compression and filesystem utilities
- VS Code integration requires IPC and file watching capabilities

### Testing Strategy

- Unit tests for all new service methods
- Integration tests for CLI commands
- MCP contract tests for agent interfaces
- E2E tests for critical workflows (if desktop UI is added)

---

## Risk Assessment

### High Risk

### Medium Risk

### Low Risk

 Health endpoints: HTTP server with minimal surface area

- VS Code integration: Platform-specific binary detection
