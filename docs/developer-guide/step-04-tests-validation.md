# Step 04 – Expand Tests & Validation

## What Changed

- Introduced Vitest-based test suite covering prompt creation, validation failures, missing prompt lookups, versioning, and searc
h operations.
- Implemented Zod schemas to validate prompt payloads and search queries before they reach the repository layer.
- Added custom domain errors (`ValidationError`, `PromptNotFoundError`, `DuplicatePromptError`) to standardize error handling.

## Results

- Business rules are enforced both via static typing and runtime validation.
- The new tests provide regression coverage for the core service layer, enabling safe iteration.
- Error messages surface actionable information to CLI and future UI consumers.
