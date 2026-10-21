import { TASK_FIELD_TYPE_LABELS, type Snapshot } from '@desklist/shared';
import { member, shortDate, shortName, tasksOf } from '../lib/model';
import { Avatar } from '../components/Common';
import { Amount } from '../components/Money';
import { fieldsOf, filesOf, reimbOfTask } from '../components/TaskPanel';

/** Task details tab: one card per approved task (fields, files, reimbursement, approver + time). Live from the snapshot. */
export function TaskDetailsTab({ s, projectId }: { s: Snapshot; projectId: string }) {
  const { open, done } = tasksOf(s, projectId);
  const cards = done.slice().sort((a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? ''));
  const time = (iso: string | null) => iso ? `${shortDate(iso)} ${new Date(iso).toTimeString().slice(0, 5)}` : '';
  return (
    <div className="tdetails">
      {cards.map((t) => {
        const m = member(s, t.approvedByMemberId); const fs = [...fieldsOf(s, t.id), ...fieldsOf(s, t.id, 'reimbursement')];
        const files = filesOf(s, t.id).filter((f) => !f.fieldId); const r = reimbOfTask(s, t.id);
        return (
          <div className="card tdcard" key={t.id} data-taskcard={t.title}>
            <div className="tdh"><span className="tdck">✓</span><b>{t.title}</b><span className="ml" />
              {m && <><Avatar initials={m.initials} url={m.avatarUrl} size="sm" /><span className="small">Approved by <b>{shortName(m.name)}</b> · {time(t.approvedAt)}</span></>}</div>
            {t.doneNote && <div className="tdnote">{t.doneNote}</div>}
            <div className="tdgrid">
              {fs.map((f) => <div className="tdf" key={f.id}><span>{f.label} <em>{TASK_FIELD_TYPE_LABELS[f.type].split(' ')[0]}</em></span>
                <b>{f.type === 'password' ? (f.isSet ? '••••••••' : '—') : f.value ?? '—'}</b></div>)}
              {r && <div className="tdf"><span>Reimbursement <em>{r.category}</em></span><b>{r.item} · <Amount s={s} amount={r.amount} code={r.currency} /></b></div>}
              {files.map((f) => <div className="tdf" key={f.id}><span>Attachment</span><b><button className="linkbtn" onClick={() => window.desklist.openFile(f.id, f.name)}>{f.name}</button></b></div>)}
              {!fs.length && !r && !files.length && <div className="muted small">No fields recorded.</div>}
            </div>
          </div>
        );
      })}
      {!cards.length && <div className="empty-row">No approved tasks yet.</div>}
      {open.length > 0 && <div className="tdpending">{open.length} task{open.length > 1 ? 's' : ''} waiting for approval</div>}
    </div>
  );
}
