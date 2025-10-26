# Future-Proofing Notes

## Scalability Hotspots

- **SQLite concurrency.** For heavier multi-user workloads, migrate to PostgreSQL by reimplementing `PromptRepository` via the same interface and swapping the database adapter. Keep plugin contracts stable to avoid cascading changes.
- **Desktop sync.** Current architecture assumes local-only storage. Consider introducing a sync plugin that replicates prompt versions to a remote API, using the plugin system described in `EXTENSION_GUIDE.md`.

## Containerisation Path

- Wrap the CLI/service in a small Node.js container with the observability server enabled by default. Mount the SQLite file as a volume and expose port `9464` for metrics.
- Provide a Helm chart with liveness/readiness probes pointed at `/healthz` and `/readyz` once the service becomes long-lived.

## Multi-Tenant Roadmap

1. Abstract database schema with tenant IDs on prompts, tags, and versions.
2. Extend validation schemas to require tenant context.
3. Update plugins to include tenant metadata in events/logs.

## Automation Opportunities

- **Prompt linting.** Build a plugin that enforces content rules (length, banned words) before persisting.
- **AI-assisted tagging.** Use the plugin host to integrate with an embedding service that suggests tags.
- **Release bots.** Hook into the `npm run release:prepare` script to auto-generate pull requests with version bumps and changelog stubs.

## Migration Strategy

- Store migration scripts under `src/db/migrations/` with monotonic numbering. Use the existing migration loader to keep boot time deterministic.
- For major schema changes, add compatibility adapters in the repository to backfill data before enabling new features.

Keep this document updated alongside strategic planning discussions.
