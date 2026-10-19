/**
 * The renderer side of the shared data layer. Both windows subscribe to the same AppState
 * from the main-process SyncEngine; every mutation goes through `actions` → main → outbox → server.
 */
import { useSyncExternalStore } from 'react';
import type { CustomColumnType, Task } from '@desklist/shared';
import type { AppState, Op } from '../../../common/ipc';

const bridge = window.desklist;
let current: AppState | null = null;
const subs = new Set<() => void>();
const set = (s: AppState) => { current = s; subs.forEach((f) => f()); };
bridge.onState(set);
void bridge.getState().then(set);

export function useAppState(): AppState | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current);
}

const uuid = () => crypto.randomUUID();
const m = (op: Op) => bridge.mutate(op);

export const actions = {
  signIn: (code: string, url?: string) => bridge.signIn(code, url),
  signOut: () => bridge.signOut(),
  refresh: () => bridge.refresh(),
  request: <T,>(method: string, path: string, body?: unknown) => bridge.request<T>(method, path, body),
  openManage: bridge.openManage,
  setCurrentProject: (id: string) => bridge.setCurrentProject(id),
  setSetting: bridge.setSetting,
  closeWidget: () => bridge.closeWidget(),
  windowControl: bridge.windowControl,

  /** Ticking a task auto-approves it: the server records the signed-in member as checker/approver. */
  toggleTask: (t: Task) => m({ kind: 'task.update', id: t.id, patch: { done: !t.done } }),
  addTask: (projectId: string, title: string, dueDate?: string | null, notes?: string, taskType: 'standard' | 'social' = 'standard', platform?: string) =>
    m({ kind: 'task.create', projectId, id: uuid(), title: title.trim(), dueDate: dueDate || null, notes, taskType, platform }),
  updateTask: (id: string, patch: Extract<Op, { kind: 'task.update' }>['patch']) => m({ kind: 'task.update', id, patch }),
  deleteTask: (id: string) => m({ kind: 'task.delete', id }),
  updateProject: (id: string, patch: Extract<Op, { kind: 'project.update' }>['patch']) => m({ kind: 'project.update', id, patch }),
  addTaskWithExpense: (projectId: string, title: string, dueDate: string | null, expenseAmount: number, expenseCurrency: string) =>
    m({ kind: 'task.create', projectId, id: uuid(), title: title.trim(), dueDate, hasExpense: true, expenseAmount, expenseCurrency }),
  setProjectNotes: (id: string, notes: string) => m({ kind: 'project.update', id, patch: { notes } }),
  setFieldValue: (projectId: string, fieldId: string, value: string | null) => m({ kind: 'project.update', id: projectId, patch: { values: { [fieldId]: value } } }),
  addFieldToProject: (projectId: string, fieldId: string, value?: string | null) => m({ kind: 'project.addField', projectId, fieldId, value }),
  addColumn: (projectId: string, label: string, dataType: CustomColumnType, value?: string | null) =>
    m({ kind: 'column.create', projectId, id: uuid(), label: label.trim(), dataType, value: value ?? null }),
  setColumnValue: (id: string, value: string | null) => m({ kind: 'column.update', id, patch: { value } }),
  deleteColumn: (id: string) => m({ kind: 'column.delete', id }),
};
