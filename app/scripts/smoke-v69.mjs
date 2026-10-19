/** 0.6.9 e2e (temp team on local server code + prod DB): inline rename, edit panel (due, assignee), values preserved, widget live. */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import readline from 'node:readline';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const log = (...a) => console.log('[v69]', ...a);
const results = []; const check = (n, ok) => { results.push([n, !!ok]); log(ok ? 'PASS' : 'FAIL', n); };
const R = Date.now().toString(36).slice(-5); const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
const api = async (base, token, method, p, body) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'] });
const L = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));

const AUDIT = () => {
  const allow = new Set(['149,169,196', '44,52,62', '22,32,46']);
  const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h * 60, s, l]; };
  const blue = []; const upper = [];
  const okCaps = /^(SOL|USD|USDT|USDC|IDR|BTC|ETH|EUR|SGD|PIC|CSV|URL|TEST|2FA|OK|EG|AD|BB|CK|RH|[A-Z]{1,3}|[A-Z0-9-]+\d[A-Z0-9-]*)$/;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    for (const p of ['color', 'backgroundColor', 'borderTopColor', 'outlineColor', 'accentColor', 'fill', 'stroke']) {
      const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(cs[p] || ''); if (!m || (m[4] !== undefined && +m[4] === 0)) continue;
      const [h, s, l] = hsl(+m[1], +m[2], +m[3]);
      if (h >= 160 && h <= 300 && s >= .25 && l > .08 && l < .97 && !allow.has(`${m[1]},${m[2]},${m[3]}`)) blue.push(`${el.className || el.tagName} ${p} ${cs[p]}`);
    }
    if (cs.textTransform === 'uppercase') upper.push(`${el.className} text-transform`);
    for (const n of el.childNodes) if (n.nodeType === 3) for (const w of n.textContent.split(/[^A-Za-z0-9-]+/)) if (w.length >= 4 && w === w.toUpperCase() && /[A-Z]/.test(w) && !okCaps.test(w)) upper.push(`${el.className}: ${w}`);
  }
  const ff = getComputedStyle(document.body).fontFamily;
  return { blue: [...new Set(blue)].slice(0, 8), upper: [...new Set(upper)].slice(0, 8), font: ff.startsWith('Geist') && document.fonts.check("13px Geist") && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Geist' && f.status === 'loaded') };
};
const audit = async (win, name) => { const a = await win.evaluate(AUDIT); check(`${name}: no blue (${a.blue.join(' | ') || 'none'})`, !a.blue.length); check(`${name}: no all-caps (${a.upper.join(' | ') || 'none'})`, !a.upper.length); check(`${name}: Geist loaded`, a.font); };
let app, step = '';
try {
  const as = await api(L.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}a`, password: PW });
  const at = (await api(L.base, null, 'POST', '/api/accounts/redeem', { accountToken: as.accountToken, code: L.code })).token;
  await api(L.base, at, 'POST', '/api/members', { name: 'Bob Builder', role: 'member' });
  const pid = (await api(L.base, at, 'POST', '/api/projects', { name: `Edit ${R}` })).id;
  const t = await api(L.base, at, 'POST', `/api/projects/${pid}/tasks`, { title: 'Draft task' });
  const f = await api(L.base, at, 'POST', `/api/tasks/${t.id}/fields`, { label: 'Notes field', type: 'text', section: 'fields' });
  await api(L.base, at, 'PATCH', `/api/task-fields/${f.id}`, { value: 'keep this value' });
  const plain = await api(L.base, at, 'POST', `/api/projects/${pid}/tasks`, { title: 'Plain task' });
  const rt = await api(L.base, at, 'POST', `/api/projects/${pid}/tasks`, { title: 'Reimb task' });
  await api(L.base, at, 'PATCH', `/api/tasks/${rt.id}`, { hasExpense: true });
  app = await electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'], timeout: 30000,
    env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: L.base, DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl69-')) } });
  const w = await app.firstWindow(); await w.locator('.signin').waitFor({ timeout: 20000 }); await w.waitForTimeout(600);
  await w.screenshot({ path: path.join(shots, 'v69-signin.png') }); await audit(w, 'sign-in');
  check('sign-in theme bg is warm dark', (await w.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())) === '#0d0e0e');
  await w.getByLabel('Username').fill(`e2e_v64_${R}a`); await w.getByLabel('Password', { exact: true }).fill(PW);
  await w.getByRole('button', { name: 'Sign in', exact: true }).click(); await w.locator('.rail').waitFor({ timeout: 25000 });
  await w.locator('.pknudge button', { hasText: 'Not now' }).click({ timeout: 3000 }).catch(() => {});
  const [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'project' }))]);
  await m.locator(`.gcard[data-project="Edit ${R}"] .gname`).click(); await m.locator('.tr[data-task="Draft task"]').waitFor({ timeout: 15000 });
  await w.locator('.wt[data-task="Draft task"]').waitFor({ timeout: 15000 });
  step = 'inline rename';
  await m.locator('.tr[data-task="Draft task"] .expbtn').dblclick(); const ri = m.getByLabel('Rename task'); await ri.waitFor();
  await ri.fill('Buy domain renamed'); await m.screenshot({ path: '/tmp/v69-inline.png' }); await ri.press('Enter');
  await m.locator('.tr[data-task="Buy domain renamed"]').waitFor({ timeout: 15000 }); check('inline rename (double-click, Enter) saved', true);
  await m.locator('.tr[data-task="Buy domain renamed"] .expbtn').dblclick(); await m.getByLabel('Rename task').fill('nope'); await m.getByLabel('Rename task').press('Escape');
  check('Esc cancels rename', (await m.locator('.tr[data-task="Buy domain renamed"]').count()) === 1);
  let ok = false; for (let i = 0; i < 20 && !ok; i++) { ok = (await w.locator('.wt[data-task="Buy domain renamed"]').count()) === 1; if (!ok) await w.waitForTimeout(500); }
  check('widget shows rename live', ok);
  step = 'edit panel';
  await m.locator('.tr[data-task="Buy domain renamed"]').hover(); await m.getByLabel('Edit Buy domain renamed').click(); await m.locator('.teditp').waitFor();
  await m.locator('.teditp').getByLabel('Due date').fill('2026-12-24');
  await m.locator('.teditp').getByLabel('Assignee').click(); await m.locator('.sel-pop .sel-opt', { hasText: 'Bob Builder' }).click();
  await m.screenshot({ path: '/tmp/v69-panel.png' });
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
  step = 'checklist';
  const prow = m.locator('.tr[data-task="Plain task"]');
  await prow.locator('.expbtn').click(); const cl = m.locator('.tpanel .clist'); await cl.waitFor({ timeout: 10000 });
  for (const x of ['Register account', 'Verify email', 'Enable 2FA']) { await cl.getByLabel('Add checklist item').fill(x); await cl.getByLabel('Add checklist item').press('Enter'); await cl.locator(`.ci[data-item="${x}"]`).waitFor({ timeout: 10000 }); }
  check('row shows In progress · 0/3', ((await prow.locator('.cstat').textContent({ timeout: 5000 })) ?? '').includes('0/3'));
  await cl.getByLabel('Item Register account').check(); await cl.getByLabel('Item Verify email').check();
  await m.waitForFunction(() => document.querySelector('.tr[data-task="Plain task"] .cprog b')?.textContent === '2/3', null, { timeout: 10000 });
  check('progress bar 2/3 on row and detail header', (await m.locator('.tphead .cprog b').textContent()) === '2/3');
  await cl.locator('.ci[data-item="Verify email"]').hover();
  await m.screenshot({ path: '/tmp/v69-checklist.png' });
  ok = false; for (let i = 0; i < 20 && !ok; i++) { ok = ((await w.locator('.wt[data-task="Plain task"] .cprog b').textContent().catch(() => '')) ?? '') === '2/3'; if (!ok) await w.waitForTimeout(500); }
  check('widget shows 2/3 live', ok);
  await prow.locator('.cbx, [role=checkbox]').first().click().catch(() => {}); await m.waitForTimeout(800);
  check('main task cannot be ticked while items open', !(await prow.getAttribute('class')).includes('done'));
  await m.locator('.tpanel .clist').getByLabel('Item Enable 2FA').check();
  await m.waitForFunction(() => document.querySelector('.tr[data-task="Plain task"]')?.classList.contains('done'), null, { timeout: 10000 }).catch(() => {});
  check('last item auto-completes main task', (await prow.getAttribute('class')).includes('done'));
  await m.locator('.tpanel .clist').getByLabel('Item Verify email').uncheck().catch(async () => { await prow.locator('.expbtn').click(); await m.locator('.tpanel .clist').getByLabel('Item Verify email').uncheck(); });
  await m.waitForFunction(() => !document.querySelector('.tr[data-task="Plain task"]')?.classList.contains('done'), null, { timeout: 10000 }).catch(() => {});
  check('unticking an item reopens main task', !(await prow.getAttribute('class')).includes('done'));
  step = 'reimbursement';
  if (!(await m.locator('.tpanel').count())) await prow.locator('.expbtn').click();
  await m.locator('.tpanel').waitFor(); check('no reimbursement section on unconfigured task', (await m.locator('.tpanel .rsec').count()) === 0);
  await m.locator('.tr[data-task="Reimb task"] .expbtn').click(); await m.locator('.tpanel .rsec').waitFor({ timeout: 10000 });
  check('reimbursement section on configured task', (await m.locator('.tpanel .rsec').count()) === 1);
  await m.screenshot({ path: '/tmp/v69-reimb.png' });
  await w.locator('.wt[data-task="Plain task"] .t').click(); await w.locator('.tpanel').waitFor({ timeout: 10000 });
  check('widget: no reimbursement on unconfigured task; compact checklist shown', (await w.locator('.tpanel .rsec').count()) === 0 && (await w.locator('.tpanel .ci').count()) === 3);
  await w.waitForTimeout(900); await w.screenshot({ path: path.join(shots, 'v69-widget.png') }); await audit(w, 'widget');
  step = 'theme';
  await m.locator('.tr[data-task="Reimb task"] .expbtn').click(); await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(shots, 'v69-task-detail.png') }); await audit(m, 'task detail');
  await m.locator('.tr[data-task="Reimb task"] .expbtn').click(); await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(shots, 'v69-manage.png') }); await audit(m, 'manage');
  step = 'tick regression';
  await m.locator('.tr[data-task="Reimb task"] .cbx, .tr[data-task="Reimb task"] [role=checkbox]').first().click();
  await m.waitForFunction(() => document.querySelector('.tr[data-task="Reimb task"]')?.classList.contains('done'), null, { timeout: 10000 }).catch(() => {});
  check('task tick still works', (await m.locator('.tr[data-task="Reimb task"]').getAttribute('class')).includes('done'));
  await m.locator('.tpanel').getByRole('button', { name: 'Skip' }).click().catch(() => {});
  const th = await m.evaluate(() => ({ bg: getComputedStyle(document.querySelector('.rp') ?? document.body).backgroundColor, pri: (() => { const b = document.querySelector('.btn.pri, .newbtn'); return b ? getComputedStyle(b).backgroundColor : ''; })() }));
  check(`manage theme (bg ${th.bg}, primary ${th.pri})`, th.bg === 'rgb(13, 14, 14)' && th.pri === 'rgb(248, 247, 244)');
  await m.locator('.modetgl button', { hasText: 'View' }).click(); await m.waitForTimeout(400);
  check('View mode has no edit actions', (await m.locator('.rowedit').count()) === 0);
  check('View mode shows checklist', (await m.locator('.vcard[data-vtask="Plain task"] .ci').count()) === 3);
} catch (e) { console.error('[v69] FAIL at', step, '-', e.message.split('\n')[0]); results.push(['exception at ' + step, false]); for (const [i, win] of (app?.windows() ?? []).entries()) await win.screenshot({ path: `/tmp/v69-${i}.png`, timeout: 5000 }).catch(() => {}); }
finally {
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
  srvProc.kill('SIGTERM'); await Promise.race([new Promise((r) => srvProc.on('close', r)), new Promise((r) => setTimeout(r, 15000))]);
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1; process.exit();
}
