/**
 * @fileoverview Main Application Component
 *
 * This is the root component of the Prompt Vault desktop application.
 * It sets up the React Router configuration and provides the overall
 * application structure with error boundaries and layout components.
 *
 * Application Routes:
 * - `/` - Prompt list page (default route)
 * - `/create` - Create new prompt page
 * - `/edit/:id` - Edit existing prompt page
 * - `/settings` - Application settings page
 *
 * Architecture:
 * - BrowserRouter for client-side routing
 * - ErrorBoundary for graceful error handling
 * - Layout component for consistent UI structure
 * - Route-based page components for modularity
 *
 * @example
 * ```tsx
 * import { App } from './App';
 *
 * // In main.tsx or index.tsx
 * ReactDOM.render(<App />, document.getElementById('root'));
 * ```
 */

import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PromptListPage } from "./pages/PromptListPage";
import { CreatePromptPage } from "./pages/CreatePromptPage";
import { EditPromptPage } from "./pages/EditPromptPage";
import { SettingsPage } from "./pages/SettingsPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./components/ThemeProvider";
import { I18nProvider } from "./i18n";

/**
 * Root application component that configures routing and layout.
 *
 * This component serves as the entry point for the React application,
 * establishing the routing structure and wrapping all routes with
 * shared layout and error handling components.
 *
 * The routing is organized as follows:
 * - All routes are wrapped in the Layout component for consistent navigation
 * - Index route shows the prompt list as the default view
 * - Dynamic routes use URL parameters for prompt editing
 * - Error boundary catches and handles any unhandled errors gracefully
 *
 * @returns The root React element with routing configuration
 */
export function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<PromptListPage />} />
                  <Route path="create" element={<CreatePromptPage />} />
                  <Route path="edit/:id" element={<EditPromptPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
