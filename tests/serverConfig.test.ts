import { describe, expect, it } from "vitest";
import { ConfigurationError, loadServerConfig } from "../src/config/serverConfig.js";

const defaultOptions = {
  defaults: {
    port: 3001,
    databasePath: "/tmp/prompt-vault.db",
    staticDirectory: null,
  },
} as const;

describe("loadServerConfig", () => {
  it("uses defaults when environment variables are absent", () => {
    const { config, warnings } = loadServerConfig({
      env: {},
      ...defaultOptions,
    });

    expect(config.port).toBe(3001);
    expect(config.databasePath.endsWith("prompt-vault.db")).toBe(true);
    expect(config.allowedOrigins).toBeNull();
    expect(config.metrics.enabled).toBe(false);
    expect(config.metrics.port).toBeUndefined();
    expect(config.staticDirectory).toBeUndefined();
    expect(warnings).toHaveLength(0);
  });

  it("parses environment overrides for port, database, and metrics", () => {
    const { config, warnings } = loadServerConfig({
      env: {
        PORT: "4100",
        PROMPT_VAULT_DB_PATH: "./relative.db",
        PROMPT_VAULT_METRICS: "true",
        PROMPT_VAULT_METRICS_PORT: "9464",
      },
      ...defaultOptions,
    });

    expect(config.port).toBe(4100);
    expect(config.databasePath.endsWith("relative.db")).toBe(true);
    expect(config.metrics.enabled).toBe(true);
    expect(config.metrics.port).toBe(9464);
    expect(warnings).toHaveLength(0);
  });

  it("normalises and validates allowed origins", () => {
    const { config, warnings } = loadServerConfig({
      env: {
        PROMPT_VAULT_ALLOWED_ORIGINS: "https://example.com, http://localhost:3000/",
      },
      ...defaultOptions,
    });

    expect(config.allowedOrigins).toEqual(["https://example.com", "http://localhost:3000"]);
    expect(warnings).toHaveLength(0);
  });

  it("emits warnings for duplicate allowed origins", () => {
    const { config, warnings } = loadServerConfig({
      env: {
        PROMPT_VAULT_ALLOWED_ORIGINS: "https://example.com, https://example.com/",
      },
      ...defaultOptions,
    });

    expect(config.allowedOrigins).toEqual(["https://example.com"]);
    expect(warnings).toContain("Duplicate allowed origin detected: https://example.com");
  });

  it("warns when metrics port is set without enabling metrics", () => {
    const { config, warnings } = loadServerConfig({
      env: {
        PROMPT_VAULT_METRICS_PORT: "9000",
      },
      ...defaultOptions,
    });

    expect(config.metrics.enabled).toBe(false);
    expect(config.metrics.port).toBeUndefined();
    expect(warnings).toContain(
      "PROMPT_VAULT_METRICS_PORT is set but PROMPT_VAULT_METRICS is disabled. Metrics will remain disabled."
    );
  });

  it("resolves the static asset directory when provided", () => {
    const { config } = loadServerConfig({
      env: {
        PROMPT_VAULT_STATIC_DIR: "./public",
      },
      ...defaultOptions,
    });

    expect(config.staticDirectory).toBeDefined();
    expect(config.staticDirectory?.endsWith("public")).toBe(true);
  });

  it("throws a configuration error when values are invalid", () => {
    expect(() =>
      loadServerConfig({
        env: {
          PORT: "not-a-number",
          PROMPT_VAULT_METRICS: "maybe",
          PROMPT_VAULT_ALLOWED_ORIGINS: "ftp://example.com",
        },
        ...defaultOptions,
      })
    ).toThrow(ConfigurationError);
  });
});
