/**
 * DEMO DATA seed — idempotent. Everything created here is flagged is_demo = true
 * and names are prefixed/labelled as demo. Safe to re-run: existing rows are kept
 * (user edits survive), demo sign-in codes are re-set to the documented values.
 *
 *   Demo Team:  Andi Darmawan (AD, admin)  DEMO-ADMIN
 *               Budi Santoso  (BS)         DEMO-0001
 *               Citra Kusuma  (CK)         DEMO-0002
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { STATUS_CHOICES } from '@desklist/shared';
import { createDb, SCHEMA as S, type Db, type Queryable } from './db.js';
import { codeBucket, encryptSecret, normalizeCode } from './crypto.js';

// Fixed ids so the seed is idempotent.
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const DEMO = {
  team: id(0xd0),
  admin: id(0xa1), budi: id(0xa2), citra: id(0xa3),
  codes: { admin: 'DEMO-ADMIN', budi: 'DEMO-0001', citra: 'DEMO-0002' },
};

export const MASTER_FIELDS = [
  { key: 'project_name', label: 'Project name', type: 'text', core: true },
  { key: 'pic_name', label: 'PIC name', type: 'text', options: { hint: 'Project contact' } },
  { key: 'email', label: 'Project email', type: 'email' },
  { key: 'domain', label: 'Domain', type: 'url' },
  { key: 'password', label: 'Password', type: 'password', secret: true },
  { key: 'status', label: 'Status', type: 'select', options: { choices: STATUS_CHOICES } },
  { key: 'contact_email', label: 'Contact email', type: 'email' },
] as const;

type SeedTask = [title: string, done: boolean, who: 'admin' | 'budi' | 'citra'];
interface SeedProject {
  n: number; name: string; color: string; status: string; pic: string; domain: string; contact: string;
  notes?: string; columns?: [string, string, string][]; tasks: SeedTask[];
}
const A = 'admin', B = 'budi', C = 'citra';
const PROJECTS: SeedProject[] = [
  { n: 1, name: 'Project A', color: '#14b8a6', status: 'In progress', pic: 'Rina Hartono', domain: 'project-a.demo.desklist.app', contact: 'rina.hartono@client.com',
    notes: 'DEMO notes — kickoff done, waiting on API contract sign-off from the client.',
    columns: [['Source', 'text', 'Referral (demo)'], ['Repo link', 'url', 'https://github.com/OWNER/project-a'], ['Deadline', 'date', '2026-11-30'], ['Budget', 'currency', '45000000']],
    tasks: [
      ['Finalize API contract', false, A], ['Design login screen', false, B], ['Set up Railway deploy', false, A],
      ['Write onboarding guide', false, C], ['QA on Windows 11', false, B],
      ['Kickoff meeting', true, A], ['Collect requirements', true, C], ['Create Neon database', true, A],
      ['Define master fields', true, B], ['Draft project brief', true, C], ['Set up repository', true, A], ['Choose tech stack', true, B],
    ] },
  { n: 2, name: 'Project B', color: '#6366f1', status: 'In progress', pic: 'Dewi Lestari', domain: 'project-b.demo.desklist.app', contact: 'dewi@client-b.com',
    columns: [['Source', 'text', 'Website form (demo)'], ['Deadline', 'date', '2026-12-15']],
    tasks: [
      ['Brand moodboard', true, C], ['Stakeholder interviews', true, A], ['Sitemap', true, B],
      ['Homepage wireframe', false, C], ['CMS selection', false, A], ['Content migration plan', false, B],
      ['SEO audit', false, C], ['Analytics setup', false, A], ['Launch checklist', false, B],
    ] },
  { n: 3, name: 'Project C', color: '#f59e0b', status: 'Not started', pic: 'Eko Prasetyo', domain: 'project-c.demo.desklist.app', contact: 'eko@client-c.com',
    columns: [['Budget', 'currency', '12500000'], ['Repo link', 'url', 'https://github.com/OWNER/project-c']],
    tasks: [['Scope call', false, A], ['Estimate', false, B], ['Contract', false, A], ['Access to servers', false, C], ['Kickoff deck', false, C]] },
  { n: 4, name: 'Project D', color: '#ec4899', status: 'On hold', pic: 'Fajar Nugroho', domain: 'project-d.demo.desklist.app', contact: 'fajar@client-d.com',
    tasks: [['Audit current app', true, B], ['Performance report', true, A], ['Wait for client budget', false, A], ['Refactor plan', false, C]] },
  { n: 6, name: 'Project F', color: '#0ea5e9', status: 'Done', pic: 'Gita Permata', domain: 'project-f.demo.desklist.app', contact: 'gita@client-f.com',
    tasks: [['Landing page', true, C], ['Payment integration', true, A], ['Email templates', true, B], ['Go live', true, A]] },
  { n: 7, name: 'Project G', color: '#8b5cf6', status: 'In progress', pic: 'Hadi Wijaya', domain: 'project-g.demo.desklist.app', contact: 'hadi@client-g.com',
    columns: [['Source', 'text', 'Existing client (demo)']],
    tasks: [['Requirements workshop', true, A], ['Data model', true, B], ['Mobile mockups', false, C], ['Push notifications', false, B], ['Beta test group', false, A], ['Store listing', false, C]] },
];

/** Demo due dates + per-task notes (only filled where still empty, so user edits survive). */
const EXTRAS: Record<string, [due: string | null, note: string]> = {
  'Finalize API contract': ['2026-10-21', 'Waiting on client sign-off'],
  'Design login screen': ['2026-10-23', 'Use brand kit v2'],
  'Set up Railway deploy': ['2026-10-24', ''],
  'Write onboarding guide': ['2026-10-28', ''],
  'QA on Windows 11': ['2026-10-30', 'Test on 125% scaling'],
  'Kickoff meeting': ['2026-10-05', 'Minutes shared in Drive'],
  'Create Neon database': ['2026-10-09', 'Region: Singapore'],
  'Homepage wireframe': ['2026-10-27', ''],
  'CMS selection': ['2026-11-02', 'Shortlist: Payload, Strapi'],
  'Scope call': ['2026-10-22', ''],
  'Mobile mockups': ['2026-10-26', ''],
};
async function taskExtras(q: Queryable, p: SeedProject) {
  for (const [i, [title]] of p.tasks.entries()) {
    const e = EXTRAS[title];
    if (!e) continue;
    await q.query(`UPDATE ${S}.tasks SET due_date=COALESCE(due_date,$2::date), notes=CASE WHEN notes='' THEN $3 ELSE notes END WHERE id=$1`,
      [id(0x100000 + p.n * 100 + i), e[0], e[1]]);
  }
}

export async function seedMasterFields(q: Queryable) {
  for (const [i, f] of MASTER_FIELDS.entries()) {
    await q.query(
      `INSERT INTO ${S}.field_definitions(key,label,data_type,options,is_secret,is_core,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (key) DO NOTHING`,
      [f.key, f.label, f.type, JSON.stringify('options' in f ? f.options : {}), 'secret' in f && f.secret, 'core' in f && f.core, i + 1]);
  }
  // project_name must always stay core/non-archived
  await q.query(`UPDATE ${S}.field_definitions SET is_core=true, archived=false WHERE key='project_name'`);
  const { rows } = await q.query(`SELECT id, key FROM ${S}.field_definitions`);
  return Object.fromEntries(rows.map((r: any) => [r.key, r.id])) as Record<string, string>;
}

export async function seed(db: Db, log = console.log) {
  await db.tx(async (q) => {
    const F = await seedMasterFields(q);
    await q.query(`INSERT INTO ${S}.teams(id,name,is_demo) VALUES ($1,'Demo Team',true) ON CONFLICT (id) DO NOTHING`, [DEMO.team]);
    const members: [string, string, string, string, string][] = [
      [DEMO.admin, 'Andi Darmawan', 'AD', 'admin', DEMO.codes.admin],
      [DEMO.budi, 'Budi Santoso', 'BS', 'member', DEMO.codes.budi],
      [DEMO.citra, 'Citra Kusuma', 'CK', 'member', DEMO.codes.citra],
    ];
    for (const [mid, name, ini, role, code] of members) {
      const c = normalizeCode(code);
      await q.query(
        `INSERT INTO ${S}.members(id,team_id,name,initials,role,code_hash,code_bucket,is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (id) DO UPDATE SET code_hash=EXCLUDED.code_hash, code_bucket=EXCLUDED.code_bucket, revoked=false, updated_at=now()`,
        [mid, DEMO.team, name, ini, role, await bcrypt.hash(c, 10), codeBucket(c)]);
    }
    const who = { admin: DEMO.admin, budi: DEMO.budi, citra: DEMO.citra };
    const fieldKeys = MASTER_FIELDS.map((f) => f.key);
    for (const p of PROJECTS) {
      const pid = id(0x1000 + p.n);
      const ins = await q.query(
        `INSERT INTO ${S}.projects(id,team_id,name,color,is_demo,sort_order,notes) VALUES ($1,$2,$3,$4,true,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [pid, DEMO.team, p.name, p.color, p.n, p.notes ?? '']);
      if (!ins.rows[0]) { await taskExtras(q, p); continue; } // already seeded; keep user edits
      for (const [i, k] of fieldKeys.entries())
        await q.query(`INSERT INTO ${S}.project_fields(project_id,field_id,required,sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [pid, F[k], k === 'project_name' || k === 'status', i + 1]);
      const slug = p.name.toLowerCase().replace(/\s+/g, '-');
      const values: Record<string, string> = {
        pic_name: p.pic, email: `${slug}@company.demo`, domain: p.domain, status: p.status, contact_email: p.contact,
        password: encryptSecret(`demo-${slug}-pass`),
      };
      for (const [k, v] of Object.entries(values))
        await q.query(`INSERT INTO ${S}.project_field_values(project_id,field_id,value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [pid, F[k], v]);
      for (const [i, [label, type, value]] of (p.columns ?? []).entries())
        await q.query(`INSERT INTO ${S}.project_custom_columns(id,project_id,label,data_type,value,sort_order) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [id(0x10000 + p.n * 100 + i), pid, label, type, value, i + 1]);
      const base = Date.now() - 6 * 86400_000;
      for (const [i, [title, done, w]] of p.tasks.entries()) {
        const at = new Date(base + i * 3600_000 * 7);
        await q.query(
          `INSERT INTO ${S}.tasks(id,project_id,title,done,done_at,bic_member_id,created_by_member_id,approved_by_member_id,approved_at,sort_order,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$5,$9,$10,$10) ON CONFLICT (id) DO NOTHING`,
          [id(0x100000 + p.n * 100 + i), pid, title, done, done ? at : null, who[w], DEMO.admin, done ? who[w] : null, i + 1, at]);
      }
      await taskExtras(q, p);
      log(`[seed] demo ${p.name}: ${p.tasks.length} tasks (${p.tasks.filter((t) => t[1]).length} done)`);
    }
  });
  await seedV5(db, log);
  log('[seed] Demo Team ready — codes: DEMO-ADMIN (admin), DEMO-0001, DEMO-0002');
}

// ------------------------------------------------------------------ v5 demo data (SOL)
export const BUILTIN_TEMPLATES = [
  { n: 1, name: 'Website launch', icon: 'globe', description: 'about 2 weeks · 3 with expenses', tasks: [
    ['Kickoff meeting'], ['Collect requirements'], ['Beli domain', 0.08], ['Setup VPS', 0.12], ['Order SSL certificate', 0.35],
    ['Design homepage'], ['Write page copy'], ['Build pages'], ['Connect analytics'], ['QA on mobile & desktop'], ['Client review'], ['Go live']] },
  { n: 2, name: 'Mobile app', icon: 'phone', description: 'iOS + Android release', tasks: [
    ['Requirements workshop'], ['Wireframes'], ['UI design'], ['API contract'], ['Build MVP'], ['Push notifications'], ['Beta test group'],
    ['Apple developer account', 0.65], ['Store listing'], ['Release']] },
  { n: 3, name: 'Client onboarding', icon: 'user', description: 'new client setup', tasks: [
    ['Welcome email'], ['Contract signed'], ['Collect access & credentials'], ['Kickoff call'], ['Shared drive folder'], ['Project board'], ['First invoice'], ['30-day check-in']] },
] as const;
const TEAM_TEMPLATES = [
  { n: 11, owner: 'admin', name: 'Agency website kit', tasks: ['Brief', 'Moodboard', 'Sitemap', 'Wireframes', 'Design', 'Build', 'Content', 'SEO', 'QA', 'Launch'] },
  { n: 12, owner: 'citra', name: 'Event microsite', tasks: ['Event brief', 'Landing page', 'Registration form', 'Email reminder', 'Speaker page', 'Live check', 'Post-event recap'] },
] as const;

type V5Task = [title: string, done: boolean, due: string, amount: number];
const V5_TASKS: Record<number, V5Task[]> = {
  1: [['Beli domain project-a.com', false, '2026-10-21', 0.08], ['Setup VPS', false, '2026-10-24', 0.12], ['Order SSL certificate', true, '2026-10-15', 0.35]],
};
// [project n, item, category, amount, paidBy, date, status, note]
const V5_REIMB: [number, string, string, number, 'admin' | 'budi' | 'citra', string, 'pending' | 'paid', string, number?][] = [
  [1, 'Domain project-a.com (1 yr)', 'Domain', 0.08, 'admin', '2026-10-12', 'pending', 'Beli domain project-a.com via Niagahoster, 1 tahun, pakai kartu pribadi.', 0],
  [1, 'VPS hosting Oct', 'Hosting', 0.12, 'budi', '2026-10-14', 'pending', '2 vCPU · Singapore', 1],
  [1, 'SSL certificate', 'Other', 0.35, 'citra', '2026-10-09', 'paid', 'Receipt attached', 2],
  [4, 'Cloud storage 2 TB (1 yr)', 'Hosting', 2.40, 'admin', '2026-10-03', 'paid', ''],
  [6, 'Figma seats · Oktober', 'Software', 1.20, 'admin', '2026-10-06', 'pending', ''],
  [7, 'Stock photo bundle', 'Other', 0.90, 'budi', '2026-10-11', 'pending', ''],
  [3, 'Domain project-c.id', 'Domain', 0.10, 'citra', '2026-10-09', 'paid', ''],
  [6, 'Staging server · Oktober', 'Hosting', 0.60, 'admin', '2026-10-08', 'paid', ''],
];

export async function seedV5(db: Db, log = console.log) {
  await db.tx(async (q) => {
    for (const t of BUILTIN_TEMPLATES)
      await q.query(`INSERT INTO ${S}.templates(id,team_id,name,description,icon,shared,tasks) VALUES ($1,NULL,$2,$3,$4,true,$5) ON CONFLICT (id) DO NOTHING`,
        [id(0x7000 + t.n), t.name, t.description, t.icon, JSON.stringify(t.tasks.map(([title, amt]: readonly [string, number?]) => ({ title, expenseAmount: amt ?? null, expenseCurrency: amt ? 'SOL' : null })))]);
    const who = { admin: DEMO.admin, budi: DEMO.budi, citra: DEMO.citra };
    for (const t of TEAM_TEMPLATES)
      await q.query(`INSERT INTO ${S}.templates(id,team_id,owner_member_id,name,shared,tasks) VALUES ($1,$2,$3,$4,true,$5) ON CONFLICT (id) DO NOTHING`,
        [id(0x7000 + t.n), DEMO.team, who[t.owner], t.name, JSON.stringify(t.tasks.map((title) => ({ title })))]);
    await q.query(`UPDATE ${S}.projects SET has_expenses=true WHERE id = ANY($1::uuid[]) AND team_id=$2`, [[1, 3, 4, 6, 7].map((n) => id(0x1000 + n)), DEMO.team]);
    for (const [n, list] of Object.entries(V5_TASKS))
      for (const [i, [title, done, due, amt]] of list.entries())
        await q.query(
          `INSERT INTO ${S}.tasks(id,project_id,title,done,done_at,due_date,has_expense,expense_amount,expense_currency,created_by_member_id,approved_by_member_id,approved_at,sort_order)
           VALUES ($1,$2,$3,$4,CASE WHEN $4 THEN now() END,$5,true,$6,'SOL',$7,CASE WHEN $4 THEN $8::uuid END,CASE WHEN $4 THEN now() END,$9) ON CONFLICT (id) DO NOTHING`,
          [id(0x200000 + Number(n) * 100 + i), id(0x1000 + Number(n)), title, done, due, amt, DEMO.admin, DEMO.citra, 50 + i]);
    for (const [i, [n, item, cat, amt, by, date, status, note, taskIdx]] of V5_REIMB.entries())
      await q.query(
        `INSERT INTO ${S}.reimbursements(id,project_id,task_id,item,category,amount,currency,paid_by_member_id,spent_on,status,note,receipt_name,reimbursed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'SOL',$7,$8,$9,$10,$11,CASE WHEN $9='paid' THEN now() END) ON CONFLICT (id) DO NOTHING`,
        [id(0x300000 + i), id(0x1000 + n), taskIdx == null ? null : id(0x200000 + n * 100 + taskIdx), item, cat, amt, who[by], date, status, note,
          n === 1 && i === 0 ? 'invoice-niagahoster.pdf' : null]);
    await q.query(`UPDATE ${S}.projects SET reimburse_note=$2 WHERE id=$1 AND reimburse_note=''`, [id(0x1001), 'Reimburse via transfer SOL ke wallet masing-masing setiap akhir bulan.']);
  });
  log('[seed] v5: templates, SOL expenses & reimbursements ready');
}

const here = path.dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.(ts|js)$/, '') === path.join(here, 'seed');
if (isMain) {
  const db = createDb();
  seed(db).then(() => db.close()).catch(async (e) => { console.error('[seed] failed:', e.message); await db.close(); process.exit(1); });
}
