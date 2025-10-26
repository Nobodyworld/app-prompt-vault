Dev-only utilities for diagnosing renderer issues.

These scripts are optional and intended to be run manually during local development. They are not executed in CI. If you need to capture console output from the Tauri renderer, run the capture script while the dev server is running:

PowerShell example:

```powershell
node ./dev-tools/capture-console.cjs http://localhost:1420/ tauri-renderer.log
```

Notes:
- These tools rely on Puppeteer and are intentionally separated from the main `scripts/` folder so they are opt-in.
- Keep them out of CI and do not invoke them in automated workflows.
