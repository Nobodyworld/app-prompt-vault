import { spawn } from "node:child_process";

// # agent-safe-task: Runs the production dependency audit with offline-aware fallbacks.

function warn(message: string): void {
  console.warn(message);
}

const packageManagerCli = process.env.npm_execpath;
if (!packageManagerCli) {
  console.error(
    "security-scan: npm_execpath is unavailable; run this script through pnpm",
  );
  process.exit(1);
}

const audit = spawn(
  process.execPath,
  [packageManagerCli, "audit", "--prod", "--json"],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";

audit.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

audit.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

audit.on("close", (code) => {
  if (code === 0) {
    console.log("pnpm audit: no known production vulnerabilities found");
    process.exit(0);
    return;
  }

  if (stderr.includes("403") || stdout.includes('"statusCode": 403')) {
    warn(
      "pnpm audit warning: registry returned 403 Forbidden; skipping security scan for this run.",
    );
    process.exit(0);
    return;
  }

  try {
    const payload = JSON.parse(stdout) as {
      error?: { code?: string; summary?: string };
      metadata?: { vulnerabilities?: Record<string, number> };
    };
    if (payload.error?.code) {
      if (payload.error.code === "ENOAUDIT") {
        warn(`pnpm audit skipped: ${payload.error.summary}`);
        process.exit(0);
        return;
      }
      if (
        payload.error.code === "ENOTFOUND" ||
        payload.error.code === "E403"
      ) {
        warn(
          `pnpm audit warning: ${payload.error.summary ?? payload.error.code}`,
        );
        process.exit(0);
        return;
      }
    }

    if (payload.metadata?.vulnerabilities) {
      console.error("pnpm audit detected production vulnerabilities:");
      console.error(JSON.stringify(payload.metadata.vulnerabilities, null, 2));
    } else {
      console.error("pnpm audit failed:");
      console.error(stdout || stderr);
    }
  } catch (error) {
    console.error(
      "pnpm audit could not parse response:",
      error instanceof Error ? error.message : error,
    );
    console.error(stdout || stderr);
  }

  process.exit(code ?? 1);
});

audit.on("error", (error) => {
  console.error("security-scan: failed to start pnpm audit", error);
  process.exit(1);
});
