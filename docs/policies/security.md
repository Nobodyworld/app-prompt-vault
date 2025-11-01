# Security Policy

## Supported Versions

The project is currently pre-release (`0.1.x`). All security issues affecting the default branch will be addressed as soon as poss
ible. Formal support matrix will be published alongside the first stable release.

## Reporting a Vulnerability

1. **Do not open a public issue.** Instead, email security reports to `security@prompt-vault.local`.
2. Include the following information:
   - Description of the vulnerability and potential impact.
   - Steps to reproduce or proof-of-concept.
   - Suggested mitigations if known.
3. You will receive acknowledgement within 48 hours. We aim to provide an initial assessment within 5 business days.

## Disclosure Process

- We will work with you to verify the issue and determine a remediation plan.
- Coordinated disclosure is preferred. We kindly request a 30-day embargo after the fix is available before public disclosure.
- Credit will be given in release notes unless anonymity is requested.

## Hardening Checklist

- Run `npm run security:scan` (wrapper around `npm audit --omit=dev`) before releases and address high/critical issues prior to shipping.
- Keep dependencies up to date (see `docs/DEPENDENCIES.md`).
- Enable SQLite `PRAGMA foreign_keys = ON`, `busy_timeout`, and `journal_mode = WAL` on writable databases (handled by `ConnectionFactory`).
- Ensure SQLite databases are stored in user-controlled directories with appropriate permissions.
- Validate all user input using the Zod schemas provided in `src/domain/validation.ts`.
- Redact secrets or API tokens from logs; Prompt Vault intentionally avoids logging prompt bodies.
- Review release artifacts against `docs/releases/notes.md` for migration or operational calls to action.
- Enable observability endpoints only when required and ensure metric exports do not include sensitive prompt content.

## Residual Risks

- Local databases are not encrypted; rely on full-disk encryption and OS permissions for confidentiality.
- Prompt content is stored in plaintext. Scrub sensitive data before importing prompts into the vault.
- Dependency scanning depends on npm registry availability; capture audit logs during releases and mirror advisories for air-gapped environments.

Thank you for helping keep Prompt Vault users safe!
