import { describe, it, expect, beforeEach, vi } from "vitest";
import { AuthManager } from "../src/web/auth.js";

// Mock @nw/secrets
vi.mock("@nw/secrets", () => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
}));

describe("AuthManager", () => {
  let authManager: AuthManager;

  beforeEach(async () => {
    // Mock the secrets functions
    const { getSecret, storeSecret } = await import("@nw/secrets");
    vi.mocked(getSecret).mockResolvedValue(null); // No existing secret
    vi.mocked(storeSecret).mockResolvedValue(undefined);

    authManager = new AuthManager({
      jwtExpiresIn: "1h",
      apiKeys: {
        admin: "admin-key-123",
        readonly: "readonly-key-456",
      },
    });

    // Initialize the auth manager
    await authManager.initialize();
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
        // Mock for this specific test
        const { getSecret, storeSecret } = await import("@nw/secrets");
        vi.mocked(getSecret).mockResolvedValueOnce("test-secret-key-for-expiry-test");

        const shortLivedManager = new AuthManager({
          jwtExpiresIn: "1s",
        });

        await shortLivedManager.initialize();

        const token = shortLivedManager.generateToken({
          userId: "user-123",
          username: "alice",
        });

        // Wait long enough to ensure exp (1s) has passed
        await new Promise((resolve) => setTimeout(resolve, 2100));

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

  it("uses provided jwtSecret without fetching or storing", async () => {
    const { getSecret, storeSecret } = await import("@nw/secrets");
    vi.mocked(getSecret).mockClear();
    vi.mocked(storeSecret).mockClear();

    const manager = new AuthManager({ jwtSecret: "static-secret", jwtExpiresIn: "1h" });
    await manager.initialize();

    const token = manager.generateToken({ userId: "user-123", username: "alice" });
    expect(manager.verifyToken(token)?.userId).toBe("user-123");
    expect(vi.mocked(getSecret)).not.toHaveBeenCalled();
    expect(vi.mocked(storeSecret)).not.toHaveBeenCalled();
  });
});
