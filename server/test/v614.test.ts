/** 0.6.14 Notebook: private notes per member, encrypted secrets, owner-only access, snapshot inclusion. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createDb, type Db } from '../src/db.js';
import { createServer } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { codeBucket } from '../src/crypto.js';
import { PriceService } from '../src/prices.js';

let db: Db; let srv: ReturnType<typeof createServer>; let base = '';
const run = crypto.randomBytes(3).toString('hex'); const team = crypto.randomUUID();
const ACODE = `NA-${run}-ADMIN`.toUpperCase(); const MCODE = `NM-${run}-MEMB`.toUpperCase();
async function api(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const join = async (name: string, code: string) => { const s = await api('POST', '/api/accounts/signup', { username: `${name}_${run}`, password: 'Pw-' + run + '-long' }); return (await api('POST', '/api/accounts/redeem', { accountToken: s.body.accountToken, code })).body.token as string; };
let A = '', M = '';
beforeAll(async () => {
  db = createDb(); await migrate(db, () => {});
  await db.query(`INSERT INTO desklist.teams(id,name) VALUES ($1,'TEST v614 ${run}')`, [team]);
  for (const [n, role, code] of [['V614 Admin', 'admin', ACODE], ['V614 Member', 'member', MCODE]]) await db.query(`INSERT INTO desklist.members(team_id,name,initials,role,code_hash,code_bucket) VALUES ($1,$2,'T6',$3,$4,$5)`, [team, n, role, await bcrypt.hash(code, 10), codeBucket(code)]);
  srv = createServer({ db, log: () => {}, prices: new PriceService((async () => ({ ok: true, status: 200, json: async () => ({}) })) as any, 60_000) });
  await new Promise<void>((r) => srv.server.listen(0, r)); base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  A = await join('nadm', ACODE); M = await join('nmem', MCODE);
});
afterAll(async () => { await db.query(`DELETE FROM desklist.accounts WHERE username ILIKE $1`, [`%_${run}`]); await db.query(`DELETE FROM desklist.teams WHERE id=$1`, [team]); await srv?.close(); await db?.close(); });

describe('notebook', () => {
  let id = ''; let sid = '';
  it('creates a note; secret encrypted at rest and stripped from responses', async () => {
    const r = await api('POST', '/api/notes', { title: 'RPC Helius', fields: [{ label: 'Endpoint', type: 'url', value: 'https://rpc.example.com' }, { label: 'API key', type: 'secret', value: 'sk-test-123' }] }, M);
    expect(r.status).toBe(201); id = r.body.id; sid = r.body.fields[1].id;
    expect(r.body.fields[1]).toMatchObject({ type: 'secret', value: null, hasValue: true });
    const raw = (await db.query(`SELECT fields FROM desklist.notes WHERE id=$1`, [id])).rows[0].fields; expect(JSON.stringify(raw)).not.toContain('sk-test-123');
  });
  it('owner reveals secret; snapshot includes own notes only', async () => {
    expect((await api('GET', `/api/notes/${id}/fields/${sid}/secret`, undefined, M)).body.value).toBe('sk-test-123');
    expect((await api('GET', '/api/snapshot', undefined, M)).body.notes.map((n: any) => n.id)).toContain(id);
    expect((await api('GET', '/api/snapshot', undefined, A)).body.notes).toEqual([]);
  });
  it('other members (even admins) cannot read, edit, reveal or delete', async () => {
    expect((await api('GET', '/api/notes', undefined, A)).body).toEqual([]);
    expect((await api('PATCH', `/api/notes/${id}`, { title: 'x' }, A)).status).toBe(404);
    expect((await api('GET', `/api/notes/${id}/fields/${sid}/secret`, undefined, A)).status).toBe(404);
    expect((await api('DELETE', `/api/notes/${id}`, undefined, A)).status).toBe(404);
    expect((await api('GET', '/api/notes')).status).toBe(401);
  });
  it('patch keeps an unchanged secret, replaces others; delete', async () => {
    const p = await api('PATCH', `/api/notes/${id}`, { title: 'RPC Helius main', fields: [{ id: sid, label: 'API key', type: 'secret', keep: true }, { label: 'Port', type: 'number', value: '443' }] }, M);
    expect(p.status).toBe(200); expect(p.body.title).toBe('RPC Helius main'); expect(p.body.fields).toHaveLength(2);
    expect((await api('GET', `/api/notes/${id}/fields/${sid}/secret`, undefined, M)).body.value).toBe('sk-test-123');
    expect(p.body.status).toBe('available');
    { const u = await api('PATCH', `/api/notes/${id}`, { status: 'unavailable' }, M); expect(u.body.status).toBe('unavailable'); expect(u.body.fields).toHaveLength(2); }
    expect((await api('PATCH', `/api/notes/${id}`, { status: 'bogus' }, M)).status).toBe(400);
    expect((await api('DELETE', `/api/notes/${id}`, undefined, M)).status).toBe(200);
    expect((await api('GET', '/api/notes', undefined, M)).body).toEqual([]);
  });
});

describe('update feed proxy', () => {
  it('serves the newest release (incl. prerelease) asset; 404 for unknown; rejects bad names', async () => {
    const express = (await import('express')).default; const { registerUpdates } = await import('../src/updates.js');
    const calls: string[] = [];
    const fake = (async (url: string, init: any) => { calls.push(url + ' ' + (init.headers.authorization ? 'auth' : 'noauth'));
      if (url.includes('/releases?')) return new Response(JSON.stringify([
        { tag_name: 'v0.6.13', draft: false, prerelease: true, published_at: '2026-10-20T00:00:00Z', assets: [{ id: 1, name: 'latest.yml', size: 5 }] },
        { tag_name: 'v0.6.14', draft: false, prerelease: true, published_at: '2026-10-21T00:00:00Z', assets: [{ id: 2, name: 'latest.yml', size: 5 }, { id: 3, name: 'Desklist-Setup-0.6.14.exe', size: 3 }] },
        { tag_name: 'v0.7.0', draft: true, prerelease: false, published_at: null, assets: [{ id: 9, name: 'latest.yml', size: 5 }] }]));
      if (url.endsWith('/assets/2')) return new Response('version: 0.6.14\n', { headers: { 'content-type': 'text/yaml' } });
      if (url.endsWith('/assets/3')) return new Response('EXE', { status: init.headers.range ? 206 : 200 });
      return new Response('no', { status: 404 }); }) as any;
    const a = express(); registerUpdates(a, { token: 't', fetchImpl: fake });
    const s = a.listen(0); const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    expect(await (await fetch(b + '/updates/win/latest.yml')).text()).toContain('0.6.14');
    expect((await fetch(b + '/updates/win/Desklist-Setup-0.6.14.exe', { headers: { range: 'bytes=0-1' } })).status).toBe(206);
    expect((await fetch(b + '/updates/win/nope.exe')).status).toBe(404);
    expect((await fetch(b + '/updates/win/..%2Fx')).status).toBe(400);
    expect(calls.every((c) => c.endsWith('auth'))).toBe(true);
    s.close();
  });
});

describe('admin guards, member delete, role, profile', () => {
  it('member gets 403 on admin routes', async () => {
    for (const [m, p, b] of [['PATCH', '/api/settings', { currency: 'USD' }], ['POST', '/api/members', { name: 'X' }], ['DELETE', `/api/members/${crypto.randomUUID()}`], ['PATCH', `/api/members/${crypto.randomUUID()}`, { role: 'admin' }],
      ['POST', `/api/members/${crypto.randomUUID()}/code`], ['POST', `/api/members/${crypto.randomUUID()}/revoke`], ['POST', '/api/fields', { label: 'X', dataType: 'text' }], ['GET', '/api/reports'], ['GET', '/api/reports/expenses.csv'],
      ['PUT', '/api/task-setups', { title: 'x', fields: [] }], ['DELETE', `/api/task-setups/${crypto.randomUUID()}`]] as const)
      expect([m, p, (await api(m, p, b, M)).status]).toEqual([m, p, 403]);
  });
  it('role guards: cannot demote self or last admin; promote/demote works', async () => {
    const meA = (await api('GET', '/api/me', undefined, A)).body; const meM = (await api('GET', '/api/me', undefined, M)).body;
    const aid = meA.id ?? meA.member?.id; const mid = meM.id ?? meM.member?.id;
    expect((await api('PATCH', `/api/members/${aid}`, { role: 'member' }, A)).status).toBe(400);
    expect((await api('DELETE', `/api/members/${aid}`, undefined, A)).status).toBe(400);
    expect((await api('PATCH', `/api/members/${mid}`, { role: 'admin' }, A)).body.role).toBe('admin');
    expect((await api('PATCH', `/api/members/${mid}`, { role: 'member' }, A)).body.role).toBe('member');
  });
  it('profile: rename + photo in snapshot + remove', async () => {
    expect((await api('PATCH', '/api/me', { name: 'Sam Carter' }, M)).body.initials).toBe('SC');
    const png = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
    expect((await api('PUT', '/api/me/avatar', { dataUrl: png }, M)).status).toBe(200);
    expect((await api('PUT', '/api/me/avatar', { dataUrl: 'data:image/gif;base64,AAAA' }, M)).status).toBe(400);
    const snap = (await api('GET', '/api/snapshot', undefined, A)).body; expect(snap.members.find((m: any) => m.name === 'Sam Carter').avatarUrl).toBe(png);
    await api('DELETE', '/api/me/avatar', undefined, M);
    expect((await api('GET', '/api/snapshot', undefined, A)).body.members.find((m: any) => m.name === 'Sam Carter').avatarUrl).toBeNull();
  });
  it('amount field in Task detail becomes the reimbursement; delete member keeps approver name', async () => {
    const p = (await api('POST', '/api/projects', { name: 'P614' }, A)).body; const t = (await api('POST', `/api/projects/${p.id}/tasks`, { title: 'Buy domain' }, A)).body;
    expect((await api('POST', `/api/tasks/${t.id}/fields`, { label: 'Amount', type: 'amount', section: 'fields', asReimbursement: true }, M)).status).toBe(403);
    const r = await api('POST', `/api/tasks/${t.id}/fields`, { label: 'Amount', type: 'amount', section: 'fields', asReimbursement: true, options: { currency: 'SOL' } }, A); expect(r.status).toBe(201);
    expect((await api('PUT', `/api/tasks/${t.id}/reimbursement`, { item: 'Buy domain', amount: 1.5, currency: 'SOL' }, M)).status).toBe(200);
    const snap = (await api('GET', '/api/snapshot', undefined, A)).body;
    expect(snap.tasks.find((x: any) => x.id === t.id).hasExpense).toBe(true); expect(snap.reimbursements.find((x: any) => x.taskId === t.id).amount).toBe(1.5);
    expect(snap.projects.find((x: any) => x.id === p.id).hasExpenses).toBe(true);
    await api('PATCH', `/api/tasks/${t.id}`, { done: true }, M);
    const mid = snap.members.find((m: any) => m.name === 'Sam Carter').id;
    expect((await api('DELETE', `/api/members/${mid}`, undefined, A)).status).toBe(200);
    const t2 = (await api('GET', '/api/snapshot', undefined, A)).body.tasks.find((x: any) => x.id === t.id);
    expect(t2.approvedByMemberId).toBeNull(); expect(t2.approvedByName).toBe('Sam Carter');
  });
});
