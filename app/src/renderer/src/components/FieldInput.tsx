import { useEffect, useState } from 'react';
import type { FieldDefinition, Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { Eye, EyeOff, Lock, Mail } from './Icons';
import { Avatar } from './Common';
import { initialsOf } from '../lib/model';

const INPUT_TYPE: Record<string, string> = { email: 'email', url: 'url', number: 'number', date: 'date', currency: 'text', text: 'text', password: 'password' };

/** One editable value for a master field (or a free-form column via `dataType`). Commits on blur / Enter / change. */
export function FieldInput({ s, field, dataType, value, onCommit, secretSet, projectId, autoFocus, placeholder }: {
  s: Snapshot; field?: FieldDefinition; dataType?: string; value: string | null; onCommit: (v: string | null) => void;
  secretSet?: boolean; projectId?: string; autoFocus?: boolean; placeholder?: string;
}) {
  const type = field?.dataType ?? dataType ?? 'text';
  const [draft, setDraft] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!focused) setDraft(value ?? ''); }, [value, focused]);
  const commit = (v = draft) => { if ((v || null) !== (value || null)) onCommit(v.trim() === '' ? null : v); };
  const isAdmin = s.me.role === 'admin';

  if (type === 'select') {
    return (
      <div className="inp sel">
        <span className="sdot" style={{ background: value ? 'var(--teal)' : '#cbd5e1' }} />
        <select value={value ?? ''} onChange={(e) => onCommit(e.target.value || null)} autoFocus={autoFocus}>
          <option value="">—</option>
          {(field?.options.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    );
  }
  if (type === 'person') {
    const m = s.members.find((x) => x.id === value);
    return (
      <div className="inp sel">
        {m && <Avatar initials={m.initials} size="xs" />}
        <select value={value ?? ''} onChange={(e) => onCommit(e.target.value || null)}>
          <option value="">—</option>
          {s.members.filter((x) => !x.revoked).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
    );
  }
  if (type === 'longtext') {
    return <textarea className="inp area" value={draft} placeholder={placeholder} autoFocus={autoFocus}
      onFocus={() => setFocused(true)} onChange={(e) => setDraft(e.target.value)} onBlur={() => { setFocused(false); commit(); }} />;
  }
  const isPw = type === 'password';
  const toggleReveal = async () => {
    if (reveal) { setReveal(false); setDraft(''); return; }
    if (projectId && field && secretSet) {
      try { const r = await actions.request<{ value: string | null }>('GET', `/api/projects/${projectId}/secret/${field.id}`); setDraft(r.value ?? ''); setErr(null); }
      catch (e) { setErr((e as Error).message); }
    }
    setReveal(true);
  };
  const lead = isPw ? <Lock /> : type === 'email' ? <Mail /> : field?.key === 'pic_name' && value ? <Avatar initials={initialsOf(value)} size="xs" /> : null;
  return (
    <div className={`inp ${focused ? 'focus' : ''}`} title={err ?? undefined}>
      {lead && <span className="ico">{lead}</span>}
      <input type={isPw && !reveal ? 'password' : INPUT_TYPE[type] ?? 'text'} value={draft} autoFocus={autoFocus}
        placeholder={isPw && secretSet && !draft ? '•••••••• (stored, encrypted)' : placeholder ?? ''}
        inputMode={type === 'currency' || type === 'number' ? 'decimal' : undefined}
        onFocus={() => setFocused(true)} onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setFocused(false); if (!isPw || draft) commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {type === 'currency' && <span className="tail mono">{field?.options.currency ?? 'IDR'}</span>}
      {isPw && isAdmin && <button type="button" className="tail eye" title={reveal ? 'Hide' : 'Reveal (admin)'} onClick={toggleReveal}>{reveal ? <EyeOff /> : <Eye />}</button>}
    </div>
  );
}
