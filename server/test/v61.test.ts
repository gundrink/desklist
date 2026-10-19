/** 0.6.1: admin task setup by task name (member fills only), passkey ticket/code exchange (mocked WebAuthn), 5-day fixed sessions. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createDb, type Db } from '../src/db.js';
import { createServer, sessionDays } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { codeBucket, sha256 } from '../src/crypto.js';
import { pkceChallenge, type WebAuthnImpl } from '../src/passkeys.js';
import { PriceService } from '../src/prices.js';
import type { Snapshot } from '@desklist/shared';

process.env.APP_ENCRYPTION_KEY ||= 'test-key-only-for-local-tests-0123456789';
let db: Db; let srv: ReturnType<typeof createServer>; let base = '';
const run = crypto.randomBytes(3).toString('hex').toUpperCase(); const team = crypto.randomUUID();
let admin = '', member = '', projectId = '';
const seen: Record<string, unknown> = {};
const mock: WebAuthnImpl = {
  generateRegistrationOptions: (async (o: any) => { seen.reg = o; return { challenge: 'reg-challenge', rp: { id: o.rpID } }; }) as any,
  verifyRegistrationResponse: (async (o: any) => {
    if (o.expectedChallenge !== 'reg-challenge' || o.expectedRPID !== 'localhost' || o.response?.id !== 'cred-1') throw new Error('bad');
    return { verified: true, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } } };
  }) as any,
  generateAuthenticationOptions: (async () => ({ challenge: 'auth-challenge' })) as any,
  verifyAuthenticationResponse: (async (o: any) => {
    if (o.expectedChallenge !== 'auth-challenge' || o.credential.id !== 'cred-1' || o.response?.sig !== 'good') throw new Error('signature invalid');
    return { verified: true, authenticationInfo: { newCounter: 5 } };
  }) as any,
};
async function api(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let json: any = null; try { json = JSON.parse(t); } catch { /* html */ }
  return { status: r.status, body: json, text: t };
}
beforeAll(async () => {
  db = createDb(); await migrate(db, () => {});
  await db.query(`INSERT INTO desklist.teams(id,name) VALUES ($1,'TEST v61 ${run}')`, [team]);
  for (const [role, code] of [['admin', `A61-${run}`], ['member', `M61-${run}`]])
    await db.query(`INSERT INTO desklist.members(team_id,name,initials,role,code_hash,code_bucket) VALUES ($1,$2,'T6',$3,$4,$5)`, [team, `T61 ${role}`, role, await bcrypt.hash(code, 10), codeBucket(code)]);
  srv = createServer({ db, log: () => {}, prices: new PriceService((async () => ({ ok: true, status: 200, json: async () => ({ solana: { usd: 100 } }) })) as any, 60_000),
    passkeys: { rpID: 'localhost', origin: 'http://localhost', impl: mock } });
  await new Promise<void>((r) => srv.server.listen(0, r)); base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  admin = (await api('POST', '/api/auth/signin', undefined, { code: `A61-${run}` })).body.token;
  member = (await api('POST', '/api/auth/signin', undefined, { code: `M61-${run}` })).body.token;
  projectId = (await api('POST', '/api/projects', admin, { name: `P61 ${run}` })).body.id;
});
afterAll(async () => { await db.query(`DELETE FROM desklist.teams WHERE id=$1`, [team]); await srv?.close(); await db?.close(); });

describe('admin task setup', () => {
  it('admin defines fields for "Buy Gmail" once; new and existing tasks get them; member fills but cannot change structure', async () => {
    const before = (await api('POST', `/api/projects/${projectId}/tasks`, member, { title: 'Buy Gmail' })).body; // existed before the setup
    expect((await api('PUT', '/api/task-setups', member, { title: 'Buy Gmail', fields: [] })).status).toBe(403);
    const st = await api('PUT', '/api/task-setups', admin, { title: 'Buy Gmail', fields: [
      { label: 'Email', type: 'email' }, { label: 'Password', type: 'password' }, { label: 'Amount', type: 'amount', reimbursement: true }] });
    expect(st.status).toBe(200); expect(st.body.appliedTo).toBe(1);
    const fresh = (await api('POST', `/api/projects/${projectId}/tasks`, member, { title: '  buy gmail ' })).body;
    const snap: Snapshot = (await api('GET', '/api/snapshot', member)).body;
    for (const t of [before, fresh]) {
      const fs = snap.taskFields.filter((f) => f.taskId === t.id);
      expect(fs.map((f) => `${f.section}:${f.label}:${f.type}`).sort()).toEqual(['fields:Email:email', 'fields:Password:password', 'reimbursement:Amount:amount']);
      expect(snap.tasks.find((x) => x.id === t.id)!.hasExpense).toBe(true);
    }
    const fs = snap.taskFields.filter((f) => f.taskId === fresh.id);
    const email = fs.find((f) => f.label === 'Email')!; const amt = fs.find((f) => f.label === 'Amount')!;
    expect((await api('PATCH', `/api/task-fields/${email.id}`, member, { value: 'team@gmail.com' })).status).toBe(200);
    expect((await api('PATCH', `/api/task-fields/${email.id}`, member, { label: 'Hacked' })).status).toBe(403);
    expect((await api('POST', `/api/tasks/${fresh.id}/fields`, member, { label: 'Extra', type: 'text' })).status).toBe(403);
    expect((await api('DELETE', `/api/task-fields/${email.id}`, member)).status).toBe(403);
    // reimbursement stays open to members
    expect((await api('POST', `/api/tasks/${fresh.id}/fields`, member, { label: 'Vendor', type: 'text', section: 'reimbursement' })).status).toBe(201);
    expect((await api('PATCH', `/api/task-fields/${amt.id}`, member, { value: '0.2 SOL' })).status).toBe(200);
    const r = (await api('GET', '/api/reimbursements', member)).body.find((x: any) => x.taskId === fresh.id);
    expect(r.amount).toBe(0.2); expect(r.currency).toBe('SOL');
    // USD is selectable: a USD amount, no conversion needed
    expect((await api('PATCH', `/api/task-fields/${amt.id}`, member, { value: '12.5 USD' })).status).toBe(200);
    const ru = (await api('GET', '/api/reimbursements', member)).body.find((x: any) => x.taskId === fresh.id);
    expect(ru.currency).toBe('USD'); expect(ru.amount).toBe(12.5);
    expect((await api('GET', '/api/currencies')).body.prices.usd.USD).toBe(1);
    const plain = (await api('POST', `/api/projects/${projectId}/tasks`, member, { title: 'Something else' })).body;
    expect((await api('PUT', `/api/tasks/${plain.id}/reimbursement`, member, { item: 'Coffee', category: 'Other', amount: 1 })).status).toBe(200);
    expect((await api('PATCH', `/api/task-fields/${email.id}`, admin, { label: 'Gmail address' })).body.label).toBe('Gmail address');
  });
});

describe('passkeys (mocked authenticator)', () => {
  it('pages load; register via one-time ticket; login gives one-time code exchanged with PKCE verifier for a 5-day session', async () => {
    expect((await api('GET', '/passkey/register?ticket=x&cb=y')).text).toContain('Continue with passkey');
    expect((await api('GET', '/passkey/login')).text).toContain('/passkey/browser.js');
    expect((await api('GET', '/passkey/browser.js')).text.length).toBeGreaterThan(1000);
    const { ticket } = (await api('POST', '/api/passkeys/ticket', admin)).body;
    expect((await api('POST', '/passkey/api/register/verify', undefined, { ticket, response: { id: 'cred-1' } })).status).toBe(400); // options first
    expect((await api('POST', '/passkey/api/register/options', undefined, { ticket })).body.challenge).toBe('reg-challenge');
    expect((await api('POST', '/passkey/api/register/verify', undefined, { ticket, response: { id: 'cred-1' }, label: 'Test key' })).body.ok).toBe(true);
    expect((await api('POST', '/passkey/api/register/options', undefined, { ticket })).status).toBe(400); // single use
    const list = (await api('GET', '/api/passkeys', admin)).body; expect(list.map((p: any) => p.label)).toEqual(['Test key']);
    expect((await api('GET', '/api/passkeys', member)).body).toEqual([]);

    const verifier = crypto.randomBytes(32).toString('base64url'); const cc = pkceChallenge(verifier);
    expect((await api('POST', '/passkey/api/login/options', undefined, { cb: 'https://evil.example/cb', state: 'state-123456', cc })).status).toBe(400);
    const o = (await api('POST', '/passkey/api/login/options', undefined, { cb: 'http://127.0.0.1:53111/passkey', state: 'state-123456', cc })).body;
    expect((await api('POST', '/passkey/api/login/verify', undefined, { flowId: o.flowId, response: { id: 'cred-1', sig: 'bad' } })).status).toBe(400);
    const o2 = (await api('POST', '/passkey/api/login/options', undefined, { cb: 'http://127.0.0.1:53111/passkey', state: 'state-123456', cc })).body;
    const v = (await api('POST', '/passkey/api/login/verify', undefined, { flowId: o2.flowId, response: { id: 'cred-1', sig: 'good' } })).body;
    const u = new URL(v.redirect); expect(u.origin + u.pathname).toBe('http://127.0.0.1:53111/passkey'); expect(u.searchParams.get('state')).toBe('state-123456');
    const code = u.searchParams.get('code')!;
    expect((await api('POST', '/api/auth/passkey/exchange', undefined, { code, verifier: crypto.randomBytes(32).toString('base64url') })).status).toBe(400); // wrong verifier burns the code
    const o3 = (await api('POST', '/passkey/api/login/options', undefined, { cb: 'http://127.0.0.1:53111/passkey', state: 'state-123456', cc })).body;
    const code3 = new URL((await api('POST', '/passkey/api/login/verify', undefined, { flowId: o3.flowId, response: { id: 'cred-1', sig: 'good' } })).body.redirect).searchParams.get('code')!;
    const ex = await api('POST', '/api/auth/passkey/exchange', undefined, { code: code3, verifier });
    expect(ex.status).toBe(200); expect(ex.body.member.name).toBe('T61 admin');
    const days = (new Date(ex.body.expiresAt).getTime() - Date.now()) / 86400_000; expect(days).toBeGreaterThan(4.99); expect(days).toBeLessThan(5.01);
    expect((await api('GET', '/api/me', ex.body.token)).status).toBe(200);
    expect((await api('POST', '/api/auth/passkey/exchange', undefined, { code: code3, verifier })).status).toBe(400); // single use
    expect((await api('DELETE', `/api/passkeys/${list[0].id}`, member)).status).toBe(404);
    expect((await api('DELETE', `/api/passkeys/${list[0].id}`, admin)).status).toBe(200);
  });
  it('sessions: SESSION_TTL_DAYS default 5, fixed from sign-in; older sessions are rejected', async () => {
    expect(sessionDays()).toBe(5);
    const s = await api('POST', '/api/auth/signin', undefined, { code: `M61-${run}` });
    await db.query(`UPDATE desklist.sessions SET created_at = now() - interval '5 days 1 minute' WHERE token_hash = $1`, [sha256(s.body.token)]);
    expect((await api('GET', '/api/me', s.body.token)).status).toBe(401);
  });
});
