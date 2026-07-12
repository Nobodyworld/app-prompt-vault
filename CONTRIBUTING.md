# Contributing to Prompt Vault

Prompt Vault is proprietary source-available software maintained by Nobody Production. External bug reports and focused pull requests may be considered, but repository access does not grant a general right to modify, redistribute, or deploy the software. Review [LICENSE](LICENSE) before contributing.

## Current repository topology

This repository is maintained as an application component of the Nobodyworld workspace. It currently imports private/shared `@nw/*` packages, parent-level Vitest configuration, and a native secrets package outside this repository.

Until issue #22 is complete, the supported development path is the internal Nobodyworld workspace checkout:

```bash
# From the Nobodyworld workspace root
pnpm install
pnpm --filter prompt-vault repository:audit
pnpm --filter prompt-vault typecheck
pnpm --filter prompt-vault test
pnpm --filter prompt-vault desktop:build
```

Do not claim that a standalone clone is supported unless the clean-clone acceptance criteria in issue #22 pass in hosted CI.

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

When the parent workspace is unavailable, state exactly which checks could not run and why. Do not replace missing verification with a claim that the change is production-ready.

## Change requirements

- Keep prompt bodies, credentials, tokens, and personal data out of logs, fixtures, screenshots, and telemetry.
- Add or update migrations rather than editing deployed schemas manually.
- Preserve local-first behavior and make network exposure opt-in and explicit.
- Add tests for changes to validation, persistence, migrations, HTTP contracts, Tauri commands, or import/export formats.
- Keep public documentation aligned with actual scripts and supported installation paths.
- Record confirmed out-of-scope defects in GitHub issues and link them from the pull request.

## Documentation

- [Repository overview](README.md)
- [Documentation index](docs/README.md)
- [Developer workflows](docs/developer-guide/workflows.md)
- [Security policy](docs/security/policies/security.md)
- [Public showcase tracker](../../issues/26)
