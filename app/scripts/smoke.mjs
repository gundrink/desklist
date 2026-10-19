/**
 * Smoke run + screenshots. Drives the real built Electron app against a running sync server.
 *   xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/smoke.mjs
 * Env: DESKLIST_SERVER_URL (default http://localhost:8787), SMOKE_CODE (default DEMO-ADMIN)
 */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const shots = path.resolve(appDir, '../screenshots');
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'desklist-smoke-'));
const log = (...a) => console.log('[smoke]', ...a);

const app = await electron.launch({
  executablePath: (await import('electron')).default,
  args: [appDir, '--no-sandbox'],
  env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_USER_DATA: userData, DESKLIST_SERVER_URL: process.env.DESKLIST_SERVER_URL || 'http://localhost:8787' },
});
const result = { ok: false, steps: [] };
const step = (s) => { result.steps.push(s); log(s); };
try {
  const widget = await app.firstWindow();
  await widget.waitForLoadState('domcontentloaded');
  step('widget window opened: ' + widget.url().split('?')[1]);
  await widget.getByLabel('Personal code').fill(process.env.SMOKE_CODE || 'DEMO-ADMIN');
  await widget.getByRole('button', { name: 'Sign in' }).click();
  await widget.locator('.rail .ri').first().waitFor({ timeout: 20000 });
  step('signed in; rail shows ' + (await widget.locator('.rail .ri').count()) + ' projects');
  await widget.locator('.ri[data-project="Project A"]').click();
  await widget.waitForTimeout(600);
  await widget.screenshot({ path: path.join(shots, '01-widget.png'), omitBackground: true });
  step('screenshot 01-widget.png');
  const layer = await app.evaluate(() => globalThis.__desklist?.layerMode());
  step('desktop layer mode on this OS: ' + layer);

  // Notes menu in the widget
  await widget.locator('.wchip').click();
  await widget.waitForTimeout(250);
  await widget.screenshot({ path: path.join(shots, '06-widget-notes-menu.png'), omitBackground: true });
  await widget.getByRole('menuitem', { name: 'Input notes' }).click();
  await widget.locator('.sheet textarea').waitFor();
  await widget.screenshot({ path: path.join(shots, '07-widget-input-notes.png'), omitBackground: true });
  await widget.keyboard.press('Escape');
  await widget.locator('.sheet .iconbtn').click();
  step('widget Notes menu + Input notes editor work');

  // Manage window from the widget ⋯ menu
  const [manage] = await Promise.all([
    app.waitForEvent('window'),
    (async () => { await widget.getByLabel('Widget menu').click(); await widget.getByRole('button', { name: 'Open Manage window' }).click(); })(),
  ]);
  await manage.waitForLoadState('domcontentloaded');
  await manage.locator('.gcard').first().waitFor({ timeout: 15000 });
  await manage.setViewportSize?.({ width: 1312, height: 860 }).catch(() => {});
  step('manage window opened with ' + (await manage.locator('.gcard').count()) + ' project cards');
  await manage.locator('.gcard[data-project="Project A"]').click();
  await manage.locator('.tr').first().waitFor();
  await manage.waitForTimeout(500);
  await manage.screenshot({ path: path.join(shots, '02-manage-project-detail.png') });
  step('screenshot 02-manage-project-detail.png');

  // Inline Input notes editor + Notes column menu + hover tip
  await manage.locator('.tr[data-task="Write onboarding guide"] .nc').click();
  await manage.locator('.neditor textarea').fill('Cover install, sign-in and widget pinning; add screenshots for Windows 11');
  await manage.locator('.tr[data-task="Set up Railway deploy"]').hover();
  await manage.waitForTimeout(200);
  await manage.screenshot({ path: path.join(shots, '02b-manage-inline-notes-editor.png') });
  await manage.getByRole('button', { name: 'Cancel' }).click();
  await manage.locator('.nc.hdr').click();
  await manage.waitForTimeout(200);
  await manage.screenshot({ path: path.join(shots, '02c-manage-notes-menu.png') });
  await manage.keyboard.press('Escape');
  step('inline note editor + Notes menu rendered');

  // Details & fields tab
  await manage.getByRole('button', { name: 'Details & fields' }).click();
  await manage.waitForTimeout(400);
  await manage.screenshot({ path: path.join(shots, '02d-manage-details-fields.png') });
  await manage.getByRole('button', { name: 'Checklist' }).click();

  // Create form with a custom column
  await manage.getByRole('button', { name: 'New project' }).click();
  await manage.getByLabel('Project name').fill('Project H');
  await manage.getByRole('button', { name: 'Add column' }).click();
  await manage.getByLabel('Column label').fill('Repo link');
  await manage.getByLabel('Column type').selectOption('url');
  await manage.getByLabel('Column value').fill('https://github.com/OWNER/project-h');
  await manage.waitForTimeout(200);
  await manage.screenshot({ path: path.join(shots, '03-create-project-custom-column.png') });
  step('screenshot 03-create-project-custom-column.png');
  await manage.getByRole('button', { name: 'Cancel' }).click();

  // Master fields
  await manage.getByRole('button', { name: 'Master fields' }).click();
  await manage.locator('.mf-row[data-field="status"]').waitFor();
  await manage.waitForTimeout(200);
  await manage.screenshot({ path: path.join(shots, '04-master-fields.png') });
  step('screenshot 04-master-fields.png');

  await manage.getByRole('button', { name: 'Team & codes' }).click();
  await manage.waitForTimeout(300);
  await manage.screenshot({ path: path.join(shots, '08-team-codes.png') });

  // Live sync demo: check a task in Manage → it appears as done (checked by AD) in the widget
  await manage.locator('.gcard[data-project="Project A"]').click();
  const task = 'Set up Railway deploy';
  await manage.locator(`.tr[data-task="${task}"] .cbx`).click();
  await widget.locator(`.wt.done[data-task="${task}"]`).waitFor({ timeout: 15000 });
  await manage.locator(`.tr.done[data-task="${task}"]`).waitFor();
  for (let i = 0; i < 40 && (await app.evaluate(() => globalThis.__desklist.state().pending)) > 0; i++) await widget.waitForTimeout(250);
  await widget.waitForTimeout(400);
  await manage.screenshot({ path: path.join(shots, '05a-sync-checked-in-manage.png') });
  await widget.screenshot({ path: path.join(shots, '05b-sync-shows-done-in-widget.png'), omitBackground: true });
  const title = await widget.locator(`.wt.done[data-task="${task}"]`).getAttribute('title');
  step(`sync: checked "${task}" in Manage → widget shows done (${title?.split('\n')[0]})`);
  // and back the other way: uncheck from the widget, wait for server round-trip
  await widget.locator(`.wt.done[data-task="${task}"] .cbx`).click();
  await manage.locator(`.tr:not(.done)[data-task="${task}"]`).waitFor({ timeout: 15000 });
  await manage.waitForTimeout(1500);
  const st = await app.evaluate(() => { const s = globalThis.__desklist.state(); return { pending: s.pending, connection: s.connection }; });
  step(`sync: unchecked in widget → pending again in Manage; outbox=${st.pending}, connection=${st.connection}`);
  result.ok = true;
  // Composite: the two real window captures placed on a generated wallpaper (Xvfb has no desktop/compositor).
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('python3', [path.join(here, 'composite.py'), shots], { stdio: 'inherit' }); step('composite 00-desktop-composite.png'); } catch { log('composite skipped (python3/Pillow missing)'); }
} catch (e) {
  console.error('[smoke] FAILED', e);
  try { for (const [i, w] of app.windows().entries()) await w.screenshot({ path: path.join(shots, `zz-failure-${i}.png`) }); } catch {}
} finally {
  await app.close().catch(() => {});
  fs.writeFileSync(path.join(shots, 'smoke-result.json'), JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
