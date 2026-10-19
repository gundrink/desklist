/**
 * Passkey flows via the system browser (WebAuthn needs the server's https origin; file:// can't do it).
 * A one-shot loopback HTTP server on 127.0.0.1:<random> receives the redirect back from the server page.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { shell } from 'electron';

const DONE_HTML = (msg: string) => `<!doctype html><meta charset="utf-8"><title>Desklist</title><body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh"><div style="text-align:center"><h2>Desklist</h2><p>${msg}</p><p style="color:#777">You can close this tab and return to the app.</p></div>`;

/** Start a loopback listener; resolves with the query params of the first hit on /passkey. */
export function loopback(timeoutMs = 5 * 60_000): Promise<{ url: string; wait: Promise<URLSearchParams>; close: () => void }> {
  return new Promise((resolve, reject) => {
    let done: (q: URLSearchParams) => void; let fail: (e: Error) => void;
    const wait = new Promise<URLSearchParams>((a, b) => { done = a; fail = b; });
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/passkey') { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get('status') === 'ok' || u.searchParams.has('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_HTML(ok ? 'Done — returning to Desklist.' : 'Something went wrong.'));
      done(u.searchParams); setTimeout(() => srv.close(), 200);
    });
    const timer = setTimeout(() => { fail(new Error('Passkey timed out — try again.')); srv.close(); }, timeoutMs);
    wait.finally(() => clearTimeout(timer)).catch(() => {});
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}/passkey`, wait, close: () => { srv.close(); fail(new Error('Cancelled')); } });
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
