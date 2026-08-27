# Prompt Vault project stage snapshot

**Snapshot date:** 2026-08-27

**Current application version:** 0.4.0

**Status:** public source preview / pre-release

**Accepted v0.4 product baseline:** `6b03686df629494d9814ee4c12064556c249622b`

**Default-branch workflow:** `33031847574`

**Default-branch workflow conclusion:** success

This is the current repository-truth snapshot. The application version records
a source milestone; it does not establish a Git tag, GitHub Release, supported
installer, signing authority, update channel, or production readiness.

## Current work

Issue #71 is the version and repository-truth convergence slice for the accepted
v0.4 product baseline. It aligns package, Tauri, Cargo, lockfile, CLI, changelog,
release-note, and project-stage identity at application version 0.4.0 and adds
mechanical drift prevention.

External registered native-validation migration remains separately tracked by
issue #64. It is an evidence-ownership improvement, not a Prompt Vault runtime
dependency and not a source-usage prerequisite.

## Current blockers and limitations

- Signed and supported distribution remains disabled.
- No GitHub Release exists.
- No public update channel exists.
- Prompt content, backups, and databases remain plaintext.
- Public-network deployment remains unsupported; the optional HTTP surface is
  loopback-only.
- A future signing, distribution, release, updater, encryption, or
  public-network decision requires separate authorization and acceptance.

Installer validation is optional build evidence for the source preview, not a
product blocker for cloning, building, or using the source within the current
license and documented local-only boundaries.

## Completed product and repository milestones

- The v0.4 data-safety and recovery milestone is complete.
- The standalone dependency boundary is complete: the app has no required
  parent-repository, private `@nw/*`, or `workspace:*` dependency.
- The app-tier coverage gate is complete.
- The earlier public-showcase planning issues #22 through #26 are completed
  historical milestones and are not current blockers.
- The v0.3 daily Library workspace is the completed 0.3.0 application milestone.

## Surface status

| Surface | Current assessment |
| --- | --- |
| Domain service and SQLite | Working local-first product baseline with explicit plaintext-data limitations |
| CLI and loopback HTTP API | Standalone application surfaces; public-network deployment unsupported |
| React Library and Settings | Daily Library plus verified backup, preview, and recovery workflows |
| Tauri application | Local source-buildable pre-release; unsigned artifacts are validation evidence only |
| Automation and integration | App-owned contracts; external integrations remain optional |
| Documentation and operations | Aligned to application version 0.4.0 and the accepted v0.4 baseline |
