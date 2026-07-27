# Dependency Inventory

This inventory reflects `package.json` on the active pre-release branch. The package is private and pinned to Node 24 plus pnpm 10.24.0 while release validation remains incomplete.

## Standalone boundary

- No private `@nw/*` dependency is declared.
- No `workspace:*` version is declared.
- No parent repository package or type path is required by the source graph.
- `better-sqlite3` and `esbuild` are the only install scripts explicitly allowed through `pnpm.onlyBuiltDependencies`.
- The repository still requires a reviewed `pnpm-lock.yaml` and frozen clean-install proof.

## Runtime dependencies

| Package | Version | Purpose | Operational notes |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | `^1.21.1` | MCP transport and protocol surfaces. | Keep network/tool exposure authenticated and reviewed. |
| `@tauri-apps/api` | `^2.0.0` | Browser-side Tauri integration. | Must remain compatible with the pinned Rust/Tauri configuration. |
| `better-sqlite3` | `^12.4.1` | Main prompt database, tag/project sidecar, and migration tooling. | Native build; explicitly allowed by pnpm. Validate Node 24 binaries and advisories. |
| `chalk` | `^5.6.2` | CLI output formatting. | ESM-only. |
| `commander` | `^14.0.2` | CLI command parsing. | Validate CLI help and argument errors. |
| `cors` | `^2.8.5` | Express CORS middleware. | Network deployments require explicit origins. |
| `express` | `^4.21.2` | Optional HTTP API and observability endpoints. | Keep body limits, auth, rate limiting, and error handling enabled. |
| `react` / `react-dom` | `^19.2.0` | Desktop/web renderer. | Validate supported browser/webview behavior. |
| `react-error-boundary` | `^6.0.0` | Renderer error containment. | Startup failures must remain visible. |
| `react-router` | `^8.3.0` | Client-side routing. | Playwright should cover primary navigation. |
| `simple-git` | `^3.30.0` | Git-related prompt workflows. | Treat repository paths and subprocess failures as untrusted input. |
| `yaml` | `^2.8.1` | YAML import/export. | Preserve size limits and schema validation. |
| `zod` | `^4.1.12` | Runtime input/configuration validation. | Keep schemas authoritative at trust boundaries. |

## Development and validation dependencies

| Group | Key packages | Purpose |
| --- | --- | --- |
| TypeScript | `typescript`, `tsx`, `ts-node`, `tslib`, `@types/*` | Compilation, tooling, and declarations. |
| Linting | `eslint`, `@eslint/js`, `typescript-eslint`, `@typescript-eslint/*`, `globals` | ESLint 9 flat-config validation. |
| Unit/integration | `vitest`, `@vitest/coverage-istanbul`, `@vitest/coverage-v8`, `supertest`, `jsdom` | Service, persistence, HTTP, migration, and coverage tests. |
| UI/E2E | `@playwright/test`, Testing Library packages | Browser shell and primary-flow validation. |
| Desktop build | `vite`, `@vitejs/plugin-react`, `@tauri-apps/cli` | Renderer assets and native packaging. |
| Portability | `cross-env` | Cross-platform environment scripts. |

## Rust/native dependencies

The authoritative Rust inventory is `src-tauri/Cargo.toml` and its lockfile. The native `nw-secrets` crate is vendored under `src-tauri/crates/nw-secrets`; it does not reference a parent workspace path.

Native validation requires:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:build
```

## Security and maintenance practices

- Use `pnpm audit` and Rust advisory tooling when registry access is available.
- Keep Dependabot updates bounded and require full-SHA pinning for GitHub Actions.
- Review native install scripts and generated lockfile changes before merging.
- Do not treat an unavailable registry, failed runner startup, or skipped audit as proof of safety.
- Update this inventory whenever a dependency or supported runtime changes.

## Current validation limitation

GitHub runner jobs currently fail before their first step. The versions above are declared and statically reviewed, but current-head installation, audit, lint, build, test, and packaging results remain unproven under issue #23.
