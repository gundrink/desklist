/**
 * System seed — idempotent, NO demo data. Creates only:
 *   - the master field definitions
 *   - a few generic built-in project templates (team_id NULL, available to every team)
 * Real teams/members are created with `npm run bootstrap-admin -w server` (see bootstrap-admin.ts).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUS_CHOICES } from '@desklist/shared';
import { createDb, SCHEMA as S, type Db, type Queryable } from './db.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const MASTER_FIELDS = [
  { key: 'project_name', label: 'Project name', type: 'text', core: true },
  { key: 'pic_name', label: 'PIC name', type: 'text', options: { hint: 'Project contact' } },
  { key: 'email', label: 'Project email', type: 'email' },
  { key: 'domain', label: 'Domain', type: 'url' },
  { key: 'password', label: 'Password', type: 'password', secret: true },
  { key: 'status', label: 'Status', type: 'select', options: { choices: STATUS_CHOICES } },
  { key: 'contact_email', label: 'Contact email', type: 'email' },
] as const;

export const BUILTIN_TEMPLATES: { n: number; name: string; icon: string; description: string; tasks: [string, number?][] }[] = [
  { n: 1, name: 'Website launch', icon: 'globe', description: 'about 2 weeks · 3 with expenses', tasks: [
    ['Kickoff meeting'], ['Collect requirements'], ['Buy domain', 0.08], ['Set up VPS', 0.12], ['Order SSL certificate', 0.35],
    ['Design homepage'], ['Write page copy'], ['Build pages'], ['Connect analytics'], ['QA on mobile & desktop'], ['Client review'], ['Go live']] },
  { n: 2, name: 'Mobile app', icon: 'phone', description: 'iOS + Android release', tasks: [
    ['Requirements workshop'], ['Wireframes'], ['UI design'], ['API contract'], ['Build MVP'], ['Push notifications'], ['Beta test group'],
    ['Apple developer account', 0.65], ['Store listing'], ['Release']] },
  { n: 3, name: 'Client onboarding', icon: 'user', description: 'new client setup', tasks: [
    ['Welcome email'], ['Contract signed'], ['Collect access & credentials'], ['Kickoff call'], ['Shared drive folder'], ['Project board'], ['First invoice'], ['30-day check-in']] },
];

export async function seedMasterFields(q: Queryable) {
  for (const [i, f] of MASTER_FIELDS.entries()) {
    await q.query(
      `INSERT INTO ${S}.field_definitions(key,label,data_type,options,is_secret,is_core,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (key) DO NOTHING`,
      [f.key, f.label, f.type, JSON.stringify('options' in f ? f.options : {}), 'secret' in f && f.secret, 'core' in f && f.core, i + 1]);
  }
  await q.query(`UPDATE ${S}.field_definitions SET is_core=true, archived=false WHERE key='project_name'`);
  const { rows } = await q.query(`SELECT id, key FROM ${S}.field_definitions`);
  return Object.fromEntries(rows.map((r: any) => [r.key, r.id])) as Record<string, string>;
}

export async function seed(db: Db, log = console.log) {
  await db.tx(async (q) => {
    await seedMasterFields(q);
    for (const t of BUILTIN_TEMPLATES)
      await q.query(
        `INSERT INTO ${S}.templates(id,team_id,name,description,icon,shared,tasks) VALUES ($1,NULL,$2,$3,$4,true,$5)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, icon=EXCLUDED.icon, tasks=EXCLUDED.tasks, updated_at=now()`,
        [id(0x7000 + t.n), t.name, t.description, t.icon,
          JSON.stringify(t.tasks.map(([title, amt]) => ({ title, expenseAmount: amt ?? null, expenseCurrency: amt ? 'SOL' : null })))]);
  });
  log('[seed] system data ready (master fields + built-in templates; no demo data)');
}

const here = path.dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.(ts|js)$/, '') === path.join(here, 'seed');
if (isMain) {
  const db = createDb();
  seed(db).then(() => db.close()).catch(async (e) => { console.error('[seed] failed:', e.message); await db.close(); process.exit(1); });
}
