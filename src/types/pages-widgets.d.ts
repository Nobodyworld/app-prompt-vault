declare module "@nw/pages-widgets" {
  export type JSONSchema = Record<string, unknown>;

  export interface WidgetDefinition {
    id: string;
    appId: string;
    displayName: string;
    description?: string;
    icon?: string;
    configSchema?: JSONSchema;
  }

  export function registerWidgets(widgets: WidgetDefinition[]): void;
}
