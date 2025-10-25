export function isTauriAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const globalWindow = window as typeof window & {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  };

  return typeof globalWindow.__TAURI_INTERNALS__?.invoke === "function";
}

export async function invokeOrThrow<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriAvailable()) {
    throw new Error("Tauri runtime is not available. Launch the desktop app to use this feature.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
