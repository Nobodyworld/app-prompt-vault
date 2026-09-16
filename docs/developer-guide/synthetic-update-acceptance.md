# Attended synthetic MSI acceptance

Issue #73's acceptance fixture is **Prompt Vault Update Acceptance**, a small
Windows Forms / SQLite application, rather than a release build of Prompt Vault.
The fixture exercises MSI execution, exact identity, graceful shutdown and
quiescent file preservation. Its records, versions, settings and SQLite backup /
restore exercise synthetic logical persistence. This does not establish real
Prompt Vault native UI, migration, data, or update acceptance.

Application version remains `0.4.0`. No `desktop:update-installed` command exists.
The acceptance runner is invoked explicitly by source path. It supports only the
fixed synthetic identifier `com.nobodyworld.promptvault.updateacceptance`, process
`prompt-vault-update-acceptance.exe`, UpgradeCode
`{975929E8-18E6-44F5-BA40-157F667F18CD}`, per-machine installation in the distinct
`Prompt Vault Update Acceptance` Program Files directory, and an identically named
Start Menu folder. Each build generates separate ProductCodes and PackageCodes.
Data lives under the operator's LocalApplicationData in the synthetic identifier's
directory. No real Prompt Vault process or data path is a mutation target.

## Build and inspect

From the authorized isolated worktree, using Node 24, pnpm 10.24.0 and WiX 3.14:

```powershell
pwsh -NoProfile -File scripts/windows/build-synthetic-update.ps1 -OutputRoot $newPrivateMediaRoot -WixRoot $wixRoot
node --import tsx scripts/synthetic-update/run.ts inspect $privateRequest
```

The build root must be new and under the temporary directory. WiX ICE validation
is required. An environment that cannot access Windows Installer validation is a
blocker, not permission to suppress ICE checks. Original MSI media contains an
embedded cabinet; retain every original MSI independently from `LocalPackage`.
The merged read-only collector verifies executable correspondence from that
cabinet. The normal product planner's default target remains Prompt Vault;
synthetic planning explicitly selects the fixed acceptance profile.

A private request is JSON with `manifestPath`, `resultPath`, `ownerSid`, optional
`recoveryManifestPath`, `recoveryProofPath`, and `argument` for restart. Absolute
paths and the operator SID belong only in private evidence. The result path must
not exist. Never overwrite an earlier attempt or treat a new filename as retry
authorization. Manifests contain confined relative media paths, exact byte sizes,
SHA-256, source commit, MSI identity and executable identity.

## Operator sequence

Run exactly one chosen action per invocation:

```powershell
node --import tsx scripts/synthetic-update/run.ts $action $privateRequest
```

1. Capture protected-host installation/process/file inventories without opening
   real databases. Prove no synthetic installation, shortcuts, process or data
   exists. Build and inspect original `1.0.0` media and the higher `1.1.0`, `1.2.0`,
   and `1.3.0` probe packages.
2. `install-old` installs only `1.0.0` into an absent synthetic installation.
   Verify the result and independently record whether the operator actually saw
   and approved UAC. `restart` with `argument: "--seed"` creates synthetic data,
   tests a SQLite backup restored to a separate fixture database, and opens the
   fixture. Later restarts use `--run`, which verifies existing logical content.
3. Prove the explicit synthetic recovery procedure **before any upgrade**:
   `shutdown`, `uninstall`, then a separately attended `recovery-install` of the
   same original `1.0.0` media, then `restart --run`. Compare data inventories and
   exact registration/executable identities. This is an explicitly scoped
   uninstall/reinstall recovery procedure, never an in-place upgrade or rollback.
4. Retain the recovery procedure document and add its digest, byte size,
   `kind: "manual-prior-msi"`, and `testedSourceCommit` to the prior manifest as
   `recoveryProcedure`. A private proof contains `sourceCommit`,
   `priorPackageSha256`, and `uninstall` / `reinstall` objects with the exact
   result `path` and `sha256`. The executor verifies the actual result files,
   successful installer exit codes, data equality and identity checks. A document
   receipt alone cannot satisfy execution readiness.
5. Use `upgrade` for `1.1.0`. The executor collects a fresh read-only plan, checks
   recovery proof, requests graceful shutdown, records database/WAL/SHM and other
   fixture files, revalidates package/manifest/installed identity at the native
   boundary, executes MSI, compares files before restart, verifies the committed
   identity, and restarts unelevated. Repeat a matching `upgrade` request to prove
   no-op. Use lower-version, changed same-version payload, wrong-target, tampered
   manifest/package/payload and incomplete recovery requests to prove refusals.
6. `restart --refuse-close` refuses graceful close for 15 seconds. `shutdown` has a
   five-second deadline and must report timeout without forced termination. After
   the fixture stops refusing, an explicit later graceful close is possible.
7. `cancel` has the same safety gates as upgrade and requests one normal elevation.
   The operator cancels that specific prompt. Record the actual observation.
   There is no automatic retry. A canceled baseline or recovery operation blocks
   dependent steps; a deliberately canceled test never counts as an upgrade.
8. `rollback` uses the `1.2.0` probe with `WIXFAILWHENDEFERRED=1`. Require a real
   failing transaction, log evidence of that deferred action and rollback, the
   exact prior registration/package/executable restored, and quiescent data
   equality. A nonzero exit code alone is insufficient.
9. `verification-failure` installs a higher probe normally, then injects an
   expected executable hash mismatch in the verifier. Evidence retains the real
   post-commit identity and the injected mismatch. It must be classified as
   `committed-verification-failed`, recovery required; no automatic rollback is
   claimed and the installed binary is not damaged.
10. Recover through the previously proven explicit synthetic procedure, with one
    attended operation at a time. Separately use `restart-failure` for a successful
    higher-version install followed by the fixture's `--restart-failure` exit 42.
    Require `committed-restart-failed`, then separately recover as needed.
11. Capture evidence, explicitly `shutdown` and `uninstall` the exact synthetic
    product, verify absent registrations/processes/install directory/shortcuts,
    and remove only the inventoried synthetic data after checking its exact
    containment, file allowlist, hashes and lack of reparse points. Preserve logs,
    original media and evidence until review. Follow root `AGENTS.md` for workspace
    reconciliation; the owner-prepared worktree is pre-existing and retained.

The driver never interacts with UAC. Before each installer call, announce the
exact operation, original MSI path/hash, ProductCode, UpgradeCode and command.
Use normal `ShellExecute RunAs` from the intended non-elevated operator session.
Keep package/manifest/recovery files locked against modification across consent
and execution. `RunAs` or error 1223 is not proof a prompt was visible: keep
`uacObserved: operator-attestation-required` until the operator reports that
specific prompt. Capture user/session, launch method, scope, error/HRESULT,
installer exit code, MSI log, reboot state and post-install identity.

An unknown installer exit or a ten-minute wait timeout is unresolved installation
state. Never force-kill MSI or proceed with another mutation. Exit 1602 is installer
cancellation; Win32 1223 before launch is elevation cancellation; 1312 is a launch
failure. Exit 3010 is committed with reboot required. Exit 1641 is committed with
reboot initiated and stops this run. No reboot or restart is automatic in either
case. After any post-commit identity/data/restart failure, stop and use only the
separately proven explicit recovery procedure.

WiX schedules major-upgrade removal after `InstallInitialize`, within the
transaction. See Microsoft's [RemoveExistingProducts sequence](https://learn.microsoft.com/en-us/windows/win32/msi/removeexistingproducts-action),
[installer result codes](https://learn.microsoft.com/en-us/windows/win32/msi/error-codes),
and WiX's [deferred failure fixture](https://docs.firegiant.com/wix3/customactions/wixfailwhendeferred/).
These references specify behavior; they do not prove this host's rollback.

## Validation and delivery boundary

Run repository audit, lint, typecheck, Node build, coverage, UI, security scan,
Windows PowerShell syntax, updater/executor deterministic tests, Rust checks,
Tauri MSI-only packaging, and real synthetic package inspection at the final
candidate commit. Record failures and unavailable gates honestly. Keep raw logs,
MSIs, paths and data out of Git. Commit source locally and push only the explicitly
authorized target branch; do not create or merge a PR. Attended evidence is a
separate gate from deterministic tests and simulated failure classifications.

Until the complete attended sequence is recorded and reviewed, the outcome is
`LOCAL_BLOCKED` and the ordinary installed updater remains unavailable.
