/** 0.6.4 accounts: username + password; a new account redeems a member code once to join that member slot. */
import type { Express, Request } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Db } from './db.js';
import { sha256, newToken, normalizeCode, codeBucket } from './crypto.js';
import { RateLimiter, HttpError } from './app.js';

const S = 'desklist';
export const BCRYPT_COST = 12;
const USERNAME = z.string().trim().min(3, 'Username must be at least 3 characters').max(40).regex(/^[A-Za-z0-9._-]+$/, 'Username can use letters, numbers, dot, dash and underscore');
const PASSWORD = z.string().min(8, 'Password must be at least 8 characters').max(200);
const WRONG = 'Wrong username or password';
type H = (fn: (req: any, res: any) => Promise<void>) => any;

export function tempPassword() { return crypto.randomBytes(9).toString('base64url'); }

export function registerAccountsPublic(app: Express, db: Db, h: H, issueSession: (memberId: string) => Promise<any>, limitMax = 5) {
  const lim = new RateLimiter(limitMax); const ipLim = new RateLimiter(limitMax * 4); // IPs can be shared (office NAT)
  const ipOf = (req: Request) => req.ip ?? 'unknown';
  const L = (k: string) => (k.startsWith('ip:') || k.startsWith('cip:') ? ipLim : lim);
  const guard = (keys: string[]) => { if (keys.some((k) => L(k).blocked(k))) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.'); };
  async function pending(accountId: string, username: string) {
    const t = newToken();
    await db.query(`UPDATE ${S}.accounts SET pending_token_hash=$2, pending_expires_at=now()+interval '1 day' WHERE id=$1`, [accountId, sha256(t)]);
    return { pending: true, accountToken: t, username };
  }
  app.post('/api/accounts/signup', h(async (req, res) => {
    const b = z.object({ username: USERNAME, password: PASSWORD }).parse(req.body);
    guard(['ip:' + ipOf(req)]);
    const hash = await bcrypt.hash(b.password, BCRYPT_COST);
    const { rows: [a] } = await db.query(`INSERT INTO ${S}.accounts(username, password_hash) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id, username`, [b.username, hash]);
    if (!a) throw new HttpError(409, 'That username is taken');
    res.status(201).json(await pending(a.id, a.username));
  }));
  app.post('/api/accounts/login', h(async (req, res) => {
    const b = z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(200) }).parse(req.body);
    const keys = ['u:' + b.username.toLowerCase(), 'ip:' + ipOf(req)]; guard(keys);
    const { rows: [a] } = await db.query(`SELECT a.*, m.revoked FROM ${S}.accounts a LEFT JOIN ${S}.members m ON m.id=a.member_id WHERE lower(a.username)=lower($1)`, [b.username]);
    const ok = a ? await bcrypt.compare(b.password, a.password_hash) : (await bcrypt.compare(b.password, '$2a$12$' + 'x'.repeat(53)), false);
    if (!ok) { keys.forEach((k) => L(k).fail(k)); throw new HttpError(401, WRONG); }
    keys.forEach((k) => { if (!k.startsWith('ip:') && !k.startsWith('cip:')) L(k).clear(k); });
    if (a.member_id && a.revoked) throw new HttpError(403, 'Your access was revoked. Ask your admin.');
    res.json(a.member_id ? await issueSession(a.member_id) : await pending(a.id, a.username));
  }));
  app.post('/api/accounts/redeem', h(async (req, res) => {
    const b = z.object({ accountToken: z.string().min(20).max(200), code: z.string().trim().min(4).max(64) }).parse(req.body);
    const { rows: [a] } = await db.query(`SELECT * FROM ${S}.accounts WHERE pending_token_hash=$1 AND pending_expires_at > now() AND member_id IS NULL`, [sha256(b.accountToken)]);
    if (!a) throw new HttpError(401, 'Your sign-up session expired. Sign in again to continue.');
    const keys = ['c:' + a.id, 'cip:' + ipOf(req)]; guard(keys);
    const norm = normalizeCode(b.code);
    const { rows } = await db.query(`SELECT m.*, (SELECT 1 FROM ${S}.accounts x WHERE x.member_id=m.id) AS bound FROM ${S}.members m WHERE code_bucket=$1 AND NOT revoked AND code_hash IS NOT NULL`, [codeBucket(norm)]);
    let m: any = null; for (const r of rows) if (await bcrypt.compare(norm, r.code_hash)) { m = r; break; }
    if (!m) { keys.forEach((k) => L(k).fail(k)); throw new HttpError(400, "That code isn't valid. Check it with your admin."); }
    if (m.bound) { keys.forEach((k) => L(k).fail(k)); throw new HttpError(409, 'This code is already linked to an account. Ask your admin for a new code or to unlink it.'); }
    try {
      await db.query(`UPDATE ${S}.accounts SET member_id=$2, pending_token_hash=NULL, pending_expires_at=NULL, updated_at=now() WHERE id=$1`, [a.id, m.id]);
    } catch { throw new HttpError(409, 'This code is already linked to an account.'); }
    keys.forEach((k) => { if (!k.startsWith('ip:') && !k.startsWith('cip:')) L(k).clear(k); });
    res.json(await issueSession(m.id));
  }));
}

export function registerAccountsAuthed(app: Express, db: Db, h: H, changed: (req: any, kind: string, id: string) => void) {
  const admin = (req: any) => { if (req.member.role !== 'admin') throw new HttpError(403, 'Admin only'); };
  app.get('/api/account', h(async (req, res) => {
    const { rows: [a] } = await db.query(`SELECT username FROM ${S}.accounts WHERE member_id=$1`, [req.member.id]);
    res.json({ username: a?.username ?? null });
  }));
  app.patch('/api/account', h(async (req, res) => {
    const b = z.object({ username: USERNAME }).parse(req.body);
    try {
      const { rows: [a] } = await db.query(`UPDATE ${S}.accounts SET username=$2, updated_at=now() WHERE member_id=$1 RETURNING username`, [req.member.id, b.username]);
      if (!a) throw new HttpError(404, 'No account linked');
      changed(req, 'member', req.member.id); res.json(a);
    } catch (e) { if ((e as any).code === '23505') throw new HttpError(409, 'That username is taken'); throw e; }
  }));
  app.post('/api/account/password', h(async (req, res) => {
    const b = z.object({ current: z.string().min(1), next: PASSWORD }).parse(req.body);
    const { rows: [a] } = await db.query(`SELECT id, password_hash FROM ${S}.accounts WHERE member_id=$1`, [req.member.id]);
    if (!a) throw new HttpError(404, 'No account linked');
    if (!(await bcrypt.compare(b.current, a.password_hash))) throw new HttpError(400, 'Current password is wrong');
    await db.query(`UPDATE ${S}.accounts SET password_hash=$2, updated_at=now() WHERE id=$1`, [a.id, await bcrypt.hash(b.next, BCRYPT_COST)]);
    res.json({ ok: true });
  }));
  const memberAcc = async (req: any) => {
    admin(req);
    const { rows: [a] } = await db.query(`SELECT a.id FROM ${S}.accounts a JOIN ${S}.members m ON m.id=a.member_id WHERE m.id=$1 AND m.team_id=$2`, [req.params.id, req.member.teamId]);
    if (!a) throw new HttpError(404, 'This member has no linked account');
    return a.id as string;
  };
  app.post('/api/members/:id/reset-password', h(async (req, res) => {
    const id = await memberAcc(req); const pw = tempPassword();
    await db.query(`UPDATE ${S}.accounts SET password_hash=$2, updated_at=now() WHERE id=$1`, [id, await bcrypt.hash(pw, BCRYPT_COST)]);
    await db.query(`DELETE FROM ${S}.sessions WHERE member_id=$1`, [req.params.id]);
    res.json({ tempPassword: pw });
  }));
  app.post('/api/members/:id/unlink', h(async (req, res) => {
    const id = await memberAcc(req);
    await db.query(`UPDATE ${S}.accounts SET member_id=NULL, updated_at=now() WHERE id=$1`, [id]);
    await db.query(`DELETE FROM ${S}.sessions WHERE member_id=$1`, [req.params.id]);
    changed(req, 'member', req.params.id); res.json({ ok: true });
  }));
}
