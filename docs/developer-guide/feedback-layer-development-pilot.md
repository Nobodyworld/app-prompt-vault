# Feedback Layer development pilot

## Status

This document defines Prompt Vault issue #74.

- Base `main`: `13cb413c3829b94ac9902974a07a3a56d629e247`
- Branch: `feature/feedback-layer-pilot`
- Delivery: one draft pull request
- Protocol target: `feedback-layer.development-integration@1`
- Prompt Vault development origin: `http://127.0.0.1:1420`

The pilot is optional, local, development-only, and disabled by default. Prompt Vault remains a standalone public repository and production product.

## Objective

Use Prompt Vault as a real React/Vite consumer of a local development-feedback service while proving:

- the integration can capture annotations against durable application surfaces;
- prompt bodies and other private values remain redacted;
- Prompt Vault remains usable when the service is disabled, unavailable, revoked, or stopped;
- the executable integration is absent from production output;
- stable semantic anchors survive a legitimate component refactor;
- no sibling repository or private package is required to build Prompt Vault.

## Repository authority

Prompt Vault owns:

- prompts and prompt versions;
- the React/Vite/Tauri application;
- its routes, UI, tests, production bundle, and semantic surface identifiers.

The feedback service owns:

- annotations and sessions;
- anchor-resolution evidence;
- review and owner verification;
- local integration authorization.

Prompt Vault must not persist feedback annotations in its database or send prompt content into source-controlled fixtures, logs, screenshots, or public evidence.

## Development-only Vite architecture

Use a local Vite plugin or equivalent development-server mechanism with:

```ts
apply: "serve"
```

Do not statically import the feedback SDK into normal React application modules.

The plugin must:

1. remain disabled unless explicitly enabled;
2. read configuration only on the Vite server side;
3. validate enabled configuration before serving the app;
4. require a loopback HTTP service origin;
5. require exact expected origin `http://127.0.0.1:1420`;
6. require a bounded runtime project ID;
7. require exact protocol `feedback-layer.development-integration@1`;
8. fetch the versioned contract and SDK;
9. verify SDK byte length and SHA-256;
10. expose verified SDK bytes through a same-origin development middleware route;
11. inject one minimal development loader into served HTML;
12. avoid duplicate instances across HMR/reloads;
13. inject nothing during `vite build` or a Tauri production build.

Recommended server-only configuration:

```text
FEEDBACK_LAYER_PILOT_ENABLED
FEEDBACK_LAYER_SERVICE_URL
FEEDBACK_LAYER_PROJECT_ID
FEEDBACK_LAYER_EXPECTED_ORIGIN
FEEDBACK_LAYER_CONTRACT
```

Do not use `VITE_` prefixes for this integration contract. Real project IDs and tokens are local runtime state and must not be committed.

Example local values:

```text
FEEDBACK_LAYER_PILOT_ENABLED=true
FEEDBACK_LAYER_SERVICE_URL=http://127.0.0.1:3178
FEEDBACK_LAYER_EXPECTED_ORIGIN=http://127.0.0.1:1420
FEEDBACK_LAYER_CONTRACT=feedback-layer.development-integration@1
```

## Implemented development boundary

The pilot implementation lives in `desktop/vite.feedback-layer-pilot.ts` and is wired into Vite with `apply: "serve"`. When valid server-only configuration enables it, the plugin verifies the service-owned contract and SDK before serving either of these same-origin development resources:

```text
/@prompt-vault/feedback-layer-pilot.js
/@prompt-vault/feedback-layer-sdk.js
```

The loader owns one installation, destroys it during HMR disposal, and uses bounded retries only for temporary service loss. Revoked origins, inactive projects, invalid contracts, and integrity mismatches remain fail-closed. Pilot failures are isolated from Prompt Vault's React error boundary.

Static product-semantic anchors are declared in the rendered React surfaces. Dynamic prompt and version anchors pass through bounded record-ID validators before rendering. Value-bearing surfaces explicitly declare both `data-feedback-private` and `data-feedback-redact`.

`pnpm feedback:production-check` recursively inspects the actual `desktop/dist` HTML, JavaScript, CSS, and source maps. It permits only inert semantic/privacy attributes and fails closed on executable integration markers or unexpected output. The command runs inside `pnpm quality:gate`.

## Configuration behavior

### Disabled

When disabled:

- no feedback-service request occurs;
- no loader is injected;
- no global object or launcher exists;
- Prompt Vault development and production behavior remain ordinary.

### Invalid enabled configuration

Development startup must fail clearly when:

- the service URL is missing, malformed, non-HTTP, or non-loopback;
- expected origin is missing or does not exactly match the Vite host/port;
- project ID is missing or malformed;
- protocol identity is unsupported;
- contract JSON is malformed;
- SDK byte length or digest does not match.

Do not silently downgrade authorization or execute unverified SDK bytes.

### Temporarily unavailable service

When configuration is valid but the service cannot be reached:

- Prompt Vault must render and operate normally;
- the failure must not trigger Prompt Vault’s fatal application overlay;
- retries must be bounded;
- logs must omit project IDs, tokens, prompt content, response bodies, and local paths;
- recovery may occur without a page reload when safely supported.

Origin revocation or project deactivation must fail closed immediately and remain distinct from temporary service unavailability.

## Semantic anchor naming

Identifiers describe durable product meaning, not position, appearance, translated copy, or DOM order.

Pattern:

```text
prompt-vault.<surface>[.<stable-record-id>][.<action>]
```

Required static anchors include equivalents of:

```text
prompt-vault.shell
prompt-vault.brand
prompt-vault.navigation.primary
prompt-vault.workspace
prompt-vault.library.workspace
prompt-vault.library.search
prompt-vault.library.filters
prompt-vault.library.sort
prompt-vault.library.results
prompt-vault.library.new
prompt-vault.editor.create
prompt-vault.editor.create.title
prompt-vault.editor.create.body
prompt-vault.editor.create.options
prompt-vault.editor.create.clear
prompt-vault.editor.create.cancel
prompt-vault.editor.create.save
prompt-vault.editor.edit
prompt-vault.editor.edit.title
prompt-vault.editor.edit.body
prompt-vault.editor.edit.save
prompt-vault.editor.version-history
prompt-vault.editor.version-preview
prompt-vault.settings.workspace
prompt-vault.settings.backup.export
prompt-vault.settings.recovery.file
prompt-vault.settings.recovery.preview
prompt-vault.settings.recovery.apply
prompt-vault.advanced.workspace
```

Dynamic prompt surfaces use validated prompt IDs:

```tsx
data-feedback-id={`prompt-vault.prompt.${prompt.id}`}
data-feedback-id={`prompt-vault.prompt.${prompt.id}.copy`}
data-feedback-id={`prompt-vault.prompt.${prompt.id}.favorite`}
data-feedback-id={`prompt-vault.prompt.${prompt.id}.edit`}
```

Do not use prompt title text in identifiers.

Forbidden examples:

```text
left-button-2
third-row
blue-panel
desktop-column-right
```

## Private and value-bearing surfaces

Prompt bodies, title/search inputs, recovery file inputs, category/tag fields, and similar value-bearing controls must include explicit privacy metadata in addition to native-control detection:

```html
data-feedback-private
data-feedback-redact
```

A safe semantic ID may remain available. The integration must not expose:

- current values;
- accessible private labels derived from user content;
- prompt body text;
- private ancestor text;
- selector ancestry;
- text-derived fingerprints;
- local filenames or paths.

## Candidate surface map

### `desktop/src/components/Layout.tsx`

Add anchors for:

- application shell;
- brand/home link;
- primary navigation;
- main workspace;
- local fallback/offline banner where useful.

### `desktop/src/pages/LibraryPage.tsx`

Add anchors for:

- library workspace;
- new-prompt action;
- search;
- favorites filter;
- sort;
- additional filters;
- reset filters;
- results region.

### `desktop/src/components/PromptList.tsx`

Add dynamic anchors for:

- prompt row;
- copy action;
- favorite action;
- edit action.

### `desktop/src/pages/CreatePromptPage.tsx`

Add anchors for:

- form;
- title input;
- prompt body;
- advanced options;
- clear draft;
- cancel;
- save.

### `desktop/src/pages/EditPromptPage.tsx`

Add anchors for:

- form;
- title and body;
- save;
- version history;
- version preview;
- revert controls.

### `desktop/src/pages/SettingsPage.tsx`

Add anchors for:

- settings workspace;
- verified backup export;
- recovery file selection;
- recovery preview;
- confirmation and apply;
- storage/integrity controls.

### `desktop/src/pages/PromptListPage.tsx`

Add anchors for the advanced workspace and major import/export surfaces that are part of the rendered product.

## Route and build evidence

The development loader may supply bounded evidence:

- application name `Prompt Vault`;
- application version from the canonical Prompt Vault version surface;
- BrowserRouter route;
- viewport;
- development mode;
- bounded surface identity.

Do not send:

- prompt bodies or current field values;
- tags/categories from private controls;
- database paths;
- API keys, JWTs, or raw environment variables;
- telemetry payloads;
- Tauri filesystem paths.

Repository branch and commit evidence must be derived by the feedback service from the registered repository root rather than trusted from browser input.

## Production exclusion

Add a command such as:

```text
pnpm feedback:production-check
```

The command must inspect actual production output recursively and fail on executable pilot material, including:

- feedback SDK or loader code;
- `FeedbackLayer.install`;
- service origins;
- runtime project IDs;
- `FEEDBACK_LAYER_*` configuration names;
- versioned contract/bootstrap routes;
- capture-session or resolution-challenge API paths.

Allowed inert attributes:

```text
data-feedback-id
data-feedback-private
data-feedback-redact
```

The check must:

- report bounded repository-relative output paths;
- fail closed on unreadable/unexpected output;
- be wired into the normal quality gate;
- prove the development plugin does not run during production build;
- prove Prompt Vault has no `file:` or workspace dependency on a sibling feedback repository.

## Tests

Add unit/integration coverage for:

- disabled configuration;
- valid enabled configuration;
- malformed or non-loopback service URL;
- wrong expected origin;
- missing/malformed project ID;
- protocol mismatch;
- SDK checksum mismatch;
- initial service unavailability;
- service loss after installation;
- HMR/reinstall singleton behavior;
- no production injection;
- production scan pass/failure fixtures;
- semantic ID syntax and static uniqueness;
- dynamic prompt-row uniqueness;
- explicit private attributes;
- route/build evidence allowlist;
- no fatal application overlay from pilot failure.

Add one focused Playwright pilot spec without weakening existing smoke, daily-library, advanced-list, or recovery coverage.

## Real refactor proof

The pilot requires two Prompt Vault commits:

### Baseline integration

Implement the plugin, anchors, production check, tests, and documentation. Record the exact baseline SHA and run the applicable quality gate.

### Legitimate refactor

After baseline annotations are captured, stop Prompt Vault and extract or reorganize a meaningful anchored component while preserving semantic identity and accessible behavior. Suitable candidates include the library toolbar or prompt-row action group.

The refactor must improve component structure and remain independently reviewable. It must not be a cosmetic no-op created only to satisfy the pilot.

After restart, use the real local resolution challenge. A preserved semantic ID should resolve deterministically; any weak anchor that becomes stale or ambiguous must be reported honestly.

## Controlled-browser pilot

Use synthetic prompts and disposable databases outside the repository.

Exercise:

- disabled and enabled states;
- element, page, and project capture;
- several annotations in one session;
- reading/scroll-position preservation;
- prompt-body/input redaction;
- keyboard capture and Escape cancellation;
- service unavailable before load and after installation;
- origin revocation/restoration;
- project deactivation/reactivation;
- restart persistence;
- baseline-to-refactor re-resolution;
- dedicated owner verification through the feedback product;
- desktop and narrow layouts;
- true 200% zoom only if the browser supports real zoom.

Use `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`. Do not substitute narrow width for true zoom or controlled-browser evidence for native Microsoft Edge acceptance.

## Required Prompt Vault validation

```text
pnpm audit --prod --audit-level=high
pnpm repository:audit
pnpm lint
pnpm typecheck
pnpm build
pnpm test:coverage
pnpm coverage:summary
pnpm feedback:production-check
pnpm test:ui
pnpm security:scan
git diff --check
```

Run `pnpm desktop:build` and native/Tauri checks when materially required. State exactly what ran.

## Data and cleanup rules

Use one uniquely named operating-system temporary root for:

- disposable Prompt Vault databases;
- disposable feedback-service registry/store;
- synthetic imports/exports;
- browser evidence;
- screenshots and logs.

Before deletion:

- stop services;
- verify exact listener processes and ports;
- close browser tabs;
- prove the path is beneath the operating-system temporary directory;
- inventory contents;
- confirm no unknown or user-created content exists;
- remove only the exact pilot-owned root;
- confirm it is absent.

Follow `AGENTS.md` worktree and ignored-file reconciliation rules. Never clean a protected checkout or delete unknown untracked/ignored data.

## Public-repository evidence policy

Do not commit or publish:

- private repository URLs or private implementation details not needed by this repository;
- real project IDs or tokens;
- real prompt bodies or annotations;
- database or filesystem paths;
- uncontrolled screenshots;
- raw environment dumps;
- authenticated request/response bodies.

Public evidence should describe the generic local development protocol, Prompt Vault-owned semantic anchors, production exclusion, and synthetic acceptance results.

## Completion boundary

Issue #74 is complete only when:

- the development-only plugin is disabled by default;
- exact contract and SDK integrity are verified;
- Prompt Vault remains usable through service failure and revocation;
- semantic/private attributes are tested;
- production output passes the exclusion gate;
- a real component refactor exercises live re-resolution;
- Prompt Vault’s applicable quality matrix passes at one exact final SHA;
- controlled-browser evidence is recorded using disposable synthetic data;
- no private/user data enters Git;
- the draft pull request is reviewed and explicitly authorized before merge.