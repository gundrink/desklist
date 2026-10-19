import { useState } from 'react';
import { CUSTOM_COLUMN_TYPE_LABELS, type Snapshot, type Task } from '@desklist/shared';
import type { ProjectTab } from '../../../common/ipc';
import { actions } from '../lib/store';
import { domainOf, dueSoon, initialsOf, picOf, projectFields, shortDate, statusOf, tasksOf } from '../lib/model';
import { Avatar, CheckBox, StatusPill, checkedBy } from '../components/Common';
import { AddTaskForm } from '../components/AddTaskForm';
import { FieldInput } from '../components/FieldInput';
import { NotesMenu, NotesSheet, type NotesKind } from '../components/Notes';
import { Calendar, ChevronDown, ChevronUp, Note, Trash, Check } from '../components/Icons';
import { Amount, Toggle, defaultCurrency, rateNote } from '../components/Money';
import { TaskPanel, fieldsOf, reimbOfTask } from '../components/TaskPanel';
import { ReimbursementTab, pendingLabel } from './Reimbursement';
import { TaskDetailsTab } from './TaskDetails';
import { Collapse, leave } from '../components/Motion';
import { ModeToggle, ProjectView, platformOf } from '../components/ViewMode';

export function ProjectDetail({ s, projectId, tab, setTab, onDeleted }: {
  s: Snapshot; projectId: string; tab: ProjectTab; setTab: (t: ProjectTab) => void; onDeleted: () => void;
}) {
  const p = s.projects.find((x) => x.id === projectId)!;
  const { all, open, done } = tasksOf(s, p.id);
  const pic = picOf(s, p); const domain = domainOf(s, p);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<NotesKind | null>(null);
  const [hideDone, setHideDone] = useState(true);
  const [panel, setPanel] = useState<{ id: string; mode: 'detail' | 'ticked' } | null>(null);
  const pend = pendingLabel(s, p.id).count;
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const exp = p.hasExpenses || all.some((t) => t.hasExpense);
  const row = (t: Task) => <Row key={t.id} s={s} t={t} exp={exp} panel={panel?.id === t.id ? panel.mode : null}
    setPanel={(m) => setPanel(m ? { id: t.id, mode: m } : null)} />;
  return (
    <>
      <div className="rhead">
        <div className="row"><h1>{p.name}</h1><StatusPill status={statusOf(s, p)} theme="light" />
          <span className="rmeta">
            {pic && <><Avatar initials={initialsOf(pic)} size="sm" />PIC: <b>{pic}</b></>}
            {domain && <><span className="dotsep" />{domain}</>}
            {p.deadline && <><span className="dotsep" />Deadline {shortDate(p.deadline, true)}</>}
            <span className="dotsep" />{done.length} of {all.length} done
          </span></div>
        <div className="stabs">
          <button className={`st ${tab === 'checklist' ? 'on' : ''}`} onClick={() => setTab('checklist')}>Checklist</button>
          <button className={`st ${tab === 'details' ? 'on' : ''}`} onClick={() => setTab('details')}>Details &amp; fields</button>
          <button className={`st ${tab === 'reimbursement' ? 'on' : ''}`} onClick={() => setTab('reimbursement')}>Reimbursement
            {pend > 0 && <span className="pendpill">{pend} pending</span>}</button>
          <button className={`st ${tab === 'taskdetails' ? 'on' : ''}`} onClick={() => setTab('taskdetails')}>Task details <span className="cntpill">{done.length}</span></button>
          <span className="ml" />
          <ModeToggle mode={mode} setMode={setMode} />
          <span className="exptgl"><Toggle on={p.hasExpenses} onChange={(v) => actions.updateProject(p.id, { hasExpenses: v })} label="Has expenses" /></span>
        </div>
      </div>
      <div className="rbody scroll">
        <div className="mswap" key={`${tab}-${mode}`}>
        {mode === 'view' ? <ProjectView s={s} projectId={p.id} /> : tab === 'checklist' ? (
          <>
            <div className="colh"><span className="c1">Task</span><span className="cdue">Due</span><span className="who">Checked by</span>
              <span className="ncwrap">
                <button className={`nc hdr ${menu || sheet ? 'on' : ''}`} onClick={() => setMenu(!menu)}><Note />Notes{menu ? <ChevronUp /> : <ChevronDown />}</button>
                {menu && <NotesMenu theme="light" onPick={setSheet} onClose={() => setMenu(false)} />}
              </span>{exp && <span className="cexp">▤ Expense</span>}</div>
            <div className="shd"><span className="chk"><Check size={10} /></span>Done · {done.length}<span className="ln" />
              <button className="hide" onClick={() => setHideDone(!hideDone)}>{hideDone ? 'Show completed' : 'Hide completed'}</button></div>
            {(!hideDone || panel) && done.filter((t) => !hideDone || panel?.id === t.id).map(row)}
            {done.length === 0 && <div className="empty-row">Nothing checked off yet.</div>}
            <div className="shd" style={{ marginTop: 14 }}><span className="ring" />Pending · {open.length}<span className="ln" /><span className="hide static">Sort: due date</span></div>
            {open.map(row)}
            <AddTaskForm projectId={p.id} theme="light" s={s} />
          </>
        ) : tab === 'reimbursement' ? <ReimbursementTab s={s} projectId={p.id} />
          : tab === 'taskdetails' ? <TaskDetailsTab s={s} projectId={p.id} />
          : <Details s={s} pId={p.id} onDeleted={onDeleted} />}
        </div>
      </div>
      <div className="footnote small muted">{rateNote(s)}</div>
      {sheet && <NotesSheet s={s} p={p} kind={sheet} setKind={setSheet} onClose={() => setSheet(null)} theme="light" />}
    </>
  );
}

function Row({ s, t, exp, panel, setPanel }: { s: Snapshot; t: Task; exp?: boolean; panel: 'detail' | 'ticked' | null; setPanel: (m: 'detail' | 'ticked' | null) => void }) {
  const cb = checkedBy(s, t.approvedByMemberId, t.approvedAt);
  const [editNote, setEditNote] = useState(false);
  const [note, setNote] = useState(t.notes);
  const saveNote = () => { setEditNote(false); if (note !== t.notes) void actions.updateTask(t.id, { notes: note }); };
  const r = reimbOfTask(s, t.id);
  const nf = fieldsOf(s, t.id).length;
  const tick = () => { if (t.done) { void actions.toggleTask(t); setPanel(null); } else { void actions.toggleTask(t); setPanel('ticked'); } };
  return (
    <>
      <div className={`tr ${t.done ? 'done' : ''} ${editNote ? 'editing' : ''} ${panel ? 'open' : ''}`} data-task={t.title}>
        <CheckBox theme="light" done={t.done} label={t.title} onClick={tick} />
        <button className="tt expbtn" title="Click to expand" onClick={() => setPanel(panel ? null : 'detail')}>
          <span className="chev">{panel ? '▾' : '▸'}</span>{t.title}{platformOf(s, t) && <span className="platpill">{platformOf(s, t)}</span>}{nf > 0 && <em className="nf">{nf} field{nf > 1 ? 's' : ''}</em>}</button>
        <span className="cdue">{t.done ? <span className="when">{shortDate(t.dueDate ?? t.doneAt)}</span>
          : t.dueDate ? <span className={`due ${dueSoon(t.dueDate) ? 'soon' : ''}`}>{dueSoon(t.dueDate) ? <b className="bang">!</b> : <Calendar />}Due {shortDate(t.dueDate)}</span> : <span className="none">—</span>}</span>
        <span className="who">{t.done && cb.m ? <><Avatar initials={cb.m.initials} size="sm" /><span className="cbt" title={`Checked by ${cb.m.name}`}>{cb.text}</span></>
          : <span className="none">—</span>}</span>
        <button className={`nc ${editNote ? 'ed' : t.notes ? '' : 'empty'}`} onClick={() => { setNote(t.notes); setEditNote(!editNote); }} title="Input notes">
          {editNote ? <><Note />Editing note…</> : t.notes ? <><Note />{t.notes}</> : '—'}</button>
        {exp && <span className={`cexp val ${t.hasExpense ? '' : 'none'}`}>
          {t.hasExpense && r ? <Amount s={s} amount={r.amount} code={r.currency} /> : t.hasExpense && t.expenseAmount != null ? <Amount s={s} amount={t.expenseAmount} code={t.expenseCurrency ?? defaultCurrency(s)} /> : '—'}</span>}
        <button className="rowdel" title="Delete task" onClick={(e) => leave((e.currentTarget as HTMLElement).closest('.tr'), () => actions.deleteTask(t.id))}><Trash /></button>
      </div>
      <Collapse open={!!panel}>{panel && <TaskPanel s={s} t={t} theme="light" mode={panel} onClose={() => setPanel(null)} />}</Collapse>
      {editNote && (
        <div className="neditor">
          <div className="nehd"><Note />Input notes <span>· {t.title}</span></div>
          <textarea className="netext" autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(); if (e.key === 'Escape') { setNote(t.notes); setEditNote(false); } }} />
          <div className="nebtns"><span className="nehint">Shown in the widget and Notes column</span>
            <button className="btn sec sm" onClick={() => { setNote(t.notes); setEditNote(false); }}>Cancel</button>
            <button className="btn pri sm" onClick={saveNote}>Save note</button></div>
        </div>
      )}
    </>
  );
}

function Details({ s, pId, onDeleted }: { s: Snapshot; pId: string; onDeleted: () => void }) {
  const p = s.projects.find((x) => x.id === pId)!;
  const fields = projectFields(s, p);
  const isAdmin = s.me.role === 'admin';
  const [msg, setMsg] = useState<string | null>(null);
  const promote = async (id: string) => {
    try { await actions.request('POST', `/api/columns/${id}/promote`, {}); setMsg('Promoted to a master field — available to every project.'); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="details">
      <div className="card">
        <div className="fhead"><h3>Master fields</h3><span className="muted small">Edits save on blur and sync instantly</span></div>
        <div className="grid">
          {fields.map((f) => (
            <label className="f" key={f.id}><span>{f.label}{f.options.hint && <em>{f.options.hint}</em>}{p.fields.find((x) => x.fieldId === f.id)?.required && <em>required</em>}</span>
              <FieldInput s={s} field={f} value={p.values[f.id] ?? null} secretSet={p.secretSet[f.id]} projectId={p.id}
                onCommit={(v) => actions.setFieldValue(p.id, f.id, v)} /></label>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="fhead"><h3>Project columns</h3><span className="muted small">Free-form, this project only</span></div>
        {p.customColumns.length === 0 && <div className="muted small">No columns yet — add one from the Notes ▾ menu → Input column.</div>}
        <div className="grid">
          {p.customColumns.map((c) => (
            <div className="f" key={c.id}><span className="flabel">{c.label}<em>{CUSTOM_COLUMN_TYPE_LABELS[c.dataType]}</em>
              <span className="factions">
                {isAdmin && <button className="linkbtn" onClick={() => promote(c.id)} title="Turn this column into a master field">Promote to master field</button>}
                <button className="iconbtn" title="Remove column" onClick={() => actions.deleteColumn(c.id)}><Trash /></button></span></span>
              <FieldInput s={s} dataType={c.dataType} value={c.value} onCommit={(v) => actions.setColumnValue(c.id, v)} /></div>
          ))}
        </div>
        {msg && <div className="callout">{msg}</div>}
      </div>
      <div className="card">
        <div className="fhead"><h3>Notes</h3></div>
        <FieldInput s={s} dataType="longtext" value={p.notes} onCommit={(v) => actions.setProjectNotes(p.id, v ?? '')} placeholder="Project notes…" />
      </div>
      <div className="danger-row">
        <button className="btn danger sm" onClick={async () => {
          if (!confirm(`Delete ${p.name} and all its tasks? This cannot be undone.`)) return;
          try { await actions.request('DELETE', `/api/projects/${p.id}`); onDeleted(); } catch (e) { setMsg((e as Error).message); }
        }}><Trash /> Delete project</button>
      </div>
    </div>
  );
}
