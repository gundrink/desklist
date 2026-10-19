/** Types shared by the Electron main process, preload bridge and both renderer windows. */
import type { CustomColumnType, Snapshot } from '@desklist/shared';

/** Mutations that are applied optimistically, queued in the offline outbox and replayed on reconnect. */
export type Op =
  | { kind: 'task.create'; projectId: string; id: string; title: string; dueDate?: string | null; notes?: string }
  | { kind: 'task.update'; id: string; patch: { title?: string; done?: boolean; dueDate?: string | null; notes?: string; bicMemberId?: string | null } }
  | { kind: 'task.delete'; id: string }
  | { kind: 'project.update'; id: string; patch: { name?: string; notes?: string; values?: Record<string, string | null> } }
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
  settings: { lockPosition: boolean; launchAtLogin: boolean; currentProjectId: string | null };
}

export type ManageView = { view: 'project'; projectId?: string; tab?: 'checklist' | 'details' } | { view: 'create' } | { view: 'fields' } | { view: 'team' };

export interface DesklistBridge {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): () => void;
  onNavigate(cb: (v: ManageView) => void): () => void;
  signIn(code: string, serverUrl?: string): Promise<void>;
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
}
