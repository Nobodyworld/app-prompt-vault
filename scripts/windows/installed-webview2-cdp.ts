import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInstalledRecoveryScenario } from "./installed-webview2-recovery-scenario.js";

export type JsonRecord = Record<string, unknown>;
export const PROMPT_VAULT_DOCUMENT_TITLE = "Prompt Vault Desktop";
const COMMAND_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 30_000;

export interface CdpMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: JsonRecord;
  readonly result?: JsonRecord;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export interface CdpTransport {
  send(message: string): void;
  close(): void;
  setHandlers(handlers: { onMessage: (message: string) => void; onClose: (reason?: string) => void }): void;
}

export class CdpProtocolError extends Error {
  public constructor(public readonly code: number, message: string, public readonly data?: unknown) {
    super(`CDP ${code}: ${message}`);
    this.name = "CdpProtocolError";
  }
}

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (result: JsonRecord) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly listeners = new Map<string, Set<(params: JsonRecord) => void>>();
  private closed = false;

  public constructor(private readonly transport: CdpTransport, private readonly defaultTimeoutMs = COMMAND_TIMEOUT_MS) {
    transport.setHandlers({ onMessage: (message) => this.handleMessage(message), onClose: (reason) => this.handleClose(reason) });
  }

  public command(method: string, params: JsonRecord = {}, timeoutMs = this.defaultTimeoutMs): Promise<JsonRecord> {
    if (this.closed) return Promise.reject(new Error("CDP connection is closed."));
    const id = this.nextId++;
    return new Promise<JsonRecord>((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCommand(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
      this.transport.send(JSON.stringify({ id, method, params }));
    });
  }

  public on(method: string, listener: (params: JsonRecord) => void): () => void {
    const set = this.listeners.get(method) ?? new Set<(params: JsonRecord) => void>();
    set.add(listener);
    this.listeners.set(method, set);
    return () => set.delete(listener);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.transport.close();
    this.handleClose("CDP client closed.");
  }

  private handleMessage(raw: string): void {
    let message: CdpMessage;
    try { message = JSON.parse(raw) as CdpMessage; } catch { return; }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new CdpProtocolError(message.error.code, message.error.message, message.error.data));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method) for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  private handleClose(reason?: string): void {
    if (this.closed && this.pending.size === 0) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error(reason ?? "CDP connection closed."));
    }
  }
}

class BrowserWebSocketTransport implements CdpTransport {
  private handlers?: { onMessage: (message: string) => void; onClose: (reason?: string) => void };
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.handlers?.onMessage(String(event.data)));
    socket.addEventListener("close", () => this.handlers?.onClose("WebSocket closed."));
    socket.addEventListener("error", () => this.handlers?.onClose("WebSocket error."));
  }

  public static async connect(url: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<BrowserWebSocketTransport> {
    assertLoopbackWebSocket(url);
    const socket = new WebSocket(url);
    try {
      await new Promise<void>((resolveOpen, rejectOpen) => {
        const timer = setTimeout(() => rejectOpen(new Error("Timed out opening CDP WebSocket.")), timeoutMs);
        socket.addEventListener("open", () => { clearTimeout(timer); resolveOpen(); }, { once: true });
        socket.addEventListener("error", () => { clearTimeout(timer); rejectOpen(new Error("CDP WebSocket failed to open.")); }, { once: true });
      });
      return new BrowserWebSocketTransport(socket);
    } catch (error) {
      socket.close();
      throw error;
    }
  }

  public send(message: string): void { this.socket.send(message); }
  public close(): void { this.socket.close(); }
  public setHandlers(handlers: { onMessage: (message: string) => void; onClose: (reason?: string) => void }): void { this.handlers = handlers; }
}

export interface DevToolsTarget {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly url: string;
  readonly webSocketDebuggerUrl?: string;
}

export function assertLoopbackAddress(address: string): void {
  const url = new URL(address);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("DevTools HTTP endpoint must use http://127.0.0.1 only.");
}

export function assertLoopbackWebSocket(address: string): void {
  const url = new URL(address);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1") throw new Error("CDP WebSocket must use ws://127.0.0.1 only.");
}

function isInstalledTauriUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "tauri:" || ((url.protocol === "https:" || url.protocol === "http:") && url.hostname === "tauri.localhost");
  } catch { return false; }
}

export function selectPromptVaultTarget(targets: readonly DevToolsTarget[]): DevToolsTarget {
  const matches = targets.filter((target) => target.type === "page" && target.title === PROMPT_VAULT_DOCUMENT_TITLE && isInstalledTauriUrl(target.url) && Boolean(target.webSocketDebuggerUrl));
  if (matches.length !== 1) throw new Error(`Expected exactly one installed Prompt Vault page target; found ${matches.length}.`);
  return matches[0]!;
}

export function redactEvidencePath(value: string): string {
  return value.replace(/[A-Za-z]:\\Users\\[^\\]+/gi, "<user-profile>").replace(/\\(?:prompt-vault\.db(?:-(?:wal|shm))?|WebView2(?:\\[^\\]*)*)/gi, "<private-path>");
}

export function assertEvidencePath(evidencePath: string): string {
  if (!isAbsolute(evidencePath)) throw new Error("Evidence path must be absolute.");
  const resolved = resolve(evidencePath);
  if (!/^C:\\tmp\\/i.test(resolved)) throw new Error("Evidence path must be under C:\\tmp.");
  return resolved;
}

export function assertDownloadPath(downloadPath: string, evidencePath: string): string {
  const root = `${resolve(evidencePath).toLowerCase()}\\`;
  const candidate = resolve(downloadPath).toLowerCase();
  if (!candidate.startsWith(root)) throw new Error("Download path must remain inside evidence directory.");
  return candidate;
}

export function assertSingleSemanticMatch<T>(matches: readonly T[], description: string): T {
  if (matches.length !== 1) throw new Error(`Expected exactly one ${description}; found ${matches.length}.`);
  return matches[0]!;
}

export interface SemanticElement {
  readonly tag: string;
  readonly role: string | null;
  readonly name: string;
  readonly disabled: boolean;
  readonly checked: boolean | null;
  readonly selected: boolean | null;
  readonly focusable: boolean;
  readonly visible: boolean;
}

type SemanticAction = "describe" | "click" | "focus" | "assert-focus" | "set-value" | "set-checked" | "select";

/** A fixed, serializable semantic selector—not an arbitrary page evaluator. */
export function buildSemanticExpression(criteria: { readonly role?: string; readonly name?: string; readonly label?: string; readonly value?: string; readonly checked?: boolean }, action: SemanticAction = "describe"): string {
  return `(() => {
    const criteria = ${JSON.stringify(criteria)};
    const action = ${JSON.stringify(action)};
    const controls = Array.from(document.querySelectorAll('[role],button,a,input,select,textarea'));
    const text = (node) => (node && node.textContent ? node.textContent.trim().replace(/\\s+/g, ' ') : '');
    const labelled = (element) => {
      const ids = (element.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
      const fromIds = ids.map((id) => text(document.getElementById(id))).filter(Boolean).join(' ');
      if (fromIds) return fromIds;
      if (element.getAttribute('aria-label')) return element.getAttribute('aria-label');
      if (element.labels && element.labels.length) return Array.from(element.labels).map(text).filter(Boolean).join(' ');
      const parentLabel = element.closest('label');
      if (parentLabel) return text(parentLabel);
      return text(element);
    };
    const roleOf = (element) => {
      if (element.getAttribute('role')) return element.getAttribute('role');
      if (element.tagName === 'BUTTON') return 'button';
      if (element.tagName === 'A' && element.hasAttribute('href')) return 'link';
      if (element.tagName === 'SELECT') return 'combobox';
      if (element.tagName === 'TEXTAREA') return 'textbox';
      if (element.tagName === 'INPUT') {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio') return type;
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        return 'textbox';
      }
      return '';
    };
    const visible = (element) => { const style = window.getComputedStyle(element); return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0; };
    const matched = controls.filter((element) => {
      const labelMatches = !criteria.label || labelled(element) === criteria.label;
      const roleMatches = !criteria.role || roleOf(element) === criteria.role;
      const nameMatches = !criteria.name || labelled(element) === criteria.name;
      return labelMatches && roleMatches && nameMatches;
    });
    if (matched.length !== 1) return { ok: false, count: matched.length };
    const element = matched[0];
    if (action === 'click') element.click();
    if (action === 'focus') element.focus();
    if (action === 'assert-focus' && document.activeElement !== element) return { ok: false, count: 1 };
    if (action === 'set-value') {
      const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (!setter || !setter.set) return { ok: false, count: 1 };
      setter.set.call(element, criteria.value || '');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (action === 'set-checked') {
      if (!(element.tagName === 'INPUT' && ((element.getAttribute('type') || '').toLowerCase() === 'checkbox' || (element.getAttribute('type') || '').toLowerCase() === 'radio'))) return { ok: false, count: 1 };
      if (element.checked !== Boolean(criteria.checked)) element.click();
    }
    if (action === 'select') {
      if (element.tagName !== 'SELECT') return { ok: false, count: 1 };
      element.value = criteria.value || '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, count: 1, element: { tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), name: labelled(element), disabled: Boolean(element.disabled), checked: element.tagName === 'INPUT' && ((element.getAttribute('type') || '').toLowerCase() === 'checkbox' || (element.getAttribute('type') || '').toLowerCase() === 'radio') ? Boolean(element.checked) : null, selected: element.getAttribute('aria-selected') === 'true' ? true : element.getAttribute('aria-selected') === 'false' ? false : null, focusable: element.tabIndex >= 0, visible: visible(element) } };
  })()`;
}

export class PromptVaultWebView {
  public constructor(private readonly cdp: CdpClient) {}

  public async enable(): Promise<void> {
    await Promise.all(["Runtime.enable", "Page.enable", "DOM.enable", "Accessibility.enable"].map((method) => this.cdp.command(method)));
  }

  public async evaluateValue<T>(expression: string): Promise<T> {
    const response = await this.cdp.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error("Installed WebView rejected a fixed semantic operation.");
    const remote = response.result as JsonRecord | undefined;
    if (!remote || remote.subtype === "error" || remote.type === "error") throw new Error("Installed WebView returned an exception for a fixed semantic operation.");
    if (typeof remote.unserializableValue === "string" || !("value" in remote)) throw new Error("Installed WebView did not return a serializable value for a fixed semantic operation.");
    return remote.value as T;
  }

  private async semantic(criteria: Parameters<typeof buildSemanticExpression>[0], action: SemanticAction = "describe"): Promise<SemanticElement> {
    const result = await this.evaluateValue<{ readonly ok: boolean; readonly count: number; readonly element?: SemanticElement }>(buildSemanticExpression(criteria, action));
    if (!result.ok || !result.element) throw new Error(`Expected exactly one semantic control; found ${result.count}.`);
    return result.element;
  }

  public async assertApplicationRoot(): Promise<void> {
    const found = await this.evaluateValue<boolean>("Boolean(document.querySelector('#root .app-shell'))");
    if (!found) throw new Error("Prompt Vault application root was not found in installed WebView.");
  }

  public async findByRole(role: string, name: string): Promise<SemanticElement[]> {
    try { return [await this.semantic({ role, name })]; } catch (error) { if (error instanceof Error && /found 0/.test(error.message)) return []; throw error; }
  }
  public async clickByRole(role: string, name: string): Promise<void> { await this.semantic({ role, name }, "click"); }
  public async focusByRole(role: string, name: string): Promise<void> { await this.semantic({ role, name }, "focus"); }
  public async setInputValueByLabel(label: string, value: string): Promise<void> { await this.semantic({ label, value }, "set-value"); }
  public async setCheckedByRole(role: "checkbox" | "radio", name: string, checked: boolean): Promise<void> { await this.semantic({ role, name, checked }, "set-checked"); }
  public async selectOptionByLabel(label: string, value: string): Promise<void> { await this.semantic({ label, value }, "select"); }
  public async waitForByRole(role: string, name: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<SemanticElement> { const deadline = Date.now() + timeoutMs; let lastError: unknown; while (Date.now() < deadline) { try { return await this.semantic({ role, name }); } catch (error) { lastError = error; await new Promise((resolveWait) => setTimeout(resolveWait, 100)); } } throw new Error(`Timed out waiting for ${role} named ${name}: ${lastError instanceof Error ? lastError.message : "not found"}`); }
  public async assertText(value: string, contained = true): Promise<void> { const found = await this.evaluateValue<boolean>(`(() => { const text = document.body ? document.body.innerText : ''; return ${contained ? "text.includes" : "text ==="}(${JSON.stringify(value)}); })()`); if (!found) throw new Error(`Expected installed WebView text ${contained ? "containing" : "equal to"} the requested safe assertion.`); }
  public async assertLiveRegion(value: string): Promise<void> { const found = await this.evaluateValue<boolean>(`Array.from(document.querySelectorAll('[aria-live],[role=alert]')).some((element) => (element.innerText || '').includes(${JSON.stringify(value)}))`); if (!found) throw new Error("Expected live status was not announced."); }
  public async assertRoute(pathname: string): Promise<void> { const actual = await this.evaluateValue<string>("window.location.pathname"); if (actual !== pathname) throw new Error(`Expected route ${pathname}, received ${actual}.`); }
  public async headingText(): Promise<string> { return this.evaluateValue<string>("document.querySelector('h1,h2,h3') ? document.querySelector('h1,h2,h3').textContent.trim() : ''"); }
  public async accessibilityTree(): Promise<JsonRecord[]> { const response = await this.cdp.command("Accessibility.getFullAXTree"); return (response.nodes as JsonRecord[] | undefined) ?? []; }
  public async captureScreenshot(path: string, evidencePath: string): Promise<{ readonly path: string; readonly redactedPath: string }> { assertDownloadPath(path, evidencePath); const response = await this.cdp.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); if (typeof response.data !== "string") throw new Error("CDP did not return screenshot data."); await writeFile(path, Buffer.from(response.data, "base64")); return { path, redactedPath: redactEvidencePath(path) }; }
  public async dispatchKey(key: string): Promise<void> { const map: Record<string, number> = { Enter: 13, Space: 32, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38 }; const code = map[key]; if (!code) throw new Error(`Unsupported constrained key: ${key}`); await this.cdp.command("Input.dispatchKeyEvent", { type: "keyDown", key, code: key === "Space" ? "Space" : key, windowsVirtualKeyCode: code }); await this.cdp.command("Input.dispatchKeyEvent", { type: "keyUp", key, code: key === "Space" ? "Space" : key, windowsVirtualKeyCode: code }); }
  public async assertFocus(role: string, name: string): Promise<void> { await this.semantic({ role, name }, "assert-focus"); }
  public async assertNoHorizontalOverflow(): Promise<void> { if (await this.evaluateValue<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth")) throw new Error("Installed WebView has horizontal overflow."); }
  public async configureDownloadPath(downloadPath: string, evidencePath: string): Promise<void> { await this.cdp.command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: assertDownloadPath(downloadPath, evidencePath), eventsEnabled: true }); }
  public async uploadFileByLabel(label: string, path: string): Promise<void> { await this.semantic({ label }, "describe"); const root = await this.cdp.command("DOM.getDocument", { depth: 1 }); const documentNodeId = (root.root as JsonRecord).nodeId; if (typeof documentNodeId !== "number") throw new Error("CDP did not return a document node."); const nodes = (await this.cdp.command("DOM.querySelectorAll", { nodeId: documentNodeId, selector: "input[type=file]" })).nodeIds; if (!Array.isArray(nodes) || nodes.length !== 1 || typeof nodes[0] !== "number") throw new Error("Expected exactly one approved file input."); await this.cdp.command("DOM.setFileInputFiles", { nodeId: nodes[0], files: [path] }); }
}

async function fetchJson<T>(url: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> {
  assertLoopbackAddress(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { signal: controller.signal }); if (!response.ok) throw new Error(`DevTools endpoint failed: ${response.status}`); return response.json() as Promise<T>; } finally { clearTimeout(timer); }
}

export async function waitForPromptVaultTarget(port: number, timeoutMs = READY_TIMEOUT_MS): Promise<DevToolsTarget> {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  await fetchJson<JsonRecord>(`${base}/json/version`);
  let lastError = "target not yet available";
  while (Date.now() < deadline) {
    try { return selectPromptVaultTarget(await fetchJson<DevToolsTarget[]>(`${base}/json/list`)); } catch (error) { lastError = error instanceof Error ? error.message : String(error); await new Promise((resolveWait) => setTimeout(resolveWait, 200)); }
  }
  throw new Error(`Installed Prompt Vault target did not become ready: ${lastError}`);
}

export async function runInstalledSelfTest(options: { readonly port: number; readonly evidencePath: string; readonly scenario?: "self-test" | "recovery" }): Promise<JsonRecord> {
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("CDP port must be a non-privileged TCP port.");
  const evidencePath = assertEvidencePath(options.evidencePath);
  await mkdir(evidencePath, { recursive: true });
  const target = await waitForPromptVaultTarget(options.port);
  const cdp = new CdpClient(await BrowserWebSocketTransport.connect(target.webSocketDebuggerUrl!));
  try {
    const view = new PromptVaultWebView(cdp); await view.enable(); await view.assertApplicationRoot();
    if (options.scenario === "recovery") {
      const evidence = await runInstalledRecoveryScenario({ view, evidencePath });
      return { scenario: "recovery", target: { id: target.id, title: target.title, url: target.url }, evidence };
    }
    const library = assertSingleSemanticMatch(await view.findByRole("link", "Library"), "Library link");
    await view.clickByRole("link", "Settings");
    const heading = await view.headingText(); if (heading !== "Settings") throw new Error(`Expected Settings heading, received ${heading || "none"}.`);
    const ax = await view.accessibilityTree(); await view.assertNoHorizontalOverflow();
    const screenshot = await view.captureScreenshot(resolve(evidencePath, "installed-webview-settings.png"), evidencePath);
    const safe = { target: { id: target.id, type: target.type, title: target.title, url: target.url }, heading, libraryFocusable: library.focusable, accessibilityNodeCount: ax.length, screenshot: screenshot.redactedPath };
    await writeFile(resolve(evidencePath, "installed-webview-self-test-summary.json"), JSON.stringify(safe, null, 2)); return safe;
  } finally { cdp.close(); }
}

function readOption(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function main(): Promise<void> { const portText = readOption("--port"); const evidencePath = readOption("--evidence"); const scenario = readOption("--scenario") ?? "self-test"; if (!portText || !evidencePath || (scenario !== "self-test" && scenario !== "recovery")) throw new Error("Usage: installed-webview2-cdp.ts --port <port> --evidence <absolute-path> [--scenario self-test|recovery]"); const summary = await runInstalledSelfTest({ port: Number(portText), evidencePath, scenario }); process.stdout.write(`${JSON.stringify(summary)}\n`); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
