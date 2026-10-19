import { useState } from 'react';
import { EXPENSE_CATEGORIES, convert, formatAmount, type Reimbursement as R, type Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { member, shortDate, shortName } from '../lib/model';
import { Avatar } from '../components/Common';
import { Amount, CurrencySelect, defaultCurrency, rateNote, usdOf } from '../components/Money';
import { FieldInput } from '../components/FieldInput';
import { Trash } from '../components/Icons';

const STATUS_LABEL: Record<string, string> = { pending: 'Pending', approved: 'Approved', paid: 'Paid' };
export const reimbOf = (s: Snapshot, projectId: string) => s.reimbursements.filter((r) => r.projectId === projectId);
export function sumIn(s: Snapshot, rs: R[], cur = defaultCurrency(s)) { return rs.reduce((a, r) => a + (convert(r.amount, r.currency, cur, s.prices) ?? 0), 0); }

/** Reimbursement tab: totals, filter, list, "Add reimbursement" (Nominal + Catatan reimbursement). Crypto or Rupiah. */
export function ReimbursementTab({ s, projectId }: { s: Snapshot; projectId: string }) {
  const p = s.projects.find((x) => x.id === projectId)!;
  const all = reimbOf(s, projectId);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'paid'>('all');
  const list = filter === 'all' ? all : all.filter((r) => r.status === filter);
  const cur = defaultCurrency(s);
  const total = sumIn(s, all); const pending = sumIn(s, all.filter((r) => !r.reimbursed));
  const isAdmin = s.me.role === 'admin';
  const today = new Date().toISOString().slice(0, 10);
  const blank = { item: '', category: EXPENSE_CATEGORIES[0], amount: '', currency: cur, spentOn: today, receiptName: '', note: '' };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  const amt = Number(f.amount.replace(',', '.'));
  const save = async () => {
    setErr('');
    try {
      await actions.request('POST', `/api/projects/${projectId}/reimbursements`, { item: f.item, category: f.category, amount: amt, currency: f.currency, spentOn: f.spentOn || null, receiptName: f.receiptName || null, note: f.note });
      setF({ ...blank, currency: f.currency });
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="reimb">
      <div className="rbar">
        <span>Total <Amount s={s} amount={total} code={cur} /></span><span className="vsep" />
        <span>Pending <Amount s={s} amount={pending} code={cur} /></span>
        <div className="seg">{(['all', 'pending', 'approved', 'paid'] as const).map((k) =>
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : STATUS_LABEL[k]}</button>)}</div>
      </div>
      <div className="rtable card">
        <div className="rth"><span>Date</span><span>Item</span><span>Category</span><span>Nominal</span><span>Paid by</span><span>Status</span><span>Receipt</span><span /></div>
        {list.map((r) => {
          const m = member(s, r.paidByMemberId);
          return (
            <div className="rtr" key={r.id} data-reimb={r.item}>
              <span className="muted">{shortDate(r.spentOn ?? r.createdAt)}</span>
              <span className="ell" title={r.note || r.item}>{r.item}{r.taskId && <em className="fromtask"> · task</em>}</span>
              <span><span className="cat">{r.category}</span></span>
              <span><Amount s={s} amount={r.amount} code={r.currency} cls="stack" /></span>
              <span>{m && <Avatar initials={m.initials} size="sm" title={m.name} />}</span>
              <span>{isAdmin
                ? <select className={`stsel ${r.status}`} value={r.status} onChange={(e) => actions.request('PATCH', `/api/reimbursements/${r.id}`, { status: e.target.value })}>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                : <span className={`stp ${r.status}`}>● {STATUS_LABEL[r.status]}</span>}</span>
              <span className="muted small">{r.receiptName ? '📄 ' + (r.receiptName.endsWith('.pdf') ? 'PDF' : r.receiptName) : '—'}</span>
              <span>{(!r.reimbursed || isAdmin) && <button className="rowdel" title="Delete" onClick={() => actions.request('DELETE', `/api/reimbursements/${r.id}`)}><Trash /></button>}</span>
            </div>
          );
        })}
        {!list.length && <div className="empty-row">No reimbursements yet.</div>}
      </div>
      <div className="card addreimb">
        <div className="fhead"><h3>Add reimbursement</h3><span className="paidby">Paid by: {shortName(s.me.name)} (you)</span></div>
        <div className="grid2">
          <label className="f"><span>Item</span><div className="inp"><input value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} placeholder="e.g. Domain project-a.com (1 yr)" aria-label="Item" /></div></label>
          <label className="f"><span>Category</span><div className="inp sel"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div></label>
          <div className="f"><span>Nominal ({f.currency}) <em>default currency · per admin</em></span>
            <div className="inp nominal focus-ring"><CurrencySelect value={f.currency} onChange={(c) => setF({ ...f, currency: c })} />
              <input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" aria-label="Nominal" />
              <span className="usd">{amt > 0 && usdOf(s, amt, f.currency) ? `≈ ${usdOf(s, amt, f.currency)} USD` : ''}</span></div>
            <span className="hint">{rateNote(s)}</span></div>
          <label className="f"><span>Date</span><div className="inp"><input type="date" value={f.spentOn} onChange={(e) => setF({ ...f, spentOn: e.target.value })} /></div></label>
          <span />
          <label className="f"><span>Receipt</span><div className="inp"><input value={f.receiptName} onChange={(e) => setF({ ...f, receiptName: e.target.value })} placeholder="invoice.pdf (file name)" aria-label="Receipt" /></div></label>
        </div>
        <label className="f"><span>Catatan reimbursement</span>
          <textarea className="inp area" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Beli apa, di mana, dibayar pakai apa…" aria-label="Catatan reimbursement" /></label>
        {err && <div className="callout err">{err}</div>}
        <div className="form-actions"><button className="btn sec" onClick={() => setF(blank)}>Cancel</button>
          <button className="btn pri" disabled={!f.item.trim() || !(amt >= 0) || !f.amount} onClick={save}>Save</button></div>
      </div>
      <div className="card">
        <div className="fhead"><h3>Catatan reimbursement (project)</h3><span className="muted small">How and when this project's expenses get reimbursed</span></div>
        <FieldInput s={s} dataType="longtext" value={p.reimburseNote} onCommit={(v) => actions.updateProject(p.id, { reimburseNote: v ?? '' })} placeholder="e.g. Transfer SOL ke wallet tiap akhir bulan" />
      </div>
    </div>
  );
}
export const pendingLabel = (s: Snapshot, projectId: string) => {
  const rs = reimbOf(s, projectId).filter((r) => !r.reimbursed);
  return { count: rs.length, sum: sumIn(s, rs), text: formatAmount(sumIn(s, rs), defaultCurrency(s)) };
};
