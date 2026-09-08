import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { feedbackLayerPilot } from "./vite.feedback-layer-pilot";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command, isPreview }) => {
  const isTauri = !!process.env.TAURI_ENV;

  return {
    plugins: [
      react(),
      ...(command === "serve" && !isPreview ? [feedbackLayerPilot()] : []),
    ],
    root: rootDir,
    server: {
      port: 1420,
      strictPort: true,
      host: "127.0.0.1",
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
