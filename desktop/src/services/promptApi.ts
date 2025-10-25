import type { CreatePromptInput, PromptSummary } from "../types/prompt";
import { invokeOrThrow } from "../lib/tauri";

export async function listPrompts(): Promise<PromptSummary[]> {
  const response = await invokeOrThrow<{ prompts: PromptSummary[] }>("list_prompts");
  return response.prompts;
}

export async function createPrompt(input: CreatePromptInput): Promise<PromptSummary> {
  const response = await invokeOrThrow<{ prompt: PromptSummary }>("create_prompt", { payload: input });
  return response.prompt;
}
