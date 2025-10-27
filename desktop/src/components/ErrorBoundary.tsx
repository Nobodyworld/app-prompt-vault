import React from "react";
import { ErrorBoundary as ReactErrorBoundary } from "react-error-boundary";
import { isTauriAvailable, invokeOrThrow } from "../lib/tauri";

type Props = {
  children: React.ReactNode;
};

function Fallback({ error }: { error: Error | null }): React.ReactElement {
  // Render a small fallback UI for errors captured by the boundary
  // Keep return type explicit for lint rules
  return (
    <div className="error-boundary-fallback">
      <h2>Something went wrong.</h2>
      <details>{error?.toString()}</details>
    </div>
  );
}

export function ErrorBoundary({ children }: Props): React.ReactElement {
  async function handleError(error: Error, info: { componentStack: string }): Promise<void> {
    try {
      const traceId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : String(Date.now());

      const payload = {
        name: "error_boundary",
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        traceId,
        tags: { area: "desktop-renderer" },
      };

      // Best-effort: if running inside Tauri, forward telemetry to the backend.
      if (isTauriAvailable()) {
        // invokeOrThrow will import the Tauri core invoke and send to Rust command
        await invokeOrThrow("record_telemetry_event", payload).catch((err) => {
          // swallow errors - telemetry must not crash the app; keep debug trace
          console.debug('invokeOrThrow record_telemetry_event failed', err);
        });
      } else {
        // When not running in Tauri (dev browser), just log to console for diagnostics
        console.error("ErrorBoundary captured error:", payload);
      }
    } catch (e) {
      // Do not propagate errors from the telemetry path
      console.error("ErrorBoundary telemetry fail:", e);
    }
  }

  return (
    <ReactErrorBoundary FallbackComponent={Fallback} onError={handleError}>
      {children}
    </ReactErrorBoundary>
  );
}

export default ErrorBoundary;
