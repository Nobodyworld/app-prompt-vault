# Tests (`tests/`)

Automated test suite for Prompt Vault using Vitest.

## Test Structure

```
tests/
├── httpRouter.test.ts              # HTTP API endpoint tests
├── httpTracing.test.ts             # Distributed tracing tests
├── migrations.test.ts              # Database migration tests
├── observability.test.ts           # Observability/telemetry tests
├── promptVaultService.test.ts      # Core service layer tests
├── serverConfig.test.ts            # Configuration validation tests
└── telemetryFileReader.test.ts     # Telemetry file I/O tests
```

## Test Categories

### Service Layer Tests (`promptVaultService.test.ts`)

Tests the core business logic of `PromptVaultService`:

- Prompt creation with validation
- Versioning and version history
- Tag management (add/remove)
- Search and filtering
- Duplicate slug detection
- Error handling and edge cases

**Approach:** Uses in-memory SQLite (`:memory:`) for fast, isolated tests.

### HTTP API Tests (`httpRouter.test.ts`)

Tests the Express REST API endpoints:

- `POST /api/prompts` - Create prompt
- `GET /api/prompts` - List/search prompts
- `GET /api/prompts/:id` - Get single prompt
- `POST /api/prompts/:id/versions` - Add version
- `POST /api/prompts/:id/tags` - Attach tags
- `DELETE /api/prompts/:id/tags` - Remove tags

**Approach:** Uses supertest for HTTP testing without starting a real server.

### Migration Tests (`migrations.test.ts`)

Tests database schema migrations:

- Migration files execute without errors
- Schema is created correctly
- Indexes and constraints are present
- Idempotency (migrations can be re-run)

**Approach:** Uses fresh in-memory database for each test.

### Observability Tests (`observability.test.ts`, `httpTracing.test.ts`)

Tests telemetry, logging, and tracing infrastructure:

- Telemetry span creation and context propagation
- Structured logging output
- HTTP request tracing (`x-trace-id` headers)
- Metrics collection

**Approach:** Mocks and verifies telemetry calls; uses in-memory transports.

### Configuration Tests (`serverConfig.test.ts`)

Tests configuration validation and environment variable parsing:

- Valid configurations accepted
- Invalid configurations rejected with clear errors
- Default values applied correctly
- Environment variable overrides work

**Approach:** Unit tests with mocked environment.

## Running Tests

### Run All Tests

```bash
npm test
```

### Run with Coverage

```bash
npm run test:coverage
```

Coverage reports are generated in `coverage/` directory:
- `coverage/index.html` - Interactive HTML report
- `coverage/lcov.info` - LCOV format for CI tools

### Watch Mode

```bash
npm run test:watch
```

Automatically re-runs tests on file changes.

### Run Specific Test File

```bash
npx vitest run tests/promptVaultService.test.ts
```

### Run Tests Matching Pattern

```bash
npx vitest run -t "should create prompt"
```

## Writing Tests

### Test File Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('MyFeature', () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  it('should do something', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = myFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### Using In-Memory Database

```typescript
import Database from 'better-sqlite3';
import { PromptRepository } from '../src/repositories/PromptRepository.js';

const db = new Database(':memory:');
const repository = new PromptRepository(db);
```

In-memory databases are isolated per-test and don't require cleanup.

### Mocking

Vitest provides built-in mocking:

```typescript
import { vi } from 'vitest';

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
};
```

## Coverage Thresholds

Tests must maintain minimum coverage levels (enforced by CI):

- **Lines & Statements:** ≥ 85%
- **Functions:** ≥ 80%
- **Branches:** ≥ 75%

Configure in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      lines: 85,
      functions: 80,
      branches: 75,
      statements: 85
    }
  }
});
```

## Test Best Practices

### 1. Isolation
- Each test should be independent
- Use fresh database instances (in-memory)
- Clean up resources in `afterEach`

### 2. Readability
- Use descriptive test names: "should [expected behavior] when [condition]"
- Follow Arrange-Act-Assert pattern
- Keep tests focused on one behavior

### 3. Performance
- Use in-memory databases for speed
- Avoid unnecessary async operations
- Parallelize tests when possible (default in Vitest)

### 4. Coverage
- Test happy paths AND error cases
- Test edge cases and boundary conditions
- Don't test implementation details, test behavior

### 5. Maintainability
- Keep tests simple and straightforward
- Extract common setup into helpers
- Update tests when behavior changes

## Continuous Integration

Tests run automatically on every push and pull request via GitHub Actions (`.github/workflows/ci.yml`).

**CI Pipeline:**
1. Install dependencies
2. Run quality gate (includes tests with coverage)
3. Upload coverage to Codecov
4. Fail build if coverage drops below thresholds

## Test Configuration

### `vitest.config.ts`
Main test configuration for backend/service tests:
- Uses Node environment
- Includes coverage with V8 provider
- Configures coverage thresholds

### `vitest.ui.config.ts`
Separate configuration for UI tests:
- Uses jsdom environment for DOM emulation
- Tests React components
- Separate coverage tracking

## Debugging Tests

### Run with Debugging

```bash
node --inspect-brk node_modules/.bin/vitest --run
```

Then attach your debugger (VS Code, Chrome DevTools, etc.)

### Console Output

```bash
# Show console.log output
npx vitest --reporter=verbose

# Show detailed error traces
npx vitest --reporter=verbose --bail
```

## Related Documentation

- [vitest.config.ts](../vitest.config.ts) - Test configuration
- [package.json](../package.json) - Test scripts
- [Vitest Documentation](https://vitest.dev/)
- [Testing Library Documentation](https://testing-library.com/)
