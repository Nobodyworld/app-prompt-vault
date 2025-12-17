import type {
  MetricRegistry,
  Telemetry,
} from "../../observability/telemetry.js";
import type { PromptVaultPlugin } from "../types.js";

type CounterHandle = ReturnType<MetricRegistry["getOrCreateCounter"]>;

export function createOperationalTelemetryPlugin(): PromptVaultPlugin {
  let telemetryRef: Telemetry | undefined;
  let writeCounter: CounterHandle | undefined;

  return {
    name: "operational-telemetry",
    setup({ telemetry, logger }) {
      telemetryRef = telemetry;
      writeCounter = telemetry.registry.getOrCreateCounter(
        "prompt_vault_prompt_writes_total",
        "Total prompt write operations",
        ["operation"],
      );
      logger.info("operational_telemetry_plugin_ready");
    },
    onPromptCreated({ prompt }) {
      if (!telemetryRef) {
        return;
      }
      writeCounter?.increment(
        telemetryRef.registry.withDefaultLabels({ operation: "create" }),
      );
      telemetryRef.recordEvent("prompt.created", { promptId: prompt.id });
    },
    onVersionAdded({ promptId, version }) {
      if (!telemetryRef) {
        return;
      }
      writeCounter?.increment(
        telemetryRef.registry.withDefaultLabels({ operation: "add-version" }),
      );
      telemetryRef.recordEvent("prompt.version_added", {
        promptId,
        semanticVersion: version.semanticVersion,
      });
    },
    onPromptTagged({ promptId, tags }) {
      if (!telemetryRef) {
        return;
      }
      writeCounter?.increment(
        telemetryRef.registry.withDefaultLabels({ operation: "tag" }),
      );
      telemetryRef.recordEvent("prompt.tagged", {
        promptId,
        count: tags.length,
      });
    },
    onPromptUntagged({ promptId, labels }) {
      if (!telemetryRef) {
        return;
      }
      writeCounter?.increment(
        telemetryRef.registry.withDefaultLabels({ operation: "untag" }),
      );
      telemetryRef.recordEvent("prompt.untagged", {
        promptId,
        count: labels.length,
      });
    },
  };
}
