import { beforeEach, describe, expect, it, vi } from "vitest";
import { promptVaultToolDefinitions, registerPromptVaultTools } from "../src/tools/index.js";

const registerToolMock = vi.hoisted(() => vi.fn());

vi.mock("@nw/orchestrator-sdk", () => ({
  registerTool: registerToolMock,
}));

describe("registerPromptVaultTools", () => {
  beforeEach(() => {
    registerToolMock.mockClear();
  });

  it("registers every Prompt Vault tool definition with the orchestrator", () => {
    registerPromptVaultTools();

    expect(registerToolMock).toHaveBeenCalledTimes(promptVaultToolDefinitions.length);

    const registeredNames = new Set(registerToolMock.mock.calls.map((call) => call[0].name));
    const definitionNames = new Set(promptVaultToolDefinitions.map((def) => def.name));
    expect(registeredNames).toEqual(definitionNames);
  });
});
