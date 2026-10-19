import { useState } from 'react';
import { CUSTOM_COLUMN_TYPE_LABELS, type Snapshot, type Task } from '@desklist/shared';
import { actions } from '../lib/store';
import { domainOf, dueSoon, initialsOf, picOf, projectFields, shortDate, statusOf, tasksOf } from '../lib/model';
import { Avatar, CheckBox, StatusPill, checkedBy } from '../components/Common';
import { AddTaskForm } from '../components/AddTaskForm';
import { FieldInput } from '../components/FieldInput';
import { NotesMenu, NotesSheet, type NotesKind } from '../components/Notes';
import { Calendar, ChevronDown, ChevronUp, Note, Trash, Check } from '../components/Icons';
import { Amount, CurrencySelect, Toggle, defaultCurrency, rateNote } from '../components/Money';
import { ReimbursementTab, pendingLabel } from './Reimbursement';

export function ProjectDetail({ s, projectId, tab, setTab, onDeleted }: {
  s: Snapshot; projectId: string; tab: 'checklist' | 'details' | 'reimbursement'; setTab: (t: 'checklist' | 'details' | 'reimbursement') => void; onDeleted: () => void;
}) {
  const p = s.projects.find((x) => x.id === projectId)!;
  const { all, open, done } = tasksOf(s, p.id);
  const pic = picOf(s, p); const domain = domainOf(s, p);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<NotesKind | null>(null);
  const [hideDone, setHideDone] = useState(false);
  return (
    <>
      <div className="rhead">
        <div className="row"><h1>{p.name}</h1><StatusPill status={statusOf(s, p)} theme="light" />
          {p.isDemo && <span className="demo-badge">Demo data</span>}
          <span className="rmeta">
            {pic && <><Avatar initials={initialsOf(pic)} size="sm" />PIC: <b>{pic}</b></>}
            {domain && <><span className="dotsep" />{domain}</>}
            <span className="dotsep" />{done.length} of {all.length} done
          </span></div>
        <div className="stabs">
          <button className={`st ${tab === 'checklist' ? 'on' : ''}`} onClick={() => setTab('checklist')}>Checklist</button>
          <button className={`st ${tab === 'details' ? 'on' : ''}`} onClick={() => setTab('details')}>Details &amp; fields</button>
          {p.hasExpenses && <button className={`st ${tab === 'reimbursement' ? 'on' : ''}`} onClick={() => setTab('reimbursement')}>Reimbursement
            {pendingLabel(s, p.id).count > 0 && <span className="pendpill">{pendingLabel(s, p.id).count} pending</span>}</button>}
          <span className="ml" />
          <span className="exptgl"><Toggle on={p.hasExpenses} onChange={(v) => { actions.updateProject(p.id, { hasExpenses: v }); if (!v && tab === 'reimbursement') setTab('checklist'); }} label="Ada pengeluaran" /></span>
        </div>
      </div>
      <div className="rbody scroll">
        {tab === 'checklist' ? (
          <>
            <div className="colh"><span className="c1">Task</span><span className="cdue">Due</span><span className="who">Checked by</span>
              <span className="ncwrap">
                <button className={`nc hdr ${menu || sheet ? 'on' : ''}`} onClick={() => setMenu(!menu)}><Note />Notes{menu ? <ChevronUp /> : <ChevronDown />}</button>
                {menu && <NotesMenu theme="light" onPick={setSheet} onClose={() => setMenu(false)} />}
              </span>{p.hasExpenses && <span className="cexp">▤ Pengeluaran</span>}</div>
            <div className="shd"><span className="chk"><Check size={10} /></span>Done · {done.length}<span className="ln" />
              <button className="hide" onClick={() => setHideDone(!hideDone)}>{hideDone ? 'Show completed' : 'Hide completed'}</button></div>
            {!hideDone && done.map((t) => <Row key={t.id} s={s} t={t} exp={p.hasExpenses} />)}
            {done.length === 0 && <div className="empty-row">Nothing checked off yet.</div>}
            <div className="shd" style={{ marginTop: 14 }}><span className="ring" />Pending · {open.length}<span className="ln" /><span className="hide static">Sort: due date</span></div>
            {open.map((t) => <Row key={t.id} s={s} t={t} exp={p.hasExpenses} />)}
            <AddTaskForm projectId={p.id} theme="light" s={s} />
          </>
        ) : tab === 'reimbursement' && p.hasExpenses ? <ReimbursementTab s={s} projectId={p.id} /> : <Details s={s} pId={p.id} onDeleted={onDeleted} />}
      </div>
      {sheet && <NotesSheet s={s} p={p} kind={sheet} setKind={setSheet} onClose={() => setSheet(null)} theme="light" />}
    </>
  );
}

function Row({ s, t, exp }: { s: Snapshot; t: Task; exp?: boolean }) {
  const [editExp, setEditExp] = useState(false);
  const cb = checkedBy(s, t.approvedByMemberId, t.approvedAt);
  const [editNote, setEditNote] = useState(false);
  const [note, setNote] = useState(t.notes);
  const saveNote = () => { setEditNote(false); if (note !== t.notes) void actions.updateTask(t.id, { notes: note }); };
  return (
    <>
      <div className={`tr ${t.done ? 'done' : ''} ${editNote ? 'editing' : ''}`} data-task={t.title}>
        <CheckBox theme="light" done={t.done} label={t.title} onClick={() => actions.toggleTask(t)} />
        <span className="tt" title={t.title}>{t.title}</span>
        {!t.done && <span className="tip">Click to check · auto-approved</span>}
        <span className="cdue">{t.done ? <span className="when">{shortDate(t.dueDate ?? t.doneAt)}</span>
          : t.dueDate ? <span className={`due ${dueSoon(t.dueDate) ? 'soon' : ''}`}><Calendar />Due {shortDate(t.dueDate)}</span> : <span className="none">—</span>}</span>
        <span className="who">{t.done && cb.m ? <><Avatar initials={cb.m.initials} size="sm" /><span className="cbt" title={`Checked by ${cb.m.name}`}>{cb.text}</span></>
          : <span className="none">—</span>}</span>
        <button className={`nc ${editNote ? 'ed' : t.notes ? '' : 'empty'}`} onClick={() => { setNote(t.notes); setEditNote(!editNote); }} title="Input notes">
          {editNote ? <><Note />Editing note…</> : t.notes ? <><Note />{t.notes}</> : '—'}</button>
        {exp && <button className={`cexp val ${t.hasExpense ? '' : 'none'}`} title="Ada pengeluaran — click to edit" onClick={() => setEditExp(!editExp)}>
          {t.hasExpense && t.expenseAmount != null ? <Amount s={s} amount={t.expenseAmount} code={t.expenseCurrency ?? defaultCurrency(s)} /> : '—'}</button>}
        <button className="rowdel" title="Delete task" onClick={() => actions.deleteTask(t.id)}><Trash /></button>
      </div>
      {editExp && <ExpenseEditor s={s} t={t} onClose={() => setEditExp(false)} />}
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

function ExpenseEditor({ s, t, onClose }: { s: Snapshot; t: Task; onClose: () => void }) {
  const [on, setOn] = useState<boolean>(true);
  const [cur, setCur] = useState(t.expenseCurrency ?? defaultCurrency(s));
  const [amt, setAmt] = useState(t.expenseAmount != null ? String(t.expenseAmount) : '');
  const save = () => {
    const n = Number(amt.replace(',', '.'));
    void actions.updateTask(t.id, on && amt && n >= 0 ? { hasExpense: true, expenseAmount: n, expenseCurrency: cur } : { hasExpense: false });
    onClose();
  };
  return (
    <div className="neditor expedit">
      <div className="nehd">Ada pengeluaran <span>· {t.title}</span></div>
      <div className="exprow"><Toggle on={on} onChange={setOn} label="Ada pengeluaran" />
        {on && <div className="inp nominal"><CurrencySelect value={cur} onChange={setCur} /><input autoFocus inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" aria-label="Nominal" /></div>}
        <span className="nehint">{rateNote(s)} · counts toward Reimbursement</span>
        <button className="btn sec sm" onClick={onClose}>Cancel</button><button className="btn pri sm" onClick={save}>Save</button></div>
    </div>
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
