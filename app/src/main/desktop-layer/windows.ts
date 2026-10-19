/**
 * Windows 10/11 desktop-layer attach (koffi + user32). ⚠ Needs real-machine testing on Win10 and Win11.
 *
 * Background — how the Windows desktop is built:
 *   Progman ("Program Manager") is the desktop's top-level window. The icons live in SHELLDLL_DefView
 *   (→ SysListView32). Sending Progman the undocumented message 0x052C makes Explorer spawn a "WorkerW"
 *   window behind the icons (that's what wallpaper engines draw into). On Win11 24H2 the layout changed:
 *   WorkerW/SHELLDLL_DefView became children of Progman. We handle both by searching for whichever
 *   top-level window hosts SHELLDLL_DefView.
 *
 * v0.5.2: DEFAULT IS NOW "bottom" — a child of the desktop host (SetParent) cannot get keyboard focus,
 * so the sign-in code / task inputs could not be typed into. "setparent" is opt-in and detaches while focused.
 * Strategy (DESKLIST_WIN_ATTACH env var can override: setparent | owner | bottom):
 *   1. "setparent" (default): SetParent(widget, <window hosting SHELLDLL_DefView>) and z-order it
 *      directly above SHELLDLL_DefView so it sits on top of the icons but inside the desktop layer.
 *      Children of the desktop are not minimised by Win+D / "Show desktop", so the widget survives it.
 *   2. "owner": make the desktop host the widget's OWNER (GWLP_HWNDPARENT). Owned windows of the desktop
 *      also survive Win+D and keep Chromium input handling as a top-level window. Use if (1) breaks
 *      input or DPI scaling on a given machine.
 *   3. "bottom" / fallback: keep the window at HWND_BOTTOM and push it back down whenever it is focused.
 *      This does NOT survive Win+D, but never breaks.
 */
import type { BrowserWindow } from 'electron';
import { BOTTOM_FLAGS, chooseWinAttachMode, shouldAttachToDesktop } from './mode';

type User32 = {
  FindWindowW: (cls: string | null, title: string | null) => unknown;
  FindWindowExW: (parent: unknown, after: unknown, cls: string | null, title: string | null) => unknown;
  SendMessageTimeoutW: (h: unknown, msg: number, w: number, l: number, flags: number, timeout: number, out: unknown) => unknown;
  EnumWindows: (cb: unknown, l: number) => boolean;
  SetParent: (child: unknown, parent: unknown) => unknown;
  SetWindowPos: (h: unknown, after: unknown, x: number, y: number, cx: number, cy: number, flags: number) => boolean;
  SetWindowLongPtrW: (h: unknown, idx: number, v: unknown) => unknown;
  koffi: any;
  EnumProto: unknown;
};

const SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
const HWND_BOTTOM = 1;
const GWLP_HWNDPARENT = -8;
const SMTO_NORMAL = 0x0000;

let u32: User32 | null = null;
function load(): User32 {
  if (u32) return u32;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  // HWNDs are handled as pointer-sized integers (intptr_t) — simplest and safe across koffi versions.
  const EnumProto = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
  u32 = {
    koffi, EnumProto,
    FindWindowW: lib.func('intptr_t __stdcall FindWindowW(str16 cls, str16 title)'),
    FindWindowExW: lib.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, str16 cls, str16 title)'),
    SendMessageTimeoutW: lib.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t h, uint32 msg, uintptr_t w, intptr_t l, uint32 flags, uint32 timeout, _Out_ uintptr_t *result)'),
    EnumWindows: lib.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
    SetParent: lib.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
    SetWindowPos: lib.func('bool __stdcall SetWindowPos(intptr_t h, intptr_t after, int x, int y, int cx, int cy, uint32 flags)'),
    SetWindowLongPtrW: lib.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t h, int idx, intptr_t v)'),
  };
  return u32;
}

/** Electron gives the native handle as a Buffer holding the HWND value. */
function hwndOf(win: BrowserWindow): number | bigint {
  const buf = win.getNativeWindowHandle();
  const v = buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0));
  return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
}

/** Find the top-level window that hosts SHELLDLL_DefView (Progman or a WorkerW). */
function findDesktopHost(u: User32): { host: unknown; defView: unknown } | null {
  const progman = u.FindWindowW('Progman', null);
  if (!progman) return null;
  const out = [0];
  // Ask Explorer to create the WorkerW behind the icons (harmless if it already exists).
  u.SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, SMTO_NORMAL, 1000, out);
  u.SendMessageTimeoutW(progman, 0x052c, 0, 0, SMTO_NORMAL, 1000, out);
  // Win11 24H2+: SHELLDLL_DefView is a direct child of Progman.
  let defView = u.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  if (defView) return { host: progman, defView };
  // Win10 / older Win11: it lives in one of the top-level WorkerW windows.
  let found: { host: unknown; defView: unknown } | null = null;
  const cb = u.koffi.register((hwnd: unknown) => {
    const dv = u.FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null);
    if (dv) { found = { host: hwnd, defView: dv }; return false; }
    return true;
  }, u.koffi.pointer(u.EnumProto));
  try { u.EnumWindows(cb, 0); } finally { u.koffi.unregister(cb); }
  return found;
}

function keepAtBottom(win: BrowserWindow, u: User32 | null) {
  const push = () => {
    if (!u) return;
    try { u.SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, BOTTOM_FLAGS); } catch { /* ignore */ }
  };
  // Push down when shown and when the user leaves the widget. While it is focused we leave the
  // z-order alone so it stays active and keeps keyboard input (SWP_NOACTIVATE never steals focus).
  push();
  win.on('show', push);
  win.on('blur', push);
}

export type Phase = 'signedOut' | 'loading' | 'ready';
let currentPhase: Phase = 'signedOut';
let setParentCtl: { sync: () => void } | null = null;
/** Called by main whenever the sign-in phase changes (setparent mode only attaches when signed in). */
export function setWidgetPhase(p: Phase) { currentPhase = p; setParentCtl?.sync(); }
/** Called before win.focus(): in setparent mode detach first, a desktop child can't be activated. */
export function prepareFocus(win: BrowserWindow) { if (setParentCtl) { (win as any).__dlWantFocus = true; setParentCtl.sync(); } }

export function attachToWindowsDesktop(win: BrowserWindow): string {
  const mode = chooseWinAttachMode(process.env.DESKLIST_WIN_ATTACH);
  let u: User32 | null = null;
  try { u = load(); } catch (e) {
    console.error('[desktop-layer] koffi/user32 unavailable, falling back to normal window:', (e as Error).message);
    return 'windows-unattached';
  }
  if (mode === 'bottom') { keepAtBottom(win, u); return 'windows-hwnd-bottom'; }
  try {
    const target = findDesktopHost(u);
    if (!target) throw new Error('desktop host (SHELLDLL_DefView) not found');
    const me = hwndOf(win);
    if (mode === 'owner') {
      u.SetWindowLongPtrW(me, GWLP_HWNDPARENT, target.host);
      keepAtBottom(win, u);
      return 'windows-owned-by-desktop';
    }
    // Opt-in: attached only while signed in AND not focused; detached (normal top-level window) while
    // the user interacts, so inputs can take keyboard focus. Re-attached on blur.
    let attached = false;
    const sync = () => {
      const want = shouldAttachToDesktop('setparent', currentPhase, win.isFocused() || !!(win as any).__dlWantFocus);
      try {
        if (want && !attached) {
          const t = findDesktopHost(u!); if (!t) return;
          u!.SetParent(me, t.host); u!.SetWindowPos(me, 0, 0, 0, 0, 0, BOTTOM_FLAGS); attached = true;
        } else if (!want && attached) {
          u!.SetParent(me, 0); attached = false;
        }
      } catch { /* ignore */ }
    };
    setParentCtl = { sync };
    win.on('focus', () => { (win as any).__dlWantFocus = false; sync(); });
    win.on('blur', () => { (win as any).__dlWantFocus = false; setTimeout(sync, 300); });
    win.on('show', sync);
    sync();
    return 'windows-setparent-desktop (opt-in, detaches while focused)';
  } catch (e) {
    console.error('[desktop-layer] attach failed, using HWND_BOTTOM fallback:', (e as Error).message);
    keepAtBottom(win, u);
    return 'windows-hwnd-bottom-fallback';
  }
}
