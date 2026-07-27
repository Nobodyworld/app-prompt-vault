import React from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { CreatePromptPage } from "./pages/CreatePromptPage";
import { EditPromptPage } from "./pages/EditPromptPage";
import { LibraryPage } from "./pages/LibraryPage";
import { PromptListPage } from "./pages/PromptListPage";
import { SettingsPage } from "./pages/SettingsPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./components/ThemeProvider";
import { I18nProvider } from "./i18n";

export function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<LibraryPage />} />
                  <Route path="create" element={<CreatePromptPage />} />
                  <Route path="edit/:id" element={<EditPromptPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="advanced" element={<PromptListPage />} />
                </Route>
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
