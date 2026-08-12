# Installed WebView2 acceptance

`desktop:accept-installed-webview2` is a Windows-only acceptance harness for
the **installed** Prompt Vault application. It attaches to a temporary,
loopback-only WebView2 DevTools endpoint; it never starts Chromium, Playwright,
Vite, or a browser-development-mode surface.

## Safety contract

- Provide a previously unused absolute evidence path plus current-database and
  legacy-database paths beneath it, all under `C:\tmp`. The harness rejects
  existing roots, path traversal/reparse points, protected application data,
  and equal current/legacy paths.
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
contract in `scripts/windows/installed-webview2-recovery-scenario.ts`. It has
only named semantic operations (role/name clicks and focus, labelled input or
selection, checked state, a small keyboard allowlist, overflow, accessibility,
contained downloads, and screenshots). It cannot contain JavaScript, CSS
selectors, plan IDs, or fingerprints. The caller supplies fresh synthetic
fixtures produced by Prompt Vault’s production recovery builders and must keep
all derived evidence under the one new evidence root.

The orchestrator records process-tree identity and requires graceful shutdown;
after a timeout it performs best-effort containment only against the recorded
acceptance process tree, then fails if any recorded process or loopback
listener remains.
