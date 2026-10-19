import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  CURRENCIES, CURRENCY_CODES, MAX_FILE_BYTES, REIMB_CATEGORIES, TASK_FIELD_TYPES, type TaskDetailsResponse, CUSTOM_COLUMN_TYPES, DEFAULT_CURRENCY, FIELD_DATA_TYPES, REIMBURSE_STATUSES, convert, slugKey,
  type Member, type Report, type ServerEvent,
  TASK_TYPES, SOCIAL_FIELDS, SOCIAL_PLATFORMS,
} from '@desklist/shared';
import { PriceService } from './prices.js';
import { registerGoogle, type GoogleConfig } from './google.js';
import { registerPasskeyAuthed, registerPasskeyPublic, type PasskeyConfig } from './passkeys.js';
import type { Db, Queryable } from './db.js';
import { codeBucket, encryptSecret, generateCode, newToken, normalizeCode, sha256 } from './crypto.js';
import { listTaskFields, listTaskFiles, mapTaskField, mapTaskFile } from './repo.js';
import { decryptSecret } from './crypto.js';
import { listFields, listReimbursements, listTemplates, loadProjects, mapColumn, mapField, mapMember, mapReimbursement, mapTask, mapTeam, mapTemplate, revealSecret, snapshot } from './repo.js';

const S = 'desklist';
/** Fixed session lifetime from sign-in (not sliding). SESSION_TTL_DAYS, default 5. */
export const sessionDays = () => { const n = Number(process.env.SESSION_TTL_DAYS ?? 5); return Number.isFinite(n) && n > 0 && n <= 365 ? n : 5; };

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Req = Request & { member?: Member };
const h = (fn: (req: Req, res: Response) => Promise<unknown>) => (req: Req, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

/** Fixed-window limiter on FAILED sign-in attempts, keyed by client IP. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(public max: number, public windowMs = 15 * 60_000) {}
  blocked(key: string) {
    const e = this.hits.get(key);
    return !!e && e.reset > Date.now() && e.n >= this.max;
  }
  fail(key: string) {
    const now = Date.now();
    const e = this.hits.get(key);
    if (!e || e.reset <= now) this.hits.set(key, { n: 1, reset: now + this.windowMs });
    else e.n++;
  }
  clear(key: string) { this.hits.delete(key); }
}

/** Clamp client-supplied timestamps (offline edits) to <= now, for last-write-wins. */
function clientTs(v?: string | null): Date {
  const now = new Date();
  if (!v) return now;
  const d = new Date(v);
  return isNaN(+d) || d > now ? now : d;
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export interface AppOptions { google?: GoogleConfig; passkeys?: PasskeyConfig; db: Db; signinLimit?: number; log?: (...a: unknown[]) => void; prices?: PriceService }

const currency = z.enum(CURRENCY_CODES);
const amount = z.coerce.number().finite().nonnegative().max(1e15);

export function createServer(opts: AppOptions) {
  const { db } = opts;
  const prices = opts.prices ?? new PriceService();
  const log = opts.log ?? console.log;
  const limiter = new RateLimiter(opts.signinLimit ?? Number(process.env.SIGNIN_RATE_LIMIT ?? 10));
  const app = express();
  app.set('trust proxy', 1); // Railway / reverse proxies
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    // The Electron app calls from file:// or a dev server; allow any origin, auth is bearer-token.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Filename, X-Mime, X-Field-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ---------- WebSocket hub ----------
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, { teamId: string; memberId: string; alive: boolean }>();
  function broadcast(teamId: string | null, ev: ServerEvent) {
    const msg = JSON.stringify(ev);
    for (const [ws, c] of clients) if (teamId === null || c.teamId === teamId) ws.send(msg);
  }
  const changed = (req: Req, entity: Extract<ServerEvent, { type: 'changed' }>['entity'], id?: string, global = false) =>
    broadcast(global ? null : req.member!.teamId, { type: 'changed', entity, id, by: req.member!.id, at: new Date().toISOString() });
  const heartbeat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) { ws.terminate(); clients.delete(ws); continue; }
      c.alive = false; ws.ping();
    }
  }, 30_000);

  async function memberFromToken(token: string | undefined): Promise<Member | null> {
    if (!token) return null;
    const { rows } = await db.query(
      `SELECT m.* FROM ${S}.sessions s JOIN ${S}.members m ON m.id = s.member_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND s.created_at > now() - make_interval(days => $2::int) AND NOT m.revoked`, [sha256(token), Math.ceil(sessionDays())]);
    return rows[0] ? mapMember(rows[0]) : null;
  }

  const requireAuth = (req: Req, _res: Response, next: NextFunction) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    memberFromToken(m?.[1])
      .then((member) => {
        if (!member) return next(new HttpError(401, 'Not signed in'));
        req.member = member;
        next();
      })
      .catch(next);
  };
  const admin = (req: Req) => { if (req.member!.role !== 'admin') throw new HttpError(403, 'Admin only'); };

  async function projectOf(q: Queryable, req: Req, projectId: string) {
    const { rows } = await q.query(`SELECT * FROM ${S}.projects WHERE id=$1 AND team_id=$2`, [projectId, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(404, 'Project not found');
    return rows[0];
  }
  async function taskOf(q: Queryable, req: Req, id: string) {
    const { rows } = await q.query(
      `SELECT t.* FROM ${S}.tasks t JOIN ${S}.projects p ON p.id=t.project_id WHERE t.id=$1 AND p.team_id=$2`, [id, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(404, 'Task not found');
    return rows[0];
  }
  async function columnOf(q: Queryable, req: Req, id: string) {
    const { rows } = await q.query(
      `SELECT c.* FROM ${S}.project_custom_columns c JOIN ${S}.projects p ON p.id=c.project_id WHERE c.id=$1 AND p.team_id=$2`, [id, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(404, 'Column not found');
    return rows[0];
  }
  async function assertMember(q: Queryable, req: Req, memberId: string | null | undefined) {
    if (!memberId) return;
    const { rows } = await q.query(`SELECT 1 FROM ${S}.members WHERE id=$1 AND team_id=$2 AND NOT revoked`, [memberId, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(400, 'BIC must be an active member of your team');
  }

  /** Keep the reimbursement row linked to a task's "Ada pengeluaran" in step with the task. */
  async function syncTaskExpense(q: Queryable, t: any, memberId: string) {
    if (t.has_expense && t.expense_amount != null) {
      await q.query(
        `INSERT INTO ${S}.reimbursements(project_id, task_id, item, category, amount, currency, paid_by_member_id, spent_on)
         VALUES ($1,$2,$3,'Other',$4,$5,$6,COALESCE($7::date, CURRENT_DATE))
         ON CONFLICT (task_id) DO UPDATE SET item=EXCLUDED.item, amount=EXCLUDED.amount, currency=EXCLUDED.currency, updated_at=now()`,
        [t.project_id, t.id, t.title, t.expense_amount, t.expense_currency ?? DEFAULT_CURRENCY, memberId, t.due_date]);
    } else {
      await q.query(`DELETE FROM ${S}.reimbursements WHERE task_id=$1 AND status <> 'paid'`, [t.id]);
    }
  }
  async function teamCurrency(q: Queryable, req: Req): Promise<string> {
    const { rows } = await q.query(`SELECT currency FROM ${S}.teams WHERE id=$1`, [req.member!.teamId]);
    return rows[0]?.currency ?? DEFAULT_CURRENCY;
  }
  async function insertTemplateTasks(q: Queryable, req: Req, projectId: string, templateId: string) {
    const { rows } = await q.query(`SELECT * FROM ${S}.templates WHERE id=$1 AND (team_id IS NULL OR (team_id=$2 AND (shared OR owner_member_id=$3)))`,
      [templateId, req.member!.teamId, req.member!.id]);
    if (!rows[0]) throw new HttpError(404, 'Template not found');
    const cur = await teamCurrency(q, req);
    for (const tt of mapTemplate(rows[0]).tasks) {
      const has = tt.expenseAmount != null && tt.expenseAmount > 0;
      const r = await q.query(
        `INSERT INTO ${S}.tasks(project_id, title, created_by_member_id, has_expense, expense_amount, expense_currency, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(sort_order),0)+1 FROM ${S}.tasks WHERE project_id=$1)) RETURNING *`,
        [projectId, tt.title, req.member!.id, has, has ? tt.expenseAmount : null, has ? tt.expenseCurrency ?? cur : null]);
      if (has) await syncTaskExpense(q, r.rows[0], req.member!.id);
    }
    await q.query(`UPDATE ${S}.projects SET template_id=$2, has_expenses = has_expenses OR $3 WHERE id=$1`,
      [projectId, templateId, mapTemplate(rows[0]).tasks.some((t) => (t.expenseAmount ?? 0) > 0)]);
  }

  /** Validate + store one master-field value (encrypting secrets). Last-write-wins on updated_at. */
  async function setValue(q: Queryable, req: Req, projectId: string, fieldId: string, raw: unknown, ts: Date) {
    const { rows } = await q.query(`SELECT * FROM ${S}.field_definitions WHERE id=$1`, [fieldId]);
    const f = rows[0];
    if (!f) throw new HttpError(400, `Unknown field ${fieldId}`);
    let value = raw == null ? null : String(raw).trim();
    if (value === '') value = null;
    if (f.key === 'project_name') {
      if (!value) throw new HttpError(400, 'Project name is required');
      await q.query(`UPDATE ${S}.projects SET name=$2, updated_at=$3 WHERE id=$1 AND updated_at <= $3`, [projectId, value, ts]);
      return;
    }
    if (value != null) {
      const bad = (m: string) => { throw new HttpError(400, `${f.label}: ${m}`); };
      switch (f.data_type) {
        case 'email': if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) bad('invalid email'); break;
        case 'number': case 'currency': if (isNaN(Number(value.replace(/[, ]/g, '')))) bad('must be a number'); break;
        case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) bad('must be YYYY-MM-DD'); break;
        case 'select': if (f.options?.choices && !f.options.choices.includes(value)) bad('not one of the options'); break;
        case 'person': await assertMember(q, req, value); break;
      }
    }
    if (f.is_secret && value != null) value = encryptSecret(value);
    await q.query(
      `INSERT INTO ${S}.project_fields(project_id, field_id, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [projectId, fieldId, f.sort_order]);
    await q.query(
      `INSERT INTO ${S}.project_field_values(project_id, field_id, value, updated_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_id, field_id) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at
       WHERE ${S}.project_field_values.updated_at <= EXCLUDED.updated_at`, [projectId, fieldId, value, ts]);
  }

  // ---------- public ----------
  app.get('/health', h(async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, driver: db.driver, time: new Date().toISOString() });
  }));

  app.post('/api/auth/signin', h(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (limiter.blocked(ip)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const { code } = z.object({ code: z.string().min(4).max(64) }).parse(req.body);
    const norm = normalizeCode(code);
    const { rows } = await db.query(`SELECT * FROM ${S}.members WHERE code_bucket=$1 AND NOT revoked AND code_hash IS NOT NULL`, [codeBucket(norm)]);
    let found: any = null;
    for (const r of rows) if (await bcrypt.compare(norm, r.code_hash)) { found = r; break; }
    if (!found) { limiter.fail(ip); throw new HttpError(401, 'Invalid code'); }
    limiter.clear(ip);
    res.json(await issueSession(found.id));
  }));
  async function issueSession(memberId: string) {
    const token = newToken();
    const { rows: [m] } = await db.query(`SELECT * FROM ${S}.members WHERE id=$1 AND NOT revoked`, [memberId]);
    if (!m) throw new HttpError(401, 'Member revoked');
    const { rows: [sess] } = await db.query(`INSERT INTO ${S}.sessions(member_id, token_hash, expires_at) VALUES ($1,$2, now() + make_interval(secs => $3::double precision)) RETURNING expires_at`,
      [m.id, sha256(token), sessionDays() * 86400]);
    const team = await db.query(`SELECT * FROM ${S}.teams WHERE id=$1`, [m.team_id]);
    return { token, member: mapMember(m), team: mapTeam(team.rows[0]), expiresAt: new Date(sess.expires_at).toISOString() };
  }
  registerPasskeyPublic(app, db, opts.passkeys ?? {}, issueSession);
  registerGoogle(app, db, opts.google ?? {}, issueSession);

  /** Public: selectable currencies + live USD prices (CoinGecko, cached ~5 min, last-rate fallback). */
  const currencies = h(async (_req, res) => {
    res.json({ default: DEFAULT_CURRENCY, currencies: CURRENCIES.map(({ code, name, decimals }) => ({ code, name, decimals })), prices: await prices.get() });
  });
  app.get('/api/currencies', currencies);
  app.get('/api/prices', currencies);

  // ---------- authenticated ----------
  app.use('/api', requireAuth);
  registerPasskeyAuthed(app, db);

  app.post('/api/auth/signout', h(async (req, res) => {
    const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    await db.query(`DELETE FROM ${S}.sessions WHERE token_hash=$1`, [sha256(tok)]);
    res.json({ ok: true });
  }));
  app.get('/api/me', h(async (req, res) => { res.json(req.member); }));
  /** Coalesce identical reads per member: in-flight sharing + ~1.5 s micro-cache, invalidated on any change.
   *  Protects the DB from clients that re-request in a loop (0.6.0 Reports bug). */
  const readCache = new Map<string, { at: number; p: Promise<unknown> }>();
  let readGen = 0;
  const cached = (key: string, fn: () => Promise<unknown>) => {
    const k = `${readGen}|${key}`; const hit = readCache.get(k);
    if (hit && Date.now() - hit.at < 1500) return hit.p;
    const p = fn(); readCache.set(k, { at: Date.now(), p }); p.catch(() => readCache.delete(k));
    if (readCache.size > 500) for (const [kk, v] of readCache) if (Date.now() - v.at > 1500) readCache.delete(kk);
    return p;
  };
  app.use((req, res, next) => {
    if (req.method !== 'GET') { readGen++; readCache.clear(); res.on('finish', () => { readGen++; readCache.clear(); }); }
    next();
  });
  app.get('/api/snapshot', h(async (req, res) => { res.json(await cached(`snap|${req.member!.id}`, async () => snapshot(db, req.member!, await prices.get()))); }));

  /** Currency is set per admin; it also becomes the team's default display currency. */
  app.patch('/api/settings', h(async (req, res) => {
    admin(req);
    const b = z.object({ currency }).parse(req.body);
    await db.query(`UPDATE ${S}.members SET currency=$2, updated_at=now() WHERE id=$1`, [req.member!.id, b.currency]);
    await db.query(`UPDATE ${S}.teams SET currency=$2, updated_at=now() WHERE id=$1`, [req.member!.teamId, b.currency]);
    changed(req, 'settings');
    res.json({ currency: b.currency });
  }));

  // members & codes (admin)
  app.post('/api/members', h(async (req, res) => {
    admin(req);
    const b = z.object({ name: z.string().min(1).max(80), initials: z.string().max(3).optional(), role: z.enum(['admin', 'member']).default('member') }).parse(req.body);
    const initials = (b.initials || b.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2)).toUpperCase();
    const code = generateCode();
    const { rows } = await db.query(
      `INSERT INTO ${S}.members(team_id, name, initials, role, code_hash, code_bucket) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.member!.teamId, b.name, initials, b.role, await bcrypt.hash(code, 10), codeBucket(code)]);
    changed(req, 'member', rows[0].id);
    res.status(201).json({ member: mapMember(rows[0]), code });
  }));
  app.delete('/api/members/:id', h(async (req, res) => {
    admin(req);
    if (req.params.id === req.member!.id) throw new HttpError(400, 'You cannot delete yourself');
    const { rows } = await db.query(`DELETE FROM ${S}.members WHERE id=$1 AND team_id=$2 RETURNING id`, [req.params.id, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(404, 'Member not found');
    changed(req, 'member', req.params.id as string);
    res.json({ ok: true });
  }));
  app.patch('/api/members/:id', h(async (req, res) => {
    admin(req);
    const b = z.object({ name: z.string().min(1).max(80).optional(), initials: z.string().min(1).max(3).optional(), role: z.enum(['admin', 'member']).optional(),
      googleEmail: z.string().trim().toLowerCase().email().max(200).nullable().optional() }).parse(req.body);
    if (b.googleEmail) { const { rows: dup } = await db.query(`SELECT id FROM ${S}.members WHERE lower(google_email)=$1 AND id<>$2`, [b.googleEmail, req.params.id]); if (dup[0]) throw new HttpError(409, 'That Google email is already linked to another member'); }
    const { rows } = await db.query(
      `UPDATE ${S}.members SET name=COALESCE($3,name), initials=COALESCE(upper($4),initials), role=COALESCE($5,role),
         google_email=CASE WHEN $7 THEN $6 ELSE google_email END, updated_at=now()
       WHERE id=$1 AND team_id=$2 RETURNING *`, [req.params.id, req.member!.teamId, b.name, b.initials, b.role, b.googleEmail ?? null, b.googleEmail !== undefined]);
    if (!rows[0]) throw new HttpError(404, 'Member not found');
    changed(req, 'member', rows[0].id);
    res.json(mapMember(rows[0]));
  }));
  /** Generate or reset a member's personal code. Also un-revokes. The plain code is returned once. */
  app.post('/api/members/:id/code', h(async (req, res) => {
    admin(req);
    const code = generateCode();
    const { rows } = await db.query(
      `UPDATE ${S}.members SET code_hash=$3, code_bucket=$4, revoked=false, updated_at=now() WHERE id=$1 AND team_id=$2 RETURNING *`,
      [req.params.id, req.member!.teamId, await bcrypt.hash(code, 10), codeBucket(code)]);
    if (!rows[0]) throw new HttpError(404, 'Member not found');
    await db.query(`DELETE FROM ${S}.sessions WHERE member_id=$1`, [req.params.id]);
    changed(req, 'member', rows[0].id);
    res.json({ member: mapMember(rows[0]), code });
  }));
  app.post('/api/members/:id/revoke', h(async (req, res) => {
    admin(req);
    if (req.params.id === req.member!.id) throw new HttpError(400, 'You cannot revoke yourself');
    const { rows } = await db.query(`UPDATE ${S}.members SET revoked=true, updated_at=now() WHERE id=$1 AND team_id=$2 RETURNING *`, [req.params.id, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(404, 'Member not found');
    await db.query(`DELETE FROM ${S}.sessions WHERE member_id=$1`, [req.params.id]);
    changed(req, 'member', rows[0].id);
    res.json(mapMember(rows[0]));
  }));

  // master field definitions
  const fieldBody = z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).optional(),
    label: z.string().min(1).max(80),
    dataType: z.enum(FIELD_DATA_TYPES),
    options: z.object({ choices: z.array(z.string().min(1)).optional(), currency: z.string().optional(), hint: z.string().optional() }).default({}),
    isSecret: z.boolean().optional(),
  });
  app.get('/api/fields', h(async (_req, res) => { res.json(await listFields(db)); }));
  app.post('/api/fields', h(async (req, res) => {
    admin(req);
    const b = fieldBody.parse(req.body);
    const key = b.key ?? slugKey(b.label);
    const exists = await db.query(`SELECT 1 FROM ${S}.field_definitions WHERE key=$1`, [key]);
    if (exists.rows[0]) throw new HttpError(409, `A master field with key "${key}" already exists`);
    const { rows } = await db.query(
      `INSERT INTO ${S}.field_definitions(key,label,data_type,options,is_secret,sort_order)
       VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(sort_order),0)+1 FROM ${S}.field_definitions)) RETURNING *`,
      [key, b.label, b.dataType, JSON.stringify(b.options), b.isSecret ?? b.dataType === 'password']);
    changed(req, 'field', rows[0].id, true);
    res.status(201).json(mapField(rows[0]));
  }));
  app.patch('/api/fields/:id', h(async (req, res) => {
    admin(req);
    const b = fieldBody.partial().extend({ archived: z.boolean().optional(), sortOrder: z.number().int().optional() }).parse(req.body);
    const cur = (await db.query(`SELECT * FROM ${S}.field_definitions WHERE id=$1`, [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Field not found');
    if (cur.is_core && (b.archived || (b.dataType && b.dataType !== cur.data_type))) throw new HttpError(400, 'Project name is always on and cannot be archived or retyped');
    if (b.isSecret === false && cur.is_secret) throw new HttpError(400, 'A secret field cannot be made non-secret (values are encrypted)');
    if (b.isSecret === true && !cur.is_secret) throw new HttpError(400, 'Create a new secret field instead of converting an existing one');
    if (b.dataType && b.dataType !== cur.data_type && (b.dataType === 'password' || cur.data_type === 'password')) throw new HttpError(400, 'Cannot convert to/from a secret type');
    if (b.key && b.key !== cur.key) {
      if (cur.is_core) throw new HttpError(400, 'Core field key cannot change');
      const dup = await db.query(`SELECT 1 FROM ${S}.field_definitions WHERE key=$1 AND id<>$2`, [b.key, cur.id]);
      if (dup.rows[0]) throw new HttpError(409, `Key "${b.key}" already exists`);
    }
    const { rows } = await db.query(
      `UPDATE ${S}.field_definitions SET key=COALESCE($2,key), label=COALESCE($3,label), data_type=COALESCE($4,data_type),
         options=COALESCE($5::jsonb,options), archived=COALESCE($6,archived), sort_order=COALESCE($7,sort_order), updated_at=now()
       WHERE id=$1 RETURNING *`,
      [cur.id, b.key ?? null, b.label ?? null, b.dataType ?? null, b.options ? JSON.stringify(b.options) : null, b.archived ?? null, b.sortOrder ?? null]);
    changed(req, 'field', cur.id, true);
    res.json(mapField(rows[0]));
  }));
  app.post('/api/fields/reorder', h(async (req, res) => {
    admin(req);
    const { ids } = z.object({ ids: z.array(uuid).min(1) }).parse(req.body);
    await db.tx(async (q) => {
      for (const [i, id] of ids.entries()) await q.query(`UPDATE ${S}.field_definitions SET sort_order=$2, updated_at=now() WHERE id=$1`, [id, i + 1]);
    });
    changed(req, 'field', undefined, true);
    res.json(await listFields(db));
  }));

  // projects
  const colBody = z.object({ id: uuid.optional(), label: z.string().min(1).max(80), dataType: z.enum(CUSTOM_COLUMN_TYPES), value: z.string().max(20000).nullable().optional() });
  app.post('/api/projects', h(async (req, res) => {
    const b = z.object({
      id: uuid.optional(),
      name: z.string().trim().min(1).max(120),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      notes: z.string().max(50000).optional(),
      fields: z.array(z.object({ fieldId: uuid, required: z.boolean().optional() })).optional(),
      values: z.record(z.string(), z.string().nullable()).optional(),
      customColumns: z.array(colBody).optional(),
      hasExpenses: z.boolean().optional(),
      templateId: uuid.nullable().optional(),
      deadline: isoDate.nullable().optional(),
    }).parse(req.body);
    const teamId = req.member!.teamId;
    if (b.id) {
      const ex = await db.query(`SELECT team_id FROM ${S}.projects WHERE id=$1`, [b.id]);
      if (ex.rows[0]) { // idempotent replay from the offline outbox
        if (ex.rows[0].team_id !== teamId) throw new HttpError(409, 'id conflict');
        return res.json((await loadProjects(db, teamId, b.id))[0]);
      }
    }
    const id = await db.tx(async (q) => {
      const all = await listFields(q);
      const { rows } = await q.query(
        `INSERT INTO ${S}.projects(id, team_id, name, color, notes, has_expenses, sort_order)
         VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(sort_order),0)+1 FROM ${S}.projects WHERE team_id=$2)) RETURNING id`,
        [b.id ?? null, teamId, b.name, b.color ?? '#14b8a6', b.notes ?? '', !!b.hasExpenses]);
      const pid = rows[0].id;
      const core = all.find((f) => f.isCore)!;
      const chosen: { fieldId: string; required?: boolean }[] = b.fields ?? all.filter((f) => !f.archived).map((f) => ({ fieldId: f.id, required: false }));
      if (!chosen.some((c) => c.fieldId === core.id)) chosen.unshift({ fieldId: core.id, required: true });
      for (const c of chosen) {
        const f = all.find((x) => x.id === c.fieldId);
        if (!f) throw new HttpError(400, `Unknown field ${c.fieldId}`);
        await q.query(`INSERT INTO ${S}.project_fields(project_id, field_id, required, sort_order) VALUES ($1,$2,$3,$4)`,
          [pid, f.id, f.isCore || !!c.required, f.sortOrder]);
      }
      const ts = new Date();
      for (const [fid, v] of Object.entries(b.values ?? {})) if (fid !== core.id) await setValue(q, req, pid, fid, v, ts);
      for (const c of chosen) {
        const f = all.find((x) => x.id === c.fieldId)!;
        if (c.required && !f.isCore && !(b.values?.[f.id] ?? '').trim()) throw new HttpError(400, `${f.label} is required`);
      }
      for (const [i, c] of (b.customColumns ?? []).entries())
        await q.query(`INSERT INTO ${S}.project_custom_columns(project_id,label,data_type,value,sort_order) VALUES ($1,$2,$3,$4,$5)`,
          [pid, c.label, c.dataType, c.value ?? null, i + 1]);
      if (b.deadline) await q.query(`UPDATE ${S}.projects SET deadline=$2 WHERE id=$1`, [pid, b.deadline]);
      if (b.templateId) await insertTemplateTasks(q, req, pid, b.templateId);
      return pid;
    });
    changed(req, 'project', id);
    res.status(201).json((await loadProjects(db, teamId, id))[0]);
  }));
  app.patch('/api/projects/:id', h(async (req, res) => {
    const b = z.object({
      name: z.string().trim().min(1).max(120).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      sortOrder: z.number().int().optional(),
      notes: z.string().max(50000).optional(),
      values: z.record(z.string(), z.string().nullable()).optional(),
      hasExpenses: z.boolean().optional(),
      reimburseNote: z.string().max(20000).optional(),
      deadline: isoDate.nullable().optional(),
      updatedAt: z.string().optional(),
    }).parse(req.body);
    const p = await projectOf(db, req, req.params.id as string);
    const ts = clientTs(b.updatedAt);
    await db.tx(async (q) => {
      if (b.name || b.color || b.sortOrder != null)
        await q.query(`UPDATE ${S}.projects SET name=COALESCE($2,name), color=COALESCE($3,color), sort_order=COALESCE($4,sort_order), updated_at=$5 WHERE id=$1 AND updated_at <= $5`,
          [p.id, b.name ?? null, b.color ?? null, b.sortOrder ?? null, ts]);
      if (b.notes != null)
        await q.query(`UPDATE ${S}.projects SET notes=$2, notes_updated_at=$3 WHERE id=$1 AND notes_updated_at <= $3`, [p.id, b.notes, ts]);
      for (const [fid, v] of Object.entries(b.values ?? {})) await setValue(q, req, p.id, fid, v, ts);
      if (b.hasExpenses != null) await q.query(`UPDATE ${S}.projects SET has_expenses=$2 WHERE id=$1`, [p.id, b.hasExpenses]);
      if (b.deadline !== undefined) await q.query(`UPDATE ${S}.projects SET deadline=$2 WHERE id=$1`, [p.id, b.deadline]);
      if (b.reimburseNote != null) await q.query(`UPDATE ${S}.projects SET reimburse_note=$2 WHERE id=$1`, [p.id, b.reimburseNote]);
    });
    changed(req, 'project', p.id);
    res.json((await loadProjects(db, req.member!.teamId, p.id))[0]);
  }));
  app.delete('/api/projects/:id', h(async (req, res) => {
    const p = await projectOf(db, req, req.params.id as string);
    await db.query(`DELETE FROM ${S}.projects WHERE id=$1`, [p.id]);
    changed(req, 'project', p.id);
    res.json({ ok: true });
  }));
  /** "Input field": attach a master field to the project (optionally with a value). */
  app.post('/api/projects/:id/fields', h(async (req, res) => {
    const b = z.object({ fieldId: uuid, required: z.boolean().optional(), value: z.string().nullable().optional() }).parse(req.body);
    const p = await projectOf(db, req, req.params.id as string);
    await db.tx(async (q) => {
      const f = (await q.query(`SELECT * FROM ${S}.field_definitions WHERE id=$1 AND NOT archived`, [b.fieldId])).rows[0];
      if (!f) throw new HttpError(400, 'Unknown or archived field');
      await q.query(`INSERT INTO ${S}.project_fields(project_id, field_id, required, sort_order) VALUES ($1,$2,$3,$4)
                     ON CONFLICT (project_id, field_id) DO UPDATE SET required=EXCLUDED.required`, [p.id, f.id, !!b.required || f.is_core, f.sort_order]);
      if (b.value !== undefined) await setValue(q, req, p.id, f.id, b.value, new Date());
    });
    changed(req, 'project', p.id);
    res.json((await loadProjects(db, req.member!.teamId, p.id))[0]);
  }));
  app.delete('/api/projects/:id/fields/:fieldId', h(async (req, res) => {
    const p = await projectOf(db, req, req.params.id as string);
    const f = (await db.query(`SELECT is_core FROM ${S}.field_definitions WHERE id=$1`, [req.params.fieldId])).rows[0];
    if (f?.is_core) throw new HttpError(400, 'Project name is always on');
    await db.query(`DELETE FROM ${S}.project_fields WHERE project_id=$1 AND field_id=$2`, [p.id, req.params.fieldId]);
    await db.query(`DELETE FROM ${S}.project_field_values WHERE project_id=$1 AND field_id=$2`, [p.id, req.params.fieldId]);
    changed(req, 'project', p.id);
    res.json({ ok: true });
  }));
  app.get('/api/projects/:id/secret/:fieldId', h(async (req, res) => {
    admin(req);
    const p = await projectOf(db, req, req.params.id as string);
    try { res.json({ value: await revealSecret(db, p.id, req.params.fieldId as string) }); }
    catch { throw new HttpError(500, 'Cannot decrypt — APP_ENCRYPTION_KEY differs from the one used to store this value'); }
  }));

  // custom (free-form) columns
  app.post('/api/projects/:id/columns', h(async (req, res) => {
    const b = colBody.parse(req.body);
    const p = await projectOf(db, req, req.params.id as string);
    const { rows } = await db.query(
      `INSERT INTO ${S}.project_custom_columns(id, project_id, label, data_type, value, sort_order)
       VALUES (COALESCE($1, gen_random_uuid()), $2,$3,$4,$5,(SELECT COALESCE(MAX(sort_order),0)+1 FROM ${S}.project_custom_columns WHERE project_id=$2))
       ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id RETURNING *`, [b.id ?? null, p.id, b.label, b.dataType, b.value ?? null]);
    changed(req, 'column', rows[0].id);
    res.status(201).json(mapColumn(rows[0]));
  }));
  app.patch('/api/columns/:id', h(async (req, res) => {
    const b = z.object({ label: z.string().min(1).max(80).optional(), value: z.string().max(20000).nullable().optional(), sortOrder: z.number().int().optional(), updatedAt: z.string().optional() }).parse(req.body);
    const c = await columnOf(db, req, req.params.id as string);
    const ts = clientTs(b.updatedAt);
    await db.query(
      `UPDATE ${S}.project_custom_columns SET label=COALESCE($2,label), value=CASE WHEN $5 THEN $3 ELSE value END, sort_order=COALESCE($4,sort_order), updated_at=$6
       WHERE id=$1 AND updated_at <= $6`, [c.id, b.label ?? null, b.value ?? null, b.sortOrder ?? null, b.value !== undefined, ts]);
    changed(req, 'column', c.id);
    res.json(mapColumn((await db.query(`SELECT * FROM ${S}.project_custom_columns WHERE id=$1`, [c.id])).rows[0]));
  }));
  app.delete('/api/columns/:id', h(async (req, res) => {
    const c = await columnOf(db, req, req.params.id as string);
    await db.query(`DELETE FROM ${S}.project_custom_columns WHERE id=$1`, [c.id]);
    changed(req, 'column', c.id);
    res.json({ ok: true });
  }));
  /** Promote a free-form column to a master field: creates (or reuses by key) the definition, moves the value. */
  app.post('/api/columns/:id/promote', h(async (req, res) => {
    admin(req);
    const c = await columnOf(db, req, req.params.id as string);
    const key = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).optional() }).parse(req.body ?? {}).key ?? slugKey(c.label);
    const field = await db.tx(async (q) => {
      let f = (await q.query(`SELECT * FROM ${S}.field_definitions WHERE key=$1`, [key])).rows[0];
      if (!f) {
        f = (await q.query(
          `INSERT INTO ${S}.field_definitions(key,label,data_type,options,sort_order)
           VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order),0)+1 FROM ${S}.field_definitions)) RETURNING *`,
          [key, c.label, c.data_type, JSON.stringify(c.data_type === 'currency' ? { currency: 'IDR' } : {})])).rows[0];
      }
      await q.query(`INSERT INTO ${S}.project_fields(project_id, field_id, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [c.project_id, f.id, f.sort_order]);
      if (c.value != null) await q.query(
        `INSERT INTO ${S}.project_field_values(project_id, field_id, value) VALUES ($1,$2,$3)
         ON CONFLICT (project_id, field_id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [c.project_id, f.id, f.is_secret ? encryptSecret(c.value) : c.value]);
      await q.query(`DELETE FROM ${S}.project_custom_columns WHERE id=$1`, [c.id]);
      return f;
    });
    changed(req, 'field', field.id, true);
    res.json({ field: mapField(field), project: (await loadProjects(db, req.member!.teamId, c.project_id))[0] });
  }));

  // tasks
  app.post('/api/projects/:id/tasks', h(async (req, res) => {
    const b = z.object({
      id: uuid.optional(), title: z.string().trim().min(1).max(300), dueDate: isoDate.nullable().optional(),
      bicMemberId: uuid.nullable().optional(), notes: z.string().max(5000).optional(), updatedAt: z.string().optional(),
      hasExpense: z.boolean().optional(), expenseAmount: amount.nullable().optional(), expenseCurrency: currency.nullable().optional(),
      taskType: z.enum(TASK_TYPES).default('standard'), platform: z.string().max(40).optional(),
    }).parse(req.body);
    const p = await projectOf(db, req, req.params.id as string);
    await assertMember(db, req, b.bicMemberId);
    const ts = clientTs(b.updatedAt);
    const has = !!b.hasExpense && b.expenseAmount != null;
    const cur = has ? b.expenseCurrency ?? await teamCurrency(db, req) : null;
    const { rows } = await db.query(
      `INSERT INTO ${S}.tasks(id, project_id, title, due_date, bic_member_id, created_by_member_id, notes, has_expense, expense_amount, expense_currency, task_type, sort_order, created_at, updated_at)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $8, $9, $10, $11, $12, (SELECT COALESCE(MAX(sort_order),0)+1 FROM ${S}.tasks WHERE project_id=$2), $7, $7)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [b.id ?? null, p.id, b.title, b.dueDate ?? null, b.bicMemberId ?? null, req.member!.id, ts, b.notes ?? '', has, has ? b.expenseAmount : null, cur, b.taskType]);
    if (rows[0]) await applySetup(req.member!.teamId, rows[0].id, rows[0].title, req.member!.id);
    if (rows[0] && b.taskType === 'social') {
      for (const [i, f] of SOCIAL_FIELDS.entries())
        await db.query(`INSERT INTO ${S}.task_fields(task_id, section, label, type, options, value, sort_order) VALUES ($1,'fields',$2,$3,$4,$5,$6)`,
          [rows[0].id, f.label, f.type, JSON.stringify(f.options ?? {}), f.label === 'Platform' && b.platform && SOCIAL_PLATFORMS.includes(b.platform) ? b.platform : null, i + 1]);
    }
    if (rows[0]?.has_expense) {
      await syncTaskExpense(db, rows[0], req.member!.id);
      if (!p.has_expenses) await db.query(`UPDATE ${S}.projects SET has_expenses=true WHERE id=$1`, [p.id]);
    }
    const row = rows[0] ?? (await taskOf(db, req, b.id!)); // replayed create
    changed(req, 'task', row.id);
    res.status(rows[0] ? 201 : 200).json(mapTask(row));
  }));
  app.patch('/api/tasks/:id', h(async (req, res) => {
    const b = z.object({
      title: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional(), dueDate: isoDate.nullable().optional(),
      bicMemberId: uuid.nullable().optional(), sortOrder: z.number().int().optional(), notes: z.string().max(5000).optional(),
      hasExpense: z.boolean().optional(), expenseAmount: amount.nullable().optional(), expenseCurrency: currency.nullable().optional(),
      doneNote: z.string().max(20000).optional(),
      updatedAt: z.string().optional(),
    }).parse(req.body);
    const t = await taskOf(db, req, req.params.id as string);
    if (b.bicMemberId) await assertMember(db, req, b.bicMemberId);
    const ts = clientTs(b.updatedAt);
    const sets: string[] = []; const params: unknown[] = [t.id, ts];
    const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col}=$${params.length}`); };
    if (b.title !== undefined) set('title', b.title);
    if (b.dueDate !== undefined) set('due_date', b.dueDate);
    if (b.sortOrder !== undefined) set('sort_order', b.sortOrder);
    if (b.notes !== undefined) set('notes', b.notes);
    if (b.doneNote !== undefined) set('done_note', b.doneNote);
    if (b.bicMemberId !== undefined) set('bic_member_id', b.bicMemberId);
    if (b.hasExpense !== undefined) set('has_expense', b.hasExpense);
    if (b.expenseAmount !== undefined) set('expense_amount', b.expenseAmount);
    if (b.expenseCurrency !== undefined) set('expense_currency', b.expenseCurrency);
    else if (b.hasExpense && !t.expense_currency) set('expense_currency', await teamCurrency(db, req));
    if (b.done !== undefined && b.done !== t.done) {
      set('done', b.done);
      if (b.done) {
        // Checking auto-approves: the checker (from the auth token, never the request body) becomes approver + BIC.
        set('done_at', ts); set('approved_by_member_id', req.member!.id); set('approved_at', ts);
        if (b.bicMemberId === undefined) set('bic_member_id', req.member!.id);
      } else {
        set('done_at', null); set('approved_by_member_id', null); set('approved_at', null);
      }
    }
    let row = t, applied = false;
    if (sets.length) {
      const r = await db.query(`UPDATE ${S}.tasks SET ${sets.join(', ')}, updated_at=$2 WHERE id=$1 AND updated_at <= $2 RETURNING *`, params);
      if (r.rows[0]) { row = r.rows[0]; applied = true; } else row = await taskOf(db, req, t.id); // a newer write won (LWW)
    }
    if (applied && (b.hasExpense !== undefined || b.expenseAmount !== undefined || b.expenseCurrency !== undefined || b.title !== undefined)) {
      if (row.has_expense || b.hasExpense === false) await syncTaskExpense(db, row, req.member!.id);
      if (row.has_expense) await db.query(`UPDATE ${S}.projects SET has_expenses=true WHERE id=$1 AND NOT has_expenses`, [row.project_id]);
    }
    if (applied) changed(req, 'task', t.id);
    res.json({ ...mapTask(row), applied });
  }));
  app.delete('/api/tasks/:id', h(async (req, res) => {
    const t = await taskOf(db, req, req.params.id as string);
    await db.query(`DELETE FROM ${S}.tasks WHERE id=$1`, [t.id]);
    changed(req, 'task', t.id);
    res.json({ ok: true });
  }));

  // ---------- v6: typed task fields, files, task reimbursement, task details ----------
  async function taskFieldOf(q: Queryable, req: Req, id: string) {
    const { rows } = await q.query(
      `SELECT f.* FROM ${S}.task_fields f JOIN ${S}.tasks t ON t.id=f.task_id JOIN ${S}.projects p ON p.id=t.project_id WHERE f.id=$1 AND p.team_id=$2`,
      [id, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(404, 'Field not found');
    return rows[0];
  }
  function fieldValue(type: string, raw: string | null | undefined, options: any): string | null {
    if (raw == null) return null;
    const v = String(raw).trim();
    if (v === '') return null;
    const bad = (m: string) => { throw new HttpError(400, m); };
    switch (type) {
      case 'email': if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) bad('Invalid email'); break;
      case 'url': if (!/^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(v)) bad('Invalid URL'); break;
      case 'number': if (isNaN(Number(v.replace(/[, ]/g, '')))) bad('Must be a number'); break;
      case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) bad('Date must be YYYY-MM-DD'); break;
      case 'dropdown': if (options?.choices?.length && !options.choices.includes(v)) bad('Not one of the options'); break;
      case 'amount': { const m = /^(\d+(?:\.\d+)?)\s+([A-Z]{2,5})$/.exec(v); if (!m || !(CURRENCY_CODES as readonly string[]).includes(m[2])) bad('Amount must be "<number> <CURRENCY>"'); break; }
      case 'password': return encryptSecret(v);
    }
    return v;
  }
  const fieldBodyV6 = z.object({
    id: uuid.optional(), label: z.string().trim().min(1).max(80), type: z.enum(TASK_FIELD_TYPES), section: z.enum(['fields', 'reimbursement']).default('fields'),
    options: z.object({ choices: z.array(z.string().min(1)).max(50).optional(), currency: z.string().optional() }).default({}),
    value: z.string().max(20000).nullable().optional(),
  });
  app.post('/api/tasks/:id/fields', h(async (req, res) => {
    const b = fieldBodyV6.parse(req.body);
    if (b.section !== 'reimbursement') admin(req); // detail field structure is admin setup; reimbursement rows are open to members
    const t = await taskOf(db, req, req.params.id as string);
    const { rows } = await db.query(
      `INSERT INTO ${S}.task_fields(id, task_id, section, label, type, options, value, sort_order)
       VALUES (COALESCE($1, gen_random_uuid()),$2,$3,$4,$5,$6,$7,(SELECT COALESCE(MAX(sort_order),0)+1 FROM ${S}.task_fields WHERE task_id=$2))
       ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id RETURNING *`,
      [b.id ?? null, t.id, b.section, b.label, b.type, JSON.stringify(b.options), fieldValue(b.type, b.value, b.options)]);
    changed(req, 'task', t.id);
    res.status(201).json(mapTaskField(rows[0]));
  }));
  app.patch('/api/task-fields/:id', h(async (req, res) => {
    const b = z.object({ label: z.string().trim().min(1).max(80).optional(), value: z.string().max(20000).nullable().optional(),
      options: z.object({ choices: z.array(z.string().min(1)).max(50).optional(), currency: z.string().optional() }).optional() }).parse(req.body);
    const f = await taskFieldOf(db, req, req.params.id as string);
    if ((b.label !== undefined || b.options !== undefined) && req.member!.role !== 'admin') throw new HttpError(403, 'Only an admin can change the task setup');
    const opts = b.options ?? f.options;
    const { rows } = await db.query(
      `UPDATE ${S}.task_fields SET label=COALESCE($2,label), options=$3, value=CASE WHEN $5 THEN $4 ELSE value END, updated_at=now() WHERE id=$1 RETURNING *`,
      [f.id, b.label ?? null, JSON.stringify(opts), b.value === undefined ? null : fieldValue(f.type, b.value, opts), b.value !== undefined]);
    if (f.section === 'reimbursement' && f.type === 'amount' && b.value !== undefined) await syncAmountField(f.task_id, rows[0].value, req.member!.id);
    changed(req, 'task', f.task_id);
    res.json(mapTaskField(rows[0]));
  }));
  app.delete('/api/task-fields/:id', h(async (req, res) => {
    const f = await taskFieldOf(db, req, req.params.id as string);
    if (f.section !== 'reimbursement') admin(req);
    await db.query(`DELETE FROM ${S}.task_fields WHERE id=$1`, [f.id]);
    changed(req, 'task', f.task_id);
    res.json({ ok: true });
  }));
  /** Reveal a password field (any member of the team; the value is encrypted at rest). */
  app.get('/api/task-fields/:id/reveal', h(async (req, res) => {
    const f = await taskFieldOf(db, req, req.params.id as string);
    if (f.type !== 'password') return res.json({ value: f.value });
    try { res.json({ value: f.value ? decryptSecret(f.value) : null }); }
    catch { throw new HttpError(500, 'Cannot decrypt — APP_ENCRYPTION_KEY differs from the one used to store this value'); }
  }));

  // files: raw body upload, max ~10 MB, stored as bytea
  app.post('/api/tasks/:id/files', express.raw({ type: () => true, limit: MAX_FILE_BYTES + 1024 }), h(async (req, res) => {
    const t = await taskOf(db, req, req.params.id as string);
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || !data.length) throw new HttpError(400, 'Empty file');
    if (data.length > MAX_FILE_BYTES) throw new HttpError(413, 'File too large (max 10 MB)');
    const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'file')).replace(/[\\/\r\n]/g, '_').slice(0, 200) || 'file';
    const fieldId = req.headers['x-field-id'] ? String(req.headers['x-field-id']) : null;
    if (fieldId) { const f = await taskFieldOf(db, req, fieldId); if (f.task_id !== t.id) throw new HttpError(400, 'Field belongs to another task'); }
    const { rows } = await db.query(
      `INSERT INTO ${S}.task_files(task_id, field_id, name, mime, size, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, task_id, field_id, name, mime, size, uploaded_by, created_at`,
      [t.id, fieldId, name, String(req.headers['x-mime'] ?? req.headers['content-type'] ?? 'application/octet-stream').slice(0, 120), data.length, data, req.member!.id]);
    if (fieldId) await db.query(`UPDATE ${S}.task_fields SET value=$2, updated_at=now() WHERE id=$1`, [fieldId, name]);
    changed(req, 'task', t.id);
    res.status(201).json(mapTaskFile(rows[0]));
  }));
  async function fileOf(req: Req, id: string) {
    const { rows } = await db.query(
      `SELECT f.* FROM ${S}.task_files f JOIN ${S}.tasks t ON t.id=f.task_id JOIN ${S}.projects p ON p.id=t.project_id WHERE f.id=$1 AND p.team_id=$2`,
      [id, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(404, 'File not found');
    return rows[0];
  }
  app.get('/api/files/:id', h(async (req, res) => {
    const f = await fileOf(req, req.params.id as string);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.send(f.data);
  }));
  app.delete('/api/files/:id', h(async (req, res) => {
    const f = await fileOf(req, req.params.id as string);
    await db.query(`DELETE FROM ${S}.task_files WHERE id=$1`, [f.id]);
    changed(req, 'task', f.task_id);
    res.json({ ok: true });
  }));

  /** Per-task "Has reimbursement": PUT upserts the task's reimbursement entry, DELETE turns it off. */
  app.put('/api/tasks/:id/reimbursement', h(async (req, res) => {
    const b = z.object({ item: z.string().trim().min(1).max(200), category: z.enum(REIMB_CATEGORIES as [string, ...string[]]).default('Other'), amount, currency: currency.optional() }).parse(req.body);
    const t = await taskOf(db, req, req.params.id as string);
    const cur = b.currency ?? req.member!.currency ?? await teamCurrency(db, req);
    await db.query(`UPDATE ${S}.tasks SET has_expense=true, expense_amount=$2, expense_currency=$3, updated_at=now() WHERE id=$1`, [t.id, b.amount, cur]);
    const { rows } = await db.query(
      `INSERT INTO ${S}.reimbursements(project_id, task_id, item, category, amount, currency, paid_by_member_id, spent_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE)
       ON CONFLICT (task_id) DO UPDATE SET item=EXCLUDED.item, category=EXCLUDED.category, amount=EXCLUDED.amount, currency=EXCLUDED.currency, updated_at=now()
       RETURNING *`, [t.project_id, t.id, b.item, b.category, b.amount, cur, req.member!.id]);
    await db.query(`UPDATE ${S}.projects SET has_expenses=true WHERE id=$1 AND NOT has_expenses`, [t.project_id]);
    changed(req, 'reimbursement', rows[0].id);
    res.json(mapReimbursement(rows[0]));
  }));
  app.delete('/api/tasks/:id/reimbursement', h(async (req, res) => {
    const t = await taskOf(db, req, req.params.id as string);
    await db.query(`UPDATE ${S}.tasks SET has_expense=false, expense_amount=NULL, updated_at=now() WHERE id=$1`, [t.id]);
    await db.query(`DELETE FROM ${S}.reimbursements WHERE task_id=$1 AND status <> 'paid'`, [t.id]);
    await db.query(`DELETE FROM ${S}.task_fields WHERE task_id=$1 AND section='reimbursement'`, [t.id]);
    changed(req, 'reimbursement', t.id);
    res.json({ ok: true });
  }));

  // ---------- admin task setup (keyed by task name, reused across projects/templates) ----------
  const setupField = z.object({ label: z.string().trim().min(1).max(80), type: z.enum(TASK_FIELD_TYPES),
    options: z.object({ choices: z.array(z.string().min(1)).max(50).optional() }).default({}), reimbursement: z.boolean().default(false) });
  const titleKey = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
  async function applySetup(teamId: string, taskId: string, title: string, memberId: string) {
    const { rows: [st] } = await db.query(`SELECT * FROM ${S}.task_setups WHERE team_id=$1 AND title_key=$2`, [teamId, titleKey(title)]);
    if (!st) return false;
    const have = new Set((await db.query(`SELECT section||'|'||lower(label) k FROM ${S}.task_fields WHERE task_id=$1`, [taskId])).rows.map((r: any) => r.k));
    let reimb = false;
    for (const [i, f] of (st.fields as z.infer<typeof setupField>[]).entries()) {
      const section = f.reimbursement ? 'reimbursement' : 'fields'; if (f.reimbursement) reimb = true;
      if (have.has(section + '|' + f.label.toLowerCase())) continue;
      await db.query(`INSERT INTO ${S}.task_fields(task_id, section, label, type, options, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
        [taskId, section, f.label, f.type, JSON.stringify(f.options ?? {}), i + 1]);
    }
    if (reimb) {
      const { rows: [t] } = await db.query(`UPDATE ${S}.tasks SET has_expense=true, expense_currency=COALESCE(expense_currency,$2), updated_at=now() WHERE id=$1 RETURNING *`, [taskId, (await db.query(`SELECT currency FROM ${S}.teams WHERE id=$1`, [teamId])).rows[0]?.currency ?? 'SOL']);
      await db.query(`INSERT INTO ${S}.reimbursements(project_id, task_id, item, category, amount, currency, paid_by_member_id, spent_on) VALUES ($1,$2,$3,'Other',COALESCE($4,0),$5,$6,CURRENT_DATE) ON CONFLICT (task_id) DO NOTHING`,
        [t.project_id, t.id, t.title, t.expense_amount, t.expense_currency, memberId]);
      await db.query(`UPDATE ${S}.projects SET has_expenses=true WHERE id=$1 AND NOT has_expenses`, [t.project_id]);
    }
    return true;
  }
  /** A reimbursement-flagged Amount field drives the task's reimbursement entry. */
  async function syncAmountField(taskId: string, value: string | null, memberId: string) {
    const m = /^(\d+(?:\.\d+)?)\s+([A-Z]{2,5})$/.exec(value ?? ''); if (!m) return;
    const { rows: [t] } = await db.query(`UPDATE ${S}.tasks SET has_expense=true, expense_amount=$2, expense_currency=$3, updated_at=now() WHERE id=$1 RETURNING *`, [taskId, Number(m[1]), m[2]]);
    await db.query(`INSERT INTO ${S}.reimbursements(project_id, task_id, item, category, amount, currency, paid_by_member_id, spent_on) VALUES ($1,$2,$3,'Other',$4,$5,$6,CURRENT_DATE)
      ON CONFLICT (task_id) DO UPDATE SET amount=EXCLUDED.amount, currency=EXCLUDED.currency, paid_by_member_id=EXCLUDED.paid_by_member_id, updated_at=now()`, [t.project_id, t.id, t.title, Number(m[1]), m[2], memberId]);
  }
  const mapSetup = (r: any) => ({ id: r.id, title: r.title, fields: r.fields, updatedAt: new Date(r.updated_at).toISOString() });
  app.get('/api/task-setups', h(async (req, res) => {
    res.json((await db.query(`SELECT * FROM ${S}.task_setups WHERE team_id=$1 ORDER BY title`, [req.member!.teamId])).rows.map(mapSetup));
  }));
  app.put('/api/task-setups', h(async (req, res) => {
    admin(req);
    const b = z.object({ title: z.string().trim().min(1).max(300), fields: z.array(setupField).max(40) }).parse(req.body);
    const { rows: [st] } = await db.query(`INSERT INTO ${S}.task_setups(team_id, title, title_key, fields) VALUES ($1,$2,$3,$4)
      ON CONFLICT (team_id, title_key) DO UPDATE SET title=EXCLUDED.title, fields=EXCLUDED.fields, updated_at=now() RETURNING *`,
      [req.member!.teamId, b.title, titleKey(b.title), JSON.stringify(b.fields)]);
    // apply to existing tasks with this name (adds missing fields; never deletes filled values)
    const { rows: ts } = await db.query(`SELECT t.id, t.title FROM ${S}.tasks t JOIN ${S}.projects p ON p.id=t.project_id WHERE p.team_id=$1 AND lower(regexp_replace(trim(t.title), '\s+', ' ', 'g'))=$2`,
      [req.member!.teamId, titleKey(b.title)]);
    for (const t of ts) await applySetup(req.member!.teamId, t.id, t.title, req.member!.id);
    changed(req, 'task', st.id);
    res.json({ ...mapSetup(st), appliedTo: ts.length });
  }));
  app.delete('/api/task-setups/:id', h(async (req, res) => {
    admin(req);
    await db.query(`DELETE FROM ${S}.task_setups WHERE id=$1 AND team_id=$2`, [req.params.id, req.member!.teamId]);
    res.json({ ok: true });
  }));

  /** Task details tab: one card per approved task (fields, files, reimbursement); pending tasks counted. */
  app.get('/api/projects/:id/task-details', h(async (req, res) => {
    const p = await projectOf(db, req, req.params.id as string);
    const { rows } = await db.query(`SELECT * FROM ${S}.tasks WHERE project_id=$1 ORDER BY approved_at DESC NULLS LAST, sort_order`, [p.id]);
    const [fields, files, reimbs] = await Promise.all([listTaskFields(db, req.member!.teamId), listTaskFiles(db, req.member!.teamId), listReimbursements(db, req.member!.teamId)]);
    const out: TaskDetailsResponse = {
      approved: rows.filter((t: any) => t.done).map((t: any) => ({
        task: mapTask(t), fields: fields.filter((f) => f.taskId === t.id), files: files.filter((f) => f.taskId === t.id),
        reimbursement: reimbs.find((r) => r.taskId === t.id) ?? null,
      })),
      pendingCount: rows.filter((t: any) => !t.done).length,
    };
    res.json(out);
  }));

  // ---------- v5: reimbursements ----------
  async function reimbOf(q: Queryable, req: Req, id: string) {
    const { rows } = await q.query(
      `SELECT r.* FROM ${S}.reimbursements r JOIN ${S}.projects p ON p.id=r.project_id WHERE r.id=$1 AND p.team_id=$2`, [id, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(404, 'Reimbursement not found');
    return rows[0];
  }
  const reimbBody = z.object({
    id: uuid.optional(), item: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(40).default('Other'),
    amount, currency: currency.optional(), spentOn: isoDate.nullable().optional(), note: z.string().max(20000).optional(),
    receiptName: z.string().max(200).nullable().optional(), paidByMemberId: uuid.nullable().optional(),
  });
  app.get('/api/reimbursements', h(async (req, res) => { res.json(await listReimbursements(db, req.member!.teamId)); }));
  app.post('/api/projects/:id/reimbursements', h(async (req, res) => {
    const b = reimbBody.parse(req.body);
    const p = await projectOf(db, req, req.params.id as string);
    const paidBy = b.paidByMemberId ?? req.member!.id;
    await assertMember(db, req, paidBy);
    const { rows } = await db.query(
      `INSERT INTO ${S}.reimbursements(id, project_id, item, category, amount, currency, paid_by_member_id, spent_on, note, receipt_name)
       VALUES (COALESCE($1, gen_random_uuid()),$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$9,$10)
       ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id RETURNING *`,
      [b.id ?? null, p.id, b.item, b.category, b.amount, b.currency ?? await teamCurrency(db, req), paidBy, b.spentOn ?? null, b.note ?? '', b.receiptName ?? null]);
    if (!p.has_expenses) await db.query(`UPDATE ${S}.projects SET has_expenses=true WHERE id=$1`, [p.id]);
    changed(req, 'reimbursement', rows[0].id);
    res.status(201).json(mapReimbursement(rows[0]));
  }));
  app.patch('/api/reimbursements/:id', h(async (req, res) => {
    const b = reimbBody.partial().extend({ status: z.enum(REIMBURSE_STATUSES).optional(), reimbursed: z.boolean().optional() }).parse(req.body);
    const r = await reimbOf(db, req, req.params.id as string);
    let status = b.status ?? (b.reimbursed === undefined ? undefined : b.reimbursed ? 'paid' : 'pending');
    if (status !== undefined) admin(req); // only admins approve / tick as reimbursed
    if (r.status === 'paid' && req.member!.role !== 'admin') throw new HttpError(403, 'Already reimbursed — only an admin can change it');
    if (b.paidByMemberId) await assertMember(db, req, b.paidByMemberId);
    const { rows } = await db.query(
      `UPDATE ${S}.reimbursements SET item=COALESCE($2,item), category=COALESCE($3,category), amount=COALESCE($4,amount), currency=COALESCE($5,currency),
         spent_on=COALESCE($6::date,spent_on), note=COALESCE($7,note), receipt_name=COALESCE($8,receipt_name), paid_by_member_id=COALESCE($9,paid_by_member_id),
         status=COALESCE($10,status),
         reimbursed_at=CASE WHEN $10='paid' THEN COALESCE(reimbursed_at, now()) WHEN $10 IS NULL THEN reimbursed_at ELSE NULL END,
         reimbursed_by=CASE WHEN $10='paid' THEN $11::uuid WHEN $10 IS NULL THEN reimbursed_by ELSE NULL END,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [r.id, b.item ?? null, b.category ?? null, b.amount ?? null, b.currency ?? null, b.spentOn ?? null, b.note ?? null, b.receiptName ?? null,
        b.paidByMemberId ?? null, status ?? null, req.member!.id]);
    changed(req, 'reimbursement', r.id);
    res.json(mapReimbursement(rows[0]));
  }));
  app.delete('/api/reimbursements/:id', h(async (req, res) => {
    const r = await reimbOf(db, req, req.params.id as string);
    if (r.status === 'paid') admin(req);
    await db.query(`DELETE FROM ${S}.reimbursements WHERE id=$1`, [r.id]);
    if (r.task_id) await db.query(`UPDATE ${S}.tasks SET has_expense=false, updated_at=now() WHERE id=$1`, [r.task_id]);
    changed(req, 'reimbursement', r.id);
    res.json({ ok: true });
  }));

  // ---------- v5: templates ----------
  const tplTask = z.object({ title: z.string().trim().min(1).max(300), expenseAmount: amount.nullable().optional(), expenseCurrency: currency.nullable().optional() });
  app.get('/api/templates', h(async (req, res) => { res.json(await listTemplates(db, req.member!)); }));
  app.post('/api/templates', h(async (req, res) => {
    const b = z.object({
      name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), icon: z.string().max(20).optional(),
      shared: z.boolean().default(true), tasks: z.array(tplTask).max(500).optional(), fromProjectId: uuid.optional(),
    }).parse(req.body);
    let tasks = b.tasks ?? [];
    if (b.fromProjectId) {
      const p = await projectOf(db, req, b.fromProjectId);
      const { rows } = await db.query(`SELECT * FROM ${S}.tasks WHERE project_id=$1 ORDER BY sort_order, created_at`, [p.id]);
      tasks = rows.map((t: any) => ({ title: t.title, expenseAmount: t.has_expense && t.expense_amount != null ? Number(t.expense_amount) : null, expenseCurrency: t.has_expense ? t.expense_currency : null }));
    }
    const { rows } = await db.query(
      `INSERT INTO ${S}.templates(team_id, owner_member_id, name, description, icon, shared, tasks) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.member!.teamId, req.member!.id, b.name, b.description ?? '', b.icon ?? 'list', b.shared, JSON.stringify(tasks)]);
    changed(req, 'template', rows[0].id);
    res.status(201).json(mapTemplate(rows[0]));
  }));
  app.delete('/api/templates/:id', h(async (req, res) => {
    const { rows } = await db.query(`SELECT * FROM ${S}.templates WHERE id=$1 AND team_id=$2`, [req.params.id, req.member!.teamId]);
    if (!rows[0]) throw new HttpError(404, 'Template not found');
    if (rows[0].owner_member_id !== req.member!.id) admin(req);
    await db.query(`DELETE FROM ${S}.templates WHERE id=$1`, [rows[0].id]);
    changed(req, 'template', rows[0].id);
    res.json({ ok: true });
  }));
  app.post('/api/projects/:id/apply-template', h(async (req, res) => {
    const b = z.object({ templateId: uuid }).parse(req.body);
    const p = await projectOf(db, req, req.params.id as string);
    await db.tx((q) => insertTemplateTasks(q, req, p.id, b.templateId));
    changed(req, 'project', p.id);
    res.json((await loadProjects(db, req.member!.teamId, p.id))[0]);
  }));

  // ---------- v5: admin reports (expenses only) ----------
  async function buildReport(req: Req): Promise<Report> {
    admin(req);
    const qy = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), projectId: uuid.optional(), status: z.enum(['all', 'reimbursed', 'not']).default('all') }).parse(req.query);
    const cur = req.member!.currency ?? await teamCurrency(db, req);
    const pt = await prices.get();
    const projects = await loadProjects(db, req.member!.teamId);
    let items = await listReimbursements(db, req.member!.teamId);
    if (qy.month) items = items.filter((r) => (r.spentOn ?? r.createdAt).startsWith(qy.month!));
    if (qy.projectId) items = items.filter((r) => r.projectId === qy.projectId);
    if (qy.status !== 'all') items = items.filter((r) => (qy.status === 'reimbursed' ? r.reimbursed : !r.reimbursed));
    const rows = items.map((r) => ({ ...r, projectName: projects.find((p) => p.id === r.projectId)?.name ?? '', converted: convert(r.amount, r.currency, cur, pt) }));
    const sum = (xs: typeof rows) => xs.reduce((a, r) => a + (r.converted ?? 0), 0);
    const perProject = projects.filter((p) => !qy.projectId || p.id === qy.projectId).map((p) => {
      const xs = rows.filter((r) => r.projectId === p.id);
      return { projectId: p.id, name: p.name, color: p.color, total: sum(xs), count: xs.length, hasExpenses: p.hasExpenses };
    });
    return {
      currency: cur as Report['currency'], usdRate: pt.usd[cur as Report['currency']] ?? null, month: qy.month ?? null,
      total: sum(rows), reimbursed: sum(rows.filter((r) => r.reimbursed)), notReimbursed: sum(rows.filter((r) => !r.reimbursed)),
      count: rows.length, projectsWithExpenses: new Set(rows.map((r) => r.projectId)).size, perProject, items: rows,
    };
  }
  app.get('/api/reports', h(async (req, res) => { res.json(await cached(`rep|${req.member!.id}|${req.originalUrl}`, () => buildReport(req))); }));
  app.get('/api/reports/expenses.csv', h(async (req, res) => {
    const r = await buildReport(req);
    const pt = await prices.get();
    const members = (await db.query(`SELECT id, name FROM ${S}.members WHERE team_id=$1`, [req.member!.teamId])).rows;
    const esc = (v: unknown) => { const x = v == null ? '' : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const head = ['date', 'project', 'item', 'category', 'amount', 'currency', 'usd_equivalent', `amount_${r.currency.toLowerCase()}`, 'paid_by', 'status', 'reimbursed', 'reimbursed_at', 'note'];
    const lines = r.items.map((i) => [i.spentOn, i.projectName, i.item, i.category, i.amount, i.currency,
      pt.usd[i.currency] ? (i.amount * pt.usd[i.currency]!).toFixed(2) : '', i.converted ?? '',
      members.find((m: any) => m.id === i.paidByMemberId)?.name ?? '', i.status, i.reimbursed ? 'yes' : 'no', i.reimbursedAt ?? '', i.note].map(esc).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="desklist-expenses${r.month ? '-' + r.month : ''}.csv"`);
    res.send([head.join(','), ...lines].join('\n') + '\n');
  }));

  // errors
  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.expose && err.status) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'File too large (max 10 MB)' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    log('[error]', err?.message ?? err);
    res.status(500).json({ error: 'Internal error' });
  });

  const server = http.createServer(app);
  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== '/ws') return socket.destroy();
      const member = await memberFromToken(url.searchParams.get('token') ?? undefined);
      if (!member) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.set(ws, { teamId: member.teamId, memberId: member.id, alive: true });
        ws.on('pong', () => { const c = clients.get(ws); if (c) c.alive = true; });
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
        ws.send(JSON.stringify({ type: 'hello', memberId: member.id, serverTime: new Date().toISOString() } satisfies ServerEvent));
      });
    } catch { socket.destroy(); }
  });

  return {
    app, server, broadcast,
    async close() {
      clearInterval(heartbeat);
      for (const ws of clients.keys()) ws.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
