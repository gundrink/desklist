/** v6 e2e against the live server: admin sign-in, project w/ deadline, task fields, reimbursement, tick+note+file,
 *  Task details, Reimbursement tab, widget live sync, pie + tabs. Screenshots -> screenshots/v6-*.png. Deletes the test project.
 *  DESKLIST_EXE=release/linux-unpacked/@desklistapp xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/smoke-v6.mjs */
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const shots = path.resolve(import.meta.dirname, '../../screenshots'); fs.mkdirSync(shots, { recursive: true });
const exe = process.env.DESKLIST_EXE;
const code = fs.readFileSync('/workspace/desklist-release/ADMIN-CODE.txt', 'utf8').split('\n').map((l) => l.trim()).find((l) => /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(l));
const app = await electron.launch({ executablePath: exe, args: ['--no-sandbox'],
  env: { ...process.env, DESKLIST_SMOKE: '1', DESKLIST_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dl6-')) } });
const log = (...a) => console.log('[v6]', ...a);
const shot = (pg, n) => pg.screenshot({ path: path.join(shots, `v6-${n}.png`) });
const PNAME = `E2E v6 ${Date.now() % 100000}`; const TASK = 'Set up VPS';
const att = path.join(os.tmpdir(), 'invoice-idcloudhost.pdf'); fs.writeFileSync(att, Buffer.alloc(115_000, 7));
let m;
try {
  const w = await app.firstWindow(); await w.waitForLoadState('domcontentloaded');
  w.on('pageerror', (e) => log('widget pageerror', e.message));
  await w.getByLabel('Personal code').fill(code); await w.getByRole('button', { name: 'Sign in' }).click();
  await w.locator('.rail').waitFor({ timeout: 25000 }); log('admin sign-in ok');
  [m] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => globalThis.__desklist.openManage({ view: 'create' }))]);
  m.on('pageerror', (e) => log('manage pageerror', e.message)); m.on('console', (c) => c.type() === 'error' && log('console', c.text()));
  await m.getByLabel('Project name').waitFor({ timeout: 15000 });
  await m.getByLabel('Project name').fill(PNAME); await m.getByLabel('Deadline').fill('2026-11-27');
  await shot(m, 'newproject');
  await m.getByRole('button', { name: 'Create project' }).click(); await m.locator('.tplmodal').waitFor({ timeout: 15000 });
  await m.waitForTimeout(400); await shot(m, 'template-step');
  await m.getByRole('button', { name: 'Skip' }).click(); await m.locator('.tplmodal').waitFor({ state: 'detached' });
  await m.locator('.rhead h1', { hasText: PNAME }).waitFor(); log('project created with deadline:', await m.locator('.rmeta').textContent());
  for (const t of [TASK, 'Write onboarding guide']) { await m.getByLabel('New task title').fill(t); await m.getByRole('button', { name: 'Add task' }).click(); await m.locator(`.tr[data-task="${t}"]`).waitFor({ timeout: 15000 }); }
  // expand + typed fields
  await m.locator(`.tr[data-task="${TASK}"] .expbtn`).click(); await m.locator('.tpanel[data-panel="detail"]').waitFor();
  const addField = async (type, label, value) => {
    await m.locator('.tpanel .tpright .addfield').click(); await m.locator('.typepop').waitFor();
    await m.locator('.typepop .tpi', { hasText: new RegExp(type) }).first().click();
    await m.getByLabel('Field name').fill(label); await m.getByRole('button', { name: 'Add', exact: true }).click();
    const row = m.locator(`.tfrow[data-field="${label}"]`); await row.waitFor({ timeout: 15000 });
    const inp = row.locator('input').first(); await inp.fill(value); await inp.blur(); await m.waitForTimeout(1500);
  };
  await m.locator('.tpanel .tpright .addfield').click(); await m.locator('.typepop').waitFor(); await m.waitForTimeout(200);
  await shot(m, 'field-type-picker'); await m.keyboard.press('Escape'); await m.locator('.tpanel .tph1').click();
  await addField('Email', 'Username', 'budi.s@project-a.com');
  await addField('Password', 'Password', 'Sup3r-secret!');
  // reveal check
  await m.locator('.tfrow[data-field="Password"] .eye').click(); await m.waitForTimeout(1500);
  const revealed = await m.locator('.tfrow[data-field="Password"] input').inputValue(); log('password reveal matches:', revealed === 'Sup3r-secret!');
  await m.locator('.tfrow[data-field="Password"] .eye').click();
  // Has reimbursement 0.1 SOL
  await m.locator('.tpanel .tphead .tgl').click(); await m.locator('.rsec').waitFor({ timeout: 15000 });
  await m.getByLabel('Reimbursement item').fill('VPS 2 vCPU · Singapore'); await m.getByLabel('Reimbursement category').selectOption('Hosting');
  await m.getByLabel('Reimbursement amount').fill('0.1'); await m.getByLabel('Reimbursement amount').press('Enter'); await m.waitForTimeout(2000);
  await shot(m, 'expand'); log('detail panel ok');
  await m.locator('.tpanel .tpx').click();
  // tick -> approve panel
  await m.locator(`.tr[data-task="${TASK}"] .cbx`).click(); await m.locator('.tpanel[data-panel="ticked"]').waitFor({ timeout: 10000 });
  await m.getByLabel('Approval note').fill('VPS live: 2 vCPU / 4 GB, Singapore. IP 103.28.14.77');
  await m.locator('.tpanel input[type=file]').setInputFiles(att);
  await m.locator('.fchip[data-file="invoice-idcloudhost.pdf"]').waitFor({ timeout: 20000 });
  await m.waitForTimeout(500); await shot(m, 'ticked');
  await m.getByRole('button', { name: 'Save', exact: true }).click(); await m.waitForTimeout(2500);
  // widget live
  await w.locator(`.ri[data-project="${PNAME}"]`).click();
  await w.locator(`.wt[data-task="${TASK}"].done`).waitFor({ timeout: 15000 });
  await w.locator(`.wt[data-task="${TASK}"]`).click(); await w.locator('.tpanel').waitFor();
  await w.locator('.tfrow[data-field="Username"]').waitFor({ timeout: 10000 });
  const wtag = await w.locator(`.wt[data-task="${TASK}"] .wtag`).textContent(); log('widget live: done + fields + reimb tag', wtag);
  const pie = await w.locator(`.ri[data-project="${PNAME}"] .rc`).textContent(); log('widget pie count', pie, '/ tabs', await w.locator('.ptabs').first().textContent());
  await w.waitForTimeout(500); await w.screenshot({ path: path.join(shots, 'v6-widget.png'), omitBackground: true });
  // Task details tab
  await m.getByRole('button', { name: /^Task details/ }).click(); await m.locator(`.tdcard[data-taskcard="${TASK}"]`).waitFor({ timeout: 10000 });
  const card = await m.locator(`.tdcard[data-taskcard="${TASK}"]`).textContent();
  log('task details card has note/email/file/reimb/approver:', ['103.28.14.77', 'budi.s@project-a.com', 'invoice-idcloudhost.pdf', '0.1 SOL', 'Approved by'].map((x) => card.includes(x)), '| pending:', await m.locator('.tdpending').textContent());
  await shot(m, 'taskdetails');
  await m.getByRole('button', { name: /^Reimbursement/ }).click(); await m.locator('.rtr[data-reimb="VPS 2 vCPU · Singapore"]').waitFor({ timeout: 10000 });
  log('reimbursement row:', await m.locator('.rtr[data-reimb="VPS 2 vCPU · Singapore"]').textContent()); await shot(m, 'reimbursement');
  await m.getByRole('button', { name: /^Checklist/ }).click(); await m.waitForTimeout(500);
  log('manage card pie:', await m.locator(`.gcard[data-project="${PNAME}"] .gcount`).textContent(), '| tabs:', await m.locator('.ptabs').textContent());
  await shot(m, 'manage-checklist');
  await m.locator('.navbtn', { hasText: 'Team & codes' }).click(); await m.waitForTimeout(800); await shot(m, 'team-codes');
  log('DONE');
} catch (e) { console.error('[v6] FAIL', e); for (const [i, win] of app.windows().entries()) await win.screenshot({ path: `/tmp/v6fail-${i}.png` }).catch(() => {}); process.exitCode = 1; }
finally {
  try {
    const st = await app.evaluate(() => globalThis.__desklist.state());
    const pg = m ?? app.windows()[0];
    for (const p of (st.snapshot?.projects ?? []).filter((p) => p.name.startsWith('E2E v6'))) { await pg.evaluate((id) => window.desklist.request('DELETE', `/api/projects/${id}`), p.id); log('deleted test project', p.name); }
  } catch (e) { log('cleanup error', e.message); }
  await app.close();
}
