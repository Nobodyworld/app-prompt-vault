# Desktop UI (`desktop/`)

React-based user interface for Prompt Vault, built with Vite and designed to work in both Tauri (desktop) and browser environments.

## Directory Structure

```
desktop/
├── src/
│   ├── components/        # Reusable UI components
│   │   ├── __tests__/    # Component unit tests
│   │   ├── ErrorBoundary.tsx
│   │   ├── Layout.tsx
│   │   └── PromptList.tsx
│   ├── lib/              # Utility libraries
│   │   ├── clipboard.ts  # Clipboard operations
│   │   └── tauri.ts      # Tauri API detection and helpers
│   ├── pages/            # Route-level page components
│   │   ├── CreatePromptPage.tsx
│   │   ├── EditPromptPage.tsx
│   │   ├── PromptListPage.tsx
│   │   └── SettingsPage.tsx
│   ├── services/         # API client services
│   │   └── promptApi.ts  # HTTP/Tauri API abstraction
│   ├── types/            # TypeScript type definitions
│   │   └── prompt.ts     # Prompt-related types
│   ├── App.tsx           # Root application component with routing
│   ├── main.tsx          # Application entry point
│   └── vite-env.d.ts     # Vite environment type declarations
├── index.html            # HTML shell
├── tsconfig.json         # TypeScript configuration for UI
└── vite.config.ts        # Vite build configuration
```

## Key Features

### Cross-Platform Design

The UI automatically detects its runtime environment and adapts:

- **Desktop (Tauri)** - Uses Tauri's invoke API for native SQLite access
- **Web (Browser)** - Calls the Express HTTP API at `http://localhost:3001`

Detection logic is in `src/lib/tauri.ts`:

```typescript
import { isTauri } from './lib/tauri';

if (isTauri()) {
  // Use Tauri invoke API
  await invoke('create_prompt', { slug, title, body });
} else {
  // Use HTTP API
  await fetch('/api/prompts', { method: 'POST', body: JSON.stringify(...) });
}
```

### Pages

- **PromptListPage** - Browse and search prompts with tag filtering
- **CreatePromptPage** - Form for creating new prompts with metadata
- **EditPromptPage** - Edit existing prompts and add new versions
- **SettingsPage** - Application configuration

### Components

- **Layout** - Common application shell with navigation
- **PromptList** - Reusable prompt listing with filtering
- **ErrorBoundary** - React error boundary for graceful error handling

### Services

- **promptApi.ts** - Unified API client that abstracts Tauri vs HTTP differences
  - Automatically routes calls based on environment
  - Provides consistent interface for all prompt operations

## Development

### Running the Desktop App

```bash
# Vite development server (uses HTTP API)
npm run desktop:dev

# Tauri development mode (native desktop)
npm run tauri:dev
```

The Vite dev server runs on `http://localhost:5173` by default.

### Building for Production

```bash
# Build UI bundle
npm run desktop:build

# Build Tauri desktop app
npm run tauri:build
```

Built assets are output to `desktop/dist/`.

### Running in Web Mode

To test the web-based UI:

```bash
# Start the HTTP API server (in one terminal)
npm run web:dev

# Navigate to http://localhost:3001 in your browser
```

The server will serve the UI at the root and API endpoints at `/api/*`.

## Tech Stack

- **React 19** - UI framework
- **React Router 7** - Client-side routing
- **Vite 7** - Build tool and dev server
- **TypeScript 5** - Type safety
- **Tauri 2** - Native desktop wrapper (optional)

## Testing

Component tests are located in `src/components/__tests__/`.

```bash
# Run UI tests with coverage
npx vitest --config vitest.ui.config.ts run --coverage
```

Tests use `@testing-library/react` and `jsdom` for DOM emulation.

## State Management

Currently uses React component state and props. No global state management library is used.

For complex state needs in the future, consider:
- React Context API for shared application state
- Zustand or Jotai for lightweight global state
- TanStack Query for server state and caching

## Styling

Currently uses inline styles and basic CSS. Consider adding:
- CSS modules for scoped component styles
- Tailwind CSS for utility-first styling
- shadcn/ui for pre-built accessible components

## Environment Variables

The UI respects the following environment variables (via Vite):

- `VITE_API_URL` - Override default API URL (defaults to `http://localhost:3001`)

Define these in `.env.local` for local development.

## Related Documentation

- [../src-tauri/README.md](../src-tauri/README.md) - Tauri backend implementation
- [../src/web/](../src/web/) - HTTP API endpoints consumed by web mode
- [Vite Documentation](https://vitejs.dev/)
- [Tauri Documentation](https://tauri.app/)
