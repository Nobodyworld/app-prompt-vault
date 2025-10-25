import { Link, Outlet } from "react-router-dom";

export function Layout(): JSX.Element {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <h1>Prompt Vault</h1>
        <nav>
          <Link to="/">
            Library
          </Link>
          <Link to="/create">
            Create Prompt
          </Link>
        </nav>
      </header>
      <main className="app-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
