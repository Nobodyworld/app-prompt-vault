import { createHash } from "node:crypto";
import vm from "node:vm";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { describe, expect, it, vi } from "vitest";
import {
  FEEDBACK_LAYER_CONTRACT_ROUTE,
  FEEDBACK_LAYER_EXPECTED_ORIGIN,
  FEEDBACK_LAYER_PROTOCOL,
  FEEDBACK_LAYER_SDK_ROUTE,
  FeedbackLayerPilotConfigurationError,
  FeedbackLayerServiceUnavailable,
  PILOT_LOADER_ROUTE,
  PILOT_SDK_ROUTE,
  createPilotLoaderSource,
  feedbackLayerPilot,
  fetchVerifiedFeedbackLayerSdk,
  parseFeedbackLayerPilotConfig,
  type FeedbackLayerPilotConfig,
} from "../desktop/vite.feedback-layer-pilot";

const projectId = `project_${"a".repeat(32)}`;
const sdkBytes = Buffer.from(
  "window.FeedbackLayer = Object.freeze({ contract: Object.freeze({ protocol: " +
    JSON.stringify(FEEDBACK_LAYER_PROTOCOL) +
    " }), install: async () => ({ destroy() {} }), completeResolutionChallenge: async () => ({}) });\n",
  "utf8",
);

function validEnvironment(): Record<string, string> {
  return {
    FEEDBACK_LAYER_PILOT_ENABLED: "true",
    FEEDBACK_LAYER_SERVICE_URL: "http://127.0.0.1:3178",
    FEEDBACK_LAYER_PROJECT_ID: projectId,
    FEEDBACK_LAYER_EXPECTED_ORIGIN,
    FEEDBACK_LAYER_CONTRACT: FEEDBACK_LAYER_PROTOCOL,
  };
}

function validConfig(): FeedbackLayerPilotConfig {
  const config = parseFeedbackLayerPilotConfig(validEnvironment());
  if (!config) throw new Error("expected enabled configuration");
  return config;
}

function contract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: FEEDBACK_LAYER_PROTOCOL,
    protocolVersion: 1,
    application: { name: "Feedback Layer", version: "0.3.0" },
    sdk: {
      route: FEEDBACK_LAYER_SDK_ROUTE,
      global: "FeedbackLayer",
      byteLength: sdkBytes.length,
      sha256: createHash("sha256").update(sdkBytes).digest("hex"),
    },
    methods: {
      install: "install",
      completeResolutionChallenge: "completeResolutionChallenge",
    },
    requirements: {
      developmentOnly: true,
      loopbackService: true,
      exactOrigin: true,
      activeProject: true,
      minimumConsumerProtocol: 1,
    },
    attributes: {
      semanticId: "data-feedback-id",
      applicationAnchor: "data-feedback-anchor",
      private: "data-feedback-private",
      redact: "data-feedback-redact",
    },
    limits: {
      attachmentBytes: 5_242_880,
      resolutionCandidates: 200,
      resolutionScanElements: 2_000,
    },
    ...overrides,
  };
}

function response(
  body: BodyInit,
  contentType: string,
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function serviceFetch(
  contractValue: Record<string, unknown> = contract(),
  bytes: Buffer = sdkBytes,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith(FEEDBACK_LAYER_CONTRACT_ROUTE)) {
      return response(
        JSON.stringify(contractValue),
        "application/json; charset=utf-8",
      );
    }
    if (url.endsWith(FEEDBACK_LAYER_SDK_ROUTE)) {
      return response(bytes, "text/javascript; charset=utf-8");
    }
    throw new Error("unexpected route");
  }) as typeof fetch;
}

function resolvedConfig(): ResolvedConfig {
  return {
    server: {
      host: "127.0.0.1",
      port: 1420,
      strictPort: true,
    },
  } as ResolvedConfig;
}

async function callConfigResolved(plugin: Plugin): Promise<void> {
  const hook = plugin.configResolved;
  if (typeof hook !== "function") throw new Error("missing configResolved hook");
  await hook(resolvedConfig());
}

describe("Feedback Layer pilot configuration", () => {
  it("is disabled by default and performs no service request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const plugin = feedbackLayerPilot({}, { fetchImpl });
    await callConfigResolved(plugin);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(plugin.apply).toBe("serve");

    const transform = plugin.transformIndexHtml;
    if (typeof transform !== "function") {
      throw new Error("missing transformIndexHtml hook");
    }
    expect(await transform("<html></html>", {} as never)).toBe("<html></html>");
  });

  it("accepts only the exact enabled server-only contract", () => {
    expect(parseFeedbackLayerPilotConfig(validEnvironment())).toEqual({
      serviceUrl: "http://127.0.0.1:3178",
      projectId,
      expectedOrigin: FEEDBACK_LAYER_EXPECTED_ORIGIN,
      contract: FEEDBACK_LAYER_PROTOCOL,
    });
    expect(
      parseFeedbackLayerPilotConfig({
        FEEDBACK_LAYER_PILOT_ENABLED: "false",
        FEEDBACK_LAYER_SERVICE_URL: "https://remote.example",
      }),
    ).toBeNull();
  });

  it.each([
    ["non-explicit enable", { FEEDBACK_LAYER_PILOT_ENABLED: "yes" }],
    ["missing service URL", { FEEDBACK_LAYER_SERVICE_URL: undefined }],
    ["malformed service URL", { FEEDBACK_LAYER_SERVICE_URL: "not a url" }],
    ["non-loopback service URL", { FEEDBACK_LAYER_SERVICE_URL: "http://example.com:3178" }],
    ["non-HTTP service URL", { FEEDBACK_LAYER_SERVICE_URL: "https://127.0.0.1:3178" }],
    ["non-origin service URL", { FEEDBACK_LAYER_SERVICE_URL: "http://127.0.0.1:3178/api" }],
    ["wrong expected origin", { FEEDBACK_LAYER_EXPECTED_ORIGIN: "http://localhost:1420" }],
    ["missing project ID", { FEEDBACK_LAYER_PROJECT_ID: undefined }],
    ["malformed project ID", { FEEDBACK_LAYER_PROJECT_ID: "project_prompt-vault" }],
    ["protocol mismatch", { FEEDBACK_LAYER_CONTRACT: "feedback-layer.development-integration@2" }],
  ])("rejects %s", (_label, replacement) => {
    expect(() =>
      parseFeedbackLayerPilotConfig({
        ...validEnvironment(),
        ...replacement,
      }),
    ).toThrow(FeedbackLayerPilotConfigurationError);
  });
});

describe("Feedback Layer contract and SDK verification", () => {
  it("accepts exact versioned bytes and headers", async () => {
    const fetchImpl = serviceFetch();
    const verified = await fetchVerifiedFeedbackLayerSdk(validConfig(), {
      fetchImpl,
    });
    expect(verified.bytes).toEqual(sdkBytes);
    expect(verified.byteLength).toBe(sdkBytes.length);
    expect(verified.sha256).toBe(
      createHash("sha256").update(sdkBytes).digest("hex"),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3178" + FEEDBACK_LAYER_CONTRACT_ROUTE,
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
  });

  it("rejects protocol and SDK checksum mismatches", async () => {
    await expect(
      fetchVerifiedFeedbackLayerSdk(validConfig(), {
        fetchImpl: serviceFetch(
          contract({
            protocol: "feedback-layer.development-integration@2",
          }),
        ),
      }),
    ).rejects.toThrow(/protocol identity/);

    const badContract = contract();
    badContract.sdk = {
      ...(badContract.sdk as Record<string, unknown>),
      sha256: "0".repeat(64),
    };
    await expect(
      fetchVerifiedFeedbackLayerSdk(validConfig(), {
        fetchImpl: serviceFetch(badContract),
      }),
    ).rejects.toThrow(/byte length or SHA-256/);
  });

  it("distinguishes temporary unavailability from invalid configuration", async () => {
    await expect(
      fetchVerifiedFeedbackLayerSdk(validConfig(), {
        fetchImpl: vi.fn(async () => {
          throw new Error("private network detail");
        }) as typeof fetch,
        timeoutMs: 25,
      }),
    ).rejects.toBeInstanceOf(FeedbackLayerServiceUnavailable);

    const unavailablePlugin = feedbackLayerPilot(validEnvironment(), {
      fetchImpl: vi.fn(async () => {
        throw new Error("private network detail");
      }) as typeof fetch,
    });
    await expect(callConfigResolved(unavailablePlugin)).resolves.toBeUndefined();

    const invalidPlugin = feedbackLayerPilot(validEnvironment(), {
      fetchImpl: serviceFetch(
        contract({ protocol: "feedback-layer.development-integration@2" }),
      ),
    });
    await expect(callConfigResolved(invalidPlugin)).rejects.toThrow(
      FeedbackLayerPilotConfigurationError,
    );
  });

  it("serves only verified same-origin SDK bytes through bounded dev routes", async () => {
    const plugin = feedbackLayerPilot(validEnvironment(), {
      fetchImpl: serviceFetch(),
    });
    await callConfigResolved(plugin);

    let middleware:
      | ((
          request: { url?: string },
          response: {
            writeHead(status: number, headers: Record<string, string>): void;
            end(body: Buffer): void;
          },
          next: () => void,
        ) => Promise<void>)
      | undefined;
    const fakeServer = {
      middlewares: {
        use(callback: typeof middleware) {
          middleware = callback;
        },
      },
    } as unknown as ViteDevServer;
    const configure = plugin.configureServer;
    if (typeof configure !== "function") {
      throw new Error("missing configureServer hook");
    }
    configure(fakeServer);
    if (!middleware) throw new Error("middleware was not registered");

    const writes: Array<{
      status: number;
      headers: Record<string, string>;
      body: Buffer;
    }> = [];
    await middleware(
      { url: PILOT_SDK_ROUTE + "?attempt=0" },
      {
        writeHead(status, headers) {
          writes.push({ status, headers, body: Buffer.alloc(0) });
        },
        end(body) {
          writes[writes.length - 1]!.body = body;
        },
      },
      () => {
        throw new Error("verified route unexpectedly fell through");
      },
    );
    expect(writes[0]).toMatchObject({
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
      body: sdkBytes,
    });
  });
});

describe("Feedback Layer development loader", () => {
  it("injects only for an enabled serve plugin and carries bounded evidence", async () => {
    const plugin = feedbackLayerPilot(validEnvironment(), {
      fetchImpl: serviceFetch(),
    });
    expect(plugin.apply).toBe("serve");
    const transform = plugin.transformIndexHtml;
    if (typeof transform !== "function") {
      throw new Error("missing transformIndexHtml hook");
    }
    const transformed = await transform("<html></html>", {} as never);
    expect(transformed).toMatchObject({
      html: "<html></html>",
      tags: [
        {
          tag: "script",
          attrs: { type: "module", src: PILOT_LOADER_ROUTE },
          injectTo: "body",
        },
      ],
    });

    const source = createPilotLoaderSource(validConfig());
    expect(source).toContain("Prompt Vault development pilot");
    expect(source).toContain("consumerIdentity: CONFIG.consumerIdentity");
    expect(source).not.toContain("prompt body");
    expect(source).not.toContain("databasePath");
    expect(source).not.toContain("commitSha");
    expect(source).not.toContain("branch:");
  });

  it("tears down the previous singleton and HMR instance", async () => {
    const source = createPilotLoaderSource(validConfig())
      .replace(
        /await import\([^;]+\);/,
        "await globalThis.__importPilot();",
      )
      .replaceAll("import.meta.hot", "globalThis.__hot");
    const destroyed: number[] = [];
    let installs = 0;
    let disposeCallback: (() => void) | null = null;
    const context = vm.createContext({
      console: { warn: vi.fn() },
      window: {
        FeedbackLayer: {
          contract: { protocol: FEEDBACK_LAYER_PROTOCOL },
          completeResolutionChallenge: async () => ({}),
          async install() {
            installs += 1;
            const id = installs;
            return { destroy: () => destroyed.push(id) };
          },
        },
        setTimeout,
        clearTimeout,
      },
      __importPilot: async () => ({}),
      __hot: {
        dispose(callback: () => void) {
          disposeCallback = callback;
        },
      },
    });

    const evaluate = () =>
      vm.runInContext(`(async () => { ${source} })()`, context);
    await evaluate();
    await new Promise((resolve) => setImmediate(resolve));
    expect(installs).toBe(1);

    await evaluate();
    await new Promise((resolve) => setImmediate(resolve));
    expect(installs).toBe(2);
    expect(destroyed).toEqual([1]);

    expect(disposeCallback).not.toBeNull();
    (disposeCallback as unknown as () => void)();
    expect(destroyed).toEqual([1, 2]);
  });

  it("contains initial failure without touching Prompt Vault's fatal overlay", async () => {
    const source = createPilotLoaderSource(validConfig())
      .replace(
        /await import\([^;]+\);/,
        "await globalThis.__importPilot();",
      )
      .replaceAll("import.meta.hot", "globalThis.__hot");
    const warnings: string[] = [];
    const pending: Array<() => void> = [];
    const windowObject: Record<string, unknown> = {
      setTimeout(callback: () => void) {
        pending.push(callback);
        return pending.length;
      },
      clearTimeout() {},
    };
    const context = vm.createContext({
      console: { warn: (message: string) => warnings.push(message) },
      window: windowObject,
      __importPilot: async () => {
        throw new Error("private service detail");
      },
      __hot: null,
    });

    await vm.runInContext(`(async () => { ${source} })()`, context);
    while (pending.length) {
      pending.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(warnings).toEqual([
      "Feedback Layer pilot is temporarily unavailable; Prompt Vault remains operational.",
    ]);
    expect(windowObject).not.toHaveProperty("__PROMPT_VAULT_FATAL_ERROR__");
    expect(windowObject).not.toHaveProperty("__REACT_ERROR_OVERLAY_GLOBAL_HOOK__");
  });
});
