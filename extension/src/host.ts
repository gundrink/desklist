/**
 * Browser stand-in for the Electron preload. The side panel and the Manage tab render the
 * desktop React UI and talk to the same Desklist server.
 */
import type { ServerEvent, SignInResponse, Snapshot } from '@desklist/shared';
import type { AppState, DesklistBridge, ManageView, Op, QueuedOp } from '../../app/src/common/ipc';
import { applyOp, entityKey, toRequest } from '../../app/src/common/sync-ops';
import { allowServer, DEFAULT_SERVER, normalizeServer } from './api';

const KEY = 'desklist.host.v1';
const NAV_KEY = 'desklist.nav';

interface Saved {
  seq: number;
  token: string | null;
  serverUrl: string;
  settings: AppState['settings'];
  cache: Snapshot | null;
  outbox: QueuedOp[];
  lastError: string | null;
}

class NetError extends Error {}
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const defaults = (): AppState['settings'] => ({
  lockPosition: false, launchAtLogin: false, currentProjectId: null, sessionExpiresAt: null,
  widgetOpacity: 85, widgetBlur: true, autoShowWidget: true, openManageAtStartup: false, startMinimized: false,
});

const b64url = (bytes: Uint8Array) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const rand = (n: number) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b64url(b); };
const sha256url = async (s: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));

function platform(): NodeJS.Platform {
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return 'darwin';
  if (/Win/.test(ua)) return 'win32';
  return 'linux';
}

/** Capture the 127.0.0.1 redirect the desktop app receives on its loopback server. */
function watchLoopback(tabId: number, expected: string, timeoutMs: number, cancel: { fn: (() => void) | null }) {
  const base = expected.replace(/\/$/, '');
  return new Promise<URLSearchParams>((resolve, reject) => {
    const stop = (err?: Error, q?: URLSearchParams) => {
      window.clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUp);
      cancel.fn = null;
      if (err) reject(err); else resolve(q!);
    };
    const timer = window.setTimeout(() => stop(new Error('Timed out waiting for the browser — try again.')), timeoutMs);
    cancel.fn = () => { chrome.tabs.remove(tabId).catch(() => {}); stop(new Error('Cancelled')); };
    const onUp = (id: number, info: { url?: string }, tab: chrome.tabs.Tab) => {
      if (id !== tabId) return;
      const raw = info.url || tab.url || '';
      if (!raw.startsWith(base)) return;
      chrome.tabs.remove(id).catch(() => {});
      stop(undefined, new URL(raw).searchParams);
    };
    chrome.tabs.onUpdated.addListener(onUp);
  });
}

class Engine {
  private token: string | null = null;
  private serverUrl = DEFAULT_SERVER;
  private settings = defaults();
  private base: Snapshot | null = null;
  private outbox: QueuedOp[] = [];
  private connection: AppState['connection'] = 'offline';
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private ws: WebSocket | null = null;
  private backoff = 1000;
  private reconnectTimer = 0;
  private refreshTimer = 0;
  private flushing = false;
  private inFlight: string | null = null;
  private seq = 0;
  private seen = 0;
  private subs = new Set<(s: AppState) => void>();
  private cancelAuth: { fn: (() => void) | null } = { fn: null };

  async load() {
    const bag = await chrome.storage.local.get([KEY, 'desklist.session', 'desklist.serverUrl', 'desklist.projectId']);
    const saved = bag[KEY] as Saved | undefined;
    if (saved) {
      this.seen = saved.seq ?? 0; this.seq = this.seen;
      this.token = saved.token; this.serverUrl = saved.serverUrl || DEFAULT_SERVER;
      this.settings = { ...defaults(), ...saved.settings }; this.base = saved.cache; this.outbox = saved.outbox ?? []; this.lastError = saved.lastError;
    } else {
      const legacy = bag['desklist.session'] as { token?: string; serverUrl?: string } | undefined;
      if (legacy?.token) this.token = legacy.token;
      if (typeof bag['desklist.serverUrl'] === 'string') this.serverUrl = bag['desklist.serverUrl'];
      if (typeof bag['desklist.projectId'] === 'string') this.settings.currentProjectId = bag['desklist.projectId'];
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[KEY]?.newValue) return;
      this.adopt(changes[KEY].newValue as Saved);
    });
  }

  start() {
    if (this.token) this.connect();
    window.setInterval(() => { if (this.token) this.refresh().catch(() => {}); }, 60_000);
    this.emit();
  }

  private adopt(saved: Saved) {
    if (!saved || saved.seq <= this.seen) return;
    this.seen = saved.seq; this.seq = saved.seq;
    const tokenChanged = saved.token !== this.token;
    this.token = saved.token; this.serverUrl = saved.serverUrl || this.serverUrl;
    this.settings = { ...defaults(), ...saved.settings }; this.base = saved.cache; this.outbox = saved.outbox ?? []; this.lastError = saved.lastError;
    this.emit();
    if (tokenChanged) this.connect();
  }

  private async persist() {
    this.seq += 1; this.seen = this.seq;
    const saved: Saved = { seq: this.seq, token: this.token, serverUrl: this.serverUrl, settings: this.settings, cache: this.base, outbox: this.outbox, lastError: this.lastError };
    await chrome.storage.local.set({ [KEY]: saved });
  }

  state(): AppState {
    let snap = this.base;
    if (snap) for (const q of this.outbox) snap = applyOp(snap, q.op, snap.me, q.at);
    return {
      phase: !this.token ? 'signedOut' : snap ? 'ready' : 'loading',
      connection: this.connection, snapshot: snap, lastSyncedAt: this.lastSyncedAt, pending: this.outbox.length,
      lastError: this.lastError, serverUrl: this.serverUrl, platform: platform(), settings: this.settings,
    };
  }
  private emit() { const s = this.state(); this.subs.forEach((f) => f(s)); }

  private async http<T>(method: string, path: string, body?: unknown, token = this.token, raw?: BodyInit, headers?: Record<string, string>): Promise<T> {
    let r: Response;
    try {
      r = await fetch(this.serverUrl + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
        signal: AbortSignal.timeout(raw ? 60_000 : 10_000),
      });
    } catch (e) {
      const timedOut = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
      throw new NetError(timedOut ? `The Desklist server at ${this.serverUrl} did not respond within 10 seconds. Check your internet connection or the server URL, then try again.`
        : `Cannot reach the Desklist server at ${this.serverUrl}. Check your internet connection or the server URL.`);
    }
    const text = await r.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : {};
    if (!r.ok && json.error == null && (r.status === 404 || r.status >= 500))
      throw new HttpError(r.status, `The Desklist server at ${this.serverUrl} is not available right now (HTTP ${r.status}). Try again in a minute or check the server URL.`);
    if (r.status === 401 && token && path !== '/api/auth/signin') this.signOutLocal('Session expired — please sign in again');
    if (!r.ok) throw new HttpError(r.status, json.error ?? `HTTP ${r.status}`);
    return json as T;
  }

  private async useServer(url?: string) {
    const next = normalizeServer(url?.trim() ? url : this.serverUrl);
    const ok = await allowServer(next);
    if (!ok) throw new Error('Chrome needs permission to reach that server.');
    if (next !== this.serverUrl) { this.serverUrl = next; await this.persist(); }
    return next;
  }

  private async adoptSession(res: SignInResponse) {
    if (this.base && this.base.me.id !== res.member.id) { this.base = null; this.outbox = []; }
    this.token = res.token; this.lastError = null;
    const exp = (res as SignInResponse & { expiresAt?: string }).expiresAt;
    if (exp) this.settings = { ...this.settings, sessionExpiresAt: exp };
    try { this.base = await this.http<Snapshot>('GET', '/api/snapshot'); this.lastSyncedAt = new Date().toISOString(); }
    catch (e) { this.signOutLocal(null); throw e; }
    await this.persist();
    this.connect();
    await this.refresh().catch(() => {});
  }

  async signIn(code: string, url?: string) {
    await this.useServer(url);
    const res = await this.http<SignInResponse>('POST', '/api/auth/signin', { code }, null);
    await this.adoptSession(res);
  }
  async account(kind: 'signup' | 'login' | 'redeem', body: Record<string, string>, url?: string) {
    await this.useServer(url);
    const res = await this.http<SignInResponse & { pending?: boolean; accountToken?: string; username?: string }>('POST', `/api/accounts/${kind}`, body, null);
    if (res.pending) return { pending: true, accountToken: res.accountToken, username: res.username };
    await this.adoptSession(res); return { pending: false };
  }
  async signOut() {
    if (this.token) await this.http('POST', '/api/auth/signout').catch(() => {});
    this.signOutLocal(null);
  }
  private signOutLocal(msg: string | null) {
    this.token = null; this.base = null; this.outbox = []; this.lastError = msg; this.connection = 'offline';
    this.ws?.close(); this.ws = null;
    void this.persist(); this.emit();
  }

  mutate(op: Op) {
    const at = new Date().toISOString();
    const key = entityKey(op);
    const last = this.outbox[this.outbox.length - 1];
    if (last && key && entityKey(last.op) === key && last.opId !== this.inFlight && (op.kind === 'project.update' || op.kind === 'task.update' || op.kind === 'column.update')) {
      const prev = last.op as { patch?: { values?: Record<string, string | null> } };
      const values = { ...(prev.patch?.values ?? {}), ...((op as { patch?: { values?: Record<string, string | null> } }).patch?.values ?? {}) };
      last.op = { ...op, patch: { ...prev.patch, ...(op as { patch: object }).patch, ...(Object.keys(values).length ? { values } : {}) } } as Op;
      last.at = at;
    } else this.outbox.push({ opId: crypto.randomUUID(), at, op });
    void this.persist(); this.emit(); void this.flush();
  }

  private async drain(timeoutMs = 8000) {
    const end = Date.now() + timeoutMs;
    void this.flush();
    while (this.outbox.length && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  }

  private async flush() {
    if (this.flushing || !this.token) return;
    this.flushing = true;
    try {
      while (this.outbox.length) {
        const q = this.outbox[0]; this.inFlight = q.opId;
        try { await this.http(toRequest(q).method, toRequest(q).path, toRequest(q).body); }
        catch (e) {
          if (e instanceof NetError || (e instanceof HttpError && (e.status >= 500 || e.status === 429 || e.status === 401))) { this.connection = 'offline'; this.emit(); return; }
          if (!(e instanceof HttpError && e.status === 404 && q.op.kind.endsWith('.delete'))) this.lastError = (e as Error).message;
        } finally { this.inFlight = null; }
        this.outbox.shift(); void this.persist();
      }
    } finally { this.flushing = false; }
    this.scheduleRefresh(0);
  }

  async refresh() {
    if (!this.token) return;
    try {
      const snap = await this.http<Snapshot>('GET', '/api/snapshot');
      this.base = snap; this.lastSyncedAt = new Date().toISOString();
      if (this.connection !== 'online' && this.ws?.readyState === WebSocket.OPEN) this.connection = 'online';
      if (!this.settings.currentProjectId || !snap.projects.some((p) => p.id === this.settings.currentProjectId))
        this.settings = { ...this.settings, currentProjectId: snap.projects[0]?.id ?? null };
      await this.persist();
    } catch (e) {
      if (e instanceof NetError) { this.connection = 'offline'; }
      else throw e;
    } finally { this.emit(); }
  }
  private scheduleRefresh(ms = 150) {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { this.refresh().catch((e) => { this.lastError = (e as Error).message; this.emit(); }); }, ms);
  }

  private connect() {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
    if (!this.token) { this.connection = 'offline'; this.emit(); return; }
    this.connection = 'connecting'; this.emit();
    const url = this.serverUrl.replace(/^http/i, 'ws') + '/ws?token=' + encodeURIComponent(this.token);
    const ws = new WebSocket(url); this.ws = ws;
    ws.onopen = () => { this.backoff = 1000; this.connection = 'online'; this.emit(); void this.flush(); };
    ws.onmessage = (ev) => { try { const msg = JSON.parse(String(ev.data)) as ServerEvent; if (msg.type === 'changed') this.scheduleRefresh(); } catch { /* ignore */ } };
    const retry = () => {
      if (this.ws !== ws || !this.token) return;
      this.connection = 'offline'; this.emit();
      this.reconnectTimer = window.setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
    ws.onclose = retry;
    ws.onerror = () => { /* close follows */ };
  }

  async openManage(v?: ManageView) {
    const nav = v ?? { view: 'overview' as const };
    await chrome.storage.session.set({ [NAV_KEY]: nav });
    const url = chrome.runtime.getURL('panel.html?view=manage');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((t) => t.url?.startsWith(url));
    if (existing?.id) { await chrome.tabs.update(existing.id, { active: true }); if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true }); }
    else await chrome.tabs.create({ url });
    chrome.runtime.sendMessage({ type: 'desklist-nav', nav }).catch(() => {});
  }

  bridge(): DesklistBridge {
    return {
      getState: async () => this.state(),
      onState: (cb) => { this.subs.add(cb); return () => this.subs.delete(cb); },
      onNavigate: (cb) => {
        const go = (nav: ManageView | undefined) => { if (nav) cb(nav); };
        void chrome.storage.session.get(NAV_KEY).then((bag) => go(bag[NAV_KEY] as ManageView | undefined));
        const onMsg = (msg: { type?: string; nav?: ManageView }) => { if (msg?.type === 'desklist-nav') go(msg.nav); };
        chrome.runtime.onMessage.addListener(onMsg);
        return () => chrome.runtime.onMessage.removeListener(onMsg);
      },
      signIn: (code, url) => this.signIn(code, url),
      account: (k, b, u) => this.account(k, b, u),
      signOut: () => this.signOut(),
      mutate: async (op) => { this.mutate(op); },
      request: async (method, path, body) => this.http(method, path, body),
      refresh: () => this.refresh(),
      openManage: (v) => this.openManage(v),
      setCurrentProject: async (id) => { this.settings = { ...this.settings, currentProjectId: id }; await this.persist(); this.emit(); },
      setSetting: async (patch) => { this.settings = { ...this.settings, ...patch }; await this.persist(); this.emit(); },
      closeWidget: async () => {},
      windowControl: async (action) => { if (action === 'close') window.close(); },
      checkForUpdates: async () => 'You are running the Desklist Chrome extension.',
      exportCsv: async (query) => {
        const r = await fetch(this.serverUrl + '/api/reports/expenses.csv' + (query ? '?' + query : ''), { headers: this.token ? { authorization: `Bearer ${this.token}` } : {}, signal: AbortSignal.timeout(20_000) });
        const csv = await r.text();
        if (!r.ok) throw new HttpError(r.status, `HTTP ${r.status}`);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'desklist-expenses.csv'; a.click();
        return 'desklist-expenses.csv';
      },
      uploadFile: async (taskId, name, mime, data, fieldId) => {
        await this.drain();
        const r = await this.http('POST', `/api/tasks/${taskId}/files`, undefined, this.token, new Blob([new Uint8Array(data)]), {
          'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name), 'x-mime': mime || 'application/octet-stream', ...(fieldId ? { 'x-field-id': fieldId } : {}),
        });
        void this.refresh(); return r;
      },
      openFile: async (id, name) => {
        const r = await fetch(this.serverUrl + `/api/files/${id}`, { headers: this.token ? { authorization: `Bearer ${this.token}` } : {} });
        if (!r.ok) throw new HttpError(r.status, `HTTP ${r.status}`);
        const url = URL.createObjectURL(await r.blob());
        await chrome.tabs.create({ url });
        return name;
      },
      openExternal: async (url) => {
        let href: URL;
        try { href = new URL(url); } catch { return false; }
        if (href.protocol !== 'http:' && href.protocol !== 'https:') return false;
        await chrome.tabs.create({ url: href.toString() });
        return true;
      },
      copyText: async (text) => { await navigator.clipboard.writeText(text); },
      passkeyRegister: () => this.passkeyRegister(),
      passkeySignIn: () => this.passkeySignIn(),
      googleSignIn: () => this.googleSignIn(),
      googleCancel: async () => { this.cancelAuth.fn?.(); },
    };
  }

  private async openAuthTab(target: string) {
    const tab = await chrome.tabs.create({ url: target });
    if (!tab.id) throw new Error('Could not open the sign-in tab');
    return tab.id;
  }

  private async passkeyRegister() {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const cb = `http://127.0.0.1:${port}/passkey`;
    const { ticket } = await this.http<{ ticket: string }>('POST', '/api/passkeys/ticket');
    const tabId = await this.openAuthTab(`${this.serverUrl}/passkey/register?ticket=${encodeURIComponent(ticket)}&cb=${encodeURIComponent(cb)}`);
    const q = await watchLoopback(tabId, cb, 5 * 60_000, this.cancelAuth);
    if (q.get('status') !== 'ok') throw new Error('Passkey was not added');
  }

  private async passkeySignIn() {
    await this.useServer();
    const port = 20000 + Math.floor(Math.random() * 20000);
    const cb = `http://127.0.0.1:${port}/passkey`;
    const state = rand(16);
    const verifier = rand(32);
    const cc = await sha256url(verifier);
    const tabId = await this.openAuthTab(`${this.serverUrl}/passkey/login?cb=${encodeURIComponent(cb)}&state=${state}&cc=${cc}`);
    const q = await watchLoopback(tabId, cb, 5 * 60_000, this.cancelAuth);
    if (q.get('state') !== state) throw new Error('Passkey sign-in state mismatch');
    const code = q.get('code'); if (!code) throw new Error('Passkey sign-in failed');
    const res = await this.http<SignInResponse>('POST', '/api/auth/passkey/exchange', { code, verifier }, null);
    await this.adoptSession(res);
  }

  private async googleSignIn() {
    await this.useServer();
    this.cancelAuth.fn?.();
    const cfg = await this.http<{ enabled: boolean; clientId: string | null }>('GET', '/api/auth/google/config', undefined, null);
    if (!cfg.enabled || !cfg.clientId) throw new Error('Google sign-in is not set up on the server yet');
    const port = 20000 + Math.floor(Math.random() * 20000);
    const redirectUri = `http://127.0.0.1:${port}/oauth`;
    const state = rand(24);
    const verifier = rand(48);
    const challenge = await sha256url(verifier);
    await this.http('POST', '/api/auth/google/start', { state }, null);
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({ client_id: cfg.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' })) u.searchParams.set(k, v);
    const tabId = await this.openAuthTab(u.toString());
    const q = await watchLoopback(tabId, redirectUri, 5 * 60_000, this.cancelAuth);
    if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'Google sign-in was cancelled' : `Google error: ${q.get('error')}`);
    if (q.get('state') !== state) throw new Error('Sign-in state mismatch — try again');
    const code = q.get('code'); if (!code) throw new Error('Google sign-in failed (no code returned)');
    try {
      const res = await this.http<SignInResponse>('POST', '/api/auth/google/exchange', { code, verifier, redirectUri, state }, null);
      await this.adoptSession(res);
    } catch (e) {
      if (e instanceof HttpError && e.status === 403) throw new Error("This Google account isn't linked to a member. Ask your admin to add it in Team & codes.");
      throw e;
    }
  }
}

export async function installBridge() {
  const engine = new Engine();
  await engine.load();
  window.desklist = engine.bridge();
  engine.start();
}

declare global { interface Window { desklist: DesklistBridge } }
