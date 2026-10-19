/** v6 endpoints: typed task fields (+ password encryption), files (bytea), task reimbursement, task-details listing, deadline. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createDb, type Db } from '../src/db.js';
import { createServer } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { codeBucket } from '../src/crypto.js';
import { PriceService } from '../src/prices.js';
import type { Snapshot } from '@desklist/shared';

process.env.APP_ENCRYPTION_KEY ||= 'test-key-only-for-local-tests-0123456789';
let db: Db; let srv: ReturnType<typeof createServer>; let base = '';
const run = crypto.randomBytes(3).toString('hex');
const teamA = crypto.randomUUID(); const teamB = crypto.randomUUID();
let tok = '', other = '', projectId = '', taskId = '';
const gecko = async () => ({ ok: true, status: 200, json: async () => ({ solana: { usd: 150 }, bitcoin: { usd: 100000, idr: 1_600_000_000 } }) });

async function api(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const raw = body instanceof Buffer;
  const r = await fetch(base + path, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any = null; try { json = JSON.parse(buf.toString()); } catch { /* binary */ }
  return { status: r.status, body: json, buf, headers: r.headers };
}

beforeAll(async () => {
  db = createDb(); await migrate(db, () => {}); await seed(db, () => {});
  await db.query(`INSERT INTO desklist.teams(id,name) VALUES ($1,'TEST v6 ${run}'),($2,'TEST v6b ${run}')`, [teamA, teamB]);
  const mk = async (team: string, code: string) => db.query(`INSERT INTO desklist.members(team_id,name,initials,role,code_hash,code_bucket) VALUES ($1,'V6','V6','admin',$2,$3)`,
    [team, await bcrypt.hash(code, 10), codeBucket(code)]);
  const ca = `V6A-${run}`.toUpperCase(), cb = `V6B-${run}`.toUpperCase();
  await mk(teamA, ca); await mk(teamB, cb);
  srv = createServer({ db, log: () => {}, prices: new PriceService(gecko as any, 60_000) });
  await new Promise<void>((r) => srv.server.listen(0, r));
  base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  tok = (await api('POST', '/api/auth/signin', undefined, { code: ca })).body.token;
  other = (await api('POST', '/api/auth/signin', undefined, { code: cb })).body.token;
  const p = await api('POST', '/api/projects', tok, { name: `V6 ${run}`, deadline: '2026-11-27' });
  projectId = p.body.id;
  expect(p.body.deadline).toBe('2026-11-27');
  taskId = (await api('POST', `/api/projects/${projectId}/tasks`, tok, { title: 'Set up VPS' })).body.id;
});
afterAll(async () => { await db.query(`DELETE FROM desklist.teams WHERE id = ANY($1::uuid[])`, [[teamA, teamB]]); await srv?.close(); await db?.close(); });

describe('v6 typed task fields', () => {
  it('validates per type and stores passwords encrypted (masked in snapshot, revealable)', async () => {
    expect((await api('POST', `/api/tasks/${taskId}/fields`, tok, { label: 'Email', type: 'email', value: 'nope' })).status).toBe(400);
    const e = await api('POST', `/api/tasks/${taskId}/fields`, tok, { label: 'Email', type: 'email', value: 'admin@project-a.com' });
    expect(e.status).toBe(201); expect(e.body.value).toBe('admin@project-a.com');
    const pw = await api('POST', `/api/tasks/${taskId}/fields`, tok, { label: 'Password', type: 'password', value: 's3cret-pass' });
    expect(pw.body.value).toBeNull(); expect(pw.body.isSet).toBe(true);
    const stored = (await db.query(`SELECT value FROM desklist.task_fields WHERE id=$1`, [pw.body.id])).rows[0].value;
    expect(stored).not.toContain('s3cret'); expect(stored.startsWith('v1:')).toBe(true);
    expect((await api('GET', `/api/task-fields/${pw.body.id}/reveal`, tok)).body.value).toBe('s3cret-pass');
    expect((await api('GET', `/api/task-fields/${pw.body.id}/reveal`, other)).status).toBe(404);
    const s: Snapshot = (await api('GET', '/api/snapshot', tok)).body;
    expect(s.taskFields.find((f) => f.id === pw.body.id)!.value).toBeNull();
    expect(JSON.stringify(s)).not.toContain('s3cret');
    const dd = await api('POST', `/api/tasks/${taskId}/fields`, tok, { label: 'Region', type: 'dropdown', options: { choices: ['Singapore', 'Jakarta'] }, value: 'Singapore' });
    expect(dd.status).toBe(201);
    expect((await api('PATCH', `/api/task-fields/${dd.body.id}`, tok, { value: 'Tokyo' })).status).toBe(400);
    expect((await api('POST', `/api/tasks/${taskId}/fields`, tok, { label: 'Fee', type: 'amount', value: '0.5 USD' })).status).toBe(400);
    expect((await api('POST', `/api/tasks/${taskId}/fields`, tok, { label: 'Fee', type: 'amount', value: '0.5 SOL' })).status).toBe(201);
    const del = await api('POST', `/api/tasks/${taskId}/fields`, tok, { label: 'tmp', type: 'text' });
    expect((await api('DELETE', `/api/task-fields/${del.body.id}`, tok)).status).toBe(200);
  });
});

describe('v6 files', () => {
  it('uploads to bytea, downloads identical bytes, enforces 10 MB and team scope', async () => {
    const data = crypto.randomBytes(200_000);
    const up = await api('POST', `/api/tasks/${taskId}/files`, tok, data, { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent('invoice ä.pdf'), 'x-mime': 'application/pdf' });
    expect(up.status).toBe(201); expect(up.body.size).toBe(200_000); expect(up.body.name).toBe('invoice ä.pdf'); expect(up.body.mime).toBe('application/pdf');
    const dl = await api('GET', `/api/files/${up.body.id}`, tok);
    expect(dl.status).toBe(200); expect(dl.buf.equals(data)).toBe(true);
    expect((await api('GET', `/api/files/${up.body.id}`, other)).status).toBe(404);
    const big = await api('POST', `/api/tasks/${taskId}/files`, tok, Buffer.alloc(10 * 1024 * 1024 + 2048), { 'content-type': 'application/octet-stream' });
    expect(big.status).toBe(413);
  });
});

describe('v6 task reimbursement + task details', () => {
  it('Has reimbursement creates one entry per task in the admin currency; tick + note shows in task details', async () => {
    const r = await api('PUT', `/api/tasks/${taskId}/reimbursement`, tok, { item: 'VPS 2 vCPU · Singapore', category: 'Hosting', amount: 0.1 });
    expect(r.status).toBe(200); expect(r.body.currency).toBe('SOL'); expect(r.body.amount).toBe(0.1); expect(r.body.taskId).toBe(taskId);
    await api('PUT', `/api/tasks/${taskId}/reimbursement`, tok, { item: 'VPS 2 vCPU · Singapore', category: 'Hosting', amount: 0.12 });
    const list = (await api('GET', '/api/reimbursements', tok)).body.filter((x: any) => x.taskId === taskId);
    expect(list.length).toBe(1); expect(list[0].amount).toBe(0.12);
    expect((await api('PUT', `/api/tasks/${taskId}/reimbursement`, tok, { item: 'x', category: 'Food', amount: 1 })).status).toBe(400);
    await api('POST', `/api/projects/${projectId}/tasks`, tok, { title: 'Pending one' });
    let d = await api('GET', `/api/projects/${projectId}/task-details`, tok);
    expect(d.body.approved.length).toBe(0); expect(d.body.pendingCount).toBe(2);
    const tick = await api('PATCH', `/api/tasks/${taskId}`, tok, { done: true, doneNote: 'VPS live, IP 103.28.14.77' });
    expect(tick.body.approvedByMemberId).toBeTruthy(); expect(tick.body.doneNote).toBe('VPS live, IP 103.28.14.77');
    d = await api('GET', `/api/projects/${projectId}/task-details`, tok);
    expect(d.body.pendingCount).toBe(1);
    const card = d.body.approved[0];
    expect(card.task.id).toBe(taskId); expect(card.fields.length).toBeGreaterThanOrEqual(4); expect(card.files.length).toBe(1);
    expect(card.reimbursement.item).toBe('VPS 2 vCPU · Singapore');
    expect((await api('GET', `/api/projects/${projectId}/task-details`, other)).status).toBe(404);
    expect((await api('DELETE', `/api/tasks/${taskId}/reimbursement`, tok)).status).toBe(200);
    expect((await api('GET', '/api/reimbursements', tok)).body.some((x: any) => x.taskId === taskId)).toBe(false);
  });
});
