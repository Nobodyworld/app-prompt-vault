import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { isTauriAvailable } from "../lib/tauri";
import { isUsingFallback, subscribeFallback } from "../services/promptApi";

export function Layout(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = isTauriAvailable();
  const [fallbackActiveState, setFallbackActiveState] =
    useState<boolean>(isUsingFallback());

  const handleCreateClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
  ): void => {
    if (location.pathname === "/create") {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("submit-create-form"));
    }
  };

  const handleMinimize = async (): Promise<void> => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("Failed to minimize window:", error);
    }
  };

  const handleToggleMaximize = async (): Promise<void> => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      if (await currentWindow.isMaximized()) await currentWindow.unmaximize();
      else await currentWindow.maximize();
    } catch (error) {
      console.error("Failed to resize window:", error);
    }
  };

  const handleClose = async (): Promise<void> => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeFallback((active) =>
      setFallbackActiveState(active),
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true"
      ) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "n") {
        event.preventDefault();
        navigate("/create");
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        navigate("/");
        window.setTimeout(
          () => window.dispatchEvent(new CustomEvent("focus-search")),
          0,
        );
        return;
      }

      if (event.key === "Escape" && location.pathname === "/") {
        window.dispatchEvent(new CustomEvent("clear-search"));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [location.pathname, navigate]);

  return (
    <div className="app-shell">
      {isDesktop && (
        <div className="window-controls-bar" data-tauri-drag-region>
          <div className="window-controls">
            <button
              type="button"
              className="window-control window-control--minimize"
              onClick={() => void handleMinimize()}
              title="Minimize"
              aria-label="Minimize"
            >
              −
            </button>
            <button
              type="button"
              className="window-control"
              onClick={() => void handleToggleMaximize()}
              title="Maximize or restore"
              aria-label="Maximize or restore"
            >
              □
            </button>
            <button
              type="button"
              className="window-control window-control--close"
              onClick={() => void handleClose()}
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="app-layout">
        <div className="app-main">
          <header className="app-shell__header" data-tauri-drag-region>
            <NavLink to="/" className="app-brand" aria-label="Prompt Vault home">
              <span className="app-brand__mark" aria-hidden="true">
                PV
              </span>
              <span className="app-brand__text">
                <strong>Prompt Vault</strong>
                <small>Local prompt library</small>
              </span>
            </NavLink>

            <nav aria-label="Primary navigation">
              <NavLink to="/">Library</NavLink>
              <NavLink to="/create" onClick={handleCreateClick}>
                New prompt
              </NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </nav>
          </header>

          {fallbackActiveState && (
            <div className="offline-banner" role="status">
              Local fallback mode is active.
            </div>
          )}

          <main className="app-shell__content">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
