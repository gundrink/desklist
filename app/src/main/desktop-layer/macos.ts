/**
 * macOS desktop-level widget.
 * type:'desktop' puts the window at kCGDesktopWindowLevel: above the wallpaper/desktop icons,
 * below every normal window, and it is not hidden by Mission Control "Show Desktop".
 * NOTE (not verifiable on Linux CI): desktop-level windows receive mouse clicks; keyboard focus works
 * once clicked, but some macOS versions are picky — if typing fails, the Manage window has the same editors.
 */
import { app, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';

export function macWindowOptions(): Partial<BrowserWindowConstructorOptions> {
  return { type: 'desktop', transparent: true, focusable: true, roundedCorners: true };
}

export function macAfterCreate(win: BrowserWindow) {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setIgnoreMouseEvents(false); // clickable
  app.dock?.hide(); // menu-bar app: no Dock icon (also LSUIElement in electron-builder.yml)
}
