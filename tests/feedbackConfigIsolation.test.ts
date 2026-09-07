import type { ConfigEnv, UserConfigFnObject } from "vite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import configuration from "../desktop/vite.config";

const pilot = vi.hoisted(() => vi.fn(() => {
  throw new Error("pilot factory reached");
}));
vi.mock("../desktop/vite.feedback-layer-pilot", () => ({ feedbackLayerPilot: pilot }));
vi.mock("@vitejs/plugin-react", () => ({ default: () => ({ name: "test-react" }) }));

const configure = configuration as UserConfigFnObject;
beforeEach(() => pilot.mockClear());

describe("Feedback Layer configuration isolation", () => {
  for (const environment of [
    { command: "build", mode: "production" },
    { command: "build", mode: "development" },
    { command: "serve", mode: "production", isPreview: true },
  ] satisfies ConfigEnv[]) {
    it(`never constructs the pilot for ${JSON.stringify(environment)}`, () => {
      expect(() => configure(environment)).not.toThrow();
      expect(pilot).not.toHaveBeenCalled();
    });
  }

  it("still constructs and validates the enabled development integration", () => {
    expect(() => configure({ command: "serve", mode: "development", isPreview: false }))
      .toThrow("pilot factory reached");
    expect(pilot).toHaveBeenCalledOnce();
  });
});
