/**
 * v5 endpoints: currency/prices, settings, templates, task expenses, reimbursements, admin reports + CSV.
 * Uses throw-away TEST teams (deleted afterwards) and a fake CoinGecko fetcher (no network).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createDb, type Db } from '../src/db.js';
import { createServer } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { codeBucket } from '../src/crypto.js';
import { PriceService, type Fetcher } from '../src/prices.js';
import type { Snapshot } from '@desklist/shared';

process.env.APP_ENCRYPTION_KEY ||= 'test-key-only-for-local-tests-0123456789';
let db: Db; let srv: ReturnType<typeof createServer>; let base = '';
const run = crypto.randomBytes(3).toString('hex');
const teamA = crypto.randomUUID(); const teamB = crypto.randomUUID();
let adminTok = '', memberTok = '', otherTok = '';
let fetchCalls = 0; let failFetch = false;
const fakeGecko: Fetcher = async () => {
  fetchCalls++;
  if (failFetch) return { ok: false, status: 429, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ solana: { usd: 150, idr: 2_400_000 }, bitcoin: { usd: 100_000, idr: 1_600_000_000 }, ethereum: { usd: 4000, idr: 1 } }) };
};

async function api(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: r.status, body: json, text, headers: r.headers };
}

beforeAll(async () => {
  db = createDb();
  await migrate(db, () => {});
  await seed(db, () => {});
  await db.query(`INSERT INTO desklist.teams(id,name) VALUES ($1,'TEST v5 ${run}'), ($2,'TEST v5 other ${run}')`, [teamA, teamB]);
  const mk = async (team: string, name: string, role: string, code: string) =>
    db.query(`INSERT INTO desklist.members(team_id,name,initials,role,code_hash,code_bucket) VALUES ($1,$2,$3,$4,$5,$6)`,
      [team, name, name.slice(0, 2).toUpperCase(), role, await bcrypt.hash(code, 10), codeBucket(code)]);
  const codes = { a: `V5A-${run}`.toUpperCase(), m: `V5M-${run}`.toUpperCase(), o: `V5O-${run}`.toUpperCase() };
  await mk(teamA, 'V5 Admin', 'admin', codes.a); await mk(teamA, 'V5 Member', 'member', codes.m); await mk(teamB, 'V5 Other', 'admin', codes.o);
  srv = createServer({ db, log: () => {}, prices: new PriceService(fakeGecko, 50) });
  await new Promise<void>((r) => srv.server.listen(0, r));
  base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  const si = async (code: string) => (await api('POST', '/api/auth/signin', undefined, { code })).body.token;
  adminTok = await si(codes.a); memberTok = await si(codes.m); otherTok = await si(codes.o);
});
afterAll(async () => {
  await db.query(`DELETE FROM desklist.teams WHERE id = ANY($1::uuid[])`, [[teamA, teamB]]);
  await srv?.close(); await db?.close();
});

describe('currency & prices', () => {
  it('lists IDR + native coins only, SOL default, with USD prices', async () => {
    const r = await api('GET', '/api/currencies');
    expect(r.status).toBe(200);
    const codes = r.body.currencies.map((c: any) => c.code);
    expect(r.body.default).toBe('SOL');
    expect(codes).toEqual(expect.arrayContaining(['IDR', 'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TON', 'AVAX', 'TRX', 'DOT', 'LTC']));
    for (const bad of ['USD', 'USDT', 'USDC', 'DAI']) expect(codes).not.toContain(bad);
    expect(r.body.prices.usd.SOL).toBe(150);
    expect(r.body.prices.usd.IDR).toBeCloseTo(100_000 / 1_600_000_000);
  });
  it('caches, then falls back to the last rate when CoinGecko fails', async () => {
    const before = fetchCalls;
    await api('GET', '/api/prices'); // within TTL: cached
    expect(fetchCalls).toBe(before);
    await new Promise((r) => setTimeout(r, 80));
    failFetch = true;
    const r = await api('GET', '/api/prices');
    failFetch = false;
    expect(r.body.prices.usd.SOL).toBe(150);
    expect(r.body.prices.stale).toBe(true);
  });
  it('admin sets the currency; members cannot; USD is rejected', async () => {
    expect((await api('PATCH', '/api/settings', memberTok, { currency: 'BTC' })).status).toBe(403);
    expect((await api('PATCH', '/api/settings', adminTok, { currency: 'USD' })).status).toBe(400);
    expect((await api('PATCH', '/api/settings', adminTok, { currency: 'ETH' })).status).toBe(200);
    expect((await api('GET', '/api/snapshot', memberTok)).body.currency).toBe('ETH');
    expect((await api('PATCH', '/api/settings', adminTok, { currency: 'SOL' })).status).toBe(200);
  });
});

describe('templates, expenses, reimbursements, reports', () => {
  let projectId = ''; let tplId = '';
  it('seeds built-in templates (Website launch) visible to every team', async () => {
    const r = await api('GET', '/api/templates', memberTok);
    const wl = r.body.find((t: any) => t.name === 'Website launch');
    expect(wl.tasks.length).toBe(12);
    expect(wl.tasks.filter((t: any) => t.expenseAmount).length).toBe(3);
    tplId = wl.id;
  });
  it('creates a project from a template (tasks + task expenses + reimbursements)', async () => {
    const r = await api('POST', '/api/projects', memberTok, { name: `V5 ${run}`, templateId: tplId });
    expect(r.status).toBe(201);
    projectId = r.body.id;
    expect(r.body.templateId).toBe(tplId);
    expect(r.body.hasExpenses).toBe(true);
    const s: Snapshot = (await api('GET', '/api/snapshot', memberTok)).body;
    const tasks = s.tasks.filter((t) => t.projectId === projectId);
    expect(tasks.length).toBe(12);
    const vps = tasks.find((t) => t.title === 'Set up VPS')!;
    expect(vps.hasExpense).toBe(true); expect(vps.expenseAmount).toBe(0.12); expect(vps.expenseCurrency).toBe('SOL');
    expect(s.reimbursements.filter((x) => x.projectId === projectId).length).toBe(3);
    expect(s.prices.usd.SOL).toBe(150);
  });
  it('per-task expense: create, change, remove keeps the linked reimbursement in step', async () => {
    const t = await api('POST', `/api/projects/${projectId}/tasks`, memberTok, { title: 'Langganan Figma', hasExpense: true, expenseAmount: 0.1 });
    expect(t.status).toBe(201); expect(t.body.expenseCurrency).toBe('SOL');
    const find = async () => (await api('GET', '/api/reimbursements', memberTok)).body.find((x: any) => x.taskId === t.body.id);
    expect((await find()).amount).toBe(0.1);
    await api('PATCH', `/api/tasks/${t.body.id}`, memberTok, { expenseAmount: 0.25, expenseCurrency: 'IDR' });
    expect((await find()).currency).toBe('IDR');
    await api('PATCH', `/api/tasks/${t.body.id}`, memberTok, { hasExpense: false });
    expect(await find()).toBeUndefined();
    expect((await api('POST', `/api/projects/${projectId}/tasks`, memberTok, { title: 'x', hasExpense: true, expenseAmount: -1 })).status).toBe(400);
  });
  it('project toggle + reimbursement note + manual reimbursement in crypto or Rupiah', async () => {
    const p = await api('PATCH', `/api/projects/${projectId}`, memberTok, { hasExpenses: true, reimburseNote: 'Transfer ke wallet' });
    expect(p.body.reimburseNote).toBe('Transfer ke wallet');
    const r = await api('POST', `/api/projects/${projectId}/reimbursements`, memberTok, { item: 'Parkir meeting klien', category: 'Travel', amount: 150000, currency: 'IDR', note: 'parkir' });
    expect(r.status).toBe(201); expect(r.body.status).toBe('pending'); expect(r.body.currency).toBe('IDR');
    expect((await api('PATCH', `/api/reimbursements/${r.body.id}`, memberTok, { reimbursed: true })).status).toBe(403);
    expect((await api('PATCH', `/api/reimbursements/${r.body.id}`, otherTok, { reimbursed: true })).status).toBe(404);
    const ok = await api('PATCH', `/api/reimbursements/${r.body.id}`, adminTok, { reimbursed: true });
    expect(ok.body.reimbursed).toBe(true); expect(ok.body.reimbursedAt).toBeTruthy();
  });
  it('admin report: totals, reimbursed vs not, per project, CSV; members get 403', async () => {
    expect((await api('GET', '/api/reports', memberTok)).status).toBe(403);
    const r = await api('GET', '/api/reports', adminTok);
    expect(r.status).toBe(200);
    expect(r.body.currency).toBe('SOL');
    expect(r.body.count).toBe(4);
    // 0.08 + 0.12 + 0.35 SOL + 150000 IDR (= 150000 * 0.0000625 / 150 SOL)
    const idrInSol = (150000 * (100_000 / 1_600_000_000)) / 150;
    expect(r.body.total).toBeCloseTo(0.55 + idrInSol, 6);
    expect(r.body.reimbursed).toBeCloseTo(idrInSol, 6);
    expect(r.body.notReimbursed).toBeCloseTo(0.55, 6);
    expect(r.body.perProject.find((p: any) => p.projectId === projectId).count).toBe(4);
    expect(JSON.stringify(r.body).toLowerCase()).not.toMatch(/pemasukan|income/);
    const csv = await api('GET', '/api/reports/expenses.csv', adminTok);
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toContain('usd_equivalent');
    expect(csv.text).toContain('Set up VPS');
    expect(csv.text).toContain('52.50'); // SSL 0.35 SOL * $150
  });
  it('save current project as a team template, shared with teammates only', async () => {
    const t = await api('POST', '/api/templates', memberTok, { name: `Mine ${run}`, fromProjectId: projectId });
    expect(t.status).toBe(201); expect(t.body.tasks.length).toBe(13);
    expect((await api('GET', '/api/templates', adminTok)).body.some((x: any) => x.id === t.body.id)).toBe(true);
    expect((await api('GET', '/api/templates', otherTok)).body.some((x: any) => x.id === t.body.id)).toBe(false);
    const p2 = await api('POST', '/api/projects', adminTok, { name: `V5b ${run}` });
    const ap = await api('POST', `/api/projects/${p2.body.id}/apply-template`, adminTok, { templateId: t.body.id });
    expect(ap.status).toBe(200);
    expect((await api('POST', `/api/projects/${p2.body.id}/apply-template`, otherTok, { templateId: t.body.id })).status).toBe(404);
  });
});
