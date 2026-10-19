import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, DesklistBridge, ManageView } from '../common/ipc';

async function call<T>(ch: string, ...args: unknown[]): Promise<T> {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value as T;
}

const api: DesklistBridge = {
  getState: () => call('getState'),
  onState: (cb) => { const f = (_: unknown, s: AppState) => cb(s); ipcRenderer.on('desklist:state', f); return () => ipcRenderer.off('desklist:state', f); },
  onNavigate: (cb) => { const f = (_: unknown, v: ManageView) => cb(v); ipcRenderer.on('desklist:navigate', f); return () => ipcRenderer.off('desklist:navigate', f); },
  signIn: (code, url) => call('signIn', code, url),
  signOut: () => call('signOut'),
  mutate: (op) => call('mutate', op),
  request: (m, p, b) => call('request', m, p, b),
  refresh: () => call('refresh'),
  openManage: (v) => call('openManage', v),
  setCurrentProject: (id) => call('setCurrentProject', id),
  setSetting: (p) => call('setSetting', p),
  closeWidget: () => call('closeWidget'),
  windowControl: (a) => call('windowControl', a),
  checkForUpdates: () => call('checkForUpdates'),
  exportCsv: (q) => call('exportCsv', q),
  uploadFile: (t, n, m, d, f) => call('uploadFile', t, n, m, d, f),
  openFile: (id, n) => call('openFile', id, n),
  copyText: (t) => call('copyText', t),
};
contextBridge.exposeInMainWorld('desklist', api);

// Widget: any click asks main to focus the window (Windows: a desktop-layer window is not focused
// automatically, so inputs would not receive keystrokes).
if (new URLSearchParams(location.search).get('view') === 'widget') {
  window.addEventListener('mousedown', () => { void ipcRenderer.invoke('focusWidget').catch(() => {}); }, true);
  window.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) void ipcRenderer.invoke('focusWidget').catch(() => {});
  }, true);
}
