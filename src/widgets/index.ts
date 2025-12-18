/**
 * Prompt Vault Widgets - Hub Contracts
 *
 * Prompt Vault's desktop UI widgets live under `desktop/src/widgets/`.
 * This folder provides Hub-facing widget contracts and registration.
 */

export { registerPromptVaultWidgetsWithPagesWidgets } from "./register.js";

export const promptVaultQuickAddWidgetMeta = {
  id: "pv:quick-add",
  name: "Quick Add Prompt",
  description: "Add a prompt quickly from Hub.",
};

export const promptVaultRecentWidgetMeta = {
  id: "pv:recent",
  name: "Recent Prompts",
  description: "Shows the most recently created prompts.",
};

export const promptVaultStatsWidgetMeta = {
  id: "pv:stats",
  name: "Prompt Stats",
  description: "Overview of prompt totals and activity.",
};
