import { useState } from 'react';
import { convert, formatAmount, type Reimbursement as R, type Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { member, shortDate } from '../lib/model';
import { Avatar } from '../components/Common';
import { Amount, defaultCurrency, rateNote } from '../components/Money';
import { fieldsOf } from '../components/TaskPanel';

const STATUS_LABEL: Record<string, string> = { pending: 'Pending', approved: 'Approved', paid: 'Paid' };
export const reimbOf = (s: Snapshot, projectId: string) => s.reimbursements.filter((r) => r.projectId === projectId);
export function sumIn(s: Snapshot, rs: R[], cur = defaultCurrency(s)) { return rs.reduce((a, r) => a + (convert(r.amount, r.currency, cur, s.prices) ?? 0), 0); }

/** Reimbursement tab (v6): read-only summary of entries that come from tasks ("Has reimbursement"). Admins can set the status. */
export function ReimbursementTab({ s, projectId }: { s: Snapshot; projectId: string }) {
  const all = reimbOf(s, projectId);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'paid'>('all');
  const list = filter === 'all' ? all : all.filter((r) => r.status === filter);
  const cur = defaultCurrency(s);
  const isAdmin = s.me.role === 'admin';
  const task = (id: string | null) => s.tasks.find((t) => t.id === id);
  return (
    <div className="reimb">
      <div className="rbar">
        <span>Total <Amount s={s} amount={sumIn(s, all)} code={cur} /></span><span className="vsep" />
        <span>Pending <Amount s={s} amount={sumIn(s, all.filter((r) => !r.reimbursed))} code={cur} /></span>
        <div className="seg">{(['all', 'pending', 'approved', 'paid'] as const).map((k) =>
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : STATUS_LABEL[k]}</button>)}</div>
      </div>
      <div className="rtable card ro">
        <div className="rth"><span>Date</span><span>Item</span><span>Category</span><span>Amount</span><span>Paid by</span><span>Status</span><span>From task</span></div>
        {list.map((r) => {
          const m = member(s, r.paidByMemberId); const t = task(r.taskId);
          const extra = r.taskId ? fieldsOf(s, r.taskId, 'reimbursement') : [];
          return (
            <div className="rtr" key={r.id} data-reimb={r.item}>
              <span className="muted">{shortDate(r.spentOn ?? r.createdAt)}</span>
              <span className="ell" title={extra.map((f) => `${f.label}: ${f.value ?? ''}`).join('\n') || r.item}>{r.item}{extra.length > 0 && <em className="fromtask"> · {extra.length} more</em>}</span>
              <span><span className="cat">{r.category}</span></span>
              <span><Amount s={s} amount={r.amount} code={r.currency} cls="stack" /></span>
              <span>{m && <Avatar initials={m.initials} size="sm" title={m.name} />}</span>
              <span>{isAdmin
                ? <select className={`stsel ${r.status}`} value={r.status} onChange={(e) => actions.request('PATCH', `/api/reimbursements/${r.id}`, { status: e.target.value })}>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                : <span className={`stp ${r.status}`}>{STATUS_LABEL[r.status]}</span>}</span>
              <span className="ell muted small">{t ? t.title : '—'}</span>
            </div>
          );
        })}
        {!list.length && <div className="empty-row">No reimbursements yet. Turn on “Has reimbursement” in a task’s detail to add one.</div>}
      </div>
      <div className="muted small">Read-only summary · entries come from tasks · {rateNote(s)}</div>
    </div>
  );
}
export const pendingLabel = (s: Snapshot, projectId: string) => {
  const rs = reimbOf(s, projectId).filter((r) => !r.reimbursed);
  return { count: rs.length, sum: sumIn(s, rs), text: formatAmount(sumIn(s, rs), defaultCurrency(s)) };
};
