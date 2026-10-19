import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  CUSTOM_COLUMN_TYPES, FIELD_DATA_TYPES, slugKey, type Member, type ServerEvent,
} from '@desklist/shared';
import type { Db, Queryable } from './db.js';
import { codeBucket, encryptSecret, generateCode, newToken, normalizeCode, sha256 } from './crypto.js';
import { listFields, loadProjects, mapColumn, mapField, mapMember, mapTask, mapTeam, revealSecret, snapshot } from './repo.js';

const S = 'desklist';
const SESSION_DAYS = 90;

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

export interface AppOptions { db: Db; signinLimit?: number; log?: (...a: unknown[]) => void }

export function createServer(opts: AppOptions) {
  const { db } = opts;
  const log = opts.log ?? console.log;
  const limiter = new RateLimiter(opts.signinLimit ?? Number(process.env.SIGNIN_RATE_LIMIT ?? 10));
  const app = express();
  app.set('trust proxy', 1); // Railway / reverse proxies
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    // The Electron app calls from file:// or a dev server; allow any origin, auth is bearer-token.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
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
       WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT m.revoked`, [sha256(token)]);
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
    const token = newToken();
    await db.query(`INSERT INTO ${S}.sessions(member_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '${SESSION_DAYS} days')`, [found.id, sha256(token)]);
    const team = await db.query(`SELECT * FROM ${S}.teams WHERE id=$1`, [found.team_id]);
    res.json({ token, member: mapMember(found), team: mapTeam(team.rows[0]) });
  }));

  // ---------- authenticated ----------
  app.use('/api', requireAuth);

  app.post('/api/auth/signout', h(async (req, res) => {
    const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    await db.query(`DELETE FROM ${S}.sessions WHERE token_hash=$1`, [sha256(tok)]);
    res.json({ ok: true });
  }));
  app.get('/api/me', h(async (req, res) => { res.json(req.member); }));
  app.get('/api/snapshot', h(async (req, res) => { res.json(await snapshot(db, req.member!)); }));

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
  app.patch('/api/members/:id', h(async (req, res) => {
    admin(req);
    const b = z.object({ name: z.string().min(1).max(80).optional(), initials: z.string().min(1).max(3).optional(), role: z.enum(['admin', 'member']).optional() }).parse(req.body);
    const { rows } = await db.query(
      `UPDATE ${S}.members SET name=COALESCE($3,name), initials=COALESCE(upper($4),initials), role=COALESCE($5,role), updated_at=now()
       WHERE id=$1 AND team_id=$2 RETURNING *`, [req.params.id, req.member!.teamId, b.name, b.initials, b.role]);
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
        `INSERT INTO ${S}.projects(id, team_id, name, color, notes, sort_order)
         VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, (SELECT COALESCE(MAX(sort_order),0)+1 FROM ${S}.projects WHERE team_id=$2)) RETURNING id`,
        [b.id ?? null, teamId, b.name, b.color ?? '#14b8a6', b.notes ?? '']);
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
    }).parse(req.body);
    const p = await projectOf(db, req, req.params.id as string);
    await assertMember(db, req, b.bicMemberId);
    const ts = clientTs(b.updatedAt);
    const { rows } = await db.query(
      `INSERT INTO ${S}.tasks(id, project_id, title, due_date, bic_member_id, created_by_member_id, notes, sort_order, created_at, updated_at)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $8, (SELECT COALESCE(MAX(sort_order),0)+1 FROM ${S}.tasks WHERE project_id=$2), $7, $7)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [b.id ?? null, p.id, b.title, b.dueDate ?? null, b.bicMemberId ?? null, req.member!.id, ts, b.notes ?? '']);
    const row = rows[0] ?? (await taskOf(db, req, b.id!)); // replayed create
    changed(req, 'task', row.id);
    res.status(rows[0] ? 201 : 200).json(mapTask(row));
  }));
  app.patch('/api/tasks/:id', h(async (req, res) => {
    const b = z.object({
      title: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional(), dueDate: isoDate.nullable().optional(),
      bicMemberId: uuid.nullable().optional(), sortOrder: z.number().int().optional(), notes: z.string().max(5000).optional(),
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
    if (b.bicMemberId !== undefined) set('bic_member_id', b.bicMemberId);
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
    if (applied) changed(req, 'task', t.id);
    res.json({ ...mapTask(row), applied });
  }));
  app.delete('/api/tasks/:id', h(async (req, res) => {
    const t = await taskOf(db, req, req.params.id as string);
    await db.query(`DELETE FROM ${S}.tasks WHERE id=$1`, [t.id]);
    changed(req, 'task', t.id);
    res.json({ ok: true });
  }));

  // errors
  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
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
