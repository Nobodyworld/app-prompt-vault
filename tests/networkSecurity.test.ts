import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_UI_ORIGINS,
  NetworkSecurityConfigurationError,
  configureLoopbackOnlyEnvironment,
  rewriteListenArguments,
} from "../src/config/networkSecurity.js";

describe("loopback network security", () => {
  it("applies loopback and explicit local-origin defaults", () => {
    const env: Record<string, string | undefined> = {};

    const config = configureLoopbackOnlyEnvironment(env);

    expect(config.host).toBe("127.0.0.1");
    expect(config.localhostOnly).toBe(true);
    expect(config.allowedOrigins).toEqual(DEFAULT_LOCAL_UI_ORIGINS);
    expect(env.PROMPT_VAULT_HOST).toBe("127.0.0.1");
    expect(env.LOCALHOST_ONLY).toBe("true");
    expect(env.PROMPT_VAULT_ALLOWED_ORIGINS).toBe(
      DEFAULT_LOCAL_UI_ORIGINS.join(","),
    );
  });

  it("preserves an explicit origin allow-list", () => {
    const env: Record<string, string | undefined> = {
      PROMPT_VAULT_ALLOWED_ORIGINS:
        "http://127.0.0.1:4100, http://localhost:4100",
    };

    const config = configureLoopbackOnlyEnvironment(env);

    expect(config.allowedOrigins).toEqual([
      "http://127.0.0.1:4100",
      "http://localhost:4100",
    ]);
  });

  it("rejects non-loopback host requests", () => {
    const env: Record<string, string | undefined> = {
      PROMPT_VAULT_HOST: "0.0.0.0",
    };

    expect(() => configureLoopbackOnlyEnvironment(env)).toThrow(
      NetworkSecurityConfigurationError,
    );
  });

  it("inserts loopback into a port-and-callback listen call", () => {
    const callback = () => undefined;

    expect(rewriteListenArguments([3001, callback])).toEqual([
      3001,
      "127.0.0.1",
      callback,
    ]);
  });

  it("replaces an explicit wildcard listen host", () => {
    const callback = () => undefined;

    expect(rewriteListenArguments([3001, "0.0.0.0", callback])).toEqual([
      3001,
      "127.0.0.1",
      callback,
    ]);
  });

  it("overrides the host in listen options", () => {
    expect(
      rewriteListenArguments([{ port: 0, host: "0.0.0.0", exclusive: true }]),
    ).toEqual([{ port: 0, host: "127.0.0.1", exclusive: true }]);
  });

  it("leaves named-pipe listen calls unchanged", () => {
    expect(rewriteListenArguments(["prompt-vault.sock"])).toEqual([
      "prompt-vault.sock",
    ]);
  });
});
