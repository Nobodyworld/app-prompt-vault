# Security Policy

## Supported versions

Prompt Vault is currently pre-release. Security fixes are applied to the default branch and the most recent published pre-release only. A formal support matrix will be added with the first stable release.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| `0.2.x` | Yes, while it is the latest pre-release |
| `< 0.2.0` | No |

## Reporting a vulnerability

Do **not** open a public issue for a suspected vulnerability.

Email `security@nobodyworld.com` with:

- a concise description and expected impact;
- affected version, commit, surface, or configuration;
- reproduction steps or a proof of concept;
- any known mitigation;
- whether public disclosure has already occurred.

We aim to acknowledge a report within 48 hours and provide an initial assessment within five business days. These targets are best-effort during the pre-release period and are not a service-level agreement.

## Disclosure process

- We will verify the issue and define a remediation plan.
- Coordinated disclosure is preferred.
- Please avoid publishing exploit details until a fix or mitigation is available.
- Credit will be included in release notes unless anonymity is requested.

## Release hardening checklist

Before publishing a release candidate:

- run the repository quality gate and the full hosted CI matrix;
- review runtime and development dependency advisories;
- run Rust formatting, Clippy, tests, and Tauri packaging;
- verify SQLite foreign keys, busy timeout, and WAL behavior;
- validate all HTTP input and keep request-body limits enabled;
- require authentication and explicit CORS origins for network deployments;
- confirm logs and telemetry contain no prompt bodies, credentials, tokens, or personal data;
- manually test backup, restore, restart, and migration behavior;
- review generated installers and release artifacts before publication.

## Known residual risks

- Prompt content and local SQLite databases are stored in plaintext.
- The local-first threat model relies on operating-system permissions and full-disk encryption.
- Authentication is optional by default for local use; network deployments must explicitly enable it.
- Audit events are held in memory and are not a durable compliance log.
- Dependency scanning may be incomplete when package registries are unavailable; release CI must not silently treat an unavailable audit as proof of safety.
- The repository currently depends on shared Nobodyworld workspace packages; clean-clone reproducibility is tracked in issue #22.
