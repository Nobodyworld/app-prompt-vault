import { defineConfig } from "vitest/config";
import { getCoverageConfig } from "./vitest.shared";

const coverage = getCoverageConfig("prompt-vault");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Keep concurrent file-backed database fixtures within the existing timeouts.
    maxWorkers: 2,
    exclude: [
      "dist/**",
      "node_modules/**",
      "tests/playwright/**",
      // node:test harness, run by test:regressions and the CI graph gate.
      "scripts/check-windows-glib.test.mjs",
    ],
    coverage: {
      ...coverage,
      include: ["src/**/*.ts"],
      exclude: [
        ...(coverage.exclude ?? []),
        "desktop/**",
        "src-tauri/**",
        "dist/**",
        "node_modules/**",
        "src/cli/**",
        "src/db/migrations/**",
      ],
    },
  },
});
