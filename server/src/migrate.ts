import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, SCHEMA, type Db } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// works from src/ (tsx) and dist/ (built)
const MIGRATIONS_DIR = path.resolve(here, '../migrations');

/** Idempotent: applies each migrations/*.sql once, tracked in desklist.schema_migrations. */
export async function migrate(db: Db, log = console.log): Promise<string[]> {
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await db.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>(`SELECT name FROM ${SCHEMA}.schema_migrations`)).rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    await db.tx(async (q) => {
      // split on ; at line end — migrations are plain DDL without functions/$$ bodies
      for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
        if (stmt.split('\n').every((l) => l.trim().startsWith('--') || !l.trim())) continue;
        await q.query(stmt);
      }
      await q.query(`INSERT INTO ${SCHEMA}.schema_migrations(name) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
    });
    applied.push(f);
    log(`[migrate] applied ${f}`);
  }
  if (!applied.length) log('[migrate] up to date');
  return applied;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.(ts|js)$/, '') === path.join(here, 'migrate');
if (isMain) {
  const db = createDb();
  console.log(`[migrate] driver=${db.driver} schema=${SCHEMA}`);
  migrate(db)
    .then(() => db.close())
    .catch(async (e) => { console.error('[migrate] failed:', e.message); await db.close(); process.exit(1); });
}
