// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatePromptInput } from "../../types/prompt";
import type * as PromptApiModule from "../promptApi";

const STORAGE_KEY = "prompt-vault:inMemoryStore:v1";
const STORAGE_ERROR =
  "Unable to save prompt changes to local browser storage. Check storage availability and try again.";

const createInput = (
  slug: string,
  title: string,
): CreatePromptInput => ({
  slug,
  title,
  body: `${title} body`,
  semanticVersion: "1.0.0",
  tags: ["daily"],
});

describe("promptApi browser fallback persistence", () => {
  let api: typeof PromptApiModule;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    vi.resetModules();
    localStorage.clear();
    delete (
      window as typeof window & {
        __TAURI_INTERNALS__?: { invoke?: unknown };
      }
    ).__TAURI_INTERNALS__;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("HTTP API unavailable")),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);

    api = await import("../promptApi");
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("rejects failed creation, restores inventory order, and emits no success notification", async () => {
    const first = await api.createPrompt(createInput("first", "First"));
    const second = await api.createPrompt(createInput("second", "Second"));
    const notifications: boolean[] = [];
    const unsubscribe = api.subscribeFallback((active) => {
      notifications.push(active);
    });
    notifications.length = 0;

    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage full");
      });

    await expect(
      api.createPrompt(createInput("failed", "Failed")),
    ).rejects.toThrow(STORAGE_ERROR);
    expect(notifications).toEqual([]);

    setItem.mockRestore();
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockReturnValue(null);
    await expect(api.listPrompts()).resolves.toEqual([
      expect.objectContaining({ id: first.id, title: "First" }),
      expect.objectContaining({ id: second.id, title: "Second" }),
    ]);
    getItem.mockRestore();
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").prompts,
    ).toHaveLength(2);
    unsubscribe();
  });

  it("rejects failed add-version and restores versions, latest version, and timestamp", async () => {
    const prompt = await api.createPrompt(createInput("versioned", "Versioned"));
    const previousVersions = await api.listPromptVersions(prompt.id);
    const previousPrompt = (await api.listPrompts()).find(
      (candidate) => candidate.id === prompt.id,
    );
    const notifications: boolean[] = [];
    const unsubscribe = api.subscribeFallback((active) => {
      notifications.push(active);
    });
    notifications.length = 0;
    vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));

    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage full");
      });

    await expect(
      api.addPromptVersion({
        promptId: prompt.id,
        body: "non-durable version",
        semanticVersion: "1.1.0",
      }),
    ).rejects.toThrow(STORAGE_ERROR);
    expect(notifications).toEqual([]);

    setItem.mockRestore();
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockReturnValue(null);
    await expect(api.listPromptVersions(prompt.id)).resolves.toEqual(
      previousVersions,
    );
    const restoredPrompt = (await api.listPrompts()).find(
      (candidate) => candidate.id === prompt.id,
    );
    expect(restoredPrompt?.latestVersion).toEqual(
      previousPrompt?.latestVersion,
    );
    expect(restoredPrompt?.updatedAt).toBe(previousPrompt?.updatedAt);
    getItem.mockRestore();
    unsubscribe();
  });

  it("rejects failed deletion and restores the prompt at its original index", async () => {
    const first = await api.createPrompt(createInput("first", "First"));
    const second = await api.createPrompt(createInput("second", "Second"));
    const third = await api.createPrompt(createInput("third", "Third"));
    const notifications: boolean[] = [];
    const unsubscribe = api.subscribeFallback((active) => {
      notifications.push(active);
    });
    notifications.length = 0;

    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage full");
      });

    await expect(api.deletePrompt(second.id)).rejects.toThrow(STORAGE_ERROR);
    expect(notifications).toEqual([]);

    setItem.mockRestore();
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockReturnValue(null);
    await expect(
      api.listPrompts().then((prompts) => prompts.map(({ id }) => id)),
    ).resolves.toEqual([first.id, second.id, third.id]);
    getItem.mockRestore();
    unsubscribe();
  });

  it("retains successful create, add-version, and delete fallback behavior", async () => {
    const notifications: boolean[] = [];
    const unsubscribe = api.subscribeFallback((active) => {
      notifications.push(active);
    });
    notifications.length = 0;

    const prompt = await api.createPrompt(createInput("durable", "Durable"));
    expect(notifications).toEqual([true]);
    notifications.length = 0;

    await api.addPromptVersion({
      promptId: prompt.id,
      body: "durable second version",
      semanticVersion: "1.1.0",
    });
    expect(notifications).toEqual([true]);
    await expect(api.listPromptVersions(prompt.id)).resolves.toHaveLength(2);
    notifications.length = 0;

    await expect(api.deletePrompt(prompt.id)).resolves.toBeUndefined();
    expect(notifications).toEqual([true]);
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").prompts,
    ).toEqual([]);
    unsubscribe();
  });
});
