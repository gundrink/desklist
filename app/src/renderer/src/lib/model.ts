import { FIELD_KEYS, type FieldDefinition, type Member, type Project, type Snapshot, type Task } from '@desklist/shared';

export const fieldByKey = (s: Snapshot, key: string) => s.fields.find((f) => f.key === key);
export const valueOf = (s: Snapshot, p: Project, key: string) => { const f = fieldByKey(s, key); return f ? p.values[f.id] ?? null : null; };
export const statusOf = (s: Snapshot, p: Project) => valueOf(s, p, FIELD_KEYS.status) ?? 'Not started';
export const picOf = (s: Snapshot, p: Project) => valueOf(s, p, FIELD_KEYS.pic);
export const domainOf = (s: Snapshot, p: Project) => valueOf(s, p, FIELD_KEYS.domain);

export function tasksOf(s: Snapshot, projectId: string) {
  const all = s.tasks.filter((t) => t.projectId === projectId);
  const open = all.filter((t) => !t.done).sort(byDueThenOrder);
  const done = all.filter((t) => t.done).sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? '') || a.sortOrder - b.sortOrder);
  return { all, open, done, pct: all.length ? Math.round((done.length / all.length) * 100) : 0 };
}
function byDueThenOrder(a: Task, b: Task) {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
  return a.sortOrder - b.sortOrder;
}

export const member = (s: Snapshot, id: string | null | undefined): Member | undefined => (id ? s.members.find((x) => x.id === id) : undefined);
export const shortName = (name: string) => { const [a, b] = name.split(/\s+/); return b ? `${a} ${b[0]}.` : a; };
export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(d: string | null | undefined, withYear = false) {
  if (!d) return '';
  const x = d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  return `${x.getDate()} ${MONTHS[x.getMonth()]}${withYear ? ' ' + x.getFullYear() : ''}`;
}
export function dueSoon(d: string | null) {
  if (!d) return false;
  const days = (new Date(d + 'T00:00:00').getTime() - Date.now()) / 86400_000;
  return days < 3;
}
export function ago(iso: string | null) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return shortDate(iso);
}

export const STATUS_STYLE: Record<string, { cls: string; color: string }> = {
  'In progress': { cls: 'ip', color: '#2dd4bf' },
  'Not started': { cls: 'ns', color: '#94a3b8' },
  'On hold': { cls: 'oh', color: '#f59e0b' },
  Done: { cls: 'dn', color: '#22c55e' },
};
export const statusStyle = (st: string) => STATUS_STYLE[st] ?? { cls: 'ns', color: '#94a3b8' };

export const projectFields = (s: Snapshot, p: Project): FieldDefinition[] =>
  p.fields.map((pf) => s.fields.find((f) => f.id === pf.fieldId)).filter((f): f is FieldDefinition => !!f && !f.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
