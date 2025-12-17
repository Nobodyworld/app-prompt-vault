/**
 * Prompt Vault Hub Widgets
 *
 * This module exports widget components that can be embedded in the Hub.
 * Each widget is designed to work standalone with its own data fetching.
 */

export { PromptQuickAddWidget } from "./PromptQuickAddWidget";
export { RecentPromptsWidget } from "./RecentPromptsWidget";
export { PromptStatsWidget } from "./PromptStatsWidget";

// Widget metadata for registration with the Hub
export const widgetManifest = {
  "pv:quick-add": {
    name: "Quick Add Prompt",
    description: "Quickly capture a new prompt without leaving the Hub",
    defaultSize: { width: 2, height: 2 },
    minSize: { width: 2, height: 2 },
    maxSize: { width: 4, height: 3 },
  },
  "pv:recent": {
    name: "Recent Prompts",
    description: "View and access recently created or modified prompts",
    defaultSize: { width: 2, height: 3 },
    minSize: { width: 2, height: 2 },
    maxSize: { width: 4, height: 6 },
  },
  "pv:stats": {
    name: "Prompt Stats",
    description: "Overview of your prompt vault statistics",
    defaultSize: { width: 2, height: 2 },
    minSize: { width: 1, height: 1 },
    maxSize: { width: 3, height: 2 },
  },
};
