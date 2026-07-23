# Agent Instructions

Use these rules for automated changes in `app-prompt-vault`.

## Non-negotiables

- Windows + Tauri is the primary packaged target.
- Preserve local-first behavior and make network exposure explicit.
- Do not add private `@nw/*`, `workspace:*`, parent-repository paths, or hidden monorepo prerequisites.
- Optional Hub/Nobodyworld integrations must consume app-owned contracts through separate adapters.
- Do not claim checks passed unless their command actually ran on the current head.
- Record confirmed out-of-scope defects in GitHub issues rather than burying them in handoff prose.

## Start here

- `README.md`
- `CONTRIBUTING.md`
- `docs/developer-guide/standalone-dependency-matrix.md`
- `docs/developer-guide/legacy-tag-migration.md`
- `docs/developer-guide/workflows.md`
- Issues #22, #23, #25, #26, and #28

## Required workflow

1. Inspect current PR/issue state before changing files.
2. Keep the branch synchronized without rewriting unrelated work.
3. Prefer the smallest change that preserves the standalone boundary.
4. Add or update tests for persistence, migration, auth, tools, widgets, HTTP contracts, or native behavior.
5. Run the relevant checks when execution is available.
6. Report exact commands, exit results, current SHA, and any unavailable verification.
7. Keep the PR and governing issues synchronized with what is actually complete.

## Database rules

- Use versioned migrations for the main Prompt Vault database.
- Keep tag/project associations in the app-owned sidecar.
- Never open the main Prompt Vault database or a legacy Core DB as the new sidecar.
- Legacy Core DB migration must use a separate target, start with `--dry-run`, open the source read-only, and remain transactional/idempotent.
- Test fresh creation, upgrades, malformed inputs, repeat execution, restart, and persistence.

## Security rules

- JWT issuance requires an explicitly injected `JWT_SECRET`; do not introduce a process-local signing fallback. Public-network deployment is unsupported.
- Keep prompt bodies, credentials, tokens, and personal data out of logs, events, telemetry, screenshots, and fixtures.
- Preserve authentication, scoped API keys, rate limits, request IDs, and explicit CORS origins.
- Do not expose write tools or administrative routes without authorization and confirmation controls.

## Tool and widget rules

- Keep `pv_*` tool names and parameter/result contracts stable.
- Register tools through `src/lib/platform-orchestrator.ts`.
- Register widget metadata through `src/lib/platform-pages-widgets.ts`.
- External transports translate these app-owned registries; Prompt Vault must not import a platform SDK to function.

## Validation target

When a runner or local checkout is available:

```bash
pnpm install --frozen-lockfile
pnpm repository:audit
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:coverage
pnpm test:ui
pnpm desktop:build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:build
```

The repository currently lacks a reviewed lockfile and GitHub runner startup is blocked. Do not substitute static review for these execution results.
