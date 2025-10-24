# Contributing Guide

Thank you for your interest in improving Prompt Vault! This guide outlines the preferred workflow for contributing changes.

## Getting Started

1. Fork the repository and clone your fork locally.
2. Install dependencies with `npm install`.
3. Run `npm test` to ensure the suite passes before making changes.

## Development Workflow

1. Create a feature branch: `git checkout -b feat/my-feature`.
2. Make your changes following the architecture documented in `docs/architecture.md`.
3. Write or update tests under `tests/` to cover your changes.
4. Run linting and tests locally: `npm run lint` and `npm test`.
5. Commit using descriptive messages and open a pull request against `main`.

## Code Style

- Use TypeScript with strict typing enabled.
- Keep functions small and pure where possible; push side-effects to the CLI or platform-specific adapters.
- Include docstrings (JSDoc) for classes and exported functions.
- Format code using your editor's TypeScript formatter; lint errors must be resolved before submission.

## Commit & PR Expectations

- Reference related issues in commit messages or PR description.
- Provide a summary of changes, testing performed, and screenshots (if UI-related).
- Update relevant documentation and changelog entries.

## Reporting Issues

1. Search existing issues to avoid duplicates.
2. Include reproduction steps, expected vs. actual results, and environment details.
3. If the issue involves security, follow the disclosure process described in `SECURITY.md`.

We appreciate your contributions and feedback! Together we can build a polished Prompt Vault experience.
