import { useEffect, useState } from 'react';
import { TASK_FIELD_TYPES, TASK_FIELD_TYPE_LABELS, type Snapshot, type TaskFieldType } from '@desklist/shared';
import { actions } from '../lib/store';

type SF = { label: string; type: TaskFieldType; options: { choices?: string[] }; reimbursement: boolean };
type Setup = { id: string; title: string; fields: SF[]; updatedAt: string };

/** Admin: define, once, which detail fields a task (by name, e.g. "Buy Gmail") has. Members then only fill values. */
export function TaskSetup({ s }: { s: Snapshot }) {
  const [list, setList] = useState<Setup[]>([]);
  const [title, setTitle] = useState(''); const [fields, setFields] = useState<SF[]>([]);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => setList(await actions.request<Setup[]>('GET', '/api/task-setups'));
  useEffect(() => { void load(); }, []);
  const pick = (x: Setup) => { setTitle(x.title); setFields(x.fields.map((f) => ({ ...f, options: f.options ?? {} }))); setMsg(''); };
  const upd = (i: number, p: Partial<SF>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await actions.request<Setup & { appliedTo: number }>('PUT', '/api/task-setups', { title, fields: fields.filter((f) => f.label.trim()) });
      setMsg(`Saved · applied to ${r.appliedTo} existing task${r.appliedTo === 1 ? '' : 's'} named “${r.title}”. New tasks with this name get these fields automatically.`); await load();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const names = [...new Set(s.tasks.map((t) => t.title))].sort();
  return (
    <>
      <div className="rhead"><div className="row"><h1>Task setup</h1><span className="lpill">Admin</span></div>
        <div className="sub">Define the detail fields of a task once, by task name. Members just fill the values — in Manage and the widget.</div></div>
      <div className="rbody scroll">
        <div className="details tsetup">
          <div className="card">
            <div className="fhead"><h3>Configured tasks</h3><button className="btn sec sm" onClick={() => { setTitle(''); setFields([]); setMsg(''); }}>+ New setup</button></div>
            {list.map((x) => <button key={x.id} className={`tsrow ${x.title === title ? 'on' : ''}`} onClick={() => pick(x)} data-setup={x.title}>
              <b>{x.title}</b><span className="muted small">{x.fields.length} fields · {x.fields.filter((f) => f.reimbursement).length} reimbursement</span></button>)}
            {!list.length && <div className="muted small">No task setups yet.</div>}
          </div>
          <div className="card">
            <div className="fhead"><h3>{title ? `Fields for “${title}”` : 'New task setup'}</h3></div>
            <label className="f"><span>Task name <em>matches tasks with this name in every project &amp; template</em></span>
              <div className="inp"><input list="tasknames" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Buy Gmail" aria-label="Setup task name" /></div>
              <datalist id="tasknames">{names.map((n) => <option key={n} value={n} />)}</datalist></label>
            <div className="tshead"><span>Field name</span><span>Type</span><span>Options</span><span>Reimbursement</span><span /></div>
            {fields.map((f, i) => (
              <div className="tsfield" key={i} data-setupfield={f.label}>
                <input value={f.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Field name" aria-label={`Field ${i + 1} name`} />
                <select value={f.type} onChange={(e) => upd(i, { type: e.target.value as TaskFieldType })} aria-label={`Field ${i + 1} type`}>
                  {TASK_FIELD_TYPES.map((t) => <option key={t} value={t}>{TASK_FIELD_TYPE_LABELS[t]}</option>)}</select>
                {f.type === 'dropdown' ? <input value={(f.options.choices ?? []).join(', ')} onChange={(e) => upd(i, { options: { choices: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} placeholder="Option A, Option B" aria-label={`Field ${i + 1} options`} /> : <span className="muted small">—</span>}
                <label className="tsr"><input type="checkbox" checked={f.reimbursement} onChange={(e) => upd(i, { reimbursement: e.target.checked })} aria-label={`Field ${i + 1} reimbursement`} />Reimbursement</label>
                <button className="rowdel" title="Remove field" onClick={() => setFields(fields.filter((_, j) => j !== i))}>×</button>
              </div>))}
            <div className="form-actions">
              <button className="btn sec" onClick={() => setFields([...fields, { label: '', type: 'text', options: {}, reimbursement: false }])}>+ Add field</button>
              <span className="ml" />
              {list.some((x) => x.title === title) && <button className="btn sec" onClick={async () => { const x = list.find((y) => y.title === title)!; await actions.request('DELETE', `/api/task-setups/${x.id}`); setTitle(''); setFields([]); await load(); }}>Delete setup</button>}
              <button className="btn pri" disabled={busy || !title.trim() || !fields.some((f) => f.label.trim())} onClick={save}>Save setup</button>
            </div>
            {msg && <div className="callout">{msg}</div>}
            <div className="muted small">Fields marked Reimbursement appear in the task’s Reimbursement section; an Amount field there sets the reimbursement amount.</div>
          </div>
        </div>
      </div>
    </>
  );
}
