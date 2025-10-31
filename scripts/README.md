# Scripts (`scripts/`)

Automation and utility scripts for building, testing, releasing, and maintaining Prompt Vault.

## Available Scripts

### Database Management

#### `bootstrap-db.ts`
Creates and initializes a SQLite database with all migrations applied.

**Usage:**
```bash
npm run db:bootstrap ./prompt-vault.db
```

**Purpose:** Set up a fresh database for development or testing.

---

### Quality & Coverage

#### `report-coverage.ts`
Analyzes test coverage reports and validates against thresholds.

**Usage:**
```bash
npm run coverage:summary
```

**Thresholds:**
- Lines/Statements: ≥ 85%
- Functions: ≥ 80%
- Branches: ≥ 75%

**Note:** Called automatically by `npm run quality:gate`.

#### `security-scan.ts`
Runs security vulnerability scanning on dependencies and code.

**Usage:**
```bash
npm run security:scan
```

**Features:**
- Checks for known vulnerabilities in npm packages
- Graceful offline handling
- Exit code 0 for warnings, non-zero for errors

**Note:** Part of the quality gate (`npm run quality:gate`).

---

### Observability & Metrics

#### `observability.ts`
Standalone observability server exposing health and metrics endpoints.

**Usage:**
```bash
npm run observability
# or with custom port
PROMPT_VAULT_METRICS_PORT=9999 npm run observability
```

**Endpoints:**
- `GET /healthz` - Liveness probe
- `GET /readyz` - Readiness probe  
- `GET /metrics` - Prometheus metrics

**Environment Variables:**
- `PROMPT_VAULT_METRICS_PORT` - Server port (default: 9464)

#### `metrics-snapshot.ts`
Captures repository metrics (complexity, dependencies, latency samples).

**Usage:**
```bash
npm run metrics:snapshot
```

**Output:** JSON metrics suitable for dashboarding and trend analysis.

---

### Extension Development

#### `scaffold-extension.ts`
Generates boilerplate code for a new plugin.

**Usage:**
```bash
npm run extension:scaffold <plugin-name>

# Example:
npm run extension:scaffold analytics
```

**Creates:**
- `src/extensions/plugins/<name>Plugin.ts` - Plugin implementation
- Basic lifecycle hooks (afterCommit)
- Type-safe plugin template

**See also:** [EXTENSION_GUIDE.md](../EXTENSION_GUIDE.md)

---

### Release Management

#### `release-prepare.ts`
Prepares a new release by updating version numbers and changelogs.

**Usage:**
```bash
npm run release:prepare
```

**Actions:**
- Updates version in package.json
- Generates/updates CHANGELOG.md
- Creates git tag
- Validates release notes

---

### Tauri Desktop

#### `tauri-run.ts`
Wrapper for Tauri CLI commands with error handling and environment setup.

**Usage:**
```bash
npm run tauri:dev    # Run Tauri in development mode
npm run tauri:build  # Build Tauri desktop application
```

**Note:** Requires Rust toolchain and Tauri dependencies installed.

---

### Testing

#### `smoke-test.cjs` & `smoke-test-memory.cjs`
Quick smoke tests for basic functionality.

**Usage:**
```bash
npm run smoke                    # Test with file-based DB
node scripts/smoke-test-memory.cjs  # Test with in-memory DB
```

**Purpose:** Fast sanity checks before commits or deployments.

---

## Script Conventions

### TypeScript Scripts (`*.ts`)
- Executed via `tsx` (TypeScript execute)
- Have access to all TypeScript features and imports
- Use ES modules (`import`/`export`)

### CommonJS Scripts (`*.cjs`)
- Plain JavaScript with CommonJS syntax
- No compilation required
- Used for lightweight, standalone utilities

### Environment Variables

Scripts respect these environment variables:

- `PROMPT_VAULT_DB_PATH` - Database file path (default: `./prompt-vault.db`)
- `PROMPT_VAULT_METRICS` - Enable metrics collection (default: `false`)
- `PROMPT_VAULT_METRICS_PORT` - Metrics server port (default: `9464`)
- `NODE_ENV` - Node environment (`development`, `production`, `test`)

### Running Scripts Directly

All scripts can be run directly via npm scripts (recommended) or via tsx/node:

```bash
# Recommended (via npm)
npm run db:bootstrap ./my-db.db

# Direct execution
npx tsx scripts/bootstrap-db.ts ./my-db.db
```

## Quality Gate

The quality gate (`npm run quality:gate`) runs the following scripts in order:

1. **Lint** - `npm run lint` (ESLint)
2. **Build** - `npm run build` (TypeScript compilation)
3. **Test with Coverage** - `npm run test:coverage` (Vitest with coverage)
4. **Coverage Summary** - `npm run coverage:summary` (Threshold validation)
5. **Security Scan** - `npm run security:scan` (Dependency vulnerabilities)

All steps must pass for the gate to succeed. This is enforced in CI.

## Adding New Scripts

When adding a new script:

1. Place it in this directory (`scripts/`)
2. Use `.ts` for TypeScript, `.cjs` for plain JavaScript
3. Add a corresponding npm script in `package.json`
4. Document it in this README
5. Follow existing patterns for:
   - Error handling
   - Exit codes
   - Environment variables
   - Logging/output format

## Related Documentation

- [package.json](../package.json) - npm script definitions
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) - CI pipeline using these scripts
- [AUTOMATION.md](../AUTOMATION.md) - Automation guidelines and guardrails
