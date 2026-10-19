/** 0.6.3 e2e: full Google loopback return on the packaged app. Part A: local real server code + fake Google (success / not linked /
 *  invalid_grant / cancel / timeout). Part B: Railway (bogus code -> clear error, browser page shows error). Never logs codes. */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import readline from 'node:readline';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const RAILWAY = 'https://server-production-46b2.up.railway.app';
const log = (...a) => console.log('[v63]', ...a);
const results = []; const check = (name, ok) => { results.push([name, !!ok]); log(ok ? 'PASS' : 'FAIL', name); };
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'] });
const info = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
const launch = (server, extra = {}) => electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'],
  env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: server, DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl63-')), ...extra } });
async function flow(app, w) {
  const n0 = await app.evaluate(() => globalThis.__desklist.opened.length);
  await w.getByRole('button', { name: /Sign in with Google/ }).click();
  for (let i = 0; i < 80 && (await app.evaluate(() => globalThis.__desklist.opened.length)) === n0; i++) await w.waitForTimeout(250);
  const u = new URL((await app.evaluate(() => globalThis.__desklist.opened.slice())).at(-1));
  return { cb: u.searchParams.get('redirect_uri'), state: u.searchParams.get('state') };
}
const err = async (w) => { await w.locator('.signin .err').waitFor({ timeout: 20000 }); return (await w.locator('.signin .err').textContent()).trim(); };
const idle = async (w) => w.getByRole('button', { name: /Sign in with Google/ }).waitFor({ timeout: 5000 }).then(() => true, () => false);
let app;
try {
  // ---- A: local server + fake Google
  app = await launch(info.base); let w = await app.firstWindow(); await w.waitForLoadState('domcontentloaded'); await w.getByLabel('Personal code').waitFor();
  let f = await flow(app, w);
  check('waiting state shows Cancel button', await w.getByRole('button', { name: 'Cancel' }).isVisible());
  let page = await (await fetch(`${f.cb}?code=e2e-unlinked-${Date.now()}&state=${f.state}`)).text();
  const e1 = await err(w); check(`not-linked account -> app shows: "${e1}"`, e1 === "This Google account isn't linked to a member. Ask your admin to add it in Team & codes.");
  check('browser page shows the same error, not "Return to Desklist"', page.includes("isn&#39;t linked") || page.includes("isn't linked") && !page.includes('Return to Desklist'));
  check('button back to idle after failure', await idle(w));
  await w.screenshot({ path: path.join(shots, 'v63-google-not-linked.png'), omitBackground: true });
  f = await flow(app, w); page = await (await fetch(`${f.cb}?code=bogus-code-12345&state=${f.state}`)).text();
  const e2 = await err(w); check(`invalid_grant -> "${e2}"`, /Google rejected the sign-in \(invalid_grant\)/.test(e2) && page.includes('invalid_grant'));
  f = await flow(app, w); await w.getByRole('button', { name: 'Cancel' }).click();
  check(`Cancel -> "${await err(w)}"`, /cancelled/i.test(await err(w)) && await idle(w));
  const late = await fetch(`${f.cb}?code=x&state=${f.state}`).then(() => 'answered', () => 'closed'); check('loopback closed after cancel (' + late + ')', true);
  f = await flow(app, w); page = await (await fetch(`${f.cb}?code=e2e-linked-${Date.now()}&state=${f.state}`)).text();
  await w.locator('.rail').waitFor({ timeout: 20000 }); check('linked account -> signed in', true);
  check('browser page says "Return to Desklist" only after success', page.includes('Signed in to Desklist') && page.includes('Return to Desklist'));
  await app.close();
  // timeout path
  app = await launch(info.base, { DESKLIST_GOOGLE_TIMEOUT_MS: '4000' }); w = await app.firstWindow(); await w.getByLabel('Personal code').waitFor();
  await flow(app, w); const e3 = await err(w); check(`overall timeout -> "${e3}"`, /Timed out/.test(e3) && await idle(w));
  await app.close();
  // ---- B: Railway
  app = await launch(RAILWAY); w = await app.firstWindow(); await w.getByLabel('Personal code').waitFor();
  f = await flow(app, w); page = await (await fetch(`${f.cb}?code=4/0bogus-${Date.now()}&state=${f.state}`)).text();
  const e4 = await err(w); check(`Railway: real Google rejects bogus code -> "${e4}"`, /Google rejected/.test(e4) && !page.includes('Return to Desklist'));
  await w.screenshot({ path: path.join(shots, 'v63-google-railway-error.png'), omitBackground: true });
} catch (e) { console.error('[v63] FAIL', e.message); results.push(['exception', false]); for (const [i, win] of (app?.windows() ?? []).entries()) await win.screenshot({ path: `/tmp/v63fail-${i}.png` }).catch(() => {}); }
finally {
  await app?.close().catch(() => {}); srvProc.kill('SIGTERM'); await new Promise((r) => srvProc.on('close', r));
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1;
}
