export type JSONSchema = Record<string, unknown>;

export interface WidgetDefinition {
  id: string;
  appId: string;
  displayName: string;
  description?: string;
  icon?: string;
  configSchema?: JSONSchema;
}

const widgetRegistry = new Map<string, WidgetDefinition>();

/** Register Prompt Vault widget metadata in the app-local registry. */
export function registerWidgets(widgets: WidgetDefinition[]): void {
  for (const widget of widgets) {
    if (!widget.id || !widget.appId) {
      throw new Error("Widget definitions require both id and appId");
    }
    widgetRegistry.set(widget.id, { ...widget });
  }
}

/** Read-only snapshot used by tests and optional Hub adapters. */
export function getRegisteredWidgets(): readonly WidgetDefinition[] {
  return [...widgetRegistry.values()].map((widget) => ({ ...widget }));
}

export function resetRegisteredWidgets(): void {
  widgetRegistry.clear();
}
