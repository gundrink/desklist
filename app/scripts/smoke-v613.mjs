/** 0.6.13 e2e (temp team): task titles visible in widget + Manage (tasks with fields), widget Overview button + rail row. */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'; import readline from 'node:readline';
import { CONTRAST_AUDIT, LOOK } from './contrast.mjs';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const log = (...a) => console.log('[v613]', ...a);
const results = []; const check = (n, ok) => { results.push([n, !!ok]); log(ok ? 'PASS' : 'FAIL', n); };
const R = Date.now().toString(36).slice(-5); const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
const api = async (base, token, method, p, body) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'] });
const L = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
const NAMES = ['Beli Domain', 'Deploy Website', 'Setup Hosting', 'Konfigurasi DNS', 'Buat Landing Page', 'Testing'];
let app, step = '', fails = 0;
const titles = (win, sel) => win.evaluate(([sel, look]) => { const LOOKF = eval(look); return [...document.querySelectorAll(sel)].map((row) => { const t = row.querySelector(':scope > .t, :scope > .tt'); if (!t) return { name: row.dataset.task, missing: true };
  const r = t.getBoundingClientRect(); const cs = getComputedStyle(t); let op = 1; for (let e = t; e; e = e.parentElement) op *= +getComputedStyle(e).opacity; const L = LOOKF(t);
  return { name: row.dataset.task, text: t.textContent.trim(), w: r.width, op, contrast: L.contrast, vis: cs.visibility }; }); }, [sel, `(${LOOK.toString()})`]);
const verify = async (win, label, sel) => { const rows = await titles(win, sel); const bad = rows.filter((x) => x.missing || x.w <= 40 || x.op < 0.99 || x.contrast < 4.5 || x.vis !== 'visible' || !(x.text ?? '').includes(x.name));
  check(`${label}: ${rows.length} task titles visible (min width ${Math.round(Math.min(...rows.map((x) => x.w ?? 0)))}px, min contrast ${Math.min(...rows.map((x) => x.contrast ?? 0)).toFixed(1)})${bad.length ? ' BAD ' + JSON.stringify(bad[0]) : ''}`, rows.length >= 6 && bad.length === 0); };
const setW = (match, width) => app.evaluate(({ BrowserWindow }, [m, ww]) => { const x = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes(m)); x.setBounds({ ...x.getBounds(), width: ww }); }, [match, width]);
try {
  const as = await api(L.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}a`, password: PW });
  const at = (await api(L.base, null, 'POST', '/api/accounts/redeem', { accountToken: as.accountToken, code: L.code })).token;
  const pid = (await api(L.base, at, 'POST', '/api/projects', { name: `Website Klien ${R}` })).id;
  for (const [i, n] of NAMES.entries()) { const t = await api(L.base, at, 'POST', `/api/projects/${pid}/tasks`, { title: n, dueDate: i === 1 ? '2026-10-25' : undefined });
    await api(L.base, at, 'POST', `/api/tasks/${t.id}/fields`, { label: 'Link', type: 'url' }); if (i === 0) await api(L.base, at, 'PATCH', `/api/tasks/${t.id}`, { notes: 'Pakai Niagahoster' }); }
  const d = await api(L.base, at, 'POST', `/api/projects/${pid}/tasks`, { title: 'Riset kompetitor' }); await api(L.base, at, 'PATCH', `/api/tasks/${d.id}`, { done: true });
  for (const rm of ['no-preference', 'reduce']) {
    step = `launch (${rm})`;
    app = await electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox', ...(rm === 'reduce' ? ['--force-prefers-reduced-motion'] : [])], timeout: 30000,
      env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: L.base, DESKLIST_SMOKE_TOKEN: at, DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl613-')) } });
    const w = await app.firstWindow(); await w.locator('.rail').waitFor({ timeout: 25000 }); await w.emulateMedia({ reducedMotion: rm });
    await w.locator('.pknudge button', { hasText: 'Not now' }).click({ timeout: 2500 }).catch(() => {});
    await w.locator(`.ri[data-project="Website Klien ${R}"]`).click(); await w.locator('.wt[data-task="Beli Domain"]').waitFor({ timeout: 10000 });
    for (const ww of [560, 630, 800]) {
      await setW('widget', ww); await w.waitForTimeout(700); await verify(w, `widget ${ww}px, motion ${rm}`, '.wt:not(.done)');
      const btn = await w.evaluate(() => { const out = {}; for (const lbl of ['Overview', 'Project']) { const b = [...document.querySelectorAll('.w-top .wviewseg button')].find((x) => x.textContent.trim() === lbl); if (!b) { out[lbl] = 'missing'; continue; } const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        out[lbl] = r.width > 40 && r.left >= 0 && r.right <= innerWidth && (hit === b || b.contains(hit)) && b.scrollWidth <= b.clientWidth ? 'ok' : `w${Math.round(r.width)} r${Math.round(r.right)}/${innerWidth}`; } return out; });
      check(`widget ${ww}px: header "Overview" and "Project" buttons visible with text, unclipped, hit-testable (${JSON.stringify(btn)})`, btn.Overview === 'ok' && btn.Project === 'ok');
      if (ww === 630 && rm === 'no-preference') { await w.screenshot({ path: path.join(shots, 'v613-widget-checklist.png') }); await w.locator('.w-top').screenshot({ path: path.join(shots, 'v613-widget-header.png') }); }
    }
    await setW('widget', 630); await w.waitForTimeout(400);
    const a = await w.evaluate(CONTRAST_AUDIT); if (a.fails.length) fails += a.fails.length; log(`widget checklist contrast: ${a.n} checked, ${a.fails.length} fails ${a.fails.slice(0, 2).join(' | ')}`);
    await w.locator('.w-top .wviewseg button', { hasText: 'Overview' }).click(); await w.locator('[data-woverview]').waitFor({ timeout: 5000 });
    check(`motion ${rm}: header Overview button opens Overview; rail Overview row highlighted`, await w.locator('.rov.on').count() === 1);
    await w.locator('.w-top .wviewseg button', { hasText: 'Project' }).click(); await w.locator('.wt').first().waitFor();
    await w.locator('.rov').click(); await w.locator('[data-woverview]').waitFor({ timeout: 5000 }); check(`motion ${rm}: rail "Overview" row opens Overview`, true);
    await w.locator(`.ri[data-project="Website Klien ${R}"]`).click(); await w.locator('.wt[data-task="Beli Domain"]').waitFor({ timeout: 5000 }); check(`motion ${rm}: clicking a rail project returns to the project`, true);
    step = `manage (${rm})`;
    const [m] = await Promise.all([app.waitForEvent('window'), app.evaluate((_, id) => globalThis.__desklist.openManage({ view: 'project', projectId: id }), pid)]); await m.emulateMedia({ reducedMotion: rm });
    await m.locator('.tr[data-task="Beli Domain"]').waitFor({ timeout: 15000 });
    for (const ww of [980, 1280]) { await setW('manage', ww); await m.waitForTimeout(600); await verify(m, `Manage ${ww}px, motion ${rm}`, '.tr:not(.done)'); }
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 6000))]); app = null;
  }
} catch (e) { console.error('[v613] FAIL at', step, '-', e.message.split('\n').slice(0, 4).join(' / ')); results.push(['exception at ' + step, false]); }
finally {
  check(`contrast on widget checklist: ${fails} failures`, fails === 0);
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
  srvProc.kill('SIGTERM'); await Promise.race([new Promise((r) => srvProc.on('close', r)), new Promise((r) => setTimeout(r, 15000))]);
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1; process.exit();
}
