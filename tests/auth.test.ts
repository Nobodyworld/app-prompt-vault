import { describe, it, expect, beforeEach } from "vitest";
import { AuthManager } from "../src/web/auth.js";

describe("AuthManager", () => {
  let authManager: AuthManager;

  beforeEach(() => {
    authManager = new AuthManager({
      jwtSecret: "test-secret-key-min-32-characters",
      jwtExpiresIn: "1h",
      apiKeys: {
        admin: "admin-key-123",
        readonly: "readonly-key-456",
      },
    });
  });

  describe("JWT token generation and verification", () => {
    it("should generate a valid JWT token", () => {
      const token = authManager.generateToken({
        userId: "user-123",
        username: "alice",
        roles: ["admin"],
      });

      expect(token).toBeTypeOf("string");
      expect(token.split(".")).toHaveLength(3); // header.payload.signature
    });

    it("should verify a valid token", () => {
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

    it("should reject invalid token", () => {
      const payload = authManager.verifyToken("invalid.token.here");

      expect(payload).toBeNull();
    });

    it("should reject token with invalid signature", () => {
      const token = authManager.generateToken({
        userId: "user-123",
        username: "alice",
      });

      // Tamper with signature
      const parts = token.split(".");
      const tamperedToken = `${parts[0]}.${parts[1]}.invalid-signature`;

      const payload = authManager.verifyToken(tamperedToken);

      expect(payload).toBeNull();
    });

    it(
      "should reject expired token",
      async () => {
        const shortLivedManager = new AuthManager({
          jwtSecret: "test-secret",
          jwtExpiresIn: "1s",
        });

        const token = shortLivedManager.generateToken({
          userId: "user-123",
          username: "alice",
        });

        // Wait for token to expire
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const payload = shortLivedManager.verifyToken(token);
        expect(payload).toBeNull();
      },
      10000
    );
  });

  describe("API key validation", () => {
    it("should validate correct API key", () => {
      const keyName = authManager.validateApiKey("admin-key-123");

      expect(keyName).toBe("admin");
    });

    it("should reject invalid API key", () => {
      const keyName = authManager.validateApiKey("invalid-key");

      expect(keyName).toBeNull();
    });

    it("should validate different keys", () => {
      const adminKey = authManager.validateApiKey("admin-key-123");
      const readonlyKey = authManager.validateApiKey("readonly-key-456");

      expect(adminKey).toBe("admin");
      expect(readonlyKey).toBe("readonly");
    });
  });
});
