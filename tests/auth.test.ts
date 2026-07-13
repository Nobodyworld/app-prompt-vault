import { beforeEach, describe, expect, it } from "vitest";
import { AuthManager } from "../src/web/auth.js";

describe("AuthManager", () => {
  let authManager: AuthManager;

  beforeEach(async () => {
    authManager = new AuthManager({
      jwtSecret: "test-secret-key-for-auth-manager-tests",
      jwtExpiresIn: "1h",
      apiKeys: {
        admin: "admin-key-123",
        readonly: "readonly-key-456",
      },
    });
    await authManager.initialize();
  });

  describe("JWT token generation and verification", () => {
    it("generates a three-part JWT token", () => {
      const token = authManager.generateToken({
        userId: "user-123",
        username: "alice",
        roles: ["admin"],
      });

      expect(token).toBeTypeOf("string");
      expect(token.split(".")).toHaveLength(3);
    });

    it("verifies a valid token", () => {
      const token = authManager.generateToken({
        userId: "user-123",
        username: "alice",
        roles: ["admin"],
      });

      const payload = authManager.verifyToken(token);

      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe("user-123");
      expect(payload?.username).toBe("alice");
      expect(payload?.roles).toEqual(["admin"]);
    });

    it("rejects a malformed token", () => {
      expect(authManager.verifyToken("invalid.token.here")).toBeNull();
    });

    it("rejects a token with an invalid signature", () => {
      const token = authManager.generateToken({
        userId: "user-123",
        username: "alice",
      });
      const parts = token.split(".");
      const tamperedToken = `${parts[0]}.${parts[1]}.invalid-signature`;

      expect(authManager.verifyToken(tamperedToken)).toBeNull();
    });

    it(
      "rejects an expired token",
      async () => {
        const shortLivedManager = new AuthManager({
          jwtSecret: "test-secret-key-for-expiry-test",
          jwtExpiresIn: "1s",
        });
        await shortLivedManager.initialize();

        const token = shortLivedManager.generateToken({
          userId: "user-123",
          username: "alice",
        });

        await new Promise((resolve) => setTimeout(resolve, 2100));
        expect(shortLivedManager.verifyToken(token)).toBeNull();
      },
      10000,
    );
  });

  describe("API key validation", () => {
    it("validates a correct API key", () => {
      expect(authManager.validateApiKey("admin-key-123")).toBe("admin");
    });

    it("rejects an invalid API key", () => {
      expect(authManager.validateApiKey("invalid-key")).toBeNull();
    });

    it("distinguishes configured keys", () => {
      expect(authManager.validateApiKey("admin-key-123")).toBe("admin");
      expect(authManager.validateApiKey("readonly-key-456")).toBe("readonly");
    });
  });

  it("uses the provided JWT secret without an external secret provider", async () => {
    const manager = new AuthManager({
      jwtSecret: "static-secret",
      jwtExpiresIn: "1h",
    });
    await manager.initialize();

    const token = manager.generateToken({
      userId: "user-123",
      username: "alice",
    });
    expect(manager.getJwtSecret()).toBe("static-secret");
    expect(manager.verifyToken(token)?.userId).toBe("user-123");
  });
});
