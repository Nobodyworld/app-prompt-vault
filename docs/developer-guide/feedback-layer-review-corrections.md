# Development pilot review corrections — 2026-09-06

This correction record supersedes the older dependency-only completion instructions and broad privacy/readiness claims in the initial pilot report. Historical runs remain historical, not validation of corrected source.

## Corrective changelog

- Production builds and production preview never construct the optional pilot plugin. Its environment parser and service verification cannot affect those configuration loads. Development startup still validates explicit opt-in.
- The routed workspace is private/redacted by default, including prompt-derived live announcements, errors, and future route content. Semantic IDs and accessibility behavior remain unchanged. Public navigation is outside this boundary. Text-based fallback resolution inside the workspace is intentionally sacrificed in favor of stable semantic IDs and privacy.
- Existing streamed-body deadlines, contract/SDK size ceilings, transport regressions, CI checks, and contributor protections from the preceding correction are preserved.
- The service's corrected SDK must suppress private descendants and private referenced labels when capturing an ancestor. An incomplete element/candidate scan must return `RESOLUTION_SCAN_INCOMPLETE`, not a claimed unique match. Restart the development server after updating that SDK; cached historical bytes are not corrected bytes.

## Validation status

Added Vitest regressions exercise build/preview factory isolation and the rendered Layout privacy boundary, preserving the live announcement's accessibility. These new Vitest cases have not been executed in the connector environment. Full supported-toolchain tests, coverage, actual production build/exclusion, and the coordinated browser pilot remain local gates. No native acceptance or owner approval is claimed.

## Dependency ownership

Generate the `fast-uri` correction on PR #76 first, with Node 24 and pnpm 10.24.0. Upstream September 2 advisories GHSA-58mr-gqgx-xq4g and GHSA-qw65-cvwx-89v3 identify 3.1.7 as patched on the 3.x line; reassess the current audit before selecting the exact compatible version. Commit package.json and the generated lockfile together, without manual integrity edits. Transfer only that reviewed dependency delta into PR #75, preserving pilot scripts. Do not duplicate the CI/docs correction already present here or make securing main depend on this optional pilot.

## Remaining local acceptance

After dependency generation, run frozen install, the full production audit, quality:gate, test:ui, the existing transport/graph regressions, and the new Vitest regressions. Prove actual production output remains clean with pilot variables absent, valid, and malformed. Use only disposable synthetic data for enabled/disabled, container and live-region redaction, bounded service failure, revocation, HMR, restart, and resolution checks. Report genuine 200% zoom with the feedback UI enabled separately from narrow viewport and native browser evidence. Never treat the agent's verification-workflow test as owner acceptance.

Keep PR #75 draft. No merge, release, installer operation, settings change, updater change, or real-data operation is authorized.
