/** Types shared by the Electron main process, preload bridge and both renderer windows. */
import type { CustomColumnType, Snapshot } from '@desklist/shared';

/** Mutations that are applied optimistically, queued in the offline outbox and replayed on reconnect. */
export type Op =
  | { kind: 'task.create'; projectId: string; id: string; title: string; dueDate?: string | null; notes?: string; hasExpense?: boolean; expenseAmount?: number | null; expenseCurrency?: string | null; taskType?: 'standard' | 'social'; platform?: string }
  | { kind: 'task.update'; id: string; patch: { title?: string; done?: boolean; doneNote?: string; dueDate?: string | null; notes?: string; bicMemberId?: string | null; hasExpense?: boolean; expenseAmount?: number | null; expenseCurrency?: string | null } }
  | { kind: 'task.delete'; id: string }
  | { kind: 'project.update'; id: string; patch: { name?: string; notes?: string; values?: Record<string, string | null>; hasExpenses?: boolean; reimburseNote?: string } }
  | { kind: 'project.addField'; projectId: string; fieldId: string; value?: string | null }
  | { kind: 'column.create'; projectId: string; id: string; label: string; dataType: CustomColumnType; value?: string | null }
  | { kind: 'column.update'; id: string; patch: { label?: string; value?: string | null } }
  | { kind: 'column.delete'; id: string };

export interface QueuedOp { opId: string; at: string; op: Op }

export type Connection = 'online' | 'offline' | 'connecting';
export interface AppState {
  phase: 'signedOut' | 'loading' | 'ready';
  connection: Connection;
  snapshot: Snapshot | null;
  lastSyncedAt: string | null;
  pending: number;
  lastError: string | null;
  serverUrl: string;
  platform: NodeJS.Platform;
  settings: { lockPosition: boolean; launchAtLogin: boolean; currentProjectId: string | null; sessionExpiresAt?: string | null };
}

export type ProjectTab = 'checklist' | 'details' | 'reimbursement' | 'taskdetails';
export type ManageView = { view: 'project'; projectId?: string; tab?: ProjectTab } | { view: 'reports' } | { view: 'create' } | { view: 'fields' } | { view: 'team' } | { view: 'tasksetup' } | { view: 'settings' };

export interface DesklistBridge {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): () => void;
  onNavigate(cb: (v: ManageView) => void): () => void;
  signIn(code: string, serverUrl?: string): Promise<void>;
  account(kind: 'signup' | 'login' | 'redeem', body: Record<string, string>, serverUrl?: string): Promise<{ pending: boolean; accountToken?: string; username?: string }>;
  signOut(): Promise<void>;
  mutate(op: Op): Promise<void>;
  /** Online-only request (admin screens, project create, secret reveal). Throws with the server's message. */
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  refresh(): Promise<void>;
  openManage(v?: ManageView): Promise<void>;
  setCurrentProject(id: string): Promise<void>;
  setSetting(patch: { lockPosition?: boolean; launchAtLogin?: boolean }): Promise<void>;
  closeWidget(): Promise<void>;
  windowControl(action: 'close' | 'minimize' | 'maximize'): Promise<void>;
  checkForUpdates(): Promise<string>;
  /** Download the admin expense CSV and save it via a native Save dialog. Returns the saved path or null. */
  exportCsv(query: string): Promise<string | null>;
  uploadFile(taskId: string, name: string, mime: string, data: Uint8Array, fieldId?: string | null): Promise<unknown>;
  openFile(id: string, name: string): Promise<string>;
  copyText(text: string): Promise<void>;
  passkeyRegister(): Promise<void>;
  passkeySignIn(): Promise<void>;
  googleSignIn(): Promise<void>;
  googleCancel(): Promise<void>;
}
