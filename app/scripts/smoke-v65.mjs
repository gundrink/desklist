/** 0.6.5 e2e on a temp team (local server code, same prod DB; user's data untouched): template step from Task setup + project description. */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import readline from 'node:readline';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const log = (...a) => console.log('[v65]', ...a);
const results = []; const check = (n, ok) => { results.push([n, !!ok]); log(ok ? 'PASS' : 'FAIL', n); };
const R = Date.now().toString(36).slice(-5); const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
const api = async (base, token, method, p, body) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'] });
const L = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
const launch = () => electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'], timeout: 30000,
  env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: L.base, DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl65-')) } });
const login = async (w, u) => { await w.getByLabel('Username').fill(u); await w.getByLabel('Password', { exact: true }).fill(PW); await w.getByRole('button', { name: 'Sign in', exact: true }).click(); await w.locator('.rail').waitFor({ timeout: 25000 }); await w.locator('.pknudge button', { hasText: 'Not now' }).click({ timeout: 3000 }).catch(() => {}); };
let A, B, step = '';
try {
  step = 'setup';
  const as = await api(L.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}a`, password: PW });
  const at = (await api(L.base, null, 'POST', '/api/accounts/redeem', { accountToken: as.accountToken, code: L.code })).token;
  const mm = await api(L.base, at, 'POST', '/api/members', { name: 'Desc Member', role: 'member' });
  const ms = await api(L.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}m`, password: PW }); await api(L.base, null, 'POST', '/api/accounts/redeem', { accountToken: ms.accountToken, code: mm.code });
  await api(L.base, at, 'PUT', '/api/task-setups', { title: 'Beli Domain', fields: [{ label: 'Domain', type: 'url' }, { label: 'Amount', type: 'amount', reimbursement: true }] });
  await api(L.base, at, 'PUT', '/api/task-setups', { title: 'Buat Akun X', fields: [{ label: 'Username', type: 'text' }, { label: 'Password', type: 'password' }] });
  step = 'admin create project';
  A = await launch(); const aw = await A.firstWindow(); await aw.getByLabel('Username').waitFor(); await login(aw, `e2e_v64_${R}a`);
  const [m] = await Promise.all([A.waitForEvent('window'), A.evaluate(() => globalThis.__desklist.openManage({ view: 'create' }))]);
  const NAME = `Launch ${R}`; const DESC = 'Goal: launch the site.\nScope: domain + X account.';
  await m.getByLabel('Project name').fill(NAME); await m.getByLabel('Project description').fill(DESC);
  await m.getByRole('button', { name: 'Create project' }).click(); await m.locator('.setupmodal').waitFor({ timeout: 15000 });
  await m.locator('.setuprow[data-setup="Beli Domain"]').waitFor({ timeout: 10000 });
  check('template step lists configured tasks with counts', (await m.locator('.setuprow[data-setup="Beli Domain"] .tc').textContent()) === '1 fields · 1 reimbursement' && (await m.locator('.setuprow').count()) === 2);
  await m.getByRole('button', { name: 'Select all' }).click();
  await m.locator('.selrow[data-sel="Buat Akun X"]').getByLabel('Move up').click();
  check('reorder: Buat Akun X first', (await m.locator('.selrow .tn').first().textContent()) === 'Buat Akun X');
  await m.screenshot({ path: path.join(shots, 'v65-template-from-setup.png') });
  await m.getByRole('button', { name: /Create 2 tasks/ }).click(); await m.locator('.setupmodal').waitFor({ state: 'detached', timeout: 15000 });
  await m.locator('.tr[data-task="Beli Domain"]').waitFor({ timeout: 15000 }); await m.locator('.tr[data-task="Buat Akun X"]').waitFor();
  await m.locator('.tr[data-task="Buat Akun X"] .expbtn').click(); await m.locator('.tfrow[data-field="Password"]').waitFor({ timeout: 10000 });
  check('created tasks carry admin fields (Buat Akun X: Username, Password)', (await m.locator('.tfrow[data-field="Username"]').count()) === 1);
  await m.locator('.tpanel .tpx').click();
  step = 'member sees description';
  B = await launch(); const bw = await B.firstWindow(); await bw.getByLabel('Username').waitFor(); await login(bw, `e2e_v64_${R}m`);
  const [bm] = await Promise.all([B.waitForEvent('window'), B.evaluate(() => globalThis.__desklist.openManage({ view: 'project' }))]);
  await bm.locator(`.gcard[data-project="${NAME}"] .gname`).click(); await bm.locator('.pdesc .pdesc-t').waitFor({ timeout: 15000 });
  check('member sees description in detail (read-only, copy button)', (await bm.locator('.pdesc .pdesc-t').textContent()) === DESC && (await bm.locator('.pdesc textarea').count()) === 0 && (await bm.locator('.pdesc .copybtn').count()) === 1);
  await bw.locator('.rail').getByText(NAME).click().catch(() => {}); await bw.locator('[data-desc]').waitFor({ timeout: 10000 });
  check('member sees description line in widget', (await bw.locator('[data-desc] .wdesc-t').textContent()).startsWith('Goal: launch'));
  step = 'admin edits';
  const ta = m.getByLabel('Edit project description'); await ta.fill(DESC + '\nLinks: example.com'); await ta.blur();
  let ok = false; for (let i = 0; i < 30 && !ok; i++) { ok = ((await bm.locator('.pdesc .pdesc-t').textContent()) ?? '').includes('Links: example.com'); if (!ok) await bm.waitForTimeout(500); }
  check('admin edit syncs live to member', ok);
  await bm.screenshot({ path: path.join(shots, 'v65-project-description.png') });
  check('member cannot edit description (server 403)', (await (await fetch(L.base + '/api/projects/' + (await api(L.base, at, 'GET', '/api/snapshot')).projects.find((p) => p.name === NAME).id, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await api(L.base, null, 'POST', '/api/accounts/login', { username: `e2e_v64_${R}m`, password: PW })).token }, body: JSON.stringify({ notes: 'x' }) })).status) === 403);
} catch (e) { console.error('[v65] FAIL at', step, '-', e.message.split('\n')[0]); results.push(['exception at ' + step, false]); for (const [i, win] of [...(A?.windows() ?? []), ...(B?.windows() ?? [])].entries()) await win.screenshot({ path: `/tmp/v65-${i}.png`, timeout: 5000 }).catch(() => {}); }
finally {
  for (const x of [A, B]) await Promise.race([x?.close().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
  srvProc.kill('SIGTERM'); await Promise.race([new Promise((r) => srvProc.on('close', r)), new Promise((r) => setTimeout(r, 15000))]);
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1; process.exit();
}
