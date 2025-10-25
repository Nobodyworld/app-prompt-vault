import type { AddPromptVersionInput, CreatePromptInput, PromptSummary, PromptVersionSummary } from "../types/prompt";
import { invokeOrThrow } from "../lib/tauri";

export async function listPrompts(): Promise<PromptSummary[]> {
  const response = await invokeOrThrow<{ prompts: PromptSummary[] }>("list_prompts");
  return response.prompts;
}

export async function createPrompt(input: CreatePromptInput): Promise<PromptSummary> {
  const response = await invokeOrThrow<{ prompt: PromptSummary }>("create_prompt", { payload: input });
  return response.prompt;
}

export async function addPromptVersion(input: AddPromptVersionInput): Promise<PromptVersionSummary> {
  const response = await invokeOrThrow<{ version: PromptVersionSummary }>("add_prompt_version", { payload: input });
  return response.version;
}
