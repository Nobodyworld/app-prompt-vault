import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "tests/**",
      "vitest.config.ts",
      "vitest.ui.config.ts",
      ".eslintrc.cjs",
      "desktop/dist/**",
      // ignore generated and native build artifacts
      "src-tauri/**",
      "src-tauri/target/**",
      // ignore dev tools and scripts that run under Node
      "dev-tools/**",
      "scripts/**",
      "*.cjs",
      "*.js",
      // common ad-hoc tool files
      "insert-and-read.*",
      "inspect-db.*",
      "src/server.ts"
    ]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/explicit-function-return-type": ["error", { "allowExpressions": true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["error", {
        "prefer": "type-imports",
        "fixStyle": "separate-type-imports"
      }]
    }
  },
  {
    files: ["desktop/src/**/*.ts", "desktop/src/**/*.tsx"],
    languageOptions: {
      parser: tsparser,
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
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/explicit-function-return-type": ["error", { "allowExpressions": true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["error", {
        "prefer": "type-imports",
        "fixStyle": "separate-type-imports"
      }]
    }
  },
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.ts", "desktop/vite.config.ts"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/explicit-function-return-type": ["error", { "allowExpressions": true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["error", {
        "prefer": "type-imports",
        "fixStyle": "separate-type-imports"
      }]
    }
  },
  {
    files: ["playwright.config.ts"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/explicit-function-return-type": ["error", { "allowExpressions": true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["error", {
        "prefer": "type-imports",
        "fixStyle": "separate-type-imports"
      }]
    }
  },
]
