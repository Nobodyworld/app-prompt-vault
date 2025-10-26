import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import ErrorBoundary from "../ErrorBoundary";

function ProblemChild(): React.ReactElement {
  throw new Error("boom");
}

describe("ErrorBoundary (minimal)", () => {
  it("renders fallback when child throws", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      const root = createRoot(container);
      root.render(
        <ErrorBoundary>
          <ProblemChild />
        </ErrorBoundary>
      );
    });

    // The fallback contains the text
    if (!container.textContent?.includes("Something went wrong")) {
      throw new Error("Fallback not rendered");
    }
  });
});
