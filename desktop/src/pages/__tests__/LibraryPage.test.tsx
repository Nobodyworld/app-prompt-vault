// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import type { PromptSummary } from "../../types/prompt";
import { LIBRARY_SORT_STORAGE_KEY } from "../../lib/libraryWorkspace";
import { LibraryPage } from "../LibraryPage";

const api = vi.hoisted(() => ({
  listPrompts: vi.fn(),
  updatePrompt: vi.fn(),
}));

const clipboard = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(),
}));

const toast = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

vi.mock("../../services/promptApi", () => api);
vi.mock("../../lib/clipboard", () => clipboard);
vi.mock("../../components/Toast", () => ({
  useToast: () => toast,
}));

function prompt(
  id: string,
  overrides: Partial<PromptSummary> = {},
): PromptSummary {
  return {
    id,
    slug: id,
    title: id,
    description: `${id} description`,
    category: "Work",
    isFavorite: false,
    rating: null,
    tags: ["daily"],
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

const alpha = prompt("alpha", {
  title: "Alpha brief",
  rating: 5,
  tags: ["daily", "reporting"],
  updatedAt: "2026-07-28T00:00:00.000Z",
});
const bravo = prompt("bravo", {
  title: "Bravo favorite",
  category: "Research",
  isFavorite: true,
  rating: 3,
  tags: ["daily", "research"],
  updatedAt: "2026-07-20T00:00:00.000Z",
});
const charlie = prompt("charlie", {
  title: "Charlie note",
  category: "Personal",
  tags: ["notes"],
  updatedAt: "2026-07-25T00:00:00.000Z",
});
const prompts = [alpha, bravo, charlie];

function renderLibrary(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/create" element={<h2>New prompt destination</h2>} />
        <Route path="/edit/:id" element={<h2>Edit prompt destination</h2>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLoadedLibrary(): Promise<void> {
  renderLibrary();
  await screen.findByText("3 prompts");
}

function rowIds(): Array<string | null> {
  return screen
    .getAllByTestId("prompt-row")
    .map((row) => row.getAttribute("data-prompt-id"));
}

describe("LibraryPage", () => {
  beforeEach(() => {
    localStorage.clear();
    api.listPrompts.mockReset().mockResolvedValue(prompts);
    api.updatePrompt
      .mockReset()
      .mockImplementation(
        async ({ id, isFavorite }: { id: string; isFavorite: boolean }) => ({
          ...prompts.find((candidate) => candidate.id === id),
          isFavorite,
        }),
      );
    clipboard.copyTextToClipboard.mockReset().mockResolvedValue(undefined);
    toast.addToast.mockReset();
  });

  afterEach(() => cleanup());

  it("shows loading and then the deterministic default organization", async () => {
    let resolvePrompts: (value: PromptSummary[]) => void = () => undefined;
    api.listPrompts.mockReturnValue(
      new Promise<PromptSummary[]>((resolve) => {
        resolvePrompts = resolve;
      }),
    );

    renderLibrary();
    expect(screen.getByText("Loading your prompts…")).toBeVisible();

    await act(async () => resolvePrompts(prompts));
    await screen.findByText("3 prompts");
    expect(rowIds()).toEqual(["bravo", "alpha", "charlie"]);
  });

  it("surfaces initial load failures and provides a retry action", async () => {
    api.listPrompts
      .mockRejectedValueOnce(new Error("Library database unavailable"))
      .mockResolvedValueOnce(prompts);

    renderLibrary();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Library database unavailable",
    );

    fireEvent.click(screen.getByRole("button", { name: "Try loading again" }));
    expect(await screen.findByText("3 prompts")).toBeVisible();
    expect(api.listPrompts).toHaveBeenCalledTimes(2);
  });

  it("shows active filters, accurate counts, and resets all filters", async () => {
    await renderLoadedLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    expect(screen.getByLabelText("Active filters")).toHaveTextContent(
      "Favorites",
    );
    expect(screen.getByText("1 of 3 prompts")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "More filters" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Tag" }), {
      target: { value: "research" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
      target: { value: "Research" },
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search prompts" }), {
      target: { value: "Bravo" },
    });

    expect(screen.getByLabelText("Active filters")).toHaveTextContent(
      "Query: Bravo",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));

    expect(screen.queryByLabelText("Active filters")).not.toBeInTheDocument();
    expect(screen.getByText("3 prompts")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search prompts" })).toHaveValue(
      "",
    );
  });

  it("uses a Favorites filter without changing the source result count", async () => {
    await renderLoadedLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));

    expect(rowIds()).toEqual(["bravo"]);
    expect(screen.getByText("1 of 3 prompts")).toBeVisible();
    expect(screen.getByRole("button", { name: "Favorites" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("persists and restores the selected sort preference", async () => {
    const firstRender = renderLibrary();
    await screen.findByText("3 prompts");
    const sort = screen.getByRole("combobox", { name: "Sort" });
    fireEvent.change(sort, { target: { value: "title" } });

    expect(rowIds()).toEqual(["alpha", "bravo", "charlie"]);
    expect(localStorage.getItem(LIBRARY_SORT_STORAGE_KEY)).toBe(
      '{"sort":"title"}',
    );

    firstRender.unmount();
    renderLibrary();
    await screen.findByText("3 prompts");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("title");
  });

  it("optimistically favorites a row and reconciles the persisted result", async () => {
    await renderLoadedLibrary();
    const favoriteButton = screen.getByRole("button", {
      name: "Add Alpha brief to favorites",
    });

    fireEvent.click(favoriteButton);

    expect(api.updatePrompt).toHaveBeenCalledWith({
      id: "alpha",
      isFavorite: true,
    });
    expect(
      await screen.findByRole("button", {
        name: "Remove Alpha brief from favorites",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(toast.addToast).toHaveBeenCalledWith(
      "Added to favorites.",
      "success",
      2200,
    );
  });

  it("rolls favorite state and ordering back after a failed write", async () => {
    api.updatePrompt.mockRejectedValueOnce(new Error("write failed"));
    await renderLoadedLibrary();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Alpha brief to favorites",
      }),
    );

    expect(
      await screen.findByText(
        "Couldn’t update the favorite state for “Alpha brief”. Try again.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Add Alpha brief to favorites",
      }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(rowIds()).toEqual(["bravo", "alpha", "charlie"]);
  });

  it("contains duplicate favorite activation while a write is pending", async () => {
    let resolveUpdate: (value: PromptSummary) => void = () => undefined;
    api.updatePrompt.mockReturnValue(
      new Promise<PromptSummary>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    await renderLoadedLibrary();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Alpha brief to favorites",
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "Remove Alpha brief from favorites",
      }),
    ).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "f" });
    expect(api.updatePrompt).toHaveBeenCalledTimes(1);

    await act(async () =>
      resolveUpdate({
        ...alpha,
        isFavorite: true,
        updatedAt: "2026-07-29T00:00:00.000Z",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Remove Alpha brief from favorites",
        }),
      ).toBeEnabled(),
    );
  });

  it("moves a newly favorited row while retaining it as the active prompt", async () => {
    await renderLoadedLibrary();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Alpha brief to favorites",
      }),
    );

    await waitFor(() => expect(rowIds()[0]).toBe("alpha"));
    expect(screen.getAllByTestId("prompt-row")[0]).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("reports copy success, copy failure, and empty-body attempts", async () => {
    await renderLoadedLibrary();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt Alpha brief" }),
    );
    expect(clipboard.copyTextToClipboard).toHaveBeenCalledWith("alpha body");
    expect(await screen.findByText("Copied")).toBeVisible();

    clipboard.copyTextToClipboard.mockRejectedValueOnce(
      new Error("clipboard blocked"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt Charlie note" }),
    );
    expect(
      await screen.findByText(
        "Couldn’t copy “Charlie note”. Check clipboard permissions and try again.",
      ),
    ).toBeVisible();

    cleanup();
    api.listPrompts.mockResolvedValueOnce([
      prompt("empty", {
        title: "Empty body",
        latestVersion: {
          id: "empty-version",
          semanticVersion: "1.0.0",
          updatedAt: "2026-07-01T00:00:00.000Z",
          body: "   ",
        },
      }),
    ]);
    renderLibrary();
    await screen.findByText("1 prompt");
    fireEvent.click(
      screen.getByRole("button", { name: "Copy prompt Empty body" }),
    );
    expect(
      screen.getByText(
        "“Empty body” has no copyable prompt text. Open Edit to add content.",
      ),
    ).toBeVisible();
  });

  it("recovers the active prompt by ID when filters change", async () => {
    await renderLoadedLibrary();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search prompts" }), {
      target: { value: "Charlie" },
    });

    const row = await screen.findByTestId("prompt-row");
    expect(row).toHaveAttribute("data-prompt-id", "charlie");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Active prompt: Charlie note")).toBeInTheDocument();
  });

  it("moves the active row with Up and Down and copies with Enter", async () => {
    await renderLoadedLibrary();
    expect(screen.getAllByTestId("prompt-row")[0]).toHaveAttribute(
      "data-prompt-id",
      "bravo",
    );

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(screen.getAllByTestId("prompt-row")[1]).toHaveAttribute(
      "aria-current",
      "true",
    );
    fireEvent.keyDown(document.body, { key: "Enter" });

    expect(clipboard.copyTextToClipboard).toHaveBeenCalledWith("alpha body");
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(screen.getAllByTestId("prompt-row")[0]).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("edits with E and favorites with F for the active row", async () => {
    await renderLoadedLibrary();
    await waitFor(() =>
      expect(screen.getAllByTestId("prompt-row")[0]).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );
    fireEvent.keyDown(document.body, { key: "f" });
    await waitFor(() =>
      expect(api.updatePrompt).toHaveBeenCalledWith({
        id: "bravo",
        isFavorite: false,
      }),
    );
    fireEvent.keyDown(document.body, { key: "e" });
    expect(
      await screen.findByRole("heading", { name: "Edit prompt destination" }),
    ).toBeVisible();
  });

  it("does not capture row shortcuts from editable or interactive controls", async () => {
    await renderLoadedLibrary();
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(textarea, editable);

    const targets: HTMLElement[] = [
      screen.getByRole("searchbox", { name: "Search prompts" }),
      screen.getByRole("combobox", { name: "Sort" }),
      screen.getByRole("button", { name: "Favorites" }),
      textarea,
      editable,
    ];

    for (const target of targets) {
      fireEvent.keyDown(target, { key: "f" });
      fireEvent.keyDown(target, { key: "Enter" });
      fireEvent.keyDown(target, { key: "ArrowDown" });
    }

    expect(api.updatePrompt).not.toHaveBeenCalled();
    expect(clipboard.copyTextToClipboard).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Edit prompt destination" }),
    ).not.toBeInTheDocument();

    textarea.remove();
    editable.remove();
  });

  it("keeps native row controls independently tabbable and conventional", async () => {
    await renderLoadedLibrary();
    const alphaRow = screen
      .getAllByTestId("prompt-row")
      .find((row) => row.getAttribute("data-prompt-id") === "alpha");
    expect(alphaRow).toBeDefined();

    const row = within(alphaRow as HTMLElement);
    const copyButton = row.getByRole("button", {
      name: "Copy prompt Alpha brief",
    });
    const favoriteButton = row.getByRole("button", {
      name: "Add Alpha brief to favorites",
    });
    const editButton = row.getByRole("button", {
      name: "Edit prompt Alpha brief",
    });

    expect(copyButton).not.toHaveAttribute("tabindex", "-1");
    expect(favoriteButton).not.toHaveAttribute("tabindex", "-1");
    expect(editButton).not.toHaveAttribute("tabindex", "-1");
  });
});
