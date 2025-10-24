# Step 06 – Optimize & Modernize

## Improvements

- Targeted modern Node.js runtime (`>=18.17`) to leverage native ESM, fetch, and crypto utilities without polyfills.
- Adopted `better-sqlite3` for synchronous, zero-copy database access reducing overhead compared to wrapper libraries.
- Simplified CLI command execution using `tsx`, offering fast startup and ESM compatibility.
- Ensured TypeScript compiler emits ES2022 modules for compatibility with modern bundlers and the upcoming Tauri frontend.

## Future Optimization Ideas

- Profile repository queries with sample datasets to identify indexing opportunities.
- Introduce caching for frequent search queries.
- Replace synchronous DB calls with worker threads if the UI requires non-blocking behaviour.
