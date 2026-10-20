/** Pure snapshot edits and the REST shape of each queued mutation. Shared by the desktop sync engine and the Chrome extension. */
import type { Member, Snapshot, Task } from '@desklist/shared';
import type { Op, QueuedOp } from './ipc';

export function applyOp(s: Snapshot, op: Op, me: Member | null, at: string): Snapshot {
  const tasks = s.tasks.slice(); const projects = s.projects.slice();
  const pIdx = (id: string) => projects.findIndex((p) => p.id === id);
  switch (op.kind) {
    case 'task.create': {
      if (tasks.some((t) => t.id === op.id)) break;
      const max = Math.max(0, ...tasks.filter((t) => t.projectId === op.projectId).map((t) => t.sortOrder));
      tasks.push({ id: op.id, projectId: op.projectId, title: op.title, done: false, doneAt: null, dueDate: op.dueDate ?? null,
        bicMemberId: null, createdByMemberId: me?.id ?? null, approvedByMemberId: null, approvedAt: null, notes: op.notes ?? '', doneNote: '', taskType: op.taskType ?? 'standard',
        hasExpense: !!op.hasExpense, expenseAmount: op.expenseAmount ?? null, expenseCurrency: op.hasExpense ? op.expenseCurrency ?? s.currency ?? 'SOL' : null,
        sortOrder: max + 1, createdAt: at, updatedAt: at });
      break;
    }
    case 'task.update': {
      const i = tasks.findIndex((t) => t.id === op.id); if (i < 0) break;
      const t: Task = { ...tasks[i], ...op.patch, updatedAt: at };
      if (op.patch.done === true && !tasks[i].done) Object.assign(t, { doneAt: at, approvedAt: at, approvedByMemberId: me?.id ?? null, bicMemberId: op.patch.bicMemberId ?? me?.id ?? null });
      if (op.patch.done === false) Object.assign(t, { doneAt: null, approvedAt: null, approvedByMemberId: null });
      tasks[i] = t; break;
    }
    case 'task.delete': return { ...s, tasks: tasks.filter((t) => t.id !== op.id) };
    case 'project.update': {
      const i = pIdx(op.id); if (i < 0) break;
      const p = { ...projects[i] };
      if (op.patch.name) p.name = op.patch.name;
      if (op.patch.notes != null) { p.notes = op.patch.notes; p.notesUpdatedAt = at; }
      if (op.patch.hasExpenses != null) p.hasExpenses = op.patch.hasExpenses;
      if (op.patch.reimburseNote != null) p.reimburseNote = op.patch.reimburseNote;
      if (op.patch.values) {
        p.values = { ...p.values }; p.secretSet = { ...p.secretSet };
        for (const [fid, v] of Object.entries(op.patch.values)) {
          const f = s.fields.find((x) => x.id === fid);
          if (f?.isSecret) p.secretSet[fid] = !!v; else p.values[fid] = v;
          if (f?.key === 'project_name' && v) p.name = v;
          if (!p.fields.some((x) => x.fieldId === fid)) p.fields = [...p.fields, { fieldId: fid, required: false, sortOrder: f?.sortOrder ?? 99 }];
        }
      }
      projects[i] = p; break;
    }
    case 'project.addField': {
      const i = pIdx(op.projectId); if (i < 0) break;
      const p = { ...projects[i] }; const f = s.fields.find((x) => x.id === op.fieldId);
      if (!p.fields.some((x) => x.fieldId === op.fieldId)) p.fields = [...p.fields, { fieldId: op.fieldId, required: false, sortOrder: f?.sortOrder ?? 99 }];
      if (op.value !== undefined) { if (f?.isSecret) p.secretSet = { ...p.secretSet, [op.fieldId]: !!op.value }; else p.values = { ...p.values, [op.fieldId]: op.value }; }
      projects[i] = p; break;
    }
    case 'column.create': {
      const i = pIdx(op.projectId); if (i < 0) break;
      const p = projects[i]; if (p.customColumns.some((c) => c.id === op.id)) break;
      projects[i] = { ...p, customColumns: [...p.customColumns, { id: op.id, projectId: p.id, label: op.label, dataType: op.dataType, value: op.value ?? null, sortOrder: p.customColumns.length + 1, updatedAt: at }] };
      break;
    }
    case 'column.update': case 'column.delete': {
      for (const [i, p] of projects.entries()) {
        if (!p.customColumns.some((c) => c.id === op.id)) continue;
        projects[i] = { ...p, customColumns: op.kind === 'column.delete' ? p.customColumns.filter((c) => c.id !== op.id)
          : p.customColumns.map((c) => (c.id === op.id ? { ...c, ...op.patch, updatedAt: at } : c)) };
      }
      break;
    }
  }
  return { ...s, tasks, projects };
}

export function toRequest(q: QueuedOp): { method: string; path: string; body?: unknown } {
  const { op, at } = q;
  switch (op.kind) {
    case 'task.create': return { method: 'POST', path: `/api/projects/${op.projectId}/tasks`, body: { id: op.id, title: op.title, dueDate: op.dueDate ?? null, notes: op.notes ?? '', hasExpense: op.hasExpense, expenseAmount: op.expenseAmount, expenseCurrency: op.expenseCurrency ?? undefined, taskType: op.taskType ?? 'standard', platform: op.platform, updatedAt: at } };
    case 'task.update': return { method: 'PATCH', path: `/api/tasks/${op.id}`, body: { ...op.patch, updatedAt: at } };
    case 'task.delete': return { method: 'DELETE', path: `/api/tasks/${op.id}` };
    case 'project.update': return { method: 'PATCH', path: `/api/projects/${op.id}`, body: { ...op.patch, updatedAt: at } };
    case 'project.addField': return { method: 'POST', path: `/api/projects/${op.projectId}/fields`, body: { fieldId: op.fieldId, value: op.value } };
    case 'column.create': return { method: 'POST', path: `/api/projects/${op.projectId}/columns`, body: { id: op.id, label: op.label, dataType: op.dataType, value: op.value ?? null } };
    case 'column.update': return { method: 'PATCH', path: `/api/columns/${op.id}`, body: { ...op.patch, updatedAt: at } };
    case 'column.delete': return { method: 'DELETE', path: `/api/columns/${op.id}` };
  }
}

export const entityKey = (op: Op) => ('id' in op ? `${op.kind}:${op.id}` : null);
