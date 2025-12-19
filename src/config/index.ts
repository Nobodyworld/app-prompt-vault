import { loadServerConfig, type ServerConfig } from "./serverConfig.js";

export type PromptVaultConfig = {
  appId: "prompt-vault";
  logLevel: "debug" | "info" | "warn" | "error";
  server: ServerConfig;
};

function normaliseLogLevel(value: unknown): PromptVaultConfig["logLevel"] {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

export function getPromptVaultConfig(
  overrides: Partial<PromptVaultConfig> = {},
): PromptVaultConfig {
  const metaEnv =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: Record<string, unknown> }).env
      : undefined;
  const nodeEnv =
    typeof process !== "undefined"
      ? (process.env as Record<string, unknown>)
      : undefined;
  const env = { ...(nodeEnv ?? {}), ...(metaEnv ?? {}) };

  return {
    appId: "prompt-vault",
    logLevel: normaliseLogLevel(
      env.PROMPT_VAULT_LOG_LEVEL ?? env.LOG_LEVEL,
    ),
    server: loadServerConfig().config,
    ...overrides,
  };
}
