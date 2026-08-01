import { describe, expect, it, vi } from "vitest";
import type { PromptSummary } from "../../types/prompt";
import {
  DEFAULT_LIBRARY_SORT,
  EMPTY_LIBRARY_FILTERS,
  LIBRARY_SORT_STORAGE_KEY,
  filterAndSortLibraryPrompts,
  filterLibraryPrompts,
  hasActiveLibraryFilters,
  loadLibrarySortPreference,
  parseStoredLibrarySort,
  saveLibrarySortPreference,
} from "../libraryWorkspace";

function prompt(
  id: string,
  overrides: Partial<PromptSummary> = {},
): PromptSummary {
  return {
    id,
    slug: id,
    title: id,
    description: "",
    category: null,
    isFavorite: false,
    rating: null,
    tags: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    latestVersion: {
      id: `${id}-version`,
      semanticVersion: "1.0.0",
      updatedAt: "2026-07-01T00:00:00.000Z",
      body: `${id} body`,
    },
    ...overrides,
  };
}

function ids(prompts: readonly PromptSummary[]): string[] {
  return prompts.map((candidate) => candidate.id);
}

describe("libraryWorkspace", () => {
  it("defaults to favorites first and then most recently updated", () => {
    const prompts = [
      prompt("plain-new", { updatedAt: "2026-07-28T00:00:00.000Z" }),
      prompt("favorite-old", {
        isFavorite: true,
        updatedAt: "2026-07-20T00:00:00.000Z",
      }),
      prompt("favorite-new", {
        isFavorite: true,
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
      prompt("plain-old", { updatedAt: "2026-07-10T00:00:00.000Z" }),
    ];

    expect(
      ids(
        filterAndSortLibraryPrompts(
          prompts,
          EMPTY_LIBRARY_FILTERS,
          DEFAULT_LIBRARY_SORT,
        ),
      ),
    ).toEqual(["favorite-new", "favorite-old", "plain-new", "plain-old"]);
  });

  it("sorts recently updated with normalized title and ID fallbacks", () => {
    const prompts = [
      prompt("z-id", {
        title: "beta",
        updatedAt: "2026-07-28T00:00:00.000Z",
      }),
      prompt("b-id", {
        title: "Alpha",
        updatedAt: "2026-07-28T00:00:00.000Z",
      }),
      prompt("a-id", {
        title: "alpha",
        updatedAt: "2026-07-28T00:00:00.000Z",
      }),
      prompt("old", { updatedAt: "2026-07-20T00:00:00.000Z" }),
    ];

    expect(
      ids(filterAndSortLibraryPrompts(prompts, EMPTY_LIBRARY_FILTERS, "recent")),
    ).toEqual(["a-id", "b-id", "z-id", "old"]);
  });

  it("sorts mixed-case and empty titles consistently", () => {
    const prompts = [
      prompt("zulu", { title: "zulu" }),
      prompt("empty-b", { title: "   " }),
      prompt("alpha-b", { title: "alpha" }),
      prompt("empty-a", { title: "" }),
      prompt("alpha-a", { title: "Alpha" }),
    ];

    expect(
      ids(filterAndSortLibraryPrompts(prompts, EMPTY_LIBRARY_FILTERS, "title")),
    ).toEqual(["alpha-a", "alpha-b", "empty-a", "empty-b", "zulu"]);
  });

  it("sorts ratings high-to-low with unrated prompts last", () => {
    const prompts = [
      prompt("unrated-null", { rating: null, title: "Alpha" }),
      prompt("rated-three", { rating: 3 }),
      prompt("unrated-missing"),
      prompt("rated-five-b", { rating: 5, title: "Beta" }),
      prompt("rated-five-a", { rating: 5, title: "alpha" }),
    ];

    expect(
      ids(filterAndSortLibraryPrompts(prompts, EMPTY_LIBRARY_FILTERS, "rating")),
    ).toEqual([
      "rated-five-a",
      "rated-five-b",
      "rated-three",
      "unrated-null",
      "unrated-missing",
    ]);
  });

  it("uses prompt ID as the final deterministic tie-breaker", () => {
    const prompts = [
      prompt("id-c", { title: "Same" }),
      prompt("id-a", { title: "same" }),
      prompt("id-b", { title: " SAME " }),
    ];

    expect(
      ids(filterAndSortLibraryPrompts(prompts, EMPTY_LIBRARY_FILTERS, "title")),
    ).toEqual(["id-a", "id-b", "id-c"]);
  });

  it("places invalid timestamps after valid timestamps deterministically", () => {
    const prompts = [
      prompt("invalid-z", { title: "Zulu", updatedAt: "not-a-date" }),
      prompt("valid", { updatedAt: "2026-07-20T00:00:00.000Z" }),
      prompt("invalid-a", { title: "Alpha", updatedAt: "" }),
    ];

    expect(
      ids(filterAndSortLibraryPrompts(prompts, EMPTY_LIBRARY_FILTERS, "recent")),
    ).toEqual(["valid", "invalid-a", "invalid-z"]);
  });

  it("combines query, favorite, tag, and category filters before sorting", () => {
    const prompts = [
      prompt("match", {
        title: "Weekly research brief",
        category: "Work",
        tags: ["Reporting", "Client"],
        isFavorite: true,
      }),
      prompt("not-favorite", {
        title: "Weekly research brief",
        category: "Work",
        tags: ["Reporting"],
      }),
      prompt("wrong-tag", {
        title: "Weekly research brief",
        category: "Work",
        tags: ["Writing"],
        isFavorite: true,
      }),
      prompt("wrong-category", {
        title: "Weekly research brief",
        category: "Personal",
        tags: ["Reporting"],
        isFavorite: true,
      }),
      prompt("wrong-query", {
        title: "Daily note",
        category: "Work",
        tags: ["Reporting"],
        isFavorite: true,
      }),
    ];

    const result = filterAndSortLibraryPrompts(
      prompts,
      {
        query: "RESEARCH",
        tag: "reporting",
        category: "work",
        favoritesOnly: true,
      },
      "title",
    );

    expect(ids(result)).toEqual(["match"]);
  });

  it("recognizes reset filters and restores the full result set", () => {
    const prompts = [prompt("one"), prompt("two", { isFavorite: true })];
    const filtered = filterLibraryPrompts(prompts, {
      ...EMPTY_LIBRARY_FILTERS,
      favoritesOnly: true,
    });

    expect(hasActiveLibraryFilters({ ...EMPTY_LIBRARY_FILTERS })).toBe(false);
    expect(hasActiveLibraryFilters({ ...EMPTY_LIBRARY_FILTERS, query: "one" }))
      .toBe(true);
    expect(ids(filtered)).toEqual(["two"]);
    expect(ids(filterLibraryPrompts(prompts, EMPTY_LIBRARY_FILTERS))).toEqual([
      "one",
      "two",
    ]);
  });

  it("never mutates the persistence array while filtering and sorting", () => {
    const prompts = [
      prompt("second", { title: "Beta" }),
      prompt("first", { title: "Alpha" }),
    ];
    const snapshot = [...prompts];

    const sorted = filterAndSortLibraryPrompts(
      prompts,
      EMPTY_LIBRARY_FILTERS,
      "title",
    );

    expect(sorted).not.toBe(prompts);
    expect(prompts).toEqual(snapshot);
    expect(ids(prompts)).toEqual(["second", "first"]);
  });

  it("safely parses only known stored sort values", () => {
    expect(parseStoredLibrarySort('{"sort":"recent"}')).toBe("recent");
    expect(parseStoredLibrarySort('{"sort":"unknown"}')).toBe(
      DEFAULT_LIBRARY_SORT,
    );
    expect(parseStoredLibrarySort('"title"')).toBe(DEFAULT_LIBRARY_SORT);
    expect(parseStoredLibrarySort("{broken")).toBe(DEFAULT_LIBRARY_SORT);
    expect(parseStoredLibrarySort(null)).toBe(DEFAULT_LIBRARY_SORT);
  });

  it("loads and saves only the minimal versioned sort preference", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };

    saveLibrarySortPreference("rating", storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      LIBRARY_SORT_STORAGE_KEY,
      '{"sort":"rating"}',
    );
    expect(loadLibrarySortPreference(storage)).toBe("rating");
  });

  it("falls back safely when preference storage is unavailable or throws", () => {
    const failingStorage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };

    expect(loadLibrarySortPreference(undefined)).toBe(DEFAULT_LIBRARY_SORT);
    expect(loadLibrarySortPreference(failingStorage)).toBe(DEFAULT_LIBRARY_SORT);
    expect(() => saveLibrarySortPreference("title", failingStorage)).not.toThrow();
  });
});
