# Config (app-prompt-vault)

Runtime configuration, defaults, and validation.

Entry point: `src/config/index.ts` (`getPromptVaultConfig`).

Notes:

- Reads from Node `process.env` and Vite `import.meta.env` (merged).
- Normalizes log level via `PROMPT_VAULT_LOG_LEVEL` / `VITE_LOG_LEVEL` / `LOG_LEVEL`.
- Delegates server settings to `src/config/serverConfig.ts`.
