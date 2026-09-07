// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { Layout } from "../desktop/src/components/Layout";

vi.mock("../desktop/src/lib/tauri", () => ({ isTauriAvailable: () => false }));
vi.mock("../desktop/src/services/promptApi", () => ({
  isUsingFallback: () => false,
  subscribeFallback: () => () => {},
}));
afterEach(cleanup);

it("protects all routed values and live announcements without hiding them from accessibility", () => {
  const announcement = React.createElement("p", { "aria-live": "polite", className: "visually-hidden" }, "Active prompt: synthetic private title");
  render(React.createElement(MemoryRouter, null,
    React.createElement(Routes, null,
      React.createElement(Route, { element: React.createElement(Layout) },
        React.createElement(Route, { index: true, element: announcement })))));
  const live = screen.getByText("Active prompt: synthetic private title");
  const workspace = screen.getByRole("main");
  expect(workspace.getAttribute("data-feedback-id")).toBe("prompt-vault.workspace");
  expect(workspace.getAttribute("data-feedback-private")).toBe("true");
  expect(workspace.getAttribute("data-feedback-redact")).toBe("true");
  expect(live.closest("[data-feedback-private]")).toBe(workspace);
  expect(live.getAttribute("aria-live")).toBe("polite");
  expect(live.closest('[aria-hidden="true"], [hidden]')).toBeNull();
  expect(screen.getByRole("navigation", { name: "Primary navigation" }).closest("[data-feedback-private]")).toBeNull();
});
