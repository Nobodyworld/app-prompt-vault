# Contributing to Prompt Vault

Prompt Vault is proprietary source-available software maintained by Nobody Production. External bug reports and focused pull requests may be considered, but repository access does not grant a general right to modify, redistribute, or deploy the software. Review [LICENSE](LICENSE) before contributing.

## Current repository topology

The source tree is now self-contained: it declares no `workspace:*` dependencies, private `@nw/*` packages, parent-level configuration, or native package paths outside this repository.

A standalone release is still **not proven**. The repository currently lacks a reviewed `pnpm-lock.yaml`, and the complete Node, Playwright, Rust, Tauri, Windows artifact, restart, and persistence validation matrix remains open in issues #22 and #23.

The intended bootstrap path is:

```bash
corepack enable
pnpm install
pnpm repository:audit
pnpm typecheck
pnpm test
pnpm desktop:build
```

Do not claim that a standalone clone or downloadable release is supported until the clean-clone acceptance criteria pass with a frozen lockfile in hosted CI.

## Before opening a pull request

Run the checks relevant to your change:

```bash
pnpm repository:audit
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:ui
pnpm desktop:build
pnpm tauri:build
```

Native changes should also pass:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

State exactly which checks ran, their results, and which checks could not run. Do not replace missing verification with a claim that the change is production-ready.

## Change requirements

- Keep prompt bodies, credentials, tokens, and personal data out of logs, fixtures, screenshots, and telemetry.
- Add or update migrations rather than editing deployed schemas manually.
- Preserve local-first behavior and make network exposure opt-in and explicit.
- Add tests for changes to validation, persistence, migrations, HTTP contracts, Tauri commands, or import/export formats.
- Keep public documentation aligned with actual scripts and supported installation paths.
- Do not introduce private workspace packages or parent-repository paths into the standalone source boundary.
- Record confirmed out-of-scope defects in GitHub issues and link them from the pull request.

## Documentation

- [Repository overview](README.md)
- [Documentation index](docs/README.md)
- [Standalone dependency matrix](docs/developer-guide/standalone-dependency-matrix.md)
- [Developer workflows](docs/developer-guide/workflows.md)
- [Security policy](docs/security/policies/security.md)
- [Public showcase tracker](../../issues/26)
