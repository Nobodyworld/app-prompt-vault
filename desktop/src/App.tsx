import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PromptListPage } from "./pages/PromptListPage";
import { CreatePromptPage } from "./pages/CreatePromptPage";
import { EditPromptPage } from "./pages/EditPromptPage";
import ErrorBoundary from "./components/ErrorBoundary";

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<PromptListPage />} />
            <Route path="create" element={<CreatePromptPage />} />
            <Route path="edit/:id" element={<EditPromptPage />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
