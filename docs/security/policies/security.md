# Security Policy

## Supported versions

Prompt Vault is a **PRE-ALPHA SOURCE PREVIEW**. Security fixes are applied to the default branch and the active pre-release candidate when practical. There is no supported production release or service-level agreement.

| Version | Supported |
| --- | --- |
| `main` | Best-effort pre-release fixes |
| Draft PR #27 | Active standalone candidate; not a release |
| Published installers/releases | None |

## Reporting a vulnerability

Do **not** open a public issue or discussion containing vulnerability details.

Use GitHub Private Vulnerability Reporting through the repository **Security** tab and select **Report a vulnerability**. Before public visibility is enabled, the owner must confirm that this feature is enabled and visible.

If private vulnerability reporting is unavailable, do not disclose details publicly. Wait for the repository owner to publish a verified private reporting channel.

Include:

- a concise description and expected impact;
- affected version, commit, branch, surface, or configuration;
- reproduction steps or a proof of concept;
- any known mitigation;
- whether public disclosure has already occurred.

Acknowledgement and assessment targets are best-effort during the pre-release period and are not a service-level agreement.

## Disclosure process

- We will verify the issue and define a remediation plan.
- Coordinated disclosure is preferred.
- Please avoid publishing exploit details until a fix or mitigation is available.
- Credit may be included in release notes unless anonymity is requested.

## Release hardening checklist

Before publishing a validated release candidate:

- run the repository quality gate and full hosted CI matrix;
- review runtime and development dependency advisories;
- run Rust formatting, Clippy, tests, and Tauri packaging;
- verify SQLite foreign keys, busy timeout, WAL behavior, migration, restart, and persistence;
- validate all HTTP input and keep request-body limits enabled;
- require authentication and explicit CORS origins for network deployments;
- confirm logs and telemetry contain no prompt bodies, credentials, tokens, or personal data;
- review generated installers and release artifacts before publication.

## Known residual risks

- Prompt content and local SQLite databases are stored in plaintext.
- The local-first threat model relies on operating-system permissions and full-disk encryption.
- Authentication is optional by default for local use; network deployments must explicitly enable it.
- Audit events are held in memory and are not a durable compliance log.
- Dependency scanning may be incomplete when package registries are unavailable; unavailable scanning is not proof of safety.
- Draft PR #27 has removed declared private workspace dependencies, but clean standalone installation, builds, tests, packaging, migration, and persistence remain unproven until the release gate passes.
