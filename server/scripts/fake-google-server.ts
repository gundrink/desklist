/** E2E helper: real Desklist server code + real DB (temporary team) with a FAKE Google token endpoint/JWKS.
 *  code "e2e-linked-…" -> ID token for the linked email; "e2e-unlinked-…" -> unlinked email; anything else -> invalid_grant.
 *  Prints one JSON line {base, code}; deletes the temp team on SIGTERM/SIGINT. */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { AddressInfo } from 'node:net';
import { createDb } from '../src/db.js';
import { createServer } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { codeBucket } from '../src/crypto.js';
import { PriceService } from '../src/prices.js';
const CID = 'e2e-fake.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (email: string) => { const now = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${b64({ iss: 'https://accounts.google.com', aud: CID, sub: email, iat: now, exp: now + 600, email, email_verified: true })}`;
  return `${d}.${crypto.sign('RSA-SHA256', Buffer.from(d), privateKey).toString('base64url')}`; };
const run = crypto.randomBytes(3).toString('hex').toUpperCase(); const team = crypto.randomUUID();
const linked = `e2e.linked.${run.toLowerCase()}@example.com`;
const db = createDb(); await migrate(db, () => {});
await db.query(`INSERT INTO desklist.teams(id,name) VALUES ($1,'TEST e2e-google ${run}')`, [team]);
const code = `GE-${run}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
await db.query(`INSERT INTO desklist.members(team_id,name,initials,role,code_hash,code_bucket,google_email) VALUES ($1,'E2E Google Admin','EG','admin',$2,$3,$4)`, [team, await bcrypt.hash(code, 10), codeBucket(code), linked]);
const srv = createServer({ db, log: () => {}, prices: new PriceService((async () => ({ ok: true, status: 200, json: async () => ({ solana: { usd: 100 } }) })) as any, 60_000),
  google: { clientId: CID, clientSecret: 'fake',
    tokenFetch: async (body) => { const c = body.get('code') || '';
      const email = c.startsWith('e2e-linked-') ? linked : c.startsWith('e2e-unlinked-') ? `nobody.${run.toLowerCase()}@example.com` : null;
      return email ? { ok: true, status: 200, json: async () => ({ id_token: idToken(email) }) } : { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }; },
    getCerts: async () => ({ k1: publicKey.export({ type: 'spki', format: 'pem' }).toString() }) } });
await new Promise<void>((r) => srv.server.listen(0, '127.0.0.1', r));
console.log(JSON.stringify({ base: `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`, code }));
const stop = async () => { await db.query(`DELETE FROM desklist.teams WHERE id=$1`, [team]).catch(() => {}); await srv.close(); await db.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
