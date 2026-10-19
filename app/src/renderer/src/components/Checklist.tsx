import { useEffect, useState } from 'react';
import type { ChecklistItem, Snapshot, Task } from '@desklist/shared';
import { actions } from '../lib/store';
import { leave } from './Motion';

export const itemsOf = (s: Snapshot, taskId: string): ChecklistItem[] =>
  (s.checklistItems ?? []).filter((i) => i.taskId === taskId).sort((a, b) => a.sortOrder - b.sortOrder);
export const progressOf = (s: Snapshot, taskId: string) => { const it = itemsOf(s, taskId); return { n: it.length, d: it.filter((i) => i.done).length }; };
/** A task with open checklist items can't be ticked directly. */
export const blockedByItems = (s: Snapshot, t: Task) => { const p = progressOf(s, t.id); return !t.done && p.n > 0 && p.d < p.n; };

export function Progress({ d, n, label }: { d: number; n: number; label?: boolean }) {
  if (!n) return null;
  return <span className={`cprog ${d === n ? 'full' : ''}`} title={`${d}/${n} checklist items`}>
    <span className="cpbar"><i style={{ width: `${(d / n) * 100}%` }} /></span><b className="mono">{d}/{n}</b>{label && <em>{d === n ? 'Complete' : 'In progress'}</em>}</span>;
}

const req = (m: string, p: string, b?: unknown) => actions.request(m as never, p, b).catch(() => {});

function ItemRow({ i, idx, count, prev, next, readOnly }: { i: ChecklistItem; idx: number; count: number; prev?: ChecklistItem; next?: ChecklistItem; readOnly?: boolean }) {
  const [ed, setEd] = useState(false); const [v, setV] = useState(i.title);
  const [done, setDone] = useState(i.done); useEffect(() => setDone(i.done), [i.done]);
  const save = () => { setEd(false); const x = v.trim(); if (x && x !== i.title) void req('PATCH', `/api/items/${i.id}`, { title: x }); else setV(i.title); };
  const swap = (o?: ChecklistItem) => { if (!o) return; void req('PATCH', `/api/items/${i.id}`, { sortOrder: o.sortOrder }); void req('PATCH', `/api/items/${o.id}`, { sortOrder: i.sortOrder }); };
  return (
    <div className={`ci ${done ? 'done' : ''}`} data-item={i.title}>
      <input type="checkbox" checked={done} aria-label={`Item ${i.title}`} onChange={(e) => { setDone(e.target.checked); void req('PATCH', `/api/items/${i.id}`, { done: e.target.checked }); }} onClick={(e) => e.stopPropagation()} />
      {ed ? <input className="renamein" autoFocus value={v} aria-label="Edit item" onChange={(e) => setV(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setV(i.title); setEd(false); } }} />
        : <span className="cit" onDoubleClick={() => !readOnly && setEd(true)}>{i.title}</span>}
      {!readOnly && <span className="ciact">
        <button className="iconbtn" aria-label="Move up" disabled={idx === 0} onClick={() => swap(prev)}>↑</button>
        <button className="iconbtn" aria-label="Move down" disabled={idx === count - 1} onClick={() => swap(next)}>↓</button>
        <button className="iconbtn" aria-label={`Rename ${i.title}`} onClick={() => setEd(true)}>✎</button>
        <button className="iconbtn del" aria-label={`Delete ${i.title}`} onClick={(e) => leave((e.currentTarget as HTMLElement).closest('.ci'), () => void req('DELETE', `/api/items/${i.id}`))}>×</button></span>}
    </div>
  );
}

/** Checklist sub-items: add, inline edit, delete, reorder, tick. `readOnly` = View mode / compact widget (tick only). */
export function Checklist({ s, t, readOnly }: { s: Snapshot; t: Task; readOnly?: boolean }) {
  const items = itemsOf(s, t.id); const [v, setV] = useState('');
  const p = progressOf(s, t.id);
  if (readOnly && !items.length) return null;
  const add = () => { const x = v.trim(); if (!x) return; setV(''); void req('POST', `/api/tasks/${t.id}/items`, { title: x }); };
  return (
    <div className="clist" onClick={(e) => e.stopPropagation()}>
      <div className="clh"><span className="cap">Checklist</span><Progress d={p.d} n={p.n} /></div>
      {items.map((i, k) => <ItemRow key={i.id} i={i} idx={k} count={items.length} prev={items[k - 1]} next={items[k + 1]} readOnly={readOnly} />)}
      {!readOnly && <div className="ciadd"><span className="plus">+</span><input value={v} placeholder="Add item" aria-label="Add checklist item" onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /><button className="btn sec xs" disabled={!v.trim()} onClick={add}>Add</button></div>}
    </div>
  );
}
