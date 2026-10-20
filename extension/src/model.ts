import { FIELD_KEYS, type Project, type Snapshot, type Task } from '@desklist/shared';

export function tasksOf(s: Snapshot, projectId: string) {
  const all = s.tasks.filter((t) => t.projectId === projectId);
  const open = all.filter((t) => !t.done).sort(byDueThenOrder);
  const done = all.filter((t) => t.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '') || a.sortOrder - b.sortOrder);
  return { all, open, done, pct: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}

function byDueThenOrder(a: Task, b: Task) {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
  return a.sortOrder - b.sortOrder;
}

export function itemsOf(s: Snapshot, taskId: string) {
  return (s.checklistItems ?? []).filter((i) => i.taskId === taskId).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** A task with open sub-items cannot be ticked directly; the server ignores that write. */
export function blockedByItems(s: Snapshot, task: Task) {
  const items = itemsOf(s, task.id);
  return items.length > 0 && items.some((i) => !i.done);
}

export function projectLabel(s: Snapshot, p: Project) {
  const field = s.fields.find((f) => f.key === FIELD_KEYS.projectName);
  const value = field ? p.values[field.id]?.trim() : '';
  return value || p.name;
}

export function picOf(s: Snapshot, p: Project) {
  const field = s.fields.find((f) => f.key === FIELD_KEYS.pic);
  return field ? p.values[field.id]?.trim() || null : null;
}

export function initialsOf(s: Snapshot, memberId: string | null) {
  if (!memberId) return '';
  return s.members.find((m) => m.id === memberId)?.initials ?? '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(d: string | null | undefined) {
  if (!d) return '';
  const x = d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return `${x.getDate()} ${MONTHS[x.getMonth()]}`;
}

export function dueSoon(d: string | null) {
  if (!d) return false;
  const days = (new Date(d + 'T00:00:00').getTime() - Date.now()) / 86_400_000;
  return days < 3;
}
