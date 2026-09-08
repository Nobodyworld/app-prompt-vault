import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_PRODUCTION_MARKERS,
  scanFeedbackLayerProduction,
} from "../scripts/check-feedback-layer-production.mjs";

const roots: string[] = [];

async function fixture({
  javascript = "console.log('production app');",
  stylesheet = "body { color: CanvasText; }",
  includeStylesheet = true,
}: {
  javascript?: string;
  stylesheet?: string;
  includeStylesheet?: boolean;
} = {}): Promise<{
  root: string;
  output: string;
  script: string;
}> {
  const root = await fs.mkdtemp(
    path.join(tmpdir(), "prompt-vault-feedback-production-"),
  );
  roots.push(root);
  const output = path.join(root, "desktop", "dist");
  const assets = path.join(output, "assets");
  await fs.mkdir(assets, { recursive: true });
  await fs.writeFile(
    path.join(output, "index.html"),
    '<main data-feedback-id="prompt-vault.shell" data-feedback-private data-feedback-redact></main>',
  );
  const script = path.join(assets, "app.js");
  await fs.writeFile(script, javascript);
  if (includeStylesheet) {
    await fs.writeFile(path.join(assets, "app.css"), stylesheet);
  }
  await fs.writeFile(
    path.join(assets, "app.js.map"),
    JSON.stringify({ version: 3, sources: [], names: [], mappings: "" }),
  );
  return { root, output, script };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("Feedback Layer production exclusion", () => {
  it("accepts inert semantic and privacy attributes in complete output", async () => {
    const { root, output } = await fixture();
    await expect(
      scanFeedbackLayerProduction({
        repositoryRoot: root,
        outputDirectory: output,
      }),
    ).resolves.toMatchObject({
      output: "desktop/dist",
      fileCount: 4,
      auditedFileCount: 4,
    });
  });

  it.each([
    ["SDK install", "FeedbackLayer.install({})"],
    ["SDK host", 'document.createElement("feedback-layer-root")'],
    ["server variable", "FEEDBACK_LAYER_PROJECT_ID"],
    ["protocol route", "/integration/feedback-layer.development@1.js"],
    ["capture session", "/api/sessions"],
    ["resolution challenge", "/api/resolution-challenges/example"],
    ["runtime project ID", `project_${"a".repeat(32)}`],
    ["service origin", "http://127.0.0.1:3178"],
    ["pilot loader", "__PROMPT_VAULT_FEEDBACK_LAYER_PILOT_RUNTIME__"],
  ])("rejects executable marker: %s", async (_label, marker) => {
    const { root, output } = await fixture({ javascript: marker });
    const pending = scanFeedbackLayerProduction({
      repositoryRoot: root,
      outputDirectory: output,
    });
    await expect(pending).rejects.toThrow(
      /executable Feedback Layer pilot material reached production/,
    );
    await expect(pending).rejects.not.toThrow(root);
  });

  it("fails closed on missing or incomplete output", async () => {
    const root = await fs.mkdtemp(
      path.join(tmpdir(), "prompt-vault-feedback-production-missing-"),
    );
    roots.push(root);
    await expect(
      scanFeedbackLayerProduction({
        repositoryRoot: root,
        outputDirectory: path.join(root, "desktop", "dist"),
      }),
    ).rejects.toThrow(/missing or unreadable/);

    const incomplete = await fixture({ includeStylesheet: false });
    await expect(
      scanFeedbackLayerProduction({
        repositoryRoot: incomplete.root,
        outputDirectory: incomplete.output,
      }),
    ).rejects.toThrow(/missing generated \.css assets/);
  });

  it("rejects linked output files without exposing absolute paths", async () => {
    const { root, output, script } = await fixture();
    const shared = path.join(root, "shared.js");
    await fs.writeFile(shared, "console.log('shared');");
    await fs.rm(script);
    await fs.link(shared, script);

    const pending = scanFeedbackLayerProduction({
      repositoryRoot: root,
      outputDirectory: output,
    });
    await expect(pending).rejects.toThrow(
      "desktop/dist/assets/app.js",
    );
    await expect(pending).rejects.not.toThrow(root);
  });

  it("keeps the forbidden-marker inventory bounded and auditable", () => {
    expect(FORBIDDEN_PRODUCTION_MARKERS).toHaveLength(8);
    expect(
      FORBIDDEN_PRODUCTION_MARKERS.every(
        (marker) =>
          typeof marker.label === "string" &&
          marker.label.length < 80 &&
          marker.pattern instanceof RegExp,
      ),
    ).toBe(true);
  });
});
