import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { win32 } from "node:path";
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

function isWindowsDeviceOrUncPath(value: string): boolean {
  return /^(?:\\\\[?.]\\|\\\\)/.test(value.replaceAll("/", "\\"));
}

/**
 * Acceptance paths are Windows paths even when their unit tests run on Linux.
 * Never use host `path.resolve()` here: it changes C:\\ paths into checkout paths.
 */
export function canonicalWindowsPath(value: string, description = "path"): string {
  if (isWindowsDeviceOrUncPath(value)) throw new Error(`${description} must not use UNC or device path syntax.`);
  if (!win32.isAbsolute(value)) throw new Error(`${description} must be an absolute Windows path.`);
  const normalized = win32.resolve(value);
  if (!/^[cC]:\\/.test(normalized)) throw new Error(`${description} must use the C: drive.`);
  return `C:${normalized.slice(2)}`;
}

export function assertWindowsPathInside(candidatePath: string, rootPath: string, description = "path"): string {
  const root = canonicalWindowsPath(rootPath, "evidence root");
  const candidate = canonicalWindowsPath(candidatePath, description);
  const relative = win32.relative(root, candidate);
  if (!relative || relative === "." || relative.startsWith("..") || win32.isAbsolute(relative)) {
    throw new Error(`${description} must remain inside the evidence directory.`);
  }
  return candidate;
}

export function assertEvidencePath(evidencePath: string): string {
  const canonical = canonicalWindowsPath(evidencePath, "Evidence path");
  return assertWindowsPathInside(canonical, "C:\\tmp", "Evidence path");
}

export function assertDownloadPath(downloadPath: string, evidencePath: string): string {
  return assertWindowsPathInside(downloadPath, evidencePath, "Download path");
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
  public async waitForText(value: string, contained = true, timeoutMs = COMMAND_TIMEOUT_MS): Promise<void> { const deadline = Date.now() + timeoutMs; let lastError: unknown; while (Date.now() < deadline) { try { await this.assertText(value, contained); return; } catch (error) { lastError = error; await new Promise((resolveWait) => setTimeout(resolveWait, 100)); } } throw lastError instanceof Error ? lastError : new Error("Timed out waiting for installed WebView text."); }
  public async assertLiveRegion(value: string): Promise<void> { const found = await this.evaluateValue<boolean>(`Array.from(document.querySelectorAll('[aria-live],[role=alert]')).some((element) => (element.innerText || '').includes(${JSON.stringify(value)}))`); if (!found) throw new Error("Expected live status was not announced."); }
  public async waitForLiveRegion(value: string, timeoutMs = COMMAND_TIMEOUT_MS, intervalMs = 100): Promise<void> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > COMMAND_TIMEOUT_MS || !Number.isInteger(intervalMs) || intervalMs < 10 || intervalMs > 250) throw new Error("Live-region wait requires a bounded timeout and a 10–250 ms polling interval.");
    const deadline = Date.now() + timeoutMs; let last = "no live status";
    while (Date.now() < deadline) {
      const live = await this.evaluateValue<string>("Array.from(document.querySelectorAll('[aria-live],[role=alert]')).map((element) => (element.innerText || '').replace(/\\s+/g, ' ').trim()).join(' | ').slice(0, 240)");
      last = live ? `non-empty live status (length=${live.length}, sha256=${createHash("sha256").update(live).digest("hex").slice(0, 16)})` : "empty live status";
      if (live.includes(value)) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
    }
    throw new Error(`Timed out waiting for live status ${JSON.stringify(value)}; last observed: ${JSON.stringify(last)}.`);
  }
  public async assertRoute(pathname: string): Promise<void> { const actual = await this.evaluateValue<string>("window.location.pathname"); if (actual !== pathname) throw new Error(`Expected route ${pathname}, received ${actual}.`); }
  public async headingText(): Promise<string> { return this.evaluateValue<string>("document.querySelector('h1,h2,h3') ? document.querySelector('h1,h2,h3').textContent.trim() : ''"); }
  public async accessibilityTree(): Promise<JsonRecord[]> { const response = await this.cdp.command("Accessibility.getFullAXTree"); return (response.nodes as JsonRecord[] | undefined) ?? []; }
  public async captureScreenshot(path: string, evidencePath: string): Promise<{ readonly path: string; readonly redactedPath: string }> { const safePath = assertDownloadPath(path, evidencePath); const response = await this.cdp.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); if (typeof response.data !== "string") throw new Error("CDP did not return screenshot data."); await writeFile(safePath, Buffer.from(response.data, "base64")); return { path: safePath, redactedPath: redactEvidencePath(safePath) }; }
  public async dispatchKey(key: string): Promise<void> { const map: Record<string, number> = { Enter: 13, Space: 32, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38 }; const code = map[key]; if (!code) throw new Error(`Unsupported constrained key: ${key}`); await this.cdp.command("Input.dispatchKeyEvent", { type: "keyDown", key, code: key === "Space" ? "Space" : key, windowsVirtualKeyCode: code }); await this.cdp.command("Input.dispatchKeyEvent", { type: "keyUp", key, code: key === "Space" ? "Space" : key, windowsVirtualKeyCode: code }); }
  public async assertFocus(role: string, name: string): Promise<void> { await this.semantic({ role, name }, "assert-focus"); }
  public async assertNoHorizontalOverflow(): Promise<void> { if (await this.evaluateValue<boolean>("document.documentElement.scrollWidth > document.documentElement.clientWidth")) throw new Error("Installed WebView has horizontal overflow."); }
  public async configureDownloadPath(downloadPath: string, evidencePath: string): Promise<void> { const canonical = assertDownloadPath(downloadPath, evidencePath); await this.cdp.command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: canonical, eventsEnabled: true }); }
  /** CDP events are supplementary evidence; directory verification stays authoritative. */
  public observeDownloadNames(): { readonly names: () => readonly string[]; readonly dispose: () => void } {
    const observed: string[] = [];
    const dispose = this.cdp.on("Browser.downloadWillBegin", (params) => {
      const suggested = params.suggestedFilename;
      if (typeof suggested === "string" && /^[A-Za-z0-9._-]+\.json$/.test(suggested)) observed.push(suggested);
    });
    return { names: () => [...observed], dispose };
  }
  public async uploadFileByLabel(label: string, path: string, evidencePath: string): Promise<void> { const canonical = assertDownloadPath(path, evidencePath); await this.semantic({ label }, "describe"); const root = await this.cdp.command("DOM.getDocument", { depth: 1 }); const documentNodeId = (root.root as JsonRecord).nodeId; if (typeof documentNodeId !== "number") throw new Error("CDP did not return a document node."); const nodes = (await this.cdp.command("DOM.querySelectorAll", { nodeId: documentNodeId, selector: "input[type=file]" })).nodeIds; if (!Array.isArray(nodes) || nodes.length !== 1 || typeof nodes[0] !== "number") throw new Error("Expected exactly one approved file input."); await this.cdp.command("DOM.setFileInputFiles", { nodeId: nodes[0], files: [canonical] }); }
  public async assertLastBackupMetadata(promptCount: number, versionCount: number): Promise<void> {
    const result = await this.evaluateValue<{ readonly valid: boolean; readonly keyCount: number }>(`(() => {
      const raw = localStorage.getItem('prompt-vault:last-backup:v1'); if (!raw) return { valid: false, keyCount: 0 };
      try {
        const value = JSON.parse(raw); const keys = Object.keys(value).sort(); const expected = ['backupFormat','promptCount','timestamp','verificationResult','versionCount'];
        const privateKey = Object.keys(value).some((key) => /body|path|machine|telemetry|token|api.?key/i.test(key));
        return { valid: !privateKey && JSON.stringify(keys) === JSON.stringify(expected) && value.backupFormat === '2.0' && value.verificationResult === 'verified' && value.promptCount === ${promptCount} && value.versionCount === ${versionCount} && typeof value.timestamp === 'string', keyCount: keys.length };
      } catch { return { valid: false, keyCount: 0 }; }
    })()`);
    if (!result.valid) throw new Error("Last verified backup metadata was not persisted as the expected safe 2.0 verification record.");
  }
  public async assertVersionHistory(semanticVersions: readonly string[]): Promise<void> {
    const actual = await this.evaluateValue<readonly string[]>(`(() => Array.from(document.querySelectorAll('.version-history__item')).map((row) => { const match = (row.textContent || '').match(/v(\\d+\\.\\d+\\.\\d+)/); return match ? match[1] : ''; }).filter(Boolean))()`);
    if (JSON.stringify(actual) !== JSON.stringify(semanticVersions)) throw new Error(`Version history did not preserve the expected deterministic chain: ${semanticVersions.join(", ")}.`);
  }
  public async versionAction(semanticVersion: string, action: "preview" | "compare" | "close-preview" | "revert"): Promise<void> {
    if (!/^\d+\.\d+\.\d+$/.test(semanticVersion)) throw new Error("Version action requires a semantic version.");
    if (action === "revert") return this.confirmRevert(semanticVersion);
    const result = await this.evaluateValue<{ readonly ok: boolean; readonly count: number }>(`(() => {
      const version = ${JSON.stringify(semanticVersion)}; const action = ${JSON.stringify(action)};
      const rows = Array.from(document.querySelectorAll('.version-history__item')).filter((row) => (row.textContent || '').includes('v' + version));
      if (rows.length !== 1) return { ok: false, count: rows.length };
      const row = rows[0];
      const target = action === 'compare' ? document.querySelector('.version-history__preview summary') : action === 'close-preview' ? document.querySelector('.version-history__preview button') : Array.from(row.querySelectorAll('button')).find((button) => (button.textContent || '').trim() === 'Preview');
      if (!target || (target instanceof HTMLButtonElement && target.disabled)) return { ok: false, count: 0 };
      target.click(); return { ok: true, count: 1 };
    })()`);
    if (!result.ok) throw new Error(`Expected exactly one version-history ${action} operation; found ${result.count}.`);
  }
  private async confirmRevert(semanticVersion: string): Promise<void> {
    const expected = `Revert to v${semanticVersion}? This will create a new version.`;
    let dialogs = 0; let resolveDialog: (() => void) | undefined; let rejectDialog: ((error: Error) => void) | undefined; let rejectFailure: ((error: Error) => void) | undefined;
    const dialog = new Promise<void>((resolve, reject) => { resolveDialog = resolve; rejectDialog = reject; });
    const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
    const dispose = this.cdp.on("Page.javascriptDialogOpening", (params) => {
      dialogs += 1;
      const message = typeof params.message === "string" ? params.message : "";
      if (dialogs !== 1 || params.type !== "confirm" || message !== expected) { const error = new Error("Unexpected or duplicate revert confirmation dialog."); rejectDialog?.(error); rejectFailure?.(error); return; }
      void this.cdp.command("Page.handleJavaScriptDialog", { accept: true }).then(() => resolveDialog?.(), (error: Error) => rejectDialog?.(error));
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      const click = this.evaluateValue<{ readonly ok: boolean; readonly count: number }>(`(() => { const rows = Array.from(document.querySelectorAll('.version-history__item')).filter((row) => (row.textContent || '').includes('v' + ${JSON.stringify(semanticVersion)})); if (rows.length !== 1) return { ok: false, count: rows.length }; const button = Array.from(rows[0].querySelectorAll('button')).find((candidate) => (candidate.textContent || '').trim() === 'Revert'); if (!button || button.disabled) return { ok: false, count: 0 }; button.click(); return { ok: true, count: 1 }; })()`).then((result) => { if (!result.ok) throw new Error(`Expected one revert action; found ${result.count}.`); return result; });
      const timedOut = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Timed out waiting for revert confirmation dialog.")), COMMAND_TIMEOUT_MS); });
      await Promise.race([Promise.all([click, dialog]), failure, timedOut]);
      if (dialogs !== 1) throw new Error(`Expected exactly one revert confirmation dialog; found ${dialogs}.`);
    } finally { if (timeout) clearTimeout(timeout); dispose(); }
  }
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

export async function runInstalledSelfTest(options: { readonly port: number; readonly evidencePath: string; readonly fixturePath?: string; readonly targetDatabase?: string; readonly scenario?: "self-test" | "recovery"; readonly phase?: import("./installed-webview2-recovery-scenario.js").InstalledRecoveryPhase }): Promise<JsonRecord> {
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("CDP port must be a non-privileged TCP port.");
  const evidencePath = assertEvidencePath(options.evidencePath);
  await mkdir(evidencePath, { recursive: true });
  const target = await waitForPromptVaultTarget(options.port);
  const cdp = new CdpClient(await BrowserWebSocketTransport.connect(target.webSocketDebuggerUrl!));
  try {
    const view = new PromptVaultWebView(cdp); await view.enable(); await view.assertApplicationRoot();
    if (options.scenario === "recovery") {
      const database = options.targetDatabase;
      const helpers = database ? await import("./installed-webview2-evidence.js") : undefined;
      const evidence = await runInstalledRecoveryScenario({
        view, evidencePath, fixturePath: options.fixturePath, phase: options.phase,
        snapshotTarget: database ? async (name) => {
          const snapshot = helpers!.snapshotDisposableDatabase(database);
          return JSON.stringify({ name, digest: snapshot.digest, counts: snapshot.counts });
        } : undefined,
        mutateTarget: database ? async () => { await helpers!.mutateDisposableTargetWithProductionService(database); } : undefined,
        verifyBackup: database ? (content) => helpers!.verifyBackupAgainstSnapshot(content, helpers!.snapshotDisposableDatabase(database)) : undefined,
      });
      return { scenario: "recovery", phase: options.phase ?? "all", target: { id: target.id, title: target.title, url: target.url }, evidence };
    }
    const library = assertSingleSemanticMatch(await view.findByRole("link", "Library"), "Library link");
    await view.clickByRole("link", "Settings");
    const heading = await view.headingText(); if (heading !== "Settings") throw new Error(`Expected Settings heading, received ${heading || "none"}.`);
    const ax = await view.accessibilityTree(); await view.assertNoHorizontalOverflow();
    const screenshot = await view.captureScreenshot(win32.join(evidencePath, "installed-webview-settings.png"), evidencePath);
    const safe = { target: { id: target.id, type: target.type, title: target.title, url: target.url }, heading, libraryFocusable: library.focusable, accessibilityNodeCount: ax.length, screenshot: screenshot.redactedPath };
    await writeFile(win32.join(evidencePath, "installed-webview-self-test-summary.json"), JSON.stringify(safe, null, 2)); return safe;
  } finally { cdp.close(); }
}

function readOption(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function main(): Promise<void> { const portText = readOption("--port"); const evidencePath = readOption("--evidence"); const fixturePath = readOption("--fixtures"); const targetDatabase = readOption("--target-database"); const scenario = readOption("--scenario") ?? "self-test"; const phase = readOption("--phase"); if (!portText || !evidencePath || (scenario !== "self-test" && scenario !== "recovery")) throw new Error("Usage: installed-webview2-cdp.ts --port <port> --evidence <absolute-path> [--fixtures root] [--target-database database] [--scenario self-test|recovery] [--phase phase]"); const summary = await runInstalledSelfTest({ port: Number(portText), evidencePath, fixturePath, targetDatabase, scenario, phase: phase as import("./installed-webview2-recovery-scenario.js").InstalledRecoveryPhase | undefined }); process.stdout.write(`${JSON.stringify(summary)}\n`); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
