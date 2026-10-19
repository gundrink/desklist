/** Logic test for the Windows widget desktop-layer mode (v0.5.2 focus fix). */
import { describe, expect, it } from 'vitest';
import { BOTTOM_FLAGS, chooseWinAttachMode, shouldAttachToDesktop, SWP_NOACTIVATE } from '../../app/src/main/desktop-layer/mode';

describe('windows desktop-layer mode', () => {
  it('defaults to HWND_BOTTOM (focusable) instead of SetParent', () => {
    expect(chooseWinAttachMode(undefined)).toBe('bottom');
    expect(chooseWinAttachMode('')).toBe('bottom');
    expect(chooseWinAttachMode('garbage')).toBe('bottom');
    expect(chooseWinAttachMode('SetParent')).toBe('setparent');
    expect(chooseWinAttachMode('owner')).toBe('owner');
  });
  it('never re-parents while signed out, loading or focused; only setparent mode attaches', () => {
    expect(shouldAttachToDesktop('setparent', 'signedOut', false)).toBe(false);
    expect(shouldAttachToDesktop('setparent', 'loading', false)).toBe(false);
    expect(shouldAttachToDesktop('setparent', 'ready', true)).toBe(false);
    expect(shouldAttachToDesktop('setparent', 'ready', false)).toBe(true);
    expect(shouldAttachToDesktop('bottom', 'ready', false)).toBe(false);
  });
  it('pushes to bottom without activating', () => {
    expect(BOTTOM_FLAGS & SWP_NOACTIVATE).toBe(SWP_NOACTIVATE);
  });
});
