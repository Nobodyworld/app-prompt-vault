# Prompt Vault documentation

This directory contains product, development, operations, security, and release documentation for Prompt Vault.

> Source code, the repository README, and open release issues are authoritative when an older planning document conflicts with current behavior. Public-showcase blockers are tracked in issue #26.

## Start here

- [Repository overview and release status](../README.md)
- [Standalone product experience and validation record](product-experience.md)
- [Getting started index](getting-started/README.md)
- [Standalone dependency matrix](developer-guide/standalone-dependency-matrix.md)
- [Legacy tag/project migration](developer-guide/legacy-tag-migration.md)
- [Developer workflows](developer-guide/workflows.md)
- [Architecture overview](developer-guide/architecture/overview.md)
- [API specification](api-reference/SPEC.md)

## Product guidance

- The Library is the primary surface.
- Create, search, copy, edit, and backup are the everyday workflow.
- Raw bundle text, cross-app payloads, and bulk administration are advanced tools.
- The desktop app is independent even when integrated into a larger Nobodyworld system.
- Windows uninstall currently preserves the local Prompt Vault database.

See [Product experience](product-experience.md) for the detailed hierarchy, exact-head local validation record, installer hashes, and current/legacy data-location findings.

## Development and automation

- [Contributing guide](../CONTRIBUTING.md)
- [Agent instructions](AGENT_INSTRUCTIONS.md)
- [Developer agent notes](developer-guide/AGENTS.md)
- [Extension guide](developer-guide/guides/extension-guide.md)
- [Git integration](developer-guide/git-integration.md)

## Operations

- [Operations index](operations/README.md)
- [Automation operations](operations/automation.md)
- [Automation roles](operations/automation-roles.md)
- [Performance notes](operations/performance-notes.md)
- [Telemetry guidance](operations/telemetry.md)

## Security

- [HTTP and deployment security guide](SECURITY.md)
- [Security reporting policy](security/policies/security.md)
- [Dependency inventory](operations/DEPENDENCIES.md)

## Releases

- [Release notes](releases/notes.md)
- [Changelog](../CHANGELOG.md)
- [Project stage snapshot](../project-stage-snapshot.md) — historical assessment; verify against current source and issues

## Current release blockers

- Issue #22: reviewed lockfile and clean-clone reproducibility proof
- Issue #23: release-grade validation and verified artifacts
- Issue #25: standalone UX, primary-flow automation, screenshots, and native acceptance
- Issue #26: governing release tracker
- Issue #28: legacy tag/project sidecar migration and persistence verification
- Issue #29: legacy session-token decision and auth review
- Issue #32: advisory reconciliation and artifact acceptance
- Issue #36: application coverage target or approved threshold
