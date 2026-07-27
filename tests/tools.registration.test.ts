import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetToolsForTests,
  getAllTools,
} from "../src/lib/platform-orchestrator.js";
import {
  promptVaultToolDefinitions,
  registerPromptVaultTools,
} from "../src/tools/index.js";

describe("registerPromptVaultTools", () => {
  beforeEach(() => {
    __resetToolsForTests();
  });

  it("registers every Prompt Vault tool definition in the app-local registry", () => {
    registerPromptVaultTools();

    const registered = getAllTools();
    expect(registered).toHaveLength(promptVaultToolDefinitions.length);

    const registeredNames = new Set(
      registered.map((tool) => tool.definition.name),
    );
    const definitionNames = new Set(
      promptVaultToolDefinitions.map((definition) => definition.name),
    );
    expect(registeredNames).toEqual(definitionNames);
  });
});
