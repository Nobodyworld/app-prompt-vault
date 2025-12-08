import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryRateLimitStore } from "../src/web/rate-limit.js";

describe("InMemoryRateLimitStore", () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore(100); // 100ms cleanup interval
  });

  afterEach(() => {
    store.destroy();
  });

  describe("basic store operations", () => {
    it("should set and get entries", () => {
      const entry = {
        count: 5,
        resetAt: Date.now() + 60000,
        firstRequestAt: Date.now(),
      };

      store.set("key-1", entry);
      const retrieved = store.get("key-1");

      expect(retrieved).toEqual(entry);
    });

    it("should delete entries", () => {
      const entry = {
        count: 3,
        resetAt: Date.now() + 60000,
        firstRequestAt: Date.now(),
      };

      store.set("key-1", entry);
      expect(store.get("key-1")).toBeDefined();

      store.delete("key-1");
      expect(store.get("key-1")).toBeUndefined();
    });

    it("should clear all entries", () => {
      const entry1 = {
        count: 2,
        resetAt: Date.now() + 60000,
        firstRequestAt: Date.now(),
      };

      const entry2 = {
        count: 3,
        resetAt: Date.now() + 60000,
        firstRequestAt: Date.now(),
      };

      store.set("key-1", entry1);
      store.set("key-2", entry2);

      store.clear();

      expect(store.get("key-1")).toBeUndefined();
      expect(store.get("key-2")).toBeUndefined();
    });

    it("should track different keys independently", () => {
      const now = Date.now();

      store.set("key-1", {
        count: 5,
        resetAt: now + 60000,
        firstRequestAt: now,
      });

      store.set("key-2", {
        count: 10,
        resetAt: now + 60000,
        firstRequestAt: now,
      });

      const entry1 = store.get("key-1");
      const entry2 = store.get("key-2");

      expect(entry1?.count).toBe(5);
      expect(entry2?.count).toBe(10);
    });
  });

  describe("cleanup mechanism", () => {
    it("should clean up expired entries", async () => {
      const now = Date.now();

      // Add an expired entry
      store.set("expired-key", {
        count: 5,
        resetAt: now - 1000, // 1 second ago
        firstRequestAt: now - 2000,
      });

      // Add a valid entry
      store.set("valid-key", {
        count: 3,
        resetAt: now + 60000,
        firstRequestAt: now,
      });

      // Wait for cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(store.get("expired-key")).toBeUndefined();
      expect(store.get("valid-key")).toBeDefined();
    });
  });

  describe("return undefined for missing keys", () => {
    it("should return undefined for non-existent keys", () => {
      expect(store.get("non-existent")).toBeUndefined();
    });
  });
});
