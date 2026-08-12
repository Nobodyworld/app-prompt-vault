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

  it("requires external evidence and contained downloads", () => {
    expect(assertEvidencePath("C:\\tmp\\prompt-vault-evidence")).toMatch(/prompt-vault-evidence$/);
    expect(() => assertEvidencePath("C:\\Users\\Nobod\\Desktop")).toThrow("C:\\tmp");
    expect(assertDownloadPath("C:\\tmp\\prompt-vault-evidence\\backup.json", "C:\\tmp\\prompt-vault-evidence")).toMatch(/backup\.json$/);
    expect(() => assertDownloadPath("C:\\tmp\\outside.json", "C:\\tmp\\prompt-vault-evidence")).toThrow("inside evidence");
  });

  it("configures CDP downloads only inside local evidence", async () => {
    const transport = new FakeTransport();
    const view = new PromptVaultWebView(new CdpClient(transport));
    const configured = view.configureDownloadPath("C:\\tmp\\prompt-vault-evidence\\exports", "C:\\tmp\\prompt-vault-evidence");
    expect(JSON.parse(transport.sent[0]!)).toMatchObject({ method: "Browser.setDownloadBehavior", params: { behavior: "allow", downloadPath: "c:\\tmp\\prompt-vault-evidence\\exports" } });
    transport.respond({ id: 1, result: {} });
    await expect(configured).resolves.toBeUndefined();
    await expect(view.configureDownloadPath("C:\\tmp\\outside", "C:\\tmp\\prompt-vault-evidence")).rejects.toThrow("inside evidence");
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
