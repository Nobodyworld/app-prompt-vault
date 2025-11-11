# Step 02 – Clean & Organize

## Actions Completed

- Bootstrapped a modern TypeScript workspace with `package.json`, TypeScript compiler configuration, ESLint rules, and Vitest test
ing scaffold.
- Established a clear source tree structure (`src/domain`, `src/repositories`, `src/services`, `src/cli`, and `src/db`) to separa
te concerns between domain models, persistence, orchestration, and user interface.
- Added SQLite migration scripts to keep the database schema versioned within the repository.
- Added CLI entry point to exercise domain flows without relying on the yet-to-be-built React UI.
- Created testing directory to keep automated tests organized and close to production code.

## Rationale

The repository now reflects an opinionated layout aligned with the app.yaml intent (React/Tauri/SQLite) while focusing initial im
plementation on the core domain logic. This structure enables future contributors to add UI layers without disturbing the domain
foundation, and it allows automated tests to validate business rules without invoking a GUI.

## Follow-Up Ideas

- Introduce a Rust Tauri scaffold once the domain layer stabilizes.
- Split migrations into numbered scripts with a lightweight migration runner.
- Mirror the CLI commands in a React UI for parity.
