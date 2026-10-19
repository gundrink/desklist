import { useEffect, useRef, useState } from 'react';
import type { AppState } from '../../../common/ipc';
import { actions } from '../lib/store';

export const opacityOf = (st: AppState | null) => st?.settings.widgetOpacity ?? 85;
export const blurOf = (st: AppState | null) => st?.settings.widgetBlur ?? true;
/** Inline style for the widget panel: only the background/border alpha changes; text stays opaque. */
export function widgetLook(st: AppState | null): React.CSSProperties {
  const a = opacityOf(st) / 100;
  return { ['--wa' as never]: String(a), ['--wba' as never]: String(Math.max(0.06, 0.12 * Math.max(a, 0.5))) } as React.CSSProperties;
}
export const lookClass = (st: AppState | null) => `${blurOf(st) && opacityOf(st) < 95 ? 'wblur' : ''} ${opacityOf(st) < 60 ? 'wlow' : ''}`;

/** Slider 0–100 + Blur toggle; applies live while dragging (throttled IPC), persisted per device. */
export function OpacityControl({ st, compact }: { st: AppState; compact?: boolean }) {
  const [v, setV] = useState(opacityOf(st)); const t = useRef(0);
  useEffect(() => setV(opacityOf(st)), [st.settings.widgetOpacity]);
  const push = (n: number) => { setV(n); const now = Date.now(); if (now - t.current > 30) { t.current = now; void actions.setSetting({ widgetOpacity: n }); } };
  return (
    <div className={`opctl ${compact ? 'compact' : ''}`} onClick={(e) => e.stopPropagation()}>
      <label className="oprow"><span>Background opacity</span><b className="mono">{v}%</b></label>
      <input type="range" min={0} max={100} step={1} value={v} aria-label="Widget background opacity"
        onChange={(e) => push(Number(e.target.value))} onPointerUp={() => void actions.setSetting({ widgetOpacity: v })} onKeyUp={() => void actions.setSetting({ widgetOpacity: v })} />
      <label className="opblur"><input type="checkbox" checked={blurOf(st)} aria-label="Blur background" onChange={(e) => void actions.setSetting({ widgetBlur: e.target.checked })} />Blur background</label>
    </div>
  );
}
