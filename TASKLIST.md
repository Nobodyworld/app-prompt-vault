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

- [ ] Git integration and sync capabilities — TK-20251107-016
  Relevance: High — Synchronization and versioned prompt sharing are common user needs. Next step: create a design doc at `docs/developer-guide/git-integration.md` that covers auth models, conflict resolution strategy, and on-disk layout. Then open an issue to track implementation and prioritize a spike.

- [ ] Schema validation and lints for prompts — TK-20251107-017
  Relevance: High — Core Zod schemas exist in `src/domain/validation.ts`; remaining work is CI integration and a linting tool. Next step: add a `cli lint` command stub that validates a directory of prompt files against the Zod schema and add a CI job to run it on PRs.

### 🔄 Nice-to-Have Features (Future Enhancements)

- [ ] Delta snapshots to reduce redundant payload size — TK-20251107-018
- [ ] End-to-end tests for critical user journeys — TK-20251107-019
- [ ] Playwright smoke tests for UI validation — TK-20251107-020
- [ ] Performance benchmarks and guardrails — TK-20251107-021
- [ ] Semantic release automation with changelogs — TK-20251107-022

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

- MCP integration: Complex JSON schemas and tool contracts
- Desktop UI: Significant architecture change from CLI-first
- Snapshots: File compression and restoration edge cases

### Medium Risk

- Import/export: File validation and format detection
- VS Code integration: Platform-specific binary detection
- Plugin system: Extension loading and sandboxing

### Low Risk

- Diagnostics: Read-only operations with clear error boundaries
- Analytics: Aggregation queries with fallbacks
- Health endpoints: HTTP server with minimal surface area</content>
<parameter name="filePath">c:\Users\Nobod\Documents\GitHub\app-prompt-vault\TASKLIST.md
