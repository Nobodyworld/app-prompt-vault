# Prompt Vault project stage snapshot

**Snapshot date:** 2026-09-14

**Current application version:** 0.4.0

**Status:** public source preview / pre-release

**Accepted PR #79 updater-contract baseline:** `d50532778235b5de28b2276adb71ce6a963e427f`

**Baseline workflow:** `34269176064`

**Baseline workflow conclusion:** success

**Historical accepted v0.4 product baseline:** `6b03686df629494d9814ee4c12064556c249622b`

This is a dated repository-truth snapshot, not a live branch pointer. Every later candidate requires its own exact-head validation. The application version records a source milestone; it does not establish a Git tag, GitHub Release, supported installer, signing authority, update channel, or production readiness.

## Repository state

Application-version and repository-truth convergence for 0.4.0 is complete.
Application version and identity are synchronized and mechanically audited
across package, Tauri, Cargo, lockfile, CLI/runtime, changelog, release-note,
and project-stage surfaces.

PR #79 is merged. It adds the deterministic, non-mutating updater contract for
manifest/path/hash/MSI identity validation, three-field MSI version ordering,
installed-target planning, recovery-source checks, and failure classification.
It does not authorize installer execution.

Issue #73 remains the active updater line of work. The next slice is read-only:
collect and reconcile the explicitly selected MSI identity, installed
registration/executable identity, complete prior-installation recovery evidence,
and emit a non-mutating plan. MSI/UAC/process-shutdown mutation remains gated
on separately attended isolated synthetic acceptance.

The old `desktop:refresh-installed` naming is retired because it obscured an
uninstall-first replacement workflow. `desktop:reinstall-local` is the explicit
clean-reinstall path and must not be treated as updater evidence.

External registered native-validation migration remains separately tracked by
issue #64. It is an evidence-ownership improvement, not a Prompt Vault runtime
dependency and not a source-usage prerequisite.

## Current blockers and limitations

- The verified in-place installed updater is not implemented yet.
- Mutating updater execution remains blocked until issue #73's read-only layer
  is complete and the required attended synthetic MSI acceptance passes.
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
- The deterministic non-mutating updater contract is complete and merged through PR #79.
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
| Local install/update workflow | Explicit clean reinstall exists; verified updater remains read-only planning work under #73 |
| Automation and integration | App-owned contracts; external integrations remain optional |
| Documentation and operations | Aligned to the accepted PR #79 baseline, application version 0.4.0, and the active #73 boundary; later heads require exact-head validation |
