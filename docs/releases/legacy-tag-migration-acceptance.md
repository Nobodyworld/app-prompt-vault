# Legacy tag migration acceptance

This report records disposable Windows acceptance of the app-owned legacy
tag/project migration on 2026-07-25. It is evidence for the draft PR #27 stack;
it is not a release, production-readiness, or public-deployment claim.

## Accepted candidate and environment

- parent commit:
  `64b675971df468f7a47fc835d80f2828d132a48e`;
- Windows x86_64;
- Node `v24.12.0` from the required Node 24.12.0 installation;
- pnpm `10.24.0`;
- `better-sqlite3` bundled SQLite `3.53.2`.

The primary checkout and both normal Prompt Vault databases were excluded. All
writes used a new disposable directory outside the repository.

## Discovery and immutable-copy evidence

Discovery was bounded to Local AppData, Roaming AppData, Documents, and Desktop.
It excluded Git, dependency, build, coverage, package-store, temporary,
recycle-bin, and disposable acceptance trees, plus both normal Prompt Vault
database paths.

The prioritized-name pass found 46 SQLite candidates. A follow-up pass over all
`*.db`, `*.sqlite`, and `*.sqlite3` files in the same bounded roots found 545
candidate paths, 486 SQLite headers, and three databases with the complete
legacy Core signature. Their tag/tagging counts were `1/0`, `0/0`, and `0/0`.
The only non-empty candidate was selected.

The selected source was never used as a target or runtime database. Before and
after the copy it remained:

- size: `294,912` bytes;
- SHA-256:
  `02e2c7ba31b15d8d5ca3503ace3c8858701bc042dcb66c0800f0bcee9954524c`;
- created: `2025-12-08T23:11:40.899Z`;
- metadata change time: `2026-05-08T03:03:45.847Z`;
- modified: `2025-12-08T23:13:50.651Z`.

WAL and SHM sidecars were present. The database file and WAL were content- and
metadata-stable during the online backup. SHM content was byte-stable; only SHM
reader-lock timestamps changed while SQLite held the read-only connection.

The authoritative copy was produced with the `better-sqlite3` online backup API.
Its evidence is:

- size: `294,912` bytes;
- SHA-256:
  `bef74c4276160601edab0bfdd532bbd0a8a28db07cbc7835c89b58d5135dc009`;
- source integrity: `ok`;
- source foreign-key violations: `0`;
- copy integrity: `ok`;
- copy foreign-key violations: `0`;
- journal mode recorded by the copy: `wal`.

## Sanitized source signature

The copy has 24 tables. The required markers are present:
`schema_migrations`, `settings`, `pages`, `tags`, and `taggings`.

The observed legacy columns are:

- `tags`: `id`, `name`, `type`, `color`, `description`, `is_archived`,
  `created_at`, `updated_at`;
- `taggings`: `id`, `tag_id`, `entity_type`, `entity_id`, `context`,
  `created_at`.

The normalized schema digest is
`418019480d6518966c0b2b2c27ca164995e4e6096b28b048218842e0f3b0c0ee`.
Sanitized data counts are:

| Measure | Count |
| --- | ---: |
| Tables | 24 |
| Tags | 1 |
| Taggings | 0 |
| Project-kind or project-prefixed tags | 1 |
| Orphan taggings | 0 |
| Blank required tag values | 0 |
| Blank required tagging values | 0 |

The only tag type was `project` with one row. There were no tagging entity types.
The tag creation and update timestamp was `2025-12-08 23:13:43`.

No prompt body, private tag name, description, local source path, API key, or
user-specific identifier is included in this report.

## Dry run and migration

The dry run used the online-backup copy and a confirmed nonexistent target:

```text
pnpm tags:migrate-legacy -- --source <source-copy> --target <new-sidecar> --dry-run
```

It exited `0`, reported one source tag and zero source taggings, planned no
writes, left the target nonexistent, and left the source-copy hash unchanged.

The real command omitted `--dry-run`. It exited `0` and reported:

| Result | Count |
| --- | ---: |
| Source tags | 1 |
| Source taggings | 0 |
| Inserted tags | 1 |
| Updated tags | 0 |
| Reused tags | 0 |
| Inserted taggings | 0 |
| Skipped taggings | 0 |

The target contains only app-owned `tags` and `taggings` tables plus their
indexes. It contains no `prompts` or `prompt_versions` table. Integrity is `ok`,
foreign-key violations are `0`, all observed tag metadata matches the source,
and the initial canonical logical-content SHA-256 is
`ac5e7632df96e0f400b648ee13253a04e3b42f1c34f634109e8fc0b0d3c2e189`.

## Runtime, restart, and backup

The compiled loopback server ran with a separate disposable main database and
the migrated sidecar. `REQUIRE_AUTH=false` preserved local reads, while every
write used a newly generated process-only configured API key. Rate limiting
remained enabled. No JWT secret or API key was persisted.

Because the historical copy contains no tagging rows, the relationship checks
used three harmless synthetic disposable prompts and the migrated real project
tag. They do not fabricate historical relationship evidence.

Both the initial server and a restart returned HTTP `200` for health and
readiness. The migrated project tag was visible through the compiled app
boundary. A tag operation and an untag operation succeeded. Project-scoped and
tag-scoped searches each returned exactly the tagged disposable prompt and
excluded both the explicitly untagged prompt and the unrelated prompt.

After restart:

- the tagged state remained present;
- the untagged state remained absent;
- project- and tag-scoped results remained exact;
- a second backup export succeeded.

Each backup contained metadata for all three disposable prompts. Their local
evidence hashes were
`2c2d005652163c1668eed8d57adf9a97777e3683b6aa8faff132f50cb5f763f1`
and
`dabd2810b65fdcf49d4263cb44e0e43d0afbec91fd4ee4ff031cbd359f491b50`.

> Note: the second value above is intentionally not a stable release artifact;
> bundle exports include an export timestamp. The retained local evidence is
> authoritative for the exact run.

## Idempotence

Before the rerun, the runtime-mutated sidecar contained one migrated tag and one
synthetic disposable tagging. Its canonical logical-content SHA-256 was
`06a0654ca12b3852cc10046ab2dd31e46b3fd2dd71134b69c45024d5b0b006c6`.

The second real migration exited `0`, updated the existing tag, inserted no tag
or tagging, and left both counts and the canonical logical hash unchanged.
Integrity remained `ok`, foreign-key violations remained `0`, and the source
copy remained unchanged. A post-rerun loopback start repeated health, readiness,
tagged/untagged persistence, exact project/tag searches, and backup export
success.

## Malformed-copy refusal

All cases used synthetic databases under the disposable acceptance tree. Every
command exited `1`, returned an actionable error, left its source unchanged,
and left its target absent or byte-for-byte unchanged:

| Case | Refusal |
| --- | --- |
| Missing Core marker | Missing `pages` marker |
| Missing required legacy column | Missing `tags.color` |
| Blank required tag ID | Missing legacy tag ID |
| Blank required tag name | Missing legacy tag name |
| Blank required relationship field | Missing legacy entity ID |
| Standalone Prompt Vault source | Missing legacy `tags`/`taggings` shape |
| Same source and target | Paths must differ |
| Main Prompt Vault target | Main-database target refused |
| Legacy-schema target | In-place legacy target refused |

## Transactional rollback

A valid app-owned target began with one tag and one tagging. A synthetic source
contained two tags and two taggings. The second source tagging reused a
preexisting tagging primary-key ID for a different logical relationship; an
earlier insert was eligible before the conflict.

Migration failed with `UNIQUE constraint failed: taggings.id`. Before and after:

- canonical target hash:
  `3f5fa1909fdaec5bc6ffec57284f5b56d6a46c5df83a6f499006b86e6f66d107`;
- tag/tagging counts: `1/1`;
- integrity: `ok`;
- foreign-key violations: `0`.

No partial source tag or tagging remained, and both preexisting rows were
preserved.

## Disposition and limitations

The observed real schema uses the already supported `name` column and contains
no unrepresented tag/tagging variant. No production-code mapping extension was
required.

The bounded discovery did not find a qualifying historical database with a
nonzero tagging count. Therefore this run proves real tag metadata migration and
all disposable runtime/refusal/rollback mechanics, but it does **not** prove a
real historical tag-to-entity relationship migration. That evidence remains the
precise limitation for issue #28; synthetic runtime relationships and automated
fixtures must not be represented as real-data proof.
