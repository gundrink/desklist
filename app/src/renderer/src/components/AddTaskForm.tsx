import { useState } from 'react';
import { actions } from '../lib/store';
import type { Snapshot } from '@desklist/shared';
import { Calendar, Plus } from './Icons';
import { CurrencySelect, Toggle, defaultCurrency, usdOf } from './Money';

/** Add-task form shared by the widget and the Manage window: title + optional due date. No BIC picker —
 *  the member who later ticks the task is recorded as its checker/approver. */
export function AddTaskForm({ projectId, theme, autoFocus, onDone, s }: { projectId: string; theme: 'dark' | 'light'; autoFocus?: boolean; onDone?: () => void; s?: Snapshot }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [exp, setExp] = useState(false); const [amt, setAmt] = useState('');
  const [cur, setCur] = useState(s ? defaultCurrency(s) : 'SOL');
  const n = Number(amt.replace(',', '.'));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (exp && amt && n >= 0) void actions.addTaskWithExpense(projectId, title, due || null, n, cur);
    else void actions.addTask(projectId, title, due || null);
    setTitle(''); setDue(''); setAmt('');
    onDone?.();
  };
  return (
    <form className={`addform ${theme}`} onSubmit={submit}>
      <label className="ai grow"><Plus size={15} w={2.4} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" autoFocus={autoFocus} aria-label="New task title"
          onKeyDown={(e) => { if (e.key === 'Escape') onDone?.(); }} />
      </label>
      <label className="ai date" title="Due date (optional)"><Calendar size={14} w={2} />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
      </label>
      <button className="btn pri" type="submit" disabled={!title.trim()}>Add task</button>
      {s && s.projects.find((p) => p.id === projectId)?.hasExpenses && (
        <div className="addexp">
          <Toggle on={exp} onChange={setExp} label="Ada pengeluaran" theme={theme} />
          {exp && <div className="inp nominal"><CurrencySelect value={cur} onChange={setCur} theme={theme} />
            <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" aria-label="Task expense nominal" />
            <span className="usd">Nominal ({cur})</span></div>}
          {exp && n > 0 && usdOf(s, n, cur) && <span className="small muted">≈ {usdOf(s, n, cur)} USD</span>}
          <span className="small muted ml">Counts toward Reimbursement · pending until approved</span>
        </div>)}
    </form>
  );
}
