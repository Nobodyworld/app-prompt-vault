import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

const LOOPBACK = "127.0.0.1";
const ALLOWED_ORIGIN = "http://127.0.0.1:1420";
const DENIED_ORIGIN = "https://malicious.example";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a TCP test port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function captureOutput(child: ChildProcessWithoutNullStreams): {
  stdout: () => string;
  stderr: () => string;
} {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  return {
    stdout: () => Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: () => Buffer.concat(stderrChunks).toString("utf8"),
  };
}

async function waitForHttp(url: string, timeoutMs = 20_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(1_000) });
    } catch (error) {
      lastError = error;
      await sleep(200);
    }
  }

  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function findNonLoopbackIpv4(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
}

async function assertNotReachable(url: string): Promise<void> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1_500),
    });
    throw new Error(
      `Expected ${url} to be unreachable, but received HTTP ${response.status}`,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Expected ")
    ) {
      throw error;
    }
  }
}

async function assertRemoteHostFailsClosed(baseEnv: NodeJS.ProcessEnv): Promise<void> {
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: process.cwd(),
    env: {
      ...baseEnv,
      PROMPT_VAULT_HOST: "0.0.0.0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = captureOutput(child);
  const result = await waitForExit(child, 5_000);

  if (!result) {
    child.kill("SIGKILL");
    throw new Error("Non-loopback server configuration did not fail closed");
  }
  if (result.code === 0) {
    throw new Error("Non-loopback server configuration exited successfully");
  }

  const combined = `${output.stdout()}\n${output.stderr()}`;
  if (!combined.includes("Non-loopback PROMPT_VAULT_HOST")) {
    throw new Error(
      `Non-loopback rejection did not provide the expected diagnostic:\n${combined}`,
    );
  }
}

async function main(): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "prompt-vault-network-"));
  const port = await getFreePort();
  let metricsPort = await getFreePort();
  while (metricsPort === port) {
    metricsPort = await getFreePort();
  }

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    PROMPT_VAULT_METRICS: "true",
    PROMPT_VAULT_METRICS_PORT: String(metricsPort),
    PROMPT_VAULT_DB_PATH: join(temporaryDirectory, "prompt-vault.db"),
    PROMPT_VAULT_TAG_DB_PATH: join(temporaryDirectory, "prompt-vault-platform.db"),
    PROMPT_VAULT_STATIC_DIR: "",
    RATE_LIMIT_ENABLED: "false",
    PROMPT_VAULT_LOG_LEVEL: "error",
  };

  await assertRemoteHostFailsClosed(baseEnv);

  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: process.cwd(),
    env: baseEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = captureOutput(child);

  try {
    const healthUrl = `http://${LOOPBACK}:${port}/observability/healthz`;
    const health = await waitForHttp(healthUrl);
    if (health.status !== 200) {
      throw new Error(`Loopback health endpoint returned HTTP ${health.status}`);
    }

    const allowed = await fetch(healthUrl, {
      headers: { Origin: ALLOWED_ORIGIN },
      signal: AbortSignal.timeout(2_000),
    });
    if (allowed.status !== 200) {
      throw new Error(`Allowed local origin returned HTTP ${allowed.status}`);
    }
    if (allowed.headers.get("access-control-allow-origin") !== ALLOWED_ORIGIN) {
      throw new Error("Allowed local origin did not receive its CORS response header");
    }

    const denied = await fetch(healthUrl, {
      headers: { Origin: DENIED_ORIGIN },
      signal: AbortSignal.timeout(2_000),
    });
    if (denied.status !== 403) {
      throw new Error(`Denied browser origin returned HTTP ${denied.status}`);
    }

    const repair = await fetch(
      `http://${LOOPBACK}:${port}/observability/repair`,
      {
        method: "POST",
        signal: AbortSignal.timeout(2_000),
      },
    );
    if (repair.status !== 404) {
      throw new Error(`Disabled repair route returned HTTP ${repair.status}`);
    }

    const metrics = await waitForHttp(
      `http://${LOOPBACK}:${metricsPort}/healthz`,
    );
    if (metrics.status !== 200) {
      throw new Error(`Loopback metrics health endpoint returned HTTP ${metrics.status}`);
    }

    const externalAddress = findNonLoopbackIpv4();
    if (externalAddress) {
      await assertNotReachable(
        `http://${externalAddress}:${port}/observability/healthz`,
      );
      await assertNotReachable(
        `http://${externalAddress}:${metricsPort}/healthz`,
      );
    } else {
      console.warn("network-security-smoke: no non-loopback IPv4 address available");
    }

    console.log(
      `network-security-smoke: passed (http=${port}, metrics=${metricsPort})`,
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nserver stdout:\n${output.stdout()}\nserver stderr:\n${output.stderr()}`,
    );
  } finally {
    child.kill("SIGTERM");
    const exit = await waitForExit(child, 5_000);
    if (!exit) {
      child.kill("SIGKILL");
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
