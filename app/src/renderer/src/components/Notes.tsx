import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { CUSTOM_COLUMN_TYPES, CUSTOM_COLUMN_TYPE_LABELS, type CustomColumnType, type Project, type Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { projectFields } from '../lib/model';
import { FieldInput } from './FieldInput';
import { Columns, Data, FieldIco, NoteLines, Plus, Trash, X } from './Icons';

export type NotesKind = 'notes' | 'column' | 'field' | 'data';
export const NOTES_ITEMS: { kind: NotesKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'notes', label: 'Input notes', icon: <NoteLines /> },
  { kind: 'column', label: 'Input column', icon: <Columns /> },
  { kind: 'field', label: 'Input field', icon: <FieldIco /> },
  { kind: 'data', label: 'Input data', icon: <Data /> },
];

/** The "Notes" column menu (4 options). Shared by the Manage checklist header and the widget. */
export function NotesMenu({ onPick, onClose, theme, style }: { onPick: (k: NotesKind) => void; onClose: () => void; theme: 'dark' | 'light'; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => document.addEventListener('mousedown', f));
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); };
  }, [onClose]);
  return (
    <div className={`pop ${theme}`} ref={ref} style={style} role="menu">
      <div className="pophd">Notes column</div>
      {NOTES_ITEMS.map((i) => (
        <button key={i.kind} className="pi" role="menuitem" onClick={() => { onPick(i.kind); onClose(); }}>{i.icon}{i.label}</button>
      ))}
    </div>
  );
}

/** Editors behind the Notes menu. Every edit is optimistic + synced (outbox → server → both windows). */
export function NotesSheet({ s, p, kind, setKind, onClose, theme }: {
  s: Snapshot; p: Project; kind: NotesKind; setKind: (k: NotesKind) => void; onClose: () => void; theme: 'dark' | 'light';
}) {
  return (
    <div className={`sheet-wrap ${theme}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Notes editor">
        <div className="sheet-head">
          <div className="seg">
            {NOTES_ITEMS.map((i) => <button key={i.kind} className={kind === i.kind ? 'on' : ''} onClick={() => setKind(i.kind)}>{i.icon}<span>{i.label.replace('Input ', '')}</span></button>)}
          </div>
          <button className="iconbtn" onClick={onClose} title="Close"><X /></button>
        </div>
        <div className="sheet-sub">{NOTES_ITEMS.find((i) => i.kind === kind)?.label} <span className="muted">· {p.name}</span></div>
        <div className="sheet-body">
          {kind === 'notes' && <NotesEditor p={p} />}
          {kind === 'column' && <ColumnEditor s={s} p={p} />}
          {kind === 'field' && <FieldAdder s={s} p={p} onAdded={() => setKind('data')} />}
          {kind === 'data' && <DataEditor s={s} p={p} />}
        </div>
      </div>
    </div>
  );
}

function NotesEditor({ p }: { p: Project }) {
  const [text, setText] = useState(p.notes);
  const [state, setState] = useState<'saved' | 'typing'>('saved');
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { if (!focused.current) setText(p.notes); }, [p.notes]);
  const change = (v: string) => {
    setText(v); setState('typing');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void actions.setProjectNotes(p.id, v); setState('saved'); }, 500); // autosave
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className="stack">
      <textarea className="inp area big" value={text} autoFocus placeholder="Project notes — autosaves and syncs to every device…"
        onFocus={() => (focused.current = true)} onBlur={() => { focused.current = false; if (text !== p.notes) void actions.setProjectNotes(p.id, text); }}
        onChange={(e) => change(e.target.value)} />
      <div className="muted small">{state === 'typing' ? 'Saving…' : 'Saved · autosave on'}</div>
    </div>
  );
}

function ColumnEditor({ s, p }: { s: Snapshot; p: Project }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomColumnType>('text');
  const [value, setValue] = useState('');
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    void actions.addColumn(p.id, label, type, value || null);
    setLabel(''); setValue('');
  };
  return (
    <div className="stack">
      <form className="stack" onSubmit={add}>
        <div className="row2">
          <label className="f"><span>Column label</span><div className="inp"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Repo link" autoFocus /></div></label>
          <label className="f"><span>Type</span><div className="inp sel"><select value={type} onChange={(e) => setType(e.target.value as CustomColumnType)}>
            {CUSTOM_COLUMN_TYPES.map((t) => <option key={t} value={t}>{CUSTOM_COLUMN_TYPE_LABELS[t]}</option>)}</select></div></label>
        </div>
        <label className="f"><span>Value <em>optional</em></span>
          {type === 'longtext' ? <textarea className="inp area" value={value} onChange={(e) => setValue(e.target.value)} />
            : <div className="inp"><input type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} /></div>}
        </label>
        <div><button className="btn pri sm" disabled={!label.trim()}><Plus size={12} /> Add column</button></div>
      </form>
      {p.customColumns.length > 0 && <div className="sect-title">This project's columns</div>}
      {p.customColumns.map((c) => (
        <div className="kv" key={c.id}>
          <span className="k">{c.label}<em>{CUSTOM_COLUMN_TYPE_LABELS[c.dataType]}</em></span>
          <span className="v ell">{c.value || '—'}</span>
          <button className="iconbtn" title="Remove column" onClick={() => actions.deleteColumn(c.id)}><Trash /></button>
        </div>
      ))}
    </div>
  );
}

function FieldAdder({ s, p, onAdded }: { s: Snapshot; p: Project; onAdded: () => void }) {
  const used = new Set(p.fields.map((f) => f.fieldId));
  const avail = s.fields.filter((f) => !f.archived && !used.has(f.id));
  const [fid, setFid] = useState(avail[0]?.id ?? '');
  const [value, setValue] = useState<string | null>(null);
  const f = s.fields.find((x) => x.id === fid);
  if (!avail.length) return <div className="empty-note">This project already uses every master field. Admins can add more under <b>Master fields</b>.</div>;
  return (
    <div className="stack">
      <label className="f"><span>Master field</span><div className="inp sel"><select value={fid} onChange={(e) => { setFid(e.target.value); setValue(null); }}>
        {avail.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div></label>
      {f && <label className="f"><span>Value <em>optional</em></span><FieldInput key={f.id} s={s} field={f} value={value} onCommit={setValue} /></label>}
      <div><button className="btn pri sm" disabled={!fid} onClick={() => { void actions.addFieldToProject(p.id, fid, value); onAdded(); }}><Plus size={12} /> Add field to project</button></div>
    </div>
  );
}

function DataEditor({ s, p }: { s: Snapshot; p: Project }) {
  const fields = projectFields(s, p);
  return (
    <div className="stack">
      <div className="sect-title">Master fields</div>
      <div className="grid2">
        {fields.map((f) => (
          <label className="f" key={f.id}><span>{f.label}</span>
            <FieldInput s={s} field={f} value={p.values[f.id] ?? null} secretSet={p.secretSet[f.id]} projectId={p.id}
              onCommit={(v) => actions.setFieldValue(p.id, f.id, v)} /></label>
        ))}
      </div>
      <div className="sect-title">Columns</div>
      {p.customColumns.length === 0 && <div className="muted small">No free-form columns yet — use “Input column”.</div>}
      <div className="grid2">
        {p.customColumns.map((c) => (
          <label className="f" key={c.id}><span>{c.label}</span>
            <FieldInput s={s} dataType={c.dataType} value={c.value} onCommit={(v) => actions.setColumnValue(c.id, v)} /></label>
        ))}
      </div>
    </div>
  );
}
