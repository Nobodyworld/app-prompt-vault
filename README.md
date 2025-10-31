# Prompt Vault

[![CI](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/Nobodyworld/app-prompt-vault/branch/main/graph/badge.svg)](https://codecov.io/gh/Nobodyworld/app-prompt-vault)

> A cross-platform application for collecting, versioning, and managing reusable prompts with rich metadata, semantic versioning, and powerful search capabilities.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run tests to verify setup
npm test

# Start development CLI
npm run dev -- --help

# Start desktop app (requires Rust)
npm run tauri:dev

# Start web UI + API server
npm run web:dev
```

**Prerequisites:** Node.js 24.x (recommended) or Node >= 18.17, Rust (for Tauri desktop app)

## 📚 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Project Structure](#project-structure)
- [Installation & Setup](#installation--setup)
- [Usage](#usage)
  - [CLI Commands](#cli-commands)
  - [HTTP API](#http-api)
  - [Desktop App](#desktop-app)
- [Development](#development)
- [Testing](#testing)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Overview

Prompt Vault is a cross-platform application for managing AI prompts with enterprise-grade features:

- **Cross-Platform** – Desktop (Tauri + Rust), Web (Express + React), and CLI
- **Prompt Library** – Rich metadata, semantic versioning, and complete change history
- **Tag System** – Organize prompts by workflow, team, or modality with automatic deduplication
- **SQLite Persistence** – Local-first storage with automatic migrations
- **Observability** – Built-in metrics, structured logging, and distributed tracing
- **Extensibility** – Plugin system for custom behaviors without touching core logic

## Key Features

### Core Functionality
- ✅ **Create & Version Prompts** – Semantic versioning with changelog support
- 🏷️ **Tag Management** – Flexible tagging with search and filtering
- 🔍 **Search & Filter** – Find prompts by title, tags, or content
- 📊 **Version History** – Track all changes to prompts over time

### Technical Features
- 🏗️ **Clean Architecture** – Layered design (domain, service, repository, presentation)
- 🔐 **Type Safety** – Full TypeScript + Zod validation
- 📈 **Observability** – Prometheus metrics, health checks, tracing
- 🧩 **Plugin System** – React to lifecycle events without modifying core logic
- 🧪 **Test Coverage** – 85%+ coverage with Vitest
- 🚦 **CI/CD** – Automated linting, testing, security scanning

## Project Structure

```text
app-prompt-vault/
│
├── src/                     # Core TypeScript implementation
│   ├── cli/                 # Command-line interface (Commander.js)
│   ├── config/              # Configuration validation
│   ├── db/                  # Database connection & migrations
│   ├── domain/              # Models, validation (Zod), errors
│   ├── extensions/          # Plugin system & built-in plugins
│   ├── observability/       # Telemetry, logging, tracing, metrics
│   ├── repositories/        # Data access layer (SQLite)
│   ├── services/            # Business logic (PromptVaultService)
│   ├── types/               # TypeScript type definitions
│   ├── web/                 # HTTP API routers (Express)
│   └── README.md            # ↗️ Detailed src/ documentation
│
├── desktop/                 # React UI (Vite + React 19)
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Route-level page components
│   │   ├── services/        # API client abstraction
│   │   └── lib/             # Utilities (Tauri detection, clipboard)
│   ├── vite.config.ts       # Vite configuration
│   └── README.md            # ↗️ Detailed desktop/ documentation
│
├── src-tauri/               # Tauri Rust backend for desktop
│   ├── src/                 # Rust source code
│   ├── Cargo.toml           # Rust dependencies
│   └── README.md            # ↗️ Detailed Tauri documentation
│
├── scripts/                 # Build, test, release automation
│   ├── bootstrap-db.ts      # Database initialization
│   ├── metrics-snapshot.ts  # Capture repo metrics
│   ├── observability.ts     # Standalone metrics server
│   ├── security-scan.ts     # Vulnerability scanning
│   ├── scaffold-extension.ts # Plugin generator
│   └── README.md            # ↗️ Detailed scripts documentation
│
├── tests/                   # Automated test suite (Vitest)
│   ├── promptVaultService.test.ts
│   ├── httpRouter.test.ts
│   ├── migrations.test.ts
│   └── README.md            # ↗️ Detailed testing documentation
│
├── dev-tools/               # Optional development utilities
│   ├── capture-console.cjs  # Tauri renderer debugging
│   ├── insert-and-read.cjs  # SQLite smoke test
│   └── README.md            # ↗️ Dev tools documentation
│
├── docs/                    # Architecture & workflow guides
│   ├── architecture.md      # Component relationships
│   ├── workflows.md         # Developer workflows
│   ├── DEPENDENCIES.md      # Dependency inventory
│   ├── incident-response.md # Recovery procedures
│   └── performance-notes.md # Performance guidance
│
├── .github/
│   ├── workflows/           # CI/CD pipelines
│   ├── CODEOWNERS           # Code ownership
│   └── copilot-instructions.md  # AI assistant guidelines
│
├── package.json             # Dependencies & npm scripts
├── tsconfig.json            # TypeScript compiler config
├── vitest.config.ts         # Test configuration
├── eslint.config.js         # Linting rules
├── LICENSE                  # License terms
├── CHANGELOG.md             # Version history
├── CONTRIBUTING.md          # Contribution guidelines
├── SECURITY.md              # Security policies
├── ARCHITECTURE_OVERVIEW.md # High-level architecture
├── EXTENSION_GUIDE.md       # Plugin development guide
└── README.md                # ← You are here
```

**📖 Each major directory has its own README with detailed documentation.**

## Installation & Setup

### Prerequisites

- **Node.js:** v24.x (recommended) or >= 18.17
- **npm:** v10+ (comes with Node.js)
- **Rust:** Latest stable (required only for Tauri desktop app)
  - Install via [rustup](https://rustup.rs/): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### Install Dependencies

```bash
# Clone the repository
git clone https://github.com/Nobodyworld/app-prompt-vault.git
cd app-prompt-vault

# Install Node dependencies
npm install

# Verify installation
npm test
```

### Initialize Database

```bash
# Create and migrate a new SQLite database
npm run db:bootstrap ./prompt-vault.db
```

This creates `prompt-vault.db` with all migrations applied.


## Usage

### CLI Commands

The CLI provides command-line access to all Prompt Vault features:

```bash
# Create a new prompt
npm run dev -- create \
  --slug blog-outline \
  --title "Blog Outline Generator" \
  --body "You are an expert copywriter..." \
  --version 1.0.0 \
  --tags marketing,writing

# List all prompts
npm run dev -- list

# List prompts with specific tags
npm run dev -- list --tags marketing

# Add a new version to an existing prompt
npm run dev -- version \
  --id <prompt-id> \
  --body "Improved prompt text" \
  --version 1.1.0

# Remove tags from a prompt
npm run dev -- untag --id <prompt-id> --tags marketing

# Run health checks and database integrity audit
npm run dev -- doctor
```

**Enable Metrics:**
```bash
PROMPT_VAULT_METRICS=true npm run dev -- list
# Metrics available at http://localhost:9464/metrics
```

See the [CLI documentation](src/README.md#cli) for all available commands and options.

### HTTP API

Start the combined web UI and HTTP API server:

```bash
npm run web:dev
# API available at http://localhost:3001/api
# UI available at http://localhost:3001
```

#### Available Endpoints

**Prompts**
- `GET /api/prompts` - List/search prompts
  - Query params: `text`, `tags`, `page`, `pageSize`
- `POST /api/prompts` - Create a new prompt
- `GET /api/prompts/:id` - Get single prompt details
- `POST /api/prompts/:id/versions` - Add a new version
- `POST /api/prompts/:id/tags` - Attach tags
- `DELETE /api/prompts/:id/tags` - Remove tags

**Observability**
- `GET /observability/healthz` - Liveness check
- `GET /observability/readyz` - Readiness check
- `GET /observability/metrics` - Prometheus metrics

#### Environment Variables

```bash
PORT=3001                              # HTTP server port
PROMPT_VAULT_DB_PATH=./prompt-vault.db # Database file path
PROMPT_VAULT_METRICS=true              # Enable metrics/tracing
PROMPT_VAULT_METRICS_PORT=9464         # Metrics server port
PROMPT_VAULT_ALLOWED_ORIGINS=*         # CORS allowed origins
```

**Example API Call:**
```bash
curl -X POST http://localhost:3001/api/prompts \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "test-prompt",
    "title": "Test Prompt",
    "body": "This is a test prompt",
    "semanticVersion": "1.0.0",
    "tags": ["test"]
  }'
```

### Desktop App

Build and run the native desktop application:

```bash
# Development mode (hot reload)
npm run tauri:dev

# Build for production
npm run tauri:build
```

The desktop app uses the Tauri framework for native performance with a small bundle size (~10MB).

**Features:**
- Native SQLite database (no HTTP server required)
- Cross-platform (Windows, macOS, Linux)
- System tray integration
- Native file dialogs
- Clipboard integration

See [desktop/README.md](desktop/README.md) and [src-tauri/README.md](src-tauri/README.md) for details.

## Development

### Available Scripts

```bash
# Code quality
npm run lint              # Run ESLint
npm run build             # Compile TypeScript to dist/
npm run quality:gate      # Run full quality gate (lint + build + test + coverage + security)

# Testing
npm test                  # Run all tests once
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Run tests with coverage report
npm run coverage:summary  # Validate coverage thresholds

# Security
npm run security:scan     # Scan for vulnerabilities

# Metrics & Observability
npm run observability     # Start standalone metrics server
npm run metrics:snapshot  # Capture repository metrics

# Database
npm run db:bootstrap      # Initialize a new database with migrations

# Extension Development
npm run extension:scaffold <name>  # Generate plugin boilerplate

# Desktop Development
npm run desktop:dev       # Start Vite dev server for UI
npm run desktop:build     # Build UI for production

# Web Development
npm run web:dev           # Start Express server + UI
npm run web:build         # Build and serve production bundle

# Tauri Development
npm run tauri:dev         # Run Tauri in development mode
npm run tauri:build       # Build native desktop app

# Release
npm run release:prepare   # Prepare a new release
```

See [scripts/README.md](scripts/README.md) for detailed script documentation.

### Development Workflow

1. **Make Changes**
   ```bash
   # Edit source files in src/
   npm run lint     # Check for issues
   npm test         # Verify tests pass
   ```

2. **Run Quality Gate**
   ```bash
   npm run quality:gate
   ```
   This runs: lint → build → test with coverage → security scan

3. **Test Locally**
   ```bash
   # Test CLI
   npm run dev -- list
   
   # Test API server
   npm run web:dev
   
   # Test desktop app
   npm run tauri:dev
   ```

4. **Commit Changes**
   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add new feature
   fix: resolve bug
   docs: update documentation
   chore: maintenance tasks
   test: add or update tests
   ```

### Code Style

- **TypeScript:** Strict mode enabled
- **Linting:** ESLint with TypeScript plugin
- **Formatting:** Enforced via .editorconfig
- **Naming:**
  - `PascalCase` for classes, types, interfaces
  - `camelCase` for variables, functions
  - `kebab-case` for file names
  - `snake_case` for database columns

### Architecture Guidelines

1. **Layered Architecture**
   - Domain layer is pure logic (no I/O)
   - Service layer orchestrates domain + repository
   - Repository layer handles persistence
   - Presentation layer (CLI/HTTP/UI) uses service

2. **Dependency Direction**
   - Presentation → Service → Repository → Domain
   - Never reverse (no circular dependencies)

3. **Error Handling**
   - Use typed errors from `domain/errors.ts`
   - Repository maps DB errors to domain errors
   - Service validates and propagates errors
   - Presentation formats errors for users

4. **Observability**
   - Wrap operations in telemetry spans
   - Log structured data with context
   - Emit metrics for key operations
   - Include trace IDs in errors

See [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md) for detailed architecture documentation.

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode for TDD
npm run test:watch

# Run specific test file
npx vitest run tests/promptVaultService.test.ts

# Run tests matching pattern
npx vitest run -t "should create prompt"
```

### Coverage Requirements

Tests must maintain these minimums (enforced in CI):

- **Lines & Statements:** ≥ 85%
- **Functions:** ≥ 80%
- **Branches:** ≥ 75%

### Writing Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { PromptRepository } from '../src/repositories/PromptRepository.js';

describe('PromptRepository', () => {
  let db: Database.Database;
  let repository: PromptRepository;

  beforeEach(() => {
    db = new Database(':memory:'); // Fresh in-memory DB per test
    repository = new PromptRepository(db);
  });

  it('should create a prompt', () => {
    const prompt = repository.createPrompt({
      slug: 'test',
      title: 'Test',
      body: 'Content',
      semanticVersion: '1.0.0'
    });
    
    expect(prompt.slug).toBe('test');
    expect(prompt.title).toBe('Test');
  });
});
```

See [tests/README.md](tests/README.md) for comprehensive testing documentation.

## Documentation

### Core Documentation

- **[README.md](README.md)** - This file (overview, quickstart)
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and release notes
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines
- **[LICENSE](LICENSE)** - License terms (Proprietary)
- **[SECURITY.md](SECURITY.md)** - Security policies and reporting

### Architecture & Design

- **[ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md)** - High-level system architecture
- **[EXTENSION_GUIDE.md](EXTENSION_GUIDE.md)** - Plugin development guide
- **[docs/architecture.md](docs/architecture.md)** - Detailed component relationships
- **[docs/workflows.md](docs/workflows.md)** - Developer workflows and recipes

### Module-Specific

- **[src/README.md](src/README.md)** - Core source code organization
- **[desktop/README.md](desktop/README.md)** - React UI documentation
- **[src-tauri/README.md](src-tauri/README.md)** - Tauri/Rust backend
- **[scripts/README.md](scripts/README.md)** - Automation scripts
- **[tests/README.md](tests/README.md)** - Testing approach and guidelines
- **[dev-tools/README.md](dev-tools/README.md)** - Development utilities

### Operations & Maintenance

- **[docs/incident-response.md](docs/incident-response.md)** - Recovery procedures
- **[docs/performance-notes.md](docs/performance-notes.md)** - Performance tuning
- **[docs/DEPENDENCIES.md](docs/DEPENDENCIES.md)** - Dependency inventory
- **[AUTOMATION.md](AUTOMATION.md)** - Automation guidelines for agents

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests.

### Quickstart for Contributors

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run quality gate: `npm run quality:gate`
5. Commit with conventional commits: `git commit -m "feat: add my feature"`
6. Push and create a pull request

### Code of Conduct

- Be respectful and constructive
- Follow existing code style and conventions
- Write tests for new features
- Update documentation for user-facing changes
- Keep pull requests focused and atomic

## Roadmap

### Planned Features

1. **Enhanced UI** - Search, bulk operations, advanced filtering
2. **Sync & Export** - Share prompt collections across devices
3. **Automated Releases** - Package desktop apps, publish changelogs
4. **Bulk Edit Workflows** - Multi-select and batch operations
5. **Remote Sync Plugin** - Collaborative prompt libraries
6. **Import/Export** - JSON, Markdown, CSV formats
7. **Template System** - Prompt templates with variables

### Future Considerations

- PostgreSQL adapter for multi-tenant deployments
- AI-assisted tagging and categorization
- Prompt testing and evaluation framework
- Integration with popular AI platforms

See [TASKSLIST.md](TASKSLIST.md) for current task tracking.

## CI/CD

Continuous integration runs on every push and pull request:

- ✅ Linting (ESLint)
- ✅ Type checking (TypeScript)
- ✅ Unit tests with coverage (Vitest)
- ✅ Security scanning (npm audit)
- ✅ Coverage reporting (Codecov)

**CI Configuration:** [.github/workflows/ci.yml](.github/workflows/ci.yml)

### Codecov Setup

To enable authenticated uploads to Codecov:

1. Go to repository Settings → Secrets → Actions
2. Add secret `CODECOV_TOKEN` with your Codecov project token
3. CI will automatically upload coverage reports

Without the token, coverage uploads are skipped (useful for forks).

## License

This project is licensed under a **Proprietary License** - see [LICENSE](LICENSE) for details.

All rights reserved. Unauthorized copying, distribution, or modification is strictly prohibited.

## Support

- **Issues:** [GitHub Issues](https://github.com/Nobodyworld/app-prompt-vault/issues)
- **Discussions:** [GitHub Discussions](https://github.com/Nobodyworld/app-prompt-vault/discussions)
- **Security:** See [SECURITY.md](SECURITY.md) for vulnerability reporting

---

**Built with ❤️ by Nobodyworld**
