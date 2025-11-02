# TASKLIST: Task Compilation

-*NEVER REMOVE SPEC.md, STYLE-GUIDE.md, or TASKLIST.md FROM THE ROOT*

Use this file to compile and track all tasks that need to be completed for this repository. Check off items as they are finished. Keep each task on a single line. Check off already completed tasks and keep things in chronological order when updating and adding to the file. Follow Template Entry below.

Keep entries one-line, oldest-first. When completing a task, check it off and append a one-line completion note indented underneath (date + PR/link + 1â€“2 sentence summary).

## Template (single-line + optional completion note)

```text
- [ ] Short task description â€” TK-YYYYMMDD-###
```

Completion note (indented, one line):

```text
  - Completed: YYYY-MM-DD â€” PR: <url> â€” short summary
```

---

## Tasks

- [ ] Build the React + Tauri desktop UI that consumes the `PromptVaultService` APIs - TSK-0001 - Status: Not started (source: docs/step-10-final-documentation-summary.md)
- [ ] Automate database migrations and integrate CI pipelines for linting, testing, and release packaging - TSK-0002 - Status: Not started (source: docs/step-10-final-documentation-summary.md)
- [ ] Add data synchronisation and export capabilities for multi-device use cases - TSK-0003 - Status: Not started (source: docs/step-10-final-documentation-summary.md)
- [ ] Restore JavaScript coverage instrumentation (e.g., integrate `@vitest/coverage-v8` or approved alternative) so quality gates can enforce thresholds - TSK-0004 - Status: Blocked on registry access (source: docs/reports/stewards-report.md)
- [ ] Wire `npm run metrics:snapshot` into CI to capture dependency, complexity, and latency artefacts on a scheduled cadence - TSK-0005 - Status: Not started (source: docs/reports/stewards-report.md)
- [ ] Extend the metrics snapshot tooling to emit JSON suitable for dashboarding and automated trend analysis - TSK-0006 - Status: Not started (source: docs/reports/stewards-report.md)
- [ ] Develop optional PostgreSQL or multi-tenant adapters leveraging the repository transaction simplifications for scalability testing - TSK-0007 - Status: Not started (source: docs/reports/stewards-report.md)
- [ ] Containerise the observability stack and CLI doctor workflows to support deployment health diagnostics - TSK-0008 - Status: Not started (source: docs/reports/stewards-report.md)
- [ ] Explore intelligent plugins that leverage telemetry spans without adding service complexity (e.g., AI-assisted tagging) - TSK-0009 - Status: Ideation (source: docs/reports/stewards-report.md)
- [x] Add missing default repository files: `.editorconfig`, `.gitattributes`, and `.github/CODEOWNERS` - TSK-0010 - Completed: 2025-10-30 ([TR-0001](docs/reports/README.md#2025-10-30---chore-add-repo-defaults-and-audit-binaries))
- [x] Review tracked binary assets and define a relocation or ignore strategy aligned with repository policy - TSK-0011 - Completed: 2025-10-30 ([TR-0001](docs/reports/README.md#2025-10-30---chore-add-repo-defaults-and-audit-binaries))
- [ ] Flesh out the scaffolded plugin template by implementing lifecycle hooks emitted by `scripts/scaffold-extension.ts` - TSK-0012 - Status: Not started (source: scripts/scaffold-extension.ts)
- [ ] Provide a downstream metadata sync example for plugins by completing the placeholder in `docs/guides/extension-guide.md` - TSK-0013 - Status: Not started (source: docs/guides/extension-guide.md)
