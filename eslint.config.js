import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "tests/**", "vitest.config.ts", "vitest.ui.config.ts", ".eslintrc.cjs", "desktop/dist/**", "src-tauri/**", "src-tauri/target/**", "dev-tools/**", "scripts/**", "*.cjs", "*.js", "insert-and-read.*", "inspect-db.*", "src/server.ts"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": ["error", { "allowExpressions": true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", {
        "prefer": "type-imports",
        "fixStyle": "separate-type-imports"
      }],
      // Guardrail: prefer app-local adapter modules for UI imports of shared packages.
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@nw/*"],
              message: "Prefer routing @nw/* imports through an app-local adapter module (e.g. src/lib/platform-core) for UI code.",
            },
          ],
        },
      ],
    },
  },
  {
    // Adapter modules are the approved location for direct @nw/* imports.
    files: ["src/lib/platform-*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["desktop/src/**/*.ts", "desktop/src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./desktop/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        JSX: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": ["error", { "allowExpressions": true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["error", {
        "prefer": "type-imports",
        "fixStyle": "separate-type-imports"
      }],
      // Guardrail: prefer app-local adapter modules for UI imports of shared packages.
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@nw/*"],
              message: "Prefer routing @nw/* imports through an app-local adapter module (e.g. src/lib/platform-core) for UI code.",
            },
          ],
        },
      ],
    },
  },
  {
    // Desktop adapter modules are the approved location for direct @nw/* imports.
    files: ["desktop/src/lib/platform-*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.ts", "desktop/vite.config.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": ["error", { "allowExpressions": true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["error", {
        "prefer": "type-imports",
        "fixStyle": "separate-type-imports"
      }]
    },
  },
  {
    files: ["playwright.config.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": ["error", { "allowExpressions": true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["error", {
        "prefer": "type-imports",
        "fixStyle": "separate-type-imports"
      }]
    },
  }
);