import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

export const FEEDBACK_LAYER_PROTOCOL =
  "feedback-layer.development-integration@1";
export const FEEDBACK_LAYER_EXPECTED_ORIGIN = "http://127.0.0.1:1420";
export const FEEDBACK_LAYER_CONTRACT_ROUTE =
  "/integration/feedback-layer.development@1.json";
export const FEEDBACK_LAYER_SDK_ROUTE =
  "/integration/feedback-layer.development@1.js";
export const PILOT_LOADER_ROUTE = "/@prompt-vault/feedback-layer-pilot.js";
export const PILOT_SDK_ROUTE = "/@prompt-vault/feedback-layer-sdk.js";
export const FEEDBACK_LAYER_CONTRACT_MAX_BYTES = 64 * 1024;
export const FEEDBACK_LAYER_SDK_MAX_BYTES = 4 * 1024 * 1024;

const PROJECT_ID_PATTERN = /^project_[a-f0-9]{32}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const RETRY_DELAYS_MS = [0, 500, 1_500, 3_000] as const;

export interface FeedbackLayerPilotConfig {
  serviceUrl: string;
  projectId: string;
  expectedOrigin: typeof FEEDBACK_LAYER_EXPECTED_ORIGIN;
  contract: typeof FEEDBACK_LAYER_PROTOCOL;
}

export interface VerifiedFeedbackLayerSdk {
  bytes: Buffer;
  sha256: string;
  byteLength: number;
  applicationVersion: string;
}

export class FeedbackLayerPilotConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackLayerPilotConfigurationError";
  }
}

export class FeedbackLayerServiceUnavailable extends Error {
  constructor() {
    super("Feedback Layer is temporarily unavailable.");
    this.name = "FeedbackLayerServiceUnavailable";
  }
}

type Environment = Record<string, string | undefined>;
type FetchImplementation = typeof fetch;
type JsonRecord = Record<string, unknown>;

function configurationError(message: string): never {
  throw new FeedbackLayerPilotConfigurationError(
    `Feedback Layer pilot configuration is invalid: ${message}`,
  );
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    configurationError(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function assertExactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).toSorted();
  const wanted = [...expected].toSorted();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    configurationError(`${label} has an unexpected shape.`);
  }
}

export function parseFeedbackLayerPilotConfig(
  environment: Environment = process.env,
): FeedbackLayerPilotConfig | null {
  const enabled = environment.FEEDBACK_LAYER_PILOT_ENABLED;
  if (enabled === undefined || enabled === "" || enabled === "false" || enabled === "0") {
    return null;
  }
  if (enabled !== "true" && enabled !== "1") {
    configurationError(
      "FEEDBACK_LAYER_PILOT_ENABLED must be true, 1, false, 0, or unset.",
    );
  }

  const serviceUrl = environment.FEEDBACK_LAYER_SERVICE_URL;
  if (!serviceUrl) {
    configurationError("FEEDBACK_LAYER_SERVICE_URL is required.");
  }

  let parsedServiceUrl: URL;
  try {
    parsedServiceUrl = new URL(serviceUrl);
  } catch {
    configurationError(
      "FEEDBACK_LAYER_SERVICE_URL must be an exact loopback HTTP origin.",
    );
  }
  if (
    parsedServiceUrl.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(parsedServiceUrl.hostname) ||
    !parsedServiceUrl.port ||
    parsedServiceUrl.username ||
    parsedServiceUrl.password ||
    parsedServiceUrl.pathname !== "/" ||
    parsedServiceUrl.search ||
    parsedServiceUrl.hash ||
    parsedServiceUrl.origin !== serviceUrl
  ) {
    configurationError(
      "FEEDBACK_LAYER_SERVICE_URL must be an exact loopback HTTP origin with an explicit port.",
    );
  }

  if (
    environment.FEEDBACK_LAYER_EXPECTED_ORIGIN !==
    FEEDBACK_LAYER_EXPECTED_ORIGIN
  ) {
    configurationError(
      `FEEDBACK_LAYER_EXPECTED_ORIGIN must equal ${FEEDBACK_LAYER_EXPECTED_ORIGIN}.`,
    );
  }

  const projectId = environment.FEEDBACK_LAYER_PROJECT_ID;
  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
    configurationError(
      "FEEDBACK_LAYER_PROJECT_ID must match the bounded Feedback Layer project format.",
    );
  }

  if (environment.FEEDBACK_LAYER_CONTRACT !== FEEDBACK_LAYER_PROTOCOL) {
    configurationError(
      `FEEDBACK_LAYER_CONTRACT must equal ${FEEDBACK_LAYER_PROTOCOL}.`,
    );
  }

  return {
    serviceUrl,
    projectId,
    expectedOrigin: FEEDBACK_LAYER_EXPECTED_ORIGIN,
    contract: FEEDBACK_LAYER_PROTOCOL,
  };
}

async function fetchBytesWithTimeout(
  fetchImpl: FetchImplementation,
  url: string,
  timeoutMs: number,
  maxBytes: number,
  expectedContentType: string,
  label: string,
): Promise<Buffer> {
  const controller = new AbortController();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelBody = (): void => {
    // Cancellation may itself stall for a custom stream; never await it.
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body && !response.body.locked) {
      void response.body.cancel().catch(() => {});
    }
  };
  const consume = async (): Promise<Buffer> => {
    try {
      response = await fetchImpl(url, {
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (response.status >= 500) throw new FeedbackLayerServiceUnavailable();
      if (!response.ok) configurationError(`${label} route was rejected.`);
      assertNoStoreHeaders(response, expectedContentType, label);
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && (
        !/^\d+$/.test(declaredLength) ||
        !Number.isSafeInteger(Number(declaredLength)) ||
        Number(declaredLength) > maxBytes
      )) {
        configurationError(`${label} exceeds its response byte limit.`);
      }
      if (!response.body) return Buffer.alloc(0);
      reader = response.body.getReader();
      // Fixed capacity avoids accumulating an unbounded body or chunk list.
      const bytes = Buffer.alloc(maxBytes);
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) return bytes.subarray(0, length);
        if (value.byteLength > maxBytes - length) {
          configurationError(`${label} exceeds its response byte limit.`);
        }
        bytes.set(value, length);
        length += value.byteLength;
      }
    } finally {
      cancelBody();
      reader?.releaseLock();
    }
  };
  // The per-response deadline covers headers AND body, even if an injected
  // fetch/stream ignores AbortSignal. The size bound is enforced before copying.
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      cancelBody();
      reject(new FeedbackLayerServiceUnavailable());
    }, timeoutMs);
  });
  try {
    return await Promise.race([consume(), deadline]);
  } catch (error) {
    if (error instanceof FeedbackLayerPilotConfigurationError) throw error;
    throw new FeedbackLayerServiceUnavailable();
  } finally {
    clearTimeout(timer);
    controller.abort();
    cancelBody();
  }
}

function assertNoStoreHeaders(
  response: Response,
  expectedContentType: string,
  label: string,
): void {
  if (response.redirected) configurationError(`${label} must not redirect.`);
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith(expectedContentType)
  ) {
    configurationError(`${label} returned an unexpected content type.`);
  }
  if (response.headers.get("cache-control")?.toLowerCase() !== "no-store") {
    configurationError(`${label} must be no-store.`);
  }
  if (
    response.headers.get("x-content-type-options")?.toLowerCase() !==
    "nosniff"
  ) {
    configurationError(`${label} must set nosniff.`);
  }
}

function validateContract(value: unknown): {
  sdkRoute: string;
  byteLength: number;
  sha256: string;
  applicationVersion: string;
} {
  const contract = asRecord(value, "contract");
  assertExactKeys(
    contract,
    [
      "application",
      "attributes",
      "limits",
      "methods",
      "protocol",
      "protocolVersion",
      "requirements",
      "sdk",
    ],
    "contract",
  );
  if (
    contract.protocol !== FEEDBACK_LAYER_PROTOCOL ||
    contract.protocolVersion !== 1
  ) {
    configurationError("the service protocol identity does not match.");
  }

  const application = asRecord(contract.application, "contract.application");
  assertExactKeys(application, ["name", "version"], "contract.application");
  if (
    application.name !== "Feedback Layer" ||
    typeof application.version !== "string" ||
    !/^0\.3\.[0-9]+(?:[-+][a-z0-9.-]+)?$/i.test(application.version)
  ) {
    configurationError("the Feedback Layer application identity is invalid.");
  }

  const sdk = asRecord(contract.sdk, "contract.sdk");
  assertExactKeys(
    sdk,
    ["byteLength", "global", "route", "sha256"],
    "contract.sdk",
  );
  if (
    sdk.route !== FEEDBACK_LAYER_SDK_ROUTE ||
    sdk.global !== "FeedbackLayer" ||
    !Number.isSafeInteger(sdk.byteLength) ||
    Number(sdk.byteLength) <= 0 ||
    Number(sdk.byteLength) > FEEDBACK_LAYER_SDK_MAX_BYTES ||
    typeof sdk.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sdk.sha256)
  ) {
    configurationError("the SDK metadata is invalid.");
  }

  const methods = asRecord(contract.methods, "contract.methods");
  assertExactKeys(
    methods,
    ["completeResolutionChallenge", "install"],
    "contract.methods",
  );
  if (
    methods.install !== "install" ||
    methods.completeResolutionChallenge !== "completeResolutionChallenge"
  ) {
    configurationError("the required SDK methods do not match.");
  }

  const requirements = asRecord(
    contract.requirements,
    "contract.requirements",
  );
  assertExactKeys(
    requirements,
    [
      "activeProject",
      "developmentOnly",
      "exactOrigin",
      "loopbackService",
      "minimumConsumerProtocol",
    ],
    "contract.requirements",
  );
  if (
    requirements.activeProject !== true ||
    requirements.developmentOnly !== true ||
    requirements.exactOrigin !== true ||
    requirements.loopbackService !== true ||
    requirements.minimumConsumerProtocol !== 1
  ) {
    configurationError("the development requirements do not match.");
  }

  const attributes = asRecord(contract.attributes, "contract.attributes");
  assertExactKeys(
    attributes,
    ["applicationAnchor", "private", "redact", "semanticId"],
    "contract.attributes",
  );
  if (
    attributes.semanticId !== "data-feedback-id" ||
    attributes.applicationAnchor !== "data-feedback-anchor" ||
    attributes.private !== "data-feedback-private" ||
    attributes.redact !== "data-feedback-redact"
  ) {
    configurationError("the semantic and privacy attributes do not match.");
  }

  const limits = asRecord(contract.limits, "contract.limits");
  assertExactKeys(
    limits,
    ["attachmentBytes", "resolutionCandidates", "resolutionScanElements"],
    "contract.limits",
  );
  if (
    limits.attachmentBytes !== 5_242_880 ||
    limits.resolutionCandidates !== 200 ||
    limits.resolutionScanElements !== 2_000
  ) {
    configurationError("the bounded SDK limits do not match.");
  }

  return {
    sdkRoute: sdk.route as string,
    byteLength: Number(sdk.byteLength),
    sha256: sdk.sha256 as string,
    applicationVersion: application.version,
  };
}

export async function fetchVerifiedFeedbackLayerSdk(
  config: FeedbackLayerPilotConfig,
  {
    fetchImpl = fetch,
    timeoutMs = 1_500,
  }: { fetchImpl?: FetchImplementation; timeoutMs?: number } = {},
): Promise<VerifiedFeedbackLayerSdk> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    configurationError("the response timeout must be a positive bounded integer.");
  }
  const contractBytes = await fetchBytesWithTimeout(
    fetchImpl,
    config.serviceUrl + FEEDBACK_LAYER_CONTRACT_ROUTE,
    timeoutMs,
    FEEDBACK_LAYER_CONTRACT_MAX_BYTES,
    "application/json",
    "the versioned contract",
  );

  let contractValue: unknown;
  try {
    contractValue = JSON.parse(new TextDecoder().decode(contractBytes));
  } catch {
    configurationError("the versioned contract is not valid JSON.");
  }
  const metadata = validateContract(contractValue);

  const sdkUrl = new URL(metadata.sdkRoute, config.serviceUrl);
  if (
    sdkUrl.origin !== config.serviceUrl ||
    sdkUrl.pathname !== FEEDBACK_LAYER_SDK_ROUTE ||
    sdkUrl.search ||
    sdkUrl.hash
  ) {
    configurationError("the SDK route escaped the configured service origin.");
  }

  const bytes = await fetchBytesWithTimeout(
    fetchImpl,
    sdkUrl.href,
    timeoutMs,
    metadata.byteLength,
    "text/javascript",
    "the versioned SDK",
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== metadata.byteLength || digest !== metadata.sha256) {
    configurationError("the SDK byte length or SHA-256 did not match.");
  }

  return {
    bytes,
    sha256: digest,
    byteLength: bytes.length,
    applicationVersion: metadata.applicationVersion,
  };
}

export function createPilotLoaderSource(
  config: FeedbackLayerPilotConfig,
): string {
  const publicConfig = JSON.stringify({
    serviceUrl: config.serviceUrl,
    projectId: config.projectId,
    protocol: config.contract,
    appVersion: "0.4.0",
    consumerIdentity: "prompt-vault",
  });
  const retryDelays = JSON.stringify(RETRY_DELAYS_MS);
  return `const CONFIG = Object.freeze(${publicConfig});
const RUNTIME_KEY = "__PROMPT_VAULT_FEEDBACK_LAYER_PILOT_RUNTIME__";
const RETRY_DELAYS = Object.freeze(${retryDelays});
const previous = window[RUNTIME_KEY];
if (previous && typeof previous.dispose === "function") previous.dispose();
const state = {
  disposed: false,
  instance: null,
  timer: null,
  installPromise: null,
  dispose() {
    this.disposed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.instance && typeof this.instance.destroy === "function") {
      this.instance.destroy();
    }
    this.instance = null;
  },
};
window[RUNTIME_KEY] = state;
const boundedWarning = (authorizationFailure = false) => {
  console.warn(
    authorizationFailure
      ? "Feedback Layer pilot authorization is unavailable; Prompt Vault remains operational."
      : "Feedback Layer pilot is temporarily unavailable; Prompt Vault remains operational.",
  );
};
async function attempt(index) {
  if (state.disposed) return;
  try {
    await import("${PILOT_SDK_ROUTE}?attempt=" + index);
    if (state.disposed) return;
    const api = window.FeedbackLayer;
    if (
      !api ||
      api.contract?.protocol !== CONFIG.protocol ||
      typeof api.install !== "function" ||
      typeof api.completeResolutionChallenge !== "function"
    ) {
      throw new Error("verified SDK global is unavailable");
    }
    state.installPromise = api.install({
      serviceUrl: CONFIG.serviceUrl,
      projectId: CONFIG.projectId,
      appVersion: CONFIG.appVersion,
      sessionObjective: "Prompt Vault development pilot",
      consumerIdentity: CONFIG.consumerIdentity,
    });
    const instance = await state.installPromise;
    state.installPromise = null;
    if (state.disposed) {
      instance?.destroy?.();
      return;
    }
    state.instance = instance;
  } catch (error) {
    state.installPromise = null;
    if (state.disposed) return;
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "ORIGIN_REVOKED" || code === "PROJECT_DISABLED") {
      boundedWarning(true);
      return;
    }
    const nextIndex = index + 1;
    if (nextIndex >= RETRY_DELAYS.length) {
      boundedWarning(false);
      return;
    }
    state.timer = window.setTimeout(
      () => void attempt(nextIndex),
      RETRY_DELAYS[nextIndex],
    );
  }
}
void attempt(0);
if (import.meta.hot) import.meta.hot.dispose(() => state.dispose());
`;
}

function sendBytes(
  response: ServerResponse,
  statusCode: number,
  bytes: Buffer,
  contentType: string,
): void {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": String(bytes.length),
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(bytes);
}

function requestPath(request: IncomingMessage): string | null {
  try {
    return new URL(
      request.url ?? "/",
      FEEDBACK_LAYER_EXPECTED_ORIGIN,
    ).pathname;
  } catch {
    return null;
  }
}

function validateResolvedServer(config: ResolvedConfig): void {
  if (
    config.server.host !== "127.0.0.1" ||
    config.server.port !== 1420 ||
    config.server.strictPort !== true
  ) {
    configurationError(
      "the Vite development server must use 127.0.0.1:1420 with strictPort.",
    );
  }
}

export function feedbackLayerPilot(
  environment: Environment = process.env,
  { fetchImpl = fetch }: { fetchImpl?: FetchImplementation } = {},
): Plugin {
  const config = parseFeedbackLayerPilotConfig(environment);
  let verifiedSdk: VerifiedFeedbackLayerSdk | null = null;
  let permanentFailure: FeedbackLayerPilotConfigurationError | null = null;
  let pendingVerification: Promise<VerifiedFeedbackLayerSdk> | null = null;

  const ensureVerifiedSdk = async (): Promise<VerifiedFeedbackLayerSdk> => {
    if (!config) throw new FeedbackLayerServiceUnavailable();
    if (verifiedSdk) return verifiedSdk;
    if (permanentFailure) throw permanentFailure;
    if (!pendingVerification) {
      pendingVerification = fetchVerifiedFeedbackLayerSdk(config, {
        fetchImpl,
      })
        .then((verified) => {
          verifiedSdk = verified;
          return verified;
        })
        .catch((error: unknown) => {
          if (error instanceof FeedbackLayerPilotConfigurationError) {
            permanentFailure = error;
          }
          throw error;
        })
        .finally(() => {
          pendingVerification = null;
        });
    }
    return pendingVerification;
  };

  return {
    name: "prompt-vault-feedback-layer-pilot",
    apply: "serve",
    enforce: "post",

    async configResolved(resolved): Promise<void> {
      if (!config) return;
      validateResolvedServer(resolved);
      try {
        await ensureVerifiedSdk();
      } catch (error) {
        if (!(error instanceof FeedbackLayerServiceUnavailable)) throw error;
      }
    },

    configureServer(server: ViteDevServer): void {
      if (!config) return;
      const loaderBytes = Buffer.from(createPilotLoaderSource(config), "utf8");
      server.middlewares.use(async (request, response, next) => {
        const pathname = requestPath(request);
        if (pathname === PILOT_LOADER_ROUTE) {
          sendBytes(
            response,
            200,
            loaderBytes,
            "text/javascript; charset=utf-8",
          );
          return;
        }
        if (pathname !== PILOT_SDK_ROUTE) {
          next();
          return;
        }

        try {
          const verified = await ensureVerifiedSdk();
          sendBytes(
            response,
            200,
            verified.bytes,
            "text/javascript; charset=utf-8",
          );
        } catch (error) {
          const statusCode =
            error instanceof FeedbackLayerServiceUnavailable ? 503 : 500;
          const body = Buffer.from(
            "export const feedbackLayerPilotUnavailable = true;\n",
            "utf8",
          );
          sendBytes(
            response,
            statusCode,
            body,
            "text/javascript; charset=utf-8",
          );
        }
      });
    },

    transformIndexHtml(html) {
      if (!config) return html;
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: { type: "module", src: PILOT_LOADER_ROUTE },
            injectTo: "body",
          },
        ],
      };
    },
  };
}
