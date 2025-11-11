# Dependency Inventory

This document captures the runtime and development dependencies declared in `package.json` and explains their purpose and securit
y posture.

## Runtime Dependencies

| Package | Version | Purpose | Notes |
| --- | --- | --- | --- |
| `better-sqlite3` | ^9.4.0 | High-performance SQLite driver used by the repository layer. | Requires native compilation; monitor for CVEs via `npm audit`. |
| `chalk` | ^5.3.0 | Adds colorized CLI output for improved readability. | Pure ESM, no known vulnerabilities as of 2024-04. |
| `commander` | ^11.1.0 | Declarative CLI command parser powering the `prompt-vault` CLI. | Mature project, widely adopted. |
| `zod` | ^3.23.8 | Runtime validation and parsing for prompt inputs and search queries. | Provides safe parsing and sanitization. |

## Development Dependencies

| Package | Version | Purpose |
| --- | --- | --- |
| `typescript` | ^5.4.5 | Type checking and compilation. |
| `ts-node` | ^10.9.2 | Executes TypeScript directly (used for tooling). |
| `tsx` | ^4.7.1 | Fast TypeScript runner for the CLI during development. |
| `vitest` | ^1.5.0 | Test runner providing Jest-compatible APIs. |
| `eslint`, `@typescript-eslint/*` | ^8.57.0 / ^7.6.0 | Static analysis enforcing code quality and consistent style. |
| `@types/better-sqlite3`, `@types/node` | Latest | Type definitions for runtime dependencies. |
| `tslib` | ^2.6.2 | Shared TypeScript helper library for compiled output. |

## License & Compliance

All dependencies are MIT or similarly permissive except `better-sqlite3` (MIT) and `commander` (MIT). The project itself is Propr
i
etary; ensure redistribution complies with each dependency's license.

## Security Practices

- Run `npm audit` regularly and track advisories affecting SQLite bindings.
- Use Dependabot or Renovate to automate dependency updates.
- Pin major versions to avoid unexpected breaking changes.

This inventory should be updated whenever dependencies change.
