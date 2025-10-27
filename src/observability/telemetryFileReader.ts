import fs from "node:fs";
import path from "node:path";
import { MetricRegistry } from "./telemetry.js";

type LastCounts = Map<string, number>;

function candidateTelemetryDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.PROMPT_VAULT_TELEMETRY_DIR) {
    dirs.push(process.env.PROMPT_VAULT_TELEMETRY_DIR);
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) dirs.push(path.join(local, "prompt-vault-telemetry"));
  } else if (process.platform === "darwin") {
    dirs.push(path.join(process.env.HOME ?? "", "Library", "Application Support", "prompt-vault-telemetry"));
  } else {
    // linux / other
    const xdg = process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? "", ".local", "share");
    dirs.push(path.join(xdg, "prompt-vault-telemetry"));
  }
  return dirs;
}

export function startTelemetryMetricsWatcher(registry: MetricRegistry, intervalMs = 10_000): { stop: () => void } {
  const last: LastCounts = new Map();

  let stopped = false;

  async function tryRead() {
    const dirs = candidateTelemetryDirs();
    for (const dir of dirs) {
      try {
        const metricsPath = path.join(dir, "telemetry-metrics.json");
        if (!fs.existsSync(metricsPath)) continue;
        const content = await fs.promises.readFile(metricsPath, "utf8");
        const json = JSON.parse(content) as Record<string, number>;
        for (const [key, value] of Object.entries(json)) {
          // expected keys are like 'event_count:<name>'
          if (!key.startsWith("event_count:")) continue;
          const eventName = key.substring("event_count:".length);
          const prev = last.get(eventName) ?? 0;
          const delta = Math.max(0, value - prev);
          if (delta > 0) {
            const counter = registry.getOrCreateCounter("renderer_event_count", "Counts of renderer telemetry events", ["event_name"]);
            counter.increment({ event_name: eventName }, delta);
            last.set(eventName, value);
          }
        }
        return; // read first available dir
      } catch (err) {
        // keep debug trace but continue to next dir
        console.debug('tryRead telemetry dir failed', err);
      }
    }
  }

  const timer = setInterval(() => {
    if (stopped) return;
    tryRead().catch((err) => {
      console.debug('startTelemetryMetricsWatcher periodic tryRead failed', err);
    });
  }, intervalMs);

  // run immediately once
  tryRead().catch((err) => {
    console.debug('startTelemetryMetricsWatcher initial tryRead failed', err);
  });

  return { stop: () => { stopped = true; clearInterval(timer); } };
}
