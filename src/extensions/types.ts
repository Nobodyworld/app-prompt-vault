import type { Prompt, PromptId, PromptVersion, Tag } from "../domain/models.js";
import type { StructuredLogger } from "../observability/logger.js";
import type { Telemetry } from "../observability/telemetry.js";

export interface PromptVaultPluginContext {
  readonly logger: StructuredLogger;
  readonly telemetry: Telemetry;
}

export interface PromptVaultPlugin {
  readonly name: string;
  setup?(context: PromptVaultPluginContext): void;
  onPromptCreated?(payload: { prompt: Prompt; version: PromptVersion }): void;
  onVersionAdded?(payload: { promptId: PromptId; version: PromptVersion }): void;
  onPromptTagged?(payload: { promptId: PromptId; tags: readonly Tag[] }): void;
  onPromptUntagged?(payload: { promptId: PromptId; labels: readonly string[] }): void;
}
