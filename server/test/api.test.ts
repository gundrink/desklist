/**
 * Integration tests against the real database (NEON_DATABASE_URL), schema `desklist`.
 * Uses the seeded Demo Team for sign-in checks and a throw-away "TEST team" for CRUD,
 * which is deleted afterwards (demo data is not modified).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import WebSocket from 'ws';
import { createDb, type Db } from '../src/db.js';
import { createServer } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { codeBucket } from '../src/crypto.js';
import type { Snapshot } from '@desklist/shared';

process.env.APP_ENCRYPTION_KEY ||= 'test-key-only-for-local-tests-0123456789';
let db: Db; let srv: ReturnType<typeof createServer>; let base = '';
const run = crypto.randomBytes(3).toString('hex');
const testTeam = crypto.randomUUID(); const otherTeam = crypto.randomUUID();
const adminCode = `TADM-${run}`.toUpperCase(); const memberCode = `TMEM-${run}`.toUpperCase(); const otherCode = `TOTH-${run}`.toUpperCase();
let adminTok = '', memberTok = '', otherTok = '';
let adminId = '', memberId = '';

async function api(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await r.json().catch(() => null);
  return { status: r.status, body: json };
}
const signin = async (code: string, ip = '10.0.0.1') => api('POST', '/api/auth/signin', undefined, { code }, { 'x-forwarded-for': ip });

beforeAll(async () => {
  db = createDb();
  await migrate(db, () => {});
  await seed(db, () => {});
  await db.query(`INSERT INTO desklist.teams(id,name) VALUES ($1,'TEST team ${run}'), ($2,'TEST other ${run}')`, [testTeam, otherTeam]);
  const mk = async (team: string, name: string, role: string, code: string) =>
    (await db.query(`INSERT INTO desklist.members(team_id,name,initials,role,code_hash,code_bucket) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [team, name, name.slice(0, 2).toUpperCase(), role, await bcrypt.hash(code, 10), codeBucket(code)])).rows[0].id;
  adminId = await mk(testTeam, 'Test Admin', 'admin', adminCode);
  memberId = await mk(testTeam, 'Test Member', 'member', memberCode);
  await mk(otherTeam, 'Other Admin', 'admin', otherCode);
  srv = createServer({ db, signinLimit: 5, log: () => {} });
  await new Promise<void>((r) => srv.server.listen(0, r));
  base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  adminTok = (await signin(adminCode)).body.token;
  memberTok = (await signin(memberCode)).body.token;
  otherTok = (await signin(otherCode)).body.token;
});

afterAll(async () => {
  await db.query(`DELETE FROM desklist.teams WHERE id = ANY($1::uuid[])`, [[testTeam, otherTeam]]);
  await db.query(`DELETE FROM desklist.field_definitions WHERE key LIKE $1`, [`t${run}%`]);
  await srv?.close();
  await db?.close();
});

describe('auth', () => {
  it('health check reports the DB driver', async () => {
    const r = await api('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
  it('signs in with each demo code', async () => {
    for (const [code, name, role] of [['DEMO-ADMIN', 'Andi Darmawan', 'admin'], ['DEMO-0001', 'Budi Santoso', 'member'], ['demo-0002', 'Citra Kusuma', 'member']]) {
      const r = await signin(code, '10.1.0.1');
      expect(r.status, code).toBe(200);
      expect(r.body.member.name).toBe(name);
      expect(r.body.member.role).toBe(role);
      expect(r.body.team.name).toBe('Demo Team');
      expect(typeof r.body.token).toBe('string');
    }
  });
  it('rejects a wrong code and unauthenticated requests', async () => {
    expect((await signin('DEMO-9999', '10.2.0.1')).status).toBe(401);
    expect((await api('GET', '/api/snapshot')).status).toBe(401);
    expect((await api('GET', '/api/snapshot', 'not-a-token')).status).toBe(401);
  });
  it('rate limits repeated failed attempts per IP', async () => {
    for (let i = 0; i < 5; i++) expect((await signin('WRONG-' + i, '10.3.0.1')).status).toBe(401);
    expect((await signin('DEMO-ADMIN', '10.3.0.1')).status).toBe(429);
    expect((await signin('DEMO-ADMIN', '10.3.0.2')).status).toBe(200);
  });
  it('admin generates, resets and revokes member codes', async () => {
    const c = await api('POST', '/api/members', adminTok, { name: 'Dina Putri' });
    expect(c.status).toBe(201);
    expect(c.body.member.initials).toBe('DP');
    const s1 = await signin(c.body.code, '10.4.0.1');
    expect(s1.status).toBe(200);
    const reset = await api('POST', `/api/members/${c.body.member.id}/code`, adminTok);
    expect(reset.body.code).not.toBe(c.body.code);
    expect((await signin(c.body.code, '10.4.0.2')).status).toBe(401);
    expect((await api('GET', '/api/me', s1.body.token)).status).toBe(401); // old sessions dropped
    expect((await signin(reset.body.code, '10.4.0.3')).status).toBe(200);
    expect((await api('POST', `/api/members/${c.body.member.id}/revoke`, adminTok)).body.revoked).toBe(true);
    expect((await signin(reset.body.code, '10.4.0.4')).status).toBe(401);
    expect((await api('POST', '/api/members', memberTok, { name: 'Nope' })).status).toBe(403);
  });
});

describe('master fields', () => {
  it('add / edit / reorder / archive at runtime (admin only)', async () => {
    const c = await api('POST', '/api/fields', adminTok, { key: `t${run}_client`, label: 'Client tier', dataType: 'select', options: { choices: ['Gold', 'Silver'] } });
    expect(c.status).toBe(201);
    expect(c.body.key).toBe(`t${run}_client`);
    expect((await api('POST', '/api/fields', adminTok, { key: `t${run}_client`, label: 'Dup', dataType: 'text' })).status).toBe(409);
    expect((await api('POST', '/api/fields', memberTok, { label: 'x', dataType: 'text' })).status).toBe(403);
    const e = await api('PATCH', `/api/fields/${c.body.id}`, adminTok, { label: 'Client tier (edited)' });
    expect(e.body.label).toBe('Client tier (edited)');
    const all = (await api('GET', '/api/fields', adminTok)).body as any[];
    const ids = [c.body.id, ...all.filter((f) => f.id !== c.body.id && !f.archived).map((f) => f.id)];
    const re = (await api('POST', '/api/fields/reorder', adminTok, { ids })).body as any[];
    expect(re.find((f) => f.id === c.body.id).sortOrder).toBe(1);
    await api('POST', '/api/fields/reorder', adminTok, { ids: [...ids.slice(1), c.body.id] }); // put it back at the end
    expect((await api('PATCH', `/api/fields/${c.body.id}`, adminTok, { archived: true })).body.archived).toBe(true);
    const core = all.find((f) => f.key === 'project_name');
    expect((await api('PATCH', `/api/fields/${core.id}`, adminTok, { archived: true })).status).toBe(400);
  });
});

describe('projects, custom columns, tasks', () => {
  let fields: any[] = []; let projectId = '';
  const fid = (k: string) => fields.find((f) => f.key === k).id;
  beforeAll(async () => { fields = (await api('GET', '/api/fields', adminTok)).body; });

  it('creates a project with master values + custom columns, validates, encrypts secrets', async () => {
    const bad = await api('POST', '/api/projects', adminTok, { name: 'Bad', values: { [fid('email')]: 'not-an-email' } });
    expect(bad.status).toBe(400);
    const req = await api('POST', '/api/projects', adminTok, { name: 'Req', fields: [{ fieldId: fid('status'), required: true }] });
    expect(req.status).toBe(400);
    const r = await api('POST', '/api/projects', adminTok, {
      name: 'TEST Project', notes: 'hello',
      values: { [fid('status')]: 'In progress', [fid('pic_name')]: 'Rina', [fid('email')]: 'a@b.co', [fid('password')]: 's3cret!' },
      customColumns: [{ label: 'Repo link', dataType: 'url', value: 'https://github.com/o/r' }, { label: 'Budget', dataType: 'currency', value: '1000' }],
    });
    expect(r.status).toBe(201);
    projectId = r.body.id;
    expect(r.body.values[fid('status')]).toBe('In progress');
    expect(r.body.values[fid('project_name')]).toBe('TEST Project');
    expect(r.body.values[fid('password')]).toBeNull(); // never sent in snapshots
    expect(r.body.secretSet[fid('password')]).toBe(true);
    expect(r.body.customColumns.map((c: any) => c.label)).toEqual(['Repo link', 'Budget']);
    expect(r.body.notes).toBe('hello');
    const raw = await db.query(`SELECT value FROM desklist.project_field_values WHERE project_id=$1 AND field_id=$2`, [projectId, fid('password')]);
    expect(raw.rows[0].value.startsWith('v1:')).toBe(true);
    expect(raw.rows[0].value).not.toContain('s3cret');
    expect((await api('GET', `/api/projects/${projectId}/secret/${fid('password')}`, adminTok)).body.value).toBe('s3cret!');
    expect((await api('GET', `/api/projects/${projectId}/secret/${fid('password')}`, memberTok)).status).toBe(403);
  });
  it('updates, isolates teams, and deletes', async () => {
    const u = await api('PATCH', `/api/projects/${projectId}`, memberTok, { name: 'TEST Project 2', notes: 'notes v2', values: { [fid('domain')]: 'test.example.com' } });
    expect(u.status).toBe(200);
    expect(u.body.name).toBe('TEST Project 2');
    expect(u.body.notes).toBe('notes v2');
    expect(u.body.values[fid('domain')]).toBe('test.example.com');
    expect((await api('PATCH', `/api/projects/${projectId}`, otherTok, { name: 'hijack' })).status).toBe(404);
    const snap = (await api('GET', '/api/snapshot', otherTok)).body as Snapshot;
    expect(snap.projects.find((p) => p.id === projectId)).toBeUndefined();
    const tmp = await api('POST', '/api/projects', adminTok, { name: 'TEST temp' });
    expect((await api('DELETE', `/api/projects/${tmp.body.id}`, adminTok)).status).toBe(200);
    expect((await api('GET', '/api/snapshot', adminTok)).body.projects.some((p: any) => p.id === tmp.body.id)).toBe(false);
  });
  it('Input field: attaches a master field to a project with a value', async () => {
    const f = await api('POST', '/api/fields', adminTok, { key: `t${run}_tier`, label: 'Tier', dataType: 'text' });
    const r = await api('POST', `/api/projects/${projectId}/fields`, memberTok, { fieldId: f.body.id, value: 'Gold' });
    expect(r.body.fields.some((x: any) => x.fieldId === f.body.id)).toBe(true);
    expect(r.body.values[f.body.id]).toBe('Gold');
  });
  it('custom columns: add / edit / promote to master field / delete', async () => {
    const c = await api('POST', `/api/projects/${projectId}/columns`, memberTok, { label: `t${run} source`, dataType: 'text', value: 'Referral' });
    expect(c.status).toBe(201);
    const e = await api('PATCH', `/api/columns/${c.body.id}`, memberTok, { value: 'Website' });
    expect(e.body.value).toBe('Website');
    expect((await api('POST', `/api/projects/${projectId}/columns`, memberTok, { label: 'x', dataType: 'password' })).status).toBe(400);
    const p = await api('POST', `/api/columns/${c.body.id}/promote`, adminTok, {});
    expect(p.status).toBe(200);
    expect(p.body.field.key).toBe(`t${run}_source`);
    expect(p.body.project.values[p.body.field.id]).toBe('Website');
    expect(p.body.project.customColumns.some((x: any) => x.id === c.body.id)).toBe(false);
    const d = await api('POST', `/api/projects/${projectId}/columns`, memberTok, { label: 'Temp', dataType: 'date', value: '2026-12-01' });
    expect((await api('DELETE', `/api/columns/${d.body.id}`, memberTok)).status).toBe(200);
  });
  it('tasks: BIC optional, invalid BIC rejected, checking auto-approves as the signed-in member', async () => {
    const t = await api('POST', `/api/projects/${projectId}/tasks`, adminTok, { title: 'Write tests', dueDate: '2026-10-30', notes: 'n1' });
    expect(t.status).toBe(201);
    expect(t.body.bicMemberId).toBeNull();
    expect(t.body.createdByMemberId).toBe(adminId);
    expect(t.body.dueDate).toBe('2026-10-30');
    expect(t.body.notes).toBe('n1');
    const bogus = await api('POST', `/api/projects/${projectId}/tasks`, adminTok, { title: 'x', bicMemberId: crypto.randomUUID() });
    expect(bogus.status).toBe(400);
    expect((await api('POST', `/api/projects/${projectId}/tasks`, adminTok, { title: '' })).status).toBe(400);
    // member checks it (and tries to spoof the approver via the body — ignored)
    const chk = await api('PATCH', `/api/tasks/${t.body.id}`, memberTok, { done: true, approvedByMemberId: adminId });
    expect(chk.body.done).toBe(true);
    expect(chk.body.approvedByMemberId).toBe(memberId);
    expect(chk.body.bicMemberId).toBe(memberId);
    expect(chk.body.approvedAt).toBeTruthy();
    expect(chk.body.doneAt).toBeTruthy();
    const un = await api('PATCH', `/api/tasks/${t.body.id}`, adminTok, { done: false });
    expect(un.body.done).toBe(false);
    expect(un.body.approvedByMemberId).toBeNull();
    expect(un.body.approvedAt).toBeNull();
    // last-write-wins: an older offline edit does not overwrite a newer one
    await api('PATCH', `/api/tasks/${t.body.id}`, adminTok, { title: 'Newest title' });
    const stale = await api('PATCH', `/api/tasks/${t.body.id}`, adminTok, { title: 'Stale', updatedAt: '2020-01-01T00:00:00Z' });
    expect(stale.body.applied).toBe(false);
    expect(stale.body.title).toBe('Newest title');
    // idempotent create replay (offline outbox)
    const cid = crypto.randomUUID();
    const a = await api('POST', `/api/projects/${projectId}/tasks`, adminTok, { id: cid, title: 'Offline task' });
    const b = await api('POST', `/api/projects/${projectId}/tasks`, adminTok, { id: cid, title: 'Offline task' });
    expect([a.status, b.status]).toEqual([201, 200]);
    expect((await api('DELETE', `/api/tasks/${cid}`, adminTok)).status).toBe(200);
    expect((await api('PATCH', `/api/tasks/${t.body.id}`, otherTok, { done: true })).status).toBe(404);
  });

  it('broadcasts changes over WebSocket to the same team only', async () => {
    const wsUrl = base.replace('http', 'ws') + '/ws?token=';
    const open = (tok: string) => new Promise<{ ws: WebSocket; msgs: any[] }>((res, rej) => {
      const ws = new WebSocket(wsUrl + tok); const msgs: any[] = [];
      ws.on('message', (m) => { msgs.push(JSON.parse(String(m))); if (msgs.length === 1) res({ ws, msgs }); });
      ws.on('error', rej);
    });
    const mine = await open(memberTok); const theirs = await open(otherTok);
    expect(mine.msgs[0].type).toBe('hello');
    const bad = new WebSocket(wsUrl + 'nope');
    await new Promise((r) => bad.on('error', r));
    const t = await api('POST', `/api/projects/${projectId}/tasks`, adminTok, { title: 'Broadcast me' });
    await new Promise((r) => setTimeout(r, 400));
    expect(mine.msgs.some((m) => m.type === 'changed' && m.entity === 'task' && m.id === t.body.id && m.by === adminId)).toBe(true);
    expect(theirs.msgs.some((m) => m.type === 'changed' && m.id === t.body.id)).toBe(false);
    mine.ws.close(); theirs.ws.close();
  });
});
