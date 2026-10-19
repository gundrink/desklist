/** 0.6.1 e2e against the live server. Never logs codes or passwords.
 *  DESKLIST_EXE=release/linux-unpacked/@desklistapp xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/smoke-v61.mjs */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const shots = path.resolve(import.meta.dirname, '../../screenshots'); fs.mkdirSync(shots, { recursive: true });
const SERVER = process.env.DESKLIST_SERVER_URL || 'https://server-production-46b2.up.railway.app';
const ADMIN = fs.readFileSync('/workspace/desklist-release/ADMIN-CODE.txt', 'utf8').split('\n').map((l) => l.trim()).find((l) => /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(l));
const app = await electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'],
  env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl61-')) } });
const log = (...a) => console.log('[v61]', ...a);
const results = []; const check = (name, ok) => { results.push([name, !!ok]); log(ok ? 'PASS' : 'FAIL', name); };
const shot = (pg, n, o = {}) => pg.screenshot({ path: path.join(shots, `v61-${n}.png`), ...o });
const PNAME = `E2E v61 ${Date.now() % 100000}`;
const V = { gmail: 'buy.gmail@desk-team.com', gpw: 'Gm41l-' + Math.random().toString(36).slice(2, 10), igUser: '@desklist.e2e', igMail: 'ig.owner@desk-team.com',
  igPw: 'Ig-' + Math.random().toString(36).slice(2, 12), phone: '+62 812 5555 0101', igUrl: 'https://instagram.com/desklist.e2e' };
const api = async (token, method, p, body) => { const r = await fetch(SERVER + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const adminTok = (await (await fetch(SERVER + '/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: ADMIN }) })).json()).token;
const clip = () => app.evaluate(({ clipboard }) => clipboard.readText());
let memberId = null; let m;
try {
  const w = await app.firstWindow(); await w.waitForLoadState('domcontentloaded');
  await w.getByLabel('Personal code').fill(ADMIN); await w.getByRole('button', { name: 'Sign in', exact: true }).click();
  await w.locator('.rail').waitFor({ timeout: 25000 }); check('admin sign-in', true);
  [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'create' }))]);
  m.on('pageerror', (e) => log('manage pageerror', e.message));
  await m.getByLabel('Project name').fill(PNAME); await m.getByLabel('Deadline').fill('2026-12-15');
  await m.getByRole('button', { name: 'Create project' }).click(); await m.locator('.tplmodal').waitFor({ timeout: 15000 });
  await m.getByRole('button', { name: 'Skip' }).click(); await m.locator('.rhead h1', { hasText: PNAME }).waitFor();

  // 1) admin sets up "Buy Gmail" once
  await m.locator('.adminrow', { hasText: 'Task setup' }).click(); await m.getByLabel('Setup task name').fill('Buy Gmail');
  const defs = [['Email', 'email', false], ['Password', 'password', false], ['Amount', 'amount', true]];
  for (const [i, [label, type, re]] of defs.entries()) {
    await m.getByRole('button', { name: '+ Add field' }).click();
    await m.getByLabel(`Field ${i + 1} name`).fill(label); await m.getByLabel(`Field ${i + 1} type`).selectOption(type);
    if (re) await m.getByLabel(`Field ${i + 1} reimbursement`).check();
  }
  await m.getByRole('button', { name: 'Save setup' }).click(); await m.locator('.callout', { hasText: 'Saved' }).waitFor({ timeout: 15000 });
  await m.locator('.tsrow[data-setup="Buy Gmail"]').waitFor(); await shot(m, 'admin-task-setup'); check('admin task setup saved', true);

  // 2) tasks: Buy Gmail (standard) + Instagram social account
  await m.locator(`.gcard[data-project="${PNAME}"] .gname`).click(); await m.locator('.stabs').waitFor();
  await m.getByLabel('New task title').fill('Buy Gmail'); await m.getByRole('button', { name: 'Add task' }).click();
  await m.getByLabel('New task title').fill('Instagram account'); await m.getByLabel('Task type').selectOption('social'); await m.getByLabel('Platform').selectOption('Instagram');
  await m.getByRole('button', { name: 'Add task' }).click();
  await m.locator('.tr[data-task="Instagram account"] .platpill', { hasText: 'Instagram' }).waitFor({ timeout: 15000 }); check('social task row shows platform label', true);
  await m.locator('.tr[data-task="Instagram account"] .expbtn').click(); await m.locator('.tfrow[data-field="Profile URL"]').waitFor({ timeout: 15000 });
  const socialLabels = await m.locator('.tpanel .tpright .tfrow').evaluateAll((els) => els.map((e) => e.getAttribute('data-field')));
  check('social fields pre-filled: ' + socialLabels.join(', '), ['Platform', 'Username / handle', 'Email', 'Password', 'Phone', 'Profile URL', '2FA / backup notes'].every((x) => socialLabels.includes(x)));
  const fill = async (label, value) => { const i = m.locator(`.tfrow[data-field="${label}"] input`).first(); await i.fill(value); await i.blur(); await m.waitForTimeout(900); };
  await fill('Username / handle', V.igUser); await fill('Email', V.igMail); await fill('Password', V.igPw); await fill('Phone', V.phone); await fill('Profile URL', V.igUrl);
  await m.waitForTimeout(1500);
  await m.locator('.tfrow[data-field="Email"] .copybtn').click(); await m.locator('.tfrow[data-field="Email"] .copybtn.ok').waitFor();
  check('copy email -> clipboard', (await clip()) === V.igMail);
  await m.locator('.tfrow[data-field="Password"] .copybtn').click(); await m.locator('.tfrow[data-field="Password"] .copybtn.ok').waitFor({ timeout: 10000 });
  check('copy password -> clipboard has decrypted value (not shown)', (await clip()) === V.igPw && (await m.locator('.tfrow[data-field="Password"] input').inputValue()) !== V.igPw);
  await shot(m, 'social-edit');
  await fill('Username / handle', '@desklist.e2e2'); V.igUser = '@desklist.e2e2'; check('social field edited later', true);
  await m.locator('.tpanel .tpx').click();
  await shot(m, 'after-tabs-manage');

  // 3) member account fills Buy Gmail
  const mem = await api(adminTok, 'POST', '/api/members', { name: 'E2E Member', role: 'member' }); memberId = mem.member.id;
  await w.getByLabel('Widget menu').click(); await w.getByRole('button', { name: /Sign out/ }).click();
  await w.getByLabel('Personal code').waitFor({ timeout: 15000 });
  await w.getByLabel('Personal code').fill(mem.code); await w.getByRole('button', { name: 'Sign in', exact: true }).click();
  await w.locator('.rail').waitFor({ timeout: 25000 }); check('member sign-in', true);
  await m.locator(`.gcard[data-project="${PNAME}"] .gname`).click({ timeout: 20000 });
  check('member has no admin Task setup entry', (await m.locator('.adminrow').count()) === 0);
  await m.locator('.tr[data-task="Buy Gmail"] .expbtn').click(); await m.locator('.tpanel .tfrow[data-field="Email"]').waitFor({ timeout: 15000 });
  check('member: Buy Gmail fields pre-configured (Email, Password, Amount)', (await m.locator('.tpanel .tfrow[data-field="Password"]').count()) === 1 && (await m.locator('.tpanel .rsec .tfrow[data-field="Amount"]').count()) === 1);
  check('member: no "+ Add field" for detail fields, no remove buttons', (await m.locator('.tpanel .tpright .addfield').count()) === 0 && (await m.locator('.tpanel .tpright .tfdel').count()) === 0);
  check('member: reimbursement section visible and usable', (await m.locator('.tpanel .rsec').count()) === 1 && (await m.locator('.tpanel .rsec .addfield').count()) === 1);
  await fill('Email', V.gmail); await fill('Password', V.gpw);
  await m.getByLabel('Amount currency').selectOption('USD');
  const amt = m.locator('.rsec .tfrow[data-field="Amount"] input').first(); await amt.fill('12.5'); await amt.blur(); await m.waitForTimeout(2500);
  await shot(m, 'member-fill');
  await m.getByRole('button', { name: /^Reimbursement/ }).click(); await m.locator('.rtr[data-reimb="Buy Gmail"]').waitFor({ timeout: 15000 });
  const rrow = await m.locator('.rtr[data-reimb="Buy Gmail"]').textContent();
  check('USD reimbursement shows $12.50 with no ≈ line', rrow.includes('$12.50') && !rrow.includes('≈'));
  await m.getByRole('button', { name: /^Checklist/ }).click();

  // 4) View mode
  await m.getByRole('tab', { name: 'View' }).click(); await m.locator('.pview').waitFor();
  const vt = await m.locator('.pview').textContent();
  const want = { 'gmail email': V.gmail, 'ig username': V.igUser, 'ig email': V.igMail, phone: V.phone, url: V.igUrl, platform: 'Instagram', amount: '$12.50', deadline: '15 Dec 2026', project: PNAME };
  for (const [k, v] of Object.entries(want)) check(`view shows ${k}`, vt.includes(v));
  check('view: passwords masked', !vt.includes(V.igPw) && !vt.includes(V.gpw) && (await m.locator('.pview .vsecret').count()) >= 2);
  check('view: every displayed value has its own copy button', (await m.locator('.pview .vval:not(.none)').count()) === (await m.locator('.pview .vval:not(.none) .copybtn').count()));
  check('view: no Copy all button', (await m.getByRole('button', { name: /copy all/i }).count()) === 0);
  await m.locator('.vcard[data-vtask="Instagram account"] .vline[data-vlabel="Phone"] .copybtn').click(); check('view copy phone', (await clip()) === V.phone);
  await m.locator('.vcard[data-vtask="Buy Gmail"] .vline[data-vlabel="Password"] .copybtn').click(); await m.waitForTimeout(1500);
  check('view copy password (masked on screen)', (await clip()) === V.gpw);
  await m.locator('.vcard[data-vtask="Buy Gmail"] .vline[data-vlabel="Password"] .eye').click(); await m.waitForTimeout(1500);
  check('view reveal eye shows password', (await m.locator('.vcard[data-vtask="Buy Gmail"] .vline[data-vlabel="Password"] .vsecret').textContent()) === V.gpw);
  await m.locator('.vcard[data-vtask="Buy Gmail"] .vline[data-vlabel="Password"] .eye').click();
  await shot(m, 'view-mode');
  // widget compact view
  await w.locator(`.ri[data-project="${PNAME}"]`).click(); await w.getByRole('tab', { name: 'View' }).click(); await w.locator('.pview.compact').waitFor();
  const wt = await w.locator('.pview').textContent(); check('widget view shows filled values live', wt.includes(V.gmail) && wt.includes(V.igUser) && wt.includes('$12.50'));
  await w.waitForTimeout(400); await w.screenshot({ path: path.join(shots, 'v61-widget-view.png'), omitBackground: true });
  await w.getByRole('tab', { name: 'Edit' }).click(); await w.waitForTimeout(300);
  await w.screenshot({ path: path.join(shots, 'v61-after-tabs-widget.png'), omitBackground: true });

  // 5) passkey wiring (no real authenticator under xvfb)
  await m.locator('.navbtn', { hasText: 'Team & codes' }).click(); await m.getByRole('button', { name: '+ Add passkey' }).click(); await m.waitForTimeout(2500);
  const opened = await app.evaluate(() => globalThis.__desklist.opened.slice());
  const reg = new URL(opened.at(-1)); check('Add passkey opens server /passkey/register with ticket + loopback cb', reg.origin === SERVER && reg.pathname === '/passkey/register' && reg.searchParams.get('ticket')?.length > 20 && /^http:\/\/127\.0\.0\.1:\d+\/passkey$/.test(reg.searchParams.get('cb')));
  const page = await (await fetch(reg.href)).text(); check('register page loads over Railway https', page.includes('Continue with passkey'));
  check('browser bundle served', (await (await fetch(SERVER + '/passkey/browser.js')).text()).length > 1000);
  const opt = await fetch(SERVER + '/passkey/api/register/options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: reg.searchParams.get('ticket') }) }).then((r) => r.json());
  check('register options from server (rp.id = Railway host)', opt.rp?.id === new URL(SERVER).hostname && !!opt.challenge);
  await fetch(reg.searchParams.get('cb') + '?status=ok'); await m.locator('.callout', { hasText: 'Passkey added' }).waitFor({ timeout: 10000 }); check('loopback redirect completes (mocked browser step)', true);
  await shot(m, 'passkeys');
  await w.getByLabel('Widget menu').click(); await w.getByRole('button', { name: /Sign out/ }).click(); await w.getByLabel('Personal code').waitFor();
  await w.getByRole('button', { name: /Sign in with passkey/ }).click(); await w.waitForTimeout(2000);
  const lu = new URL((await app.evaluate(() => globalThis.__desklist.opened.slice())).at(-1));
  check('Sign in with passkey opens /passkey/login with state + PKCE challenge', lu.pathname === '/passkey/login' && lu.searchParams.get('state') && lu.searchParams.get('cc')?.length === 43);
  check('login page loads over Railway https', (await (await fetch(lu.href)).text()).includes('Sign in with your passkey'));
  await fetch(`${lu.searchParams.get('cb')}?code=${'x'.repeat(43)}&state=${lu.searchParams.get('state')}`);
  await w.locator('.signin .err').waitFor({ timeout: 10000 });
  check('loopback code is exchanged with server (bogus code rejected)', /expired or already used/.test(await w.locator('.signin .err').textContent()));
  await shot(w, 'signin-passkey', { omitBackground: true });
} catch (e) { console.error('[v61] FAIL', e.message); for (const [i, win] of app.windows().entries()) await win.screenshot({ path: `/tmp/v61fail-${i}.png` }).catch(() => {}); results.push(['exception', false]); }
finally {
  try {
    const snap = await api(adminTok, 'GET', '/api/snapshot');
    for (const p of snap.projects.filter((p) => p.name.startsWith('E2E v61'))) { await api(adminTok, 'DELETE', `/api/projects/${p.id}`); log('deleted project', p.name); }
    for (const s of await api(adminTok, 'GET', '/api/task-setups')) if (s.title === 'Buy Gmail') { await api(adminTok, 'DELETE', `/api/task-setups/${s.id}`); log('deleted task setup Buy Gmail'); }
    for (const mm of snap.members.filter((x) => x.name === 'E2E Member')) { await api(adminTok, 'DELETE', `/api/members/${mm.id}`); log('deleted member E2E Member'); }
    await api(adminTok, 'POST', '/api/auth/signout');
  } catch (e) { log('cleanup error', e.message); }
  await app.close();
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1;
}
