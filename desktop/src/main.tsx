import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container not found");
}

const root = createRoot(container);

root.render(<App />);

// If running inside Tauri, forward console errors and page errors to the Rust host
// via the `client-log` event so they appear in host logs during dev.
(function setupTauriLogForwarding() {
  try {
    // Detect Tauri runtime (window.__TAURI__ exists inside the webview)
    // Use dynamic import so this file still works in a plain browser.
    // @ts-ignore
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      import('@tauri-apps/api/event').then(({ emit }) => {
        const origConsoleError = console.error.bind(console);
        console.error = (...args: any[]) => {
          try {
            emit('client-log', { level: 'error', message: args.map(String).join(' ') });
            // also attempt to POST logs to a local log server (fallback for dev capture)
            try {
              fetch('http://127.0.0.1:1421/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level: 'error', message: args.map(String).join(' ') }),
              }).catch(() => {});
            } catch (e) {}
          } catch (e) {
            // ignore
          }
          origConsoleError(...args);
        };

        window.addEventListener('error', (ev) => {
          try {
            emit('client-log', { level: 'error', message: String((ev && (ev as any).message) || ev) });
            try {
              fetch('http://127.0.0.1:1421/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level: 'error', message: String((ev && (ev as any).message) || ev) }),
              }).catch(() => {});
            } catch (e) {}
          } catch (e) {}
        });
      }).catch(() => {});
    }
  } catch (e) {
    // non-fatal
  }
})();
