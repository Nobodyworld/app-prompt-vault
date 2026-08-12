# Installed WebView2 acceptance

`desktop:accept-installed-webview2` is a Windows-only acceptance harness for
the **installed** Prompt Vault application. It attaches to a temporary,
loopback-only WebView2 DevTools endpoint; it never starts Chromium, Playwright,
Vite, or a browser-development-mode surface.

## Safety contract

- Provide a previously unused absolute evidence path plus current-database and
  legacy-database paths beneath it, all under `C:\tmp`. These are modelled with
  `node:path.win32`, so Linux validation cannot reinterpret Windows paths as
  host-relative paths. UNC, device paths, other drives, traversal, reparse
  points, protected application data, and equal current/legacy paths are rejected.
- Supply the SHA-256 of the exact candidate executable with
  `-ExpectedExecutableSha256`. The installed `prompt-vault-app.exe` is hashed
  before the harness creates evidence, profiles, databases, listeners, or a
  process. A mismatch is an issue #60 installation blocker, not acceptance.
- The harness gives only its child process `PROMPT_VAULT_DB_PATH`,
  `PROMPT_VAULT_LEGACY_DB_PATH`, telemetry opt-outs, a fresh
  `WEBVIEW2_USER_DATA_FOLDER`, and loopback DevTools arguments.
- DevTools is fixed to `127.0.0.1`; wildcard, IPv6, LAN, and public endpoints
  are rejected. The listener must belong to the launched Prompt Vault process
  tree and must be gone after cleanup.
- The target must be exactly one titled Tauri page with the Prompt Vault root.
  DevTools, workers, extensions, bootstrap pages, and ambiguous targets fail.
- Evidence is local. Safe summaries redact profile and database paths and never
  include prompt or backup bodies.

## Self-test

After verifying that the installed executable is the accepted candidate, run:

```powershell
pnpm desktop:accept-installed-webview2 `
  -EvidencePath C:\tmp\prompt-vault-webview2-evidence `
  -CurrentDatabasePath C:\tmp\prompt-vault-webview2-evidence\current\prompt-vault.db `
  -LegacyDatabasePath C:\tmp\prompt-vault-webview2-evidence\legacy\prompt-vault.db `
  -ExpectedExecutableSha256 <exact-candidate-sha256> `
  -Scenario self-test
```

The self-test launches the installed executable, waits for a verified child
WebView2 listener, discovers the single product target, checks the `#root`
application marker, navigates semantically from Library to Settings, captures
the WebView accessibility tree and a synthetic-data screenshot, then closes the
application and checks listener cleanup.

The harness intentionally does not replace the local MSI refresh workflow.
Administrator-required installation work remains in issue #60.

## Recovery scenario

`-Scenario recovery` uses the versioned, repository-owned constrained scenario
contract in `scripts/windows/installed-webview2-recovery-scenario.ts`. It runs
sixteen phases: self-test, storage status, missing and compatible legacy
inspection, explicit legacy restore, backup 2.0 export, backup 1.0
cancellation, all three conflict policies, cancellation, stale-plan rejection,
version preview and revert, restart verification, and final DB verification.

It has only named semantic operations (role/name clicks and focus, labelled
input or selection, checked state, a small keyboard allowlist, bounded text
waits, overflow, accessibility, version actions, contained downloads, and
screenshots). It cannot contain JavaScript, CSS selectors, plan IDs, or
fingerprints. The harness creates synthetic legacy and production-validated
backup fixtures underneath the new evidence root. Backup downloads must be a
single completed JSON file in a fresh contained directory and are parsed by
the production verifier; CDP event observation is supplementary evidence.

Every phase is a separate launch with a new loopback port and WebView2 profile.
The orchestrator records PID, creation time, name, parent, listener identity,
and profile use for each attempt. It requires graceful shutdown; after a
timeout it contains only exact recorded identities, then fails closed if a
root, descendant, listener, or profile user remains. A failed cleanup is never
retried. Protected current/historical DB/WAL/SHM inventories and the synthetic
legacy DB/WAL/SHM inventory are compared after every launch. Each disposable
current database receives integrity and foreign-key checks, with only table
counts recorded.
