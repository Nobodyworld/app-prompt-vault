# Prompt Vault documentation

This directory contains product, development, operations, security, and release documentation for Prompt Vault.

> Source code, the repository README, current acceptance records, and open governing issues are authoritative when an older planning document conflicts with current behavior. Closed issue #26 is historical planning context, not a current governing release gate.

## Start here

- [Repository overview and release status](../README.md)
- [Standalone product experience and validation record](product-experience.md)
- [Getting started index](getting-started/README.md)
- [Windows local desktop workflow](developer-guide/windows-local-desktop-workflow.md)
- [Data safety and recovery](developer-guide/data-safety-recovery.md)
- [Application version policy](developer-guide/version-policy.md)
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
- `desktop:reinstall-local` is an explicit uninstall-first clean reinstall; it is not an updater.
- `desktop:refresh-installed` is retired, and issue #73 owns the not-yet-enabled verified installed-update path.

See [Product experience](product-experience.md) for the detailed hierarchy and validation context, and [Windows local desktop workflow](developer-guide/windows-local-desktop-workflow.md) for the current install/update boundary.

## Development and automation

- [Contributing guide](../CONTRIBUTING.md)
- [Agent instructions](AGENT_INSTRUCTIONS.md)
- [Developer agent notes](developer-guide/AGENTS.md)
- [Application version policy](developer-guide/version-policy.md)
- [Windows local desktop workflow](developer-guide/windows-local-desktop-workflow.md)
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
- [Current project stage snapshot](../project-stage-snapshot.md)

## Current product status

- Prompt Vault remains a proprietary source-available source preview with no supported downloadable release or GitHub Release.
- Current application version is 0.4.0.
- PR #79's accepted deterministic updater-contract baseline is `d50532778235b5de28b2276adb71ce6a963e427f`; default-branch workflow `34269176064` passed on that exact commit. This is an acceptance record, not a live `main` pointer; later candidates require their own exact-head validation.
- The accepted v0.4 data-safety/recovery milestone remains historical baseline `6b03686df629494d9814ee4c12064556c249622b`; later validated work does not rewrite that milestone.
- The next issue #73 slice is read-only selected-MSI, installed-identity, recovery-evidence, and update planning. MSI/UAC mutation remains separately gated.
- Unsigned workflow installers remain validation evidence only.
