import { defineConfig } from "vitest/config";
import { getCoverageConfig } from "../../vitest.shared";

const coverage = getCoverageConfig("@nw/app-prompt-vault");

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["dist/**", "node_modules/**", "tests/playwright/**"],
    coverage: {
      ...coverage,
      include: ["src/**/*.ts"],
      exclude: [
        ...(coverage?.exclude ?? []),
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
