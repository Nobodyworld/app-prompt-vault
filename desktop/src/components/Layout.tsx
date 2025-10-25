import { Link, Outlet, useLocation } from "react-router-dom";

export function Layout(): JSX.Element {
  const location = useLocation();

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <h1>Prompt Vault</h1>
        <nav>
          <Link to="/" className={location.pathname === "/" ? "active" : ""}>
            Library
          </Link>
          <Link to="/create" className={location.pathname === "/create" ? "active" : ""}>
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
