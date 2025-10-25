import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PromptListPage } from "./pages/PromptListPage";
import { CreatePromptPage } from "./pages/CreatePromptPage";

export function App(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<PromptListPage />} />
          <Route path="create" element={<CreatePromptPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
