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

### Explicit clean local reinstall

```powershell
pnpm desktop:reinstall-local
```

This Windows-only command is an **exceptional clean reinstall**, not an installed-build updater. It deliberately:

1. requires the explicit reinstall command;
2. builds fresh MSI and NSIS packages from the current branch unless the script is called with `-SkipBuild`;
3. selects exactly one current-version MSI after a build, or requires an explicit MSI path when reusing existing output;
4. reports package manufacturer metadata, Authenticode signature status, signer identity, and SHA-256;
5. refuses ambiguous Prompt Vault uninstall registrations;
6. verifies any running `prompt-vault-app` process is under the registered install location before force-closing it;
7. uninstalls the currently registered Prompt Vault MSI package when present;
8. installs the selected locally built MSI;
9. launches the Start-menu shortcut when found;
10. reports any tracked Tauri schema files regenerated during packaging.

Do not use this command as a substitute for an in-place update. It intentionally crosses an uninstall boundary and therefore does not prove Windows Installer update, rollback, or installed-identity behavior.

The legacy command name is retired:

```powershell
pnpm desktop:refresh-installed
```

It now exits with an error instead of silently performing uninstall-first replacement.

The clean-reinstall workflow does not delete application data. The expected current database remains:

```text
%LOCALAPPDATA%\com.nobodyworld.promptvault\prompt-vault.db
```

To reuse an already built MSI without rebuilding, call the script explicitly, acknowledge its behavior, and select the exact MSI instead of relying on timestamps:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File scripts/windows/install-local-build.ps1 `
  -ConfirmReinstall `
  -SkipBuild `
  -MsiPath 'src-tauri\target\release\bundle\msi\Prompt Vault_0.4.0_x64_en-US.msi'
```

If the exact filename differs, inspect the bundle directory and supply that exact `.msi` path. The script accepts only an MSI contained under the repository's MSI bundle directory.

### Verified installed update work

Issue #73 owns the future verified installed-build update workflow. PR #79 merged the deterministic, non-mutating contract for manifest validation, MSI version ordering, installed-target planning, recovery-source checks, and failure classification.

The read-only command is now available:

```powershell
pnpm desktop:plan-update --manifest 'artifacts/selected.json' --recovery-manifest 'recovery/prior.json'
```

Select exactly one manifest or one MSI. For inspection before a source manifest exists:

```powershell
pnpm desktop:plan-update --msi 'src-tauri/target/release/bundle/msi/Prompt Vault_0.4.0_x64_en-US.msi'
```

No timestamp selection, installation, shutdown, restart, elevation, recovery execution, or application database access occurs. Exit `0` means complete evidence produced a no-op or conditional upgrade plan. Exit `2` means a refusal or missing evidence. A proposed upgrade describes a future operation; the report's `installationMutationOccurred` remains `false`. The separately listed `futureExecutionGates` always remain outside this command's authority. MSI-only inspection reports the observed package and payload, but blocks planning until a valid source manifest is supplied.

The manifest is the version `1` contract in `src/domain/localUpdate.ts`. Paths are relative to the manifest's directory, and must remain inside it without junctions/symbolic links. `executable.relativePath` is relative to the installation root; the supported Tauri layout uses `prompt-vault-app.exe`. Example **synthetic values**, to replace with a retained build receipt and observed identities:

```json
{
  "manifestVersion": "1",
  "application": {
    "identifier": "com.nobodyworld.promptvault",
    "version": "0.4.0",
    "sourceCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifact": {
    "format": "msi",
    "relativePath": "Prompt Vault_0.4.0_x64_en-US.msi",
    "byteLength": 123456,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "msi": {
    "productCode": "{11111111-1111-1111-1111-111111111111}",
    "upgradeCode": "{22222222-2222-2222-2222-222222222222}",
    "packageCode": "{33333333-3333-3333-3333-333333333333}",
    "installScope": "per-machine"
  },
  "executable": {
    "relativePath": "prompt-vault-app.exe",
    "fileVersion": "0.4.0.0",
    "productVersion": "0.4.0",
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "media": { "cabinets": [] }
}
```

For external cabinets, `media.cabinets` must enumerate the exact MSI Media-table set, each with `relativePath` (the cabinet filename), `byteLength`, and `sha256`. Embedded cabinets are covered by the MSI digest and are extracted and hashed independently. Complete media requires every MSI File-table member to be extracted with its declared size. The expected executable hash/version comes from these selected-MSI bytes; a loose release executable is never consulted. Four numeric PE file-version fields are reported separately from the MSI's three-field ProductVersion.

The prior recovery manifest has the same identity/media contract, and additionally:

```json
{
  "recoveryProcedure": {
    "relativePath": "prior-installation-recovery.md",
    "byteLength": 1234,
    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "kind": "manual-prior-msi",
    "testedSourceCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

That field belongs in the prior manifest, alongside its other required fields. Retain the reviewed procedure as a `.md` or `.txt` file. Its receipt must bind the prior source commit and exact document bytes. The document should identify the prior product/package/scope, required media, preconditions, the separately accepted recovery procedure and its evidence, data-preservation boundaries, and post-recovery identity checks. This command verifies the receipt and media; it does not execute or independently attest the procedure or source-build provenance. A hand-written claim or a cached `LocalPackage` is not recovery acceptance. Missing original media, any cabinet, matching installed payload, or procedure evidence blocks readiness.

Collection uses Windows Installer database handles opened with `MSIDBOPEN_READONLY`, plus current-user/machine uninstall registration in both native and WOW6432Node locations. Read-only Installer APIs reconcile product context, cached package metadata and related UpgradeCode products. Missing/inaccessible roots, duplicate registrations, inconsistent scope/locations/versions, and foreign or unverifiable running executables block the plan. Process names only identify candidates needing path/hash verification. Other users' unloaded registry hives are outside this command's inventory.

Only the Windows collector sees private paths. The CLI emits redacted identities, hashes, media readiness, planner decisions and blockers. Scratch cabinet/payload files are bounded, written to a newly owned temporary directory, and removed after ownership/link/content checks. Cabinet member names never become destination paths. Spanning cabinets, loose/uncompressed media, administrative images, non-x64 packages, dual-purpose scopes, and nonstandard executable layouts fail closed. Do not use raw collector JSON as public evidence.

The domain adapter validates untrusted observations, then delegates version/identity decisions and recovery file verification to `src/domain/localUpdate.ts`. No PowerShell decision implementation exists. The collector's native boundary can be exercised read-only against an explicitly selected built MSI:

```powershell
pnpm exec tsx scripts/test-update-inspection.ts --msi 'src-tauri/target/release/bundle/msi/Prompt Vault_0.4.0_x64_en-US.msi'
```

The Windows CI bundle job also performs this check. It verifies payload correspondence and rejection of changed manifest/package digests without invoking an installer. It does not count as attended MSI install/update/rollback acceptance. Microsoft documents the [read-only database mode](https://learn.microsoft.com/en-us/windows/win32/api/msiquery/nf-msiquery-msiopendatabasea), [Media table](https://learn.microsoft.com/en-us/windows/win32/msi/media-table), and [cabinet callback destination control](https://learn.microsoft.com/en-us/windows/win32/setupapi/spfilenotify-fileincabinet).

There is currently **no** `desktop:update-installed` command and no authorized MSI/UAC mutation path.

Actual installer execution remains gated on the separately attended, isolated synthetic MSI acceptance required by issue #73. The clean reinstall above is not evidence for that gate.

## Package identity versus Windows trust

Prompt Vault packages declare the following truthful product metadata:

- product: `Prompt Vault`;
- publisher/manufacturer metadata: `Nobody Production`;
- category: `Productivity`;
- license: proprietary;
- homepage: the public Prompt Vault repository;
- application description and copyright.

This metadata improves Windows Installed Apps, file details, and installer product identity. It does **not** create a cryptographic publisher identity.

Local development packages are currently unsigned. Windows may therefore display `Unknown publisher` or an unsigned-application warning even though the MSI manufacturer metadata says `Nobody Production`. The clean-reinstall script reports this state before invoking Windows Installer rather than hiding it.

Removing the Windows trust warning requires signing the executable and installers with a trusted Windows code-signing identity. Signing configuration must be added only after the project selects and securely provisions a certificate or managed signing service. Never commit a private signing key or certificate password to the repository.

## Why the installed app does not change automatically

`pnpm tauri:dev` runs a development executable connected to the Vite development server. Windows Installed Apps launches files copied and registered by the last MSI installation. Source changes cannot mutate that installed package automatically; it must be changed through an explicitly authorized installation workflow.

For ordinary development, prefer `pnpm tauri:dev` or `pnpm desktop:preview-release`. Use `pnpm desktop:reinstall-local` only when an uninstall-first clean reinstall is intentionally required. Do not infer that a reinstall validates the future in-place updater.

## Source ownership

- React components, routing, forms, responsive behavior, accessibility, and visual design live under `desktop/src`.
- Tauri configuration and permissions live under `src-tauri`.
- Rust owns native persistence, secrets, and operating-system integration.
- The browser and Tauri application must not maintain separate UI implementations.
