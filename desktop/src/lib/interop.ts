import type { PromptSummary } from "../types/prompt";

/**
 * Payload shape that matches the Buttons switchboard/button schema
 * without taking a hard dependency on that package. This lets users
 * copy/paste into the Buttons app to spin up a floating phrase panel.
 */
export interface ButtonsSwitchboardPayload {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  context: { type: "global" };
  triggers: Array<{ type: "palette" } | { type: "inline"; command: string }>;
  isEnabled: boolean;
  placement: {
    mode: "floating" | "window";
    anchor: "screen" | "window";
    position: { x: number; y: number; unit: "px" | "percent" };
    size: { width: number; height: number; unit: "px" | "percent" };
    opacity?: number;
    alwaysOnTop?: boolean;
    transparent?: boolean;
  };
  switchboard: {
    tileSize: "xs" | "sm" | "md" | "lg";
    allowSearch?: boolean;
    phrases: Array<{
      id: string;
      label: string;
      value: string;
      valueType?: "text" | "pv_prompt_id";
    }>;
  };
}

/**
 * Draft payload that the planner app can import as a bucket with tasks.
 */
export interface PlannerBucketDraft {
  name: string;
  source: "prompt-vault";
  tags: string[];
  tasks: Array<{
    title: string;
    note?: string;
    tags: string[];
  }>;
}

export function buildButtonsSwitchboardPayload(
  prompts: PromptSummary[],
  limit = 8,
): ButtonsSwitchboardPayload | null {
  const phrases = prompts
    .filter((p) => Boolean(p.id) && Boolean(p.latestVersion?.body))
    .slice(0, limit)
    .map((p, idx) => ({
      id: p.id || `pv-${idx}`,
      label: p.title || p.slug,
      value: p.id || `pv-${idx}`,
      valueType: "pv_prompt_id" as const,
    }));

  if (phrases.length === 0) return null;

  return {
    id: `pv-switchboard-${Date.now()}`,
    title: "Prompt Vault x Buttons",
    description:
      "Quick-phrase switchboard generated from Prompt Vault search results.",
    icon: "keyboard",
    context: { type: "global" },
    triggers: [{ type: "palette" }],
    isEnabled: true,
    placement: {
      mode: "floating",
      anchor: "screen",
      position: { x: 16, y: 18, unit: "percent" },
      size: { width: 360, height: 280, unit: "px" },
      opacity: 0.9,
      alwaysOnTop: true,
      transparent: true,
    },
    switchboard: {
      tileSize: "sm",
      allowSearch: true,
      phrases,
    },
  };
}

export function buildPlannerBucketDraft(
  prompts: PromptSummary[],
  limit = 6,
): PlannerBucketDraft | null {
  const tasks = prompts.slice(0, limit).map((p) => ({
    title: `Use: ${p.title}`,
    note: p.latestVersion?.body?.slice(0, 360),
    tags: ["prompt-vault", ...(p.tags ?? [])],
  }));

  if (tasks.length === 0) return null;

  return {
    name: "Prompt Vault Picks",
    source: "prompt-vault",
    tags: ["prompt-vault", "import"],
    tasks,
  };
}
