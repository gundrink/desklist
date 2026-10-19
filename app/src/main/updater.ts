/**
 * Auto-update via electron-updater, fed by GitHub Releases (owner/repo are PLACEHOLDERS in
 * electron-builder.yml → publish). Only active in packaged builds.
 */
import { app } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

export function initAutoUpdate() {
  if (!app.isPackaged || process.env.DESKLIST_DISABLE_UPDATES) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on('error', (e: Error) => console.error('[updater]', e?.message ?? e));
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 3600_000);
}

export async function checkForUpdates(): Promise<string> {
  if (!app.isPackaged) return 'Updates are only checked in installed builds.';
  try {
    const r = await autoUpdater.checkForUpdates();
    return r?.updateInfo?.version && r.updateInfo.version !== app.getVersion()
      ? `Downloading version ${r.updateInfo.version}…` : 'Desklist is up to date.';
  } catch (e) { return `Update check failed: ${(e as Error).message}`; }
}
