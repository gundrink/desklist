/**
 * Types shared between the Desklist sync server and the Electron app.
 * The server is the only process that talks to PostgreSQL; the app only
 * sees these JSON shapes over REST + WebSocket.
 */

export const FIELD_DATA_TYPES = [
  'text', 'email', 'password', 'select', 'number', 'date', 'url', 'longtext', 'currency', 'person',
] as const;
export type FieldDataType = (typeof FIELD_DATA_TYPES)[number];

export const CUSTOM_COLUMN_TYPES = ['text', 'url', 'date', 'number', 'longtext', 'currency'] as const;
export type CustomColumnType = (typeof CUSTOM_COLUMN_TYPES)[number];

export const CUSTOM_COLUMN_TYPE_LABELS: Record<CustomColumnType, string> = {
  text: 'Text', url: 'URL', date: 'Date', number: 'Number', longtext: 'Long text', currency: 'Currency',
};
export const FIELD_TYPE_LABELS: Record<FieldDataType, string> = {
  text: 'Text', email: 'Email', password: 'Secret (password)', select: 'Drop-down', number: 'Number',
  date: 'Date', url: 'URL', longtext: 'Long text', currency: 'Currency', person: 'Person (team member)',
};

export type Role = 'admin' | 'member';

export interface Team { id: string; name: string; isDemo: boolean }

export interface Member {
  id: string;
  teamId: string;
  name: string;
  initials: string;
  role: Role;
  revoked: boolean;
  isDemo: boolean;
}

export interface FieldOptions {
  /** for data_type = select */
  choices?: string[];
  /** for data_type = currency, e.g. "IDR" */
  currency?: string;
  /** free placeholder / hint text */
  hint?: string;
}

export interface FieldDefinition {
  id: string;
  key: string;
  label: string;
  dataType: FieldDataType;
  options: FieldOptions;
  isSecret: boolean;
  /** core fields (project_name) are always on every project and cannot be archived */
  isCore: boolean;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectField { fieldId: string; required: boolean; sortOrder: number }

export interface CustomColumn {
  id: string;
  projectId: string;
  label: string;
  dataType: CustomColumnType;
  value: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface Project {
  id: string;
  teamId: string;
  name: string;
  color: string;
  isDemo: boolean;
  sortOrder: number;
  /** v1's only free-form project column, autosaved from the project detail panel */
  notes: string;
  notesUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  /** master fields this project uses */
  fields: ProjectField[];
  /** fieldId -> value. Secret values are never sent here (null); see secretSet. */
  values: Record<string, string | null>;
  /** fieldId -> true when a secret value is stored */
  secretSet: Record<string, boolean>;
  customColumns: CustomColumn[];
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  done: boolean;
  doneAt: string | null;
  dueDate: string | null;
  /** optional task owner (BIC). Not required since v0.1 — completion is tracked via approvedBy. */
  bicMemberId: string | null;
  createdByMemberId: string | null;
  /** set server-side from the signed-in member's token when the task is checked; cleared on uncheck */
  approvedByMemberId: string | null;
  approvedAt: string | null;
  /** per-task note shown in the Notes column */
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  team: Team;
  me: Member;
  members: Member[];
  fields: FieldDefinition[];
  projects: Project[];
  tasks: Task[];
  serverTime: string;
}

export interface SignInResponse { token: string; member: Member; team: Team }

export type ServerEvent =
  | { type: 'hello'; memberId: string; serverTime: string }
  | { type: 'changed'; entity: 'project' | 'task' | 'field' | 'member' | 'column'; id?: string; by?: string; at: string };

/** Well-known master field keys used by the UI for project cards / widget. */
export const FIELD_KEYS = {
  projectName: 'project_name',
  pic: 'pic_name',
  email: 'email',
  domain: 'domain',
  password: 'password',
  status: 'status',
  contactEmail: 'contact_email',
} as const;

export const STATUS_CHOICES = ['Not started', 'In progress', 'Done', 'On hold'];

export function slugKey(label: string): string {
  const k = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (/^[a-z]/.test(k) ? k : 'f_' + k).slice(0, 48) || 'field';
}
