import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isTauriAvailable } from "../lib/tauri";

type WindowPlacement = "left" | "right";

export function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [placement, setPlacement] = useState<WindowPlacement>("left");

  useEffect(() => {
    const saved = localStorage.getItem("prompt-vault-window-placement") as WindowPlacement;
    if (saved) setPlacement(saved);
  }, []);

  const positionWindow = async (newPlacement: WindowPlacement): Promise<void> => {
    if (!isTauriAvailable()) {
      // Running in browser/dev server: skip Tauri-only window positioning.
      return;
    }
    try {
      const { getCurrentWindow, LogicalPosition } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();

      // Get screen dimensions
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      if (!monitor) return;

      const screenWidth = monitor.size.width;
      const screenHeight = monitor.size.height;
      const windowWidth = 500; // from tauri.conf.json
      const windowHeight = 800; // from tauri.conf.json

      let x: number;
      if (newPlacement === "left") {
        x = 0;
      } else {
        x = screenWidth - windowWidth;
      }

      const y = Math.max(0, (screenHeight - windowHeight) / 2);

      await window.setPosition(new LogicalPosition(x, y));
    } catch (error) {
      console.error("Failed to position window:", error);
    }
  };

  const handlePlacementChange = async (newPlacement: WindowPlacement): Promise<void> => {
    setPlacement(newPlacement);
    localStorage.setItem("prompt-vault-window-placement", newPlacement);
    await positionWindow(newPlacement);
  };

  return (
    <div className="settings-page">
      <header>
        <h2>Settings</h2>
      </header>

      <div className="settings-section">
        <h3>Window Placement</h3>
        <div className="placement-options">
          <label>
            <input
              type="radio"
              name="placement"
              value="left"
              checked={placement === "left"}
              onChange={() => handlePlacementChange("left")}
            />
            Left Sidebar
          </label>
          <label>
            <input
              type="radio"
              name="placement"
              value="right"
              checked={placement === "right"}
              onChange={() => handlePlacementChange("right")}
            />
            Right Sidebar
          </label>
        </div>
      </div>

      <div className="form-actions">
        <button onClick={() => navigate(-1)}>Save</button>
      </div>
    </div>
  );
}