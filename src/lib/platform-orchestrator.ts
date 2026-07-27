export type JSONSchema = Record<string, unknown>;

export interface ToolParameter {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema | ToolParameter[];
  returns?: JSONSchema | Record<string, unknown>;
  category?: string;
  source?: string;
  ontologyEntities?: string[];
  requiresConfirmation?: boolean;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
  validationErrors?: string[];
  resourceUsage?: unknown;
}

export interface ToolContext {
  projectTagId?: string | null;
  projectSlug?: string | null;
  jobId?: string | null;
  workflowId?: string;
  runId?: string;
  executionMode?: "safe" | "auto" | "supervised";
  [key: string]: unknown;
}

export type ToolHandler = (
  args: unknown,
  ctx: ToolContext,
) => Promise<ToolResult>;

export interface RegisteredTool {
  id: string;
  definition: ToolDefinition;
  handler: ToolHandler;
}

const toolRegistry = new Map<string, RegisteredTool>();

export function registerTool(
  definitionOrTool:
    | ToolDefinition
    | (ToolDefinition & { handler: ToolHandler }),
  handler?: ToolHandler,
): void {
  const embeddedHandler =
    "handler" in definitionOrTool &&
    typeof definitionOrTool.handler === "function"
      ? definitionOrTool.handler
      : undefined;
  const toolHandler = embeddedHandler ?? handler;

  if (!definitionOrTool.name?.trim()) {
    throw new Error("Tool name is required");
  }
  if (!definitionOrTool.description?.trim()) {
    throw new Error(`Tool description is required for ${definitionOrTool.name}`);
  }
  if (!definitionOrTool.parameters) {
    throw new Error(`Tool parameters are required for ${definitionOrTool.name}`);
  }
  if (!toolHandler) {
    throw new Error(
      `registerTool called without handler for ${definitionOrTool.name}`,
    );
  }

  const definitionWithOptionalHandler = {
    ...definitionOrTool,
  } as ToolDefinition & { handler?: ToolHandler };
  delete definitionWithOptionalHandler.handler;
  const definition: ToolDefinition = definitionWithOptionalHandler;

  toolRegistry.set(definition.name, {
    id: definition.name,
    definition,
    handler: toolHandler,
  });
}

export function getAllTools(): RegisteredTool[] {
  return [...toolRegistry.values()];
}

export function getTool(name: string): RegisteredTool | undefined {
  return toolRegistry.get(name);
}

export async function invokeTool(
  name: string,
  args: unknown,
  ctx: ToolContext = {},
): Promise<{ success: boolean; result?: ToolResult; error?: string }> {
  const tool = toolRegistry.get(name);
  if (!tool) return { success: false, error: `Tool not found: ${name}` };

  try {
    return { success: true, result: await tool.handler(args, ctx) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function __resetToolsForTests(): void {
  toolRegistry.clear();
}
