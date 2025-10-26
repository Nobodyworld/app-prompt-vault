import { spawn } from "node:child_process";

// # agent-safe-task: Runs dependency security audits with offline-aware fallbacks.

function warn(message: string): void {
  console.warn(message);
}

const audit = spawn("npm", ["audit", "--omit=dev", "--json"], {
  stdio: ["ignore", "pipe", "pipe"],
});

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
    console.log("npm audit: no vulnerabilities found");
    process.exit(0);
    return;
  }

  if (stderr.includes("403") || stdout.includes('"statusCode": 403')) {
    warn("npm audit warning: registry returned 403 Forbidden; skipping security scan for this run.");
    process.exit(0);
    return;
  }

  try {
    const payload = JSON.parse(stdout);
    if (payload.error && typeof payload.error.code === "string") {
      if (payload.error.code === "ENOAUDIT") {
        warn(`npm audit skipped: ${payload.error.summary}`);
        process.exit(0);
        return;
      }
      if (payload.error.code === "ENOTFOUND" || payload.error.code === "E403") {
        warn(`npm audit warning: ${payload.error.summary ?? payload.error.code}`);
        process.exit(0);
        return;
      }
    }

    if (payload.metadata && payload.metadata.vulnerabilities) {
      console.error("npm audit detected vulnerabilities:");
      console.error(JSON.stringify(payload.metadata.vulnerabilities, null, 2));
    } else {
      console.error("npm audit failed:");
      console.error(stdout || stderr);
    }
  } catch (error) {
    console.error("npm audit could not parse response:", error instanceof Error ? error.message : error);
    console.error(stdout || stderr);
  }

  process.exit(code ?? 1);
});
