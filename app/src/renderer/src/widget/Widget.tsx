import { WidgetOverview } from '../components/Overview';
import { widgetLook, lookClass, OpacityControl } from '../components/WidgetLook';
if (typeof document !== 'undefined') document.documentElement.dataset.view = 'widget';
import { Progress, progressOf, blockedByItems } from '../components/Checklist';
import { TaskEditPanel } from '../components/TaskEdit';
import { Select } from '../components/Select';
import { ProjectDescription } from '../components/Description';
import { useEffect, useRef, useState } from 'react';
import '../styles/widget.css';
import '../styles/v5.css';
import '../styles/v6.css';
import '../styles/v61.css';
import '../styles/v62.css';
import '../styles/v66.css';
import '../styles/v68.css';
import '../styles/v69.css';
import '../styles/v610.css';
import '../styles/v611.css';
import { ProjTabs, RailItem, useProjectTabs } from '../components/ProjectList';
import { TaskPanel, fieldsOf } from '../components/TaskPanel';
import { Collapse } from '../components/Motion';
import { ModeToggle, ProjectView, platformOf } from '../components/ViewMode';
import { SOCIAL_PLATFORMS } from '@desklist/shared';
import { formatAmount, formatUsd, convert } from '@desklist/shared';
import { CurrencySelect, defaultCurrency, usdOf } from '../components/Money';
import type { Snapshot, Task } from '@desklist/shared';
import { useAppState, actions } from '../lib/store';
import { ago, domainOf, picOf, shortDate, statusOf, statusStyle, tasksOf } from '../lib/model';
import { Avatar, CheckBox, StatusPill, SyncDot, checkedBy, syncLabel } from '../components/Common';
import { Popover } from '../components/Popover';
import { DeleteProjectModal } from '../manage/ProjectDetail';
import { NotesMenu, NotesSheet, type NotesKind } from '../components/Notes';
import { SignIn, LoadingState , PasskeyNudge } from '../components/SignIn';
import { Calendar, Check, ChevronDown, ChevronUp, Grid, Lock, Note, Power, Refresh, Rocket, Trash, Window, X, Folder } from '../components/Icons';

/**
 * Desktop-level glass widget (v4 design): project rail on the left, project detail on the right.
 * Full daily data entry happens here — tick tasks (auto-approved by you), add tasks, Notes editors.
 */
export function Widget() {
  const st = useAppState();
  const [menu, setMenu] = useState(false); const menuBtn = useRef<HTMLButtonElement>(null);
  const [wview, setWview] = useState<string>(() => localStorage.getItem('dl-wview') ?? 'project');
  useEffect(() => { const f = (e: Event) => { const v = (e as CustomEvent<string>).detail; localStorage.setItem('dl-wview', v); setWview(v); }; window.addEventListener('dl-wview', f); return () => window.removeEventListener('dl-wview', f); }, []);
  const [notesMenu, setNotesMenu] = useState(false);
  const [wdel, setWdel] = useState<string | null>(null);
  useEffect(() => { const f = (e: Event) => setWdel((e as CustomEvent<string>).detail); window.addEventListener('dl-wdel', f); return () => window.removeEventListener('dl-wdel', f); }, []);
  const [sheet, setSheet] = useState<NotesKind | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);

  if (!st) return <div className="widget" style={widgetLook(st)} />;
  const locked = st.settings.lockPosition;
  if (st.phase !== 'ready' || !st.snapshot) {
    return (
      <div className={`widget solo ${locked ? 'locked' : ''} ${lookClass(st)}`} style={widgetLook(st)}>
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
    <div className={`widget ${locked ? 'locked' : ''} ${lookClass(st)}`} style={widgetLook(st)}>
      <div className="rail drag">
        <div className="rhd">Projects <em>{s.projects.length}</em></div>
        <button className={`rov nodrag ${wview === 'overview' ? 'on' : ''}`} data-rail="overview" aria-current={wview === 'overview' ? 'page' : undefined} onClick={() => window.dispatchEvent(new CustomEvent('dl-wview', { detail: 'overview' }))}><Grid size={14} />Overview</button>
        <RailList s={s} sel={wview === 'overview' ? undefined : p?.id} />
        <button className="rnew nodrag" onClick={() => actions.openManage({ view: 'create' })}>+ New</button>
      </div>

      <div className="wdet">
        <PasskeyNudge />
        {wview === 'overview' ? <>
          <div className="w-top drag"><div className="switch"><span className="dotp" />Overview</div><span className="ml" /><ViewToggle v="overview" />
            <div className="menu-anchor nodrag"><button ref={menuBtn} className={`menu ${menu ? 'on' : ''}`} onClick={() => setMenu(!menu)} title="Menu" aria-label="Widget menu">⋯</button>
              {menu && <WidgetMenu anchor={menuBtn} s={s} projectId="" locked={locked} launch={st.settings.launchAtLogin} onClose={() => setMenu(false)} />}</div></div>
          <WidgetOverview s={s} onOpen={(id) => { void actions.setCurrentProject(id); window.dispatchEvent(new CustomEvent('dl-wview', { detail: 'project' })); }} /></>
        : p ? <Detail s={s} pId={p.id} menuOpen={menu} setMenu={setMenu} notesMenu={notesMenu} setNotesMenu={setNotesMenu} setSheet={setSheet}
          locked={locked} launch={st.settings.launchAtLogin} />
          : <div className="w-empty">No projects yet. <button className="linkbtn" onClick={() => actions.openManage({ view: 'create' })}>Create one</button></div>}
        <div className="foot">
          <span className="sync" title={st.lastError ?? undefined}><SyncDot connection={st.connection} />{syncLabel(st.connection, st.pending, ago(st.lastSyncedAt))}</span>
          <button className="add" onClick={() => actions.openManage({ view: 'project', projectId: p?.id })}>Open in Manage →</button>
        </div>
      </div>
      {wdel && (() => { const dp = s.projects.find((x) => x.id === wdel); if (!dp) return null;
        return <DeleteProjectModal compact name={dp.name} onCancel={() => setWdel(null)} onConfirm={async () => {
          const r = await actions.request('DELETE', `/api/projects/${dp.id}`) as any; if (r && r.error) throw new Error(r.error);
          setWdel(null); const next = s.projects.find((x) => x.id !== dp.id);
          if (next && wview !== 'overview') void actions.setCurrentProject(next.id); else window.dispatchEvent(new CustomEvent('dl-wview', { detail: 'overview' }));
          void actions.refresh(); }} />; })()}
      {sheet && p && <NotesSheet s={s} p={p} kind={sheet} setKind={setSheet} onClose={() => setSheet(null)} theme="dark" />}
    </div>
  );
}

function RailList({ s, sel }: { s: Snapshot; sel?: string }) {
  const tabs = useProjectTabs(s);
  return (<>
    <div className="nodrag"><ProjTabs t={tabs} theme="dark" /></div>
    <div className="rail-list nodrag scroll">
      {tabs.list.map((x) => <div className="riwrap" key={x.id}><RailItem s={s} p={x} selected={x.id === sel} onClick={() => { void actions.setCurrentProject(x.id); window.dispatchEvent(new CustomEvent('dl-wview', { detail: 'project' })); }} />
        {s.me.role === 'admin' && <RailMenu name={x.name} id={x.id} />}</div>)}
    </div></>);
}

function Detail({ s, pId, menuOpen, setMenu, notesMenu, setNotesMenu, setSheet, locked, launch }: {
  s: Snapshot; pId: string; menuOpen: boolean; setMenu: (b: boolean) => void; notesMenu: boolean; setNotesMenu: (b: boolean) => void;
  setSheet: (k: NotesKind) => void; locked: boolean; launch: boolean;
}) {
  const p = s.projects.find((x) => x.id === pId)!;
  const { all, open, done, pct } = tasksOf(s, p.id);
  const pic = picOf(s, p); const domain = domainOf(s, p);
  const status = statusOf(s, p);
  const [panel, setPanel] = useState<{ id: string; mode: 'detail' | 'ticked' } | null>(null);
  const [mode, setMode] = useState<'edit' | 'view'>('edit'); const menuBtn = useRef<HTMLButtonElement>(null); const notesBtn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div className="w-top drag">
        <div className="switch" title={p.name}><span className="dotp" style={{ background: statusStyle(status).color }} /><span className="ell">{p.name}</span></div>
        <StatusPill status={status} theme="dark" />
        <ViewToggle v="project" />
        <div className="menu-anchor nodrag">
          <button ref={menuBtn} className={`menu ${menuOpen ? 'on' : ''}`} onClick={() => setMenu(!menuOpen)} title="Menu" aria-label="Widget menu">⋯</button>
          {menuOpen && <WidgetMenu anchor={menuBtn} s={s} projectId={p.id} locked={locked} launch={launch} onClose={() => setMenu(false)} />}
        </div>
      </div>
      <ProjectDescription s={s} p={p} editable={false} compact />
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
        <span className="ml" /><span className="nodrag wmode"><ModeToggle mode={mode} setMode={setMode} compact /></span>
        <span className="notes-anchor nodrag">
          <button ref={notesBtn} className={`wchip ${notesMenu ? 'on' : ''}`} onClick={() => setNotesMenu(!notesMenu)}><Note />Notes{notesMenu ? <ChevronUp size={10} /> : <ChevronDown size={10} />}</button>
          {notesMenu && <NotesMenu anchor={notesBtn} theme="dark" onPick={setSheet} onClose={() => setNotesMenu(false)} />}
        </span>
      </div>
      {mode === 'view' ? <div className="wl scroll nodrag mswap"><ProjectView s={s} projectId={p.id} compact /></div> : <div className="wl scroll">
        {open.map((t) => <WTask key={t.id} s={s} t={t} panel={panel?.id === t.id ? panel.mode : null} setPanel={(m) => setPanel(m ? { id: t.id, mode: m } : null)} />)}
        {open.length === 0 && <div className="w-hint">Nothing pending</div>}
        {p.hasExpenses && s.reimbursements.some((r) => r.projectId === p.id) && <>
          <div className="divider">Reimbursement · {s.reimbursements.filter((r) => r.projectId === p.id).length} items</div>
          {s.reimbursements.filter((r) => r.projectId === p.id).map((r) => (
            <div className="wr" key={r.id} data-reimb={r.item}><span className={`rd ${r.status}`} /><span className="t">{r.item}</span>
              <span className="wamt"><b>{formatAmount(r.amount, r.currency)}</b>{usdOf(s, r.amount, r.currency) && <em> ≈ {usdOf(s, r.amount, r.currency)}</em>}</span>
              <span className={`wst ${r.status}`}>{r.status === 'paid' ? 'Paid' : r.status === 'approved' ? 'Approved' : 'Pending'}</span></div>))}
        </>}
        {done.length > 0 && <div className="divider">Done · {done.length}</div>}
        {done.slice().reverse().map((t) => <WTask key={t.id} s={s} t={t} panel={panel?.id === t.id ? panel.mode : null} setPanel={(m) => setPanel(m ? { id: t.id, mode: m } : null)} />)}
      </div>}
      <WAdd projectId={p.id} />
    </>
  );
}

function WTask({ s, t, panel, setPanel }: { s: Snapshot; t: Task; panel: 'detail' | 'ticked' | null; setPanel: (m: 'detail' | 'ticked' | null) => void }) {
  const cb = checkedBy(s, t.approvedByMemberId, t.approvedAt);
  const r = s.reimbursements.find((x) => x.taskId === t.id);
  const nf = fieldsOf(s, t.id).length;
  const pr = progressOf(s, t.id);
  const tick = () => { if (blockedByItems(s, t)) { setPanel('detail'); return; } void actions.toggleTask(t); setPanel(t.done ? null : 'ticked'); };
  const [editing, setEditing] = useState(false);
  return (<>
    <div className={`wt ${t.done ? 'done' : ''} ${panel ? 'open' : ''}`} data-task={t.title} onClick={() => setPanel(panel ? null : 'detail')}
      title={t.done ? `Checked by ${cb.text}${t.notes ? '\n' + t.notes : ''}` : `Click to expand · tick to approve${t.notes ? '\n' + t.notes : ''}`}>
      <CheckBox theme="dark" done={t.done} label={t.title} onClick={tick} />
      <span className="t">{t.title}</span>
      {platformOf(s, t) && <span className="platpill">{platformOf(s, t)}</span>}
      <Progress d={pr.d} n={pr.n} />
      {t.hasExpense && r && <span className="wtag">{formatAmount(r.amount, r.currency)}{usdOf(s, r.amount, r.currency) ? ` ≈ ${usdOf(s, r.amount, r.currency)}` : ''}</span>}
      {nf > 0 && !t.done && <span className="wn" title={`${nf} fields`}>▤</span>}
      {!t.done && t.notes && <span className="wn"><Note /></span>}
      {!t.done && t.dueDate && <span className="wd">{shortDate(t.dueDate)}</span>}
      {t.done && cb.m && <Avatar initials={cb.m.initials} size="sm" title={`Checked by ${cb.text}`} />}
      <button className="rowedit nodrag" title="Edit task" aria-label={`Edit ${t.title}`} onClick={(e) => { e.stopPropagation(); setEditing(!editing); }}>✎</button>
    </div>
    <Collapse open={editing}>{editing && <div className="nodrag"><TaskEditPanel s={s} t={t} compact onClose={() => setEditing(false)} /></div>}</Collapse>
    <Collapse open={!!panel}>{panel && <div className="nodrag"><TaskPanel s={s} t={t} theme="dark" mode={panel} compact onClose={() => setPanel(null)} /></div>}</Collapse>
  </>);
}

function WAdd({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState(''); const [due, setDue] = useState('');
  const [type, setType] = useState<'standard' | 'social'>('standard'); const [plat, setPlat] = useState('Instagram');
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); if (!title.trim()) return;
    void actions.addTask(projectId, title, due || null, undefined, type, type === 'social' ? plat : undefined); setTitle(''); setDue('');
  };
  return (
    <form className={`wadd nodrag ${title ? 'active' : ''}`} onSubmit={submit}>
      <span className="plus">+</span>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" aria-label="New task title" />
      <Select className="wtype" value={type} onChange={(e) => setType(e.target.value as never)} aria-label="Task type" title="Task type">
        <option value="standard">Standard</option><option value="social">Social account</option></Select>
      {type === 'social' && <Select className="wtype" value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Platform">{SOCIAL_PLATFORMS.map((x) => <option key={x}>{x}</option>)}</Select>}
      <label className="wcal" title="Due date (optional)"><Calendar size={12} w={2} /><input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" /></label>
      <button className="wbtn" disabled={!title.trim()}>Add</button>
    </form>
  );
}

void formatUsd; void CurrencySelect; void defaultCurrency;

function WidgetMenu({ s, projectId, locked, launch, onClose, anchor }: { s: Snapshot; projectId: string; locked: boolean; launch: boolean; onClose: () => void; anchor: React.RefObject<HTMLElement | null> }) {
  const st = useAppState();
  const proj = s.projects.find((x) => x.id === projectId);
  const ck = (on: boolean) => <span className={`ck ${on ? 'on' : ''}`} aria-hidden>{on && <Check size={11} w={3} />}</span>;
  const item = (icon: React.ReactNode, label: React.ReactNode, fn: () => void, extra?: React.ReactNode, cls = '', checked?: boolean) =>
    <button role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} className={`pi ${cls}`} onClick={() => { fn(); onClose(); }}><span className="pic">{icon}</span><span className="plb">{label}</span>{extra}</button>;
  const ov = localStorage.getItem('dl-wview') === 'overview';
  return (
    <Popover anchor={anchor} className="dark wmenu" onClose={onClose}>
      {item(<Window />, 'Open Manage window', () => actions.openManage({ view: 'project', projectId }))}
      {item(ov ? <Folder /> : <Grid />, ov ? 'Show current project' : 'Show overview', () => window.dispatchEvent(new CustomEvent('dl-wview', { detail: ov ? 'project' : 'overview' })))}
      {item(<Refresh />, 'Sync now', () => actions.refresh())}
      <div className="popsep" />
      {item(<Lock size={15} />, 'Lock position', () => actions.setSetting({ lockPosition: !locked }), ck(locked), '', locked)}
      {item(<Rocket />, 'Open Desklist at startup', () => actions.setSetting({ launchAtLogin: !launch }), ck(launch), '', launch)}
      <div className="popsep" />
      {st && <OpacityControl st={st} compact />}
      <div className="popsep" />
      {item(<Power />, `Sign out (${s.me.initials})`, () => actions.signOut())}
      {item(<X size={14} />, 'Close widget', () => actions.closeWidget())}
      {proj && s.me.role === 'admin' && <><div className="popsep" />{item(<Trash size={15} />, 'Delete project…', () => window.dispatchEvent(new CustomEvent('dl-wdel', { detail: proj.id })), undefined, 'danger-item')}</>}
    </Popover>
  );
}

function RailMenu({ name, id }: { name: string; id: string }) {
  const [open, setOpen] = useState(false); const b = useRef<HTMLButtonElement>(null);
  return <><button ref={b} className="rimenu" aria-label={`Project menu ${name}`} title="Project menu" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>⋯</button>
    {open && <Popover anchor={b} className="dark wmenu" onClose={() => setOpen(false)}>
      <button role="menuitem" className="pi" onClick={() => { setOpen(false); void actions.setCurrentProject(id); }}>Show project</button>
      <button role="menuitem" className="pi danger-item" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('dl-wdel', { detail: id })); }}>Delete project…</button>
    </Popover>}</>;
}

function ViewToggle({ v, iconOnly }: { v: 'overview' | 'project'; iconOnly?: boolean }) {
  const set = (x: string) => window.dispatchEvent(new CustomEvent('dl-wview', { detail: x }));
  return <div className={`seg wviewseg nodrag ${iconOnly ? 'icononly' : ''}`} role="group" aria-label="Widget view">
    <button className={v === 'overview' ? 'on' : ''} aria-pressed={v === 'overview'} title="Overview" aria-label="Overview" onClick={() => set('overview')}><Grid size={12} /><span className="vl">Overview</span></button>
    <button className={v === 'project' ? 'on' : ''} aria-pressed={v === 'project'} title="Project" aria-label="Project" onClick={() => set('project')}><Folder size={12} /><span className="vl">Project</span></button>
  </div>;
}
