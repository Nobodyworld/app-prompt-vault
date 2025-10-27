import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container not found");
}

const root = createRoot(container);

function showFatalError(message: string): void {
  try {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.innerHTML = `
        <div style="padding:2rem;font-family:Inter,Segoe UI,sans-serif;background:#0f172a;color:#fde68a;min-height:100vh;">
          <h2 style="margin-top:0;color:#fecaca;">Application error</h2>
          <pre style="white-space:pre-wrap;overflow:auto;max-height:70vh;color:#ffd7bf;">${String(message)}</pre>
          <p style="color:#f8fafc;opacity:0.9;">Open the developer console for more details.</p>
        </div>`;
    }
  } catch (e) {
    // best-effort only
    console.error('Failed to render fatal error overlay', e);
  }
}

// Global error hooks so runtime errors surface visibly instead of a white screen
window.addEventListener('error', (ev) => {
  try {
    const msg = (ev && (ev as ErrorEvent).message) || String(ev);
    showFatalError(msg + '\n\nSee console for stack trace.');
  } catch (e) {
    // keep failure visible for debugging (best-effort)
    console.debug('window.error handler failed', e);
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    const reason = (ev && (ev as PromiseRejectionEvent).reason) || ev;
    showFatalError('Unhandled promise rejection: ' + (reason && (reason.stack || String(reason))));
  } catch (e) {
    console.debug('unhandledrejection handler failed', e);
  }
});

try {
  root.render(<App />);
} catch (err) {
  console.error('Render failed:', err);
  showFatalError(err instanceof Error ? err.stack || err.message : String(err));
}

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
              }).catch((err) => {
                console.debug('forward log POST failed', err);
              });
            } catch (e) {
              console.debug('forward log POST attempt failed', e);
            }
          } catch (e) {
            console.debug('console.error forwarding failed', e);
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
              }).catch((err) => {
                console.debug('forward event POST failed', err);
              });
            } catch (e) {
              console.debug('forward event POST attempt failed', e);
            }
          } catch (e) {
            console.debug('emit event handler failed', e);
          }
        });
      }).catch((err) => {
        console.debug('tauri event import failed', err);
      });
    }
  } catch (e) {
    console.debug('setupTauriLogForwarding failed', e);
  }
})();
