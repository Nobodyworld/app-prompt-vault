import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructuredLogger } from "../src/observability/logger.js";
import {
  AuthManager,
  JwtSigningUnavailableError,
  type AuthPayload,
} from "../src/web/auth.js";

const JWT_SECRET = "test-secret-key-for-auth-manager-tests";
const OTHER_JWT_SECRET = "different-test-secret-key-for-auth-manager";
const FIXED_NOW = new Date("2026-07-23T12:00:00.000Z");
const FIXED_NOW_SECONDS = Math.floor(FIXED_NOW.getTime() / 1000);

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function encodeText(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signSegments(
  headerSegment: string,
  payloadSegment: string,
  secret = JWT_SECRET,
): string {
  return createHmac("sha256", secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");
}

function createToken(
  header: unknown = { alg: "HS256", typ: "JWT" },
  payload: unknown = validPayload(),
  secret = JWT_SECRET,
): string {
  const headerSegment = encodeJson(header);
  const payloadSegment = encodeJson(payload);
  const signature = signSegments(headerSegment, payloadSegment, secret);
  return `${headerSegment}.${payloadSegment}.${signature}`;
}

function createTokenFromSegments(
  headerSegment: string,
  payloadSegment: string,
  secret = JWT_SECRET,
): string {
  const signature = signSegments(headerSegment, payloadSegment, secret);
  return `${headerSegment}.${payloadSegment}.${signature}`;
}

function validPayload(
  overrides: Partial<AuthPayload> = {},
): AuthPayload {
  return {
    userId: "user-123",
    username: "alice",
    roles: ["admin"],
    scopes: ["prompt-vault:read", "prompt-vault:write"],
    iat: FIXED_NOW_SECONDS,
    exp: FIXED_NOW_SECONDS + 3600,
    ...overrides,
  };
}

describe("AuthManager", () => {
  let authManager: AuthManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    authManager = new AuthManager({
      jwtSecret: JWT_SECRET,
      jwtExpiresIn: "1h",
      apiKeys: {
        admin: "admin-key-123",
        readonly: "readonly-key-456",
        empty: "",
      },
    });
    await authManager.initialize();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("initialization and secret lifecycle", () => {
    it("fails token generation before initialization", () => {
      const manager = new AuthManager({ jwtSecret: JWT_SECRET });

      expect(() =>
        manager.generateToken({ userId: "user-123", username: "alice" }),
      ).toThrow(JwtSigningUnavailableError);
    });

    it("returns null from verification before initialization", () => {
      const manager = new AuthManager({ jwtSecret: JWT_SECRET });

      expect(manager.verifyToken(createToken())).toBeNull();
    });

    it("initializes with an injected secret", async () => {
      const manager = new AuthManager({ jwtSecret: JWT_SECRET });
      await manager.initialize();

      const token = manager.generateToken({
        userId: "user-123",
        username: "alice",
      });
      expect(manager.verifyToken(token)?.userId).toBe("user-123");
    });

    it("leaves JWT issuance and verification disabled without a secret", async () => {
      const manager = new AuthManager({});
      await manager.initialize();

      expect(() =>
        manager.generateToken({ userId: "user-123", username: "alice" }),
      ).toThrow(/no Prompt Vault JWT secret is configured/i);
      expect(manager.verifyToken(createToken())).toBeNull();
    });

    it("allows separately initialized managers with the same secret to interoperate", async () => {
      const issuer = new AuthManager({ jwtSecret: JWT_SECRET });
      const verifier = new AuthManager({ jwtSecret: JWT_SECRET });
      await Promise.all([issuer.initialize(), verifier.initialize()]);

      const token = issuer.generateToken({
        userId: "user-123",
        username: "alice",
      });
      expect(verifier.verifyToken(token)?.username).toBe("alice");
    });

    it("rejects a token under a different injected secret", async () => {
      const issuer = new AuthManager({ jwtSecret: JWT_SECRET });
      const verifier = new AuthManager({ jwtSecret: OTHER_JWT_SECRET });
      await Promise.all([issuer.initialize(), verifier.initialize()]);

      const token = issuer.generateToken({
        userId: "user-123",
        username: "alice",
      });
      expect(verifier.verifyToken(token)).toBeNull();
    });
  });

  describe("valid JWT generation and verification", () => {
    it("generates the exact supported header and required payload claims", () => {
      const token = authManager.generateToken({
        userId: "user-123",
        username: "alice",
        roles: ["admin"],
        scopes: ["prompt-vault:read"],
      });
      const parts = token.split(".");

      expect(parts).toHaveLength(3);
      expect(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))).toEqual({
        alg: "HS256",
        typ: "JWT",
      });
      expect(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))).toEqual({
        userId: "user-123",
        username: "alice",
        roles: ["admin"],
        scopes: ["prompt-vault:read"],
        iat: FIXED_NOW_SECONDS,
        exp: FIXED_NOW_SECONDS + 3600,
      });
    });

    it("verifies valid roles and scopes", () => {
      const token = authManager.generateToken({
        userId: "user-123",
        username: "alice",
        roles: ["admin"],
        scopes: ["prompt-vault:read", "prompt-vault:write"],
      });

      expect(authManager.verifyToken(token)).toEqual(validPayload());
    });
  });

  describe("signature failures", () => {
    it("rejects a same-length incorrect signature", () => {
      const [header, payload] = createToken().split(".");
      const incorrect = Buffer.alloc(32, 0xa5).toString("base64url");

      expect(authManager.verifyToken(`${header}.${payload}.${incorrect}`)).toBeNull();
    });

    it("rejects a shorter signature", () => {
      const [header, payload] = createToken().split(".");
      const short = Buffer.alloc(31, 0xa5).toString("base64url");

      expect(authManager.verifyToken(`${header}.${payload}.${short}`)).toBeNull();
    });

    it("rejects a longer signature", () => {
      const [header, payload] = createToken().split(".");
      const long = Buffer.alloc(33, 0xa5).toString("base64url");

      expect(authManager.verifyToken(`${header}.${payload}.${long}`)).toBeNull();
    });

    it("rejects a tampered header", () => {
      const [, payload, signature] = createToken().split(".");
      const tamperedHeader = encodeJson({ alg: "HS256", typ: "jwt" });

      expect(
        authManager.verifyToken(`${tamperedHeader}.${payload}.${signature}`),
      ).toBeNull();
    });

    it("rejects a tampered payload", () => {
      const [header, , signature] = createToken().split(".");
      const tamperedPayload = encodeJson(validPayload({ username: "mallory" }));

      expect(
        authManager.verifyToken(`${header}.${tamperedPayload}.${signature}`),
      ).toBeNull();
    });

    it("rejects an empty signature", () => {
      const [header, payload] = createToken().split(".");

      expect(authManager.verifyToken(`${header}.${payload}.`)).toBeNull();
    });

    it("rejects malformed or padded signatures", () => {
      const [header, payload, signature] = createToken().split(".");

      expect(authManager.verifyToken(`${header}.${payload}.*`)).toBeNull();
      expect(authManager.verifyToken(`${header}.${payload}.${signature}=`)).toBeNull();
    });
  });

  describe("header failures", () => {
    it("rejects malformed base64url and padded header segments", () => {
      const payload = encodeJson(validPayload());

      expect(authManager.verifyToken(createTokenFromSegments("*", payload))).toBeNull();
      expect(
        authManager.verifyToken(
          createTokenFromSegments(`${encodeJson({ alg: "HS256", typ: "JWT" })}=`, payload),
        ),
      ).toBeNull();
    });

    it("rejects empty, invalid JSON, and invalid UTF-8 headers", () => {
      const payload = encodeJson(validPayload());

      expect(authManager.verifyToken(createTokenFromSegments("", payload))).toBeNull();
      expect(
        authManager.verifyToken(createTokenFromSegments(encodeText("{"), payload)),
      ).toBeNull();
      expect(
        authManager.verifyToken(
          createTokenFromSegments(Buffer.from([0xff]).toString("base64url"), payload),
        ),
      ).toBeNull();
    });

    it.each([
      ["primitive", "header"],
      ["array", []],
      ["null", null],
    ])("rejects a %s header", (_name, header) => {
      expect(authManager.verifyToken(createToken(header))).toBeNull();
    });

    it.each([
      ["missing alg", { typ: "JWT" }],
      ["missing typ", { alg: "HS256" }],
      ["alg none", { alg: "none", typ: "JWT" }],
      ["HS384", { alg: "HS384", typ: "JWT" }],
      ["HS512", { alg: "HS512", typ: "JWT" }],
      ["altered typ", { alg: "HS256", typ: "jwt" }],
      ["additional property", { alg: "HS256", typ: "JWT", kid: "key-1" }],
    ])("rejects a header with %s", (_name, header) => {
      expect(authManager.verifyToken(createToken(header))).toBeNull();
    });
  });

  describe("payload failures", () => {
    it("rejects malformed base64url and padded payload segments", () => {
      const header = encodeJson({ alg: "HS256", typ: "JWT" });

      expect(authManager.verifyToken(createTokenFromSegments(header, "*"))).toBeNull();
      expect(
        authManager.verifyToken(
          createTokenFromSegments(header, `${encodeJson(validPayload())}=`),
        ),
      ).toBeNull();
    });

    it("rejects empty, invalid JSON, and invalid UTF-8 payloads", () => {
      const header = encodeJson({ alg: "HS256", typ: "JWT" });

      expect(authManager.verifyToken(createTokenFromSegments(header, ""))).toBeNull();
      expect(
        authManager.verifyToken(createTokenFromSegments(header, encodeText("{"))),
      ).toBeNull();
      expect(
        authManager.verifyToken(
          createTokenFromSegments(header, Buffer.from([0xff]).toString("base64url")),
        ),
      ).toBeNull();
    });

    it.each([
      ["primitive", "payload"],
      ["array", []],
      ["null", null],
    ])("rejects a %s payload", (_name, payload) => {
      expect(authManager.verifyToken(createToken(undefined, payload))).toBeNull();
    });

    it.each([
      ["userId", { username: "alice", iat: FIXED_NOW_SECONDS, exp: FIXED_NOW_SECONDS + 60 }],
      ["username", { userId: "user-123", iat: FIXED_NOW_SECONDS, exp: FIXED_NOW_SECONDS + 60 }],
      ["iat", { userId: "user-123", username: "alice", exp: FIXED_NOW_SECONDS + 60 }],
      ["exp", { userId: "user-123", username: "alice", iat: FIXED_NOW_SECONDS }],
    ])("rejects a payload missing %s", (_claim, payload) => {
      expect(authManager.verifyToken(createToken(undefined, payload))).toBeNull();
    });

    it.each([
      ["userId", validPayload({ userId: null as unknown as string })],
      ["username", validPayload({ username: 123 as unknown as string })],
      ["iat", validPayload({ iat: "now" as unknown as number })],
      ["exp", validPayload({ exp: false as unknown as number })],
    ])("rejects the wrong type for %s", (_claim, payload) => {
      expect(authManager.verifyToken(createToken(undefined, payload))).toBeNull();
    });

    it.each([
      ["fractional iat", validPayload({ iat: FIXED_NOW_SECONDS + 0.5 })],
      ["fractional exp", validPayload({ exp: FIXED_NOW_SECONDS + 3600.5 })],
      ["negative iat", validPayload({ iat: -1 })],
      ["negative exp", validPayload({ exp: -1 })],
    ])("rejects %s", (_name, payload) => {
      expect(authManager.verifyToken(createToken(undefined, payload))).toBeNull();
    });

    it("rejects an expired token outside the 60-second clock skew", () => {
      const payload = validPayload({
        iat: FIXED_NOW_SECONDS - 3600,
        exp: FIXED_NOW_SECONDS - 61,
      });

      expect(authManager.verifyToken(createToken(undefined, payload))).toBeNull();
    });

    it.each([
      ["equal timestamps", validPayload({ exp: FIXED_NOW_SECONDS })],
      [
        "expiration before issuance",
        validPayload({
          iat: FIXED_NOW_SECONDS,
          exp: FIXED_NOW_SECONDS - 1,
        }),
      ],
    ])("rejects %s", (_name, payload) => {
      expect(authManager.verifyToken(createToken(undefined, payload))).toBeNull();
    });

    it("rejects a token issued more than 60 seconds in the future", () => {
      const payload = validPayload({
        iat: FIXED_NOW_SECONDS + 61,
        exp: FIXED_NOW_SECONDS + 3600,
      });

      expect(authManager.verifyToken(createToken(undefined, payload))).toBeNull();
    });

    it.each([
      ["roles as a scalar", { ...validPayload(), roles: "admin" }],
      ["empty role", { ...validPayload(), roles: [""] }],
      ["too many roles", { ...validPayload(), roles: Array(11).fill("reader") }],
      ["scopes as a scalar", { ...validPayload(), scopes: "prompt-vault:read" }],
      ["empty scope", { ...validPayload(), scopes: [""] }],
      ["too many scopes", { ...validPayload(), scopes: Array(21).fill("prompt-vault:read") }],
    ])("rejects malformed %s", (_name, payload) => {
      expect(authManager.verifyToken(createToken(undefined, payload))).toBeNull();
    });

    it("rejects unsupported payload properties", () => {
      expect(
        authManager.verifyToken(
          createToken(undefined, { ...validPayload(), audience: "prompt-vault" }),
        ),
      ).toBeNull();
    });
  });

  describe("API key validation", () => {
    it("validates the correct configured key", () => {
      expect(authManager.validateApiKey("admin-key-123")).toBe("admin");
    });

    it("maps each configured key to its own name", () => {
      expect(authManager.validateApiKey("admin-key-123")).toBe("admin");
      expect(authManager.validateApiKey("readonly-key-456")).toBe("readonly");
    });

    it("rejects a same-length incorrect key", () => {
      expect(authManager.validateApiKey("admin-key-124")).toBeNull();
    });

    it("rejects a different-length incorrect key", () => {
      expect(authManager.validateApiKey("short")).toBeNull();
    });

    it("rejects empty and Unicode edge input", () => {
      expect(authManager.validateApiKey("")).toBeNull();
      expect(authManager.validateApiKey("admin-key-123\u0000")).toBeNull();
      expect(authManager.validateApiKey("admín-key-123")).toBeNull();
    });

    it("does not expose raw API keys or JWT secrets in logs or errors", async () => {
      const output: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args) => {
        output.push(args.join(" "));
      });
      vi.spyOn(console, "warn").mockImplementation((...args) => {
        output.push(args.join(" "));
      });
      const rawApiKey = "raw-api-key-must-not-appear";
      const rawJwtSecret = "raw-jwt-secret-must-not-appear";
      const manager = new AuthManager(
        {
          jwtSecret: rawJwtSecret,
          apiKeys: { protected: rawApiKey },
        },
        new StructuredLogger({ level: "debug" }),
      );
      await manager.initialize();
      manager.validateApiKey(`${rawApiKey}-wrong`);
      manager.verifyToken("invalid.token.value");

      expect(output.join("\n")).not.toContain(rawApiKey);
      expect(output.join("\n")).not.toContain(rawJwtSecret);
      expect(() =>
        new AuthManager({}).generateToken({
          userId: "user-123",
          username: "alice",
        }),
      ).toThrowError(
        "JWT signing is unavailable because no Prompt Vault JWT secret is configured",
      );
    });
  });
});
