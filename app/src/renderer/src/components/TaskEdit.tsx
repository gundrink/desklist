import { useState } from 'react';
import { SOCIAL_PLATFORMS, type Snapshot, type Task } from '@desklist/shared';
import { actions } from '../lib/store';
import { Select } from './Select';
import { platformOf } from './ViewMode';

/** Inline rename: Enter saves, Esc cancels. */
export function RenameInput({ t, onDone }: { t: Task; onDone: () => void }) {
  const [v, setV] = useState(t.title);
  const save = () => { const x = v.trim(); if (x && x !== t.title) void actions.updateTask(t.id, { title: x }); onDone(); };
  return <input className="renamein" autoFocus value={v} aria-label="Rename task" onChange={(e) => setV(e.target.value)} onFocus={(e) => e.currentTarget.select()}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.preventDefault(); onDone(); } }} onBlur={save} onClick={(e) => e.stopPropagation()} />;
}


/** Edit panel: name, due date, assignee (BIC), type + platform, Has reimbursement. Values/fields/files are never removed. */
export function TaskEditPanel({ s, t, onClose, compact }: { s: Snapshot; t: Task; onClose: () => void; compact?: boolean }) {
  const [title, setTitle] = useState(t.title); const [due, setDue] = useState(t.dueDate ?? '');
  const [bic, setBic] = useState(t.bicMemberId ?? ''); const [type, setType] = useState<'standard' | 'social'>(t.taskType ?? 'standard');
  const [platform, setPlatform] = useState<string>(platformOf(s, t) || 'Instagram'); const [reimb, setReimb] = useState(!!t.hasExpense);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => {
    if (!title.trim()) return setErr('Name is required');
    setBusy(true); setErr('');
    const patch: Record<string, unknown> = {};
    if (title.trim() !== t.title) patch.title = title.trim();
    if ((due || null) !== (t.dueDate ?? null)) patch.dueDate = due || null;
    if ((bic || null) !== (t.bicMemberId ?? null)) patch.bicMemberId = bic || null;
    if (type !== (t.taskType ?? 'standard')) patch.taskType = type;
    if (type === 'social') patch.platform = platform;
    if (reimb !== !!t.hasExpense) patch.hasExpense = reimb;
    try { if (Object.keys(patch).length) await actions.request('PATCH', `/api/tasks/${t.id}`, patch); onClose(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const members = s.members.filter((m) => !m.revoked);
  return (
    <div className={`teditp ${compact ? 'compact' : ''}`} data-edit={t.title} onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') void save(); }}>
      <div className="te-h">Edit task<button className="iconbtn" aria-label="Close edit" onClick={onClose}>×</button></div>
      <div className="te-grid">
        <label>Name<input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task name" /></label>
        <label>Due date<input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" /></label>
        <label>Assignee<Select value={bic} onChange={(e) => setBic(e.target.value)} aria-label="Assignee"><option value="">— Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></label>
        <label>Type<Select value={type} onChange={(e) => setType(e.target.value as 'standard' | 'social')} aria-label="Edit task type"><option value="standard">Standard</option><option value="social">Social media account</option></Select></label>
        {type === 'social' && <label>Platform<Select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Edit platform">{SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}</Select></label>}
        <label className="te-chk"><input type="checkbox" checked={reimb} onChange={(e) => setReimb(e.target.checked)} aria-label="Has reimbursement" />Has reimbursement</label>
      </div>
      {err && <div className="tferr">{err}</div>}
      <div className="te-btns"><span className="muted small">Field values, notes, files and reimbursements are kept.</span><span className="ml" />
        <button className="btn sec sm" onClick={onClose}>Cancel</button><button className="btn pri sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
    </div>
  );
}
