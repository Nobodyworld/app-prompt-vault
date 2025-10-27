# Contributing Guide

Thank you for your interest in improving Prompt Vault! This guide outlines the preferred workflow for contributing changes.

## Getting Started

1. Fork the repository and clone your fork locally.
2. Install dependencies with `npm install`.
3. Run `npm run quality:gate` to ensure linting, build, tests (with coverage thresholds), and security scan pass before making changes.

## Development Workflow

1. Create a feature branch using the `<type>/<short-description>` convention (e.g., `feat/plugin-audit`).
2. Make your changes following the architecture documented in `ARCHITECTURE_OVERVIEW.md` and `docs/architecture.md`.
3. Write or update tests under `tests/` to cover your changes.
4. Run `npm run quality:gate` locally (or `npm run validate` for backwards compatibility).
5. When adding plugins, prefer the `npm run extension:scaffold <name>` template and export them via `src/extensions/index.ts`.
6. Document new behaviour in README/guide files and update `CHANGELOG.md` or `RELEASE_NOTES.md` where appropriate.
6. Commit using descriptive messages and open a pull request against `main`.

## Code Style

- Use TypeScript with strict typing enabled.
- Keep functions small and pure where possible; push side-effects to the CLI or platform-specific adapters.
- Include docstrings (JSDoc) for classes and exported functions.
- Format code using your editor's TypeScript formatter; lint errors must be resolved before submission.
- Instrument long-running flows with `StructuredLogger` and telemetry spans so they appear in metrics; scrape `/observability/metrics` in local testing when troubleshooting.

## Commit & PR Expectations

- Reference related issues in commit messages or PR description.
- Provide a summary of changes, testing performed, and screenshots (if UI-related).
- Update relevant documentation, changelog entries, and release notes.
- Call out residual risks or follow-ups using `TODO(P#, <estimate>)` markers when code changes cannot fully resolve them.

## Reporting Issues

1. Search existing issues to avoid duplicates.
2. Include reproduction steps, expected vs. actual results, and environment details.
3. If the issue involves security, follow the disclosure process described in `SECURITY.md`.

We appreciate your contributions and feedback! Together we can build a polished Prompt Vault experience.
