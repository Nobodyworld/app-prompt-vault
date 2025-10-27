import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    coverage: ( {
      // Use V8 coverage provider for accurate coverage in Node (faster and more reliable)
      provider: 'v8',
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli/**", "src/db/migrations/**"],
      check: {
        lines: 85,
        statements: 85,
        functions: 80,
        branches: 75,
      },
    } as any ),
  },
});
