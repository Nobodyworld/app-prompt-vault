# Step 08 – Verify Build, Run, and Test

## Local Verification Plan

1. Install dependencies: `npm install`.
2. Run type checks: `npm run build`.
3. Execute tests: `npm test`.
4. Lint for stylistic issues: `npm run lint`.

## Current Status

- Automated commands are configured but were not executed in this environment because dependencies were not installed. Running the steps above on a machine with Node.js 24.x LTS (minimum `>=24.0.0`) will validate the codebase end-to-end.
- Coverage output will appear in `coverage/` after successful test execution.

## Next Steps

- Integrate GitHub Actions workflow to run build, lint, and test scripts on every pull request.
