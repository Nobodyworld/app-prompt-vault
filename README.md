# app-prompt-vault

A lightweight desktop vault to collect, version, and tag reusable prompts. Built with Tauri, React, and SQLite following the All-Builds control-plane guard rails.

## Getting started (developer)

Install dependencies and run the web UI during development. For most UI work you don't need a native toolchain.

```powershell
# install dependencies
npm ci

# start Vite dev server (web only)
npm run dev

# open the app inside Tauri shell (requires Rust toolchain + native linker)
npm run tauri dev
```

## Build (production)

Create production UI assets and then optionally build native bundles.

```powershell
# build UI
npm run build

# build Tauri native bundles (Windows/macOS/Linux). Note: native builds require a working Rust toolchain and platform linker.
npm run tauri build
```

### Notes about native builds (Windows)

- The Rust MSVC toolchain requires the Microsoft Visual C++ linker (`link.exe`). If you don't want to install Visual Studio/Build Tools locally, use the provided GitHub Actions workflow which runs on `windows-latest` and produces native artifacts for you (see `.github/workflows/tauri-windows.yml`).
- If you prefer a fully local, Visual-Studio-free route you can target the GNU toolchain (MSYS2/MinGW) — see `docs/` for an example setup and caveats.

Built native bundles (when produced) live under `src-tauri/target/release/bundle/` in the build runner.

## Tests

Unit tests use Vitest + React Testing Library.

```powershell
# run tests once
npx vitest run

# run in watch mode during development
npx vitest
```

## Scripts (summary)

- `npm run dev` — launch the Vite dev server for the React UI.
- `npm run build` — create a production build for the UI.
- `npm run tauri dev` — run the full Tauri shell with hot reload (requires native toolchain).
- `npm run tauri build` — build native distributables (requires native toolchain or CI).
- `npm test` / `npx vitest run` — run unit tests.

## Quick troubleshooting

- If `npm run tauri build` fails on Windows with `link.exe not found`, either install Visual Studio Build Tools (Desktop development with C++) or use the GitHub Actions workflow to produce bundles in CI.

See `docs/` and `README-DockWidget.md` for component-level notes and testing guidance.
