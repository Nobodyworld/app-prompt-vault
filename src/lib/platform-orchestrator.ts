// App-local adapter for orchestrator SDK imports.

import * as orchestratorSdk from "@nw/orchestrator-sdk";

export const registerTool =
  (orchestratorSdk as any).registerTool ??
  (orchestratorSdk as any).default?.registerTool;

export type {
  ToolDefinition,
  ToolHandler,
  ToolResult,
  ToolContext,
} from "@nw/orchestrator-sdk";
