import { Popover } from './Popover';
import { useEffect, useRef, useState } from 'react';
import { CURRENCIES, formatAmount, formatUsd, type Snapshot } from '@desklist/shared';

/** "0.08 SOL" + "≈ $12.00" using the live server-side price table carried in the snapshot. */
export function usdOf(s: Snapshot, amount: number, code: string): string | null {
  if (code === 'USD') return null; // amount already in USD: no "≈ USD" line
  const r = s.prices?.usd?.[code as keyof typeof s.prices.usd];
  return r ? formatUsd(amount * r) : null;
}
export function Amount({ s, amount, code, cls = '' }: { s: Snapshot; amount: number; code: string; cls?: string }) {
  const u = usdOf(s, amount, code);
  return <span className={`amt ${cls}`}><b>{formatAmount(amount, code)}</b>{u && <em> ≈ {u}</em>}</span>;
}
export const fmtWithUsd = (s: Snapshot, amount: number, code: string) => { const u = usdOf(s, amount, code); return formatAmount(amount, code) + (u ? ` ≈ ${u}` : ''); };
export const defaultCurrency = (s: Snapshot) => s.currency || 'SOL';
export function rateNote(s: Snapshot) {
  const c = defaultCurrency(s);
  if (c === 'USD') return 'Amounts in USD';
  const r = s.prices?.usd?.[c as keyof typeof s.prices.usd];
  if (r && r < 0.01) return `1 USD = ${formatAmount(1 / r, c)} · live price${s.prices.stale ? ' (cached)' : ''}`;
  const u = usdOf(s, 1, c);
  if (!u) return 'USD rate unavailable';
  return `1 ${c} = ${u} · live price${s.prices.stale ? ' (cached)' : ''}`;
}

export function Toggle({ on, onChange, label, theme = 'light' }: { on: boolean; onChange: (v: boolean) => void; label?: string; theme?: 'light' | 'dark' }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`tgl ${theme} ${on ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }}>
      <i /><span>{label}</span>
    </button>
  );
}

/** Currency dropdown with a search box (IDR + native coins only — no USD / stablecoins). */
export function CurrencySelect({ value, onChange, theme = 'light', compact }: { value: string; onChange: (c: string) => void; theme?: 'light' | 'dark'; compact?: boolean }) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const ref = useRef<HTMLSpanElement>(null); const cb = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || true) return;
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f);
  }, [open]);
  const list = CURRENCIES.filter((c) => !q || (c.code + ' ' + c.name).toLowerCase().includes(q.toLowerCase()));
  return (
    <span className={`csel ${theme} ${compact ? 'compact' : ''}`} ref={ref}>
      <button ref={cb} type="button" className="cbtn" onClick={() => setOpen(!open)} aria-label="Currency">{value} ▾</button>
      {open && (
        <Popover anchor={cb} align="start" className="cpop" role="dialog" onClose={() => { setOpen(false); setQ(''); }}>
          <input autoFocus placeholder="Search currency…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search currency" />
          <div className="clist">
            {list.map((c) => (
              <button type="button" key={c.code} className={c.code === value ? 'on' : ''} onClick={() => { onChange(c.code); setOpen(false); setQ(''); }}>
                <b>{c.code}</b><span>{c.name}</span>
              </button>
            ))}
            {!list.length && <div className="cnone">No match</div>}
          </div>
        </Popover>
      )}
    </span>
  );
}

/** Settings card list (admin): searchable currency list, default marked. */
export function CurrencyList({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const [q, setQ] = useState('');
  const list = CURRENCIES.filter((c) => !q || (c.code + ' ' + c.name).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="curlist">
      <input className="cursearch" placeholder="Search currency…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search currency" />
      <div className="curitems scroll">
        {list.map((c) => (
          <button key={c.code} className={`curi ${c.code === value ? 'on' : ''}`} onClick={() => onPick(c.code)}>
            <span className={`cico c-${c.code}`}>{c.code === 'IDR' ? 'Rp' : c.code === 'USD' ? '$' : c.code[0]}</span>{c.name} ({c.code})
            {c.code === value && <span className="curdef">Default ✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
