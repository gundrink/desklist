import pg from 'pg';
import { Pool as NeonPool, neonConfig, neon } from '@neondatabase/serverless';
import ws from 'ws';
import { databaseUrl } from './env.js';

export const SCHEMA = 'desklist';

export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Queryable {
  /** Run fn inside a transaction (BEGIN/COMMIT, ROLLBACK on throw). */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  driver: string;
}

/**
 * Driver selection:
 *  - host ends with neon.tech -> @neondatabase/serverless (port 443 only; outbound 5432 may be blocked).
 *      default: WebSocket Pool (pg-compatible, supports transactions)
 *      DESKLIST_DB_DRIVER=http -> HTTP driver (sql.query), no real transactions
 *  - otherwise -> node-postgres (pg)
 */
export function createDb(url = databaseUrl()): Db {
  const host = new URL(url).hostname;
  if (host.endsWith('neon.tech')) {
    if (process.env.DESKLIST_DB_DRIVER === 'http') {
      const sql = neon(url);
      const q: Queryable = {
        async query(text, params = []) {
          const rows = (await sql.query(text, params as any[])) as any[];
          return { rows };
        },
      };
      return { ...q, driver: 'neon-http', tx: (fn) => fn(q), close: async () => {} };
    }
    neonConfig.webSocketConstructor = ws as any;
    return wrapPool(new NeonPool({ connectionString: url, max: 10 }) as any, 'neon-websocket-pool');
  }
  return wrapPool(new pg.Pool({ connectionString: url, max: 5 }), 'pg');
}

function wrapPool(pool: pg.Pool, driver: string): Db {
  pool.on('error', (e) => console.error('[db] pool error:', e.message));
  return {
    driver,
    query: (text, params) => pool.query(text, params as any[]) as any,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn({ query: (t, p) => client.query(t, p as any[]) as any });
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
