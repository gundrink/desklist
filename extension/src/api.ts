import type { ServerEvent, SignInResponse, Snapshot } from '@desklist/shared';

export const DEFAULT_SERVER = 'http://localhost:8787';
const SERVER_KEY = 'desklist.serverUrl';
const SESSION_KEY = 'desklist.session';
const PROJECT_KEY = 'desklist.projectId';

export interface Session {
  serverUrl: string;
  token: string;
  memberName: string;
  teamName: string;
}

export type LoginResult = SignInResponse | { pending: true; accountToken: string; username: string };

export function isSession(r: LoginResult): r is SignInResponse {
  return 'token' in r && typeof r.token === 'string';
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function normalizeServer(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_SERVER;
  if (!/^https?:\/\//i.test(trimmed)) throw new ApiError('Server URL must start with http:// or https://', 0);
  return trimmed;
}

export async function loadPrefs(): Promise<{ serverUrl: string; session: Session | null; projectId: string | null }> {
  const bag = await chrome.storage.local.get([SERVER_KEY, SESSION_KEY, PROJECT_KEY]);
  const session = bag[SESSION_KEY] as Session | undefined;
  return {
    serverUrl: typeof bag[SERVER_KEY] === 'string' ? bag[SERVER_KEY] : DEFAULT_SERVER,
    session: session?.token ? session : null,
    projectId: typeof bag[PROJECT_KEY] === 'string' ? bag[PROJECT_KEY] : null,
  };
}

export async function saveServerUrl(serverUrl: string): Promise<void> {
  await chrome.storage.local.set({ [SERVER_KEY]: normalizeServer(serverUrl) });
}

export async function saveSession(session: Session): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: session, [SERVER_KEY]: session.serverUrl });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_KEY);
}

export async function saveProjectId(projectId: string): Promise<void> {
  await chrome.storage.local.set({ [PROJECT_KEY]: projectId });
}

/** Ask Chrome for access to this server so the live WebSocket is allowed. */
export async function allowServer(serverUrl: string): Promise<boolean> {
  const origin = new URL(normalizeServer(serverUrl)).origin + '/*';
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

async function request<T>(serverUrl: string, path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  const { token: _token, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(normalizeServer(serverUrl) + path, { ...rest, headers });
  } catch {
    throw new ApiError(`Can't reach ${normalizeServer(serverUrl)}. Check the server URL.`, 0);
  }
  if (!res.ok) {
    let message = res.statusText || 'Request failed';
    try {
      const body = await res.json() as { error?: string };
      if (body.error) message = body.error;
    } catch { /* response had no JSON body */ }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function signInWithCode(serverUrl: string, code: string) {
  return request<SignInResponse>(serverUrl, '/api/auth/signin', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
}

export function loginAccount(serverUrl: string, username: string, password: string) {
  return request<LoginResult>(serverUrl, '/api/accounts/login', {
    method: 'POST',
    body: JSON.stringify({ username: username.trim(), password }),
  });
}

export function redeemCode(serverUrl: string, accountToken: string, code: string) {
  return request<SignInResponse>(serverUrl, '/api/accounts/redeem', {
    method: 'POST',
    body: JSON.stringify({ accountToken, code: code.trim() }),
  });
}

export function fetchSnapshot(serverUrl: string, token: string) {
  return request<Snapshot>(serverUrl, '/api/snapshot', { token });
}

export function patchTask(serverUrl: string, token: string, id: string, patch: { done?: boolean; notes?: string; title?: string; dueDate?: string | null }) {
  return request(serverUrl, `/api/tasks/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ ...patch, updatedAt: new Date().toISOString() }),
  });
}

export function addTask(serverUrl: string, token: string, projectId: string, title: string, dueDate?: string | null) {
  return request(serverUrl, `/api/projects/${projectId}/tasks`, {
    method: 'POST',
    token,
    body: JSON.stringify({ title: title.trim(), dueDate: dueDate || null, updatedAt: new Date().toISOString() }),
  });
}

export function patchItem(serverUrl: string, token: string, id: string, done: boolean) {
  return request(serverUrl, `/api/items/${id}`, { method: 'PATCH', token, body: JSON.stringify({ done }) });
}

export function signOut(serverUrl: string, token: string) {
  return request<{ ok: boolean }>(serverUrl, '/api/auth/signout', { method: 'POST', token }).catch(() => ({ ok: false }));
}

export function connectLive(serverUrl: string, token: string, handlers: {
  onChanged: () => void;
  onStatus: (status: 'online' | 'offline') => void;
}): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let timer = 0;
  let delay = 1000;
  const open = () => {
    if (stopped) return;
    const base = normalizeServer(serverUrl).replace(/^http/i, 'ws');
    const ws = new WebSocket(`${base}/ws?token=${encodeURIComponent(token)}`);
    socket = ws;
    ws.onopen = () => { delay = 1000; handlers.onStatus('online'); handlers.onChanged(); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerEvent;
        if (msg.type === 'changed') handlers.onChanged();
      } catch { /* ignore non-JSON frames */ }
    };
    const schedule = () => {
      handlers.onStatus('offline');
      if (stopped) return;
      timer = window.setTimeout(open, delay);
      delay = Math.min(delay * 2, 15_000);
    };
    ws.onclose = schedule;
    ws.onerror = () => { if (ws.readyState !== WebSocket.CLOSED) ws.close(); };
  };
  open();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    socket?.close();
  };
}
