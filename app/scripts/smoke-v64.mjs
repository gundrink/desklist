/** 0.6.4 e2e: accounts (Railway) + admin binding / Settings / Team accounts / delete project (temp team on local server, real DB).
 *  Never logs codes or passwords. The real admin code is never redeemed. */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import readline from 'node:readline';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const RAILWAY = 'https://server-production-46b2.up.railway.app';
const ADMIN = fs.readFileSync('/workspace/desklist-release/ADMIN-CODE.txt', 'utf8').split('\n').map((l) => l.trim()).find((l) => /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(l));
const log = (...a) => console.log('[v64]', ...a);
const results = []; const check = (name, ok) => { results.push([name, !!ok]); log(ok ? 'PASS' : 'FAIL', name); };
const shot = (pg, n) => pg.screenshot({ path: path.join(shots, `v64-${n}.png`), omitBackground: true });
const R = Date.now().toString(36).slice(-5); const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
const api = async (base, token, method, p, body) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'] });
const local = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
const launch = (server) => electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'],
  env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: server, DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl64-')) } });
const adminTok = (await api(RAILWAY, null, 'POST', '/api/auth/signin', { code: ADMIN })).token;
let app; let memId;
const createAccount = async (w, user, code) => {
  await w.getByRole('tab', { name: 'Create account' }).click();
  await w.getByLabel('Username').fill(user); await w.getByLabel('Password', { exact: true }).fill(PW); await w.getByLabel('Confirm password').fill(PW);
  return async (shotName) => { if (shotName) await shot(w, shotName); await w.getByRole('button', { name: 'Create account' }).click(); await w.getByLabel('Admin code').waitFor({ timeout: 20000 }); };
};
const signOut = async (w) => { await w.getByLabel('Widget menu').click(); await w.getByRole('button', { name: /Sign out/ }).click(); await w.getByLabel('Username').waitFor({ timeout: 15000 }); };
try {
  // ---------- A: Railway, new member
  const mem = await api(RAILWAY, adminTok, 'POST', '/api/members', { name: `E2E Member v64 ${R}`, role: 'member' }); memId = mem.member.id;
  app = await launch(RAILWAY); let w = await app.firstWindow(); await w.getByLabel('Username').waitFor();
  check('sign-in: username + password, passkey alternative, no Google, no code field', await w.getByRole('button', { name: /Sign in with passkey/ }).isVisible() && (await w.getByRole('button', { name: /Google/ }).count()) === 0 && (await w.getByLabel('Personal code').count()) === 0);
  await shot(w, 'signin'); await shot(w, 'signin-passkey');
  const user = `e2e_v64_${R}`;
  let go = await createAccount(w, user); await go('create-account');
  await w.getByLabel('Admin code').fill(mem.code); await shot(w, 'enter-code');
  await w.getByRole('button', { name: 'Join' }).click(); await w.locator('.rail').waitFor({ timeout: 25000 }); check('new account + member code -> joined team', true);
  const nudge = w.locator('.pknudge'); await nudge.waitFor({ timeout: 8000 }).catch(() => {});
  check('passkey nudge shown after password sign-in (no passkey yet)', await nudge.isVisible()); if (await nudge.isVisible()) await nudge.getByRole('button', { name: 'Not now' }).click();
  await signOut(w);
  await w.getByLabel('Username').fill(user.toUpperCase()); await w.getByLabel('Password', { exact: true }).fill(PW); await w.getByRole('button', { name: 'Sign in', exact: true }).click();
  await w.locator('.rail').waitFor({ timeout: 25000 }); check('log out + back in with username/password (case-insensitive username)', true);
  check('nudge not shown again after "Not now"', (await w.locator('.pknudge').count()) === 0);
  await signOut(w);
  await w.getByLabel('Username').fill(user); await w.getByLabel('Password', { exact: true }).fill('wrong-password'); await w.getByRole('button', { name: 'Sign in', exact: true }).click();
  await w.locator('.signin .err').waitFor({ timeout: 15000 }); check('wrong password -> "Wrong username or password"', (await w.locator('.signin .err').textContent()).includes('Wrong username or password'));
  go = await createAccount(w, `e2e_v64_${R}b`); await go();
  await w.getByLabel('Admin code').fill(mem.code); await w.getByRole('button', { name: 'Join' }).click();
  await w.locator('.signin .err').waitFor({ timeout: 15000 }); check('reused code rejected', /already linked/.test(await w.locator('.signin .err').textContent()));
  check('direct code sign-in blocked for a joined member', (await fetch(RAILWAY + '/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: mem.code }) })).status === 403);
  await app.close(); app = null;

  // ---------- B: temp team on local server (real DB): admin code binds to existing admin
  app = await launch(local.base); w = await app.firstWindow(); await w.getByLabel('Username').waitFor();
  go = await createAccount(w, `e2e_v64_${R}adm`); await go();
  await w.getByLabel('Admin code').fill(local.code); await w.getByRole('button', { name: 'Join' }).click(); await w.locator('.rail').waitFor({ timeout: 25000 });
  const st = await app.evaluate(() => globalThis.__desklist.state());
  check('admin code binds to the existing admin member (role admin, same member)', st.snapshot.me.role === 'admin' && st.snapshot.me.name === 'E2E Google Admin');
  await w.locator('.pknudge button', { hasText: 'Not now' }).click().catch(() => {});
  const ltok = (await api(local.base, null, 'POST', '/api/accounts/login', { username: `e2e_v64_${R}adm`, password: PW })).token;
  const m2 = await api(local.base, ltok, 'POST', '/api/members', { name: 'Joined Member', role: 'member' });
  const s2 = await api(local.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}m2`, password: PW }); await api(local.base, null, 'POST', '/api/accounts/redeem', { accountToken: s2.accountToken, code: m2.code });
  await api(local.base, ltok, 'POST', '/api/members', { name: 'Pending Member', role: 'member' });
  const pr = await api(local.base, ltok, 'POST', '/api/projects', { name: `Delete me ${R}` }); const keep = await api(local.base, ltok, 'POST', '/api/projects', { name: `Keep ${R}` });
  const [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'project' }))]);
  await m.locator('.navbtn', { hasText: 'Team & codes' }).click();
  await m.locator('.accname[data-account="Joined Member"]', { hasText: `@e2e_v64_${R}m2` }).waitFor({ timeout: 15000 });
  check('Team: linked username + "Not joined yet"', (await m.locator('.accname[data-account="Pending Member"]').textContent()).includes('Not joined yet'));
  await m.locator('.mem-row', { hasText: 'Joined Member' }).getByRole('button', { name: 'Reset password' }).click();
  await m.locator('[data-temp]').waitFor({ timeout: 10000 }); check('admin reset password shows temporary password', true);
  await shot(m, 'team-accounts');
  await m.locator('.navbtn', { hasText: 'Settings' }).click(); await m.locator('.setcard[data-card="account"]').waitFor();
  check('Settings renders Account, Passkeys, Session', (await m.locator('.pkcard').count()) === 1 && (await m.locator('.setcard[data-card="session"]').textContent()).includes('expires'));
  const n0 = (await app.evaluate(() => globalThis.__desklist.opened.slice())).length;
  await m.getByRole('button', { name: '+ Add passkey' }).click();
  for (let i = 0; i < 40 && (await app.evaluate(() => globalThis.__desklist.opened.length)) === n0; i++) await m.waitForTimeout(250);
  const reg = new URL((await app.evaluate(() => globalThis.__desklist.opened.slice())).at(-1));
  check('Add passkey opens /passkey/register with ticket + loopback cb', reg.pathname === '/passkey/register' && reg.searchParams.get('ticket') && /127\.0\.0\.1/.test(reg.searchParams.get('cb')));
  await fetch(reg.searchParams.get('cb') + '?status=cancel').catch(() => {}); await m.waitForTimeout(800);
  check('passkey list/status renders', (await m.locator('.pkstatus').textContent()).includes('No passkeys yet'));
  await m.getByLabel('Current password').fill(PW); await m.getByLabel('New password', { exact: true }).fill(PW + 'x'); await m.getByLabel('Confirm new password').fill(PW + 'x');
  await m.getByRole('button', { name: 'Change password' }).click(); await m.locator('[data-msg="pw"]', { hasText: 'Password changed' }).waitFor({ timeout: 15000 }); check('change password in Settings', true);
  await shot(m, 'settings');
  // delete project (admin)
  await m.locator(`.gcard[data-project="Delete me ${R}"] .gname`).click(); await m.getByLabel('Project actions').click();
  await m.getByRole('button', { name: 'Delete project…' }).click(); await m.locator('.delmodal').waitFor();
  check('Delete disabled until name typed', await m.locator('.delmodal .btn.danger').isDisabled());
  await m.getByLabel('Type project name to confirm').fill(`Delete me ${R}`); await m.waitForTimeout(250); await shot(m, 'delete-project');
  await m.locator('.delmodal .btn.danger').click();
  await m.locator(`.gcard[data-project="Delete me ${R}"]`).waitFor({ state: 'detached', timeout: 15000 }); check('deleted project gone from Manage', true);
  await w.waitForTimeout(2500); check('deleted project gone from widget', (await w.locator('.rail', { hasText: `Delete me ${R}` }).count()) === 0 && (await w.locator('.rail', { hasText: `Keep ${R}` }).count()) === 1);
  const mt = (await api(local.base, null, 'POST', '/api/accounts/login', { username: `e2e_v64_${R}m2`, password: 'x' })); void mt;
  const memTok = (await api(local.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}m3`, password: PW }));
  void memTok; void keep;
} catch (e) { console.error('[v64] FAIL', e.message); results.push(['exception', false]); for (const [i, win] of (app?.windows() ?? []).entries()) await win.screenshot({ path: `/tmp/v64fail-${i}.png`, timeout: 5000 }).catch(() => {}); console.error(e.stack?.split('\n').slice(0, 4).join('\n')); }
finally {
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  try { if (memId) await api(RAILWAY, adminTok, 'DELETE', `/api/members/${memId}`); await api(RAILWAY, adminTok, 'POST', '/api/auth/signout'); log('railway test member + account deleted'); } catch (e) { log('cleanup error', e.message); }
  srvProc.kill('SIGTERM'); await new Promise((r) => srvProc.on('close', r));
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1;
}
