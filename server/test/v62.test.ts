/** 0.6.2 Google sign-in: mocked token endpoint + JWKS (RSA key generated here). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createDb, type Db } from '../src/db.js';
import { createServer } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { codeBucket } from '../src/crypto.js';
import { PriceService } from '../src/prices.js';

const CID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'kid-1';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'https://accounts.google.com', aud: CID, sub: '123', iat: now, exp: now + 600, email_verified: true, ...claims };
  const data = `${b64({ alg: 'RS256', typ: 'JWT', kid: KID })}.${b64(body)}`;
  return `${data}.${crypto.sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}
const codes = new Map<string, string>(); // code -> id_token the fake Google returns
const seen: URLSearchParams[] = [];
let db: Db; let srv: ReturnType<typeof createServer>; let base = '';
const run = crypto.randomBytes(3).toString('hex').toUpperCase(); const team = crypto.randomUUID();
const email = `g62.${run.toLowerCase()}@example.com`;
let admin = '', memberId = '';
async function api(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const verifier = crypto.randomBytes(32).toString('base64url');
async function flow(token: string, opts: { state?: string; exState?: string; code?: string } = {}) {
  const state = opts.state ?? crypto.randomBytes(16).toString('base64url');
  await api('POST', '/api/auth/google/start', undefined, { state });
  const code = opts.code ?? 'code-' + crypto.randomBytes(8).toString('hex');
  codes.set(code, token);
  return api('POST', '/api/auth/google/exchange', undefined, { code, verifier, redirectUri: 'http://127.0.0.1:50123/oauth', state: opts.exState ?? state });
}
beforeAll(async () => {
  db = createDb(); await migrate(db, () => {});
  await db.query(`INSERT INTO desklist.teams(id,name) VALUES ($1,'TEST v62 ${run}')`, [team]);
  const ins = async (role: string, code: string) => (await db.query(`INSERT INTO desklist.members(team_id,name,initials,role,code_hash,code_bucket) VALUES ($1,$2,'G6',$3,$4,$5) RETURNING id`,
    [team, `G62 ${role}`, role, await bcrypt.hash(code, 10), codeBucket(code)])).rows[0].id;
  await ins('admin', `GA-${run}`); memberId = await ins('member', `GM-${run}`);
  srv = createServer({ db, log: () => {}, prices: new PriceService((async () => ({ ok: true, status: 200, json: async () => ({ solana: { usd: 100 } }) })) as any, 60_000),
    google: { clientId: CID, clientSecret: 'test-secret',
      tokenFetch: async (body) => { seen.push(body); const t = codes.get(body.get('code')!); return t ? { ok: true, status: 200, json: async () => ({ id_token: t }) } : { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }; },
      getCerts: async () => ({ [KID]: publicKey.export({ type: 'spki', format: 'pem' }).toString() }) } });
  await new Promise<void>((r) => srv.server.listen(0, r)); base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  admin = (await api('POST', '/api/auth/signin', undefined, { code: `GA-${run}` })).body.token;
});
afterAll(async () => { await db.query(`DELETE FROM desklist.teams WHERE id=$1`, [team]); await srv?.close(); await db?.close(); });

describe('Google sign-in', () => {
  it('config endpoint exposes the client id', async () => {
    expect((await api('GET', '/api/auth/google/config')).body).toEqual({ enabled: true, clientId: CID });
  });
  it('admin sets / clears a member Google email (lower-case, unique); members cannot', async () => {
    expect((await api('PATCH', `/api/members/${memberId}`, admin, { googleEmail: email.toUpperCase() })).body.googleEmail).toBe(email);
    const mtok = (await api('POST', '/api/auth/signin', undefined, { code: `GM-${run}` })).body.token;
    expect((await api('PATCH', `/api/members/${memberId}`, mtok, { googleEmail: 'x@example.com' })).status).toBe(403);
    expect((await api('PATCH', `/api/members/${memberId}`, admin, { googleEmail: 'not-an-email' })).status).toBe(400);
  });
  it('no matching member -> 403, never creates members', async () => {
    const before = (await db.query(`SELECT count(*)::int n FROM desklist.members WHERE team_id=$1`, [team])).rows[0].n;
    const r = await flow(idToken({ email: `nobody.${run}@example.com` }));
    expect(r.status).toBe(403); expect(r.body.error).toBe("This Google account isn't linked to a member. Ask your admin to add it in Team & codes.");
    expect((await db.query(`SELECT count(*)::int n FROM desklist.members WHERE team_id=$1`, [team])).rows[0].n).toBe(before);
  });
  it('valid token -> 5-day session for the matched member; PKCE verifier + redirect forwarded to Google', async () => {
    const r = await flow(idToken({ email: email.toUpperCase() }));
    expect(r.status).toBe(200); expect(r.body.member.id).toBe(memberId);
    const days = (new Date(r.body.expiresAt).getTime() - Date.now()) / 86400_000; expect(days).toBeGreaterThan(4.99); expect(days).toBeLessThan(5.01);
    expect((await api('GET', '/api/me', r.body.token)).status).toBe(200);
    const last = seen.at(-1)!; expect(last.get('code_verifier')).toBe(verifier); expect(last.get('redirect_uri')).toBe('http://127.0.0.1:50123/oauth');
    expect(last.get('client_secret')).toBe('test-secret'); expect(last.get('grant_type')).toBe('authorization_code');
  });
  it('wrong aud / wrong iss / expired / bad signature -> 401', async () => {
    expect((await flow(idToken({ email, aud: 'other.apps.googleusercontent.com' }))).status).toBe(401);
    expect((await flow(idToken({ email, iss: 'https://evil.example' }))).status).toBe(401);
    expect((await flow(idToken({ email, exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 }))).status).toBe(401);
    const t = idToken({ email }); expect((await flow(t.slice(0, -4) + 'AAAA')).status).toBe(401);
  });
  it('unverified email -> 401', async () => {
    const r = await flow(idToken({ email, email_verified: false })); expect(r.status).toBe(401); expect(r.body.error).toMatch(/not verified/);
  });
  it('state mismatch / reused state -> 400', async () => {
    expect((await flow(idToken({ email }), { exState: crypto.randomBytes(16).toString('base64url') })).status).toBe(400);
    const state = crypto.randomBytes(16).toString('base64url');
    expect((await flow(idToken({ email }), { state })).status).toBe(200);
    const again = await api('POST', '/api/auth/google/exchange', undefined, { code: 'code-x' + run, verifier, redirectUri: 'http://127.0.0.1:50123/oauth', state });
    expect(again.status).toBe(400);
  });
  it('reused code -> 400; non-loopback redirect -> 400', async () => {
    const code = 'code-reuse-' + run;
    expect((await flow(idToken({ email }), { code })).status).toBe(200);
    const r = await flow(idToken({ email }), { code }); expect(r.status).toBe(400); expect(r.body.error).toMatch(/already used/);
    expect((await api('POST', '/api/auth/google/exchange', undefined, { code: 'c-abcdefghij', verifier, redirectUri: 'https://evil.example/oauth', state: 'x'.repeat(20) })).status).toBe(400);
  });
});
