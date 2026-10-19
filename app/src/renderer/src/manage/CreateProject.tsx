import { Select } from '../components/Select';
import { useState } from 'react';
import { CUSTOM_COLUMN_TYPES, CUSTOM_COLUMN_TYPE_LABELS, type CustomColumnType, type Project, type Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { Plus, Trash } from '../components/Icons';

interface Col { key: number; label: string; dataType: CustomColumnType; value: string }

export function CreateProject({ s, onCreated, onCancel }: { s: Snapshot; onCreated: (id: string) => void; onCancel: () => void }) {
  const active = s.fields.filter((f) => !f.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const [name, setName] = useState('');
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
      // 0.6.10: every active master field is attached automatically (default required flag); values are filled later in Details & fields
      const chosen = active;
      const p = await actions.request<Project>('POST', '/api/projects', {
        name, notes, deadline: deadline || null,
        fields: chosen.map((f) => ({ fieldId: f.id, required: !!(f.options as { required?: boolean } | null)?.required })),
        customColumns: cols.filter((c) => c.label.trim()).map((c) => ({ label: c.label.trim(), dataType: c.dataType, value: c.value || null })),
      });
      onCreated(p.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="rhead"><div className="row"><h1>New project</h1></div>
        <div className="sub">Name it now — master fields are added automatically and filled in later under Details & fields.</div></div>
      <div className="rbody scroll">
        <div className="details">
          <div className="card">
            <div className="fhead"><h3>Project</h3></div>
            <div className="grid cols2" data-section="project">
              <label className="f"><span>Project name <em>required</em></span>
                <div className="inp focus-ring"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Project H" autoFocus aria-label="Project name" /></div></label>
              <label className="f"><span>Deadline <em>optional</em></span>
                <div className="inp focus-ring"><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Deadline" /></div></label>
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
