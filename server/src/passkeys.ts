/**
 * Passkey (WebAuthn) re-login. The Electron app's file:// origin can't run WebAuthn, so the ceremony runs on
 * this server's https origin in the system browser and hands back to the app through a 127.0.0.1 loopback redirect.
 *
 *  Register: app (signed in) POST /api/passkeys/ticket -> opens /passkey/register?ticket=..&cb=http://127.0.0.1:port/..
 *            page -> /passkey/api/register/{options,verify} -> redirect cb?status=ok
 *  Login:    app opens /passkey/login?cb=..&state=..&cc=<b64url(sha256(verifier))>
 *            page -> /passkey/api/login/{options,verify} -> one-time code -> redirect cb?code=..&state=..
 *            app POST /api/auth/passkey/exchange {code, verifier} -> session token (PKCE-style).
 * Tickets/codes are random, stored as sha256, single-use, short-lived (ticket 5 min, code 2 min).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { Db } from './db.js';
import { sha256 } from './crypto.js';

const S = 'desklist';
export interface WebAuthnImpl {
  generateRegistrationOptions: typeof generateRegistrationOptions; verifyRegistrationResponse: typeof verifyRegistrationResponse;
  generateAuthenticationOptions: typeof generateAuthenticationOptions; verifyAuthenticationResponse: typeof verifyAuthenticationResponse;
}
export const realWebAuthn: WebAuthnImpl = { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse };
export interface PasskeyConfig { rpID?: string; origin?: string; impl?: WebAuthnImpl }

const rand = () => crypto.randomBytes(32).toString('base64url');
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{2,5}\/[\w\-/]*$/;
export const pkceChallenge = (verifier: string) => crypto.createHash('sha256').update(verifier).digest('base64url');

function rp(req: Request, cfg: PasskeyConfig) {
  const pub = process.env.PUBLIC_SERVER_URL;
  const host = cfg.rpID ?? (pub ? new URL(pub).hostname : req.hostname);
  const origin = cfg.origin ?? (pub ? new URL(pub).origin : `https://${host}`);
  return { rpID: host, origin };
}
function browserBundle(): string {
  const cands = [path.resolve(process.cwd(), 'node_modules'), path.resolve(process.cwd(), '..', 'node_modules')];
  for (const c of cands) { const f = path.join(c, '@simplewebauthn/browser/dist/bundle/index.umd.min.js'); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); }
  return 'window.SimpleWebAuthnBrowser=null';
}
const page = (title: string, script: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Desklist · ${title}</title><style>body{font-family:system-ui,sans-serif;background:#f4f4f4;color:#111;display:grid;place-items:center;min-height:100vh;margin:0}
.c{background:#fff;border:1px solid #ddd;border-radius:14px;padding:28px 32px;max-width:380px;text-align:center}button{background:#111;color:#fff;border:0;border-radius:9px;padding:11px 20px;font-size:15px;cursor:pointer}
#msg{margin-top:14px;font-size:13px;color:#555;min-height:18px}</style></head><body><div class="c"><h2>Desklist</h2><p>${title}</p>
<button id="go">Continue with passkey</button><div id="msg"></div></div><script src="/passkey/browser.js"></script><script>
const q=new URLSearchParams(location.search);const msg=t=>document.getElementById('msg').textContent=t;
const post=async(u,b)=>{const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j};
${script}
document.getElementById('go').onclick=()=>run().catch(e=>msg('Failed: '+e.message));</script></body></html>`;

export function registerPasskeyPublic(app: Express, db: Db, cfg: PasskeyConfig, issueSession: (memberId: string) => Promise<unknown>) {
  const W = cfg.impl ?? realWebAuthn;
  let bundle: string | null = null;
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
  const bad = (status: number, error: string) => Object.assign(new Error(error), { status, expose: true });
  const takeFlow = async (id: string, kind: string) => {
    const { rows } = await db.query(`SELECT * FROM ${S}.passkey_flows WHERE id=$1 AND kind=$2 AND NOT used AND expires_at > now()`, [sha256(id), kind]);
    if (!rows[0]) throw bad(400, 'Link expired or already used');
    return rows[0];
  };
  const security = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); next();
  };
  app.use('/passkey', security);
  app.get('/passkey/browser.js', (_req, res) => { res.type('application/javascript').send(bundle ??= browserBundle()); });
  app.get('/passkey/register', (_req, res) => { res.type('html').send(page('Add a passkey for quick sign-in', `
async function run(){msg('Waiting for your passkey…');const o=await post('/passkey/api/register/options',{ticket:q.get('ticket')});
const resp=await SimpleWebAuthnBrowser.startRegistration({optionsJSON:o});await post('/passkey/api/register/verify',{ticket:q.get('ticket'),response:resp,label:navigator.platform||'Passkey'});
msg('Passkey added. Returning to Desklist…');location.href=q.get('cb')+'?status=ok'}`)); });
  app.get('/passkey/login', (_req, res) => { res.type('html').send(page('Sign in with your passkey', `
async function run(){msg('Waiting for your passkey…');const o=await post('/passkey/api/login/options',{cb:q.get('cb'),state:q.get('state'),cc:q.get('cc')});
const resp=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:o.options});const r=await post('/passkey/api/login/verify',{flowId:o.flowId,response:resp});
msg('Signed in. Returning to Desklist…');location.href=r.redirect}`)); });

  app.post('/passkey/api/register/options', h(async (req, res) => {
    const { ticket } = z.object({ ticket: z.string().min(20) }).parse(req.body);
    const f = await takeFlow(ticket, 'register');
    const { rows: [m] } = await db.query(`SELECT id, name FROM ${S}.members WHERE id=$1 AND NOT revoked`, [f.member_id]);
    if (!m) throw bad(400, 'Member not found');
    const existing = (await db.query(`SELECT credential_id, transports FROM ${S}.member_passkeys WHERE member_id=$1`, [m.id])).rows;
    const { rpID } = rp(req, cfg);
    const opts = await W.generateRegistrationOptions({ rpName: 'Desklist', rpID, userName: m.name, userID: new TextEncoder().encode(m.id),
      attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: existing.map((c: any) => ({ id: c.credential_id, transports: c.transports })) });
    await db.query(`UPDATE ${S}.passkey_flows SET challenge=$2 WHERE id=$1`, [f.id, opts.challenge]);
    res.json(opts);
  }));
  app.post('/passkey/api/register/verify', h(async (req, res) => {
    const b = z.object({ ticket: z.string().min(20), response: z.any(), label: z.string().max(80).optional() }).parse(req.body);
    const f = await takeFlow(b.ticket, 'register');
    if (!f.challenge) throw bad(400, 'Start the registration first');
    const { rpID, origin } = rp(req, cfg);
    const v = await W.verifyRegistrationResponse({ response: b.response, expectedChallenge: f.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false })
      .catch((e) => { throw bad(400, 'Passkey verification failed: ' + e.message); });
    if (!v.verified || !v.registrationInfo) throw bad(400, 'Passkey verification failed');
    const c = v.registrationInfo.credential;
    await db.query(`UPDATE ${S}.passkey_flows SET used=true WHERE id=$1`, [f.id]);
    await db.query(`INSERT INTO ${S}.member_passkeys(member_id, credential_id, public_key, counter, transports, label) VALUES ($1,$2,$3,$4,$5,$6)`,
      [f.member_id, c.id, Buffer.from(c.publicKey), c.counter, JSON.stringify(c.transports ?? b.response?.response?.transports ?? []), (b.label || 'Passkey').slice(0, 80)]);
    res.json({ ok: true });
  }));
  app.post('/passkey/api/login/options', h(async (req, res) => {
    const b = z.object({ cb: z.string().regex(LOOPBACK, 'cb must be a 127.0.0.1 loopback URL'), state: z.string().min(8).max(200), cc: z.string().min(43).max(128) }).parse(req.body);
    const { rpID } = rp(req, cfg);
    const options = await W.generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials: [] });
    const flowId = rand();
    await db.query(`INSERT INTO ${S}.passkey_flows(id, kind, challenge, state, code_challenge, cb, expires_at) VALUES ($1,'login',$2,$3,$4,$5, now() + interval '5 minutes')`,
      [sha256(flowId), options.challenge, b.state, b.cc, b.cb]);
    res.json({ flowId, options });
  }));
  app.post('/passkey/api/login/verify', h(async (req, res) => {
    const b = z.object({ flowId: z.string().min(20), response: z.any() }).parse(req.body);
    const f = await takeFlow(b.flowId, 'login');
    const credId = String(b.response?.id ?? '');
    const { rows: [pk] } = await db.query(`SELECT p.* FROM ${S}.member_passkeys p JOIN ${S}.members m ON m.id=p.member_id WHERE p.credential_id=$1 AND NOT m.revoked`, [credId]);
    if (!pk) throw bad(400, 'Unknown passkey — add it again from Desklist');
    const { rpID, origin } = rp(req, cfg);
    const v = await W.verifyAuthenticationResponse({ response: b.response, expectedChallenge: f.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: { id: pk.credential_id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports } })
      .catch((e) => { throw bad(400, 'Passkey verification failed: ' + e.message); });
    if (!v.verified) throw bad(400, 'Passkey verification failed');
    await db.query(`UPDATE ${S}.passkey_flows SET used=true WHERE id=$1`, [f.id]);
    await db.query(`UPDATE ${S}.member_passkeys SET counter=$2, last_used_at=now() WHERE id=$1`, [pk.id, v.authenticationInfo.newCounter]);
    const code = rand();
    await db.query(`INSERT INTO ${S}.passkey_flows(id, kind, member_id, state, code_challenge, expires_at) VALUES ($1,'code',$2,$3,$4, now() + interval '2 minutes')`,
      [sha256(code), pk.member_id, f.state, f.code_challenge]);
    res.json({ redirect: `${f.cb}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(f.state)}` });
  }));
  /** App exchanges the one-time code + PKCE verifier for a normal session. */
  app.post('/api/auth/passkey/exchange', h(async (req, res) => {
    const b = z.object({ code: z.string().min(20), verifier: z.string().min(43).max(128) }).parse(req.body);
    const { rows: [f] } = await db.query(
      `UPDATE ${S}.passkey_flows SET used=true WHERE id=$1 AND kind='code' AND NOT used AND expires_at > now() RETURNING *`, [sha256(b.code)]);
    if (!f) throw bad(400, 'Code expired or already used');
    if (pkceChallenge(b.verifier) !== f.code_challenge) throw bad(400, 'Verifier mismatch');
    res.json(await issueSession(f.member_id));
  }));
}

export function registerPasskeyAuthed(app: Express, db: Db) {
  const h = (fn: (req: any, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
  app.post('/api/passkeys/ticket', h(async (req, res) => {
    const ticket = rand();
    await db.query(`INSERT INTO ${S}.passkey_flows(id, kind, member_id, expires_at) VALUES ($1,'register',$2, now() + interval '5 minutes')`, [sha256(ticket), req.member.id]);
    await db.query(`DELETE FROM ${S}.passkey_flows WHERE expires_at < now() - interval '1 day'`);
    res.json({ ticket, expiresInSec: 300 });
  }));
  app.get('/api/passkeys', h(async (req, res) => {
    const { rows } = await db.query(`SELECT id, label, created_at, last_used_at FROM ${S}.member_passkeys WHERE member_id=$1 ORDER BY created_at`, [req.member.id]);
    res.json(rows.map((r: any) => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at })));
  }));
  app.delete('/api/passkeys/:id', h(async (req, res) => {
    const { rows: del } = await db.query(`DELETE FROM ${S}.member_passkeys WHERE id=$1 AND member_id=$2 RETURNING id`, [req.params.id, req.member.id]);
    if (!del.length) return res.status(404).json({ error: 'Passkey not found' });
    res.json({ ok: true });
  }));
}
