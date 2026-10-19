/** Pure helpers for the Windows desktop-layer mode (unit-tested; no Electron / koffi imports). */
export type WinAttachMode = 'bottom' | 'setparent' | 'owner';

/**
 * Default is 'bottom' (normal top-level window kept at HWND_BOTTOM with SWP_NOACTIVATE): it always
 * receives keyboard focus. 'setparent' (child of the WorkerW/Progman desktop host) cannot be activated
 * by Windows, so typing fails there; it is opt-in only and detaches itself while focused.
 */
export function chooseWinAttachMode(env: string | undefined): WinAttachMode {
  const m = (env ?? '').trim().toLowerCase();
  return m === 'setparent' || m === 'owner' ? m : 'bottom';
}

/** While signed out (sign-in screen) the widget must never be re-parented into the desktop. */
export function shouldAttachToDesktop(mode: WinAttachMode, phase: 'signedOut' | 'loading' | 'ready', focused: boolean): boolean {
  if (mode !== 'setparent') return false;
  return phase === 'ready' && !focused;
}

/** z-order flags used when pushing the widget down: never activate, never move/resize. */
export const SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
export const BOTTOM_FLAGS = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
