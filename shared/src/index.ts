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
  /** v5: the admin's chosen display currency */
  currency?: string;
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
  /** v5 "Ada pengeluaran" toggle */
  hasExpenses: boolean;
  /** v5 "Catatan reimbursement" */
  reimburseNote: string;
  templateId: string | null;
  /** v6 project deadline (YYYY-MM-DD) */
  deadline: string | null;
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
  /** v5 per-task "Ada pengeluaran" */
  hasExpense: boolean;
  expenseAmount: number | null;
  expenseCurrency: string | null;
  /** v6: note entered when the task was ticked (approved) */
  doneNote: string;
  /** 'social' = social media account task (pre-filled typed fields) */
  taskType: TaskType;
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
  reimbursements: Reimbursement[];
  templates: Template[];
  /** team default currency (set by an admin) */
  currency: string;
  prices: PriceTable;
  taskFields: TaskField[];
  taskFiles: TaskFile[];
}

export interface SignInResponse { token: string; member: Member; team: Team }

export type ServerEvent =
  | { type: 'hello'; memberId: string; serverTime: string }
  | { type: 'changed'; entity: 'project' | 'task' | 'field' | 'member' | 'column' | 'reimbursement' | 'template' | 'settings'; id?: string; by?: string; at: string };

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

// ---------------------------------------------------------------- v5: expenses, templates, currency

/** Selectable currencies: Rupiah + native coins only (no USD, no stablecoins). USD is only used for "≈ $" equivalents. */
export const CURRENCIES = [
  { code: 'SOL', name: 'Solana', geckoId: 'solana', decimals: 4 },
  { code: 'IDR', name: 'Indonesian Rupiah', geckoId: null, decimals: 0 },
  { code: 'BTC', name: 'Bitcoin', geckoId: 'bitcoin', decimals: 6 },
  { code: 'ETH', name: 'Ethereum', geckoId: 'ethereum', decimals: 5 },
  { code: 'BNB', name: 'BNB', geckoId: 'binancecoin', decimals: 4 },
  { code: 'XRP', name: 'XRP', geckoId: 'ripple', decimals: 2 },
  { code: 'ADA', name: 'Cardano', geckoId: 'cardano', decimals: 2 },
  { code: 'DOGE', name: 'Dogecoin', geckoId: 'dogecoin', decimals: 2 },
  { code: 'TON', name: 'Toncoin', geckoId: 'the-open-network', decimals: 3 },
  { code: 'AVAX', name: 'Avalanche', geckoId: 'avalanche-2', decimals: 3 },
  { code: 'TRX', name: 'TRON', geckoId: 'tron', decimals: 2 },
  { code: 'DOT', name: 'Polkadot', geckoId: 'polkadot', decimals: 3 },
  { code: 'LTC', name: 'Litecoin', geckoId: 'litecoin', decimals: 4 },
] as const;
export type CurrencyCode = (typeof CURRENCIES)[number]['code'];
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as unknown as [CurrencyCode, ...CurrencyCode[]];
export const DEFAULT_CURRENCY: CurrencyCode = 'SOL';

/** USD price of 1 unit of each currency. */
export interface PriceTable { usd: Partial<Record<CurrencyCode, number>>; fetchedAt: string | null; stale: boolean; source: string }

export const REIMBURSE_STATUSES = ['pending', 'approved', 'paid'] as const;
export type ReimburseStatus = (typeof REIMBURSE_STATUSES)[number];
export const EXPENSE_CATEGORIES = ['Domain', 'Hosting', 'Software', 'Travel', 'Meals', 'Other'];

export interface Reimbursement {
  id: string;
  projectId: string;
  /** set when the expense comes from a task's "Ada pengeluaran" option */
  taskId: string | null;
  item: string;
  category: string;
  amount: number;
  currency: CurrencyCode;
  paidByMemberId: string | null;
  spentOn: string | null;
  note: string;
  receiptName: string | null;
  status: ReimburseStatus;
  /** true once an admin ticked it as reimbursed (status = paid) */
  reimbursed: boolean;
  reimbursedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateTask { title: string; expenseAmount?: number | null; expenseCurrency?: CurrencyCode | null }
export interface Template {
  id: string;
  /** null = built-in template available to every team */
  teamId: string | null;
  ownerMemberId: string | null;
  name: string;
  description: string;
  icon: string;
  shared: boolean;
  tasks: TemplateTask[];
  createdAt: string;
}

export interface ReportProjectRow { projectId: string; name: string; color: string; total: number; count: number; hasExpenses: boolean }
export interface Report {
  currency: CurrencyCode;
  usdRate: number | null;
  month: string | null;
  total: number; reimbursed: number; notReimbursed: number; count: number; projectsWithExpenses: number;
  perProject: ReportProjectRow[];
  items: (Reimbursement & { projectName: string; converted: number | null })[];
}

/** Format an amount with its code, e.g. "0.75 SOL", "Rp 150.000". */
export function formatAmount(amount: number, code: string): string {
  const c = CURRENCIES.find((x) => x.code === code);
  if (code === 'IDR') return 'Rp ' + Math.round(amount).toLocaleString('id-ID');
  const d = c?.decimals ?? 4;
  const s = Number(amount.toFixed(d)).toString();
  return `${s} ${code}`;
}
export function formatUsd(v: number): string {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** "0.75 SOL ≈ $112.50" (USD part omitted when no rate is known). */
export function withUsd(amount: number, code: string, prices?: PriceTable | null): string {
  const r = prices?.usd[code as CurrencyCode];
  return formatAmount(amount, code) + (r ? ` ≈ ${formatUsd(amount * r)}` : '');
}
export function convert(amount: number, from: string, to: string, prices?: PriceTable | null): number | null {
  if (from === to) return amount;
  const a = prices?.usd[from as CurrencyCode], b = prices?.usd[to as CurrencyCode];
  return a && b ? (amount * a) / b : null;
}

// ---------------------------------------------------------------- v6: typed task fields + files
export const TASK_FIELD_TYPES = ['text', 'email', 'password', 'url', 'number', 'date', 'file', 'dropdown', 'amount'] as const;
export type TaskFieldType = (typeof TASK_FIELD_TYPES)[number];
export const TASK_FIELD_TYPE_LABELS: Record<TaskFieldType, string> = {
  text: 'Text', email: 'Email', password: 'Password', url: 'URL', number: 'Number', date: 'Date', file: 'File', dropdown: 'Dropdown', amount: 'Amount / Reimbursement',
};
export const REIMB_CATEGORIES = ['Domain', 'Hosting', 'Software', 'Other'];
export const TASK_TYPES = ['standard', 'social'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const SOCIAL_PLATFORMS = ['Instagram', 'TikTok', 'X/Twitter', 'Facebook', 'YouTube', 'LinkedIn', 'Telegram', 'Discord', 'Threads', 'Other'];
/** Fields pre-created for a social media account task (all editable/removable later). */
export const SOCIAL_FIELDS: { label: string; type: TaskFieldType; options?: { choices?: string[] } }[] = [
  { label: 'Platform', type: 'dropdown', options: { choices: SOCIAL_PLATFORMS } },
  { label: 'Username / handle', type: 'text' }, { label: 'Email', type: 'email' }, { label: 'Password', type: 'password' },
  { label: 'Phone', type: 'text' }, { label: 'Profile URL', type: 'url' }, { label: '2FA / backup notes', type: 'text' },
];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export interface TaskField {
  id: string; taskId: string; section: 'fields' | 'reimbursement'; label: string; type: TaskFieldType;
  options: { choices?: string[]; currency?: string };
  /** null for passwords (see isSet); amount values are "<number> <CODE>" */
  value: string | null; isSet: boolean; sortOrder: number; updatedAt: string;
}
export interface TaskFile { id: string; taskId: string; fieldId: string | null; name: string; mime: string; size: number; uploadedBy: string | null; createdAt: string }
export interface TaskDetailCard {
  task: Task; fields: TaskField[]; files: TaskFile[]; reimbursement: Reimbursement | null;
}
export interface TaskDetailsResponse { approved: TaskDetailCard[]; pendingCount: number }
