/**
 * 0.6.14 auto-update via electron-updater, generic provider proxied by the Desklist server
 * (<server>/updates/…), which reads the private GitHub releases with its own token. No token in the app.
 * Flow: check → (available) user clicks Download → progress → downloaded → Restart to update.
 */
import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '../common/ipc';

const { autoUpdater } = electronUpdater;
let status: UpdateStatus = { state: 'idle', current: app.getVersion() };
const set = (p: Partial<UpdateStatus>) => { status = { ...status, ...p, current: app.getVersion() };
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('desklist:update', status); };
export const updateStatus = () => status;
const enabled = () => (app.isPackaged || !!process.env.DESKLIST_UPDATE_FEED) && !process.env.DESKLIST_DISABLE_UPDATES;
let wired = false;
function wire(serverUrl: string) {
  const feed = process.env.DESKLIST_UPDATE_FEED || `${serverUrl.replace(/\/$/, '')}/updates/${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}`;
  autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  if (wired) return; wired = true;
  autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = true; autoUpdater.allowPrerelease = true;
  if (process.env.DESKLIST_UPDATE_FEED) autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: undefined }));
  autoUpdater.on('update-available', (i) => set({ state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'downloaded', version: i.version, percent: 100 }));
  autoUpdater.on('error', (e: Error) => { console.error('[updater]', e?.message ?? e); set({ state: 'error', error: String(e?.message ?? e).split('\n')[0].slice(0, 200) }); });
}
export function initAutoUpdate(serverUrl: string) {
  if (!enabled()) return;
  wire(serverUrl);
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  setInterval(() => { if (status.state !== 'downloading' && status.state !== 'downloaded') autoUpdater.checkForUpdates().catch(() => {}); }, 6 * 3600_000);
}
export async function checkForUpdates(serverUrl?: string): Promise<string> {
  if (!enabled()) { set({ state: 'none', error: undefined }); return 'Updates are only checked in installed builds.'; }
  if (serverUrl) wire(serverUrl);
  try { const r = await autoUpdater.checkForUpdates(); const v = r?.updateInfo?.version;
    return v && v !== app.getVersion() && status.state === 'available' ? `Version ${v} is available.` : 'Desklist is up to date.'; }
  catch (e) { return `Update check failed: ${(e as Error).message}`; }
}
export async function downloadUpdate() { if (status.state !== 'available' && status.state !== 'error') return; set({ state: 'downloading', percent: 0 }); await autoUpdater.downloadUpdate(); }
export function installUpdate() { if (status.state === 'downloaded') setImmediate(() => autoUpdater.quitAndInstall(false, true)); }
