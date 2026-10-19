/**
 * Google sign-in (see docs/google-signin.md). The app opens the system browser with PKCE + state and a 127.0.0.1 loopback
 * redirect; the server exchanges the code (with the client secret) and verifies the ID token. Members are matched by
 * members.google_email (set by an admin). Google sign-in never creates members.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import type { Db } from './db.js';
import { sha256 } from './crypto.js';

const S = 'desklist';
export interface GoogleConfig {
  clientId?: string; clientSecret?: string;
  /** injectable for tests */
  tokenFetch?: (body: URLSearchParams) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
  getCerts?: () => Promise<Record<string, string>>;
}
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{2,5}\/oauth$/;
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export function registerGoogle(app: Express, db: Db, cfg: GoogleConfig, issueSession: (memberId: string) => Promise<unknown>) {
  const clientId = () => cfg.clientId ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = () => cfg.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
  const bad = (status: number, error: string) => Object.assign(new Error(error), { status, expose: true });
  const tokenFetch = cfg.tokenFetch ?? ((body: URLSearchParams) => fetch('https://oauth2.googleapis.com/token',
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) }));
  const oauth = new OAuth2Client();
  const getCerts = cfg.getCerts ?? (async () => (await oauth.getFederatedSignonCertsAsync()).certs as Record<string, string>);

  app.get('/api/auth/google/config', (_req, res) => { const id = clientId(); res.json({ enabled: !!(id && clientSecret()), clientId: id || null }); });

  /** The app registers its random state before opening the browser (10 min, single use). */
  app.post('/api/auth/google/start', h(async (req, res) => {
    const { state } = z.object({ state: z.string().min(16).max(200) }).parse(req.body);
    await db.query(`INSERT INTO ${S}.passkey_flows(id, kind, expires_at) VALUES ($1,'google', now() + interval '10 minutes') ON CONFLICT (id) DO NOTHING`, [sha256('g:' + state)]);
    res.json({ ok: true });
  }));

  app.post('/api/auth/google/exchange', h(async (req, res) => {
    const b = z.object({ code: z.string().min(10).max(2000), verifier: z.string().min(43).max(128), redirectUri: z.string().regex(LOOPBACK, 'redirect_uri must be a 127.0.0.1 loopback'), state: z.string().min(16).max(200) }).parse(req.body);
    if (!clientId() || !clientSecret()) throw bad(503, 'Google sign-in is not configured on the server');
    const { rows: [st] } = await db.query(`UPDATE ${S}.passkey_flows SET used=true WHERE id=$1 AND kind='google' AND NOT used AND expires_at > now() RETURNING id`, [sha256('g:' + b.state)]);
    if (!st) throw bad(400, 'Sign-in state mismatch or expired — try again');
    const { rows: [fresh] } = await db.query(`INSERT INTO ${S}.passkey_flows(id, kind, used, expires_at) VALUES ($1,'gcode',true, now() + interval '1 day') ON CONFLICT (id) DO NOTHING RETURNING id`, [sha256('gc:' + b.code)]);
    if (!fresh) throw bad(400, 'This sign-in code was already used — try again');
    const r = await tokenFetch(new URLSearchParams({ code: b.code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: b.redirectUri, grant_type: 'authorization_code', code_verifier: b.verifier }));
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) throw bad(400, `Google rejected the sign-in (${tok.error ?? r.status})`);
    let payload: any;
    try {
      const ticket = await oauth.verifySignedJwtWithCertsAsync(tok.id_token, await getCerts(), clientId(), ISSUERS);
      payload = ticket.getPayload();
    } catch (e) { throw bad(401, 'Invalid Google ID token: ' + (e as Error).message.split('\n')[0].slice(0, 120)); }
    if (!payload?.email || payload.email_verified !== true) throw bad(401, 'Google email is not verified');
    const email = String(payload.email).toLowerCase();
    const { rows: [m] } = await db.query(`SELECT id FROM ${S}.members WHERE lower(google_email)=$1 AND NOT revoked`, [email]);
    if (!m) throw bad(403, 'Ask your admin to add this Google account');
    res.json(await issueSession(m.id));
  }));
}
