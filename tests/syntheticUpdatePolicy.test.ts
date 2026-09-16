import { describe, expect, it } from "vitest";
import { bootstrapVersionAllowed } from "../scripts/synthetic-update/policy.js";

describe("synthetic recovery bootstrap policy", () => {
  it("keeps the initial baseline install pinned to 1.0.0", () => {
    expect(bootstrapVersionAllowed("install-old", "1.0.0")).toBe(true);
    expect(bootstrapVersionAllowed("install-old", "1.1.0")).toBe(false);
    expect(bootstrapVersionAllowed("install-old", "1.3.0")).toBe(false);
  });

  it("allows recovery to reinstall the exact retained prior accepted version", () => {
    expect(bootstrapVersionAllowed("recovery-install", "1.0.0")).toBe(true);
    expect(bootstrapVersionAllowed("recovery-install", "1.1.0")).toBe(true);
    expect(bootstrapVersionAllowed("recovery-install", "1.3.0")).toBe(true);
  });
});
