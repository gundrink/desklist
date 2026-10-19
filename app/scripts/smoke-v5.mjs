/** v5 screenshots: widget + Manage (checklist w/ Pengeluaran, template step, reimbursement, admin reports) + live sync check.
 *  DESKLIST_SERVER_URL=... xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/smoke-v5.mjs */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const shots = path.resolve(import.meta.dirname, '../../screenshots'); fs.mkdirSync(shots, { recursive: true });
const app = await electron.launch({ executablePath: (await import('electron')).default, args: [path.resolve(import.meta.dirname, '..'), '--no-sandbox'],
  env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl5-')) } });
const log = (...a) => console.log('[v5]', ...a);
try {
  const w = await app.firstWindow(); await w.waitForLoadState('domcontentloaded');
  await w.getByLabel('Personal code').fill('DEMO-ADMIN'); await w.getByRole('button', { name: 'Sign in' }).click();
  await w.locator('.ri[data-project="Project A"]').click(); await w.locator('.rbadge').waitFor({ timeout: 20000 }); await w.waitForTimeout(800);
  await w.screenshot({ path: path.join(shots, 'v5-widget.png'), omitBackground: true }); log('widget ok');
  const [m] = await Promise.all([app.waitForEvent('window'), (async () => { await w.getByLabel('Widget menu').click(); await w.getByRole('button', { name: 'Open Manage window' }).click(); })()]);
  m.on('pageerror', (e) => console.log('[v5] pageerror', e.message)); m.on('console', (c) => c.type() === 'error' && console.log('[v5] console', c.text()));
  await m.locator('.gcard').first().waitFor({ timeout: 15000 });
  await m.locator('.gcard[data-project="Project A"] .gname').click(); await m.locator('.tr').first().waitFor(); await m.waitForTimeout(600);
  await m.screenshot({ path: path.join(shots, 'v5-manage-overview.png') }); log('overview ok');
  // live sync: add a task with an expense in Manage -> widget shows the tag
  const title = `Langganan Figma ${Date.now() % 10000}`;
  await m.getByLabel('New task title').fill(title);
  await m.locator('.addexp .tgl').click(); await m.getByLabel('Task expense nominal').fill('0.1');
  await m.getByRole('button', { name: 'Add task' }).click();
  await w.locator(`.wt[data-task="${title}"] .wtag`).waitFor({ timeout: 15000 }); log('live sync: widget shows', await w.locator(`.wt[data-task="${title}"] .wtag`).textContent());
  await m.getByRole('button', { name: /^Reimbursement/ }).click(); await m.locator('.rtr').first().waitFor(); await m.waitForTimeout(400);
  await m.screenshot({ path: path.join(shots, 'v5-manage-reimbursement.png') }); log('reimb ok');
  await m.locator('.adminrow').click(); await m.locator('.etr').first().waitFor({ timeout: 15000 }); await m.waitForTimeout(600);
  await m.screenshot({ path: path.join(shots, 'v5-manage-admin-reports.png') }); log('reports ok');
  await m.getByRole('button', { name: 'New project' }).click(); await m.getByLabel('Project name').fill('Project H (v5 smoke)');
  await m.getByRole('button', { name: 'Create project' }).click(); await m.locator('.tplmodal').waitFor({ timeout: 15000 }); await m.waitForTimeout(500);
  await m.screenshot({ path: path.join(shots, 'v5-manage-template.png') }); log('template ok');
  await m.getByRole('button', { name: 'Apply template' }).click(); await m.locator('.tplmodal').waitFor({ state: 'detached', timeout: 15000 });
  await m.waitForTimeout(1500); log('tasks after template:', await m.locator('.tr').count());
  // cleanup the smoke project + task
  const st = await app.evaluate(() => globalThis.__desklist.state());
  for (const p of st.snapshot.projects.filter((p) => p.name.startsWith('Project H (v5 smoke)'))) await m.evaluate((id) => window.desklist.request('DELETE', `/api/projects/${id}`), p.id);
  const t = st.snapshot.tasks.find((x) => x.title === title); if (t) await m.evaluate((id) => window.desklist.request('DELETE', `/api/tasks/${id}`), t.id);
  log('DONE');
} catch (e) { console.error('[v5] FAIL', e); for (const win of app.windows()) await win.screenshot({ path: `/tmp/fail-${app.windows().indexOf(win)}.png` }).catch(() => {}); process.exitCode = 1; } finally { await app.close(); }
