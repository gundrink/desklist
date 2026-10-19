import { useEffect, useRef, useState } from 'react';
import '../styles/widget.css';
import '../styles/v5.css';
import { formatAmount, formatUsd, convert } from '@desklist/shared';
import { CurrencySelect, defaultCurrency, usdOf } from '../components/Money';
import type { Snapshot, Task } from '@desklist/shared';
import { useAppState, actions } from '../lib/store';
import { ago, domainOf, picOf, shortDate, statusOf, statusStyle, tasksOf } from '../lib/model';
import { Avatar, CheckBox, StatusPill, SyncDot, checkedBy, syncLabel } from '../components/Common';
import { NotesMenu, NotesSheet, type NotesKind } from '../components/Notes';
import { SignIn, LoadingState } from '../components/SignIn';
import { Calendar, Check, ChevronDown, ChevronUp, Note, Power, Refresh, Window, X } from '../components/Icons';

/**
 * Desktop-level glass widget (v4 design): project rail on the left, project detail on the right.
 * Full daily data entry happens here — tick tasks (auto-approved by you), add tasks, Notes editors.
 */
export function Widget() {
  const st = useAppState();
  const [menu, setMenu] = useState(false);
  const [notesMenu, setNotesMenu] = useState(false);
  const [sheet, setSheet] = useState<NotesKind | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);

  if (!st) return <div className="widget" />;
  const locked = st.settings.lockPosition;
  if (st.phase !== 'ready' || !st.snapshot) {
    return (
      <div className={`widget solo ${locked ? 'locked' : ''}`}>
        <div className="wdet">
          <div className="w-top drag"><div className="switch"><span className="dotp" />Desklist</div>
            <button className="menu nodrag" title="Close widget" onClick={() => actions.closeWidget()}><X /></button></div>
          {st.phase === 'loading' ? <LoadingState st={st} /> : <SignIn st={st} theme="dark" />}
        </div>
      </div>
    );
  }
  const s = st.snapshot;
  const p = s.projects.find((x) => x.id === st.settings.currentProjectId) ?? s.projects[0];

  return (
    <div className={`widget ${locked ? 'locked' : ''}`}>
      <div className="rail drag">
        <div className="rhd">Projects <em>{s.projects.length}</em></div>
        <div className="rail-list nodrag scroll">
          {s.projects.map((x) => {
            const t = tasksOf(s, x.id); const c = statusStyle(statusOf(s, x)).color;
            return (
              <button key={x.id} className={`ri ${x.id === p?.id ? 'sel' : ''}`} onClick={() => actions.setCurrentProject(x.id)} data-project={x.name}>
                <div className="ri1"><span className="gdot" style={{ background: c }} /><span className="rn">{x.name}</span></div>
                <div className="ri2"><div className="rb"><i style={{ width: `${t.pct}%`, background: c }} /></div><span>{t.done.length}/{t.all.length}</span></div>
              </button>
            );
          })}
        </div>
        <button className="rnew nodrag" onClick={() => actions.openManage({ view: 'create' })}>+ New</button>
      </div>

      <div className="wdet">
        {p ? <Detail s={s} pId={p.id} menuOpen={menu} setMenu={setMenu} notesMenu={notesMenu} setNotesMenu={setNotesMenu} setSheet={setSheet}
          locked={locked} launch={st.settings.launchAtLogin} />
          : <div className="w-empty">No projects yet. <button className="linkbtn" onClick={() => actions.openManage({ view: 'create' })}>Create one</button></div>}
        <div className="foot">
          <span className="sync" title={st.lastError ?? undefined}><SyncDot connection={st.connection} />{syncLabel(st.connection, st.pending, ago(st.lastSyncedAt))}</span>
          <button className="add" onClick={() => actions.openManage({ view: 'project', projectId: p?.id })}>Open in Manage →</button>
        </div>
      </div>
      {sheet && p && <NotesSheet s={s} p={p} kind={sheet} setKind={setSheet} onClose={() => setSheet(null)} theme="dark" />}
    </div>
  );
}

function Detail({ s, pId, menuOpen, setMenu, notesMenu, setNotesMenu, setSheet, locked, launch }: {
  s: Snapshot; pId: string; menuOpen: boolean; setMenu: (b: boolean) => void; notesMenu: boolean; setNotesMenu: (b: boolean) => void;
  setSheet: (k: NotesKind) => void; locked: boolean; launch: boolean;
}) {
  const p = s.projects.find((x) => x.id === pId)!;
  const { all, open, done, pct } = tasksOf(s, p.id);
  const pic = picOf(s, p); const domain = domainOf(s, p);
  const status = statusOf(s, p);
  return (
    <>
      <div className="w-top drag">
        <div className="switch" title={p.name}><span className="dotp" style={{ background: statusStyle(status).color }} /><span className="ell">{p.name}</span></div>
        <StatusPill status={status} theme="dark" />
        <div className="menu-anchor nodrag">
          <button className={`menu ${menuOpen ? 'on' : ''}`} onClick={() => setMenu(!menuOpen)} title="Menu" aria-label="Widget menu">⋯</button>
          {menuOpen && <WidgetMenu s={s} projectId={p.id} locked={locked} launch={launch} onClose={() => setMenu(false)} />}
        </div>
      </div>
      <div className="meta">{pic && <span className="ell">PIC: <b>{pic}</b></span>}{pic && domain && <span className="sep" />}{domain && <span className="ell">{domain}</span>}</div>
      {p.hasExpenses && (() => {
        const rs = s.reimbursements.filter((r) => r.projectId === p.id); const pend = rs.filter((r) => !r.reimbursed);
        const cur = defaultCurrency(s); const sum = pend.reduce((a, r) => a + (convert(r.amount, r.currency, cur, s.prices) ?? 0), 0);
        const u = usdOf(s, sum, cur);
        return <div className="wreimb"><span className="rbadge">▤ Reimburse · <b>{formatAmount(sum, cur)}</b>{u && <em> ≈ {u}</em>}<span className="pend">{pend.length ? 'pending' : 'clear'}</span></span></div>;
      })()}
      <div className="prog"><div className="lbl"><span><b>{done.length} of {all.length}</b> done</span><span>{pct}%</span></div><div className="bar"><i style={{ width: `${pct}%` }} /></div></div>
      <div className="wtool">
        <span className="sect">Pending · {open.length}</span>
        <span className="notes-anchor nodrag">
          <button className={`wchip ${notesMenu ? 'on' : ''}`} onClick={() => setNotesMenu(!notesMenu)}><Note />Notes{notesMenu ? <ChevronUp size={10} /> : <ChevronDown size={10} />}</button>
          {notesMenu && <NotesMenu theme="dark" onPick={setSheet} onClose={() => setNotesMenu(false)} />}
        </span>
      </div>
      <div className="wl scroll">
        {open.map((t) => <WTask key={t.id} s={s} t={t} />)}
        {open.length === 0 && <div className="w-hint">Nothing pending 🎉</div>}
        {p.hasExpenses && s.reimbursements.some((r) => r.projectId === p.id) && <>
          <div className="divider">Reimbursement · {s.reimbursements.filter((r) => r.projectId === p.id).length} items</div>
          {s.reimbursements.filter((r) => r.projectId === p.id).map((r) => (
            <div className="wr" key={r.id} data-reimb={r.item}><span className={`rd ${r.status}`} /><span className="t">{r.item}</span>
              <span className="wamt"><b>{formatAmount(r.amount, r.currency)}</b>{usdOf(s, r.amount, r.currency) && <em> ≈ {usdOf(s, r.amount, r.currency)}</em>}</span>
              <span className={`wst ${r.status}`}>{r.status === 'paid' ? 'Paid' : r.status === 'approved' ? 'Approved' : 'Pending'}</span></div>))}
        </>}
        {done.length > 0 && <div className="divider">Done · {done.length}</div>}
        {done.slice().reverse().map((t) => <WTask key={t.id} s={s} t={t} />)}
      </div>
      <WAdd projectId={p.id} />
      {p.hasExpenses && <WQuickReimb s={s} projectId={p.id} />}
    </>
  );
}

function WTask({ s, t }: { s: Snapshot; t: Task }) {
  const cb = checkedBy(s, t.approvedByMemberId, t.approvedAt);
  return (
    <div className={`wt ${t.done ? 'done' : ''}`} data-task={t.title}
      title={t.done ? `Checked by ${cb.text}${t.notes ? '\n' + t.notes : ''}` : `Click to check · auto-approved by you${t.notes ? '\n' + t.notes : ''}`}>
      <CheckBox theme="dark" done={t.done} label={t.title} onClick={() => actions.toggleTask(t)} />
      <span className="t">{t.title}</span>
      {t.hasExpense && t.expenseAmount != null && <span className="wtag">{formatAmount(t.expenseAmount, t.expenseCurrency ?? s.currency)}{usdOf(s, t.expenseAmount, t.expenseCurrency ?? s.currency) ? ` ≈ ${usdOf(s, t.expenseAmount, t.expenseCurrency ?? s.currency)}` : ''}</span>}
      {!t.done && t.notes && <span className="wn"><Note /></span>}
      {!t.done && t.dueDate && <span className="wd">{shortDate(t.dueDate)}</span>}
      {t.done && cb.m && <Avatar initials={cb.m.initials} size="sm" title={`Checked by ${cb.text}`} />}
    </div>
  );
}

function WAdd({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState(''); const [due, setDue] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); if (!title.trim()) return;
    void actions.addTask(projectId, title, due || null); setTitle(''); setDue('');
  };
  return (
    <form className={`wadd nodrag ${title ? 'active' : ''}`} onSubmit={submit}>
      <span className="plus">+</span>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" aria-label="New task title" />
      <label className="wcal" title="Due date (optional)"><Calendar size={12} w={2} /><input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" /></label>
      <button className="wbtn" disabled={!title.trim()}>Add</button>
    </form>
  );
}

/** Quick add reimbursement straight from the widget: item + nominal (default currency per admin). */
function WQuickReimb({ s, projectId }: { s: Snapshot; projectId: string }) {
  const [item, setItem] = useState(''); const [amt, setAmt] = useState(''); const [cur, setCur] = useState(defaultCurrency(s)); const [err, setErr] = useState('');
  const n = Number(amt.replace(',', '.'));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!item.trim() || !amt || !(n >= 0)) return;
    try { await actions.request('POST', `/api/projects/${projectId}/reimbursements`, { item, amount: n, currency: cur, category: 'Other' }); setItem(''); setAmt(''); setErr(''); }
    catch (x) { setErr((x as Error).message); }
  };
  const u = n > 0 ? usdOf(s, n, cur) : null;
  return (
    <form className="wqr nodrag" onSubmit={submit}>
      <div className="wqh">Quick add reimbursement</div>
      <div className="wqrow">
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item" aria-label="Reimbursement item" />
        <CurrencySelect value={cur} onChange={setCur} theme="dark" compact />
        <input className="wqa" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" aria-label="Reimbursement nominal" />
        <button className="wbtn" disabled={!item.trim() || !amt}>Add</button>
      </div>
      <div className="wqf"><span>{err || `Nominal in ${cur} · default currency (per admin)`}</span><span>{u ? `≈ ${u}` : ''}</span></div>
    </form>
  );
}
void formatUsd;

function WidgetMenu({ s, projectId, locked, launch, onClose }: { s: Snapshot; projectId: string; locked: boolean; launch: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement!.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f);
  }, [onClose]);
  const ck = (on: boolean) => (on ? <span className="ck"><Check size={11} w={3} /></span> : null);
  const item = (label: React.ReactNode, fn: () => void, extra?: React.ReactNode) =>
    <button className="pi" onClick={() => { fn(); onClose(); }}>{label}{extra}</button>;
  return (
    <div className="pop dark wmenu" ref={ref} role="menu">
      {item(<><Window />Open Manage window</>, () => actions.openManage({ view: 'project', projectId }))}
      {item(<>Lock position</>, () => actions.setSetting({ lockPosition: !locked }), ck(locked))}
      {item(<>Launch at login</>, () => actions.setSetting({ launchAtLogin: !launch }), ck(launch))}
      {item(<><Refresh />Sync now</>, () => actions.refresh())}
      <div className="popsep" />
      {item(<><Power />Sign out ({s.me.initials})</>, () => actions.signOut())}
      {item(<><X />Close widget</>, () => actions.closeWidget())}
    </div>
  );
}
