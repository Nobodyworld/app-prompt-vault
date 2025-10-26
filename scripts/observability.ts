import { bootstrapObservabilityFromEnv } from "../src/observability/runtime.js";

// # agent-entrypoint: Spins up the observability stack for local diagnostics.

const handle = bootstrapObservabilityFromEnv({
  serviceName: "prompt-vault-monitor",
  enableMetrics: true,
});

console.log(
  `Observability server running on port ${handle.server ? handle.port ?? "(auto)" : "(metrics disabled)"}`
);
console.log("Press Ctrl+C to stop.");

process.on("SIGINT", async () => {
  await handle.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await handle.shutdown();
  process.exit(0);
});

setInterval(() => {
  // keep process alive while metrics server runs
}, 10_000);
