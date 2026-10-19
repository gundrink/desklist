/** 0.6.4 accounts: signup, redeem, login, lockout, admin reset/unlink, self change, pending resume. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createDb, type Db } from '../src/db.js';
import { createServer } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { codeBucket } from '../src/crypto.js';
import { PriceService } from '../src/prices.js';
import { BCRYPT_COST } from '../src/accounts.js';

let db: Db; let srv: ReturnType<typeof createServer>; let base = '';
const run = crypto.randomBytes(3).toString('hex'); const team = crypto.randomUUID();
const ACODE = `AA-${run}-ADMIN`.toUpperCase(); const MCODE = `MM-${run}-MEMB`.toUpperCase(); const M2 = `MZ-${run}-TWO`.toUpperCase();
let adminId = '', memberId = '';
const u = (s: string) => `${s}_${run}`;
async function api(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
beforeAll(async () => {
  db = createDb(); await migrate(db, () => {});
  await db.query(`INSERT INTO desklist.teams(id,name) VALUES ($1,'TEST v64 ${run}')`, [team]);
  const ins = async (name: string, role: string, code: string) => (await db.query(`INSERT INTO desklist.members(team_id,name,initials,role,code_hash,code_bucket) VALUES ($1,$2,'T6',$3,$4,$5) RETURNING id`,
    [team, name, role, await bcrypt.hash(code, 10), codeBucket(code)])).rows[0].id;
  adminId = await ins('V64 Admin', 'admin', ACODE); memberId = await ins('V64 Member', 'member', MCODE); await ins('V64 Two', 'member', M2);
  srv = createServer({ db, log: () => {}, accountLimit: 5, prices: new PriceService((async () => ({ ok: true, status: 200, json: async () => ({}) })) as any, 60_000) });
  await new Promise<void>((r) => srv.server.listen(0, r)); base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await db.query(`DELETE FROM desklist.accounts WHERE username ILIKE $1`, [`%_${run}`]);
  await db.query(`DELETE FROM desklist.teams WHERE id=$1`, [team]); await srv?.close(); await db?.close();
});

describe('accounts', () => {
  let adminTok = '', memTok = '';
  it('bcrypt cost >= 12', () => expect(BCRYPT_COST).toBeGreaterThanOrEqual(12));
  it('signup -> pending; validation; duplicate username is case-insensitive', async () => {
    expect((await api('POST', '/api/accounts/signup', { username: u('short'), password: 'abc' })).status).toBe(400);
    const r = await api('POST', '/api/accounts/signup', { username: u('Boss'), password: 'admin-pass-1' });
    expect(r.status).toBe(201); expect(r.body.pending).toBe(true); expect(r.body.accountToken.length).toBeGreaterThan(20);
    expect((await api('POST', '/api/accounts/signup', { username: u('boss').toUpperCase().replace(run.toUpperCase(), run), password: 'whatever-1' })).status).toBe(409);
  });
  it('pending-code-step resume: login before redeem returns pending; invalid code rejected; admin code binds to existing admin', async () => {
    const l = await api('POST', '/api/accounts/login', { username: u('boss'), password: 'admin-pass-1' });
    expect(l.body.pending).toBe(true);
    expect((await api('POST', '/api/accounts/redeem', { accountToken: l.body.accountToken, code: 'NOPE-NOPE-NOPE' })).status).toBe(400);
    const r = await api('POST', '/api/accounts/redeem', { accountToken: l.body.accountToken, code: ACODE.toLowerCase() });
    expect(r.status).toBe(200); expect(r.body.member.id).toBe(adminId); expect(r.body.member.role).toBe('admin'); adminTok = r.body.token;
    expect((await api('POST', '/api/accounts/redeem', { accountToken: l.body.accountToken, code: MCODE })).status).toBe(401); // token consumed
  });
  it('code already used -> 409; direct code sign-in blocked once bound', async () => {
    const s = await api('POST', '/api/accounts/signup', { username: u('thief'), password: 'thief-pass-1' });
    expect((await api('POST', '/api/accounts/redeem', { accountToken: s.body.accountToken, code: ACODE })).status).toBe(409);
    expect((await api('POST', '/api/auth/signin', { code: ACODE })).status).toBe(403);
  });
  it('member joins, login success and generic failure', async () => {
    const s = await api('POST', '/api/accounts/signup', { username: u('mem'), password: 'member-pass-1' });
    const r = await api('POST', '/api/accounts/redeem', { accountToken: s.body.accountToken, code: MCODE }); expect(r.body.member.id).toBe(memberId);
    const ok = await api('POST', '/api/accounts/login', { username: u('MEM').replace(run.toUpperCase(), run), password: 'member-pass-1' }); expect(ok.status).toBe(200); memTok = ok.body.token;
    const bad = await api('POST', '/api/accounts/login', { username: u('mem'), password: 'wrong-pass-1' });
    const none = await api('POST', '/api/accounts/login', { username: u('ghost'), password: 'wrong-pass-1' });
    expect(bad.status).toBe(401); expect(bad.body.error).toBe('Wrong username or password'); expect(none.body.error).toBe('Wrong username or password');
    const snap = await api('GET', '/api/snapshot', undefined, adminTok);
    expect(snap.body.members.find((m: any) => m.id === memberId).username).toBe(u('mem'));
  });
  it('lockout after 5 failures per username', async () => {
    for (let i = 0; i < 5; i++) await api('POST', '/api/accounts/login', { username: u('thief'), password: 'nope-nope-' + i });
    const r = await api('POST', '/api/accounts/login', { username: u('thief'), password: 'thief-pass-1' });
    expect(r.status).toBe(429); expect(r.body.error).toMatch(/Too many attempts/);
  });
  it('self password + username change', async () => {
    expect((await api('POST', '/api/account/password', { current: 'bad-bad-bad', next: 'member-pass-2' }, memTok)).status).toBe(400);
    expect((await api('POST', '/api/account/password', { current: 'member-pass-1', next: 'member-pass-2' }, memTok)).status).toBe(200);
    expect((await api('PATCH', '/api/account', { username: u('boss') }, memTok)).status).toBe(409);
    expect((await api('PATCH', '/api/account', { username: u('mem2') }, memTok)).body.username).toBe(u('mem2'));
    expect((await api('POST', '/api/accounts/login', { username: u('mem2'), password: 'member-pass-2' })).status).toBe(200);
  });
  it('admin reset password (members cannot)', async () => {
    expect((await api('POST', `/api/members/${memberId}/reset-password`, undefined, memTok)).status).toBe(403);
    const r = await api('POST', `/api/members/${memberId}/reset-password`, undefined, adminTok); expect(r.body.tempPassword.length).toBeGreaterThanOrEqual(8);
    expect((await api('POST', '/api/accounts/login', { username: u('mem2'), password: 'member-pass-2' })).status).toBe(401);
    expect((await api('POST', '/api/accounts/login', { username: u('mem2'), password: r.body.tempPassword })).status).toBe(200);
  });
  it('admin unlink frees the code; account goes back to pending', async () => {
    expect((await api('POST', `/api/members/${memberId}/unlink`, undefined, adminTok)).status).toBe(200);
    const s = await api('POST', '/api/accounts/signup', { username: u('newmem'), password: 'newmem-pass-1' });
    expect((await api('POST', '/api/accounts/redeem', { accountToken: s.body.accountToken, code: MCODE })).body.member.id).toBe(memberId);
  });
  it('delete project: member 403, admin deletes with cascade', async () => {
    const lg = await api('POST', '/api/accounts/login', { username: u('boss'), password: 'admin-pass-1' }); const at = lg.body.token;
    const pr = await api('POST', '/api/projects', { name: `Del ${run}` }, at); const pid = pr.body.id ?? pr.body.project?.id;
    expect(pid).toBeTruthy();
    const t = await api('POST', `/api/projects/${pid}/tasks`, { title: 'Buy domain' }, at);
    const tid = t.body.id ?? t.body.task?.id;
    if (tid) await api('PUT', `/api/tasks/${tid}/reimbursement`, { item: 'x', category: 'Other', amount: 5, currency: 'USD' }, at);
    const ml = await api('POST', '/api/accounts/login', { username: u('newmem'), password: 'newmem-pass-1' });
    expect((await api('DELETE', `/api/projects/${pid}`, undefined, ml.body.token)).status).toBe(403);
    expect((await api('DELETE', `/api/projects/${pid}`, undefined, at)).status).toBe(200);
    expect((await db.query('SELECT count(*)::int n FROM desklist.tasks WHERE project_id=$1', [pid])).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM desklist.reimbursements WHERE project_id=$1', [pid])).rows[0].n).toBe(0);
    expect((await api('GET', '/api/snapshot', undefined, at)).body.projects.some((p: any) => p.id === pid)).toBe(false);
  });
  it('0.6.5: project from configured tasks gets tasks + admin fields in chosen order', async () => {
    const at = (await api('POST', '/api/accounts/login', { username: u('boss'), password: 'admin-pass-1' })).body.token;
    const a = (await api('PUT', '/api/task-setups', { title: 'Beli Domain', fields: [{ label: 'Domain', type: 'url' }, { label: 'Amount', type: 'amount', reimbursement: true }] }, at)).body;
    const b = (await api('PUT', '/api/task-setups', { title: 'Buat Akun X', fields: [{ label: 'Username', type: 'text' }, { label: 'Password', type: 'password' }] }, at)).body;
    const list = (await api('GET', '/api/task-setups', undefined, at)).body; expect(list.map((x: any) => x.title)).toEqual(expect.arrayContaining(['Beli Domain', 'Buat Akun X']));
    const pr = await api('POST', '/api/projects', { name: `Tpl ${run}` }, at); const pid = pr.body.id ?? pr.body.project?.id;
    const r = await api('POST', `/api/projects/${pid}/tasks-from-setups`, { setupIds: [b.id ?? b.setup?.id, a.id ?? a.setup?.id] }, at);
    expect(r.status).toBe(201); expect(r.body.map((t: any) => t.title)).toEqual(['Buat Akun X', 'Beli Domain']);
    const f = (await db.query(`SELECT t.title, tf.section, tf.label FROM desklist.task_fields tf JOIN desklist.tasks t ON t.id=tf.task_id WHERE t.project_id=$1`, [pid])).rows;
    expect(f).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Buat Akun X', label: 'Password' }), expect.objectContaining({ title: 'Beli Domain', label: 'Amount', section: 'reimbursement' })]));
    const man = await api('POST', `/api/projects/${pid}/tasks`, { title: 'beli domain' }, at); // manual, name matches
    expect((await db.query(`SELECT count(*)::int n FROM desklist.task_fields WHERE task_id=$1`, [man.body.id])).rows[0].n).toBeGreaterThanOrEqual(2);
  });
  it('0.6.7: edit task (rename, due, assignee, type) keeps values; setup-name rename adds fields; members can edit', async () => {
    const at = (await api('POST', '/api/accounts/login', { username: u('boss'), password: 'admin-pass-1' })).body.token;
    const mt = (await api('POST', '/api/accounts/login', { username: u('newmem'), password: 'newmem-pass-1' })).body.token;
    const pid = (await api('POST', '/api/projects', { name: `Edit ${run}` }, at)).body.id;
    const t = (await api('POST', `/api/projects/${pid}/tasks`, { title: 'Scratch' }, at)).body;
    const f = (await api('POST', `/api/tasks/${t.id}/fields`, { label: 'Note A', type: 'text', section: 'fields' }, at)).body;
    await api('PATCH', `/api/task-fields/${f.id ?? f.field?.id}`, { value: 'keep me' }, at);
    const r = await api('PATCH', `/api/tasks/${t.id}`, { title: 'beli domain', dueDate: '2026-12-01', bicMemberId: memberId, taskType: 'social', platform: 'TikTok' }, mt);
    expect(r.status).toBe(200); expect(r.body.title).toBe('beli domain'); expect(r.body.dueDate).toBe('2026-12-01'); expect(r.body.bicMemberId).toBe(memberId); expect(r.body.taskType).toBe('social');
    const rows = (await db.query(`SELECT label, value FROM desklist.task_fields WHERE task_id=$1`, [t.id])).rows;
    const L = rows.map((x: any) => x.label);
    expect(rows.find((x: any) => x.label === 'Note A')?.value).toBe('keep me');
    expect(L).toEqual(expect.arrayContaining(['Domain', 'Amount', 'Platform', 'Username / handle']));
    expect(rows.find((x: any) => x.label === 'Platform')?.value).toBe('TikTok');
    await api('PATCH', `/api/tasks/${t.id}`, { title: 'Something else' }, at);
    expect((await db.query(`SELECT count(*)::int n FROM desklist.task_fields WHERE task_id=$1`, [t.id])).rows[0].n).toBe(rows.length);
    expect((await api('POST', `/api/tasks/${t.id}/fields`, { label: 'Member field', type: 'text', section: 'fields' }, mt)).status).toBe(403);
  });
  it('0.6.8: checklist items drive task status; reimbursement only where configured', async () => {
    const at = (await api('POST', '/api/accounts/login', { username: u('boss'), password: 'admin-pass-1' })).body.token;
    const mt = (await api('POST', '/api/accounts/login', { username: u('newmem'), password: 'newmem-pass-1' })).body.token;
    const pid = (await api('POST', '/api/projects', { name: `Items ${run}` }, at)).body.id;
    const t = (await api('POST', `/api/projects/${pid}/tasks`, { title: 'Plain task' }, at)).body;
    const ids: string[] = [];
    for (const x of ['one', 'two', 'three']) { const r = await api('POST', `/api/tasks/${t.id}/items`, { title: x }, mt); expect(r.status).toBe(201); ids.push(r.body.id); }
    const task = async () => (await db.query(`SELECT * FROM desklist.tasks WHERE id=$1`, [t.id])).rows[0];
    await api('PATCH', `/api/tasks/${t.id}`, { done: true }, mt); expect((await task()).done).toBe(false); // can't tick with open items
    await api('PATCH', `/api/items/${ids[0]}`, { done: true }, mt); await api('PATCH', `/api/items/${ids[1]}`, { done: true }, mt);
    expect((await task()).done).toBe(false);
    await api('PATCH', `/api/items/${ids[2]}`, { done: true }, mt);
    const d = await task(); expect(d.done).toBe(true); expect(d.approved_by_member_id).toBe(memberId);
    await api('PATCH', `/api/items/${ids[1]}`, { done: false }, mt); expect((await task()).done).toBe(false);
    await api('PATCH', `/api/items/${ids[1]}`, { title: 'two renamed', sortOrder: 9 }, mt);
    expect((await api('DELETE', `/api/items/${ids[1]}`, undefined, mt)).status).toBe(200); expect((await task()).done).toBe(true);
    const snap = (await api('GET', '/api/snapshot', undefined, mt)).body;
    expect(snap.checklistItems.filter((i: any) => i.taskId === t.id).map((i: any) => i.title)).toEqual(['one', 'three']);
    // reimbursement: plain task has none; members can't turn it on; admin can
    expect((await task()).has_expense).toBe(false);
    expect((await api('PATCH', `/api/tasks/${t.id}`, { hasExpense: true }, mt)).status).toBe(403);
    expect((await api('PUT', `/api/tasks/${t.id}/reimbursement`, { item: 'x', category: 'Other', amount: 1, currency: 'SOL' }, mt)).status).toBe(403);
    expect((await api('PATCH', `/api/tasks/${t.id}`, { hasExpense: true }, at)).body.hasExpense).toBe(true);
    expect((await api('PUT', `/api/tasks/${t.id}/reimbursement`, { item: 'x', category: 'Other', amount: 1, currency: 'SOL' }, mt)).status).toBe(200);
    // a setup with a reimbursement field turns it on
    const t2 = (await api('POST', `/api/projects/${pid}/tasks`, { title: 'beli domain' }, at)).body;
    expect((await db.query(`SELECT has_expense FROM desklist.tasks WHERE id=$1`, [t2.id])).rows[0].has_expense).toBe(true);
  });
});
