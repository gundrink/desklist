import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface Bounds { x: number; y: number; width: number; height: number }
export interface Settings {
  serverUrl: string;
  widgetBounds?: Bounds;
  manageBounds?: Bounds;
  lockPosition: boolean;
  launchAtLogin: boolean;
  currentProjectId?: string;
  widgetVisible: boolean;
}

const dir = () => app.getPath('userData');
const file = (n: string) => path.join(dir(), n);
const DEFAULT_SERVER = process.env.DESKLIST_SERVER_URL || 'http://localhost:8787';

let cached: Settings | null = null;
export function getSettings(): Settings {
  if (cached) return cached;
  let s: Partial<Settings> = {};
  try { s = JSON.parse(fs.readFileSync(file('settings.json'), 'utf8')); } catch { /* first run */ }
  cached = { serverUrl: DEFAULT_SERVER, lockPosition: false, launchAtLogin: false, widgetVisible: true, ...s };
  if (process.env.DESKLIST_SERVER_URL) cached.serverUrl = process.env.DESKLIST_SERVER_URL;
  return cached;
}
let writeTimer: NodeJS.Timeout | null = null;
export function updateSettings(patch: Partial<Settings>): Settings {
  cached = { ...getSettings(), ...patch };
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flushSettings, 300);
  return cached;
}
export function flushSettings() {
  if (!cached) return;
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file('settings.json'), JSON.stringify(cached, null, 2));
}

/**
 * Session token, encrypted with Electron safeStorage (Keychain on macOS, DPAPI on Windows,
 * libsecret/kwallet on Linux). If the OS offers no encryption, the token is kept in memory only.
 */
let memToken: string | null = null;
export function saveToken(token: string | null) {
  memToken = token;
  const f = file('session.bin');
  if (!token) { fs.rmSync(f, { force: true }); return; }
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[desklist] safeStorage unavailable — session kept in memory only (sign in again after restart)');
    return;
  }
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(f, safeStorage.encryptString(token));
}
export function loadToken(): string | null {
  if (memToken) return memToken;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    memToken = safeStorage.decryptString(fs.readFileSync(file('session.bin')));
    return memToken;
  } catch { return null; }
}

/** Local cache + outbox for offline use. */
export function readJson<T>(name: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
export function writeJson(name: string, data: unknown) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = file(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file(name));
}
