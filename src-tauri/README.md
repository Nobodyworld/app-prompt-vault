# Tauri Backend (`src-tauri/`)

Rust-based native backend for the Tauri desktop application. Provides native SQLite access and system integration for the Prompt Vault desktop UI.

## Directory Structure

```
src-tauri/
├── src/
│   ├── bin/           # Binary entry points
│   └── main.rs        # Main Tauri application entry point
├── icons/             # Application icons for different platforms
├── build.rs           # Build script for Tauri compilation
├── Cargo.toml         # Rust dependencies and package metadata
├── Cargo.lock         # Locked dependency versions
└── tauri.conf.json    # Tauri application configuration
```

## Key Components

### Main Application (`src/main.rs`)

The Rust backend provides:

- **Native SQLite Integration** - Direct database access without HTTP layer
- **Tauri Commands** - Rust functions exposed to the JavaScript frontend
- **System Integration** - Native file dialogs, notifications, etc.

### Dependencies

**Core:**
- `tauri` (2.5.1) - Desktop application framework
- `rusqlite` (0.31) - SQLite bindings with bundled SQLite
- `serde` + `serde_json` - Serialization for JS-Rust communication

**Domain:**
- `uuid` (1.10) - UUID generation for entity IDs
- `chrono` (0.4) - Date/time handling
- `semver` (1.0) - Semantic version parsing and validation
- `regex` (1.11) - Regular expression validation

**Error Handling:**
- `thiserror` (1.0) - Ergonomic error type definitions

**Utilities:**
- `once_cell` (1.19) - Lazy static initialization

## Tauri Commands

Tauri commands are Rust functions exposed to the JavaScript frontend via the `#[tauri::command]` attribute.

**Example:**
```rust
#[tauri::command]
fn create_prompt(slug: String, title: String, body: String, version: String) -> Result<Prompt, Error> {
    // Implementation
}
```

Called from JavaScript:
```typescript
import { invoke } from '@tauri-apps/api';

const prompt = await invoke('create_prompt', {
  slug: 'my-prompt',
  title: 'My Prompt',
  body: 'Content',
  version: '1.0.0'
});
```

## Building

### Development Mode

```bash
npm run tauri:dev
```

This starts the Tauri development window with hot-reload for the frontend. Rust code changes require a restart.

### Production Build

```bash
npm run tauri:build
```

Creates platform-specific installers:
- **macOS:** `.dmg` and `.app` bundle
- **Windows:** `.exe` installer and `.msi`
- **Linux:** `.AppImage`, `.deb`, `.rpm`

Output location: `src-tauri/target/release/`

## Configuration

### `tauri.conf.json`

Main Tauri configuration file:

```json
{
  "identifier": "com.nobodyworld.prompt-vault",
  "productName": "Prompt Vault",
  "version": "0.1.0",
  "build": {
    "devPath": "http://localhost:5173",
    "distDir": "../desktop/dist"
  }
}
```

**Key settings:**
- `identifier` - Unique app identifier (reverse domain)
- `productName` - Display name in OS
- `version` - Application version
- `devPath` - Vite dev server URL
- `distDir` - Built frontend assets

### Database Path

The Tauri backend stores the SQLite database in the app's data directory:

- **macOS:** `~/Library/Application Support/com.nobodyworld.prompt-vault/`
- **Windows:** `%APPDATA%/com.nobodyworld.prompt-vault/`
- **Linux:** `~/.local/share/com.nobodyworld.prompt-vault/`

## Development Prerequisites

### Rust Toolchain

Install via [rustup](https://rustup.rs/):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### System Dependencies

**macOS:**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

**Linux (Fedora):**
```bash
sudo dnf install webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  gtk3-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

**Windows:**

Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) with C++ build tools.

## Testing

Rust tests can be added to `src/main.rs` or separate test modules.

```bash
cd src-tauri
cargo test
```

For integration tests with the full Tauri context, use WebDriver:

```bash
# Install Tauri CLI if not already
cargo install tauri-cli

# Run WebDriver tests
cargo tauri test
```

## Architecture Notes

### Why Rust + Tauri?

1. **Performance** - Native SQLite access without serialization overhead
2. **Security** - Sandboxed environment with explicit command whitelist
3. **Cross-Platform** - Single codebase for Windows, macOS, Linux
4. **Small Bundle Size** - ~10MB installer vs ~100MB+ for Electron
5. **Native Feel** - Uses system webview, not bundled Chromium

### Data Flow

```
Frontend (React/TypeScript)
    ↓ (invoke API)
Tauri Command Bridge
    ↓
Rust Backend (main.rs)
    ↓
SQLite Database (rusqlite)
```

### Security Model

Tauri follows a strict security model:

1. **No Node.js in Production** - Build tools only, not in bundle
2. **Explicit API Allowlist** - Only registered commands are callable
3. **CSP Enforcement** - Content Security Policy prevents XSS
4. **Context Isolation** - Frontend can't directly access Rust code

## Troubleshooting

### Build Errors

**Problem:** `error: linking with 'cc' failed`

**Solution:** Install system dependencies listed above.

---

**Problem:** `Could not find Tauri`

**Solution:** Run `npm install` to install `@tauri-apps/cli`.

---

**Problem:** Database locked errors

**Solution:** Ensure only one Tauri instance is running. Check for stale processes.

### Development

**Problem:** Changes not reflected in dev mode

**Solution:** 
- Frontend changes: Should hot-reload automatically
- Rust changes: Stop (`Ctrl+C`) and restart `npm run tauri:dev`

## Related Documentation

- [../desktop/README.md](../desktop/README.md) - Frontend UI implementation
- [../src/README.md](../src/README.md) - Shared domain logic
- [Tauri Documentation](https://tauri.app/v2/)
- [rusqlite Documentation](https://docs.rs/rusqlite/)
- [Cargo Book](https://doc.rust-lang.org/cargo/)
