# E2E Tests (scaffold)

# E2E Tests

This folder contains end-to-end tests using Vitest to validate critical user workflows.

## What it tests

- **Smoke test**: Validates CLI entry file contains expected usage text
- **Critical user journeys**: Full workflow testing including:
  - Create → List → Version → Delete → Restore prompt lifecycle
  - Import/Export functionality with file operations
  - Diagnostics and statistics reporting

## How to run locally

```powershell
# From repository root (Windows PowerShell)
npm run test:e2e
```

## Test Structure

- `cli-smoke.test.ts`: Contains both smoke tests and comprehensive workflow tests
- Tests use temporary databases that are cleaned up automatically
- Tests validate command execution and output structure (not exact data matching due to UUIDs)

## Notes

- Uses `npx tsx` to execute TypeScript CLI entrypoint in-process
- Tests are designed to be resilient to environment differences
- Individual command success may vary based on exact UUID matching, but command structure validation is the key focus
- Expand with more specific workflow tests as needed (authentication, error scenarios, etc.)
