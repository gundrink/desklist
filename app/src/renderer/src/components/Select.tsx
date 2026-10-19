import { Children, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Opt = { value: string; label: string; disabled?: boolean };
function collect(children: ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as any;
    if (el.type === 'option') out.push({ value: String(el.props.value ?? textOf(el.props.children)), label: textOf(el.props.children), disabled: el.props.disabled });
    else if (el.props?.children) collect(el.props.children, out);
  });
  return out;
}
function textOf(n: ReactNode): string { let s = ''; Children.forEach(n, (c) => { if (typeof c === 'string' || typeof c === 'number') s += c; else if (isValidElement(c)) s += textOf((c as any).props.children); }); return s; }

/** Drop-in themed replacement for <Select>: same children (<option>) and onChange(e.target.value). Portaled popover,
 *  keyboard nav (arrows, Home/End, Enter, Esc, type-ahead), search when > 8 options. */
export function Select({ value, onChange, children, className = '', disabled, ...rest }: {
  value?: string | number | null; onChange?: (e: { target: { value: string } }) => void; children: ReactNode; className?: string; disabled?: boolean;
  'aria-label'?: string; title?: string; onBlur?: () => void; autoFocus?: boolean;
}) {
  const opts = useMemo(() => collect(children), [children]);
  const val = value == null ? '' : String(value);
  const cur = opts.find((o) => o.value === val);
  const [open, setOpen] = useState(false); const [hi, setHi] = useState(0); const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null); const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean }>({ left: 0, top: 0, width: 0, up: false });
  const search = opts.length > 8;
  const shown = q ? opts.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : opts;
  const place = () => { const r = btn.current!.getBoundingClientRect(); const h = Math.min(320, shown.length * 32 + (search ? 44 : 8)); const up = r.bottom + h > window.innerHeight - 8 && r.top > h;
    setPos({ left: Math.min(r.left, window.innerWidth - Math.max(r.width, 160) - 6), top: up ? r.top - h - 4 : r.bottom + 4, width: Math.max(r.width, 160), up }); };
  useLayoutEffect(() => { if (open) place(); }, [open, q]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const t0 = Date.now(); const sc = (e: Event) => { if (Date.now() - t0 > 250 && !pop.current?.contains(e.target as Node)) close(); };
    (pop.current?.querySelector('.sel-search') as HTMLInputElement | null)?.focus({ preventScroll: true });
    document.addEventListener('mousedown', down, true); const rz = () => close(); window.addEventListener('resize', rz); document.addEventListener('scroll', sc, true);
    return () => { document.removeEventListener('mousedown', down, true); window.removeEventListener('resize', rz); document.removeEventListener('scroll', sc, true); };
  }, [open]);
  const openIt = () => { if (disabled) return; setQ(''); setHi(Math.max(0, opts.findIndex((o) => o.value === val))); setOpen(true); };
  const close = (refocus = false) => { setOpen(false); setQ(''); if (refocus) btn.current?.focus(); };
  const pick = (o?: Opt) => { if (!o || o.disabled) return; if (o.value !== val) onChange?.({ target: { value: o.value } }); close(true); };
  const typed = useRef({ s: '', t: 0 }); const lastToggle = useRef(0); // a wrapping <label> re-dispatches the click
  const key = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openIt(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setHi(0); } else if (e.key === 'End') { e.preventDefault(); setHi(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
    else if (!search && e.key.length === 1) {
      const now = Date.now(); typed.current = { s: (now - typed.current.t < 700 ? typed.current.s : '') + e.key.toLowerCase(), t: now };
      const i = shown.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.s)); if (i >= 0) setHi(i);
    }
  };
  useEffect(() => { // keep the highlighted option visible without scrolling any ancestor
    const list = pop.current?.querySelector('.sel-list') as HTMLElement | null; const el = list?.querySelector('.sel-opt.hi') as HTMLElement | null;
    if (list && el) { if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop; else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight; }
  }, [hi, open]);
  return (
    <>
      <button type="button" ref={btn} className={`selx ${className} ${open ? 'open' : ''}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        aria-label={rest['aria-label']} title={rest.title} onClick={(e) => { e.preventDefault(); const now = Date.now(); if (now - lastToggle.current < 80) return; lastToggle.current = now; if (open) close(); else openIt(); }} onKeyDown={key} onBlur={rest.onBlur} autoFocus={rest.autoFocus} data-value={val}>
        <span className="selx-v">{cur?.label || '—'}</span><svg className="selx-c" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && createPortal(
        <div ref={pop} className={`sel-pop ${pos.up ? 'up' : ''}`} role="listbox" aria-label={rest['aria-label']} style={{ left: pos.left, top: pos.top, minWidth: pos.width }} onKeyDown={key}>
          {search && <input className="sel-search" value={q} placeholder="Search…" aria-label="Search options" onChange={(e) => { setQ(e.target.value); setHi(0); }} />}
          <div className="sel-list">
            {shown.map((o, i) => <div key={o.value + i} role="option" aria-selected={o.value === val} className={`sel-opt ${i === hi ? 'hi' : ''} ${o.value === val ? 'on' : ''} ${o.disabled ? 'dis' : ''}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
              <span>{o.label || '—'}</span>{o.value === val && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.5l2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>}</div>)}
            {!shown.length && <div className="sel-empty">No matches</div>}
          </div>
        </div>, document.body)}
    </>
  );
}

/** Chip/tag editor for dropdown options: Enter or comma adds, paste "a, b, c" splits, × removes. */
export function ChipInput({ value, onChange, placeholder = 'Type an option, press Enter', ...rest }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; 'aria-label'?: string }) {
  const [t, setT] = useState('');
  const add = (raw: string) => { const parts = raw.split(',').map((x) => x.trim()).filter(Boolean); if (!parts.length) return; onChange([...value, ...parts.filter((p) => !value.includes(p))]); setT(''); };
  return (
    <div className="chips" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {value.map((c, i) => <span className="chip" key={c + i} data-chip={c}>{c}<button type="button" aria-label={`Remove ${c}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></span>)}
      <input value={t} aria-label={rest['aria-label']} placeholder={value.length ? '' : placeholder}
        onChange={(e) => { const v = e.target.value; if (v.includes(',')) add(v); else setT(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(t); } else if (e.key === 'Backspace' && !t && value.length) onChange(value.slice(0, -1)); }}
        onPaste={(e) => { const s = e.clipboardData.getData('text'); if (s.includes(',') || s.includes('\n')) { e.preventDefault(); add(t + s.replace(/\n/g, ',')); } }}
        onBlur={() => t.trim() && add(t)} />
    </div>
  );
}
