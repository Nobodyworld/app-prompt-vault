# Data safety and recovery

Prompt Vault recovery uses one normalized domain contract across the desktop,
native SQLite, Node/HTTP, and browser-fallback surfaces. The source preview is
not a release, encryption, cloud backup, or automatic migration feature.

## Backup formats

Backup `2.0` stores format and version markers, one export timestamp, declared
prompt/version counts, complete prompt metadata, deterministic tag order, and
every observable version with semantic version, body, changelog, and timestamps.
Prompts sort by normalized slug and source ID. Versions sort by creation time,
semantic version, SHA-256 body identity, and source ID. Only `exportedAt` may
vary between otherwise identical exports.

Version identity is normalized `MAJOR.MINOR.PATCH`, a null separator, and the
SHA-256 of the exact body. It is a deterministic conflict aid, not a security or
authenticity guarantee. Source IDs are advisory analysis metadata and never
authorize overwriting current records.

Backup `1.0` remains accepted through the production parser. It becomes a
normalized `latest-version-only` recovery document, and the preview warns that
absent history was neither preserved nor verified.

## Validation and planning

The parser rejects invalid JSON, unsupported versions, impossible timestamps,
malformed semantic versions, invalid ratings or tags, duplicate normalized
slugs, duplicate version identities, and inconsistent declared counts. Limits
are 10 MiB of source text, 10,000 prompts, 50,000 versions, 100 KiB per body,
10 tags per prompt, and bounded metadata fields. Errors identify fields without
echoing prompt bodies.

Validation produces a normalized document. Preview compares it with a
fingerprinted current-library snapshot and builds stable ordered plan entries:
new prompt, exact duplicate, slug conflict, mergeable missing versions, or
copy-required conflict. Execution receives that exact plan, revalidates the
document and current-library fingerprints, and rejects stale previews.

## Conflict policies and transactions

- **Skip existing** imports only new normalized slugs and reports existing
  prompts as skipped.
- **Add missing versions** retains the current prompt ID and metadata and adds
  only identities absent from that prompt. Imported timestamps remain intact;
  deterministic reads order by timestamp and identity.
- **Import as copy** preserves the source history under `-imported`,
  `-imported-2`, and later non-colliding slugs with an `(imported copy)` title
  suffix. Newly generated record IDs never reuse source IDs.

Native SQLite and Node execute the chosen plan in one database transaction.
Integrity and foreign-key checks must pass before a successful result is
returned. Tests inject failures after prompt, version, tag, relationship, copy,
and merge writes and require the complete pre-restore snapshot afterward.
Browser fallback snapshots the complete in-memory store, performs all changes,
persists localStorage once, and restores the snapshot if persistence fails.

## Storage and evidence privacy

Native storage status includes the private local database path, file size,
SQLite `user_version`, record counts, WAL/SHM inventory, and integrity status
only when requested. Browser fallback reports localStorage and marks native
SQLite and legacy recovery unavailable. Status never includes prompt bodies,
titles, tags, environment values, or credentials.

The versioned `prompt-vault:last-backup:v1` preference stores only timestamp,
format, prompt/version counts, and verification result. Copyable evidence omits
private paths and source names by default. All local databases, prompt text, and
backup files are plaintext; use operating-system permissions and full-disk
encryption and do not store secrets in prompts.

## Historical Windows database

The native Windows check targets
`%LOCALAPPDATA%\com.promptvault.desktop\prompt-vault.db`. It runs only when the
user requests it, opens SQLite read-only, hashes the source before and after,
does not change journal mode, and never creates, migrates, attaches for writing,
renames, deletes, or vacuums the source. Results are `not-found`, `compatible`,
`unsupported-schema`, `unreadable`, or `corrupt` and contain inventory only.

Explicit recovery reopens and normalizes a compatible source, preserves every
field actually present, and does not invent favorite, rating, category, or
changelog values missing from older schemas. It uses the same preview plan and
transaction engine as JSON recovery, then verifies that the source hash is
unchanged. A missing source is normal; unsupported or corrupt sources permit no
writes. Generated disposable fixtures—not a real historical database—are the
acceptance boundary.

## Verification workflow

An export is reparsed with the production parser and checked for counts and
deterministic ordering before download or last-backup metadata is reported.
The Settings workflow is Choose, Validate, Preview, Policy, Confirm, Execute,
Verify, and Result. Selection, preview, cancellation, and validation failures
perform no writes. A progress state contains duplicate submission, and retry
after stale data requires a fresh preview.
