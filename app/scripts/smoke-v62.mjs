/** 0.6.2 e2e (Google sign-in wiring, admin Google email, motion) against the live server. Never logs codes or the client id.
 *  DESKLIST_EXE=release/linux-unpacked/@desklistapp xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/smoke-v62.mjs */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const shots = path.resolve(import.meta.dirname, '../../screenshots');
const SERVER = process.env.DESKLIST_SERVER_URL || 'https://server-production-46b2.up.railway.app';
const ADMIN = fs.readFileSync('/workspace/desklist-release/ADMIN-CODE.txt', 'utf8').split('\n').map((l) => l.trim()).find((l) => /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(l));
const app = await electron.launch({ executablePath: process.env.DESKLIST_EXE, args: ['--no-sandbox'],
  env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl62-')) } });
const log = (...a) => console.log('[v62]', ...a);
const results = []; const check = (name, ok) => { results.push([name, !!ok]); log(ok ? 'PASS' : 'FAIL', name); };
const shot = (pg, n, o = {}) => pg.screenshot({ path: path.join(shots, `v62-${n}.png`), ...o });
const PNAME = `E2E v62 ${Date.now() % 100000}`; const GMAIL = `e2e.v62.${Date.now() % 100000}@gmail.com`;
const api = async (token, method, p, body) => (await fetch(SERVER + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })).json();
const adminTok = (await (await fetch(SERVER + '/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: ADMIN }) })).json()).token;
const opened = async () => new URL((await app.evaluate(() => globalThis.__desklist.opened.slice())).at(-1));
let rec;
try {
  const w = await app.firstWindow(); await w.waitForLoadState('domcontentloaded');
  // 1) Google button + URL structure + simulated loopback callbacks
  await w.getByLabel('Personal code').waitFor();
  check('sign-in shows "Sign in with Google"', await w.getByRole('button', { name: /Sign in with Google/ }).isVisible());
  await shot(w, 'signin-google', { omitBackground: true });
  const nOpen = () => app.evaluate(() => globalThis.__desklist.opened.length);
  const google = async () => { const n0 = await nOpen(); await w.getByRole('button', { name: /Sign in with Google/ }).click();
    for (let i = 0; i < 60 && (await nOpen()) === n0; i++) await w.waitForTimeout(250); return opened(); };
  let g = await google(); const cb = g.searchParams.get('redirect_uri');
  check('opens accounts.google.com/o/oauth2/v2/auth', g.origin === 'https://accounts.google.com' && g.pathname === '/o/oauth2/v2/auth');
  check('client_id present (*.apps.googleusercontent.com, not logged)', /\.apps\.googleusercontent\.com$/.test(g.searchParams.get('client_id') || ''));
  check('PKCE S256 + state + openid email scope', g.searchParams.get('code_challenge')?.length === 43 && g.searchParams.get('code_challenge_method') === 'S256' && (g.searchParams.get('state') || '').length >= 30 && g.searchParams.get('scope') === 'openid email profile' && g.searchParams.get('response_type') === 'code');
  check('redirect_uri is 127.0.0.1 loopback /oauth', /^http:\/\/127\.0\.0\.1:\d+\/oauth$/.test(cb));
  const err = async () => { await w.locator('.signin .err').waitFor({ timeout: 15000 }); return w.locator('.signin .err').textContent(); };
  await fetch(`${cb}?code=bogus-code-123456&state=wrong-state`); check('loopback: state mismatch rejected in app', /state mismatch/i.test(await err()));
  g = await google(); await fetch(`${g.searchParams.get('redirect_uri')}?error=access_denied&state=${g.searchParams.get('state')}`); check('loopback: user cancel handled', /cancelled/i.test(await err()));
  g = await google(); await fetch(`${g.searchParams.get('redirect_uri')}?code=4/0bogus-e2e-code-${Date.now()}&state=${g.searchParams.get('state')}`);
  check('loopback code exchanged with server -> Google rejects bogus code', /Google rejected/i.test(await err()));
  const bad = await fetch(SERVER + '/api/auth/google/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(20), verifier: 'v'.repeat(43), redirectUri: 'https://evil.example/cb', state: 's'.repeat(20) }) });
  check('server refuses non-loopback redirect_uri', bad.status === 400);

  // 2) admin sets a member's Google email
  await w.getByLabel('Personal code').fill(ADMIN); await w.getByRole('button', { name: 'Sign in', exact: true }).click();
  await w.locator('.rail').waitFor({ timeout: 25000 }); check('admin sign-in', true);
  await api(adminTok, 'POST', '/api/members', { name: 'E2E Member G', role: 'member' });
  const [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'create' }))]);
  await m.getByLabel('Project name').fill(PNAME); await m.getByRole('button', { name: 'Create project' }).click(); await m.locator('.tplmodal').waitFor({ timeout: 15000 });
  await m.getByRole('button', { name: 'Skip' }).click(); await m.locator('.rhead h1', { hasText: PNAME }).waitFor();
  await m.locator('.navbtn', { hasText: 'Team & codes' }).click();
  const row = m.locator('.gmail[data-gmail="E2E Member G"]'); await row.waitFor({ timeout: 15000 });
  await row.getByRole('button', { name: 'Add Google email' }).click(); await m.getByLabel('Google email for E2E Member G').fill(GMAIL);
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  await m.locator('.gmail[data-gmail="E2E Member G"]', { hasText: GMAIL }).waitFor({ timeout: 15000 });
  const snap = await api(adminTok, 'GET', '/api/snapshot');
  check('admin set member Google email (stored server-side)', snap.members.find((x) => x.name === 'E2E Member G')?.googleEmail === GMAIL);
  await shot(m, 'team-google-email');
  const dup = await api(adminTok, 'PATCH', `/api/members/${snap.me.id}`, { googleEmail: GMAIL.toUpperCase() });
  check('same Google email cannot be given to two members', !!dup.error);

  // 3) motion: expand/collapse + modal + tab switch, recorded
  await m.locator('.navbtn', { hasText: 'Projects' }).first().click().catch(() => {});
  await m.locator(`.gcard[data-project="${PNAME}"] .gname`).click(); await m.locator('.stabs').waitFor();
  for (const t of ['Buy domain', 'Set up email']) { await m.getByLabel('New task title').fill(t); await m.getByRole('button', { name: 'Add task' }).click(); await m.locator(`.tr[data-task="${t}"]`).waitFor({ timeout: 15000 }); }
  if (process.env.DISPLAY) {
    const out = path.join(shots, 'v62-motion.mp4');
    rec = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '30', '-video_size', '1920x1080', '-i', process.env.DISPLAY, '-vf', 'scale=1280:-2', '-pix_fmt', 'yuv420p', out]);
    await m.waitForTimeout(800);
  }
  const fr = async (n) => m.screenshot({ path: path.join(shots, `v62-motion-${n}.png`) });
  await m.locator('.tr[data-task="Buy domain"] .expbtn').click(); await m.waitForTimeout(60); await fr('1-expanding');
  await m.locator('.mcollapse.in').waitFor(); await m.waitForTimeout(300); await fr('2-expanded');
  const h = await m.locator('.mcollapse').evaluate((e) => e.getBoundingClientRect().height); check('task panel expanded with height ' + Math.round(h), h > 40);
  await m.locator('.tpanel .tpx').click(); await m.waitForTimeout(60); await fr('3-collapsing');
  await m.locator('.mcollapse').waitFor({ state: 'detached', timeout: 2000 }); check('panel collapses and unmounts after exit animation', true);
  await m.locator('.modetgl button', { hasText: 'View' }).click(); await m.waitForTimeout(80); await fr('4-view-crossfade'); await m.waitForTimeout(400);
  await m.locator('.modetgl button', { hasText: 'Edit' }).click(); await m.waitForTimeout(400);
  await m.locator('.tr[data-task="Set up email"] .expbtn').click(); await m.waitForTimeout(500);
  await m.locator('.tpanel .tpx').click(); await m.waitForTimeout(500);
  await m.locator('.navbtn', { hasText: 'New project' }).first().click().catch(() => {}); await m.waitForTimeout(500);
  await m.keyboard.press('Escape').catch(() => {});
  const anim = await m.evaluate(() => getComputedStyle(document.querySelector('.tr')).animationName);
  check('row enter animation defined (' + anim + ')', anim === 'mItem');
  const reduced = await m.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.media && /prefers-reduced-motion/.test(r.media.mediaText)); } catch { return false; } }));
  check('prefers-reduced-motion rule present', reduced);
  // typing focus in widget survives motion
  await w.getByLabel(/New task/).first().click().catch(() => {}); 
  if (rec) { await m.waitForTimeout(500); rec.stdin.write('q'); await new Promise((r) => rec.on('close', r)); rec = null; check('motion recording saved', fs.statSync(path.join(shots, 'v62-motion.mp4')).size > 10000); }
} catch (e) { console.error('[v62] FAIL', e.message); for (const [i, win] of app.windows().entries()) await win.screenshot({ path: `/tmp/v62fail-${i}.png` }).catch(() => {}); results.push(['exception', false]); }
finally {
  if (rec) rec.kill('SIGINT');
  try {
    const snap = await api(adminTok, 'GET', '/api/snapshot');
    for (const p of snap.projects.filter((p) => p.name.startsWith('E2E v62'))) { await api(adminTok, 'DELETE', `/api/projects/${p.id}`); log('deleted project', p.name); }
    for (const mm of snap.members.filter((x) => x.name.startsWith('E2E Member'))) { await api(adminTok, 'DELETE', `/api/members/${mm.id}`); log('deleted member', mm.name); }
    await api(adminTok, 'POST', '/api/auth/signout');
  } catch (e) { log('cleanup error', e.message); }
  await app.close();
  const failed = results.filter(([, ok]) => !ok); log(`${results.length - failed.length}/${results.length} checks passed`); if (failed.length) process.exitCode = 1;
}
