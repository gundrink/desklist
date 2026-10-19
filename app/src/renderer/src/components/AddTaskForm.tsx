import { useState } from 'react';
import { actions } from '../lib/store';
import { Calendar, Plus } from './Icons';

/** Add-task form shared by the widget and the Manage window: title + optional due date. No BIC picker —
 *  the member who later ticks the task is recorded as its checker/approver. */
export function AddTaskForm({ projectId, theme, autoFocus, onDone }: { projectId: string; theme: 'dark' | 'light'; autoFocus?: boolean; onDone?: () => void }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    void actions.addTask(projectId, title, due || null);
    setTitle(''); setDue('');
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
    </form>
  );
}
