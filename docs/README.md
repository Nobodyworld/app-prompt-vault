# Prompt Vault documentation

This directory contains product, development, operations, security, and release documentation for Prompt Vault.

> The source code and open release issues are authoritative when an older planning document conflicts with current behavior. Public-showcase blockers are tracked in issue #26.

## Start here

- [Repository overview and release status](../README.md)
- [Getting started index](getting-started/README.md)
- [Standalone dependency matrix](developer-guide/standalone-dependency-matrix.md)
- [Legacy tag/project migration](developer-guide/legacy-tag-migration.md)
- [Developer workflows](developer-guide/workflows.md)
- [Architecture overview](developer-guide/architecture/overview.md)
- [API specification](api-reference/SPEC.md)

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
- Issue #23: runner startup, release-grade CI, and verified artifacts
- Issue #24: completed public documentation, versioning, security contact, and license work
- Issue #25: showcase UX and end-to-end validation
- Issue #26: release tracker
- Issue #28: legacy tag/project sidecar migration and persistence verification
