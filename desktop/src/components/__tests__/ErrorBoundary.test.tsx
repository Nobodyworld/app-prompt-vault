// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import ErrorBoundary from "../ErrorBoundary";

function ProblemChild(): React.ReactElement {
  throw new Error("boom");
}

describe("ErrorBoundary (minimal)", () => {
  it("renders fallback when child throws", () => {
    expect(() => {
      render(
        <ErrorBoundary>
          <ProblemChild />
        </ErrorBoundary>
      );
    }).not.toThrow();
  });
});
