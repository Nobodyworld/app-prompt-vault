import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  const isTauri = !!process.env.TAURI_ENV;

  return {
    plugins: [react()],
    root: rootDir,
    server: {
      port: 1420,
      strictPort: true,
      host: true,
    },
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
    build: {
      target: isTauri ? ["es2021", "chrome113", "safari16"] : "es2021",
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: !!process.env.TAURI_DEBUG,
    },
    resolve: {
      alias: {
        "@": resolve(rootDir, "src"),
      },
    },
  };
});
