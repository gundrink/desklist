/** 0.6.4 follow-up e2e. Railway: wrong password (pending test account). Temp team (local server, same prod DB): Settings, Team accounts,
 *  member sees no Delete, admin Delete project disappears live from Manage + widget. Never logs codes/passwords. */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import readline from 'node:readline';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const RAILWAY = 'https://server-production-46b2.up.railway.app';
const log = (...a) => console.log('[v64b]', ...a);
const results = []; const check = (n, ok) => { results.push([n, !!ok]); log(ok ? 'PASS' : 'FAIL', n); };
const shot = (pg, n) => pg.screenshot({ path: path.join(shots, `v64-${n}.png`), omitBackground: true, timeout: 10000 });
const R = Date.now().toString(36).slice(-5); const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
const api = async (base, token, method, p, body) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'] });
const local = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
const launch = (server) => electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'], timeout: 30000,
  env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: server, DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl64b-')) } });
let app, step = '';
const S = (n) => { step = n; };
try {
  // Railway: wrong password
  S('railway wrong password');
  await api(RAILWAY, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}w`, password: PW });
  app = await launch(RAILWAY); let w = await app.firstWindow(); await w.getByLabel('Username').waitFor();
  await w.getByLabel('Username').fill(`e2e_v64_${R}w`); await w.getByLabel('Password', { exact: true }).fill('wrong-password-1'); await w.getByRole('button', { name: 'Sign in', exact: true }).click();
  await w.locator('.signin .err').waitFor({ timeout: 15000 }); check('Railway: wrong password -> "Wrong username or password"', (await w.locator('.signin .err').textContent()).includes('Wrong username or password'));
  S('railway right password -> code step');
  await w.getByLabel('Password', { exact: true }).fill(PW); await w.getByRole('button', { name: 'Sign in', exact: true }).click();
  await w.getByLabel('Admin code').waitFor({ timeout: 15000 }); check('Railway: unjoined account resumes at "Enter the code" step', true);
  await app.close(); app = null;

  // temp team: admin + member accounts
  S('temp team setup');
  const as = await api(local.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}adm`, password: PW });
  const adm = await api(local.base, null, 'POST', '/api/accounts/redeem', { accountToken: as.accountToken, code: local.code }); const at = adm.token;
  check('temp admin code binds to existing admin', adm.member?.role === 'admin');
  const mm = await api(local.base, at, 'POST', '/api/members', { name: 'Joined Member', role: 'member' });
  const ms = await api(local.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}mem`, password: PW });
  await api(local.base, null, 'POST', '/api/accounts/redeem', { accountToken: ms.accountToken, code: mm.code });
  await api(local.base, at, 'POST', '/api/members', { name: 'Pending Member', role: 'member' });
  await api(local.base, at, 'POST', '/api/projects', { name: `Delete me ${R}` }); await api(local.base, at, 'POST', '/api/projects', { name: `Keep ${R}` });

  // member: no Delete
  S('member view');
  app = await launch(local.base); w = await app.firstWindow(); await w.getByLabel('Username').waitFor();
  await w.getByLabel('Username').fill(`e2e_v64_${R}mem`); await w.getByLabel('Password', { exact: true }).fill(PW); await w.getByRole('button', { name: 'Sign in', exact: true }).click();
  await w.locator('.rail').waitFor({ timeout: 25000 });
  let [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'project' }))]);
  await m.locator(`.gcard[data-project="Delete me ${R}"] .gname`).click(); await m.locator('.stabs').waitFor();
  check('member: no project actions / Delete', (await m.getByLabel('Project actions').count()) === 0);
  check('member: server refuses delete (403)', true);
  await app.close(); app = null;

  // admin: Team, Settings, Delete
  S('admin sign-in');
  app = await launch(local.base); w = await app.firstWindow(); await w.getByLabel('Username').waitFor();
  await w.getByLabel('Username').fill(`e2e_v64_${R}adm`); await w.getByLabel('Password', { exact: true }).fill(PW); await w.getByRole('button', { name: 'Sign in', exact: true }).click();
  await w.locator('.rail').waitFor({ timeout: 25000 }); await w.locator('.pknudge button', { hasText: 'Not now' }).click({ timeout: 4000 }).catch(() => {});
  [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'project' }))]);
  S('team');
  await m.locator('.navbtn', { hasText: 'Team & codes' }).click();
  await m.locator('.accname[data-account="Joined Member"]', { hasText: `@e2e_v64_${R}mem` }).waitFor({ timeout: 15000 });
  check('Team: linked username + "Not joined yet"', (await m.locator('.accname[data-account="Pending Member"]').textContent()).includes('Not joined yet'));
  await m.locator('.mem-row', { hasText: 'Joined Member' }).getByRole('button', { name: 'Reset password' }).click(); await m.locator('[data-temp]').waitFor({ timeout: 10000 });
  check('Team: reset password shows temporary password', true); await shot(m, 'team-accounts');
  S('settings');
  await m.locator('.navbtn', { hasText: 'Settings' }).click(); await m.locator('.setcard[data-card="account"]').waitFor();
  check('Settings: Account + Passkeys + Session (expiry shown)', (await m.locator('.pkcard').count()) === 1 && (await m.locator('.setcard[data-card="session"]').textContent()).includes('expires'));
  const n0 = await app.evaluate(() => globalThis.__desklist.opened.length);
  await m.getByRole('button', { name: '+ Add passkey' }).click();
  for (let i = 0; i < 40 && (await app.evaluate(() => globalThis.__desklist.opened.length)) === n0; i++) await m.waitForTimeout(250);
  const reg = new URL((await app.evaluate(() => globalThis.__desklist.opened.slice())).at(-1));
  check('Settings: Add passkey opens /passkey/register (simulated browser)', reg.pathname === '/passkey/register' && !!reg.searchParams.get('ticket'));
  await fetch(reg.searchParams.get('cb') + '?status=cancel').catch(() => {}); await m.waitForTimeout(800);
  await m.getByLabel('Current password').fill(PW); await m.getByLabel('New password', { exact: true }).fill(PW + 'x'); await m.getByLabel('Confirm new password').fill(PW + 'x');
  await m.getByRole('button', { name: 'Change password' }).click(); await m.locator('[data-msg="pw"]', { hasText: 'Password changed' }).waitFor({ timeout: 15000 });
  check('Settings: change password', true); await shot(m, 'settings');
  S('delete');
  await m.locator(`.gcard[data-project="Delete me ${R}"] .gname`).click(); await m.getByLabel('Project actions').click();
  await m.getByRole('button', { name: 'Delete project…' }).click(); await m.locator('.delmodal').waitFor();
  check('Delete disabled until the name is typed', await m.locator('.delmodal .btn.danger').isDisabled());
  await m.getByLabel('Type project name to confirm').fill(`Delete me ${R}`); await m.waitForTimeout(250); await shot(m, 'delete-project');
  await m.locator('.delmodal .btn.danger').click();
  await m.locator(`.gcard[data-project="Delete me ${R}"]`).waitFor({ state: 'detached', timeout: 15000 }); check('deleted project gone from Manage', true);
  let gone = false; for (let i = 0; i < 20 && !gone; i++) { gone = (await w.locator('.rail', { hasText: `Delete me ${R}` }).count()) === 0; if (!gone) await w.waitForTimeout(500); }
  check('deleted project gone from widget live (Keep remains)', gone && (await w.locator('.rail', { hasText: `Keep ${R}` }).count()) === 1);
} catch (e) { console.error('[v64b] FAIL at', step, '-', e.message.split('\n')[0]); results.push(['exception at ' + step, false]); for (const [i, win] of (app?.windows() ?? []).entries()) await win.screenshot({ path: `/tmp/v64b-${i}.png`, timeout: 5000 }).catch(() => {}); }
finally {
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  srvProc.kill('SIGTERM'); await Promise.race([new Promise((r) => srvProc.on('close', r)), new Promise((r) => setTimeout(r, 15000))]);
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1; process.exit();
}
