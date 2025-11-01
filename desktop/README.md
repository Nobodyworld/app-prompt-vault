# Desktop Frontend

The `desktop/` directory contains the React + Tauri desktop application. It consumes the same domain services as the CLI and web
API to provide a unified management interface.

- `src/` houses React components, state management, and platform bridges.
- `vite.config.ts` configures bundling for the desktop build.
- `tsconfig.json` provides TypeScript settings tuned for the Tauri runtime.

See [`docs/architecture/overview.md`](../docs/architecture/overview.md) for diagrams showing how the desktop shell interacts with
the backend services.
