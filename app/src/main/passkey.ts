/**
 * Passkey flows via the system browser (WebAuthn needs the server's https origin; file:// can't do it).
 * A one-shot loopback HTTP server on 127.0.0.1:<random> receives the redirect back from the server page.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { shell } from 'electron';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const DONE_HTML = (ok: boolean, msg: string) => `<!doctype html><meta charset="utf-8"><title>Desklist</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;background:#fafafa"><div style="text-align:center;max-width:460px"><h2>Desklist</h2><p style="font-size:17px">${esc(msg)}</p><p style="color:#777">${ok ? 'Return to Desklist — you can close this tab.' : 'Close this tab, fix the problem and try again from Desklist.'}</p></div>`;

export interface LoopbackHit { q: URLSearchParams; respond: (ok: boolean, msg: string) => void }
/** Start a loopback listener on 127.0.0.1 (IPv4 literal, also used in redirect_uri). The browser's request is held
 *  open until `respond` is called, so the page can show the real outcome. `close()` cancels the wait. */
export function loopback(timeoutMs = 5 * 60_000, cbPath = '/passkey'): Promise<{ url: string; wait: Promise<LoopbackHit>; close: (why?: string) => void }> {
  return new Promise((resolve, reject) => {
    let done: (h: LoopbackHit) => void; let fail: (e: Error) => void; let settled = false;
    const wait = new Promise<LoopbackHit>((a, b) => { done = a; fail = b; });
    const finish = (e?: Error) => { clearTimeout(timer); setTimeout(() => srv.close(), 500); if (e && !settled) { settled = true; fail(e); } };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== cbPath || settled) { res.writeHead(404).end(); return; }
      settled = true;
      let answered = false;
      const respond = (ok: boolean, msg: string) => { if (answered) return; answered = true; clearTimeout(hold); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(DONE_HTML(ok, msg)); finish(); };
      const hold = setTimeout(() => respond(false, 'Desklist did not finish signing in. Check the app for details.'), 30_000);
      done({ q: u.searchParams, respond });
    });
    const timer = setTimeout(() => finish(new Error('Timed out waiting for the browser — try again.')), timeoutMs);
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}${cbPath}`, wait, close: (why = 'Cancelled') => finish(new Error(why)) });
    });
  });
}

export async function registerPasskey(serverUrl: string, getTicket: () => Promise<{ ticket: string }>, open = shell.openExternal) {
  const lb = await loopback();
  const { ticket } = await getTicket();
  await open(`${serverUrl}/passkey/register?ticket=${encodeURIComponent(ticket)}&cb=${encodeURIComponent(lb.url)}`);
  const { q, respond } = await lb.wait;
  const ok = q.get('status') === 'ok'; respond(ok, ok ? 'Passkey added.' : 'Passkey was not added.');
  if (!ok) throw new Error('Passkey was not added');
}

export async function passkeySignIn(serverUrl: string, exchange: (code: string, verifier: string) => Promise<void>, open = shell.openExternal) {
  const lb = await loopback();
  const state = crypto.randomBytes(16).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const cc = crypto.createHash('sha256').update(verifier).digest('base64url');
  await open(`${serverUrl}/passkey/login?cb=${encodeURIComponent(lb.url)}&state=${state}&cc=${cc}`);
  const { q, respond } = await lb.wait;
  try {
    if (q.get('state') !== state) throw new Error('Passkey sign-in state mismatch');
    const code = q.get('code'); if (!code) throw new Error('Passkey sign-in failed');
    await exchange(code, verifier); respond(true, 'Signed in.');
  } catch (e) { respond(false, (e as Error).message); throw e; }
}

let cancelGoogle: ((why?: string) => void) | null = null;
export const cancelGoogleSignIn = () => { cancelGoogle?.('Google sign-in cancelled'); };

/** Map server/Google failures to clear English. */
export function googleError(e: unknown): Error {
  const status = (e as { status?: number }).status; const msg = (e as Error).message || String(e);
  if (status === 403) return new Error("This Google account isn't linked to a member. Ask your admin to add it in Team & codes.");
  return new Error(msg);
}

/** Google sign-in (docs/google-signin.md): system browser + loopback + PKCE (S256) + state; server exchanges and verifies.
 *  Always settles: success, a clear error, Cancel, or the overall timeout. */
export async function googleSignIn(api: <T>(m: string, p: string, b?: unknown) => Promise<T>, exchange: (body: { code: string; verifier: string; redirectUri: string; state: string }) => Promise<void>, open = shell.openExternal, timeoutMs = 5 * 60_000) {
  cancelGoogle?.('Superseded by a new sign-in');
  const cfg = await api<{ enabled: boolean; clientId: string | null }>('GET', '/api/auth/google/config');
  if (!cfg.enabled || !cfg.clientId) throw new Error('Google sign-in is not set up on the server yet');
  const lb = await loopback(timeoutMs, '/oauth');
  cancelGoogle = lb.close;
  try {
    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    await api('POST', '/api/auth/google/start', { state });
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({ client_id: cfg.clientId, redirect_uri: lb.url, response_type: 'code', scope: 'openid email profile',
      code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' })) u.searchParams.set(k, v);
    await open(u.toString());
    const { q, respond } = await lb.wait;
    try {
      if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'Google sign-in was cancelled' : `Google error: ${q.get('error')}`);
      if (q.get('state') !== state) throw new Error('Sign-in state mismatch — try again');
      const code = q.get('code'); if (!code) throw new Error('Google sign-in failed (no code returned)');
      try { await exchange({ code, verifier, redirectUri: lb.url, state }); } catch (e) { throw googleError(e); }
      respond(true, 'Signed in to Desklist.');
    } catch (e) { respond(false, (e as Error).message); throw e; }
  } catch (e) { lb.close(); throw e; }
  finally { if (cancelGoogle === lb.close) cancelGoogle = null; }
}
