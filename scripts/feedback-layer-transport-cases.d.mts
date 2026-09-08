export function registerTransportTests(
  test: (name: string, run: () => void | Promise<void>) => unknown,
): void;
