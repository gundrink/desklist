import { useState } from 'react';
import { FIELD_DATA_TYPES, FIELD_TYPE_LABELS, slugKey, type FieldDataType, type FieldDefinition, type Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { ArrowDown, ArrowUp, Lock, Plus } from '../components/Icons';

/** Runtime management of master field definitions — no code changes needed. */
export function MasterFields({ s, isAdmin }: { s: Snapshot; isAdmin: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(true);
  const active = s.fields.filter((f) => !f.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const archived = s.fields.filter((f) => f.archived);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } };
  const patch = (f: FieldDefinition, body: object) => run(() => actions.request('PATCH', `/api/fields/${f.id}`, body));
  const move = (i: number, d: number) => {
    const ids = active.map((f) => f.id); const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run(() => actions.request('POST', '/api/fields/reorder', { ids: [...ids, ...archived.map((f) => f.id)] }));
  };
  const usage = (f: FieldDefinition) => s.projects.filter((p) => p.fields.some((x) => x.fieldId === f.id)).length;

  return (
    <>
      <div className="rhead"><div className="row"><h1>Master fields</h1><span className="lpill ns">{active.length} active</span></div>
        <div className="sub">Fields every project can use. Add, rename, reorder or archive them at runtime — changes sync to all devices.</div></div>
      <div className="rbody scroll">
        {!isAdmin && <div className="callout">Only admins can change master fields. You can still fill in values per project.</div>}
        {err && <div className="callout err">{err}</div>}
        <div className="card">
          <div className="mf-row mf-head"><span>Order</span><span>Label</span><span>Key</span><span>Type</span><span>Options</span><span>Used by</span><span /></div>
          {active.map((f, i) => (
            <FieldRow key={f.id} f={f} usage={usage(f)} isAdmin={isAdmin} onPatch={(b) => patch(f, b)}
              onUp={() => move(i, -1)} onDown={() => move(i, 1)} first={i === 0} last={i === active.length - 1} />
          ))}
          {archived.length > 0 && <button className="linkbtn" style={{ marginTop: 10 }} onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})</button>}
          {showArchived && archived.map((f) => <FieldRow key={f.id} f={f} usage={usage(f)} isAdmin={isAdmin} onPatch={(b) => patch(f, b)} archived />)}
        </div>
        {isAdmin && <NewField onCreate={(b) => run(() => actions.request('POST', '/api/fields', b))} />}
      </div>
    </>
  );
}

function FieldRow({ f, usage, isAdmin, onPatch, onUp, onDown, first, last, archived }: {
  f: FieldDefinition; usage: number; isAdmin: boolean; onPatch: (b: object) => void; onUp?: () => void; onDown?: () => void; first?: boolean; last?: boolean; archived?: boolean;
}) {
  const [label, setLabel] = useState(f.label);
  const [opts, setOpts] = useState(f.dataType === 'select' ? (f.options.choices ?? []).join(', ') : f.options.currency ?? f.options.hint ?? '');
  const saveOpts = () => {
    if (f.dataType === 'select') onPatch({ options: { ...f.options, choices: opts.split(',').map((x) => x.trim()).filter(Boolean) } });
    else if (f.dataType === 'currency') onPatch({ options: { ...f.options, currency: opts.trim() || 'IDR' } });
    else onPatch({ options: { ...f.options, hint: opts.trim() || undefined } });
  };
  const ro = !isAdmin;
  return (
    <div className={`mf-row ${archived ? 'archived' : ''}`} data-field={f.key}>
      <span className="ord">{!archived && <><button className="iconbtn" disabled={ro || first} onClick={onUp} title="Move up"><ArrowUp /></button>
        <button className="iconbtn" disabled={ro || last} onClick={onDown} title="Move down"><ArrowDown /></button></>}</span>
      <span><div className="inp sm"><input value={label} disabled={ro} onChange={(e) => setLabel(e.target.value)} onBlur={() => label.trim() && label !== f.label && onPatch({ label: label.trim() })} aria-label={`${f.key} label`} /></div></span>
      <span className="mono key">{f.key}</span>
      <span className="type">{FIELD_TYPE_LABELS[f.dataType]}{f.isSecret && <span className="badge secret"><Lock size={11} />encrypted</span>}{f.isCore && <span className="badge">always on</span>}</span>
      <span>{['select', 'currency', 'text', 'email', 'url'].includes(f.dataType) && !f.isCore
        ? <div className="inp sm"><input value={opts} disabled={ro} placeholder={f.dataType === 'select' ? 'Choice A, Choice B' : f.dataType === 'currency' ? 'IDR' : 'hint'} onChange={(e) => setOpts(e.target.value)} onBlur={saveOpts} /></div>
        : <span className="muted small">—</span>}</span>
      <span className="muted small">{usage} project{usage === 1 ? '' : 's'}</span>
      <span>{!f.isCore && isAdmin && <button className="btn sec sm" onClick={() => onPatch({ archived: !archived })}>{archived ? 'Restore' : 'Archive'}</button>}</span>
    </div>
  );
}

function NewField({ onCreate }: { onCreate: (b: object) => Promise<void> }) {
  const [label, setLabel] = useState(''); const [key, setKey] = useState(''); const [type, setType] = useState<FieldDataType>('text');
  const [opts, setOpts] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const options = type === 'select' ? { choices: opts.split(',').map((x) => x.trim()).filter(Boolean) } : type === 'currency' ? { currency: opts.trim() || 'IDR' } : {};
    await onCreate({ label: label.trim(), key: key || slugKey(label), dataType: type, options, isSecret: type === 'password' });
    setLabel(''); setKey(''); setOpts('');
  };
  return (
    <form className="card" onSubmit={submit}>
      <div className="fhead"><h3>Add master field</h3><span className="muted small">Secret (password) fields are encrypted at rest and masked in the UI</span></div>
      <div className="newfield">
        <label className="f"><span>Label</span><div className="inp"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Hosting provider" /></div></label>
        <label className="f"><span>Key <em>auto</em></span><div className="inp"><input className="mono" value={key || (label ? slugKey(label) : '')} onChange={(e) => setKey(e.target.value)} /></div></label>
        <label className="f"><span>Type</span><div className="inp sel"><select value={type} onChange={(e) => setType(e.target.value as FieldDataType)}>
          {FIELD_DATA_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}</select></div></label>
        <label className="f"><span>{type === 'select' ? 'Choices (comma separated)' : type === 'currency' ? 'Currency' : 'Options'}</span>
          <div className="inp"><input value={opts} disabled={type !== 'select' && type !== 'currency'} onChange={(e) => setOpts(e.target.value)} placeholder={type === 'select' ? 'A, B, C' : type === 'currency' ? 'IDR' : '—'} /></div></label>
        <button className="btn pri" disabled={!label.trim()}><Plus size={12} /> Add field</button>
      </div>
    </form>
  );
}
