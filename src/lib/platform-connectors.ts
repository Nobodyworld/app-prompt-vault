export type HttpFetchOptions = {
  readonly timeoutMs?: number;
};

function combineSignals(
  signals: readonly (AbortSignal | undefined)[],
): AbortSignal {
  const active = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0];

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(active);
  }

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

export async function httpFetch(
  url: string,
  init: RequestInit = {},
  options: HttpFetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs;
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(url, init);
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    const signal = init.signal
      ? combineSignals([init.signal, timeoutController.signal])
      : timeoutController.signal;
    return fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}
