import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MetricRegistry } from "../src/observability/telemetry.js";
import { startTelemetryMetricsWatcher } from "../src/observability/telemetryFileReader.js";

describe("telemetryFileReader", () => {
  it("reads telemetry-metrics.json and updates registry counters", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pv-telemetry-"));
    try {
      const metricsPath = path.join(tmp, "telemetry-metrics.json");
      const data = { "event_count:ui_error": 3 };
      await fs.writeFile(metricsPath, JSON.stringify(data), "utf8");

      // Ensure the file is discoverable by the reader
      process.env.PROMPT_VAULT_TELEMETRY_DIR = tmp;

      const registry = new MetricRegistry();
      const watcher = startTelemetryMetricsWatcher(registry, 50);

      // wait briefly for the watcher to pick up the file and increment counters
      await new Promise((res) => setTimeout(res, 250));

      const snapshot = registry.snapshot();
      expect(snapshot).toContain("renderer_event_count");
      expect(snapshot).toContain("event_name=\"ui_error\"");

      watcher.stop();
    } finally {
      // cleanup
      try {
        await fs.rm(tmp, { recursive: true, force: true });
      } catch {}
    }
  });
});
