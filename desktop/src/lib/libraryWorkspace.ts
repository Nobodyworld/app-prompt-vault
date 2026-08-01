import type { PromptSummary } from "../types/prompt";

export const LIBRARY_SORT_STORAGE_KEY = "prompt-vault:library-sort:v1";

export const LIBRARY_SORT_OPTIONS = [
  { value: "favorites", label: "Favorites first" },
  { value: "recent", label: "Recently updated" },
  { value: "title", label: "Title A–Z" },
  { value: "rating", label: "Rating high-to-low" },
] as const;

export type LibrarySortMode = (typeof LIBRARY_SORT_OPTIONS)[number]["value"];

export interface LibraryFilters {
  readonly query: string;
  readonly tag: string;
  readonly category: string;
  readonly favoritesOnly: boolean;
}

export const DEFAULT_LIBRARY_SORT: LibrarySortMode = "favorites";

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  query: "",
  tag: "",
  category: "",
  favoritesOnly: false,
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

function normalizedTitle(prompt: PromptSummary): string {
  return normalize(prompt.title) || "untitled prompt";
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareTitleThenId(
  left: PromptSummary,
  right: PromptSummary,
): number {
  return (
    compareText(normalizedTitle(left), normalizedTitle(right)) ||
    compareText(String(left.id), String(right.id))
  );
}

function timestampValue(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareRecentlyUpdated(
  left: PromptSummary,
  right: PromptSummary,
): number {
  return (
    timestampValue(right.updatedAt) - timestampValue(left.updatedAt) ||
    compareTitleThenId(left, right)
  );
}

function isRated(prompt: PromptSummary): boolean {
  return typeof prompt.rating === "number" && Number.isFinite(prompt.rating);
}

export function compareLibraryPrompts(
  left: PromptSummary,
  right: PromptSummary,
  mode: LibrarySortMode,
): number {
  if (mode === "favorites") {
    const favoriteDifference =
      Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite));
    return favoriteDifference || compareRecentlyUpdated(left, right);
  }

  if (mode === "recent") {
    return compareRecentlyUpdated(left, right);
  }

  if (mode === "rating") {
    const leftRated = isRated(left);
    const rightRated = isRated(right);
    if (leftRated !== rightRated) return leftRated ? -1 : 1;
    if (leftRated && rightRated) {
      const ratingDifference = (right.rating ?? 0) - (left.rating ?? 0);
      if (ratingDifference) return ratingDifference;
    }
  }

  return compareTitleThenId(left, right);
}

export function filterLibraryPrompts(
  prompts: readonly PromptSummary[],
  filters: LibraryFilters,
): PromptSummary[] {
  const query = normalize(filters.query);
  const tag = normalize(filters.tag);
  const category = normalize(filters.category);

  return prompts.filter((prompt) => {
    if (filters.favoritesOnly && !prompt.isFavorite) return false;
    if (tag && !prompt.tags.some((candidate) => normalize(candidate) === tag)) {
      return false;
    }
    if (category && normalize(prompt.category) !== category) return false;
    if (!query) return true;

    return [
      prompt.title,
      prompt.description,
      prompt.category,
      prompt.latestVersion?.body,
      ...prompt.tags,
    ].some((value) => normalize(value).includes(query));
  });
}

export function filterAndSortLibraryPrompts(
  prompts: readonly PromptSummary[],
  filters: LibraryFilters,
  sortMode: LibrarySortMode,
): PromptSummary[] {
  return filterLibraryPrompts(prompts, filters).toSorted((left, right) =>
    compareLibraryPrompts(left, right, sortMode),
  );
}

export function hasActiveLibraryFilters(filters: LibraryFilters): boolean {
  return Boolean(
    filters.query.trim() ||
      filters.tag.trim() ||
      filters.category.trim() ||
      filters.favoritesOnly,
  );
}

export function isLibrarySortMode(value: unknown): value is LibrarySortMode {
  return LIBRARY_SORT_OPTIONS.some((option) => option.value === value);
}

export function parseStoredLibrarySort(
  serialized: string | null | undefined,
): LibrarySortMode {
  if (!serialized) return DEFAULT_LIBRARY_SORT;

  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "sort" in parsed &&
      isLibrarySortMode((parsed as { sort?: unknown }).sort)
    ) {
      return (parsed as { sort: LibrarySortMode }).sort;
    }
  } catch {
    return DEFAULT_LIBRARY_SORT;
  }

  return DEFAULT_LIBRARY_SORT;
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadLibrarySortPreference(
  storage: StorageLike | undefined = browserStorage(),
): LibrarySortMode {
  if (!storage) return DEFAULT_LIBRARY_SORT;
  try {
    return parseStoredLibrarySort(storage.getItem(LIBRARY_SORT_STORAGE_KEY));
  } catch {
    return DEFAULT_LIBRARY_SORT;
  }
}

export function saveLibrarySortPreference(
  sortMode: LibrarySortMode,
  storage: StorageLike | undefined = browserStorage(),
): void {
  if (!storage || !isLibrarySortMode(sortMode)) return;
  try {
    storage.setItem(
      LIBRARY_SORT_STORAGE_KEY,
      JSON.stringify({ sort: sortMode }),
    );
  } catch {
    // Sorting remains usable for this session when storage is unavailable.
  }
}
