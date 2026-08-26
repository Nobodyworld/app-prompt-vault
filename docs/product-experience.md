# Prompt Vault product experience

Prompt Vault is an independent local-first application. It may participate in a larger Nobodyworld ecosystem, but the desktop product must remain understandable and useful without a parent repository, shared shell, private package, or cross-app integration.

## Product promise

The everyday workflow is intentionally small:

1. Create or import a prompt.
2. Find it quickly.
3. Copy it with one action.
4. Edit or version it when it changes.
5. Back it up without losing local ownership.

The Library is the primary product surface. Raw interoperability payloads, bundle text, cross-app exports, and bulk administration are secondary tools and must not dominate the default view.

## Information hierarchy

### Primary

- Library
- Search, sorting, and fast filters
- Copy
- In-place favorite control
- New prompt
- Edit prompt

### Secondary

- Optional tag and category filters
- Theme and window placement
- Verified full-history backup export and previewed recovery
- Version-history preview and bounded comparison

### Advanced

- JSON/YAML bundle tooling
- Buttons switchboard payloads
- Planner bucket drafts
- Bulk tagging and deletion
- Compatibility and migration utilities

Advanced tools remain available at `/advanced`, linked from Settings rather than the primary navigation.

## Daily Library workspace

The Library organizes prompts locally without adding a server-side preference
or database column:

- the default order is favorites first and then most recently updated;
- alternate orders are recently updated, title A–Z, and rating high-to-low
  with unrated prompts last;
- the selected order is stored under
  `prompt-vault:library-sort:v1`, with unknown or unreadable values falling
  back to the default;
- query, Favorites, tag, and category filters combine locally before sorting,
  and one Reset all action clears the full filter state;
- every row keeps copy as its primary action while exposing category, rating,
  useful tag context, timestamps, Edit, and a persisted favorite control;
- Up and Down choose a visible row, Enter copies it, E opens Edit, and F changes
  favorite state. These row shortcuts are scoped to the Library and pause while
  an input, textarea, select, button, link, or contenteditable element owns
  focus;
- `Ctrl/Cmd+N`, `Ctrl/Cmd+K`, and Escape retain their create, search-focus, and
  Library-reset behavior.

Favorite changes reuse the existing cross-platform prompt-update boundary. The
row updates immediately, suppresses duplicate writes for the same prompt, and
reconciles the persisted response. A failed write restores the prior favorite
state and order and produces actionable feedback.

## Shared web and desktop UI

Prompt Vault uses one React/Vite interface under `desktop/src` for both browser development and the Tauri desktop application. Rust supplies native persistence and operating-system capabilities; it does not maintain a second UI implementation.

Development modes:

- `pnpm desktop:dev` — shared frontend in a browser;
- `pnpm tauri:dev` — the same frontend in a native development WebView with hot reload;
- `pnpm desktop:preview-release` — optimized release executable without Windows installation;
- `pnpm desktop:refresh-installed` — Windows-only rebuild, MSI replacement, and launch of the refreshed installed copy.

See [Windows local desktop workflow](developer-guide/windows-local-desktop-workflow.md).

## Local data behavior

The Tauri identifier is `com.nobodyworld.promptvault`. On Windows, the current application database is stored beneath:

```text
%LOCALAPPDATA%\com.nobodyworld.promptvault\prompt-vault.db
```

Manual exact-head testing on July 15, 2026 established that uninstalling Prompt Vault 0.2.0 preserves this local database. Reinstalling the same application identifier and version reopened the preserved database and restored the recently created prompt.

An older installation used a separate identifier and database:

```text
%LOCALAPPDATA%\com.promptvault.desktop\prompt-vault.db
```

The current application does not overwrite that legacy database. The recovery
center inspects it only after the user requests a native Windows check. A
compatible source can be previewed and explicitly restored through the same
conflict engine as a JSON backup; it is never imported at startup, migrated in
place, renamed, or deleted.

### Data safety and recovery

Settings presents storage facts without prompt content, offers a verified
backup `2.0` export containing complete observable version history, and uses a
deliberate choose, validate, preview, policy, confirm, execute, and verify
workflow. Selection, validation, preview, and cancellation do not mutate data.
Execution rejects a stale preview and applies its displayed deterministic plan
inside one transaction.

Conflict policies are explicit: skip existing prompts, add only missing version
identities without overwriting current metadata, or import a complete history
as a deterministically named copy. Backup `1.0` remains readable, but its
preview states that it contains only the latest version. Browser fallback
reports localStorage limitations honestly and uses one snapshot/persist step
with rollback on failure.

The last-backup preference contains only timestamp, format, counts, and export
verification status. Prompt content, source paths, credentials, and environment
data are excluded. Prompt content, SQLite files, and exported backups remain
plaintext local data; the feature does not provide encryption at rest,
automatic backups, cloud sync, or a supported distribution channel.

The current uninstall behavior is data-preserving. Documentation must not imply that uninstall deletes prompts. A future delete-local-data flow, if added, should be explicit and separate from routine uninstall.

## Accepted default-branch validation record

The completed v0.3 daily Library workspace is merged on `main` at exact commit
`34e710c08b5a28b381f3080e4b022bb317a00117`. The earlier accepted standalone
validation record passed Public-release invariants, Rust validation, Windows
Tauri bundle, and Standalone Node validation.

Recorded totals:

```text
Vitest:     277 / 277 across 41 files
Playwright: 9 / 9
Rust tests: 6 / 6
```

| Dimension | Covered / total | Result | Configured app threshold |
| --- | ---: | ---: | ---: |
| Statements | 2,843 / 3,639 | 78.12% | >= 60% |
| Branches | 1,450 / 2,383 | 60.84% | >= 50% |
| Functions | 634 / 777 | 81.59% | >= 55% |
| Lines | 2,770 / 3,511 | 78.89% | >= 60% |

The measured percentages are not required floors. No supported downloadable
release or GitHub Release exists. Unsigned workflow-produced installers are
validation evidence only.

The accepted real historical migration exercise observed one project-tag
metadata row and no relationship/tagging rows in qualifying sources. It proves
the metadata-only path and must not be represented as observed historical
relationship migration.

## Known follow-up work

- improve protection and user guidance for plaintext prompt, backup, and
  database data;
- produce accurate screenshots or a short demo only after the current product
  state is accepted;
- treat signing, installer distribution, and any release decision as separate
  reviewed work. Prompt Vault remains a proprietary source-available preview
  with a loopback-only optional network boundary.
