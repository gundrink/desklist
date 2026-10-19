import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load server/.env if present (local dev on Mac/Windows). Real env vars win.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../.env'), quiet: true } as never);

/** The DB URL is read from env only and must never be printed or logged. */
export function databaseUrl(): string {
  const url = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL (or DATABASE_URL) is not set');
  return url;
}

export function encryptionKey(): string {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (!k || k.length < 16) throw new Error('APP_ENCRYPTION_KEY must be set (16+ chars)');
  return k;
}
