# Prompt Vault

> ## PRE-ALPHA SOURCE PREVIEW
>
> **PROPRIETARY SOURCE-AVAILABLE**
>
> **STANDALONE BUILD NOT YET PROVEN**
>
> The current `main` branch is a historical, pre-release development state. It may still depend on legacy private Nobodyworld workspace packages, parent-level configuration, or assumptions that are not present in this repository.
>
> This branch is **not guaranteed to install, build, test, package, migrate data, or run as a standalone checkout**. Draft [PR #27](../../pull/27) is the standalone extraction candidate, but it is not a validated release and must remain draft until its full verification gate passes.
>
> There is no supported downloadable release, installer, hosted service, or production deployment for this repository.

Prompt Vault is an experimental local-first application for collecting, organizing, versioning, and reusing prompts. The repository contains work toward CLI, HTTP, desktop, SQLite, automation, and integration surfaces, but their presence in source does not establish that they are complete or validated on the default branch.

## Repository status

| Item | Status |
| --- | --- |
| Default branch | Historical pre-release development state |
| Public classification | **PRE-ALPHA SOURCE PREVIEW** |
| License | **Proprietary source-available; not open source** |
| Standalone install/build | **Not proven** |
| Release artifacts | None supported |
| Production use | Not supported |
| Standalone extraction candidate | Draft [PR #27](../../pull/27) |

## What public access means

Public access permits inspection and limited evaluation only under the terms in [LICENSE](LICENSE). It does not grant an open-source license, redistribution rights, production-use rights, or permission to create derivative or competing products.

The repository may expose incomplete code, obsolete documentation, unverified commands, experimental migrations, or integration contracts that depend on private Nobodyworld components. Treat all feature descriptions as development intent unless current executable validation proves otherwise.

## Validation limitations

Do not infer any of the following from this repository being public:

- that a clean clone installs successfully;
- that a lockfile has been reviewed or frozen installation is reproducible;
- that unit, integration, coverage, or Playwright tests pass;
- that Rust or Tauri checks pass;
- that a Windows installer has been built or tested;
- that legacy data migration is safe on real data;
- that desktop, HTTP, tool, widget, or Nobodyworld integrations are complete;
- that the default branch has green CI.

A CI badge is intentionally omitted until the default branch has current, successful, reproducible validation.

## Development candidate

Draft [PR #27](../../pull/27) is intended to remove the legacy workspace dependency boundary and establish standalone build evidence. It must not be treated as a release merely because the repository becomes public. Its remaining checks include clean installation, reviewed lockfile generation, Node and browser validation, Rust and Tauri validation, Windows artifact testing, migration verification, restart/persistence testing, and end-to-end product review.

## Security

Do not disclose suspected vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md). The repository owner must confirm GitHub Private Vulnerability Reporting is enabled before public visibility is changed.

## License

Copyright © 2025–2026 Nobody Production. This repository is proprietary source-available software and is **not open source**. Review [LICENSE](LICENSE) before cloning, running, copying, modifying, distributing, or otherwise using the contents.
