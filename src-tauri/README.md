# Tauri Backend

Rust sources that power the desktop shell live in this directory. The project is configured using `tauri.conf.json` and the
Cargo manifests at the root of `src-tauri/`.

- `src/` contains the Rust commands exposed to the frontend.
- `icons/` holds application assets bundled with desktop builds.
- `build.rs` and `Cargo.toml` define the compilation pipeline.

Refer to [`docs/architecture/overview.md`](../docs/architecture/overview.md) for integration details and ensure Rust code follows
the conventions described in [`STYLE-GUIDE.md`](../STYLE-GUIDE.md).

## Migration parity verification

The Tauri backend applies Prompt Vault DB migrations using SQLite `PRAGMA user_version` and the SQL migration files in
`../src/db/migrations/`.

To verify that Tauri migrations apply cleanly and reach the latest schema version, run:

```sh
cargo test
```

This includes unit tests that execute the migration runner against a fresh SQLite database and assert the expected
latest `user_version`.
