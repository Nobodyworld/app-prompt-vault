import { z } from "zod";
import { assertDownloadPath, PromptVaultWebView } from "./installed-webview2-cdp.js";

const semantic = z.object({ role: z.enum(["button", "link", "checkbox", "radio", "textbox", "combobox"]), name: z.string().min(1) }).strict();
const operation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), target: semantic }).strict(),
  z.object({ kind: z.literal("wait"), target: semantic }).strict(),
  z.object({ kind: z.literal("focus"), target: semantic }).strict(),
  z.object({ kind: z.literal("set-value"), label: z.string().min(1), value: z.string() }).strict(),
  z.object({ kind: z.literal("select"), label: z.string().min(1), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("check"), target: semantic, checked: z.boolean() }).strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["Enter", "Space", "Escape", "Tab", "ArrowDown", "ArrowUp"]) }).strict(),
  z.object({ kind: z.literal("heading"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("text"), value: z.string().min(1), exact: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("live"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("route"), pathname: z.string().regex(/^\//) }).strict(),
  z.object({ kind: z.literal("overflow") }).strict(),
  z.object({ kind: z.literal("download"), relativePath: z.string().regex(/^[A-Za-z0-9._-]+\\[A-Za-z0-9._-]+$/) }).strict(),
  z.object({ kind: z.literal("upload"), label: z.string().min(1), relativePath: z.string().regex(/^[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)+$/) }).strict(),
  z.object({ kind: z.literal("screenshot"), relativePath: z.string().regex(/^[A-Za-z0-9._-]+\.png$/) }).strict(),
  z.object({ kind: z.literal("accessibility") }).strict(),
]);

export const installedRecoveryScenarioSchema = z.object({
  version: z.literal(1),
  name: z.literal("prompt-vault-installed-recovery"),
  operations: z.array(operation).min(1),
}).strict();
export type InstalledRecoveryScenario = z.infer<typeof installedRecoveryScenarioSchema>;

/**
 * Repository-owned constrained workflow. Fixture files and restore plans remain
 * production-generated; this document contains no JavaScript, selector, ID, or
 * fingerprint input and can therefore not become an arbitrary CDP evaluator.
 */
export const DEFAULT_INSTALLED_RECOVERY_SCENARIO: InstalledRecoveryScenario = {
  version: 1,
  name: "prompt-vault-installed-recovery",
  operations: [
    { kind: "click", target: { role: "link", name: "Settings" } },
    { kind: "heading", value: "Settings" },
    { kind: "click", target: { role: "button", name: "Check historical database" } },
    { kind: "overflow" },
    { kind: "accessibility" },
  ],
};

export function parseInstalledRecoveryScenario(value: unknown): InstalledRecoveryScenario {
  return installedRecoveryScenarioSchema.parse(value);
}

export async function runInstalledRecoveryScenario(options: { readonly view: PromptVaultWebView; readonly evidencePath: string; readonly scenario?: unknown }): Promise<readonly string[]> {
  const scenario = parseInstalledRecoveryScenario(options.scenario ?? DEFAULT_INSTALLED_RECOVERY_SCENARIO);
  const evidence: string[] = [];
  for (const step of scenario.operations) {
    switch (step.kind) {
      case "click": await options.view.clickByRole(step.target.role, step.target.name); break;
      case "wait": await options.view.waitForByRole(step.target.role, step.target.name); break;
      case "focus": await options.view.focusByRole(step.target.role, step.target.name); break;
      case "set-value": await options.view.setInputValueByLabel(step.label, step.value); break;
      case "select": await options.view.selectOptionByLabel(step.label, step.value); break;
      case "check": await options.view.setCheckedByRole(step.target.role as "checkbox" | "radio", step.target.name, step.checked); break;
      case "key": await options.view.dispatchKey(step.key); break;
      case "heading": if (await options.view.headingText() !== step.value) throw new Error(`Expected heading ${step.value}.`); break;
      case "text": await options.view.assertText(step.value, !step.exact); break;
      case "live": await options.view.assertLiveRegion(step.value); break;
      case "route": await options.view.assertRoute(step.pathname); break;
      case "overflow": await options.view.assertNoHorizontalOverflow(); break;
      case "download": await options.view.configureDownloadPath(assertDownloadPath(`${options.evidencePath}\\${step.relativePath}`, options.evidencePath), options.evidencePath); evidence.push(step.relativePath); break;
      case "upload": { const path = assertDownloadPath(`${options.evidencePath}\\${step.relativePath}`, options.evidencePath); await options.view.uploadFileByLabel(step.label, path); break; }
      case "screenshot": await options.view.captureScreenshot(`${options.evidencePath}\\${step.relativePath}`, options.evidencePath); evidence.push(step.relativePath); break;
      case "accessibility": if ((await options.view.accessibilityTree()).length === 0) throw new Error("Installed WebView accessibility tree was empty."); break;
    }
  }
  return evidence;
}
