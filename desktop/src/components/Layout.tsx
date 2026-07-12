import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { isTauriAvailable } from "../lib/tauri";
import { isUsingFallback, subscribeFallback } from "../services/promptApi";
import { useI18n } from "../i18n";

export function Layout(): React.JSX.Element {
  const { t } = useI18n();
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
        if (location.pathname === "/") {
          window.dispatchEvent(new CustomEvent("focus-search"));
        }
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
    <>
      {isDesktop && (
        <div className="window-controls-bar">
          <div className="window-controls">
            <button
              type="button"
              className="window-control window-control--minimize"
              onClick={() => void handleMinimize()}
              title={t("window.minimize")}
              aria-label={t("window.minimize")}
            >
              ─
            </button>
            <button
              type="button"
              className="window-control window-control--close"
              onClick={() => void handleClose()}
              title={t("window.close")}
              aria-label={t("window.close")}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="app-shell">
        <div className="app-layout">
          <aside className="app-sidebar" aria-label={t("sidebar.settings")}>
            <NavLink
              to="/settings"
              className="sidebar-icon"
              title={t("sidebar.settings")}
              aria-label={t("sidebar.settings")}
            >
              ⚙️
            </NavLink>
          </aside>

          <div className="app-main">
            <header className="app-shell__header" data-tauri-drag-region>
              <h1>{t("app.title")}</h1>
              <nav aria-label={t("app.title")}>
                <NavLink to="/" className="nav-highlight">
                  {t("nav.library")}
                </NavLink>
                <NavLink
                  to="/create"
                  className="nav-highlight"
                  onClick={handleCreateClick}
                >
                  {t("nav.create")}
                </NavLink>
              </nav>
            </header>

            {fallbackActiveState && (
              <div className="offline-banner" role="status">
                {t("banner.offline")}
              </div>
            )}

            <main className="app-shell__content">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
