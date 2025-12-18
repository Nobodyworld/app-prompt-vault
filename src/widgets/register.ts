/**
 * Widget Registration
 *
 * Registers Prompt Vault widgets with @nw/pages-widgets so the Hub can discover
 * them (and fall back to placeholders if the Hub doesn't yet ship real loaders).
 */

import { registerWidgets } from "@nw/pages-widgets";
import {
  promptVaultQuickAddWidgetMeta,
  promptVaultRecentWidgetMeta,
  promptVaultStatsWidgetMeta,
} from "./index.js";

type WidgetDefinition = Parameters<typeof registerWidgets>[0][number];

let widgetsRegistered = false;

export function registerPromptVaultWidgetsWithPagesWidgets(): void {
  if (widgetsRegistered) return;

  const widgetDefinitions: WidgetDefinition[] = [
    {
      id: promptVaultQuickAddWidgetMeta.id,
      appId: "prompt-vault",
      displayName: promptVaultQuickAddWidgetMeta.name,
      description: promptVaultQuickAddWidgetMeta.description,
      icon: "plus",
    },
    {
      id: promptVaultRecentWidgetMeta.id,
      appId: "prompt-vault",
      displayName: promptVaultRecentWidgetMeta.name,
      description: promptVaultRecentWidgetMeta.description,
      icon: "clock",
      configSchema: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
    {
      id: promptVaultStatsWidgetMeta.id,
      appId: "prompt-vault",
      displayName: promptVaultStatsWidgetMeta.name,
      description: promptVaultStatsWidgetMeta.description,
      icon: "bar-chart",
    },
  ];

  registerWidgets(widgetDefinitions);
  widgetsRegistered = true;
}

export function __resetWidgetRegistration(): void {
  widgetsRegistered = false;
}
