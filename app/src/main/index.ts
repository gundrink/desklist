import { registerPasskey, passkeySignIn, googleSignIn, cancelGoogleSignIn } from './passkey';
import { app, clipboard, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron';
import path from 'node:path';
import type { ManageView, Op } from '../common/ipc';
import { SyncEngine } from './sync';
import { flushSettings, getSettings, updateSettings, type Bounds } from './settings';
import { desktopWindowOptions, focusWidget, placeOnDesktop, widgetPhaseChanged } from './desktop-layer';
import { checkForUpdates, initAutoUpdate } from './updater';

const isSmoke = !!process.env.DESKLIST_SMOKE;
if (process.env.DESKLIST_USER_DATA) app.setPath('userData', process.env.DESKLIST_USER_DATA);
if (process.platform === 'linux' && isSmoke) app.disableHardwareAcceleration();

// ---- single instance: relaunching just re-shows the widget ----
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => showWidget());

const resources = () => (app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(__dirname, '../../resources'));
const preload = path.join(__dirname, '../preload/index.cjs');

let widget: BrowserWindow | null = null;
let manage: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let layerMode = 'none';
const sync = new SyncEngine();

function loadView(win: BrowserWindow, view: 'widget' | 'manage') {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { view } });
}

function onScreen(b?: Bounds): Bounds | undefined {
  if (!b) return undefined;
  const ok = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + 60 > a.x && b.y + 40 > a.y && b.x < a.x + a.width - 60 && b.y < a.y + a.height - 40;
  });
  return ok ? b : undefined;
}

function createWidget() {
  const s = getSettings();
  const wa = screen.getPrimaryDisplay().workArea;
  const def = { width: 566, height: 700, x: wa.x + wa.width - 566 - 40, y: wa.y + 60 };
  const b = onScreen(s.widgetBounds) ?? def;
  widget = new BrowserWindow({
    ...b, minWidth: 460, minHeight: 480, show: false, title: 'Desklist',
    ...desktopWindowOptions(),
    movable: !s.lockPosition, resizable: !s.lockPosition,
    webPreferences: { preload, contextIsolation: true, sandbox: false },
  });
  loadView(widget, 'widget');
  widget.once('ready-to-show', () => {
    if (!widget) return;
    layerMode = placeOnDesktop(widget);
    // signed out: show as a normal, focused window so the sign-in code can be typed right away
    if (sync.state().phase === 'signedOut') { widget.show(); focusWidget(widget); } else widget.showInactive();
    console.log(`[desklist] widget placed: ${layerMode}`);
  });
  const save = () => { if (widget && !widget.isDestroyed()) updateSettings({ widgetBounds: widget.getBounds() }); };
  widget.on('moved', save); widget.on('resized', save);
  // Stays until explicitly closed: closing hides it (tray/menu-bar can re-show), quitting really closes.
  widget.on('close', (e) => { if (!quitting) { e.preventDefault(); widget?.hide(); updateSettings({ widgetVisible: false }); rebuildTray(); } });
  widget.on('closed', () => { widget = null; });
}

function showWidget() {
  if (!widget) createWidget();
  else { widget.showInactive(); }
  updateSettings({ widgetVisible: true });
  rebuildTray();
}

function openManage(v?: ManageView) {
  if (manage) {
    if (v) manage.webContents.send('desklist:navigate', v);
    if (manage.isMinimized()) manage.restore();
    manage.show(); manage.focus();
    return;
  }
  const s = getSettings();
  const b = onScreen(s.manageBounds) ?? { width: 1312, height: 860 };
  const mac = process.platform === 'darwin', win = process.platform === 'win32';
  manage = new BrowserWindow({
    ...b, minWidth: 980, minHeight: 620, show: false, title: 'Desklist — Manage', backgroundColor: '#f7f8fa',
    // custom 40px title bar drawn in HTML (matches the mockup); native controls where the OS has them
    ...(mac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 } }
      : win ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#e8eaee', symbolColor: '#4b5563', height: 40 } }
      : { frame: false }),
    icon: path.join(resources(), 'icon.png'),
    webPreferences: { preload, contextIsolation: true, sandbox: false },
  });
  loadView(manage, 'manage');
  manage.once('ready-to-show', () => {
    manage?.show();
    if (v) manage?.webContents.send('desklist:navigate', v);
  });
  const save = () => { if (manage && !manage.isDestroyed()) updateSettings({ manageBounds: manage.getBounds() }); };
  manage.on('moved', save); manage.on('resized', save);
  manage.on('closed', () => { manage = null; });
  manage.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
}

function applyLock(lock: boolean) {
  updateSettings({ lockPosition: lock });
  widget?.setMovable(!lock); widget?.setResizable(!lock);
}
function applyLoginItem(on: boolean) {
  updateSettings({ launchAtLogin: on });
  if (process.platform !== 'linux') app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true });
}

function rebuildTray() {
  if (!tray) return;
  const s = getSettings();
  const snap = sync.state().snapshot;
  const projects = snap?.projects ?? [];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: widget?.isVisible() ? 'Widget is showing' : 'Show widget', enabled: !widget?.isVisible(), click: () => showWidget() },
    { label: 'Open Manage', click: () => openManage() },
    ...(sync.state().phase === 'signedOut' ? [{ label: 'Sign in…', click: () => openManage() }] : []),
    { type: 'separator' },
    { label: 'Current project', enabled: projects.length > 0, submenu: projects.map((p) => ({
      label: p.name, type: 'radio' as const, checked: p.id === s.currentProjectId, click: () => setCurrentProject(p.id) })) },
    { type: 'separator' },
    { label: 'Lock widget position', type: 'checkbox', checked: s.lockPosition, click: (i) => { applyLock(i.checked); broadcast(); } },
    { label: 'Launch at login', type: 'checkbox', checked: s.launchAtLogin, click: (i) => { applyLoginItem(i.checked); broadcast(); } },
    { label: 'Check for updates…', click: async () => tray?.displayBalloon?.({ title: 'Desklist', content: await checkForUpdates() }) },
    { type: 'separator' },
    { label: 'Close widget', enabled: !!widget?.isVisible(), click: () => widget?.close() },
    { label: 'Quit Desklist', click: () => { quitting = true; app.quit(); } },
  ]));
}

function setCurrentProject(id: string) { updateSettings({ currentProjectId: id }); broadcast(); }

function broadcast() {
  const st = sync.state();
  widgetPhaseChanged(st.phase);
  for (const w of [widget, manage]) if (w && !w.isDestroyed()) w.webContents.send('desklist:state', st);
  rebuildTray();
}

/** In smoke tests, record the URL the app would open in the system browser instead of launching one. */
const opened: string[] = [];
const smokeOpen = () => (isSmoke ? async (u: string) => { opened.push(u); } : undefined);

function registerIpc() {
  const handle = (ch: string, fn: (...a: any[]) => unknown) =>
    ipcMain.handle(ch, async (_e, ...a) => {
      try { return { ok: true, value: await fn(...a) }; }
      catch (e) { return { ok: false, error: (e as Error).message }; }
    });
  handle('getState', () => sync.state());
  handle('account', (k: 'signup' | 'login' | 'redeem', b: Record<string, string>, u?: string) => sync.account(k, b, u));
  handle('signIn', (code: string, url?: string) => sync.signIn(code, url));
  handle('signOut', () => sync.signOut());
  handle('mutate', (op: Op) => sync.mutate(op));
  handle('request', async (m: string, p: string, b?: unknown) => { if (m !== 'GET') await sync.drain(); const r = await sync.http(m, p, b); if (m !== 'GET') void sync.refresh(); return r; });
  handle('refresh', () => { sync.reconnect(); return sync.refresh(); });
  handle('openManage', (v?: ManageView) => openManage(v));
  handle('setCurrentProject', (id: string) => setCurrentProject(id));
  handle('setSetting', (p: { lockPosition?: boolean; launchAtLogin?: boolean }) => {
    if (p.lockPosition !== undefined) applyLock(p.lockPosition);
    if (p.launchAtLogin !== undefined) applyLoginItem(p.launchAtLogin);
    broadcast();
  });
  handle('closeWidget', () => widget?.close());
  handle('focusWidget', () => { if (widget && !widget.isDestroyed()) focusWidget(widget); });
  handle('windowControl', (a: string) => {
    const w = BrowserWindow.getFocusedWindow() ?? manage;
    if (!w) return;
    if (a === 'close') w.close(); else if (a === 'minimize') w.minimize(); else w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  handle('checkForUpdates', () => checkForUpdates());
  handle('uploadFile', async (taskId: string, name: string, mime: string, data: Uint8Array, fieldId?: string | null) => {
    await sync.drain(); const r = await sync.upload(taskId, name, mime, data, fieldId); void sync.refresh(); return r;
  });
  handle('passkeyRegister', () => registerPasskey(sync.baseUrl, () => sync.http('POST', '/api/passkeys/ticket'), smokeOpen()));
  handle('passkeySignIn', () => passkeySignIn(sync.baseUrl, (c, v) => sync.signInWithPasskeyCode(c, v), smokeOpen()));
  handle('googleSignIn', async () => {
    try { await googleSignIn((m, p, b) => sync.anon(m, p, b), (body) => sync.signInWithGoogle(body), smokeOpen(), Number(process.env.DESKLIST_GOOGLE_TIMEOUT_MS) || undefined); }
    finally { const bw = widget ?? BrowserWindow.getAllWindows()[0]; if (bw && !bw.isDestroyed()) { bw.show(); bw.focus(); } }
  });
  handle('googleCancel', () => cancelGoogleSignIn());
  handle('copyText', (t: string) => { clipboard.writeText(String(t)); });
  handle('openFile', async (id: string, name: string) => {
    const fs = await import('node:fs'); const os = await import('node:os');
    const buf = await sync.download(`/api/files/${id}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desklist-'));
    const fp = path.join(dir, name.replace(/[\\/:*?"<>|]/g, '_') || 'file');
    fs.writeFileSync(fp, buf);
    const err = await shell.openPath(fp);
    if (err) throw new Error(err);
    return fp;
  });
  handle('exportCsv', async (query: string) => {
    const csv = await sync.text('/api/reports/expenses.csv' + (query ? '?' + query : ''));
    const r = await dialog.showSaveDialog((manage ?? undefined) as BrowserWindow, { defaultPath: 'desklist-expenses.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    (await import('node:fs')).writeFileSync(r.filePath, csv);
    return r.filePath;
  });
}

app.whenReady().then(() => {
  registerIpc();
  sync.on('state', broadcast);
  sync.start();
  const trayIcon = process.platform === 'darwin'
    ? nativeImage.createFromPath(path.join(resources(), 'trayTemplate.png'))
    : nativeImage.createFromPath(path.join(resources(), 'tray.png'));
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('Desklist');
  tray.on('click', () => (process.platform === 'win32' ? showWidget() : undefined));
  if (process.platform === 'darwin') app.dock?.hide();
  createWidget();
  if (!getSettings().widgetVisible) { /* still show on launch: a (re)launch always re-shows the widget */ }
  updateSettings({ widgetVisible: true });
  rebuildTray();
  initAutoUpdate();
  if (isSmoke) (globalThis as any).__desklist = { openManage, showWidget, layerMode: () => layerMode, state: () => sync.state(), opened };
});

app.on('before-quit', () => { quitting = true; flushSettings(); sync.stop(); });
// Tray app: closing windows never quits.
app.on('window-all-closed', () => { /* keep running in tray / menu bar */ });
