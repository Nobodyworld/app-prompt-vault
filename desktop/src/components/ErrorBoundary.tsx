import React from "react";
import { ErrorBoundary as ReactErrorBoundary } from "react-error-boundary";
import { isTauriAvailable, invokeOrThrow } from "../lib/tauri";

type Props = {
  children: React.ReactNode;
};

function Fallback({ error }: { error: Error | null }) {
  return (
    <div className="error-boundary-fallback">
      <h2>Something went wrong.</h2>
      <details>{error?.toString()}</details>
    </div>
  );
}

export function ErrorBoundary({ children }: Props) {
  async function handleError(error: Error, info: { componentStack: string }) {
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
        await invokeOrThrow("record_telemetry_event", payload).catch(() => {
          // swallow errors - telemetry must not crash the app
        });
      } else {
        // When not running in Tauri (dev browser), just log to console for diagnostics
        // eslint-disable-next-line no-console
        console.error("ErrorBoundary captured error:", payload);
      }
    } catch (e) {
      // Do not propagate errors from the telemetry path
      // eslint-disable-next-line no-console
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
