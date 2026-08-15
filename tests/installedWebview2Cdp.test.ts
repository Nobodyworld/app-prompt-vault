// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CdpClient,
  CdpProtocolError,
  PROMPT_VAULT_DOCUMENT_TITLE,
  PromptVaultWebView,
  assertDownloadPath,
  assertEvidencePath,
  assertWindowsPathInside,
  canonicalWindowsPath,
  assertLoopbackAddress,
  assertLoopbackWebSocket,
  assertSingleSemanticMatch,
  buildSemanticExpression,
  redactEvidencePath,
  selectPromptVaultTarget,
  type CdpTransport,
  type DevToolsTarget,
} from "../scripts/windows/installed-webview2-cdp.js";

class FakeTransport implements CdpTransport {
  public readonly sent: string[] = [];
  private handlers?: { onMessage: (message: string) => void; onClose: (reason?: string) => void };

  public send(message: string): void { this.sent.push(message); }
  public close(): void { this.handlers?.onClose("fake close"); }
  public setHandlers(handlers: { onMessage: (message: string) => void; onClose: (reason?: string) => void }): void { this.handlers = handlers; }
  public respond(message: object): void { this.handlers?.onMessage(JSON.stringify(message)); }
  public disconnect(reason = "fake disconnected"): void { this.handlers?.onClose(reason); }
}

const target = (overrides: Partial<DevToolsTarget> = {}): DevToolsTarget => ({
  id: "page-1", type: "page", title: PROMPT_VAULT_DOCUMENT_TITLE, url: "tauri://localhost/", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/page-1", ...overrides,
});

describe("installed WebView2 CDP harness", () => {
  afterEach(() => vi.useRealTimers());

  it("correlates monotonically increasing requests and events", async () => {
    const transport = new FakeTransport();
    const client = new CdpClient(transport);
    const event = vi.fn();
    client.on("Page.loadEventFired", event);
    const first = client.command("Runtime.enable");
    const second = client.command("Page.enable");
    expect(transport.sent.map((message) => JSON.parse(message).id)).toEqual([1, 2]);
    transport.respond({ method: "Page.loadEventFired", params: { timestamp: 1 } });
    transport.respond({ id: 2, result: { page: true } });
    transport.respond({ id: 1, result: { runtime: true } });
    await expect(first).resolves.toEqual({ runtime: true });
    await expect(second).resolves.toEqual({ page: true });
    expect(event).toHaveBeenCalledWith({ timestamp: 1 });
  });

  it("propagates protocol errors", async () => {
    const transport = new FakeTransport();
    const client = new CdpClient(transport);
    const pending = client.command("DOM.enable");
    transport.respond({ id: 1, error: { code: -32601, message: "Method not found" } });
    await expect(pending).rejects.toBeInstanceOf(CdpProtocolError);
  });

  it("turns Runtime.evaluate exceptions and missing values into actionable failures", async () => {
    const transport = new FakeTransport();
    const view = new PromptVaultWebView(new CdpClient(transport));
    const exception = view.evaluateValue("fixed semantic expression");
    transport.respond({ id: 1, result: { exceptionDetails: { text: "SyntaxError" }, result: { type: "object", subtype: "error" } } });
    await expect(exception).rejects.toThrow("rejected a fixed semantic operation");
    const missing = view.evaluateValue("fixed semantic expression");
    transport.respond({ id: 2, result: { result: { type: "undefined" } } });
    await expect(missing).rejects.toThrow("serializable value");
  });

  it("times out pending commands", async () => {
    vi.useFakeTimers();
    const client = new CdpClient(new FakeTransport(), 10);
    const pending = client.command("Runtime.enable");
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
  });

  it("rejects pending commands when the socket closes", async () => {
    const transport = new FakeTransport();
    const client = new CdpClient(transport);
    const pending = client.command("Runtime.enable");
    transport.disconnect();
    await expect(pending).rejects.toThrow("fake disconnected");
  });

  it("selects one installed Tauri page target", () => {
    expect(selectPromptVaultTarget([target(), target({ type: "service_worker", id: "worker" })])).toMatchObject({ id: "page-1" });
  });

  it("ties target identity to the production document title", async () => {
    const index = await readFile(resolve("desktop/index.html"), "utf8");
    expect(index).toContain(`<title>${PROMPT_VAULT_DOCUMENT_TITLE}</title>`);
    expect(() => selectPromptVaultTarget([target({ title: "Prompt Vault" })])).toThrow("exactly one");
  });

  it("rejects titleless, non-Tauri, and multiple targets", () => {
    expect(() => selectPromptVaultTarget([target({ title: "" })])).toThrow("exactly one");
    expect(() => selectPromptVaultTarget([target({ url: "http://localhost:1420" })])).toThrow("exactly one");
    expect(() => selectPromptVaultTarget([target(), target({ id: "page-2" })])).toThrow("exactly one");
  });

  it("enforces loopback-only HTTP and WebSocket endpoints", () => {
    expect(() => assertLoopbackAddress("http://127.0.0.1:9222/json/list")).not.toThrow();
    expect(() => assertLoopbackAddress("http://0.0.0.0:9222/json/list")).toThrow("127.0.0.1");
    expect(() => assertLoopbackAddress("http://[::1]:9222/json/list")).toThrow("127.0.0.1");
    expect(() => assertLoopbackWebSocket("ws://127.0.0.1:9222/devtools/page/a")).not.toThrow();
    expect(() => assertLoopbackWebSocket("ws://192.168.1.10:9222/devtools/page/a")).toThrow("127.0.0.1");
  });

  it("models Windows evidence containment independently of the host platform", () => {
    expect(assertEvidencePath("C:\\tmp\\prompt-vault-evidence")).toBe("C:\\tmp\\prompt-vault-evidence");
    expect(assertEvidencePath("c:/TMP/mixed-case")).toBe("C:\\TMP\\mixed-case");
    expect(canonicalWindowsPath("C:\\tmp\\root\\..\\evidence")).toBe("C:\\tmp\\evidence");
    expect(assertWindowsPathInside("C:\\tmp\\evidence\\child.json", "C:\\tmp\\evidence")).toBe("C:\\tmp\\evidence\\child.json");
    expect(() => assertWindowsPathInside("C:\\tmp\\evidence", "C:\\tmp\\evidence")).toThrow("inside");
    expect(() => assertEvidencePath("relative\\evidence")).toThrow("absolute Windows");
    expect(() => assertEvidencePath("C:\\Users\\Nobod\\Desktop")).toThrow("inside");
    expect(() => assertWindowsPathInside("C:\\tmp\\sibling\\a.json", "C:\\tmp\\evidence")).toThrow("inside");
    expect(() => assertWindowsPathInside("C:\\tmp\\evidence\\..\\outside.json", "C:\\tmp\\evidence")).toThrow("inside");
    expect(() => canonicalWindowsPath("D:\\tmp\\evidence")).toThrow("C: drive");
    expect(() => canonicalWindowsPath("\\\\server\\share\\evidence")).toThrow("UNC");
    expect(() => canonicalWindowsPath("\\\\?\\C:\\tmp\\evidence")).toThrow("UNC or device");
  });

  it("configures CDP downloads only inside local evidence", async () => {
    const transport = new FakeTransport();
    const view = new PromptVaultWebView(new CdpClient(transport));
    const configured = view.configureDownloadPath("C:\\tmp\\prompt-vault-evidence\\exports", "C:\\tmp\\prompt-vault-evidence");
    expect(JSON.parse(transport.sent[0]!)).toMatchObject({ method: "Browser.setDownloadBehavior", params: { behavior: "allow", downloadPath: "C:\\tmp\\prompt-vault-evidence\\exports" } });
    transport.respond({ id: 1, result: {} });
    await expect(configured).resolves.toBeUndefined();
    await expect(view.configureDownloadPath("C:\\tmp\\outside", "C:\\tmp\\prompt-vault-evidence")).rejects.toThrow("inside the evidence");
    await expect(view.captureScreenshot("C:\\tmp\\outside.png", "C:\\tmp\\prompt-vault-evidence")).rejects.toThrow("inside the evidence");
    await expect(view.uploadFileByLabel("Choose backup JSON", "C:\\tmp\\outside.json", "C:\\tmp\\prompt-vault-evidence")).rejects.toThrow("inside the evidence");
  });

  it("waits for delayed live status with a bounded sanitized timeout", async () => {
    const transport = new FakeTransport(); const view = new PromptVaultWebView(new CdpClient(transport, 1_000));
    const pending = view.waitForLiveRegion("compatible", 250, 10);
    transport.respond({ id: 1, result: { result: { type: "string", value: "checking" } } });
    await new Promise((resolveWait) => setTimeout(resolveWait, 12));
    transport.respond({ id: 2, result: { result: { type: "string", value: "Status: compatible" } } });
    await expect(pending).resolves.toBeUndefined();
    await expect(view.waitForLiveRegion("expected", 24, 10)).rejects.toThrow("bounded timeout");
    await expect(view.waitForLiveRegion("expected", 25, 9)).rejects.toThrow("10–250 ms");
  });

  it("handles an expected revert confirmation concurrently with the click", async () => {
    const transport = new FakeTransport(); const view = new PromptVaultWebView(new CdpClient(transport));
    const pending = view.versionAction("1.0.0", "revert");
    expect(JSON.parse(transport.sent[0]!).method).toBe("Runtime.evaluate");
    transport.respond({ method: "Page.javascriptDialogOpening", params: { type: "confirm", message: "Revert to v1.0.0? This will create a new version." } });
    expect(JSON.parse(transport.sent[1]!).method).toBe("Page.handleJavaScriptDialog");
    transport.respond({ id: 2, result: {} });
    transport.respond({ id: 1, result: { result: { type: "object", value: { ok: true, count: 1 } } } });
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects an unexpected revert confirmation dialog without accepting it", async () => {
    const transport = new FakeTransport(); const view = new PromptVaultWebView(new CdpClient(transport));
    const pending = view.versionAction("1.0.0", "revert");
    transport.respond({ method: "Page.javascriptDialogOpening", params: { type: "alert", message: "unexpected" } });
    transport.respond({ id: 1, result: { result: { type: "object", value: { ok: true, count: 1 } } } });
    await expect(pending).rejects.toThrow("Unexpected or duplicate");
    expect(transport.sent.map((message) => JSON.parse(message).method)).not.toContain("Page.handleJavaScriptDialog");
  });

  it("rejects duplicate revert confirmation dialogs after accepting the first", async () => {
    const transport = new FakeTransport(); const view = new PromptVaultWebView(new CdpClient(transport));
    const pending = view.versionAction("1.0.0", "revert");
    transport.respond({ method: "Page.javascriptDialogOpening", params: { type: "confirm", message: "Revert to v1.0.0? This will create a new version." } });
    transport.respond({ id: 2, result: {} });
    transport.respond({ method: "Page.javascriptDialogOpening", params: { type: "confirm", message: "Revert to v1.0.0? This will create a new version." } });
    transport.respond({ id: 1, result: { result: { type: "object", value: { ok: true, count: 1 } } } });
    await expect(pending).rejects.toThrow("Unexpected or duplicate");
  });

  it("rejects revert when the approved dialog handler fails", async () => {
    const transport = new FakeTransport(); const view = new PromptVaultWebView(new CdpClient(transport));
    const pending = view.versionAction("1.0.0", "revert");
    transport.respond({ method: "Page.javascriptDialogOpening", params: { type: "confirm", message: "Revert to v1.0.0? This will create a new version." } });
    transport.respond({ id: 2, error: { code: -32000, message: "dialog already closed" } });
    transport.respond({ id: 1, result: { result: { type: "object", value: { ok: true, count: 1 } } } });
    await expect(pending).rejects.toThrow("dialog already closed");
  });

  it("rejects revert when its semantic click cannot be completed", async () => {
    const transport = new FakeTransport(); const view = new PromptVaultWebView(new CdpClient(transport));
    const pending = view.versionAction("1.0.0", "revert");
    transport.respond({ id: 1, result: { result: { type: "object", value: { ok: false, count: 0 } } } });
    await expect(pending).rejects.toThrow("Expected one revert action");
  });

  it("times out a missing revert dialog after a successful click", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport(); const view = new PromptVaultWebView(new CdpClient(transport));
    const pending = view.versionAction("1.0.0", "revert");
    transport.respond({ id: 1, result: { result: { type: "object", value: { ok: true, count: 1 } } } });
    const assertion = expect(pending).rejects.toThrow("Timed out waiting for revert confirmation dialog");
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });

  it("verifies deterministic version history and safe last-backup metadata through fixed CDP operations", async () => {
    const transport = new FakeTransport(); const view = new PromptVaultWebView(new CdpClient(transport));
    const history = view.assertVersionHistory(["1.2.1", "1.2.0", "1.1.0", "1.0.0"]);
    transport.respond({ id: 1, result: { result: { type: "object", value: ["1.2.1", "1.2.0", "1.1.0", "1.0.0"] } } });
    await expect(history).resolves.toBeUndefined();
    const backup = view.assertLastBackupMetadata(1, 2);
    transport.respond({ id: 2, result: { result: { type: "object", value: { valid: true, keyCount: 5 } } } });
    await expect(backup).resolves.toBeUndefined();
    const invalidBackup = view.assertLastBackupMetadata(1, 2);
    transport.respond({ id: 3, result: { result: { type: "object", value: { valid: false, keyCount: 6 } } } });
    await expect(invalidBackup).rejects.toThrow("safe 2.0 verification record");
  });

  it("rejects ambiguous semantic matches", () => {
    expect(assertSingleSemanticMatch(["Settings"], "Settings button")).toBe("Settings");
    expect(() => assertSingleSemanticMatch([], "Settings button")).toThrow("exactly one");
    expect(() => assertSingleSemanticMatch(["a", "b"], "Settings button")).toThrow("found 2");
  });

  it("redacts user and database paths in safe evidence metadata", () => {
    const redacted = redactEvidencePath("C:\\Users\\Nobod\\AppData\\Local\\com.nobodyworld.promptvault\\prompt-vault.db");
    expect(redacted).not.toContain("Nobod");
    expect(redacted).not.toContain("prompt-vault.db");
    expect(redacted).toContain("<user-profile>");
  });

  it("executes every generated semantic expression as plain JavaScript", () => {
    document.body.innerHTML = '<label for="title">Title</label><input id="title" value="old"><label><input type="checkbox"> Confirm</label><label for="policy">Conflict policy</label><select id="policy"><option value="skip-existing">Skip existing</option><option value="import-as-copy">Copy</option></select><button>Save</button><a href="/settings">Settings</a><textarea aria-label="Prompt"></textarea>';
    const expressions = [
      buildSemanticExpression({ role: "button", name: "Save" }),
      buildSemanticExpression({ role: "link", name: "Settings" }, "click"),
      buildSemanticExpression({ label: "Title", value: "new" }, "set-value"),
      buildSemanticExpression({ role: "checkbox", name: "Confirm", checked: true }, "set-checked"),
      buildSemanticExpression({ label: "Conflict policy", value: "import-as-copy" }, "select"),
    ];
    for (const expression of expressions) expect(new Function(`return ${expression}`)()).toMatchObject({ ok: true, count: 1 });
    expect((document.querySelector("#title") as HTMLInputElement).value).toBe("new");
    expect((document.querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector("#policy") as HTMLSelectElement).value).toBe("import-as-copy");
    expect(expressions.join("\n")).not.toMatch(/\sas\sHTML|as HTMLElement|as HTMLInputElement/);
  });
});
