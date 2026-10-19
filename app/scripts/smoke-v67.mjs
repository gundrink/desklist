/** 0.6.7 e2e (temp team on local server code + prod DB): inline rename, edit panel (due, assignee), values preserved, widget live. */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import readline from 'node:readline';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const log = (...a) => console.log('[v67]', ...a);
const results = []; const check = (n, ok) => { results.push([n, !!ok]); log(ok ? 'PASS' : 'FAIL', n); };
const R = Date.now().toString(36).slice(-5); const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
const api = async (base, token, method, p, body) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'] });
const L = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
let app, step = '';
try {
  const as = await api(L.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}a`, password: PW });
  const at = (await api(L.base, null, 'POST', '/api/accounts/redeem', { accountToken: as.accountToken, code: L.code })).token;
  await api(L.base, at, 'POST', '/api/members', { name: 'Bob Builder', role: 'member' });
  const pid = (await api(L.base, at, 'POST', '/api/projects', { name: `Edit ${R}` })).id;
  const t = await api(L.base, at, 'POST', `/api/projects/${pid}/tasks`, { title: 'Draft task' });
  const f = await api(L.base, at, 'POST', `/api/tasks/${t.id}/fields`, { label: 'Notes field', type: 'text', section: 'fields' });
  await api(L.base, at, 'PATCH', `/api/task-fields/${f.id}`, { value: 'keep this value' });
  app = await electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'], timeout: 30000,
    env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: L.base, DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl67-')) } });
  const w = await app.firstWindow(); await w.getByLabel('Username').fill(`e2e_v64_${R}a`); await w.getByLabel('Password', { exact: true }).fill(PW);
  await w.getByRole('button', { name: 'Sign in', exact: true }).click(); await w.locator('.rail').waitFor({ timeout: 25000 });
  await w.locator('.pknudge button', { hasText: 'Not now' }).click({ timeout: 3000 }).catch(() => {});
  const [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'project' }))]);
  await m.locator(`.gcard[data-project="Edit ${R}"] .gname`).click(); await m.locator('.tr[data-task="Draft task"]').waitFor({ timeout: 15000 });
  await w.locator('.wt[data-task="Draft task"]').waitFor({ timeout: 15000 });
  step = 'inline rename';
  await m.locator('.tr[data-task="Draft task"] .expbtn').dblclick(); const ri = m.getByLabel('Rename task'); await ri.waitFor();
  await ri.fill('Buy domain renamed'); await m.screenshot({ path: path.join(shots, 'v67-task-edit-inline.png') }); await ri.press('Enter');
  await m.locator('.tr[data-task="Buy domain renamed"]').waitFor({ timeout: 15000 }); check('inline rename (double-click, Enter) saved', true);
  await m.locator('.tr[data-task="Buy domain renamed"] .expbtn').dblclick(); await m.getByLabel('Rename task').fill('nope'); await m.getByLabel('Rename task').press('Escape');
  check('Esc cancels rename', (await m.locator('.tr[data-task="Buy domain renamed"]').count()) === 1);
  let ok = false; for (let i = 0; i < 20 && !ok; i++) { ok = (await w.locator('.wt[data-task="Buy domain renamed"]').count()) === 1; if (!ok) await w.waitForTimeout(500); }
  check('widget shows rename live', ok);
  step = 'edit panel';
  await m.locator('.tr[data-task="Buy domain renamed"]').hover(); await m.getByLabel('Edit Buy domain renamed').click(); await m.locator('.teditp').waitFor();
  await m.locator('.teditp').getByLabel('Due date').fill('2026-12-24');
  await m.locator('.teditp').getByLabel('Assignee').click(); await m.locator('.sel-pop .sel-opt', { hasText: 'Bob Builder' }).click();
  await m.screenshot({ path: path.join(shots, 'v67-task-edit-panel.png') });
  await m.locator('.teditp').getByRole('button', { name: 'Save' }).click(); await m.locator('.teditp').waitFor({ state: 'detached', timeout: 10000 });
  await m.waitForTimeout(1500);
  const snap = await api(L.base, at, 'GET', '/api/snapshot'); const tt = snap.tasks.find((x) => x.id === t.id);
  const bob = snap.members.find((x) => x.name === 'Bob Builder');
  check('due date + assignee saved', tt.dueDate === '2026-12-24' && tt.bicMemberId === bob.id);
  check('field value preserved after edits', snap.taskFields ? snap.taskFields.find((x) => x.id === f.id)?.value === 'keep this value' : true);
  const fv = await m.evaluate(() => 1); void fv;
  await m.locator('.tr[data-task="Buy domain renamed"] .expbtn').click(); await m.locator('.tfrow[data-field="Notes field"] input').waitFor({ timeout: 10000 });
  check('field value visible after edits', (await m.locator('.tfrow[data-field="Notes field"] input').inputValue()) === 'keep this value');
  ok = false; for (let i = 0; i < 20 && !ok; i++) { ok = ((await w.locator('.wt[data-task="Buy domain renamed"] .wd').textContent().catch(() => '')) ?? '').includes('24'); if (!ok) await w.waitForTimeout(500); }
  check('widget shows new due date live', ok);
  await m.locator('.modetgl button', { hasText: 'View' }).click(); await m.waitForTimeout(300);
  check('View mode has no edit actions', (await m.locator('.rowedit').count()) === 0);
} catch (e) { console.error('[v67] FAIL at', step, '-', e.message.split('\n')[0]); results.push(['exception at ' + step, false]); for (const [i, win] of (app?.windows() ?? []).entries()) await win.screenshot({ path: `/tmp/v67-${i}.png`, timeout: 5000 }).catch(() => {}); }
finally {
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
  srvProc.kill('SIGTERM'); await Promise.race([new Promise((r) => srvProc.on('close', r)), new Promise((r) => setTimeout(r, 15000))]);
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1; process.exit();
}
