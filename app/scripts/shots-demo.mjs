/** README screenshots with neutral demo data on a temporary team (cleaned up on exit). */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn, execFileSync } from 'node:child_process'; import readline from 'node:readline';
const out = path.resolve(import.meta.dirname, '../../docs/screenshots'); fs.mkdirSync(out, { recursive: true });
const log = (...a) => console.log('[demo]', ...a);
const api = async (base, token, method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${j.error ?? ''}`); return j; };
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, DESKLIST_E2E_TEAM_NAME: 'Demo Team', DESKLIST_E2E_ADMIN_NAME: 'Alex Morgan', DESKLIST_E2E_ADMIN_INITIALS: 'AM' } });
const L = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
const pad2 = (n) => String(n).padStart(2, '0'); const dstr = (k) => { const d = new Date(Date.now() + k * 86400000); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'dldemo-'));
const save = async (page, name) => { const f = path.join(out, name); await page.screenshot({ path: f }); log('saved', name); };
let app;
try {
  const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
  const as = await api(L.base, null, 'POST', '/api/accounts/signup', { username: 'alexmorgan', password: PW });
  const at = (await api(L.base, null, 'POST', '/api/accounts/redeem', { accountToken: as.accountToken, code: L.code })).token;
  const sam = await api(L.base, at, 'POST', '/api/members', { name: 'Sam Carter', role: 'member' });
  const jordan = await api(L.base, at, 'POST', '/api/members', { name: 'Jordan Lee', role: 'member' });
  const me = (await api(L.base, at, 'GET', '/api/snapshot')).me;
  const proj = async (name, dl, tasks, extra = {}) => { const p = await api(L.base, at, 'POST', '/api/projects', { name, ...extra }); if (dl) await api(L.base, at, 'PATCH', `/api/projects/${p.id}`, { deadline: dl });
    const ts = []; for (const [title, done, bic, due] of tasks) { const t = await api(L.base, at, 'POST', `/api/projects/${p.id}/tasks`, { title, bicMemberId: bic ?? null, dueDate: due ?? undefined }); if (done) await api(L.base, at, 'PATCH', `/api/tasks/${t.id}`, { done: true }); ts.push(t); } return { p, ts }; };
  const web = await proj('Website launch', dstr(3), [['Buy domain', true, me.id], ['Set up hosting', true, sam.id], ['Write homepage copy', false, sam.id, dstr(2)], ['Design hero section', false, jordan.id], ['QA pass', false, me.id, dstr(3)]], { hasExpenses: true });
  await api(L.base, at, 'PATCH', `/api/projects/${web.p.id}`, { notes: 'Launch the new marketing site.\nStaging: https://staging.example.com\nCopy doc: www.example.com/docs/homepage' });
  for (const [t, amt] of [[web.ts[0], 12], [web.ts[1], 30]]) { await api(L.base, at, 'PATCH', `/api/tasks/${t.id}`, { hasExpense: true }); await api(L.base, at, 'PUT', `/api/tasks/${t.id}/reimbursement`, { item: t.title, category: 'Other', amount: amt, currency: 'USD' }); }
  await api(L.base, at, 'POST', `/api/tasks/${web.ts[2].id}/items`, { title: 'Hero headline' }); await api(L.base, at, 'POST', `/api/tasks/${web.ts[2].id}/items`, { title: 'Pricing section' });
  await proj('Brand refresh', dstr(8), [['Moodboard', true, jordan.id], ['Logo options', false, jordan.id], ['Color palette', false, sam.id]]);
  await proj('Mobile app beta', dstr(-1), [['TestFlight build', true, me.id], ['Invite testers', false, sam.id], ['Collect feedback', false, me.id]]);
  await proj('Client onboarding', dstr(3), [['Kickoff call', true, me.id], ['Shared drive', true, jordan.id]]);
  await proj('Q4 newsletter', dstr(15), [['Outline', false, sam.id], ['Draft', false, me.id]]);
  const launch = (token) => electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'], timeout: 30000, env: { ...process.env, TZ: 'Europe/London', DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: L.base, DESKLIST_USER_DATA: token ? UD : fs.mkdtempSync(path.join(os.tmpdir(), 'dldemo0-')), ...(token ? { DESKLIST_SMOKE_TOKEN: token } : {}) } });
  app = await launch(null); let w = await app.firstWindow(); await w.locator('.signin').waitFor({ timeout: 20000 }); await w.waitForTimeout(800); await save(w, 'sign-in.png');
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 6000))]);
  app = await launch(at); w = await app.firstWindow(); await w.locator('.rail').waitFor({ timeout: 25000 });
  await w.evaluate(() => { localStorage.setItem('dl-clock', 'digital'); localStorage.removeItem('dl-tz'); });
  await w.locator('.pknudge button', { hasText: 'Not now' }).click({ timeout: 3000 }).catch(() => {});
  await w.locator('.ri[data-project="Website launch"]').click(); await w.locator('.wviewseg button', { hasText: 'Project' }).click(); await w.waitForTimeout(900); await save(w, 'widget-project.png');
  await w.locator('.wviewseg button', { hasText: 'Overview' }).click(); await w.locator('[data-woverview]').waitFor(); await w.waitForTimeout(900); await save(w, 'widget-overview.png');
  const [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage())]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('manage'))?.setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  await m.locator('[data-overview]').waitFor({ timeout: 15000 }); await m.waitForTimeout(1200); await save(m, 'overview-digital.png');
  await m.locator('.ovhero .clockseg button', { hasText: 'Analog' }).click(); await m.waitForTimeout(900); await save(m, 'overview-analog.png');
  await m.locator('.ovhero .clockseg button', { hasText: 'Digital' }).click();
  await m.locator('.gcard[data-project="Website launch"] .gname').click(); await m.locator('.tr[data-task="QA pass"]').waitFor(); await m.waitForTimeout(800); await save(m, 'project-detail.png');
  for (const [v, f] of [['reports', 'reports.png'], ['tasksetup', 'task-setup.png'], ['settings', 'settings.png']]) { await app.evaluate((_, vv) => globalThis.__desklist.openManage({ view: vv }), v); await m.waitForTimeout(1200); await save(m, f); }
  for (const f of fs.readdirSync(out)) execFileSync('python3', ['-c', `from PIL import Image\nim=Image.open('${path.join(out, f)}').convert('RGB')\nim=im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)\nim.save('${path.join(out, f)}', optimize=True)`]);
  log('done');
} catch (e) { console.error('[demo] FAIL', e.message.split('\n').slice(0, 4).join(' / ')); process.exitCode = 1; }
finally { await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]); srvProc.kill('SIGTERM'); await Promise.race([new Promise((r) => srvProc.on('close', r)), new Promise((r) => setTimeout(r, 15000))]); process.exit(); }
