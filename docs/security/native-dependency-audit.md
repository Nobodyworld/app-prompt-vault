# Native dependency audit — issue #77

Reviewed on 2026-09-08 for [issue #77](https://github.com/Nobodyworld/app-prompt-vault/issues/77), starting from `1cff452b158f340399e629fb463b20505d5b21df`.

Cargo generated the precise `event-listener 5.4.1 -> 5.4.2` patch. The initial audit reported 20 informational warnings (18 unmaintained, two unsound). The patched lockfile reports 19 (18 unmaintained, one unsound), with zero entries in the audit's vulnerability list. Audit exit zero does **not** mean that the residual warnings are harmless. The advisory database used for this comparison was `8a1eb4f933fb5821add5b4e98601ebd90b8b3538` (1,242 advisories).

## Reproduction and source identity

The pre-update queries ran against the unchanged committed lockfile with Cargo 1.97.0. Successful, nonempty forward graphs preceded inverse queries for both `x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu`. Each target was queried with default features and again with `--all-features`; these gave the same affected-package paths. `--all-features` selects this application's features, not every optional feature of every dependency.

From the repository root, substitute either target for `<target>`:

```text
cargo tree --locked --manifest-path src-tauri/Cargo.toml --target <target> --edges normal,build,dev --color never
cargo tree --locked --manifest-path src-tauri/Cargo.toml --target <target> --edges normal,build,dev --invert event-listener@5.4.1 --color never
cargo tree --locked --manifest-path src-tauri/Cargo.toml --target <target> --edges normal,build,dev --invert glib@0.18.5 --color never
```

Repeat those queries with `--all-features`. Feature activation and target predicates were inspected with:

```text
cargo tree --locked --all-features --manifest-path src-tauri/Cargo.toml --target <target> --edges features --invert event-listener@5.4.1 --color never
cargo tree --locked --all-features --manifest-path src-tauri/Cargo.toml --target <target> --edges features --invert glib@0.18.5 --color never
cargo metadata --locked --all-features --format-version 1 --manifest-path src-tauri/Cargo.toml --filter-platform <target>
cargo tree --locked --all-features --manifest-path src-tauri/Cargo.toml --target all --edges normal,build,dev --invert event-listener@5.4.1 --color never
cargo tree --locked --all-features --manifest-path src-tauri/Cargo.toml --target all --edges normal,build,dev --invert async-lock@3.4.2 --color never
```

After updating, use `event-listener@5.4.2` for the inverse queries. All third-party versions below have source `registry+https://github.com/rust-lang/crates.io-index`; `prompt-vault-app 0.4.0` and `nw-secrets 0.1.0` are repository-local packages. Raw Cargo output and machine paths remain outside tracked documentation.

## Event-listener paths and exact patch

Windows: neither `event-listener` nor `glib` occurs in either successful target graph. `nw-secrets` uses its Windows dependency branch; its `keyring` dependency is declared under `cfg(not(windows))`.

Linux: the complete root paths to the affected version are normal dependencies, not development-only dependencies:

```text
prompt-vault-app 0.4.0
  -> nw-secrets 0.1.0
  -> keyring 2.3.3
  -> secret-service 3.1.0
  -> zbus 3.15.2
  -> blocking 1.6.2                         (direct route)
     OR async-fs 1.6.0 -> blocking 1.6.2   (second route)
  -> async-channel 2.5.0
  -> event-listener-strategy 0.5.4
  -> event-listener 5.4.1                   (now 5.4.2)
```

The relevant feature activation is `keyring` default / `platform-all` / `platform-linux` / `linux-secret-service` / `linux-secret-service-rt-async-io-crypto-rust`, then `secret-service/rt-async-io-crypto-rust`, `zbus/async-io` (including `async-fs` and `blocking`), and the channel/strategy/listener `std` features. The application does not directly select or call the advisory's `StackSlot` API; these graphs do not establish exploitability or non-exploitability.

The committed `async-lock 3.4.2 -> event-listener 5.4.1` edge is real. Cargo's **all-target union** reaches it through:

```text
prompt-vault-app -> nw-secrets -> keyring 2.3.3 -> secret-service 3.1.0
  -> zbus 3.15.2 -> async-process 1.8.1 -> async-signal 0.2.14
  -> async-lock 3.4.2 -> event-listener 5.4.1
                     -> event-listener-strategy 0.5.4 -> event-listener 5.4.1
```

This is not an active Windows or Linux root path. `zbus -> async-process` requires `target_os = "macos"`; `async-process -> async-signal` requires `unix`; `async-signal -> async-lock 3.4.2` requires `windows`. The all-target union combines mutually incompatible predicates and is not proof of a runnable target configuration. Cargo's union also includes `async-process -> blocking -> async-channel -> event-listener-strategy`. Both references to the patched listener remain consistent in the lockfile.

[RUSTSEC-2026-0221](https://rustsec.org/advisories/RUSTSEC-2026-0221.html) identifies `>=5.4.2` as patched. The smallest accepted update was:

```text
cargo update --manifest-path src-tauri/Cargo.toml -p event-listener@5.4.1 --precise 5.4.2
```

The generated lockfile delta is **4 additions and 5 deletions**:

- `event-listener` version: `5.4.1 -> 5.4.2`.
- Checksum: `e13b66accf52311f30a0db42147dadea9850cb48cd070028831ae5f5d4b856ab -> 5a23add41df1562121a9393cb065eab5146a1242410f23a644851e90cfd669d2`.
- `async-lock 3.4.2` and `event-listener-strategy 0.5.4` each reference `event-listener 5.4.2`.
- The patched listener no longer lists `concurrent-queue`. That package remains for other consumers; its version is unchanged.

No other package version, source, checksum, manifest, application code, feature selection, platform support, or audit policy changed. The older listener resolutions `2.5.3` and `3.1.0` remain unchanged; the advisory lists versions below `5.1.0` as unaffected.

## Residual glib and GTK3 family

`glib 0.18.5` remains unsound under [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html). It is absent from the queried Windows graphs and present as a normal Linux dependency. The shortest path is `prompt-vault-app 0.4.0 -> tauri 2.11.5 -> gtk 0.18.2 -> glib 0.18.5`.

The full Linux inverse graph has these immediate consumers of `glib`: `atk 0.18.2`, `cairo-rs 0.18.5`, `gdk 0.18.2`, `gdk-pixbuf 0.18.5`, `gdkx11 0.18.2`, `gio 0.18.4`, `gtk 0.18.2`, `javascriptcore-rs 1.1.2`, `pango 0.18.3`, `soup3 0.5.0`, and `webkit2gtk 2.0.2`. They converge on these application roots:

- `prompt-vault-app -> tauri -> gtk` and `tauri -> webkit2gtk`.
- `tauri -> muda 0.19.3 -> gtk`.
- `tauri -> tauri-runtime 2.11.3 -> gtk / webkit2gtk`.
- `tauri -> tauri-runtime-wry 2.11.4 -> gtk / webkit2gtk / tauri-runtime`.
- `tauri-runtime-wry -> tao 0.35.3 -> gtk`.
- `tauri-runtime-wry -> wry 0.55.1 -> gtk / webkit2gtk / gdkx11 / javascriptcore-rs / soup3`.

`gtk 0.18.2` and `gdk 0.18.2` require `glib ^0.18`; `webkit2gtk 2.0.2` requires `glib ^0.18.0` and `gtk ^0.18.0`; `wry 0.55.1` requires exactly `webkit2gtk =2.0.2`. These requirements exclude the advisory's patched `glib >=0.20.0`. A forced lockfile-only replacement cannot satisfy this graph. No GTK family update was attempted.

The ten unmaintained GTK3 warnings are all version `0.18.2` and absent from the queried Windows graphs. In the following table, `T = prompt-vault-app 0.4.0 -> tauri 2.11.5` and `R = T -> tauri-runtime-wry 2.11.4`. Paths are concrete examples from the Linux graph; additional GTK/WebKit paths above share the same packages.

| Package | Advisory | Linux path suffix after T or R | Role |
| --- | --- | --- | --- |
| `atk` | RUSTSEC-2024-0413 | T -> gtk -> atk | Normal target dependency |
| `atk-sys` | RUSTSEC-2024-0416 | T -> gtk -> atk -> atk-sys | Native FFI binding |
| `gdk` | RUSTSEC-2024-0412 | T -> gtk -> gdk | Normal target dependency |
| `gdk-sys` | RUSTSEC-2024-0418 | T -> webkit2gtk -> gdk-sys | Native FFI binding |
| `gdkwayland-sys` | RUSTSEC-2024-0411 | R -> tao 0.35.3 -> gdkwayland-sys | Wayland FFI binding |
| `gdkx11` | RUSTSEC-2024-0417 | R -> wry 0.55.1 -> gdkx11 | X11 binding |
| `gdkx11-sys` | RUSTSEC-2024-0414 | R -> tao 0.35.3 -> gdkx11-sys | X11 FFI binding |
| `gtk` | RUSTSEC-2024-0415 | T -> gtk | Normal target dependency |
| `gtk-sys` | RUSTSEC-2024-0420 | T -> gtk -> gtk-sys | Native FFI binding |
| `gtk3-macros` | RUSTSEC-2024-0419 | T -> gtk -> gtk3-macros | Host proc-macro for the Linux graph |

Treat these warnings as one upstream dependency family. The supported remediation route requires coordinated Tauri/runtime/Wry/Tao/WebKit bindings that permit patched GLib, not an application-level version override. Upstream tracks that work in [Tauri #12561](https://github.com/tauri-apps/tauri/issues/12561) and the [GTK upgrade/migration planning issue](https://github.com/tauri-apps/tauri-docs/issues/3143). These are tracking references, not proof that a compatible release is available.

**Reevaluation trigger:** at the next proposed Tauri/runtime/Wry/Tao/WebKit dependency update, or the first upstream release/backport associated with that migration, reproduce both target graphs and check whether the entire GTK3 family can be removed or its GLib constraints accept a patched version. Require Linux compilation, tests, packaging and native acceptance under a separately authorized platform slice before claiming the Linux risk is resolved. A new security advisory affecting any member also triggers immediate triage.

## Other inherited warnings and reevaluation triggers

| Package / advisory | Actual path and target classification | Concrete reevaluation trigger |
| --- | --- | --- |
| `derivative 2.2.0` / RUSTSEC-2024-0388 | Linux: `prompt-vault-app -> nw-secrets -> keyring 2.3.3 -> secret-service 3.1.0 -> zbus 3.15.2 -> derivative`. A host proc-macro used by the normal Linux graph; absent on Windows. `zbus` requires `derivative ^2.2`. | On the next keyring/secret-service/zbus update, evaluate an upstream release that removes derivative or replaces its derives. There is no patched release listed by this advisory; swapping proc-macro crates is not a listener patch. |
| `instant 0.1.13` / RUSTSEC-2024-0384 | Absent from both requested target graphs. All-target union: `prompt-vault-app -> nw-secrets -> keyring -> secret-service -> zbus -> async-fs 1.6.0 / async-io 1.13.0 / async-process 1.8.1 -> futures-lite 1.13.0 -> fastrand 1.9.0 -> instant`. The last normal edge is restricted to `wasm32` excluding `wasi`; union output does not establish an executable app target. | On the next zbus/async-family/futures-lite/fastrand update, test whether the old fastrand branch disappears; also recheck before any wasm target is proposed. Fastrand requires `instant ^0.1`, and the advisory lists no patched release. |
| `proc-macro-error 1.0.4` / RUSTSEC-2024-0370 | Linux graph, host macro support: `tauri -> gtk -> gtk3-macros 0.18.2 -> proc-macro-error` and `tauri -> gtk -> glib -> glib-macros 0.18.5 -> proc-macro-error`. Absent on Windows. Both macro crates require `^1.0`. | Reevaluate with the GTK/GLib family change above or a compatible upstream macro-crate release that removes/replaces this dependency. No patched release is listed; an unrelated crate cannot be substituted through a lockfile resolution. |
| Five UNIC packages, all `0.9.0` | **Both Windows and Linux**, normal runtime and build/proc-macro paths through `tauri-utils 2.9.3 -> urlpattern 0.3.0 -> unic-ucd-ident`. Exact leaves and IDs are below. | On the next Tauri-utils/urlpattern update, evaluate a compatible urlpattern release that replaces UNIC and then verify all five packages disappear from both target graphs. `urlpattern 0.3.0` requires `unic-ucd-ident ^0.9.0`; no patched UNIC releases are listed. |

UNIC roots include normal dependencies from `tauri`, `tauri-runtime` and `tauri-runtime-wry` to `tauri-utils`; build dependencies from the application and Tauri to `tauri-build 2.6.3 -> tauri-utils`, plus Tauri's direct build dependency on `tauri-utils`; and `tauri -> tauri-macros 2.6.3 -> tauri-codegen 2.6.3 -> tauri-utils` (also directly from `tauri-macros`). After `urlpattern -> unic-ucd-ident`, the five audited leaves are:

- `unic-ucd-ident` — RUSTSEC-2025-0100.
- `unic-ucd-ident -> unic-char-property` — RUSTSEC-2025-0081.
- `unic-ucd-ident -> unic-char-range` — RUSTSEC-2025-0075.
- `unic-ucd-ident -> unic-ucd-version` — RUSTSEC-2025-0098.
- `unic-ucd-ident -> unic-ucd-version -> unic-common` — RUSTSEC-2025-0080.

No residual warning is classified solely as an application development dependency. Proc-macros execute on the build host even when their consuming graph targets Linux. The conclusions above cover the queried feature configurations and targets, not every supported platform or potential application attack path.

## Validation boundary

The final commit must be checked with the following commands; the delivery report records their exact-SHA results separately from this dependency investigation:

```text
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
node scripts/check-windows-glib.mjs
cargo audit --file src-tauri/Cargo.lock
pnpm tauri:build
```

Windows build/test success cannot validate the patched Linux-only listener path. Linux target graph resolution is not Linux compilation, native execution or packaging proof. Hosted checks require an actual run at the final SHA; the existing workflow is triggered by pull requests, `main` pushes or explicit dispatch, not an ordinary feature-branch push. No installer execution, UAC interaction, updater operation, real database access, application acceptance suite, warning suppression or platform-support change is part of this patch.
