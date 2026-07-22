// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PromptSummary } from "../../types/prompt";
import { EditPromptPage } from "../EditPromptPage";

const api = vi.hoisted(() => ({
  addPromptVersion: vi.fn(),
  getPromptById: vi.fn(),
  listPromptVersions: vi.fn(),
  updatePrompt: vi.fn(),
}));

vi.mock("../../services/promptApi", () => api);
vi.mock("../../lib/tauri", () => ({ isTauriAvailable: () => true }));

const prompt: PromptSummary = {
  id: "prompt-1",
  slug: "durable-edit",
  title: "Durable edit",
  category: "Research",
  isFavorite: false,
  rating: 3,
  tags: ["alpha"],
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
  latestVersion: {
    id: "version-1",
    semanticVersion: "1.2.3",
    updatedAt: "2026-07-21T00:00:00.000Z",
    body: "Original prompt body",
  },
};

function renderDirectEditRoute(): void {
  render(
    <MemoryRouter initialEntries={["/edit/prompt-1"]}>
      <Routes>
        <Route path="/edit/:id" element={<EditPromptPage />} />
        <Route path="/" element={<div>Library destination</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitForLoadedPrompt(): Promise<void> {
  await screen.findByRole("heading", { name: "Edit prompt" });
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveValue("Durable edit"),
  );
}

describe("EditPromptPage", () => {
  beforeEach(() => {
    api.addPromptVersion.mockReset().mockResolvedValue({});
    api.getPromptById.mockReset().mockResolvedValue(prompt);
    api.listPromptVersions.mockReset().mockResolvedValue([prompt.latestVersion]);
    api.updatePrompt.mockReset().mockResolvedValue(prompt);
  });

  afterEach(() => cleanup());

  it("recovers a direct or refreshed edit route without router state", async () => {
    let resolvePrompt: (value: PromptSummary) => void = () => undefined;
    api.getPromptById.mockReturnValue(
      new Promise<PromptSummary>((resolve) => {
        resolvePrompt = resolve;
      }),
    );

    renderDirectEditRoute();
    expect(screen.getByText("Loading prompt…")).toBeVisible();
    resolvePrompt(prompt);

    await waitForLoadedPrompt();
    expect(api.getPromptById).toHaveBeenCalledWith("prompt-1");
    expect(screen.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
      "Durable edit",
    );
    expect(screen.getByRole("textbox", { name: "Tags", exact: true })).toHaveValue(
      "alpha",
    );
  });

  it("shows a useful not-found state with a Library action", async () => {
    api.getPromptById.mockResolvedValue(undefined);
    renderDirectEditRoute();

    expect(
      await screen.findByRole("heading", { name: "Prompt not found" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Return to Library" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("edits and de-duplicates tags while clearing category without adding a version", async () => {
    renderDirectEditRoute();
    await waitForLoadedPrompt();

    fireEvent.change(screen.getByRole("textbox", { name: "Tags", exact: true }), {
      target: { value: "alpha, beta, alpha" },
    });
    fireEvent.click(screen.getByText("Version and organization"));
    fireEvent.change(screen.getByRole("textbox", { name: "Category" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(api.updatePrompt).toHaveBeenCalledWith({
        id: "prompt-1",
        category: null,
        tags: ["alpha", "beta"],
      }),
    );
    expect(api.addPromptVersion).not.toHaveBeenCalled();
  });

  it("adds exactly one patch version when the prompt body changes", async () => {
    renderDirectEditRoute();
    await waitForLoadedPrompt();

    fireEvent.change(screen.getByRole("textbox", { name: "Prompt", exact: true }), {
      target: { value: "Updated prompt body" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(api.addPromptVersion).toHaveBeenCalledWith({
        promptId: "prompt-1",
        body: "Updated prompt body",
        semanticVersion: "1.2.4",
        changelog: undefined,
      }),
    );
    expect(api.addPromptVersion).toHaveBeenCalledTimes(1);
    expect(api.updatePrompt).not.toHaveBeenCalled();
  });

  it("does not write when nothing changed", async () => {
    renderDirectEditRoute();
    await waitForLoadedPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("No changes to save.")).toBeVisible();
    expect(api.updatePrompt).not.toHaveBeenCalled();
    expect(api.addPromptVersion).not.toHaveBeenCalled();
  });
});
