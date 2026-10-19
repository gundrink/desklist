import { useState } from 'react';
import { actions } from '../lib/store';
import type { Snapshot } from '@desklist/shared';
import { Calendar, Plus } from './Icons';

/** Add-task form (Manage): name + optional due date. Reimbursement is set per task in its detail panel. */
export function AddTaskForm({ projectId, theme, autoFocus, onDone }: { projectId: string; theme: 'dark' | 'light'; autoFocus?: boolean; onDone?: () => void; s?: Snapshot }) {
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
