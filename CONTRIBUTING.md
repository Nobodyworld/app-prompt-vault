# Contributing to Prompt Vault

Prompt Vault is proprietary source-available software maintained by Nobody Production. External bug reports and focused pull requests may be considered, but repository access does not grant a general right to modify, redistribute, or deploy the software. Review [LICENSE](LICENSE) before contributing.

## Current repository status

The source tree is self-contained: it declares no `workspace:*` dependencies, private `@nw/*` packages, parent-level configuration, or native package paths outside this repository.

The repository contains reviewed `pnpm-lock.yaml` and `src-tauri/Cargo.lock` files. Clean-checkout Node, Playwright, Rust, Tauri, Windows packaging, restart, persistence, and database-preservation validation established the standalone **source-preview** boundary. The completed v0.3 daily Library workspace is merged on `main` at:

```text
34e710c08b5a28b381f3080e4b022bb317a00117
```

That evidence does not authorize a supported downloadable release, signed installer, production deployment, or public-network service. Every new candidate still requires validation at its exact final commit. Current product work is tracked by [issue #58](../../issues/58), and reusable native-validation ownership is tracked separately by [issue #64](../../issues/64).

## Toolchain and bootstrap

Use:

- Node.js 24.x;
- pnpm `10.24.0`;
- the Rust toolchain and platform prerequisites required by Tauri 2.

Install only from the committed lockfile:

```bash
pnpm install --frozen-lockfile
```

Do not hand-edit lockfile resolution or integrity data. Dependency changes must be regenerated with pnpm and reviewed as part of the change.

## Before opening a pull request

Run the checks relevant to the change. The standard Node and UI matrix is:

```bash
pnpm audit --prod --audit-level=high
pnpm repository:audit
pnpm lint
pnpm typecheck
pnpm build
pnpm test:coverage
pnpm coverage:summary
pnpm test:ui
pnpm security:scan
git diff --check
```

Native or Tauri changes should also pass:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo tree --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --invert glib
cargo audit --file src-tauri/Cargo.lock
pnpm tauri:build
```

Documentation-only changes should at minimum pass `pnpm repository:audit` and `git diff --check`, followed by the repository's exact-head hosted checks.

State exactly which checks ran, their results, and which checks were not run. A passing older commit does not validate a newer head. Do not replace missing verification with a production-readiness, release-readiness, or migration-safety claim.

## Working and delivery rules

- Start material work from an exact accepted base in a focused branch, isolated worktree, or isolated clone.
- Do not clean, reset, overwrite, or repurpose a protected or dirty primary checkout.
- Use disposable databases and synthetic prompt content for development and acceptance.
- Keep the normal Prompt Vault database and historical source databases unchanged unless the owner explicitly authorizes a reviewed operation.
- Open material work as a focused pull request, normally in draft state.
- Keep pull requests unmerged until review, final-head validation, required native acceptance, and explicit owner authorization are complete.
- Do not enable auto-merge, publish a release, distribute an installer, sign artifacts, or change repository visibility as part of ordinary contribution work.

## Change requirements

- Keep prompt bodies, credentials, tokens, personal data, private paths, and environment dumps out of logs, fixtures, screenshots, telemetry, and public evidence.
- Add or update migrations rather than editing deployed schemas manually.
- Preserve local-first behavior and keep supported HTTP, metrics, and development-server surfaces loopback-only.
- Add tests for changes to validation, persistence, migrations, HTTP contracts, Tauri commands, authentication, or import/export formats.
- Keep public documentation aligned with actual scripts, product behavior, and supported installation paths.
- Do not introduce private workspace packages, parent-repository paths, or sibling applications as prerequisites for the standalone product.
- Record confirmed out-of-scope defects in GitHub issues and link them from the pull request.
- Do not weaken coverage, audit, security, migration, or acceptance gates merely to obtain a passing result.

## Security reports

Do not disclose suspected vulnerabilities in a public issue, pull request, discussion, log, or screenshot. Follow [SECURITY.md](SECURITY.md).

## Documentation

- [Repository overview](README.md)
- [Documentation index](docs/README.md)
- [Standalone dependency matrix](docs/developer-guide/standalone-dependency-matrix.md)
- [Developer workflows](docs/developer-guide/workflows.md)
- [Security policy](docs/security/policies/security.md)
- [Current data-safety milestone](../../issues/58)
