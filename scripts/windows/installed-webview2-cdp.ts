import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type JsonRecord = Record<string, unknown>;

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

  public constructor(private readonly transport: CdpTransport, private readonly defaultTimeoutMs = 10_000) {
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

  public static async connect(url: string, timeoutMs = 10_000): Promise<BrowserWebSocketTransport> {
    assertLoopbackWebSocket(url);
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error("Timed out opening CDP WebSocket.")), timeoutMs);
      socket.addEventListener("open", () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); rejectOpen(new Error("CDP WebSocket failed to open.")); }, { once: true });
    });
    return new BrowserWebSocketTransport(socket);
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
  if (url.hostname !== "127.0.0.1") throw new Error(`DevTools endpoint must use 127.0.0.1, received ${url.hostname}.`);
}

export function assertLoopbackWebSocket(address: string): void {
  const url = new URL(address);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1") throw new Error("CDP WebSocket must use ws://127.0.0.1 only.");
}

function isInstalledTauriUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "tauri:" ||
      ((url.protocol === "https:" || url.protocol === "http:") && url.hostname === "tauri.localhost");
  } catch { return false; }
}

export function selectPromptVaultTarget(targets: readonly DevToolsTarget[]): DevToolsTarget {
  const matches = targets.filter((target) => target.type === "page" && target.title === "Prompt Vault" && isInstalledTauriUrl(target.url) && Boolean(target.webSocketDebuggerUrl));
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
}

export class PromptVaultWebView {
  public constructor(private readonly cdp: CdpClient) {}

  public async enable(): Promise<void> {
    await Promise.all(["Runtime.enable", "Page.enable", "DOM.enable", "Accessibility.enable"].map((method) => this.cdp.command(method)));
  }

  public async evaluateValue<T>(expression: string): Promise<T> {
    const result = await this.cdp.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const remote = result.result as JsonRecord | undefined;
    return remote?.value as T;
  }

  public async assertApplicationRoot(): Promise<void> {
    const found = await this.evaluateValue<boolean>("Boolean(document.querySelector('#root .app-shell'))");
    if (!found) throw new Error("Prompt Vault application root was not found in installed WebView.");
  }

  public async findByRole(role: string, name: string): Promise<SemanticElement[]> {
    const encodedRole = JSON.stringify(role);
    const encodedName = JSON.stringify(name);
    return this.evaluateValue<SemanticElement[]>(`(() => [...document.querySelectorAll('[role],button,a,input,select,textarea')].filter((element) => { const role = element.getAttribute('role') || (element instanceof HTMLButtonElement ? 'button' : element instanceof HTMLAnchorElement ? 'link' : element instanceof HTMLInputElement ? (element.type === 'checkbox' ? 'checkbox' : 'textbox') : element instanceof HTMLSelectElement ? 'combobox' : element instanceof HTMLTextAreaElement ? 'textbox' : ''); const name = element.getAttribute('aria-label') || element.textContent?.trim() || ''; return role === ${encodedRole} && name === ${encodedName}; }).map((element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), name: element.getAttribute('aria-label') || element.textContent?.trim() || '', disabled: 'disabled' in element && Boolean((element as HTMLButtonElement).disabled), checked: element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : null, selected: element.getAttribute('aria-selected') === 'true' ? true : element.getAttribute('aria-selected') === 'false' ? false : null, focusable: element.tabIndex >= 0 }))`) ?? [];
  }

  public async clickByRole(role: string, name: string): Promise<void> {
    const match = assertSingleSemanticMatch(await this.findByRole(role, name), `${role} named ${name}`);
    const clicked = await this.evaluateValue<boolean>(`(() => { const targets = [...document.querySelectorAll('[role],button,a,input,select,textarea')].filter((element) => { const role = element.getAttribute('role') || (element instanceof HTMLButtonElement ? 'button' : element instanceof HTMLAnchorElement ? 'link' : ''); const name = element.getAttribute('aria-label') || element.textContent?.trim() || ''; return role === ${JSON.stringify(role)} && name === ${JSON.stringify(name)}; }); if (targets.length !== 1) return false; (targets[0] as HTMLElement).click(); return true; })()`);
    if (!clicked || !match) throw new Error(`Unable to activate ${role} named ${name}.`);
  }

  public async findByLabel(label: string): Promise<SemanticElement[]> {
    const encodedLabel = JSON.stringify(label);
    return this.evaluateValue<SemanticElement[]>(`(() => {
      const labels = [...document.querySelectorAll('label')].filter((candidate) => candidate.textContent?.trim() === ${encodedLabel});
      const controls = labels.map((candidate) => candidate.htmlFor ? document.getElementById(candidate.htmlFor) : candidate.querySelector('input,select,textarea')).filter(Boolean);
      return controls.map((element) => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), name: element.getAttribute('aria-label') || '', disabled: 'disabled' in element && Boolean((element as HTMLInputElement).disabled), checked: element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : null, selected: element.getAttribute('aria-selected') === 'true' ? true : element.getAttribute('aria-selected') === 'false' ? false : null, focusable: element.tabIndex >= 0 }));
    })()`) ?? [];
  }

  public async setInputValueByLabel(label: string, value: string): Promise<void> {
    const controls = await this.findByLabel(label);
    assertSingleSemanticMatch(controls, `control labelled ${label}`);
    const updated = await this.evaluateValue<boolean>(`(() => {
      const labels = [...document.querySelectorAll('label')].filter((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
      const controls = labels.map((candidate) => candidate.htmlFor ? document.getElementById(candidate.htmlFor) : candidate.querySelector('input,select,textarea')).filter(Boolean);
      if (controls.length !== 1) return false;
      const control = controls[0] as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      descriptor?.set?.call(control, ${JSON.stringify(value)});
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!updated) throw new Error(`Unable to set control labelled ${label}.`);
  }

  public async headingText(): Promise<string> {
    return this.evaluateValue<string>("document.querySelector('h1,h2,h3')?.textContent?.trim() || ''");
  }

  public async accessibilityTree(): Promise<JsonRecord[]> {
    const response = await this.cdp.command("Accessibility.getFullAXTree");
    return (response.nodes as JsonRecord[] | undefined) ?? [];
  }

  public async captureScreenshot(path: string, evidencePath: string): Promise<{ readonly path: string; readonly redactedPath: string }> {
    assertDownloadPath(path, evidencePath);
    const response = await this.cdp.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const data = response.data;
    if (typeof data !== "string") throw new Error("CDP did not return screenshot data.");
    await writeFile(path, Buffer.from(data, "base64"));
    return { path, redactedPath: redactEvidencePath(path) };
  }

  public async pressTab(): Promise<void> {
    await this.cdp.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await this.cdp.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  }

  public async assertFocus(role: string, name: string): Promise<void> {
    const focused = await this.evaluateValue<boolean>(`(() => {
      const element = document.activeElement;
      if (!element) return false;
      const actualRole = element.getAttribute('role') || (element instanceof HTMLButtonElement ? 'button' : element instanceof HTMLAnchorElement ? 'link' : '');
      const actualName = element.getAttribute('aria-label') || element.textContent?.trim() || '';
      return actualRole === ${JSON.stringify(role)} && actualName === ${JSON.stringify(name)};
    })()`);
    if (!focused) throw new Error(`Expected focus on ${role} named ${name}.`);
  }

  public async assertNoHorizontalOverflow(): Promise<void> {
    const overflow = await this.evaluateValue<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth");
    if (overflow) throw new Error("Installed WebView has horizontal overflow.");
  }

  public async configureDownloadPath(downloadPath: string, evidencePath: string): Promise<void> {
    const safePath = assertDownloadPath(downloadPath, evidencePath);
    await this.cdp.command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: safePath, eventsEnabled: true });
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  assertLoopbackAddress(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`DevTools endpoint failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function runInstalledSelfTest(options: { readonly port: number; readonly evidencePath: string }): Promise<JsonRecord> {
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("CDP port must be a non-privileged TCP port.");
  const evidencePath = assertEvidencePath(options.evidencePath);
  await mkdir(evidencePath, { recursive: true });
  const base = `http://127.0.0.1:${options.port}`;
  await fetchJson<JsonRecord>(`${base}/json/version`);
  const targets = await fetchJson<DevToolsTarget[]>(`${base}/json/list`);
  const target = selectPromptVaultTarget(targets);
  const transport = await BrowserWebSocketTransport.connect(target.webSocketDebuggerUrl!);
  const cdp = new CdpClient(transport);
  try {
    const view = new PromptVaultWebView(cdp);
    await view.enable();
    await view.assertApplicationRoot();
    const library = assertSingleSemanticMatch(await view.findByRole("link", "Library"), "Library link");
    await view.clickByRole("link", "Settings");
    const heading = await view.headingText();
    if (heading !== "Settings") throw new Error(`Expected Settings heading, received ${heading || "none"}.`);
    const ax = await view.accessibilityTree();
    await view.assertNoHorizontalOverflow();
    const screenshot = await view.captureScreenshot(resolve(evidencePath, "installed-webview-settings.png"), evidencePath);
    const safe = { target: { id: target.id, type: target.type, title: target.title, url: target.url }, heading, libraryFocusable: library.focusable, accessibilityNodeCount: ax.length, screenshot: screenshot.redactedPath };
    await writeFile(resolve(evidencePath, "installed-webview-self-test-summary.json"), JSON.stringify(safe, null, 2));
    return safe;
  } finally { cdp.close(); }
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const portText = readOption("--port");
  const evidencePath = readOption("--evidence");
  if (!portText || !evidencePath) throw new Error("Usage: installed-webview2-cdp.ts --port <port> --evidence <absolute-path>");
  const summary = await runInstalledSelfTest({ port: Number(portText), evidencePath });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
