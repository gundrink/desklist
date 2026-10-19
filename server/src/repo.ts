import type {
  CustomColumn, FieldDefinition, Member, PriceTable, Project, Reimbursement, Snapshot, Task, TaskField, TaskFile, Team, Template,
} from '@desklist/shared';
import type { Queryable } from './db.js';
import { decryptSecret } from './crypto.js';

const S = 'desklist';
const iso = (d: any) => (d == null ? null : new Date(d).toISOString());
const dateOnly = (d: any) => {
  if (d == null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export const mapTeam = (r: any): Team => ({ id: r.id, name: r.name, isDemo: r.is_demo });
export const mapMember = (r: any): Member => ({
  id: r.id, teamId: r.team_id, name: r.name, initials: r.initials, role: r.role, revoked: r.revoked, isDemo: r.is_demo, currency: r.currency ?? 'SOL', googleEmail: r.google_email ?? null, username: r.username ?? null,
});
export const mapField = (r: any): FieldDefinition => ({
  id: r.id, key: r.key, label: r.label, dataType: r.data_type, options: r.options ?? {}, isSecret: r.is_secret,
  isCore: r.is_core, sortOrder: r.sort_order, archived: r.archived, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
});
export const mapTask = (r: any): Task => ({
  id: r.id, projectId: r.project_id, title: r.title, done: r.done, doneAt: iso(r.done_at), dueDate: dateOnly(r.due_date),
  bicMemberId: r.bic_member_id, createdByMemberId: r.created_by_member_id, approvedByMemberId: r.approved_by_member_id,
  approvedAt: iso(r.approved_at), notes: r.notes ?? '',
  hasExpense: !!r.has_expense, expenseAmount: r.expense_amount == null ? null : Number(r.expense_amount), expenseCurrency: r.expense_currency ?? null, doneNote: r.done_note ?? '', taskType: r.task_type ?? 'standard', sortOrder: r.sort_order, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
});
export const mapColumn = (r: any): CustomColumn => ({
  id: r.id, projectId: r.project_id, label: r.label, dataType: r.data_type, value: r.value, sortOrder: r.sort_order,
  updatedAt: iso(r.updated_at)!,
});

export async function listFields(q: Queryable): Promise<FieldDefinition[]> {
  const { rows } = await q.query(`SELECT * FROM ${S}.field_definitions ORDER BY archived, sort_order, created_at`);
  return rows.map(mapField);
}

export async function loadProjects(q: Queryable, teamId: string, onlyId?: string): Promise<Project[]> {
  const params: unknown[] = [teamId];
  let where = 'p.team_id = $1';
  if (onlyId) { params.push(onlyId); where += ' AND p.id = $2'; }
  const { rows: prows } = await q.query(`SELECT p.* FROM ${S}.projects p WHERE ${where} ORDER BY p.sort_order, p.created_at`, params);
  if (!prows.length) return [];
  const ids = prows.map((p: any) => p.id);
  const [pf, pv, cc, fd] = await Promise.all([
    q.query(`SELECT * FROM ${S}.project_fields WHERE project_id = ANY($1::uuid[]) ORDER BY sort_order`, [ids]),
    q.query(`SELECT * FROM ${S}.project_field_values WHERE project_id = ANY($1::uuid[])`, [ids]),
    q.query(`SELECT * FROM ${S}.project_custom_columns WHERE project_id = ANY($1::uuid[]) ORDER BY sort_order, created_at`, [ids]),
    q.query(`SELECT id, key, is_secret FROM ${S}.field_definitions`),
  ]);
  const secret = new Set(fd.rows.filter((f: any) => f.is_secret).map((f: any) => f.id));
  const nameField = fd.rows.find((f: any) => f.key === 'project_name')?.id;
  return prows.map((p: any): Project => {
    const values: Record<string, string | null> = {};
    const secretSet: Record<string, boolean> = {};
    for (const v of pv.rows.filter((v: any) => v.project_id === p.id)) {
      if (secret.has(v.field_id)) { secretSet[v.field_id] = !!v.value; values[v.field_id] = null; }
      else values[v.field_id] = v.value;
    }
    if (nameField) values[nameField] = p.name;
    return {
      id: p.id, teamId: p.team_id, name: p.name, color: p.color, isDemo: p.is_demo, sortOrder: p.sort_order,
      notes: p.notes ?? '', notesUpdatedAt: iso(p.notes_updated_at)!,
      createdAt: iso(p.created_at)!, updatedAt: iso(p.updated_at)!,
      fields: pf.rows.filter((f: any) => f.project_id === p.id).map((f: any) => ({ fieldId: f.field_id, required: f.required, sortOrder: f.sort_order })),
      values, secretSet,
      customColumns: cc.rows.filter((c: any) => c.project_id === p.id).map(mapColumn),
      hasExpenses: !!p.has_expenses, reimburseNote: p.reimburse_note ?? '', templateId: p.template_id ?? null, deadline: dateOnly(p.deadline),
    };
  });
}

export const mapReimbursement = (r: any): Reimbursement => ({
  id: r.id, projectId: r.project_id, taskId: r.task_id ?? null, item: r.item, category: r.category, amount: Number(r.amount),
  currency: r.currency, paidByMemberId: r.paid_by_member_id ?? null, spentOn: dateOnly(r.spent_on), note: r.note ?? '',
  receiptName: r.receipt_name ?? null, status: r.status, reimbursed: r.status === 'paid', reimbursedAt: iso(r.reimbursed_at),
  createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
});
export const mapTemplate = (r: any): Template => ({
  id: r.id, teamId: r.team_id ?? null, ownerMemberId: r.owner_member_id ?? null, name: r.name, description: r.description ?? '',
  icon: r.icon ?? 'list', shared: r.shared, tasks: r.tasks ?? [], createdAt: iso(r.created_at)!,
});

export const mapTaskField = (r: any): TaskField => ({
  id: r.id, taskId: r.task_id, section: r.section, label: r.label, type: r.type, options: r.options ?? {},
  value: r.type === 'password' ? null : r.value, isSet: r.value != null && r.value !== '', sortOrder: r.sort_order, updatedAt: iso(r.updated_at)!,
});
export const mapTaskFile = (r: any): TaskFile => ({
  id: r.id, taskId: r.task_id, fieldId: r.field_id ?? null, name: r.name, mime: r.mime, size: r.size, uploadedBy: r.uploaded_by ?? null, createdAt: iso(r.created_at)!,
});
export async function listTaskFields(q: Queryable, teamId: string, taskId?: string) {
  const { rows } = await q.query(
    `SELECT f.* FROM ${S}.task_fields f JOIN ${S}.tasks t ON t.id=f.task_id JOIN ${S}.projects p ON p.id=t.project_id
     WHERE p.team_id=$1 ${taskId ? 'AND f.task_id=$2' : ''} ORDER BY f.sort_order, f.created_at`, taskId ? [teamId, taskId] : [teamId]);
  return rows.map(mapTaskField);
}
export async function listTaskFiles(q: Queryable, teamId: string, taskId?: string) {
  const { rows } = await q.query(
    `SELECT f.id, f.task_id, f.field_id, f.name, f.mime, f.size, f.uploaded_by, f.created_at FROM ${S}.task_files f
     JOIN ${S}.tasks t ON t.id=f.task_id JOIN ${S}.projects p ON p.id=t.project_id
     WHERE p.team_id=$1 ${taskId ? 'AND f.task_id=$2' : ''} ORDER BY f.created_at`, taskId ? [teamId, taskId] : [teamId]);
  return rows.map(mapTaskFile);
}

export async function listReimbursements(q: Queryable, teamId: string) {
  const { rows } = await q.query(
    `SELECT r.* FROM ${S}.reimbursements r JOIN ${S}.projects p ON p.id=r.project_id WHERE p.team_id=$1 ORDER BY r.spent_on DESC NULLS LAST, r.created_at DESC`, [teamId]);
  return rows.map(mapReimbursement);
}
/** Built-in templates + this team's templates that are shared or owned by me. */
export async function listTemplates(q: Queryable, me: Member) {
  const { rows } = await q.query(
    `SELECT * FROM ${S}.templates WHERE team_id IS NULL OR (team_id=$1 AND (shared OR owner_member_id=$2)) ORDER BY team_id NULLS FIRST, created_at`, [me.teamId, me.id]);
  return rows.map(mapTemplate);
}

export async function snapshot(q: Queryable, me: Member, prices: PriceTable = { usd: {}, fetchedAt: null, stale: true, source: 'none' }): Promise<Snapshot> {
  const [team, members, fields, projects, tasks, reimbursements, templates] = await Promise.all([
    q.query(`SELECT * FROM ${S}.teams WHERE id = $1`, [me.teamId]),
    q.query(`SELECT m.*, a.username FROM ${S}.members m LEFT JOIN ${S}.accounts a ON a.member_id=m.id WHERE m.team_id = $1 ORDER BY m.role, m.name`, [me.teamId]),
    listFields(q),
    loadProjects(q, me.teamId),
    q.query(`SELECT t.* FROM ${S}.tasks t JOIN ${S}.projects p ON p.id = t.project_id WHERE p.team_id = $1 ORDER BY t.sort_order, t.created_at`, [me.teamId]),
    listReimbursements(q, me.teamId),
    listTemplates(q, me),
  ]);
  const [taskFields, taskFiles, items] = await Promise.all([listTaskFields(q, me.teamId), listTaskFiles(q, me.teamId),
    q.query(`SELECT i.* FROM ${S}.task_checklist_items i JOIN ${S}.tasks t ON t.id=i.task_id JOIN ${S}.projects p ON p.id=t.project_id WHERE p.team_id=$1 ORDER BY i.sort_order, i.created_at`, [me.teamId])]);
  const checklistItems = items.rows.map((r: any) => ({ id: r.id, taskId: r.task_id, title: r.title, done: r.done, doneByMemberId: r.done_by_member_id, doneAt: r.done_at ? new Date(r.done_at).toISOString() : null, sortOrder: r.sort_order }));
  return {
    team: mapTeam(team.rows[0]), me, members: members.rows.map(mapMember), fields, projects,
    tasks: tasks.rows.map(mapTask), serverTime: new Date().toISOString(),
    reimbursements, templates, currency: team.rows[0].currency ?? 'SOL', prices, taskFields, taskFiles, checklistItems,
  };
}

export async function revealSecret(q: Queryable, projectId: string, fieldId: string): Promise<string | null> {
  const { rows } = await q.query(`SELECT value FROM ${S}.project_field_values WHERE project_id=$1 AND field_id=$2`, [projectId, fieldId]);
  if (!rows[0]?.value) return null;
  return decryptSecret(rows[0].value);
}
