# Security Policy

## PRE-ALPHA SOURCE PREVIEW

Prompt Vault has no supported release or production deployment. The public repository, when enabled, is a proprietary source-available pre-alpha preview. Security fixes may be applied to `main`, but no support window or remediation service-level agreement is offered.

## Reporting a vulnerability

Do **not** disclose suspected vulnerabilities, credentials, prompt data, database contents, or reproduction details in a public issue, discussion, pull request, or commit.

Use GitHub Private Vulnerability Reporting:

1. Open the repository **Security** tab.
2. Select **Report a vulnerability**.
3. Submit the report privately through the GitHub security advisory form.

Before changing repository visibility, the repository owner must confirm that GitHub Private Vulnerability Reporting is enabled and that the **Report a vulnerability** action is visible. If that action is unavailable, do not publish vulnerability details publicly; wait for the owner to provide a verified private reporting channel.

Include:

- a concise description and expected impact;
- the affected commit, branch, surface, and configuration;
- reproduction steps or a proof of concept;
- any known mitigation;
- whether disclosure has already occurred.

## Disclosure process

- Reports will be reviewed on a best-effort basis during pre-alpha development.
- Coordinated disclosure is preferred.
- Avoid publishing exploit details until a fix or mitigation is available.
- Public access to source does not authorize testing against systems, accounts, data, or infrastructure you do not own or have explicit permission to test.

## Known residual risks

- The default branch is not proven to install or build standalone.
- Prompt content and local SQLite databases may be stored in plaintext.
- Historical code may depend on private Nobodyworld workspace packages or configuration.
- Authentication, migration, packaging, telemetry, and integration behavior are not validated release guarantees.
- Dependency and secret scanning may be incomplete until the public validation workflows execute successfully.

See [README.md](../../../README.md) for the current repository classification and limitations.
