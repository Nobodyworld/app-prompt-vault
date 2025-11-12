import React, { useState, useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { isTauriAvailable } from "../lib/tauri";
import { subscribeFallback, isUsingFallback } from "../services/promptApi";

export function Layout(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [isHidden, setIsHidden] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [hoverStartTime, setHoverStartTime] = useState<number | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const inactivityTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const isDesktop = isTauriAvailable();
  const [fallbackActiveState, setFallbackActiveState] = useState<boolean>(isUsingFallback());

  const handleSidebarArrowClick = (): void => {
    setSidebarExpanded(!sidebarExpanded);
  };

  const handleCreateClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    if (location.pathname === "/create") {
      event.preventDefault();
      // Dispatch custom event to trigger form submission
      window.dispatchEvent(new CustomEvent("submit-create-form"));
    }
  };

  const handleMinimize = async (): Promise<void> => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      await window.minimize();
    } catch (error) {
      console.error("Failed to minimize window:", error);
    }
  };

  const handleClose = async (): Promise<void> => {
    console.log("Close button clicked");
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      console.log("Closing window...");
      await window.close();
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  // Reset inactivity timer on user activity
  const resetInactivityTimer = (): void => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    setIsHidden(false);
    inactivityTimerRef.current = setTimeout(() => {
      setIsHidden(true);
    }, 30000); // Hide after 30 seconds of inactivity
  };

  // Handle mouse movement for overlay detection
  const handleMouseMove = (event: MouseEvent): void => {
    resetInactivityTimer();

    // Check if mouse is near the left edge (where window would be)
    if (event.clientX < 50 && isHidden) {
      setShowOverlay(true);
      setHoverStartTime(Date.now());
    } else {
      setShowOverlay(false);
      setHoverStartTime(null);
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    }
  };

  // Handle overlay hover
  const handleOverlayHover = (): void => {
    if (hoverStartTime && Date.now() - hoverStartTime >= 1000) {
      setIsHidden(false);
      setShowOverlay(false);
      resetInactivityTimer();
    }
  };

  useEffect(() => {
    const unsub = subscribeFallback((b) => setFallbackActiveState(b));
    return () => unsub();
  }, []);
  useEffect(() => {
    if (!isDesktop) return;

    // Start inactivity timer
    resetInactivityTimer();

    // Add mouse move listener
    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isHidden, isDesktop]);

  useEffect(() => {
    if (showOverlay && hoverStartTime) {
      hoverTimerRef.current = setTimeout(() => {
        handleOverlayHover();
      }, 1000);
    }

    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, [showOverlay, hoverStartTime]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Only handle shortcuts when not typing in an input/textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
        return;
      }

      // Ctrl/Cmd + N: Create new prompt
      if ((event.ctrlKey || event.metaKey) && event.key === 'n') {
        event.preventDefault();
        navigate('/create');
        return;
      }

      // Ctrl/Cmd + K: Focus search (only on library page)
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        if (location.pathname === '/') {
          // Dispatch custom event to focus search in PromptListPage
          window.dispatchEvent(new CustomEvent('focus-search'));
        }
        return;
      }

      // Escape: Clear search or go back
      if (event.key === 'Escape') {
        if (location.pathname === '/') {
          // Dispatch custom event to clear search in PromptListPage
          window.dispatchEvent(new CustomEvent('clear-search'));
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate, location.pathname]);

  return (
    <>
      {isDesktop && showOverlay && (
        <div
          className="window-overlay"
          onMouseEnter={handleOverlayHover}
        >
          <div className="overlay-icon">💬</div>
        </div>
      )}
      {isDesktop && (
        <div className="window-controls-bar">
          <div className="window-controls">
            <button className="window-control window-control--minimize" onClick={handleMinimize} title="Minimize">
              ─
            </button>
            <button className="window-control window-control--close" onClick={handleClose} title="Close">
              ✕
            </button>
          </div>
        </div>
      )}
      <div className={`app-shell ${isDesktop && isHidden ? 'app-shell--hidden' : ''}`}>
        <div className="app-layout">
          <aside className={`app-sidebar ${sidebarExpanded ? 'app-sidebar--expanded' : ''}`}>
            <div className={`sidebar-arrow ${sidebarExpanded ? 'sidebar-arrow--expanded' : ''}`} onClick={handleSidebarArrowClick}>
              {sidebarExpanded ? '‹' : '›'}
            </div>
            <NavLink to="/settings" className="sidebar-icon" title="Settings">
              ⚙️
            </NavLink>
            <div className="sidebar-icon sidebar-profile" title="Profile">
              👤
            </div>
          </aside>
          <div className="app-main">
            <header className="app-shell__header" data-tauri-drag-region>
              <h1>Prompt Vault</h1>
              <nav>
                <NavLink to="/" className="nav-highlight">
                  Library
                </NavLink>
                <NavLink to="/create" className="nav-highlight" onClick={handleCreateClick}>
                  Create
                </NavLink>
              </nav>
            </header>
            {fallbackActiveState && (
              <div className="offline-banner">
                Offline / demo mode — using local fallback data. Changes will be synced when the server is available.
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
