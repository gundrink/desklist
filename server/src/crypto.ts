import crypto from 'node:crypto';
import { encryptionKey } from './env.js';

/** AES-256-GCM for secret master-field values. Format: v1:<base64(iv[12] | tag[16] | ciphertext)> */
function key(): Buffer {
  return crypto.createHash('sha256').update(encryptionKey()).digest();
}
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decryptSecret(stored: string): string {
  if (!stored.startsWith('v1:')) throw new Error('not an encrypted value');
  const buf = Buffer.from(stored.slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');
export const codeBucket = (code: string) => sha256(normalizeCode(code)).slice(0, 2);
export const newToken = () => crypto.randomBytes(32).toString('base64url');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function generateCode(): string {
  const pick = () => Array.from(crypto.randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${pick()}-${pick()}`;
}
