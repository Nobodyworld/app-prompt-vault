declare module '@nw/pages-widgets' {
    export interface WidgetRegistration {
        id: string;
        appId: string;
        displayName: string;
        description?: string;
        icon?: string;
    }

    export function registerWidgets(widgets: WidgetRegistration[]): void;
}
