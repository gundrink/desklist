import { Select } from '../components/Select';
import { useState } from 'react';
import { CUSTOM_COLUMN_TYPES, CUSTOM_COLUMN_TYPE_LABELS, type CustomColumnType, type Project, type Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { FieldInput } from '../components/FieldInput';
import { Plus, Trash } from '../components/Icons';

interface Col { key: number; label: string; dataType: CustomColumnType; value: string }

export function CreateProject({ s, onCreated, onCancel }: { s: Snapshot; onCreated: (id: string) => void; onCancel: () => void }) {
  const active = s.fields.filter((f) => !f.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const core = active.find((f) => f.isCore);
  const [name, setName] = useState('');
  const [use, setUse] = useState<Record<string, boolean>>(Object.fromEntries(active.map((f) => [f.id, true])));
  const [req, setReq] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string | null>>({});
  const [cols, setCols] = useState<Col[]>([]);
  const [notes, setNotes] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const addCol = () => setCols([...cols, { key: Date.now(), label: '', dataType: 'text', value: '' }]);
  const setCol = (k: number, patch: Partial<Col>) => setCols(cols.map((c) => (c.key === k ? { ...c, ...patch } : c)));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const chosen = active.filter((f) => use[f.id] || f.isCore);
      const p = await actions.request<Project>('POST', '/api/projects', {
        name, notes, deadline: deadline || null,
        fields: chosen.map((f) => ({ fieldId: f.id, required: !!req[f.id] })),
        values: Object.fromEntries(Object.entries(values).filter(([k, v]) => use[k] && v != null && k !== core?.id)),
        customColumns: cols.filter((c) => c.label.trim()).map((c) => ({ label: c.label.trim(), dataType: c.dataType, value: c.value || null })),
      });
      onCreated(p.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="rhead"><div className="row"><h1>New project</h1></div>
        <div className="sub">Pick master fields, add free-form columns for this project only.</div></div>
      <div className="rbody scroll">
        <div className="details">
          <div className="card">
            <div className="fhead"><h3>Master fields</h3><span className="muted small">Uncheck fields this project doesn’t need</span></div>
            <div className="grid">
              <label className="f"><span>Project name <em>always on · required</em></span>
                <div className="inp focus-ring"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Project H" autoFocus aria-label="Project name" /></div></label>
              <label className="f"><span>Deadline <em>optional</em></span>
                <div className="inp focus-ring"><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Deadline" /></div></label>
              {active.filter((f) => !f.isCore).map((f) => (
                <div className={`f ${use[f.id] ? '' : 'off'}`} key={f.id}>
                  <span className="flabel">
                    <input type="checkbox" checked={!!use[f.id]} onChange={(e) => setUse({ ...use, [f.id]: e.target.checked })} aria-label={`Use ${f.label}`} />
                    {f.label}
                    <label className="req"><input type="checkbox" checked={!!req[f.id]} disabled={!use[f.id]} onChange={(e) => setReq({ ...req, [f.id]: e.target.checked })} />required</label>
                  </span>
                  {use[f.id] && <FieldInput s={s} field={f} value={values[f.id] ?? null} onCommit={(v) => setValues({ ...values, [f.id]: v })} />}
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="fhead"><h3>Project columns</h3><span className="muted small">Free-form: source, repo link, deadline, budget…</span></div>
            {cols.map((c) => (
              <div className="colrow" key={c.key}>
                <div className="inp"><input value={c.label} onChange={(e) => setCol(c.key, { label: e.target.value })} placeholder="Column label" aria-label="Column label" /></div>
                <div className="inp sel narrow"><Select value={c.dataType} onChange={(e) => setCol(c.key, { dataType: e.target.value as CustomColumnType })} aria-label="Column type">
                  {CUSTOM_COLUMN_TYPES.map((t) => <option key={t} value={t}>{CUSTOM_COLUMN_TYPE_LABELS[t]}</option>)}</Select></div>
                <div className="inp"><input type={c.dataType === 'date' ? 'date' : c.dataType === 'number' ? 'number' : 'text'} value={c.value}
                  onChange={(e) => setCol(c.key, { value: e.target.value })} placeholder="Value (optional)" aria-label="Column value" /></div>
                <button className="iconbtn" onClick={() => setCols(cols.filter((x) => x.key !== c.key))} title="Remove"><Trash /></button>
              </div>
            ))}
            <button className="addf" onClick={addCol}><Plus size={14} w={2.4} />Add column</button>
            <span className="hint">Text, URL, date, number, long text, currency</span>
          </div>
          <div className="card">
            <div className="fhead"><h3>Project description</h3></div>
            <textarea className="inp area" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What is this project about? Goal, scope, links…" aria-label="Project description" rows={4} />
          </div>
          {err && <div className="callout err">{err}</div>}
          <div className="form-actions">
            <button className="btn sec" onClick={onCancel}>Cancel</button>
            <button className="btn pri" disabled={!name.trim() || busy} onClick={submit}>{busy ? 'Creating…' : 'Create project'}</button>
          </div>
        </div>
      </div>
    </>
  );
}
