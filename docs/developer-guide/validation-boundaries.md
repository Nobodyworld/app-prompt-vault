# Validation Ownership and External Runner Boundary

## Status

- **Decision date:** 2026-08-18
- **Tracking:** Issue #64
- **Migration state:** Planned and gated; repository-local validation remains authoritative until parity is accepted

## Principle

Prompt Vault owns product correctness. Reusable execution machinery may be delegated to an external registered validation runner when that runner can prove the required behavior safely and deterministically.

Prompt Vault must remain independently installable, buildable, testable, and usable. The external runner must never become a runtime dependency, package dependency, hidden build prerequisite, or requirement for normal contributors.

## Prompt Vault responsibilities

This repository continues to own:

- product behavior, recovery semantics, and product-specific acceptance requirements;
- unit, integration, component, Playwright, Rust, and Tauri build validation;
- product fixtures, selectors, expected outcomes, and integrity assertions;
- repository-local validation commands;
- source-controlled acceptance contracts;
- a bounded local or manual fallback when external execution is unavailable;
- all product, merge, release, signing, and distribution decisions.

## External-runner responsibilities

After capability parity is accepted, reusable mechanisms may be executed by an external registered validation runner, including:

- exact packaged-candidate identity and launch;
- disposable application-data, database, browser, and WebView profile isolation;
- bounded loopback port leasing;
- process-tree containment, timeout handling, restart recovery, and cleanup;
- reusable browser or installed-WebView transport;
- protected-file before/after inventories;
- SQLite integrity and foreign-key evidence;
- privacy-safe evidence projection;
- optional installer upgrade and uninstall lifecycle execution;
- explicit human approval gates for administrator-required operations.

The runner may select only immutable registered capabilities and bounded inputs. It must not accept arbitrary executables, commands, paths, environments, ports, or desktop-automation instructions.

## Installed and native acceptance scope

Installed/native acceptance should prove behavior that lower test layers cannot establish reliably.

For recovery work, the native smoke should focus on:

1. exact candidate and native storage identity;
2. disposable database usage;
3. one representative backup and recovery round trip;
4. one representative legacy recovery;
5. persistence across restart;
6. protected-current and legacy-source immutability;
7. SQLite integrity and zero foreign-key violations;
8. basic installed keyboard accessibility.

Conflict permutations, malformed plans, stale-plan rejection, cancellation variants, and detailed version-history behavior should remain primarily in deterministic service, component, and Playwright tests.

## Installer lifecycle trigger

A full installer upgrade or uninstall exercise is required only when a change affects an installation boundary, such as:

- installer configuration or installation scope;
- application identifier;
- storage or database location;
- uninstall data-preservation behavior;
- packaging or update scripts;
- an explicitly approved release candidate.

Ordinary Prompt Vault feature changes must not require replacement of an unrelated managed installation merely to validate product behavior.

## Migration gates

Repository-owned generic infrastructure may be retired only after all of the following are true:

- [ ] Required external capabilities are implemented, immutable, registered, and versioned.
- [ ] A bounded Prompt Vault profile uses only approved artifacts, fixtures, paths, selectors, and inputs.
- [ ] The reduced native smoke passes against an exact accepted candidate using disposable data.
- [ ] Pass, failure, timeout, cancellation, and abandoned-run cleanup are fail-closed.
- [ ] Protected Prompt Vault data and the primary checkout remain unchanged.
- [ ] Public evidence contains no prompt bodies, credentials, private paths, or private infrastructure details.
- [ ] A repository-local fallback remains documented and viable.
- [ ] Removal of duplicated generic scripts is reviewed in a separate Prompt Vault pull request.

Until those gates pass, repository-local validation remains the source of truth.

## Public documentation and evidence

Public Prompt Vault material should describe the dependency generically as an **external registered validation runner** or **private validation infrastructure**.

Do not publish or infer:

- the private implementation repository or links to it;
- private issue, branch, workflow, profile, or schema identifiers;
- internal paths, commands, ports, process details, or evidence locations;
- raw logs or machine-specific inventories.

Public evidence should report only what is needed to establish the Prompt Vault result: tested commit, bounded check identity, pass/fail status, relevant counts, artifact digest when appropriate, data-preservation result, and known limitations.

## Full-time operating model

After cutover, the external runner becomes the default authority for reusable Prompt Vault installed/native acceptance and installer-lifecycle checks. Ordinary source validation remains repository-owned and directly runnable.

The runner executes Prompt Vault's registered acceptance contract; it does not own Prompt Vault product logic or define what the product should do.
