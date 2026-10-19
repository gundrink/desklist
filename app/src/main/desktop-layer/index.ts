/**
 * Desktop-level placement for the widget window: above the wallpaper, below normal windows,
 * NOT always-on-top. Platform specifics are isolated here.
 *
 *  macOS   → BrowserWindow type 'desktop' (kCGDesktopWindowLevel), visible on all Spaces (see macos.ts)
 *  Windows → re-parent into the desktop icon layer via user32 (see windows.ts), fallback HWND_BOTTOM
 *  Linux   → best effort: plain frameless window kept at the bottom (dev / CI only)
 */
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { macWindowOptions, macAfterCreate } from './macos';
import { attachToWindowsDesktop, prepareFocus, setWidgetPhase } from './windows';

/** Give the widget keyboard focus (Windows: detach from the desktop host first if attached). */
export function focusWidget(win: BrowserWindow) {
  if (process.platform === 'win32') prepareFocus(win);
  if (!win.isFocused()) win.focus();
}
export function widgetPhaseChanged(phase: 'signedOut' | 'loading' | 'ready') { if (process.platform === 'win32') setWidgetPhase(phase); }

export function desktopWindowOptions(): Partial<BrowserWindowConstructorOptions> {
  const base: Partial<BrowserWindowConstructorOptions> = {
    frame: false, transparent: true, hasShadow: false, skipTaskbar: true, alwaysOnTop: false,
    resizable: true, minimizable: false, maximizable: false, fullscreenable: false, backgroundColor: '#00000000',
  };
  if (process.platform === 'darwin') return { ...base, ...macWindowOptions() };
  return base;
}

export function placeOnDesktop(win: BrowserWindow): string {
  if (process.platform === 'darwin') { macAfterCreate(win); return 'macos-desktop-level'; }
  if (process.platform === 'win32') return attachToWindowsDesktop(win);
  // Linux/dev: no portable desktop layer; just keep it out of the way.
  win.on('focus', () => { /* leave stacking to the WM */ });
  return 'linux-normal';
}
