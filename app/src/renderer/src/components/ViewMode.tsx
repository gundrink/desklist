import { Linkify } from './Linkify';
import { useState } from 'react';
import { TASK_FIELD_TYPE_LABELS, type Project, type Snapshot, type Task, type TaskField } from '@desklist/shared';
import { member, projectFields, shortDate, shortName, tasksOf } from '../lib/model';
import { Avatar } from './Common';
import { CopyBtn, revealProjectSecret, revealTaskField } from './Copy';
import { fieldsOf, filesOf, reimbOfTask } from './TaskPanel';
import { usdOf } from './Money';
import { formatAmount } from '@desklist/shared';

const time = (iso: string | null) => (iso ? `${shortDate(iso)} ${new Date(iso).toTimeString().slice(0, 5)}` : '');
export const platformOf = (s: Snapshot, t: Task) => t.taskType === 'social' ? (fieldsOf(s, t.id).find((f) => f.label === 'Platform')?.value || 'Social') : null;

function Secret({ get, label }: { get: () => Promise<string | null>; label: string }) {
  const [v, setV] = useState<string | null>(null);
  return <span className="vval"><span className="vsecret">{v ?? '••••••••'}</span>
    <button type="button" className="eye" aria-label={`Reveal ${label}`} title={v ? 'Hide' : 'Reveal'} onClick={async (e) => { e.stopPropagation(); setV(v ? null : (await get()) ?? ''); }}>{v ? '◉' : '◎'}</button>
    <CopyBtn get={get} label={label} /></span>;
}
/** One "label: value" line with its own copy button. Empty values show "—" without copy. */
export function VLine({ label, kind, value, children }: { label: string; kind?: string; value?: string | null; children?: React.ReactNode }) {
  return <div className="vline" data-vlabel={label}><span className="vlab">{label}{kind && <em>{kind}</em>}</span>
    {children ?? (value ? <span className="vval"><span className="vtext" title={value}>{kind === 'Password' ? value : <Linkify text={value} />}</span><CopyBtn text={value} label={label} /></span> : <span className="vval none">—</span>)}</div>;
}
function FieldLine({ f }: { f: TaskField }) {
  const kind = TASK_FIELD_TYPE_LABELS[f.type].split(' ')[0];
  if (f.type === 'password') return f.isSet ? <VLine label={f.label} kind={kind}><Secret get={revealTaskField(f.id)} label={f.label} /></VLine> : <VLine label={f.label} kind={kind} value={null} />;
  return <VLine label={f.label} kind={kind} value={f.value} />;
}

import { Checklist, Progress, progressOf } from './Checklist';
export function TaskViewCard({ s, t, compact }: { s: Snapshot; t: Task; compact?: boolean }) {
  const fs = fieldsOf(s, t.id).filter((f) => f.type !== 'file'); const rf = fieldsOf(s, t.id, 'reimbursement');
  const files = filesOf(s, t.id); const r = reimbOfTask(s, t.id); const m = member(s, t.approvedByMemberId);
  const plat = platformOf(s, t);
  return (
    <div className={`vcard ${t.done ? 'done' : ''} ${compact ? 'compact' : ''}`} data-vtask={t.title}>
      <div className="vch"><span className={`vck ${t.done ? 'd' : ''}`}>{t.done ? '✓' : ''}</span><b className="vtitle">{t.title}</b><CopyBtn text={t.title} label="task name" />
        {plat && <span className="platpill">{plat}</span>}<Progress {...progressOf(s, t.id)} /><span className="ml" />
        {t.done ? <span className="small vappr">{m && <Avatar initials={m.initials} url={m.avatarUrl} size="xs" />}Approved by <b>{m ? shortName(m.name) : '—'}</b> · {time(t.approvedAt)}</span>
          : <span className="small muted">Pending{t.dueDate ? ` · due ${shortDate(t.dueDate)}` : ''}</span>}</div>
      <Checklist s={s} t={t} readOnly />
      <div className="vgrid">
        {fs.map((f) => <FieldLine key={f.id} f={f} />)}
        {t.notes && <VLine label="Notes" value={t.notes} />}
        {t.doneNote && <VLine label="Approval note" value={t.doneNote} />}
        {r && <>
          <VLine label="Reimbursement item" value={r.item} />
          <VLine label="Category" value={r.category} />
          <VLine label="Amount"><span className="vval"><span className="vtext">{formatAmount(r.amount, r.currency)}{usdOf(s, r.amount, r.currency) ? ` ≈ ${usdOf(s, r.amount, r.currency)}` : ''}</span><CopyBtn text={`${r.amount} ${r.currency}`} label="amount" /></span></VLine>
        </>}
        {rf.map((f) => <FieldLine key={f.id} f={f} />)}
        {files.map((f) => <VLine key={f.id} label="File"><span className="vval"><button type="button" className="linkbtn" onClick={() => window.desklist.openFile(f.id, f.name)}>{f.name}</button><CopyBtn text={f.name} label="file name" /></span></VLine>)}
        {!fs.length && !t.notes && !t.doneNote && !r && !files.length && <div className="muted small">No details yet.</div>}
      </div>
    </div>
  );
}

export function ProjectInfoCard({ s, p }: { s: Snapshot; p: Project }) {
  const fields = projectFields(s, p);
  return (
    <div className="vcard proj" data-vproject={p.name}>
      <div className="vch"><b className="vtitle">{p.name}</b><CopyBtn text={p.name} label="project name" /><span className="ml" /><span className="small muted">Project details</span></div>
      <div className="vgrid">
        {fields.filter((f) => f.key !== 'project_name').map((f) => f.isSecret || f.dataType === 'password'
          ? <VLine key={f.id} label={f.label} kind="Password">{p.secretSet[f.id] ? <Secret get={revealProjectSecret(p.id, f.id)} label={f.label} /> : <span className="vval none">—</span>}</VLine>
          : <VLine key={f.id} label={f.label} value={p.values[f.id]} />)}
        <VLine label="Deadline" value={p.deadline ? shortDate(p.deadline, true) : null} />
        {p.customColumns.map((c) => <VLine key={c.id} label={c.label} value={c.value} />)}
        {p.notes && <VLine label="Project notes" value={p.notes} />}
      </div>
    </div>
  );
}

/** View mode: read-only, compact, everything expanded — all tasks (pending + done) with every value and a copy button each. */
export function ProjectView({ s, projectId, compact }: { s: Snapshot; projectId: string; compact?: boolean }) {
  const p = s.projects.find((x) => x.id === projectId)!;
  const { open, done } = tasksOf(s, projectId);
  return (
    <div className={`pview ${compact ? 'compact' : ''}`}>
      {!compact && <ProjectInfoCard s={s} p={p} />}
      {open.length > 0 && <div className="vsec">Pending · {open.length}</div>}
      {open.map((t) => <TaskViewCard key={t.id} s={s} t={t} compact={compact} />)}
      {done.length > 0 && <div className="vsec">Done · {done.length}</div>}
      {done.map((t) => <TaskViewCard key={t.id} s={s} t={t} compact={compact} />)}
      {!open.length && !done.length && <div className="empty-row">No tasks yet.</div>}
    </div>
  );
}
export function ModeToggle({ mode, setMode, compact }: { mode: 'edit' | 'view'; setMode: (m: 'edit' | 'view') => void; compact?: boolean }) {
  return <div className={`modetgl ${compact ? 'compact' : ''} idx-${mode === 'view' ? 1 : 0}`} role="tablist" aria-label="Mode">
    <button role="tab" className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>Edit</button>
    <button role="tab" className={mode === 'view' ? 'on' : ''} onClick={() => setMode('view')}>View</button></div>;
}
