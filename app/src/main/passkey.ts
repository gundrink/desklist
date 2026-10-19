/**
 * Passkey flows via the system browser (WebAuthn needs the server's https origin; file:// can't do it).
 * A one-shot loopback HTTP server on 127.0.0.1:<random> receives the redirect back from the server page.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { shell } from 'electron';

const DONE_HTML = (msg: string) => `<!doctype html><meta charset="utf-8"><title>Desklist</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh"><div style="text-align:center"><h2>Desklist</h2><p>${msg}</p><p style="color:#777">You can close this tab and return to the app.</p></div>`;

/** Start a loopback listener; resolves with the query params of the first hit on /passkey. */
export function loopback(timeoutMs = 5 * 60_000, cbPath = '/passkey'): Promise<{ url: string; wait: Promise<URLSearchParams>; close: () => void }> {
  return new Promise((resolve, reject) => {
    let done: (q: URLSearchParams) => void; let fail: (e: Error) => void;
    const wait = new Promise<URLSearchParams>((a, b) => { done = a; fail = b; });
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== cbPath) { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get('status') === 'ok' || u.searchParams.has('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_HTML(ok ? 'Done — returning to Desklist.' : 'Something went wrong.'));
      done(u.searchParams); setTimeout(() => srv.close(), 200);
    });
    const timer = setTimeout(() => { fail(new Error('Passkey timed out — try again.')); srv.close(); }, timeoutMs);
    wait.finally(() => clearTimeout(timer)).catch(() => {});
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}${cbPath}`, wait, close: () => { srv.close(); fail(new Error('Cancelled')); } });
    });
  });
}

export async function registerPasskey(serverUrl: string, getTicket: () => Promise<{ ticket: string }>, open = shell.openExternal) {
  const lb = await loopback();
  const { ticket } = await getTicket();
  await open(`${serverUrl}/passkey/register?ticket=${encodeURIComponent(ticket)}&cb=${encodeURIComponent(lb.url)}`);
  const q = await lb.wait;
  if (q.get('status') !== 'ok') throw new Error('Passkey was not added');
}

export async function passkeySignIn(serverUrl: string, exchange: (code: string, verifier: string) => Promise<void>, open = shell.openExternal) {
  const lb = await loopback();
  const state = crypto.randomBytes(16).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const cc = crypto.createHash('sha256').update(verifier).digest('base64url');
  await open(`${serverUrl}/passkey/login?cb=${encodeURIComponent(lb.url)}&state=${state}&cc=${cc}`);
  const q = await lb.wait;
  if (q.get('state') !== state) throw new Error('Passkey sign-in state mismatch');
  const code = q.get('code'); if (!code) throw new Error('Passkey sign-in failed');
  await exchange(code, verifier);
}

/** Google sign-in (docs/google-signin.md): system browser + loopback + PKCE (S256) + state; server exchanges and verifies. */
export async function googleSignIn(api: <T>(m: string, p: string, b?: unknown) => Promise<T>, exchange: (body: { code: string; verifier: string; redirectUri: string; state: string }) => Promise<void>, open = shell.openExternal) {
  const cfg = await api<{ enabled: boolean; clientId: string | null }>('GET', '/api/auth/google/config');
  if (!cfg.enabled || !cfg.clientId) throw new Error('Google sign-in is not set up on the server yet');
  const lb = await loopback(5 * 60_000, '/oauth');
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  await api('POST', '/api/auth/google/start', { state });
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [k, v] of Object.entries({ client_id: cfg.clientId, redirect_uri: lb.url, response_type: 'code', scope: 'openid email profile',
    code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' })) u.searchParams.set(k, v);
  await open(u.toString());
  const q = await lb.wait;
  if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'Google sign-in was cancelled' : `Google error: ${q.get('error')}`);
  if (q.get('state') !== state) throw new Error('Sign-in state mismatch — try again');
  const code = q.get('code'); if (!code) throw new Error('Google sign-in failed');
  await exchange({ code, verifier, redirectUri: lb.url, state });
}
