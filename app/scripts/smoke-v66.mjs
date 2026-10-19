/** 0.6.6 e2e (temp team on local server code + prod DB; user's data untouched): theme, sign-in, Select, chips, full labels, tabs, widget. */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import readline from 'node:readline';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const log = (...a) => console.log('[v66]', ...a);
const results = []; const check = (n, ok) => { results.push([n, !!ok]); log(ok ? 'PASS' : 'FAIL', n); };
const shot = (pg, n) => pg.screenshot({ path: path.join(shots, `v66-${n}.png`), timeout: 10000 });
const R = Date.now().toString(36).slice(-5); const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
const api = async (base, token, method, p, body) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'] });
const L = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
let app, step = '';
const LONG = 'Deploy server provider for production';
try {
  app = await electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'], timeout: 30000,
    env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: L.base, DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl66-')) } });
  const w = await app.firstWindow(); await w.getByLabel('Username').waitFor();
  step = 'signin';
  check('sign-in: logo + "Welcome back" + show/hide', await w.locator('.signin .dl-brand').isVisible() && (await w.locator('.signin h2').textContent()) === 'Welcome back' && await w.getByLabel('Show password').isVisible());
  check('no grayscale filter anywhere', await w.evaluate(() => getComputedStyle(document.documentElement).filter === 'none'));
  await w.screenshot({ path: path.join(shots, 'v66-signin.png'), omitBackground: true });
  await w.getByRole('tab', { name: 'Create account' }).click(); await w.waitForTimeout(300);
  check('tab switch -> "Create your account"', (await w.locator('.signin h2').textContent()) === 'Create your account');
  await w.getByLabel('Username').fill(`e2e_v64_${R}a`); await w.getByLabel('Password', { exact: true }).fill(PW); await w.getByLabel('Confirm password').fill(PW);
  await w.screenshot({ path: path.join(shots, 'v66-create-account.png'), omitBackground: true });
  await w.getByRole('button', { name: 'Create account' }).click(); await w.getByLabel('Admin code').fill(L.code); await w.getByRole('button', { name: 'Join' }).click();
  await w.locator('.rail').waitFor({ timeout: 25000 }); await w.locator('.pknudge button', { hasText: 'Not now' }).click({ timeout: 3000 }).catch(() => {});
  const at = (await api(L.base, null, 'POST', '/api/accounts/login', { username: `e2e_v64_${R}a`, password: PW })).token;
  step = 'task setup chips';
  const [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'tasksetup' }))]);
  await m.locator('.adminrow', { hasText: 'Task setup' }).click(); await m.getByLabel('Setup task name').fill('Deploy Website');
  await m.getByRole('button', { name: '+ Add field' }).click(); await m.getByLabel('Field 1 name').fill(LONG);
  await m.getByLabel('Field 1 type').click(); await m.locator('.sel-pop .sel-opt', { hasText: /^Dropdown/ }).click();
  const ci = m.getByLabel('Field 1 options'); await ci.click(); await m.keyboard.type('Railway,Vercel,'); await m.keyboard.type('Netlify'); await m.keyboard.press('Enter');
  const chips = await m.locator('.chip').evaluateAll((e) => e.map((x) => x.getAttribute('data-chip')));
  check('typing commas creates chips: ' + chips.join('|'), chips.join('|') === 'Railway|Vercel|Netlify');
  await ci.evaluate((el, t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, 'Fly, Render');
  await m.waitForTimeout(200); check('paste "Fly, Render" splits into chips', (await m.locator('.chip').count()) === 5);
  await m.locator('.chip[data-chip="Render"] button').click(); check('chip removable', (await m.locator('.chip').count()) === 4);
  await shot(m, 'options-chips');
  await m.getByRole('button', { name: '+ Add field' }).click(); await m.getByLabel('Field 2 name').fill('Env');
  await m.getByRole('button', { name: 'Save setup' }).click(); await m.locator('.callout', { hasText: 'Saved' }).waitFor({ timeout: 15000 });
  step = 'project + task detail';
  const pr = await api(L.base, at, 'POST', '/api/projects', { name: `Site ${R}` }); const pid = pr.id ?? pr.project?.id;
  await api(L.base, at, 'POST', `/api/projects/${pid}/tasks`, { title: 'Deploy Website' }); await api(L.base, at, 'POST', '/api/projects', { name: `Other ${R}` });
  await m.locator(`.gcard[data-project="Site ${R}"] .gname`).click({ timeout: 20000 }); await m.locator('.tr[data-task="Deploy Website"]').waitFor({ timeout: 15000 });
  await shot(m, 'manage');
  await m.locator('.tr[data-task="Deploy Website"] .expbtn').click(); const row = m.locator(`.tfrow[data-field="${LONG}"]`); await row.waitFor({ timeout: 10000 });
  const lab = await row.locator('.tflab b').evaluate((b) => ({ t: b.textContent, clipped: b.scrollWidth > b.clientWidth + 1, ell: getComputedStyle(b).textOverflow }));
  check('long field label rendered in full (no ellipsis)', lab.t === LONG && !lab.clipped && lab.ell !== 'ellipsis');
  await shot(m, 'task-detail-fields');
  step = 'select manage';
  const sel = row.locator('.selx'); await sel.click(); await m.locator('.sel-pop').waitFor();
  check('Select opens a portaled themed popover', await m.evaluate(() => document.querySelector('.sel-pop')?.parentElement === document.body) && (await m.locator('.sel-pop .sel-opt').count()) >= 4);
  await m.locator('.sel-pop .sel-opt', { hasText: 'Railway' }).hover(); await shot(m, 'select-open');
  await m.locator('.sel-pop .sel-opt', { hasText: 'Railway' }).click(); await m.waitForTimeout(1200);
  check('mouse pick -> Railway', (await sel.textContent()).includes('Railway'));
  await sel.focus(); await m.keyboard.press('ArrowDown'); await m.locator('.sel-pop').waitFor(); await m.keyboard.press('ArrowDown'); await m.keyboard.press('Enter'); await m.waitForTimeout(1500);
  check('keyboard (ArrowDown, Enter) -> Vercel', (await sel.textContent()).includes('Vercel'));
  await sel.focus(); await m.keyboard.press('Enter'); await m.keyboard.press('Escape'); check('Esc closes popover', (await m.locator('.sel-pop').count()) === 0);
  const snap = await api(L.base, at, 'GET', '/api/snapshot'); void snap;
  step = 'tabs';
  await m.locator('.ptabs button', { hasText: 'Done' }).click(); await m.waitForTimeout(300); check('project tabs switch to Done', await m.locator('.ptabs.idx-1').count() === 1);
  await m.locator('.ptabs button', { hasText: 'In progress' }).click(); await m.waitForTimeout(300);
  await m.locator('.modetgl button', { hasText: 'View' }).click(); await m.waitForTimeout(300); check('Edit/View toggle switches', await m.locator('.modetgl.idx-1').count() === 1);
  await m.locator('.modetgl button', { hasText: 'Edit' }).click();
  await m.locator('.pcol').screenshot({ path: path.join(shots, 'v66-tabs.png') });
  step = 'widget select';
  await w.locator('.rail').getByText(`Site ${R}`).click().catch(() => {}); await w.locator('.wt', { hasText: 'Deploy Website' }).waitFor({ timeout: 15000 });
  await w.locator('.wt[data-task="Deploy Website"]').getByText('Deploy Website').click(); await w.waitForTimeout(500);
  const wsel = w.locator(`.tfrow[data-field="${LONG}"] .selx`);
  if (await wsel.count()) {
    await wsel.click(); await w.locator('.sel-pop').waitFor(); await w.locator('.sel-pop .sel-opt', { hasText: 'Netlify' }).click(); await w.waitForTimeout(1200);
    check('widget: Select works with mouse', (await wsel.textContent()).includes('Netlify'));
    await wsel.focus(); await w.keyboard.press('ArrowUp'); await w.keyboard.press('ArrowUp'); await w.keyboard.press('Enter'); await w.waitForTimeout(1200);
    check('widget: Select works with keyboard', (await wsel.textContent()).includes('Vercel'));
    const ti = w.getByLabel(/New task/).first(); if (await ti.count()) { await ti.click(); await w.keyboard.type('abc'); check('widget typing focus intact after Select', (await ti.inputValue()).endsWith('abc')); }
  } else check('widget task detail opened', false);
  await w.screenshot({ path: path.join(shots, 'v66-widget.png'), omitBackground: true });
} catch (e) { console.error('[v66] FAIL at', step, '-', e.message.split('\n')[0]); results.push(['exception at ' + step, false]); for (const [i, win] of (app?.windows() ?? []).entries()) await win.screenshot({ path: `/tmp/v66-${i}.png`, timeout: 5000 }).catch(() => {}); }
finally {
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
  srvProc.kill('SIGTERM'); await Promise.race([new Promise((r) => srvProc.on('close', r)), new Promise((r) => setTimeout(r, 15000))]);
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1; process.exit();
}
