/**
 * Create the real team + its first admin with a strong random sign-in code.
 *   npm run bootstrap-admin -w server -- --team "1Vault" --admin "1Vault" --out /path/ADMIN-CODE.txt [--reset]
 * Only the bcrypt hash is stored. The plaintext code is written ONLY to --out (chmod 600), never logged.
 */
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { createDb, SCHEMA as S } from './db.js';
import { codeBucket, normalizeCode } from './crypto.js';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const team = arg('--team', '1Vault')!, adminName = arg('--admin', '1Vault')!, out = arg('--out');
const reset = process.argv.includes('--reset');
if (!out) { console.error('--out <file> is required'); process.exit(1); }

/** 4 groups of 5 chars from an unambiguous alphabet (~100 bits). */
export function strongCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(20);
  return Array.from({ length: 4 }, (_, g) => Array.from({ length: 5 }, (_, i) => A[b[g * 5 + i] % A.length]).join('')).join('-');
}

const db = createDb();
try {
  let t = (await db.query(`SELECT * FROM ${S}.teams WHERE name=$1 AND NOT is_demo`, [team])).rows[0];
  if (!t) t = (await db.query(`INSERT INTO ${S}.teams(name, currency) VALUES ($1,'SOL') RETURNING *`, [team])).rows[0];
  let m = (await db.query(`SELECT * FROM ${S}.members WHERE team_id=$1 AND name=$2 AND role='admin'`, [t.id, adminName])).rows[0];
  if (m && !reset) { console.log(`[bootstrap] admin "${adminName}" already exists in team "${team}" — use --reset to issue a new code`); process.exit(0); }
  const code = strongCode(); const norm = normalizeCode(code);
  const initials = adminName.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'AD';
  if (m) await db.query(`UPDATE ${S}.members SET code_hash=$2, code_bucket=$3, revoked=false, currency='SOL', updated_at=now() WHERE id=$1`, [m.id, await bcrypt.hash(norm, 10), codeBucket(norm)]);
  else m = (await db.query(`INSERT INTO ${S}.members(team_id,name,initials,role,code_hash,code_bucket,currency) VALUES ($1,$2,$3,'admin',$4,$5,'SOL') RETURNING *`,
    [t.id, adminName, initials, await bcrypt.hash(norm, 10), codeBucket(norm)])).rows[0];
  if (reset) await db.query(`DELETE FROM ${S}.sessions WHERE member_id=$1`, [m.id]);
  fs.writeFileSync(out, `Desklist admin sign-in code (team "${team}", admin "${adminName}")\n\n${code}\n\nKeep this secret. Generate member codes in Manage > Team & codes.\n`, { mode: 0o600 });
  fs.chmodSync(out, 0o600);
  console.log(`[bootstrap] team "${team}" + admin "${adminName}" ready; code written to ${out} (not shown)`);
} finally { await db.close(); }
