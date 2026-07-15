import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./ux-cleanup.css";
import { httpFetch } from "../../src/lib/platform-connectors";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container not found");
}

const root = createRoot(container);

function showFatalError(message: string): void {
  try {
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML = `
        <div style="padding:2rem;font-family:Inter,Segoe UI,sans-serif;background:#0f172a;color:#fde68a;min-height:100vh;">
          <h2 style="margin-top:0;color:#fecaca;">Application error</h2>
          <pre style="white-space:pre-wrap;overflow:auto;max-height:70vh;color:#ffd7bf;">${String(message)}</pre>
          <p style="color:#f8fafc;opacity:0.9;">Open the developer console for more details.</p>
        </div>`;
    }
  } catch (e) {
    console.error("Failed to render fatal error overlay", e);
  }
}

window.addEventListener("error", (ev) => {
  try {
    const msg = (ev && (ev as ErrorEvent).message) || String(ev);
    showFatalError(msg + "\n\nSee console for stack trace.");
  } catch (e) {
    console.debug("window.error handler failed", e);
  }
});

window.addEventListener("unhandledrejection", (ev) => {
  try {
    const reason = (ev && (ev as PromiseRejectionEvent).reason) || ev;
    showFatalError(
      "Unhandled promise rejection: " +
        (reason && (reason.stack || String(reason))),
    );
  } catch (e) {
    console.debug("unhandledrejection handler failed", e);
  }
});

try {
  root.render(<App />);
} catch (err) {
  console.error("Render failed:", err);
  showFatalError(err instanceof Error ? err.stack || err.message : String(err));
}

(function setupTauriLogForwarding() {
  try {
    if (typeof window !== "undefined" && "__TAURI__" in window) {
      import("@tauri-apps/api/event")
        .then(({ emit }) => {
          const origConsoleError = console.error.bind(console);
          console.error = (...args: unknown[]) => {
            try {
              emit("client-log", {
                level: "error",
                message: args.map(String).join(" "),
              });
              try {
                httpFetch("http://127.0.0.1:1421/log", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    level: "error",
                    message: args.map(String).join(" "),
                  }),
                }).catch((err) => {
                  console.debug("forward log POST failed", err);
                });
              } catch (e) {
                console.debug("forward log POST attempt failed", e);
              }
            } catch (e) {
              console.debug("console.error forwarding failed", e);
            }
            origConsoleError(...args);
          };

          window.addEventListener("error", (ev) => {
            try {
              const evMessage =
                ev && (ev as ErrorEvent).message
                  ? (ev as ErrorEvent).message
                  : String(ev);
              emit("client-log", { level: "error", message: evMessage });
              try {
                httpFetch("http://127.0.0.1:1421/log", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ level: "error", message: evMessage }),
                }).catch((err) => {
                  console.debug("forward event POST failed", err);
                });
              } catch (e) {
                console.debug("forward event POST attempt failed", e);
              }
            } catch (e) {
              console.debug("emit event handler failed", e);
            }
          });
        })
        .catch((err) => {
          console.debug("tauri event import failed", err);
        });
    }
  } catch (e) {
    console.debug("setupTauriLogForwarding failed", e);
  }
})();
