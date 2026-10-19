import { Linkify } from '../components/Linkify';
import { Select } from '../components/Select';
import { useEffect, useState } from 'react';
import { formatAmount, type Report, type Snapshot } from '@desklist/shared';
import { actions } from '../lib/store';
import { member, shortDate, shortName } from '../lib/model';
import { Avatar } from '../components/Common';
import { Amount, CurrencyList, usdOf } from '../components/Money';

const MONTHS_ID = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m: string) => { const [y, mo] = m.split('-'); return `${MONTHS_ID[Number(mo) - 1]} ${y}`; };

/** Admin · Reports — expenses only (no pemasukan). Ticks mark items as reimbursed; CSV export. */
export function Reports({ s }: { s: Snapshot }) {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<'all' | 'reimbursed' | 'not'>('all');
  const [r, setR] = useState<Report | null>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const query = new URLSearchParams({ ...(month ? { month } : {}), ...(projectId ? { projectId } : {}), status }).toString();
  // reload on any synced change (the snapshot object changes)
  // refetch only when reimbursement data actually changes (depending on the whole snapshot caused a request→refresh→refetch loop)
  const reimbKey = s.reimbursements.map((x) => `${x.id}:${x.updatedAt}:${x.status}`).join('|') + `|${s.projects.length}`;
  useEffect(() => { actions.request<Report>('GET', `/api/reports?${query}`).then(setR, (e) => setErr(e.message)); }, [query, reimbKey]);
  if (s.me.role !== 'admin') return <div className="center-fill muted">Admin only.</div>;
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const cur = r?.currency ?? s.currency;
  const max = Math.max(0.0001, ...(r?.perProject.map((p) => p.total) ?? [0]));
  const stat = (cls: string, label: string, v: number, unit?: string) => (
    <div className="stat"><div className="sl"><i className={cls} />{label}</div>
      <div className="sv">{unit ? <>{v}<small> {unit}</small></> : <>{formatAmount(v, cur).replace(` ${cur}`, '')}<small> {cur === 'IDR' ? '' : cur}</small></>}</div>
      <div className="su">{unit ? `${r?.projectsWithExpenses ?? 0} projects with expenses` : usdOf(s, v, cur) ? `≈ ${usdOf(s, v, cur)}` : ''}</div></div>);
  return (
    <>
      <div className="rhead">
        <div className="row"><h1>Admin · Reports</h1><span className="lpill admin">Admin</span>
          <span className="rmeta"><Avatar initials={s.me.initials} size="sm" />Signed in as <b>{shortName(s.me.name)}</b><span className="dotsep" />{s.projects.length} projects</span></div>
        <div className="filters">
          <label className="flt">Project<Select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
          <label className="flt">Status<Select value={status} onChange={(e) => setStatus(e.target.value as never)}><option value="all">All</option><option value="reimbursed">Reimbursed</option><option value="not">Not reimbursed</option></Select></label>
          <label className="flt">Month<Select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">All</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</Select></label>
          <span className="small muted ml">Amounts in {cur} · ≈ USD at live rate{s.prices.stale ? ' (cached)' : ''}</span>
        </div>
      </div>
      <div className="rbody scroll reports">
        {err && <div className="callout err">{err}</div>}
        {r && <>
          <div className="stats">
            {stat('d-teal', 'Total expenses', r.total)}
            {stat('d-green', 'Reimbursed', r.reimbursed)}
            {stat('d-amber', 'Not reimbursed', r.notReimbursed)}
            {stat('d-blue', 'Items', r.count, 'item')}
          </div>
          <div className="rgrid">
            <div className="card chart">
              <div className="fhead"><h3>Expenses per project</h3><span className="muted small">{month ? monthLabel(month) : 'All months'} · in {cur}</span></div>
              <div className="bars">
                {r.perProject.map((p) => (
                  <div className="bcol" key={p.projectId} title={`${p.name}: ${formatAmount(p.total, cur)}`}>
                    <div className="bval">{p.total > 0 ? <><b>{formatAmount(p.total, cur)}</b><em>{usdOf(s, p.total, cur) ? `≈ ${usdOf(s, p.total, cur)}` : ''}</em></> : !p.hasExpenses ? <em>No expenses</em> : null}</div>
                    <div className="bar" style={{ height: `${Math.max(2, (p.total / max) * 150)}px` }} />
                    <div className="bl">{p.name}</div>
                  </div>))}
              </div>
            </div>
            <div className="card settings">
              <div className="fhead"><h3>Settings</h3><span className="muted small">Admin only</span></div>
              <div className="small"><b>Default currency (per admin) — {shortName(s.me.name)}</b></div>
              <CurrencyList value={s.me.currency ?? s.currency} onPick={async (c) => { try { await actions.request('PATCH', '/api/settings', { currency: c }); setMsg(`Default currency set to ${c}`); } catch (e) { setErr((e as Error).message); } }} />
              <div className="small muted">{msg || 'USD shown as equivalent only · live price from CoinGecko'}</div>
            </div>
          </div>
          <div className="card elist">
            <div className="fhead"><h3>Expense list</h3><span className="muted small">Showing {r.items.length} · tick when reimbursed</span>
              <button className="btn sec sm ml" onClick={async () => { try { const pth = await window.desklist.exportCsv(query); if (pth) setMsg(`Saved ${pth}`); } catch (e) { setErr((e as Error).message); } }}>Export CSV</button></div>
            <div className="eth"><span>Project</span><span>Task / item</span><span>Amount</span><span>Paid by</span><span>Date</span><span>Reimbursed</span></div>
            {r.items.map((i) => {
              const m = member(s, i.paidByMemberId); const p = s.projects.find((x) => x.id === i.projectId);
              return (
                <div className="etr" key={i.id} data-expense={i.item}>
                  <span className="ell"><i className="pdot" style={{ background: 'var(--bronze)' }} />{i.projectName}</span>
                  <span className="ell"><Linkify text={i.item} /></span>
                  <span><Amount s={s} amount={i.amount} code={i.currency} /></span>
                  <span>{m && <><Avatar initials={m.initials} size="xs" /> {shortName(m.name)}</>}</span>
                  <span className="muted">{shortDate(i.spentOn ?? i.createdAt)}</span>
                  <label className={`tick ${i.reimbursed ? 'on' : ''}`}><input type="checkbox" checked={i.reimbursed} aria-label={`Reimbursed: ${i.item}`}
                    onChange={(e) => actions.request('PATCH', `/api/reimbursements/${i.id}`, { reimbursed: e.target.checked })} />{i.reimbursed ? 'Reimbursed' : 'Not yet'}</label>
                </div>);
            })}
            {!r.items.length && <div className="empty-row">No expenses for this filter.</div>}
          </div>
        </>}
      </div>
    </>
  );
}
