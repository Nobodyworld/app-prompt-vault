// Prompt Vault uses a desktop-first Vite root under `desktop/`.
// This thin config keeps the standard root-level `vite.config.ts` entrypoint
// present for repo-wide conventions and tooling.

import config from "./desktop/vite.config";

export default config;

