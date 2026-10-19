import { useEffect, useState } from 'react';
/** Keeps children mounted for the exit animation (~180 ms), then unmounts. */
export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => { if (open) setMounted(true); else if (mounted) { const t = setTimeout(() => setMounted(false), 180); return () => clearTimeout(t); } }, [open]);
  if (!mounted) return null;
  return <div className={`mcollapse ${open ? 'in' : 'out'}`}>{children}</div>;
}
/** Run `fn` after a short leave animation on the element (list item removal). */
export function leave(el: Element | null, fn: () => void) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return fn();
  el.classList.add('mleaving'); setTimeout(fn, 170);
}
