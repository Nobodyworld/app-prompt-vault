# Application version policy

`package.json` is the canonical source for the Prompt Vault application
version. The version-surface tooling synchronizes and audits the Tauri config,
Cargo package metadata, the local `prompt-vault-app` block in `Cargo.lock`, the
CLI/runtime version module, and the current-version field in the project-stage
snapshot. Synchronization validates every target and computes the complete
change set before writing, so missing, duplicate, malformed, or ambiguous
targets fail closed.

Application versions 0.3.0 and 0.4.0 identify completed source milestones: the
daily Library workspace and the data-safety and recovery baseline,
respectively. An application version does not imply that a release was
published.

The following remain separate authorization and acceptance gates:

- public source-preview access;
- creation of a Git tag;
- creation of a GitHub Release;
- signing or supported installer distribution;
- creation of a public update channel or update feed;
- any production-readiness or public-network deployment claim.

Unsigned workflow or local build artifacts are validation evidence only. They
are not supported distribution artifacts.

Application versions, database schema versions, and backup format versions are
separate concepts. Changing the application version must preserve the
`com.nobodyworld.promptvault` application identifier and existing data paths
unless a separately authorized migration changes them. It must not silently
change database schema, backup compatibility, or recovery behavior.

Use `pnpm version:check` to audit current alignment. Use
`pnpm release:prepare -- <MAJOR.MINOR.PATCH>` only to prepare a source milestone:
the command synchronizes every managed application-version surface and adds
truthful source-preview documentation scaffolding. It does not tag, publish,
sign, install, launch, update a database, or create a release or update feed.

A future updater must rely on trusted release metadata. Designing that trust,
publication, signing, distribution, and rollback boundary is a separate
milestone and is not part of the current application-version policy.
