import type { CoverageOptions } from "vitest";
import { defineConfig } from "vitest/config";

const coverageConfig: CoverageOptions = {
  provider: "v8",
  reporter: ["text", "json", "lcov", "html"],
  include: ["desktop/src/**/*.ts", "desktop/src/**/*.tsx"],
  exclude: ["desktop/src/**/__tests__/**", "desktop/src/**/fixtures/**"],
  thresholds: {
    lines: 70,
    statements: 70,
    functions: 70,
    branches: 60,
  },
};

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["desktop/src/**/*.test.{ts,tsx}", "desktop/src/**/*.spec.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    coverage: coverageConfig,
  },
});
