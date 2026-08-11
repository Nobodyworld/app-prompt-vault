# Installed WebView2 acceptance

`desktop:accept-installed-webview2` is a Windows-only acceptance harness for
the **installed** Prompt Vault application. It attaches to a temporary,
loopback-only WebView2 DevTools endpoint; it never starts Chromium, Playwright,
Vite, or a browser-development-mode surface.

## Safety contract

- Provide absolute evidence, current-database, and legacy-database paths under
  `C:\tmp` only. Do not use an application-data directory.
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
  -LegacyDatabasePath C:\tmp\prompt-vault-webview2-evidence\legacy\prompt-vault.db
```

The self-test launches the installed executable, waits for a verified child
WebView2 listener, discovers the single product target, checks the `#root`
application marker, navigates semantically from Library to Settings, captures
the WebView accessibility tree and a synthetic-data screenshot, then closes the
application and checks listener cleanup.

The harness intentionally does not replace the local MSI refresh workflow.
Administrator-required installation work remains in issue #60.
