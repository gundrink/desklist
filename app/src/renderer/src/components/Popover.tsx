import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Every popover/menu renders here: portaled to <body>, position:fixed from the trigger rect,
 *  flips above/below, shifts inside the viewport, repositions on scroll/resize. z = var(--z-popover). */
export function Popover({ anchor, onClose, className = '', children, role = 'menu', align = 'end', label }: {
  anchor: RefObject<HTMLElement | null>; onClose: () => void; className?: string; children: ReactNode; role?: string; align?: 'start' | 'end'; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const place = () => {
    const a = anchor.current, el = ref.current; if (!a || !el) return;
    const r = a.getBoundingClientRect(); const w = el.offsetWidth, h = el.offsetHeight; const M = 6;
    const vw = window.innerWidth, vh = window.innerHeight;
    const up = r.bottom + 4 + h > vh - M && r.top - 4 - h >= M;
    let top = up ? r.top - 4 - h : r.bottom + 4; top = Math.max(M, Math.min(top, vh - h - M));
    let left = align === 'end' ? r.right - w : r.left; left = Math.max(M, Math.min(left, vw - w - M));
    for (const [k, v] of [['position', 'fixed'], ['left', left + 'px'], ['top', top + 'px'], ['right', 'auto'], ['bottom', 'auto'], ['z-index', 'var(--z-popover)'], ['margin', '0'], ['visibility', 'visible']]) el.style.setProperty(k, v, 'important');
    setPos({ left, top, up });
  };
  useLayoutEffect(place, []);
  useEffect(() => {
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const re = () => place();
    document.addEventListener('mousedown', down, true); document.addEventListener('keydown', key, true);
    window.addEventListener('resize', re); document.addEventListener('scroll', re, true);
    const ro = new ResizeObserver(re); if (ref.current) ro.observe(ref.current);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', re); document.removeEventListener('scroll', re, true); ro.disconnect(); };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className={`pop portal-pop ${className} ${pos?.up ? 'up' : ''}`} role={role} aria-label={label} data-portal="1"
      style={{ position: 'fixed', left: -9999, top: -9999, visibility: 'hidden' }}
      onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>{children}</div>, document.body);
}
