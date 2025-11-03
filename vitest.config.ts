import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: ( {
      // Use istanbul coverage provider to match the report-coverage script expectations
      provider: 'istanbul',
      // include server / library code only; exclude desktop renderer and generated assets
      reporter: ["text", "json", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["desktop/**", "src-tauri/**", "dist/**", "node_modules/**", "src/cli/**", "src/db/migrations/**"],
      check: {
        lines: 85,
        statements: 85,
        functions: 80,
        branches: 75,
      },
    } as any ),
  },
});
