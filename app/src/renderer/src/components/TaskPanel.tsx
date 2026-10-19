import { useEffect, useRef, useState } from 'react';
import { CURRENCY_CODES, MAX_FILE_BYTES, REIMB_CATEGORIES, TASK_FIELD_TYPES, TASK_FIELD_TYPE_LABELS, type Snapshot, type Task, type TaskField, type TaskFieldType } from '@desklist/shared';
import { actions } from '../lib/store';
import { member, shortDate, shortName } from '../lib/model';
import { Avatar } from './Common';
import { Toggle, defaultCurrency, usdOf } from './Money';
import { CopyBtn, revealTaskField } from './Copy';

type Theme = 'light' | 'dark';
const ICON: Record<TaskFieldType, string> = { text: 'T', email: '@', password: '••', url: '↗', number: '#', date: 'D', file: 'F', dropdown: '▾', amount: '$' };
const HINT: Partial<Record<TaskFieldType, string>> = { password: 'masked', amount: 'SOL ≈ USD' };

export const fieldsOf = (s: Snapshot, taskId: string, section: 'fields' | 'reimbursement' = 'fields') =>
  (s.taskFields ?? []).filter((f) => f.taskId === taskId && f.section === section).sort((a, b) => a.sortOrder - b.sortOrder);
export const filesOf = (s: Snapshot, taskId: string) => (s.taskFiles ?? []).filter((f) => f.taskId === taskId);
export const reimbOfTask = (s: Snapshot, taskId: string) => s.reimbursements.find((r) => r.taskId === taskId) ?? null;
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function pickAndUpload(taskId: string, fieldId?: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input'); inp.type = 'file';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return resolve(null);
      if (f.size > MAX_FILE_BYTES) return resolve('File too large (max 10 MB)');
      try { await window.desklist.uploadFile(taskId, f.name, f.type, new Uint8Array(await f.arrayBuffer()), fieldId ?? null); resolve(null); }
      catch (e) { resolve((e as Error).message); }
    };
    inp.click();
  });
}
/** Upload from a <input type=file> element (used by the drop zone and by the e2e). */
async function uploadFromInput(taskId: string, files: FileList | null, setErr: (e: string) => void) {
  const f = files?.[0]; if (!f) return;
  if (f.size > MAX_FILE_BYTES) return setErr('File too large (max 10 MB)');
  try { await window.desklist.uploadFile(taskId, f.name, f.type, new Uint8Array(await f.arrayBuffer()), null); setErr(''); }
  catch (e) { setErr((e as Error).message); }
}

/** Single typed field row: icon + label + editor. Saves on blur/change. */
function FieldRow({ s, f, theme }: { s: Snapshot; f: TaskField; theme: Theme }) {
  const canEdit = s.me.role === 'admin' || f.section === 'reimbursement';
  const [v, setV] = useState(f.value ?? '');
  const [shown, setShown] = useState<string | null>(null);
  const [curPick, setCurPick] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setV(f.value ?? ''); }, [f.value]);
  const save = async (val: string | null) => {
    setErr('');
    try { await actions.request('PATCH', `/api/task-fields/${f.id}`, { value: val }); } catch (e) { setErr((e as Error).message); }
  };
  const blur = () => { if (f.type !== 'password' && (v || null) !== (f.value ?? null)) void save(v || null); };
  let editor: React.ReactNode;
  if (f.type === 'password') {
    editor = <span className="pwrow">
      <input type={shown != null ? 'text' : 'password'} value={shown ?? v} placeholder={f.isSet ? '••••••••' : 'Password'} aria-label={f.label}
        onChange={(e) => { setShown(null); setV(e.target.value); }} onBlur={() => { if (v) { void save(v); setV(''); } }} />
      <button type="button" className="eye" title={shown != null ? 'Hide' : 'Reveal'} aria-label="Reveal password" onClick={async () => {
        if (shown != null) return setShown(null);
        try { setShown((await actions.request<{ value: string | null }>('GET', `/api/task-fields/${f.id}/reveal`)).value ?? ''); } catch (e) { setErr((e as Error).message); }
      }}>{shown != null ? '◉' : '◎'}</button></span>;
  } else if (f.type === 'dropdown') {
    editor = <select value={v} aria-label={f.label} onChange={(e) => { setV(e.target.value); void save(e.target.value || null); }}>
      <option value="">—</option>{(f.options.choices ?? []).map((c) => <option key={c}>{c}</option>)}</select>;
  } else if (f.type === 'file') {
    const file = filesOf(s, f.taskId).find((x) => x.fieldId === f.id);
    editor = <span className="filecell">{file ? <button type="button" className="linkbtn" onClick={() => window.desklist.openFile(file.id, file.name)}>{file.name}</button> : <span className="muted">No file</span>}
      <button type="button" className="btn sec xs" onClick={async () => setErr((await pickAndUpload(f.taskId, f.id)) ?? '')}>Upload</button></span>;
  } else if (f.type === 'amount') {
    const [num, code] = (v || '').split(' ');
    const cur = curPick || code || f.options.currency || defaultCurrency(s);
    const n = Number(num);
    editor = <span className="amtcell"><input inputMode="decimal" value={num ?? ''} placeholder="0.00" aria-label={f.label}
      onChange={(e) => setV(e.target.value ? `${e.target.value} ${cur}` : '')} onBlur={blur} />
      <select className="cursel" value={cur} aria-label={`${f.label} currency`} onChange={(e) => { setCurPick(e.target.value); if (num) { const nv = `${num} ${e.target.value}`; setV(nv); void save(nv); } }}>
        {CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
      {n > 0 && usdOf(s, n, cur) && <em className="usd">≈ {usdOf(s, n, cur)}</em>}</span>;
  } else {
    const t = f.type === 'number' ? 'text' : f.type === 'url' ? 'text' : f.type;
    editor = <input type={t} value={v} aria-label={f.label} placeholder={TASK_FIELD_TYPE_LABELS[f.type]} onChange={(e) => setV(e.target.value)} onBlur={blur}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
  }
  return (
    <div className={`tfrow ${theme}`} data-field={f.label}>
      <span className="tfic" title={TASK_FIELD_TYPE_LABELS[f.type]}>{ICON[f.type]}</span>
      <span className="tflab"><b>{f.label}</b><em>{TASK_FIELD_TYPE_LABELS[f.type].split(' ')[0].toUpperCase()}</em></span>
      <span className="tfed">{editor}{f.type === 'password' ? (f.isSet && <CopyBtn get={revealTaskField(f.id)} label={f.label} />) : f.type !== 'file' && <CopyBtn text={f.value} label={f.label} />}</span>
      {canEdit ? <button type="button" className="tfdel" title="Remove field" onClick={() => actions.request('DELETE', `/api/task-fields/${f.id}`)}>×</button> : <span />}
      {err && <span className="tferr">{err}</span>}
    </div>
  );
}

/** "+ Add field" with a type picker (Text, Email, Password, URL, Number, Date, File, Dropdown, Amount). */
export function AddField({ s, taskId, section = 'fields', theme, placeholder }: { s: Snapshot; taskId: string; section?: 'fields' | 'reimbursement'; theme: Theme; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TaskFieldType | null>(null);
  const [label, setLabel] = useState(''); const [opts, setOpts] = useState(''); const [err, setErr] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f);
  }, [open]);
  const create = async () => {
    if (!type || !label.trim()) return;
    try {
      await actions.request('POST', `/api/tasks/${taskId}/fields`, { label: label.trim(), type, section,
        options: type === 'dropdown' ? { choices: opts.split(',').map((x) => x.trim()).filter(Boolean) } : type === 'amount' ? { currency: defaultCurrency(s) } : {} });
      setType(null); setLabel(''); setOpts(''); setErr('');
    } catch (e) { setErr((e as Error).message); }
  };
  if (type) return (
    <div className={`addfield-form ${theme}`}>
      <span className="tfic">{ICON[type]}</span>
      <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${TASK_FIELD_TYPE_LABELS[type]} field name`} aria-label="Field name"
        onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setType(null); }} />
      {type === 'dropdown' && <input value={opts} onChange={(e) => setOpts(e.target.value)} placeholder="Options, comma separated" aria-label="Dropdown options" />}
      <button type="button" className="btn pri xs" onClick={create} disabled={!label.trim()}>Add</button>
      <button type="button" className="btn sec xs" onClick={() => setType(null)}>Cancel</button>
      {err && <span className="tferr">{err}</span>}
    </div>);
  return (
    <div className="addfield-wrap" ref={ref}>
      <button type="button" className={`addfield ${theme}`} onClick={() => setOpen(!open)}>+ Add field{placeholder && <em> {placeholder}</em>}</button>
      {open && (
        <div className={`typepop ${theme}`} role="menu">
          <div className="tph">FIELD TYPE</div>
          {TASK_FIELD_TYPES.map((t) => (
            <button type="button" key={t} className="tpi" onClick={() => { setType(t); setLabel(t === 'amount' ? 'Amount' : TASK_FIELD_TYPE_LABELS[t]); setOpen(false); }}>
              <span className="tfic">{ICON[t]}</span>{TASK_FIELD_TYPE_LABELS[t]}{HINT[t] && <em>{HINT[t]}</em>}</button>))}
          <div className="tpf">Amount turns on <b>Has reimbursement</b> for this task</div>
        </div>)}
    </div>
  );
}

export function FieldList({ s, taskId, section = 'fields', theme, placeholder }: { s: Snapshot; taskId: string; section?: 'fields' | 'reimbursement'; theme: Theme; placeholder?: string }) {
  const fs = fieldsOf(s, taskId, section);
  const canAdd = s.me.role === 'admin' || section === 'reimbursement';
  return <div className="tflist">{fs.map((f) => <FieldRow key={f.id} s={s} f={f} theme={theme} />)}
    {!fs.length && !canAdd && <div className="muted small">No detail fields set up for this task. An admin can add them in Task setup.</div>}
    {canAdd && <AddField s={s} taskId={taskId} section={section} theme={theme} placeholder={placeholder} />}</div>;
}

/** Reimbursement section: Item/Domain name, Category, Amount (admin currency) ≈ USD, + extra fields. */
export function ReimbSection({ s, t, theme }: { s: Snapshot; t: Task; theme: Theme }) {
  const r = reimbOfTask(s, t.id);
  const [cur, setCur] = useState<string>(r?.currency ?? defaultCurrency(s));
  const [item, setItem] = useState(r?.item ?? t.title);
  const [cat, setCat] = useState(r?.category && REIMB_CATEGORIES.includes(r.category) ? r.category : 'Other');
  const [amt, setAmt] = useState(r ? String(r.amount) : (t.expenseAmount != null ? String(t.expenseAmount) : ''));
  const [err, setErr] = useState(''); const [saved, setSaved] = useState(false);
  useEffect(() => { if (r) { setCur(r.currency); setItem(r.item); setAmt(String(r.amount)); setCat(REIMB_CATEGORIES.includes(r.category) ? r.category : 'Other'); } }, [r?.id, r?.amount, r?.item, r?.category]);
  const n = Number(amt.replace(',', '.'));
  const save = async (c = cat, cu = cur) => {
    if (!item.trim() || !amt || !(n >= 0)) return;
    try { await actions.request('PUT', `/api/tasks/${t.id}/reimbursement`, { item: item.trim(), category: c, amount: n, currency: cu }); setErr(''); setSaved(true); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className={`rsec ${theme}`}>
      <div className="rsh"><span>▤ REIMBURSEMENT</span><em>{r || saved ? 'Saved to Reimbursement tab' : 'Fill in to add to Reimbursement'}</em></div>
      <div className="rsgrid">
        <label><span>Item / Domain name</span><input value={item} onChange={(e) => setItem(e.target.value)} onBlur={() => save()} aria-label="Reimbursement item" /></label>
        <label><span>Category</span><select value={cat} onChange={(e) => { setCat(e.target.value); void save(e.target.value); }} aria-label="Reimbursement category">
          {REIMB_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label><span>Amount</span><span className="amtin"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} onBlur={() => save()} placeholder="0.00" aria-label="Reimbursement amount"
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          <select className="cursel" value={cur} aria-label="Reimbursement currency" onChange={(e) => { setCur(e.target.value); void save(cat, e.target.value); }}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select>
          <em>{n > 0 && usdOf(s, n, cur) ? `≈ ${usdOf(s, n, cur)}` : ''}</em></span></label>
      </div>
      <FieldList s={s} taskId={t.id} section="reimbursement" theme={theme} placeholder="Vendor, Invoice no., Purchase date…" />
      {err && <div className="tferr">{err}</div>}
    </div>
  );
}

function Attachments({ s, t, theme }: { s: Snapshot; t: Task; theme: Theme }) {
  const [err, setErr] = useState('');
  const files = filesOf(s, t.id).filter((f) => !f.fieldId);
  return (
    <div className="attach">
      <label className={`dropz ${theme}`} title="Max 10 MB"><span>⇪ Drop file or <b>browse</b></span>
        <input type="file" className="hidden-file" aria-label="Attachment" onChange={(e) => { void uploadFromInput(t.id, e.target.files, setErr); e.target.value = ''; }} /></label>
      {files.map((f) => <span className="fchip" key={f.id} data-file={f.name}><button type="button" className="linkbtn" onClick={() => window.desklist.openFile(f.id, f.name)}>{f.name}</button>
        <em>{kb(f.size)}</em><button type="button" className="tfdel" title="Remove file" onClick={() => actions.request('DELETE', `/api/files/${f.id}`)}>×</button></span>)}
      {err && <span className="tferr">{err}</span>}
    </div>
  );
}

/** Inline panel under a checklist row: `detail` (expanded) or `ticked` (just approved: note, attachment, fields, Save/Skip). */
export function TaskPanel({ s, t, theme, mode, onClose, compact }: { s: Snapshot; t: Task; theme: Theme; mode: 'detail' | 'ticked'; onClose: () => void; compact?: boolean }) {
  const [note, setNote] = useState(t.doneNote ?? '');
  const appr = member(s, t.approvedByMemberId);
  void Toggle;
  const _toggleReimb = async (on: boolean) => {
    if (on) await actions.request('PUT', `/api/tasks/${t.id}/reimbursement`, { item: t.title, category: 'Other', amount: 0, currency: defaultCurrency(s) });
    else await actions.request('DELETE', `/api/tasks/${t.id}/reimbursement`);
  };
  void _toggleReimb;
  const save = () => { if (note !== (t.doneNote ?? '')) void actions.updateTask(t.id, { doneNote: note }); onClose(); };
  const head = mode === 'ticked'
    ? <span className="tph1">✓ Approved by {appr ? shortName(appr.name) : 'you'} — add notes &amp; values</span>
    : <span className="tph1">TASK DETAIL</span>;
  return (
    <div className={`tpanel ${theme} ${mode} ${compact ? 'compact' : ''}`} data-panel={mode} onClick={(e) => e.stopPropagation()}>
      <div className="tphead">{head}<span className="ml" />
        {mode === 'detail' && <button type="button" className="tpx" title="Collapse" onClick={onClose}>×</button>}</div>
      {mode === 'detail' && t.done && (appr || t.doneNote) && (
        <div className="tpappr">{appr && <Avatar initials={appr.initials} size="sm" />}<span><b>{appr ? shortName(appr.name) : ''}</b> · {shortDate(t.approvedAt)}{t.doneNote && <><br />{t.doneNote}</>}</span></div>)}
      <div className={mode === 'ticked' && !compact ? 'tpcols' : 'tpone'}>
        {mode === 'ticked' && (
          <div className="tpleft">
            <label className="tpl"><span>Note</span><textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={compact ? 1 : 3} aria-label="Approval note" placeholder="What was done…" /></label>
            <div className="tpl"><span>Attachment</span><Attachments s={s} t={t} theme={theme} /></div>
          </div>)}
        <div className="tpright">
          <div className="tpl"><span>Fields</span></div>
          <FieldList s={s} taskId={t.id} theme={theme} />
          {mode === 'detail' && filesOf(s, t.id).some((f) => !f.fieldId) && <div className="tpl"><span>Attachments</span><Attachments s={s} t={t} theme={theme} /></div>}
        </div>
      </div>
      <ReimbSection s={s} t={t} theme={theme} />
      {mode === 'ticked' && <div className="tpbtns"><span className="muted small">Saved to Task details tab</span><span className="ml" />
        <button type="button" className="btn sec sm" onClick={onClose}>Skip</button><button type="button" className="btn pri sm" onClick={save}>Save</button></div>}
    </div>
  );
}
