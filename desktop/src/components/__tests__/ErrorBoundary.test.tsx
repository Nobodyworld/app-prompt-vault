import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import ErrorBoundary from "../ErrorBoundary";

function ProblemChild() {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("renders fallback when child throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
    consoleError.mockRestore();
  });
});
