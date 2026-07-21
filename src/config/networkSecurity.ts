import { Server } from "node:http";

export const LOOPBACK_HOST = "127.0.0.1";

export const DEFAULT_LOCAL_UI_ORIGINS = [
  "http://127.0.0.1:1420",
  "http://localhost:1420",
  "http://127.0.0.1:3001",
  "http://localhost:3001",
] as const;

export interface MutableEnvironment {
  [key: string]: string | undefined;
}

export interface LoopbackNetworkConfiguration {
  readonly host: typeof LOOPBACK_HOST;
  readonly localhostOnly: true;
  readonly allowedOrigins: readonly string[];
}

export class NetworkSecurityConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NetworkSecurityConfigurationError";
  }
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === LOOPBACK_HOST ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function parseOrigins(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Applies the supported pre-alpha network policy before the HTTP server module is
 * imported. Prompt Vault intentionally supports loopback-only HTTP access until
 * remote authentication and observability boundaries receive a separate review.
 */
export function configureLoopbackOnlyEnvironment(
  env: MutableEnvironment = process.env,
): LoopbackNetworkConfiguration {
  const requestedHost = env.PROMPT_VAULT_HOST?.trim();
  if (requestedHost && !isLoopbackHost(requestedHost)) {
    throw new NetworkSecurityConfigurationError(
      `Non-loopback PROMPT_VAULT_HOST '${requestedHost}' is not supported. ` +
        "Prompt Vault is a local pre-alpha application; bind to 127.0.0.1 and use an authenticated reverse proxy only after a dedicated remote-deployment review.",
    );
  }

  env.PROMPT_VAULT_HOST = LOOPBACK_HOST;
  env.LOCALHOST_ONLY = "true";

  const configuredOrigins = env.PROMPT_VAULT_ALLOWED_ORIGINS?.trim();
  const allowedOrigins = configuredOrigins
    ? parseOrigins(configuredOrigins)
    : [...DEFAULT_LOCAL_UI_ORIGINS];

  if (allowedOrigins.length === 0) {
    throw new NetworkSecurityConfigurationError(
      "PROMPT_VAULT_ALLOWED_ORIGINS must contain at least one explicit HTTP or HTTPS origin.",
    );
  }

  env.PROMPT_VAULT_ALLOWED_ORIGINS = allowedOrigins.join(",");

  return {
    host: LOOPBACK_HOST,
    localhostOnly: true,
    allowedOrigins,
  };
}

/** Rewrites Node HTTP listen arguments so TCP listeners cannot escape loopback. */
export function rewriteListenArguments(
  args: readonly unknown[],
  host = LOOPBACK_HOST,
): unknown[] {
  const rewritten = [...args];
  const target = rewritten[0];

  if (typeof target === "number") {
    if (typeof rewritten[1] === "string") {
      rewritten[1] = host;
    } else {
      rewritten.splice(1, 0, host);
    }
    return rewritten;
  }

  if (target && typeof target === "object" && !Array.isArray(target)) {
    rewritten[0] = {
      ...(target as Record<string, unknown>),
      host,
    };
  }

  return rewritten;
}

/**
 * Installs a process-local guard around Node's HTTP listener. This contains the
 * existing server bootstrap without changing its large implementation while the
 * application is later refactored to an explicit server factory.
 */
export function installLoopbackOnlyListenGuard(
  host = LOOPBACK_HOST,
): () => void {
  const originalListen = Server.prototype.listen;
  type Listen = typeof originalListen;

  const guardedListen = function (
    this: Server,
    ...args: unknown[]
  ): Server {
    return Reflect.apply(
      originalListen,
      this,
      rewriteListenArguments(args, host),
    ) as Server;
  } as unknown as Listen;

  Server.prototype.listen = guardedListen;

  return () => {
    if (Server.prototype.listen === guardedListen) {
      Server.prototype.listen = originalListen;
    }
  };
}
