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

- Run `npm audit` before releases.
- Keep dependencies up to date (see `docs/DEPENDENCIES.md`).
- Ensure SQLite databases are stored in user-controlled directories with appropriate permissions.
- Validate all user input using the Zod schemas provided in `src/domain/validation.ts`.

Thank you for helping keep Prompt Vault users safe!
