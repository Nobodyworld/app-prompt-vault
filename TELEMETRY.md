## Telemetry logs (renderer)

This repository persists renderer telemetry events produced by the app (via the ErrorBoundary) into a small telemetry directory under the application local data directory.

Where to find the telemetry files (examples)

- Windows (PowerShell):
  - %LOCALAPPDATA%\prompt-vault-telemetry\telemetry-YYYY-MM-DD.log
  - Example: Get-ChildItem "$env:LOCALAPPDATA\prompt-vault-telemetry\" -Recurse

- macOS (bash/zsh):
  - ~/Library/Application Support/prompt-vault-telemetry/telemetry-YYYY-MM-DD.log
  - Example: tail -n 200 "~/Library/Application Support/prompt-vault-telemetry/telemetry-$(date +%F).log"

- Linux (bash):
  - $XDG_DATA_HOME/prompt-vault-telemetry/telemetry-YYYY-MM-DD.log or ~/.local/share/prompt-vault-telemetry/
  - Example: tail -n 200 ~/.local/share/prompt-vault-telemetry/telemetry-$(date +%F).log

Notes

- Files are rotated daily and capped at ~5 MiB per file. When a file grows beyond the cap it is renamed to `telemetry-YYYY-MM-DD.N.log` and a new file is started.
- Each line in the log files is a single JSON object (ndjson) representing the telemetry payload forwarded from the renderer.
- The Tauri backend also maintains a small `telemetry-metrics.json` in the same directory with simple event counters (useful for quick inspection by observability tools).

Dumping logs locally

From the repository root you can use the included CLI binary (build with cargo) to dump recent telemetry files:

Windows (PowerShell):

```powershell
cargo run --bin dump_telemetry -- "$env:LOCALAPPDATA\prompt-vault-telemetry" 200
```

macOS / Linux:

```bash
cargo run --bin dump_telemetry -- "$HOME/.local/share/prompt-vault-telemetry" 200
```

Or inspect files directly with tail / Get-Content -Tail:

```powershell
# Windows PowerShell
Get-Content "$env:LOCALAPPDATA\prompt-vault-telemetry\telemetry-2025-10-26.log" -Tail 200

# macOS / Linux
tail -n 200 "~/Library/Application Support/prompt-vault-telemetry/telemetry-2025-10-26.log"
```

If the folder is empty or missing, the app has not recorded any renderer telemetry yet.
