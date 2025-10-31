# Dev Tools

Dev-only utilities for diagnosing and debugging during local development.

These scripts are optional and intended to be run manually. They are not executed in CI.

## Available Tools

### capture-console.cjs

Capture console output from the Tauri renderer while the dev server is running.

**Usage:**

```bash
node ./dev-tools/capture-console.cjs http://localhost:1420/ tauri-renderer.log
```

### insert-and-read.cjs

Smoke test script for SQLite database operations. Inserts a test prompt and reads it back.

**Usage:**

```bash
node ./dev-tools/insert-and-read.cjs
```

**Note:** Requires `prompt-vault.db` file to exist. Use `npm run db:bootstrap` to create it.

### inspect-db.js

Quick database inspection utility. Shows table structure and row counts.

**Usage:**

```bash
node ./dev-tools/inspect-db.js
```

**Note:** Requires `prompt-vault.db` file to exist.

## Notes

- These tools may rely on specific dependencies (e.g., Puppeteer) and are intentionally separated from the main `scripts/` folder to be opt-in.
- Keep them out of CI and do not invoke them in automated workflows.
- Scripts use CommonJS (`.cjs`) or plain JavaScript to avoid TypeScript compilation overhead.
