import { useEffect, useMemo, useRef, useState } from 'react';
import { NOTE_FIELD_TYPE_LABELS, NOTE_FIELD_TYPES, type Note, type NoteFieldType, type Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { CopyBtn } from './Copy';
import { Linkify } from './Linkify';
import { Select } from './Select';
import { Back, Eye, EyeOff, Plus, Trash, X } from './Icons';

type DraftField = { id?: string; label: string; type: NoteFieldType; value: string; keep?: boolean; hasValue?: boolean };
const revealNote = (nid: string, fid: string) => async () =>
  (await actions.request<{ value: string | null }>('GET', `/api/notes/${nid}/fields/${fid}/secret`)).value;
const BookIco = ({ size = 14 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path d="M4 19.5V21h16" /></svg>;
export const SearchIco = ({ size = 13 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
export { BookIco };

/** Notebook: private notes (owner only). `noteId` = open note; 'new' = new note form; null = list. */
export function Notebook({ s, noteId, setNoteId, compact }: { s: Snapshot; noteId: string | null; setNoteId: (id: string | null) => void; compact?: boolean }) {
  const notes = s.notes ?? [];
  const note = notes.find((n) => n.id === noteId);
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [noteId]);
  if (noteId === 'new') return <NoteForm compact={compact} onCancel={() => setNoteId(null)} onSaved={(id) => setNoteId(id)} />;
  if (noteId && !note) return <div className="nb"><div className="nbhd"><button className="iconbtn" aria-label="Back to notebook" onClick={() => setNoteId(null)}><Back /></button><span>Note not found</span></div></div>;
  if (note && editing) return <NoteForm compact={compact} note={note} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />;
  if (note) return <NoteView note={note} compact={compact} onBack={() => setNoteId(null)} onEdit={() => setEditing(true)} onDeleted={() => setNoteId(null)} />;
  return (
    <div className={`nb ${compact ? 'compact' : ''}`} data-notebook>
      <div className="nbhd"><BookIco size={16} /><h2>Notebook</h2><em className="mono">{notes.length}</em><span className="ml" />
        <button className="btn pri sm" data-newnote onClick={() => setNoteId('new')}><Plus size={11} /> New note</button></div>
      <p className="nbsub">Private notes outside projects: API keys, RPC endpoints, logins. Only you can see them.</p>
      {notes.length === 0 ? <div className="nbempty">No notes yet. Click <b>New note</b> to add one.</div> :
        <div className="nblist">{notes.map((n) => (
          <button key={n.id} className="nbrow" data-note={n.id} onClick={() => setNoteId(n.id)}>
            <span className="nbt">{n.title}</span>
            <span className="nbm">{n.fields.length} field{n.fields.length === 1 ? '' : 's'} · {new Date(n.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
          </button>))}</div>}
    </div>
  );
}

function NoteView({ note, compact, onBack, onEdit, onDeleted }: { note: Note; compact?: boolean; onBack: () => void; onEdit: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false); const [err, setErr] = useState('');
  const del = async () => { try { await actions.request('DELETE', `/api/notes/${note.id}`); await actions.refresh(); onDeleted(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className={`nb ${compact ? 'compact' : ''}`} data-noteview>
      <div className="nbhd"><button className="iconbtn" aria-label="Back to notebook" title="Back to notebook" onClick={onBack}><Back /></button>
        <h2 className="ell" title={note.title}>{note.title}</h2><span className="ml" />
        <button className="btn sec sm" onClick={onEdit}>Edit</button>
        <button className="btn sec sm danger" aria-label="Delete note" title="Delete note" onClick={() => setConfirm(true)}><Trash size={12} /></button></div>
      {confirm && <div className="nbconfirm" role="alertdialog">Delete “{note.title}”? This can’t be undone.<span className="ml" />
        <button className="btn sec sm" onClick={() => setConfirm(false)}>Cancel</button><button className="btn sm dangerbtn" data-confirmdel onClick={del}>Delete</button></div>}
      {err && <div className="err small">{err}</div>}
      <div className="nbfields">
        {note.fields.length === 0 && <div className="nbempty">No fields.</div>}
        {note.fields.map((f) => <div key={f.id} className="nbf" data-ftype={f.type}>
          <div className="nbl">{f.label || NOTE_FIELD_TYPE_LABELS[f.type]}<span className="nbty">{NOTE_FIELD_TYPE_LABELS[f.type]}</span></div>
          {f.type === 'secret' ? <SecretValue nid={note.id} fid={f.id} has={!!f.hasValue} label={f.label} />
            : <div className="nbv"><div className={`nbval ${f.type === 'longtext' ? 'long' : ''} ${f.type === 'number' ? 'mono' : ''}`}>
              {f.value ? (f.type === 'url' || f.type === 'longtext' || f.type === 'text' ? <Linkify text={f.value} /> : f.value) : <span className="muted">Empty</span>}</div>
              <CopyBtn text={f.value} label={f.label || 'value'} /></div>}
        </div>)}
      </div>
      <div className="nbfoot muted small">Updated {new Date(note.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  );
}

function SecretValue({ nid, fid, has, label }: { nid: string; fid: string; has: boolean; label: string }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => { if (shown == null) return; const t = setTimeout(() => setShown(null), 30000); return () => clearTimeout(t); }, [shown]);
  if (!has) return <div className="nbv"><div className="nbval"><span className="muted">Empty</span></div></div>;
  // revealed secrets render as plain text: never linkified
  return <div className="nbv"><div className="nbval mono secret" data-secret>{shown ?? '••••••••••••'}</div>
    <button type="button" className="copybtn" aria-label={shown ? 'Hide value' : 'Reveal value'} title={shown ? 'Hide' : 'Reveal'}
      onClick={async () => { if (shown != null) setShown(null); else setShown(await revealNote(nid, fid)() ?? ''); }}>{shown != null ? <EyeOff size={13} /> : <Eye size={13} />}</button>
    <CopyBtn get={revealNote(nid, fid)} label={label || 'secret'} /></div>;
}

function NoteForm({ note, compact, onCancel, onSaved }: { note?: Note; compact?: boolean; onCancel: () => void; onSaved: (id: string) => void }) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [fields, setFields] = useState<DraftField[]>(() => note ? note.fields.map((f) => ({ id: f.id, label: f.label, type: f.type, value: f.type === 'secret' ? '' : f.value ?? '', keep: f.type === 'secret' && !!f.hasValue, hasValue: f.hasValue }))
    : [{ label: '', type: 'text', value: '' }]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const up = (i: number, p: Partial<DraftField>) => setFields((fs) => fs.map((f, j) => j === i ? { ...f, ...p } : f));
  const save = async () => {
    if (!title.trim()) { setErr('Title is required'); return; }
    const bad = fields.find((f) => f.type === 'number' && f.value.trim() && !Number.isFinite(Number(f.value))); if (bad) { setErr(`“${bad.label || 'Number'}” must be a number`); return; }
    setBusy(true); setErr('');
    const body = { title: title.trim(), fields: fields.filter((f) => f.label.trim() || f.value || f.keep).map((f) => ({ id: f.id, label: f.label.trim(), type: f.type,
      ...(f.type === 'secret' && f.keep && !f.value ? { keep: true } : { value: f.value || null }) })) };
    try { const r = note ? await actions.request<Note>('PATCH', `/api/notes/${note.id}`, body) : await actions.request<Note>('POST', '/api/notes', body); await actions.refresh(); onSaved(r.id); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className={`nb ${compact ? 'compact' : ''}`} data-noteform>
      <div className="nbhd"><button className="iconbtn" aria-label="Back" onClick={onCancel}><Back /></button><h2>{note ? 'Edit note' : 'New note'}</h2></div>
      <label className="nbin"><span>Title</span><input autoFocus value={title} maxLength={200} placeholder="e.g. RPC Helius" onChange={(e) => setTitle(e.target.value)} aria-label="Note title" /></label>
      <div className="nbfh">Fields</div>
      <div className="nbform">
        {fields.map((f, i) => <div key={i} className="nbfrow" data-fieldrow>
          <input className="nblab" value={f.label} maxLength={80} placeholder="Label" aria-label={`Field ${i + 1} label`} onChange={(e) => up(i, { label: e.target.value })} />
          <Select className="nbtype" aria-label={`Field ${i + 1} type`} value={f.type} onChange={(e) => up(i, { type: e.target.value as NoteFieldType, keep: false })}>
            {NOTE_FIELD_TYPES.map((t) => <option key={t} value={t}>{NOTE_FIELD_TYPE_LABELS[t]}</option>)}</Select>
          <button type="button" className="iconbtn" aria-label={`Remove field ${i + 1}`} title="Remove field" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}><X /></button>
          <div className="nbval-in">{f.type === 'longtext'
            ? <textarea rows={4} value={f.value} placeholder="Notes…" aria-label={`Field ${i + 1} value`} onChange={(e) => up(i, { value: e.target.value })} />
            : <SecretAwareInput f={f} i={i} onChange={(v) => up(i, { value: v })} />}</div>
        </div>)}
      </div>
      <button type="button" className="btn sec sm addf" data-addfield onClick={() => setFields((fs) => [...fs, { label: '', type: 'text', value: '' }])}><Plus size={11} /> Add field</button>
      {err && <div className="err small" role="alert">{err}</div>}
      <div className="nbbtns"><span className="ml" /><button className="btn sec sm" onClick={onCancel}>Cancel</button>
        <button className="btn pri sm" data-savenote disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save note'}</button></div>
    </div>
  );
}

function SecretAwareInput({ f, i, onChange }: { f: DraftField; i: number; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  const type = f.type === 'secret' ? (show ? 'text' : 'password') : f.type === 'url' ? 'url' : 'text';
  const ph = f.type === 'secret' ? (f.keep ? 'Saved (leave empty to keep)' : 'Secret value') : f.type === 'url' ? 'https://…' : f.type === 'number' ? '0' : 'Value';
  return <div className="nbiwrap"><input type={type} inputMode={f.type === 'number' ? 'decimal' : undefined} autoComplete="off" spellCheck={false} value={f.value} placeholder={ph}
    aria-label={`Field ${i + 1} value`} onChange={(e) => onChange(e.target.value)} />
    {f.type === 'secret' && <button type="button" className="iconbtn" aria-label={show ? 'Hide value' : 'Show value'} onClick={() => setShow(!show)}>{show ? <EyeOff size={13} /> : <Eye size={13} />}</button>}</div>;
}

/* ---------------- Sidebar search ---------------- */
export type SearchHit = { kind: 'project' | 'task' | 'item' | 'field' | 'note'; id: string; projectId?: string; taskId?: string; title: string; sub: string };
export function searchAll(s: Snapshot, q: string): SearchHit[] {
  const n = q.trim().toLowerCase(); if (n.length < 2) return [];
  const has = (v: unknown) => typeof v === 'string' && v.toLowerCase().includes(n);
  const pname = (id: string) => s.projects.find((p) => p.id === id)?.name ?? '';
  const out: SearchHit[] = [];
  for (const p of s.projects) {
    if (has(p.name) || has(p.notes)) out.push({ kind: 'project', id: p.id, projectId: p.id, title: p.name, sub: 'Project' });
    for (const f of s.fields) { const v = p.values?.[f.id]; if (!f.isSecret && (has(v) || (has(f.label) && v))) out.push({ kind: 'field', id: `${p.id}:${f.id}`, projectId: p.id, title: `${f.label}: ${v}`, sub: `Field · ${p.name}` }); }
    for (const c of p.customColumns ?? []) if (has(c.value)) out.push({ kind: 'field', id: c.id, projectId: p.id, title: `${c.label}: ${c.value}`, sub: `Field · ${p.name}` });
  }
  for (const t of s.tasks) if (has(t.title) || has(t.notes)) out.push({ kind: 'task', id: t.id, projectId: t.projectId, taskId: t.id, title: t.title, sub: `Task · ${pname(t.projectId)}` });
  for (const i of s.checklistItems ?? []) if (has(i.title)) { const t = s.tasks.find((x) => x.id === i.taskId); if (t) out.push({ kind: 'item', id: i.id, projectId: t.projectId, taskId: t.id, title: i.title, sub: `Checklist · ${t.title}` }); }
  for (const f of s.taskFields ?? []) if (f.type !== 'password' && has(f.value)) { const t = s.tasks.find((x) => x.id === f.taskId); if (t) out.push({ kind: 'field', id: f.id, projectId: t.projectId, taskId: t.id, title: `${f.label}: ${f.value}`, sub: `Task field · ${t.title}` }); }
  for (const nt of s.notes ?? []) if (has(nt.title) || nt.fields.some((f) => f.type !== 'secret' && (has(f.value) || has(f.label)))) out.push({ kind: 'note', id: nt.id, title: nt.title, sub: 'Notebook' });
  return out.slice(0, 40);
}
const KIND: Record<SearchHit['kind'], string> = { project: 'Project', task: 'Task', item: 'Item', field: 'Field', note: 'Note' };
export function SidebarSearch({ s, onOpen }: { s: Snapshot; onOpen: (h: SearchHit) => void }) {
  const [q, setQ] = useState(''); const [hi, setHi] = useState(0); const box = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => searchAll(s, q), [s, q]);
  useEffect(() => setHi(0), [q]);
  useEffect(() => { const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setQ(''); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  const go = (h: SearchHit) => { onOpen(h); setQ(''); };
  return (
    <div className="sbsearch nodrag" ref={box} data-search>
      <div className="sbin"><SearchIco /><input value={q} placeholder="Search…" aria-label="Search projects, tasks, fields and notes" onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); } if (e.key === 'Enter' && hits[hi]) go(hits[hi]); }} />
        {q && <button className="sbx" aria-label="Clear search" onClick={() => setQ('')}><X size={10} /></button>}</div>
      {q.trim().length >= 2 && <div className="sbres" role="listbox" data-results>
        {hits.length === 0 ? <div className="sbnone">No results</div> : hits.map((h, i) => (
          <button key={h.kind + h.id} role="option" aria-selected={i === hi} className={`sbhit ${i === hi ? 'hi' : ''}`} data-kind={h.kind} onMouseEnter={() => setHi(i)} onClick={() => go(h)}>
            <span className="sbk">{KIND[h.kind]}</span><span className="sbt"><b className="ell">{h.title}</b><em className="ell">{h.sub}</em></span></button>))}
      </div>}
    </div>
  );
}
export function NotebookNavBtn({ on, count, onClick, className = '' }: { on: boolean; count: number; onClick: () => void; className?: string }) {
  return <button className={`nbnav ${className} ${on ? 'on' : ''}`} data-nav="notebook" aria-current={on ? 'page' : undefined} onClick={onClick}><BookIco />Notebook<span className="ml" /><em className="mono">{count}</em></button>;
}
