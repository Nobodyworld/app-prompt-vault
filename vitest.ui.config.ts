import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["desktop/src/**/*.test.{ts,tsx}", "desktop/src/**/*.spec.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    coverage: ( {
      provider: 'v8',
      reporter: ["text", "json", "lcov", "html"],
      // measure only desktop renderer sources
      include: ["desktop/src/**/*.ts", "desktop/src/**/*.tsx"],
      exclude: ["desktop/src/**/__tests__/**", "desktop/src/**/fixtures/**"],
      // slightly lower thresholds for UI
      check: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 60,
      },
    } as any ),
  },
});
