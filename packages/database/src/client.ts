import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { getConfig } from '@localy/config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Transaction;

let pool: pg.Pool | undefined;
let db: Database | undefined;

// Return timestamps as JS Dates, numerics as numbers where safe.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export function getPool(): pg.Pool {
  if (!pool) {
    const cfg = getConfig();
    pool = new pg.Pool({
      connectionString: cfg.DATABASE_URL,
      max: cfg.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
      console.error('[database] idle client error', err.message);
    });
  }
  return pool;
}

export function getDb(): Database {
  if (!db) db = drizzle(getPool(), { schema, casing: 'snake_case' });
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    db = undefined;
    await p.end();
  }
}
