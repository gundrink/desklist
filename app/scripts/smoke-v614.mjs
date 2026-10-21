/** 0.6.14 e2e (temp team only): search, notebook, description card, amount→reimbursement, fill progress, row actions,
 *  team delete/role, admin guards (member UI), profile photo, update chip (staged local feed). */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'; import { spawn } from 'node:child_process'; import readline from 'node:readline';
import { CONTRAST_AUDIT } from './contrast.mjs';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const OLD = !!process.env.OLD_SERVER; const log = (...a) => console.log(OLD ? '[v614@old-server]' : '[v614]', ...a);
const results = []; const check = (n, ok) => { results.push([n, !!ok]); log(ok ? 'PASS' : 'FAIL', n); };
const R = Date.now().toString(36).slice(-5); const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
const api = async (base, token, method, p, body) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: process.env.SERVER_DIR || path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, DESKLIST_E2E_TEAM_NAME: 'Demo Team', DESKLIST_E2E_ADMIN_NAME: 'Alex Morgan', DESKLIST_E2E_ADMIN_INITIALS: 'AM' } });
const L = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
// staged update feed: a newer version so the app reports "available"
const feed = http.createServer((q, s) => { if (/latest.*\.yml/.test(q.url)) { s.setHeader('content-type', 'text/yaml'); s.end(`version: 0.6.99\nfiles:\n  - url: Desklist-0.6.99.AppImage\n    sha512: AAAA\n    size: 10\npath: Desklist-0.6.99.AppImage\nsha512: AAAA\nreleaseDate: '2026-10-21T00:00:00.000Z'\n`); } else { s.statusCode = 404; s.end(); } }).listen(0);
const FEED = `http://127.0.0.1:${feed.address().port}`;
let app, step = '', fails = 0;
const noOverflow = (w, sel) => w.evaluate((sel) => [...document.querySelectorAll(sel)].every((e) => e.scrollWidth <= e.clientWidth + 1), sel);
const audit = async (w, label) => { const a = await w.evaluate(CONTRAST_AUDIT); fails += a.fails.length; log(`contrast ${label}: ${a.n} checked, ${a.fails.length} fails ${a.fails.slice(0, 3).join(' | ')}`); };
const setW = (match, width) => app.evaluate(({ BrowserWindow }, [m, ww]) => { const x = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes(m)); x.setBounds({ ...x.getBounds(), width: ww }); }, [match, width]);
const launch = async (token, extra = {}) => { app = await electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'], timeout: 30000,
  env: { ...process.env, TZ: 'Europe/London', DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: L.base, DESKLIST_SMOKE_TOKEN: token, DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl614-')), ...extra } });
  const w = await app.firstWindow(); await w.locator('.rail').waitFor({ timeout: 25000 }); await w.locator('.pknudge button', { hasText: 'Not now' }).click({ timeout: 2500 }).catch(() => {}); return w; };
const openManage = async (v) => { const [m] = await Promise.all([app.waitForEvent('window'), app.evaluate((_, v) => globalThis.__desklist.openManage(v), v)]); await m.locator('.pcol').waitFor({ timeout: 15000 }); return m; };
const pick = async (w, scope, label) => { await scope.click(); await w.locator('.sel-pop .sel-opt', { hasText: label }).first().click(); };
const LONG = ['Launch the marketing website for the autumn campaign.', 'Scope: landing page, pricing, blog and docs.', 'Brief: https://example.com/brief', 'Owner: Alex Morgan', 'Design review on Monday.',
  'Copy freeze on Wednesday.', 'QA pass on Thursday.', 'Go live on Friday at 10:00.', 'Post-launch: monitor analytics for a week.', 'Retro the following Monday.', 'Budget is tracked under Reimbursement.'].join('\n');
try {
  step = 'seed';
  const as = await api(L.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v614_${R}a`, password: PW });
  const A = (await api(L.base, null, 'POST', '/api/accounts/redeem', { accountToken: as.accountToken, code: L.code })).token;
  const mem = await api(L.base, A, 'POST', '/api/members', { name: 'Sam Carter', role: 'member' });
  const ms = await api(L.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v614_${R}m`, password: PW });
  const M = (await api(L.base, null, 'POST', '/api/accounts/redeem', { accountToken: ms.accountToken, code: mem.code })).token;
  const jl = await api(L.base, A, 'POST', '/api/members', { name: 'Jordan Lee', role: 'member' });
  const pid = (await api(L.base, A, 'POST', '/api/projects', { name: 'Website launch' })).id;
  await api(L.base, A, 'PATCH', `/api/projects/${pid}`, { notes: LONG });
  const ids = {};
  for (const n of ['Buy domain', 'Deploy website', 'Set up hosting', 'Configure DNS', 'Deploy Program ID']) ids[n] = (await api(L.base, A, 'POST', `/api/projects/${pid}/tasks`, { title: n })).id;
  for (const n of ['Buy domain', 'Set up hosting']) for (const [lb, v] of [['Registrar', n === 'Buy domain' ? 'Namecheap' : null], ['Domain', null], ['Login URL', null]])
    await api(L.base, A, 'POST', `/api/tasks/${ids[n]}/fields`, { label: lb, type: 'text', ...(v ? { value: v } : {}) });
  await api(L.base, A, 'POST', `/api/tasks/${ids['Deploy website']}/items`, { title: 'Upload build to Vercel' });
  await api(L.base, A, 'PATCH', `/api/tasks/${ids['Buy domain']}`, { bicMemberId: jl.member.id });

  step = 'widget admin';
  let w = await launch(A, { DESKLIST_UPDATE_FEED: FEED });
  const order = await w.evaluate(() => { const ov = document.querySelector('.rail .rov'), sr = document.querySelector('.rail .sbsearch'), nb = document.querySelector('.rail .nbnav'), tabs = document.querySelector('.rail .seg, .rail .ptabs, .rail [role=tablist]');
    const f = (a, b) => !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); return { s: f(ov, sr), n: f(sr, nb), t: tabs ? f(nb, tabs) : true }; });
  check(`widget sidebar order: Overview → Search → Notebook → tabs ${JSON.stringify(order)}`, order.s && order.n && order.t);
  await w.locator('.ri[data-project="Website launch"]').click(); await w.locator('.wt[data-task="Buy domain"]').waitFor();
  // description card
  const dsc = await w.evaluate(() => { const t = document.querySelector('.wdet .pdesc.dcard .pdesc-t'); return t ? { h: t.clientHeight, sh: t.scrollHeight, fade: t.classList.contains('fade'), more: !!document.querySelector('.wdet .pdesc .more'), link: !!t.querySelector('a.alink') } : null; });
  check(`widget description card clamped to ~8 lines with fade + Show more + link ${JSON.stringify(dsc)}`, dsc && dsc.fade && dsc.more && dsc.link && dsc.sh > dsc.h);
  await w.locator('.wdet .pdesc').screenshot({ path: path.join(shots, 'v614-desc-widget-collapsed.png') });
  await w.locator('.wdet .pdesc .more').click(); await w.waitForTimeout(200);
  const exp = await w.evaluate(() => { const t = document.querySelector('.wdet .pdesc-t'); return { open: t.classList.contains('open'), full: t.scrollHeight <= t.clientHeight + 2, br: t.innerText.split('\n').length } });
  check(`widget description expands fully, keeps line breaks ${JSON.stringify(exp)}`, exp.open && exp.full && exp.br >= 11);
  await w.locator('.wdet .pdesc').screenshot({ path: path.join(shots, 'v614-desc-widget-expanded.png') }); await w.locator('.wdet .pdesc .more').click();
  // fill progress + row actions
  for (const ww of [560, 630, 800]) { await setW('widget', ww); await w.waitForTimeout(400);
    const r = await w.evaluate(() => [...document.querySelectorAll('.wt:not(.done)')].map((row) => ({ n: row.dataset.task, tw: row.querySelector(':scope>.t').getBoundingClientRect().width, det: !!row.querySelector('.racts .rdet'), ed: !!row.querySelector('.racts .rowedit'), fill: row.querySelector('.fillp')?.dataset.fill ?? null })));
    check(`widget ${ww}px: every row has detail+edit actions, titles visible, fill "1/3" only on Buy domain ${JSON.stringify(r.map((x) => [x.n, Math.round(x.tw), x.fill]))}`, r.length === 5 && r.every((x) => x.det && x.ed && x.tw > 40) && r.find((x) => x.n === 'Buy domain').fill === '1/3' && r.filter((x) => x.fill).length === 1); }
  await setW('widget', 630); await w.waitForTimeout(300); await w.screenshot({ path: path.join(shots, 'v614-widget-rows.png') });
  // amount → reimbursement (widget)
  step = 'amount widget';
  await w.locator('.wt[data-task="Deploy website"] .rdet').click(); await w.locator('.tpanel .addfield').first().click();
  await w.locator('.typepop .tpi', { hasText: 'Amount' }).click(); await w.locator('[data-reimb] input[aria-label="Reimbursement amount"]').waitFor({ timeout: 8000 });
  await w.locator('[data-reimb] input[aria-label="Reimbursement amount"]').fill('1.5'); await w.locator('[data-reimb] input[aria-label="Reimbursement item"]').click(); await w.waitForTimeout(1500);
  let snap = await api(L.base, A, 'GET', '/api/snapshot');
  const rb = snap.reimbursements.find((x) => x.taskId === ids['Deploy website']);
  check(`widget: "Amount / Reimbursement" turns on Has reimbursement + saves via PUT (${rb?.amount} ${rb?.currency})`, snap.tasks.find((t) => t.id === ids['Deploy website']).hasExpense && rb?.amount === 1.5);
  const rep = await api(L.base, A, 'GET', '/api/reports'); check('reimbursement appears in admin report', JSON.stringify(rep).includes('Deploy website'));
  await w.locator('.tpanel').first().screenshot({ path: path.join(shots, 'v614-amount-reimbursement-widget.png') });
  await w.locator('.wt[data-task="Deploy website"] .rdet').click();
  // search
  step = 'search';
  const sb = w.locator('.rail .sbsearch input'); await sb.fill('vercel'); await w.locator('[data-results] .sbhit').first().waitFor();
  check('search finds checklist item', await w.locator('[data-results] .sbhit[data-kind=item]').count() >= 1);
  await sb.fill('namecheap'); await w.waitForTimeout(150); check('search finds task field value', await w.locator('[data-results] .sbhit[data-kind=field]').count() >= 1);
  check(`search results no horizontal overflow`, await noOverflow(w, '[data-results], .wnb'));
  check('search results render in main panel, not under the box', await w.locator('.wdet [data-results]').count() === 1 && await w.locator('.rail [data-results]').count() === 0);
  await sb.fill('website'); await w.waitForTimeout(200);
  check(`grouped results with highlight ${await w.locator('[data-results] .sgrp').count()} groups`, await w.locator('[data-results] .sgrp').count() >= 2 && await w.locator('[data-results] mark.shl').count() >= 2);
  await w.screenshot({ path: path.join(shots, 'v615-search-widget.png') });
  await sb.press('Escape'); await w.waitForTimeout(150); check('Esc clears search and returns to previous view', await w.locator('[data-results]').count() === 0 && await w.locator('.wt[data-task="Buy domain"]').count() === 1);
  await sb.fill('website'); await w.waitForTimeout(150); await w.locator('[data-results] .sbhit[data-kind=project]').first().click();
  check('clicking a project result opens it', await w.locator('.wt[data-task="Buy domain"]').count() === 1);
  // notebook
  step = 'notebook widget';
  await w.locator('.rail .nbnav').click(); await w.locator('[data-notebook]').waitFor();
  await w.locator('[data-newnote]').click(); await w.locator('[data-noteform]').waitFor();
  await w.locator('input[aria-label="Note title"]').fill('RPC Helius');
  await w.locator('input[aria-label="Field 1 label"]').fill('Endpoint'); await pick(w, w.locator('.nbtype').nth(0), 'URL'); await w.locator('input[aria-label="Field 1 value"]').fill('https://mainnet.helius-rpc.com');
  await w.locator('[data-addfield]').click(); await w.locator('input[aria-label="Field 2 label"]').fill('API key'); await pick(w, w.locator('.nbtype').nth(1), 'Password'); await w.locator('input[aria-label="Field 2 value"]').fill('e2e-dummy-not-a-secret');
  await w.locator('[data-addfield]').click(); await w.locator('input[aria-label="Field 3 label"]').fill('Rate limit'); await pick(w, w.locator('.nbtype').nth(2), 'Number'); await w.locator('input[aria-label="Field 3 value"]').fill('50');
  await w.locator('[data-addfield]').click(); await w.locator('input[aria-label="Field 4 label"]').fill('Notes'); await pick(w, w.locator('.nbtype').nth(3), 'Long text'); await w.locator('textarea[aria-label="Field 4 value"]').fill('Free tier\nDocs: https://docs.helius.dev');
  check('new note form: no horizontal overflow', await noOverflow(w, '.wnb, [data-noteform]'));
  check('secret input masked in form', await w.locator('input[aria-label="Field 2 value"]').getAttribute('type') === 'password');
  await w.screenshot({ path: path.join(shots, 'v615-notebook-form.png') });
  await w.locator('[data-savenote]').click(); await w.locator('[data-noteview]').waitFor({ timeout: 8000 }).catch(async (e) => { log('form error:', await w.locator('[data-noteform] .err').textContent().catch(() => '?')); throw e; });
  const nv = await w.evaluate(() => ({ link: !!document.querySelector('[data-ftype=url] a.alink'), mask: document.querySelector('[data-secret]')?.textContent, secLink: !!document.querySelector('[data-ftype=secret] a'), copies: document.querySelectorAll('[data-noteview] .copybtn').length }));
  check(`note view: URL is a link, secret masked + never linkified, copy buttons ${JSON.stringify(nv)}`, nv.link && /^•+$/.test(nv.mask) && !nv.secLink && nv.copies >= 4);
  await w.screenshot({ path: path.join(shots, 'v615-notebook-view.png') });
  await w.locator('[data-ftype=secret] button[aria-label="Reveal value"]').click(); await w.waitForTimeout(400);
  check('reveal shows secret as plain text (not a link)', (await w.locator('[data-secret]').textContent()) === 'e2e-dummy-not-a-secret' && await w.locator('[data-ftype=secret] a').count() === 0);
  await w.locator('[data-ftype=secret] button[aria-label="Hide value"]').click();
  await audit(w, 'widget note view');
  await w.locator('button[aria-label="Back to notebook"]').click(); await w.locator('.nbrow').first().waitFor();
  if (OLD) {
    check('old server: status chip + filter + form status hidden', await w.locator('.nbstatus, .nbfilter').count() === 0);
    await w.locator('.nbrow').click(); await w.locator('[data-noteview]').waitFor(); await w.locator('[data-noteview] button', { hasText: 'Edit' }).click(); await w.locator('[data-noteform]').waitFor();
    check('old server: no status in edit form', await w.locator('.nbseg').count() === 0);
    await w.locator('input[aria-label="Note title"]').fill('RPC Helius'); await w.locator('[data-savenote]').click(); await w.locator('[data-noteview]').waitFor();
    const ns = await api(L.base, A, 'GET', '/api/notes'); check(`old server: edit keeps all fields (${ns[0]?.fields.length}) and secret`, ns[0]?.fields.length === 4 && ns[0].fields.find((f) => f.type === 'secret')?.hasValue);
    await w.locator('button[aria-label="Back to notebook"]').click(); await w.locator('.nbrow').first().waitFor();
  } else {
  await w.locator('.nbrow .nbstatus').click(); await w.locator('.nbrow .nbstatus[data-status=unavailable]').waitFor({ timeout: 8000 });
  { const ns = await api(L.base, A, 'GET', '/api/notes'); check(`status chip toggles to Unavailable (saved, fields kept: ${ns[0]?.fields.length})`, ns[0]?.status === 'unavailable' && ns[0]?.fields.length === 4); }
  await w.locator('[data-filter=available]').click(); check('filter Available hides it', await w.locator('.nbrow').count() === 0);
  await w.locator('[data-filter=unavailable]').click(); check('filter Unavailable shows it', await w.locator('.nbrow').count() === 1);
  }
  { const h = await w.evaluate(() => { const r = document.querySelector('.nbrow'); const t = r.querySelector('.nbt'); return { h: r.getBoundingClientRect().height, tw: t.getBoundingClientRect().width, title: t.title, ov: r.scrollWidth <= r.clientWidth + 1 }; });
    check(`compact note row: single line ${Math.round(h.h)}px, title ${Math.round(h.tw)}px with tooltip, no overflow`, h.h <= 46 && h.tw > 50 && h.title === 'RPC Helius' && h.ov); }
  await w.locator('.nbrow').hover(); await w.waitForTimeout(250); check('row delete button visible on hover', await w.locator('.nbrow .nbdel').evaluate((e) => getComputedStyle(e).opacity === '1'));
  await audit(w, 'notebook list (unavailable + hover)');
  await w.screenshot({ path: path.join(shots, OLD ? 'v616-old-server-notebook-list.png' : 'v616-notebook-list-widget.png') }); if (!OLD) await w.locator('[data-filter=all]').click();
  const MS = await api(L.base, M, 'GET', '/api/notes'); check(`notes private: other member sees ${MS.length} notes`, Array.isArray(MS) && MS.length === 0);
  await sb.fill('helius'); await w.locator('[data-results] .sbhit[data-kind=note]').click(); check('search opens note', await w.locator('[data-noteview]').count() === 1);
  await w.locator('.rail .rov').click(); await w.waitForTimeout(300);
  await w.locator('.rail').screenshot({ path: path.join(shots, 'v614-widget-sidebar.png') });
  // update chip
  step = 'update';
  await w.waitForTimeout(500); await app.evaluate(() => globalThis.__desklist?.checkForUpdates?.()).catch(() => {});
  const upd = await w.evaluate(() => window.desklist.checkForUpdates()); log('update check:', upd);
  const chip = await w.locator('.rail .updchip').getAttribute('data-update');
  check(`update chip in widget footer shows "Update now" for staged feed v0.6.99 (state ${chip})`, chip === 'available');
  check('rail footer (+ New / update) no overflow', await noOverflow(w, '.rail .rfoot'));
  await w.locator('.rail .rfoot').screenshot({ path: path.join(shots, 'v614-update-available-widget.png') });
  // manage (admin)
  step = 'manage admin';
  let m = await openManage({ view: 'project', projectId: pid }); await m.locator('.tr[data-task="Buy domain"]').waitFor({ timeout: 15000 });
  check('Manage sidebar has search + Notebook', await m.locator('.pcol .sbsearch').count() === 1 && await m.locator('.pcol .nbnav').count() === 1);
  const mr = await m.evaluate(() => [...document.querySelectorAll('.tr:not(.done)')].map((r) => { const e = r.querySelector('.racts .rowedit'); return { n: r.dataset.task, x: e?.getBoundingClientRect().left ?? -1, op: e ? getComputedStyle(e).opacity : 0, d: !!r.querySelector('.racts .rdet') }; }));
  check(`Manage: every row (incl. "Deploy Program ID") has aligned detail + visible edit ${JSON.stringify(mr.map((x) => [x.n, Math.round(x.x)]))}`, mr.length === 5 && mr.every((x) => x.d && x.op === '1' && Math.abs(x.x - mr[0].x) < 1.5));
  await m.locator('.pcol .sbsearch input').fill('website'); await m.locator('.rpsearch [data-results]').waitFor();
  check('Manage: results in main panel', await m.locator('.rpsearch .sgrp').count() >= 2); await m.screenshot({ path: path.join(shots, 'v615-search-manage.png') });
  await m.locator('.pcol .sbsearch input').fill(''); await m.locator('.tr').first().waitFor();
  await m.locator('.pdesc.dcard').screenshot({ path: path.join(shots, 'v614-desc-manage-collapsed.png') });
  await m.locator('.pdesc.dcard .more').click(); await m.waitForTimeout(200); await m.locator('.pdesc.dcard').screenshot({ path: path.join(shots, 'v614-desc-manage-expanded.png') }); await m.locator('.pdesc.dcard .more').click();
  await m.screenshot({ path: path.join(shots, 'v614-manage-rows-edit.png') });
  await m.locator('button', { hasText: /^View$/ }).first().click().catch(() => {}); await m.waitForTimeout(400); await m.screenshot({ path: path.join(shots, 'v614-manage-rows-view.png') });
  await m.locator('button', { hasText: /^Edit$/ }).first().click().catch(() => {}); await m.waitForTimeout(300);
  await audit(m, 'Manage project rows');
  // amount in Manage
  await m.locator('.tr[data-task="Configure DNS"] .rdet').click(); await m.locator('.tpanel .addfield').first().click(); await m.locator('.typepop .tpi', { hasText: 'Amount' }).click();
  await m.locator('[data-reimb] input[aria-label="Reimbursement amount"]').waitFor({ timeout: 8000 }); await m.locator('[data-reimb] input[aria-label="Reimbursement amount"]').fill('0.25'); await m.locator('[data-reimb] input[aria-label="Reimbursement item"]').click(); await m.waitForTimeout(1500);
  snap = await api(L.base, A, 'GET', '/api/snapshot'); check('Manage: Amount → reimbursement saved', snap.reimbursements.find((x) => x.taskId === ids['Configure DNS'])?.amount === 0.25);
  await m.locator('.tpanel').first().screenshot({ path: path.join(shots, 'v614-amount-reimbursement-manage.png') });
  await m.locator('.pcol .nbnav').click(); await m.locator('[data-notebook]').waitFor(); await m.screenshot({ path: path.join(shots, 'v616-notebook-list-manage.png') });
  await m.locator('.nbrow').first().focus(); for (let i = 0; i < 4 && !(await m.evaluate(() => document.activeElement?.classList.contains('nbdel'))); i++) await m.keyboard.press('Tab');
  check('row delete reachable by keyboard', await m.evaluate(() => document.activeElement?.classList.contains('nbdel')));
  await m.keyboard.press('Enter'); await m.locator('[data-confirmdel]').waitFor(); await m.screenshot({ path: path.join(shots, 'v615-notebook-delete-confirm.png') });
  await m.locator('[data-confirmdel]').click(); await m.waitForTimeout(1200); check('note deleted from list row', (await api(L.base, A, 'GET', '/api/notes')).length === 0);
  await audit(m, 'Manage notebook');
  // profile photo
  step = 'profile';
  await m.locator('.navbtn', { hasText: 'Settings' }).click(); await m.locator('[data-card=profile]').waitFor();
  const png = path.join(os.tmpdir(), `av-${R}.png`); await m.evaluate(async () => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 400, 300); gr.addColorStop(0, '#ccbca3'); gr.addColorStop(1, '#3a4a5a'); g.fillStyle = gr; g.fillRect(0, 0, 400, 300); g.fillStyle = '#f8f7f4'; g.font = 'bold 120px sans-serif'; g.fillText('AM', 90, 200); window.__png = c.toDataURL('image/png'); });
  fs.writeFileSync(png, Buffer.from((await m.evaluate(() => window.__png)).split(',')[1], 'base64'));
  await m.locator('[data-avatarinput]').setInputFiles(png); await m.locator('[data-card=profile] .av.photo').waitFor({ timeout: 8000 });
  const dim = await m.evaluate(() => new Promise((r) => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = document.querySelector('[data-card=profile] .av.photo img').src; }));
  check(`profile photo cropped square + resized (${dim})`, dim[0] === 256 && dim[1] === 256);
  await m.locator('input[aria-label="Display name"]').fill('Alex Morgan'); 
  check('Updates card in Settings', await m.locator('[data-card=updates]').count() === 1);
  await m.locator('[data-card=profile]').screenshot({ path: path.join(shots, 'v614-profile.png') });
  await m.locator('[data-card=updates]').screenshot({ path: path.join(shots, 'v614-settings-updates.png') });
  check(`Manage footer update chip: ${await m.locator('.pcol .updchip').getAttribute('data-update')}`, (await m.locator('.pcol .updchip').getAttribute('data-update')) === 'available');
  check('Manage sidebar footer no overflow', await noOverflow(m, '.pcfoot, .pcupd'));
  await m.locator('.pcfoot').screenshot({ path: path.join(shots, 'v614-update-available-manage.png') });
  // team: role select + delete
  step = 'team';
  await m.locator('[data-nav=team]').click(); await m.locator('.mem-row').first().waitFor();
  check('Team: own role is a badge (no self-demote); others have role select', await m.locator('.rolesel').count() === 2);
  await m.locator('.mem-row', { hasText: 'Alex Morgan' }).locator('.av.photo').waitFor({ timeout: 5000 }).then(() => check('photo shown in Team list', true), () => check('photo shown in Team list', false));
  await m.screenshot({ path: path.join(shots, 'v614-team.png') });
  await m.locator('[data-delmember="Jordan Lee"]').click(); await m.locator('[data-confirmdelmember]').waitFor(); await m.screenshot({ path: path.join(shots, 'v614-team-delete-confirm.png') });
  await m.locator('[data-confirmdelmember]').click(); await m.waitForTimeout(1500);
  snap = await api(L.base, A, 'GET', '/api/snapshot');
  check('member deleted; their BIC assignment cleared', !snap.members.some((x) => x.name === 'Jordan Lee') && snap.tasks.find((t) => t.id === ids['Buy domain']).bicMemberId === null);
  await audit(m, 'Team');
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 6000))]); app = null;

  step = 'member UI';
  w = await launch(M); m = await openManage({ view: 'team' }); await m.waitForTimeout(1200);
  const g = await m.evaluate(() => ({ team: !!document.querySelector('[data-nav=team]'), fields: !!document.querySelector('[data-nav=fields]'), admin: document.querySelectorAll('.adminrow').length, ov: !!document.querySelector('.ovnav.on'), teamPage: !!document.querySelector('.mem-row') }));
  check(`member: no admin nav, /team redirects to Overview ${JSON.stringify(g)}`, !g.team && !g.fields && g.admin === 0 && g.ov && !g.teamPage);
  for (const v of [{ view: 'fields' }, { view: 'reports' }, { view: 'tasksetup' }]) { await app.evaluate((_, v) => globalThis.__desklist.openManage(v), v); await m.waitForTimeout(500);
    check(`member: ${v.view} redirects to Overview`, await m.locator('.ovnav.on').count() === 1); }
  await m.locator('.ri, .gcard').first().click().catch(() => {}); await app.evaluate((_, id) => globalThis.__desklist.openManage({ view: 'project', projectId: id }), pid); await m.locator('.tr').first().waitFor();
  check('member: no edit pencil / delete project', await m.locator('.racts .rowedit').count() === 0 && await m.locator('text=Delete project').count() === 0);
  const s403 = await Promise.all(['/api/reports', '/api/task-setups'].map(async (p) => (await fetch(L.base + p, { method: p === '/api/task-setups' ? 'PUT' : 'GET', headers: { authorization: `Bearer ${M}`, 'content-type': 'application/json' }, body: p === '/api/task-setups' ? '{"title":"x","fields":[]}' : undefined })).status));
  check(`member API 403 ${s403}`, s403.every((x) => x === 403));
  await m.screenshot({ path: path.join(shots, 'v614-member-manage.png') });
} catch (e) { console.error('[v614] FAIL at', step, '-', e.message.split('\n').slice(0, 4).join(' / ')); results.push(['exception at ' + step, false]); }
finally {
  check(`contrast: ${fails} failures`, fails === 0);
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]); feed.close();
  srvProc.kill('SIGTERM'); await Promise.race([new Promise((r) => srvProc.on('close', r)), new Promise((r) => setTimeout(r, 15000))]);
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1; process.exit();
}
