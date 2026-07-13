import type { CoverageOptions } from "vitest";

export type CoverageTier = "core" | "app" | "ui" | "experimental";

export interface TierThresholds {
  readonly lines: number;
  readonly statements: number;
  readonly branches: number;
  readonly functions: number;
}

export const COVERAGE_THRESHOLDS: Record<CoverageTier, TierThresholds> = {
  core: { lines: 80, statements: 80, branches: 70, functions: 75 },
  app: { lines: 60, statements: 60, branches: 50, functions: 55 },
  ui: { lines: 40, statements: 40, branches: 30, functions: 35 },
  experimental: { lines: 20, statements: 20, branches: 15, functions: 15 },
};

const PACKAGE_TIERS: Record<string, CoverageTier> = {
  "@nw/app-prompt-vault": "app",
};

export function getCoverageConfig(packageName: string): Partial<CoverageOptions> {
  const tier = PACKAGE_TIERS[packageName] ?? "experimental";
  const thresholds = COVERAGE_THRESHOLDS[tier];

  return {
    provider: "istanbul",
    reporter: ["text", "json", "json-summary", "lcov", "html"],
    reportsDirectory: "./coverage",
    all: true,
    thresholds,
    exclude: [
      "node_modules/",
      "dist/",
      "tests/",
      "src-tauri/",
      "**/*.d.ts",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/mocks/**",
      "**/test-utils/**",
      "coverage/**",
      "playwright-report/**",
    ],
  };
}
