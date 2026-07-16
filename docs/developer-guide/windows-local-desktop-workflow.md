# Windows local desktop workflow

Prompt Vault uses one React/Vite frontend for browser development and the Tauri desktop application. The Windows-installed copy is a frozen package and does not hot-reload from the repository.

## Choose the right mode

### Live native development

```powershell
pnpm tauri:dev
```

Use this for normal UI and UX work. Tauri starts the Vite development server, launches a native WebView, hot-reloads frontend changes, and rebuilds/restarts when watched Rust or Tauri files change.

This window is a development process. It is not the copy registered in Windows Installed Apps.

### Current release preview without installation

```powershell
pnpm desktop:preview-release
```

This command:

1. builds the current branch as a release executable without producing installer bundles;
2. launches `src-tauri/target/release/prompt-vault-app.exe`;
3. prints the executable SHA-256.

Use it to inspect optimized release behavior without replacing the installed application.

### Refresh the Windows-installed copy

```powershell
pnpm desktop:refresh-installed
```

This Windows-only command:

1. builds fresh MSI and NSIS packages from the current branch;
2. closes a running `prompt-vault-app` process;
3. detects and removes the currently installed Prompt Vault MSI package;
4. installs the newly built MSI;
5. launches the Start-menu shortcut when found;
6. reports any tracked Tauri schema files regenerated during packaging.

The workflow does not delete application data. The expected current database remains:

```text
%LOCALAPPDATA%\com.nobodyworld.promptvault\prompt-vault.db
```

Windows may display an elevation or unsigned-publisher prompt. Local packages remain development and acceptance artifacts, not supported releases.

To reuse an already built MSI without rebuilding:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/windows/install-local-build.ps1 `
  -SkipBuild
```

## Why the installed app does not change automatically

`pnpm tauri:dev` runs a development executable connected to the Vite development server. Windows Installed Apps launches files copied and registered by the last MSI installation. Source changes cannot mutate that installed package automatically; it must be replaced through a new build and installation.

## Source ownership

- React components, routing, forms, responsive behavior, accessibility, and visual design live under `desktop/src`.
- Tauri configuration and permissions live under `src-tauri`.
- Rust owns native persistence, secrets, and operating-system integration.
- The browser and Tauri application must not maintain separate UI implementations.
