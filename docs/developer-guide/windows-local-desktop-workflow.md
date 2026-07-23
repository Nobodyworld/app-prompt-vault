# Windows local desktop workflow

Prompt Vault uses one React/Vite frontend for browser development and the Tauri desktop application. The Windows-installed copy is a frozen package and does not hot-reload from the repository.

## Choose the right mode

### Live native development

```powershell
pnpm tauri:dev
```

Use this for normal UI and UX work. Tauri starts the Vite development server, launches a native WebView, hot-reloads frontend changes, and rebuilds/restarts when watched Rust or Tauri files change.

This window is a development process. It is not the copy registered in Windows Installed Apps.

### Measure the native client area

Tauri `minWidth` and `minHeight` apply to the logical **inner client area**, not the outer Win32 frame. Windows borders and frame geometry make the outer rectangle larger than the configured client minimum.

Launch Prompt Vault and run:

```powershell
pnpm desktop:accept-window-minimum
```

The exact-minimum command temporarily resizes the native window to the configured 400×600 logical client target before measuring it. The measurement thread explicitly uses per-monitor-v2 DPI awareness so Win32 rectangle values are not DPI-virtualized and converted a second time.

The command reports:

- the caller DPI-awareness mode;
- client size in physical pixels;
- client size converted to logical pixels using the window DPI;
- outer Win32 rectangle size;
- whether the client meets the configured 400×600 logical minimum;
- whether it is within the acceptance tolerance of that minimum;
- whether the exact-minimum resize was requested and applied.

For a non-gating measurement at the current size without resizing:

```powershell
pnpm desktop:measure-window
```

When multiple Prompt Vault windows are visible, call the PowerShell script directly with `-ProcessId`.

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

1. identifies the operation as a local development refresh before changing Windows installation state;
2. builds fresh MSI and NSIS packages from the current branch;
3. reports package manufacturer metadata, Authenticode signature status, signer identity, and SHA-256;
4. closes a running `prompt-vault-app` process;
5. detects and removes the currently installed Prompt Vault MSI package;
6. installs the newly built MSI;
7. launches the Start-menu shortcut when found;
8. reports any tracked Tauri schema files regenerated during packaging.

The workflow does not delete application data. The expected current database remains:

```text
%LOCALAPPDATA%\com.nobodyworld.promptvault\prompt-vault.db
```

To reuse an already built MSI without rebuilding:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/windows/install-local-build.ps1 `
  -SkipBuild
```

## Package identity versus Windows trust

Prompt Vault packages declare the following truthful product metadata:

- product: `Prompt Vault`;
- publisher/manufacturer metadata: `Nobody Production`;
- category: `Productivity`;
- license: proprietary;
- homepage: the public Prompt Vault repository;
- application description and copyright.

This metadata improves Windows Installed Apps, file details, and installer product identity. It does **not** create a cryptographic publisher identity.

Local development packages are currently unsigned. Windows may therefore display `Unknown publisher` or an unsigned-application warning even though the MSI manufacturer metadata says `Nobody Production`. The local refresh script reports this state before invoking Windows Installer rather than hiding it.

Removing the Windows trust warning requires signing the executable and installers with a trusted Windows code-signing identity. Signing configuration must be added only after the project selects and securely provisions a certificate or managed signing service. Never commit a private signing key or certificate password to the repository.

## Why the installed app does not change automatically

`pnpm tauri:dev` runs a development executable connected to the Vite development server. Windows Installed Apps launches files copied and registered by the last MSI installation. Source changes cannot mutate that installed package automatically; it must be replaced through a new build and installation.

## Source ownership

- React components, routing, forms, responsive behavior, accessibility, and visual design live under `desktop/src`.
- Tauri configuration and permissions live under `src-tauri`.
- Rust owns native persistence, secrets, and operating-system integration.
- The browser and Tauri application must not maintain separate UI implementations.
