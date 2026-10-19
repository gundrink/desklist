/** 0.6.10 e2e: transparent widget window over a bright wallpaper (Xvfb + picom), signed-out widget without a nested card,
 *  background-opacity slider (30% / 100%, live, persisted across restart, text stays opaque), sign-in + tick regression. */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn, execFileSync } from 'node:child_process'; import readline from 'node:readline';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const log = (...a) => console.log('[v610]', ...a);
const results = []; const check = (n, ok) => { results.push([n, !!ok]); log(ok ? 'PASS' : 'FAIL', n); };
const R = Date.now().toString(36).slice(-5); const PW = 'Pw-' + Math.random().toString(36).slice(2, 12);
const DISP = ':' + (90 + Math.floor(Math.random() * 9));
const api = async (base, token, method, p, body) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const xvfb = spawn('Xvfb', [DISP, '-screen', '0', '1600x1000x24', '+extension', 'Composite', '+extension', 'RENDER'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const env = { ...process.env, DISPLAY: DISP };
execFileSync('hsetroot', ['-add', '#ffe36e', '-add', '#7fe3ff', '-add', '#ff8ad8', '-gradient', '45'], { env });
const picom = spawn('picom', ['--backend', 'xrender', '--no-fading-openclose'], { env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
/** root-window grab cropped around the widget, + pixel probes (corner outside the rounded radius vs. inside) */
const grab = (file, b) => JSON.parse(execFileSync('python3', ['-c', `
import json,sys
from PIL import ImageGrab
im = ImageGrab.grab(xdisplay='${DISP}').convert('RGB'); x,y,w,h = ${b.x},${b.y},${b.width},${b.height}
m = 40; im.crop((max(0,x-m), max(0,y-m), x+w+m, y+h+m)).save('${file}')
wall = im.getpixel((max(0,x-15), max(0,y-15))); corner = im.getpixel((x+2, y+2)); inner = im.getpixel((x+w//2, y+h-40))
print(json.dumps({'wall': wall, 'corner': corner, 'inner': inner}))`], { env }).toString());
const near = (a, b, t = 40) => a.every((v, i) => Math.abs(v - b[i]) <= t);
const bright = (c) => c[0] + c[1] + c[2] > 400;
const srvProc = spawn(path.resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), ['scripts/fake-google-server.ts'], { cwd: path.resolve(import.meta.dirname, '../../server'), stdio: ['ignore', 'pipe', 'inherit'] });
const L = await new Promise((r) => readline.createInterface({ input: srvProc.stdout }).once('line', (l) => r(JSON.parse(l))));
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'dl610-'));
const launch = () => electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'], timeout: 30000,
  env: { ...env, DESKLIST_SMOKE: '1', DESKLIST_SERVER_URL: L.base, DESKLIST_USER_DATA: UD } });
const widgetBounds = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('widget'))?.getBounds());
const INPUT_AUDIT = () => {
  const bad = []; const px = (v) => parseFloat(v) || 0;
  const vis = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  const fields = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]),textarea,.selx')].filter(vis);
  for (const el of fields) {
    const c = getComputedStyle(el); const r = el.getBoundingClientRect(); const own = px(c.borderTopWidth) > 0 && c.borderTopStyle !== 'none';
    let a = el.parentElement;
    for (let i = 0; i < 3 && a; i++, a = a.parentElement) {
      const ac = getComputedStyle(a); const ar = a.getBoundingClientRect();
      const framed = px(ac.borderTopWidth) > 0 && ac.borderTopStyle !== 'none' && ac.borderTopColor !== 'rgba(0, 0, 0, 0)';
      if (framed && own && ar.height <= r.height + 22) { bad.push(`${el.getAttribute('aria-label') || el.placeholder || el.className} in .${String(a.className).split(' ')[0]}`); break; }
    }
    if (c.outlineStyle !== 'none' && px(c.outlineWidth) > 0 && document.activeElement === el) bad.push(`${el.getAttribute('aria-label') || el.className} has outline`);
  }
  return { n: fields.length, bad: [...new Set(bad)] };
};
const inputs = async (win, name) => { const a = await win.evaluate(INPUT_AUDIT); check(`${name}: ${a.n} fields, no box-in-box (${a.bad.slice(0, 5).join(' | ') || 'none'})`, a.n > 0 && !a.bad.length); };
let app, step = '';
try {
  const as = await api(L.base, null, 'POST', '/api/accounts/signup', { username: `e2e_v64_${R}a`, password: PW });
  const at = (await api(L.base, null, 'POST', '/api/accounts/redeem', { accountToken: as.accountToken, code: L.code })).token;
  const pid = (await api(L.base, at, 'POST', '/api/projects', { name: `Look ${R}` })).id;
  const t = await api(L.base, at, 'POST', `/api/projects/${pid}/tasks`, { title: 'Tick me' });
  await api(L.base, at, 'POST', `/api/projects/${pid}/tasks`, { title: 'Second task' });
  step = 'signed-out widget';
  app = await launch(); let w = await app.firstWindow(); await w.locator('.signin').waitFor({ timeout: 20000 }); await w.waitForTimeout(1200);
  const so = await w.evaluate(() => { const c = getComputedStyle(document.querySelector('.signin')); const h = getComputedStyle(document.documentElement).backgroundColor; const b = getComputedStyle(document.body).backgroundColor;
    const sr = document.querySelector('.signin').getBoundingClientRect(); return { border: c.borderTopWidth, bg: c.backgroundColor, shadow: c.boxShadow, html: h, body: b, top: sr.top, bottom: innerHeight - sr.bottom }; });
  check(`page background transparent (html ${so.html}, body ${so.body})`, so.html === 'rgba(0, 0, 0, 0)' && so.body === 'rgba(0, 0, 0, 0)');
  check(`sign-in is not a nested card (border ${so.border}, bg ${so.bg})`, so.border === '0px' && so.bg === 'rgba(0, 0, 0, 0)' && so.shadow === 'none');
  check(`sign-in vertically centered (top ${Math.round(so.top)} / bottom ${Math.round(so.bottom)})`, Math.abs(so.top - so.bottom) < 140);
  let b = await widgetBounds(app); let px = grab(path.join(shots, 'v610-widget-signin.png'), b);
  check(`corner outside rounded panel shows wallpaper (corner ${px.corner}, wall ${px.wall})`, bright(px.corner) && near(px.corner, px.wall, 70));
  await inputs(w, 'sign-in inputs');
  step = 'sign in';
  await w.getByLabel('Username').fill(`e2e_v64_${R}a`); await w.getByLabel('Password', { exact: true }).fill(PW);
  await w.getByRole('button', { name: 'Sign in', exact: true }).click(); await w.locator('.rail').waitFor({ timeout: 25000 }); check('sign-in works', true);
  await w.locator('.pknudge button', { hasText: 'Not now' }).click({ timeout: 3000 }).catch(() => {});
  step = 'settings';
  const [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'settings' }))]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('widget'))?.setBounds({ x: 0, y: 0, width: 980, height: 900 }));
  const sl = m.locator('[data-card="widget"]').getByLabel('Widget background opacity'); await sl.waitFor({ timeout: 15000 });
  check('default opacity 85%', (await sl.inputValue()) === '85');
  await sl.fill('30'); await w.waitForFunction(() => getComputedStyle(document.querySelector('.widget')).getPropertyValue('--wa').trim() === '0.3', null, { timeout: 5000 }).catch(() => {});
  await m.locator('[data-card="widget"]').scrollIntoViewIfNeeded(); await m.screenshot({ path: path.join(shots, 'v610-settings-widget.png') });
  const look = await w.evaluate(() => { const wd = document.querySelector('.widget'); const t = document.querySelector('.wt .t'); return { wa: getComputedStyle(wd).getPropertyValue('--wa').trim(), bg: getComputedStyle(wd).backgroundImage, text: getComputedStyle(t).color, op: getComputedStyle(t).opacity, blur: getComputedStyle(wd).backdropFilter }; });
  check(`30% applied live to the panel background (${look.bg.slice(0, 60)}…)`, look.wa === '0.3' && look.bg.includes('0.3)'));
  check(`text stays opaque at 30% (${look.text}, opacity ${look.op})`, !/rgba\(.*, 0\.\d+\)$/.test(look.text) && look.op === '1');
  check(`blur on by default at low opacity (${look.blur})`, look.blur.includes('blur'));
  await w.waitForTimeout(400); b = await widgetBounds(app); px = grab(path.join(shots, 'v610-widget-opacity-30.png'), b);
  const at30 = px.inner;
  await sl.fill('100'); await w.waitForTimeout(500); px = grab(path.join(shots, 'v610-widget-opacity-100.png'), b);
  check(`100% panel is darker than 30% (inner ${px.inner} vs ${at30})`, px.inner.reduce((a, c) => a + c) < at30.reduce((a, c) => a + c) - 60);
  check('corners stay transparent at 100%', bright(px.corner));
  step = 'input audit';
  await inputs(m, 'settings');
  for (const v of ['create', 'tasksetup', 'team']) { await app.evaluate((_, vv) => globalThis.__desklist.openManage({ view: vv }), v); await m.waitForTimeout(900); await inputs(m, v); }
  await app.evaluate((_, id) => globalThis.__desklist.openManage({ view: 'project', projectId: id }), pid); await m.locator('.tr[data-task="Second task"]').waitFor({ timeout: 10000 });
  await m.locator('.nc.hdr').click(); await m.getByRole('menuitem', { name: 'Input column' }).click(); await m.waitForTimeout(500);
  const firstIn = m.locator('.sheet input, .modal input, [role=dialog] input').first(); await firstIn.focus().catch(() => {});
  await m.waitForTimeout(250); await m.screenshot({ path: path.join(shots, 'v610-inputs.png') }); await inputs(m, 'input column (focused)');
  await m.locator('.sheet .iconbtn[title=Close]').click();
  await m.locator('.tr[data-task="Second task"]').hover(); await m.getByLabel('Edit Second task').click(); await m.locator('.teditp').waitFor(); await m.waitForTimeout(700); await inputs(m, 'task edit panel');
  await m.locator('.teditp').getByLabel('Has reimbursement').check({ force: true }); await m.locator('.teditp').getByRole('button', { name: 'Save' }).click(); await m.waitForTimeout(1200);
  await m.getByLabel('Close edit').click({ timeout: 2000 }).catch(() => {}); await m.waitForTimeout(400); await m.locator('.tr[data-task="Second task"] .expbtn').click({ force: true }); await m.locator('.tpanel .rsec').waitFor({ timeout: 10000 });
  await m.locator('.tpanel .addfield').first().click(); await m.locator('.typepop .tpi').first().click(); await m.waitForTimeout(300);
  await inputs(m, 'task detail + add field + reimbursement');
  await inputs(w, 'widget add-task');
  step = 'tick regression';
  await w.locator('.wt[data-task="Tick me"] .cbx, .wt[data-task="Tick me"] [role=checkbox]').first().click();
  let done = false; for (let i = 0; i < 20 && !done; i++) { done = (await api(L.base, at, 'GET', '/api/snapshot')).tasks.find((x) => x.id === t.id)?.done; if (!done) await w.waitForTimeout(500); }
  check('task tick syncs to server', done);
  step = 'persist';
  await app.evaluate(() => globalThis.__desklist.openManage({ view: 'settings' })); await m.waitForTimeout(700); await sl.fill('30'); await w.waitForTimeout(800);
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 6000))]);
  app = await launch(); w = await app.firstWindow(); await w.locator('.widget').waitFor({ timeout: 20000 }); await w.waitForTimeout(1500);
  check('opacity 30% persists across restart', (await w.evaluate(() => getComputedStyle(document.querySelector('.widget')).getPropertyValue('--wa').trim())) === '0.3');
} catch (e) { console.error('[v610] FAIL at', step, '-', e.message.split('\n').slice(0, 5).join(' / ')); results.push(['exception at ' + step, false]); for (const [i, win] of (app?.windows() ?? []).entries()) await win.screenshot({ path: `/tmp/v610-${i}.png`, timeout: 5000 }).catch(() => {}); }
finally {
  await Promise.race([app?.close().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
  srvProc.kill('SIGTERM'); await Promise.race([new Promise((r) => srvProc.on('close', r)), new Promise((r) => setTimeout(r, 15000))]);
  picom.kill(); xvfb.kill();
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1; process.exit();
}
