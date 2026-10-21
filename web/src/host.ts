/**
 * Browser stand-in for the Electron preload. The website renders the desktop React UI
 * and talks to the same Desklist server.
 */
import type { ServerEvent, SignInResponse, Snapshot } from '@desklist/shared';
import type { AppState, DesklistBridge, ManageView, Op, QueuedOp } from '../../app/src/common/ipc';
import { applyOp, entityKey, toRequest } from '../../app/src/common/sync-ops';
import { DEFAULT_SERVER, normalizeServer } from './server';

const KEY = 'desklist.web.v1';
const NAV_KEY = 'desklist.nav';

interface Saved {
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

function waitPopup(popup: Window, origin: string, timeoutMs: number, cancel: { fn: (() => void) | null }) {
  return new Promise<URLSearchParams>((resolve, reject) => {
    const stop = (err?: Error, q?: URLSearchParams) => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      cancel.fn = null;
      try { popup.close(); } catch { /* already closed */ }
      if (err) reject(err); else resolve(q!);
    };
    const timer = window.setTimeout(() => stop(new Error('Timed out waiting for the browser — try again.')), timeoutMs);
    cancel.fn = () => stop(new Error('Cancelled'));
    const onMsg = (e: MessageEvent) => {
      if (e.source !== popup || e.origin !== origin || e.data?.type !== 'desklist-auth') return;
      const q = new URLSearchParams();
      const d = e.data as { code?: string; state?: string; status?: string };
      if (d.code) q.set('code', d.code);
      if (d.state) q.set('state', d.state);
      if (d.status) q.set('status', d.status);
      stop(undefined, q);
    };
    window.addEventListener('message', onMsg);
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
  private subs = new Set<(s: AppState) => void>();
  private cancelAuth: { fn: (() => void) | null } = { fn: null };
  private manage: Window | null = null;
  private applying = false;

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.adopt(JSON.parse(raw) as Saved, false);
    } catch { /* ignore a corrupt cache */ }
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY || !e.newValue) return;
      try { this.adopt(JSON.parse(e.newValue) as Saved, true); } catch { /* ignore */ }
    });
  }

  start() {
    if (this.token) this.connect();
    window.setInterval(() => { if (this.token) this.refresh().catch(() => {}); }, 60_000);
    this.emit();
  }

  private adopt(saved: Saved, reconnect: boolean) {
    const tokenChanged = saved.token !== this.token;
    this.applying = true;
    this.token = saved.token;
    this.serverUrl = saved.serverUrl || DEFAULT_SERVER;
    this.settings = { ...defaults(), ...saved.settings };
    this.base = saved.cache;
    this.outbox = saved.outbox ?? [];
    this.lastError = saved.lastError;
    this.applying = false;
    this.emit();
    if (reconnect && tokenChanged) this.connect();
  }

  private persist() {
    if (this.applying) return;
    const saved: Saved = { token: this.token, serverUrl: this.serverUrl, settings: this.settings, cache: this.base, outbox: this.outbox, lastError: this.lastError };
    localStorage.setItem(KEY, JSON.stringify(saved));
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
      throw new NetError(timedOut
        ? `The Desklist server at ${this.serverUrl} did not respond within 10 seconds. Check your internet connection or the server URL, then try again.`
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

  private useServer(url?: string) {
    const next = normalizeServer(url?.trim() ? url : this.serverUrl);
    if (next !== this.serverUrl) { this.serverUrl = next; this.persist(); }
  }

  private async adoptSession(res: SignInResponse) {
    if (this.base && this.base.me.id !== res.member.id) { this.base = null; this.outbox = []; }
    this.token = res.token;
    this.lastError = null;
    const exp = (res as SignInResponse & { expiresAt?: string }).expiresAt;
    if (exp) this.settings = { ...this.settings, sessionExpiresAt: exp };
    try { this.base = await this.http<Snapshot>('GET', '/api/snapshot'); this.lastSyncedAt = new Date().toISOString(); }
    catch (e) { this.signOutLocal(null); throw e; }
    this.persist();
    this.connect();
    await this.refresh().catch(() => {});
  }

  async signIn(code: string, url?: string) {
    this.useServer(url);
    await this.adoptSession(await this.http<SignInResponse>('POST', '/api/auth/signin', { code }, null));
  }
  async account(kind: 'signup' | 'login' | 'redeem', body: Record<string, string>, url?: string) {
    this.useServer(url);
    const res = await this.http<SignInResponse & { pending?: boolean; accountToken?: string; username?: string }>('POST', `/api/accounts/${kind}`, body, null);
    if (res.pending) return { pending: true, accountToken: res.accountToken, username: res.username };
    await this.adoptSession(res);
    return { pending: false };
  }
  async signOut() {
    if (this.token) await this.http('POST', '/api/auth/signout').catch(() => {});
    this.signOutLocal(null);
  }
  private signOutLocal(msg: string | null) {
    this.token = null; this.base = null; this.outbox = []; this.lastError = msg; this.connection = 'offline';
    this.ws?.close(); this.ws = null;
    this.persist(); this.emit();
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
    this.persist(); this.emit(); void this.flush();
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
        const q = this.outbox[0];
        this.inFlight = q.opId;
        try {
          const req = toRequest(q);
          await this.http(req.method, req.path, req.body);
        } catch (e) {
          if (e instanceof NetError || (e instanceof HttpError && (e.status >= 500 || e.status === 429))) { this.connection = 'offline'; this.emit(); return; }
          if (e instanceof HttpError && e.status === 401) return;
          if (!(e instanceof HttpError && e.status === 404 && q.op.kind.endsWith('.delete'))) this.lastError = (e as Error).message;
        } finally { this.inFlight = null; }
        this.outbox.shift(); this.persist();
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
      this.persist();
    } catch (e) {
      if (e instanceof NetError) this.connection = 'offline';
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

  openManage(v?: ManageView) {
    const nav: ManageView = v ?? { view: 'overview' };
    localStorage.setItem(NAV_KEY, JSON.stringify(nav));
    const url = new URL(location.href);
    url.searchParams.set('view', 'manage');
    if (this.manage && !this.manage.closed) {
      this.manage.focus();
      this.manage.postMessage({ type: 'desklist-nav', nav }, location.origin);
      return;
    }
    const opened = window.open(url.toString(), 'desklist-manage', 'width=1312,height=860');
    if (!opened) location.assign(url.toString());
    else this.manage = opened;
  }

  private async openAuth(path: string) {
    const origin = new URL(this.serverUrl).origin;
    const popup = window.open(origin + path, 'desklist-auth', 'width=480,height=680');
    if (!popup) throw new Error('Allow pop-ups for Desklist to finish in the browser.');
    return waitPopup(popup, origin, 5 * 60_000, this.cancelAuth);
  }

  private async passkeyRegister() {
    const { ticket } = await this.http<{ ticket: string }>('POST', '/api/passkeys/ticket');
    const cb = new URL('/passkey/done', this.serverUrl).toString();
    const q = await this.openAuth(`/passkey/register?ticket=${encodeURIComponent(ticket)}&cb=${encodeURIComponent(cb)}`);
    if (q.get('status') !== 'ok') throw new Error('Passkey was not added');
  }

  private async passkeySignIn() {
    this.useServer();
    const state = rand(16);
    const verifier = rand(32);
    const cc = await sha256url(verifier);
    const cb = new URL('/passkey/done', this.serverUrl).toString();
    const q = await this.openAuth(`/passkey/login?cb=${encodeURIComponent(cb)}&state=${encodeURIComponent(state)}&cc=${encodeURIComponent(cc)}`);
    if (q.get('state') !== state) throw new Error('Passkey sign-in state mismatch');
    const code = q.get('code');
    if (!code) throw new Error('Passkey sign-in failed');
    await this.adoptSession(await this.http<SignInResponse>('POST', '/api/auth/passkey/exchange', { code, verifier }, null));
  }

  bridge(): DesklistBridge {
    return {
      getState: async () => this.state(),
      onState: (cb) => { this.subs.add(cb); return () => this.subs.delete(cb); },
      onNavigate: (cb) => {
        try { const raw = localStorage.getItem(NAV_KEY); if (raw) cb(JSON.parse(raw) as ManageView); } catch { /* ignore */ }
        const onMsg = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.type === 'desklist-nav') cb(e.data.nav as ManageView); };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
      },
      signIn: (code, url) => this.signIn(code, url),
      account: (k, b, u) => this.account(k, b, u),
      signOut: () => this.signOut(),
      mutate: async (op) => { this.mutate(op); },
      request: async (method, path, body) => this.http(method, path, body),
      refresh: () => this.refresh(),
      openManage: async (v) => { this.openManage(v); },
      setCurrentProject: async (id) => { this.settings = { ...this.settings, currentProjectId: id }; this.persist(); this.emit(); },
      setSetting: async (patch) => { this.settings = { ...this.settings, ...patch }; this.persist(); this.emit(); },
      closeWidget: async () => { if (window.opener) window.close(); },
      windowControl: async (action) => { if (action === 'close') window.close(); },
      checkForUpdates: async () => 'You are using Desklist in the browser.',
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
        void this.refresh();
        return r;
      },
      openFile: async (id, name) => {
        const r = await fetch(this.serverUrl + `/api/files/${id}`, { headers: this.token ? { authorization: `Bearer ${this.token}` } : {} });
        if (!r.ok) throw new HttpError(r.status, `HTTP ${r.status}`);
        window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener');
        return name;
      },
      openExternal: async (url) => {
        let href: URL;
        try { href = new URL(url); } catch { return false; }
        if (href.protocol !== 'http:' && href.protocol !== 'https:') return false;
        window.open(href.toString(), '_blank', 'noopener');
        return true;
      },
      copyText: async (text) => { await navigator.clipboard.writeText(text); },
      passkeyRegister: () => this.passkeyRegister(),
      passkeySignIn: () => this.passkeySignIn(),
      googleSignIn: async () => { throw new Error('Google sign-in is available in the Desklist desktop app.'); },
      googleCancel: async () => { this.cancelAuth.fn?.(); },
    };
  }
}

export function installBridge() {
  const engine = new Engine();
  engine.load();
  window.desklist = engine.bridge();
  engine.start();
}

declare global { interface Window { desklist: DesklistBridge } }
