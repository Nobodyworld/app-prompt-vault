# Standalone Dependency Matrix

This document records the dependency boundary for making `app-prompt-vault` reproducibly buildable outside the Nobodyworld workspace. It is authoritative for issue #22 while PR #27 remains open.

## Connector-resolved dependencies

| Previous dependency | Resolution in PR #27 |
| --- | --- |
| `../../vitest.shared` | Coverage configuration is now app-local in `vitest.shared.ts`. |
| Parent `node_modules/@types` paths | Root and desktop TypeScript configs now use only app-local type roots. |
| `@nw/connectors-http` | The timeout-aware fetch adapter is implemented locally in `src/lib/platform-connectors.ts`. |
| `@nw/ui-theme` | Theme application is implemented locally and now updates the document theme attributes. |
| `../../../packages/secrets/native` | The native secrets crate is vendored under `src-tauri/crates/nw-secrets`. |

These boundaries are enforced by `pnpm repository:audit`.

## Remaining workspace contracts

| Package | Confirmed use | Recommended extraction strategy |
| --- | --- | --- |
| `@nw/core-db` | Shared API-key/session verification, auth bootstrap, Core DB reset, and an integrity-result type through `src/lib/platform-core.ts`. | Define a Prompt Vault auth/integrity interface. Provide an app-local implementation and retain the Nobodyworld adapter as an optional integration. |
| `@nw/event-bus` | Cross-app tag subscriptions and prompt lifecycle events through `src/lib/nw-bridge.ts`. | Provide an app-local event bus by default. Load the Nobodyworld bridge only when platform integration is enabled. |
| `@nw/logging` | Structured logging and recent-log access through `src/lib/platform-core.ts`. | Consolidate on `src/observability/logger.ts`; expose a compatibility adapter for Nobodyworld logging. |
| `@nw/orchestrator-sdk` | Tool definitions, handler types, and tool registration through `src/lib/platform-orchestrator.ts`. | Keep tool definitions app-local and make external registration an optional adapter. |
| `@nw/pages-widgets` | Hub widget registration through `src/widgets/register.ts`. | Keep widget metadata app-local; make Hub registration an optional integration entry point. |
| `@nw/secrets` | Persistent JWT-secret retrieval/storage for the HTTP auth manager. | Default to injected `JWT_SECRET` or a documented app-local secret backend; retain the shared store as an optional adapter. |
| `@nw/tags-projects` | Shared project tags, shared tag lookup, entity-tag relationships, and project-scoped tool behavior. | Separate local Prompt Vault tags from optional Nobodyworld project-tag synchronization. This is the largest remaining contract and should be extracted behind one interface rather than copied piecemeal. |
| `@nw/ui-kit` | Declared in `package.json`; no direct call site was confirmed through the connector review. | Run a repository-wide import search and clean build. Remove it if no call site exists. Do not retain an unused workspace dependency. |

## Required implementation order

1. Remove or confirm `@nw/ui-kit`.
2. Consolidate logging behind the existing app logger.
3. Make event-bus, widget, and orchestrator registration optional integrations.
4. Replace the JavaScript secrets dependency with an app-local secret-provider interface.
5. Extract shared auth/Core DB behavior behind an interface.
6. Extract `@nw/tags-projects` last because it affects prompt enrichment, project scoping, imports, exports, and tool behavior.

## Release proof

The dependency work is complete only when a clean supported checkout can run:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm repository:audit
pnpm lint
pnpm typecheck
pnpm test
pnpm desktop:build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:build
```

Passing inside the parent monorepo is useful integration evidence but does not satisfy the standalone release gate.
